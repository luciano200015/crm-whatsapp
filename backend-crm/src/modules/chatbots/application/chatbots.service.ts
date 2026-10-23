import { Injectable } from '@nestjs/common';
import { WorkspaceEntitlements } from '../../../shared/entitlements/workspace-entitlements';
import type { RequestContext } from '../../../shared/http/request-context';
import { Clock } from '../../../shared/time/clock';
import { AuditService } from '../../audit/audit.service';
import { InboxErrors } from '../../inbox/application/inbox-errors';
import {
  baseMimeType,
  MediaStore,
  outgoingMedia,
  sanitizeFilename,
  type StoredMedia,
} from '../../inbox/application/media';
import {
  flowIssues,
  FlowFormatError,
  parseFlow,
  starterFlow,
  type BotMedia,
  type Flow,
  type FlowIssue,
} from '../domain/flow';
import {
  advance,
  type BotAction,
  type EngineSession,
} from '../domain/flow-engine';
import { scheduleProblem, type Schedule } from '../domain/schedule';
import { ChatbotsErrors } from './chatbots-errors';
import {
  ChatbotsStore,
  type ChatbotChanges,
  type ChatbotRecord,
} from './ports';

export interface ChatbotSummary {
  id: string;
  name: string;
  enabled: boolean;
  lines: { id: string; name: string }[];
  /** Errors to fix before it can be enabled. */
  errors: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatbotView extends ChatbotSummary {
  graph: Flow;
  schedule: Schedule | null;
  restartAfterMinutes: number;
  issues: FlowIssue[];
}

interface Actor {
  userId: string;
  context: RequestContext;
}

const FEATURE = 'features.advanced_chatbots';

/** Reads a stored flow; one that no longer parses starts over. */
function storedFlow(graph: unknown): Flow {
  try {
    return parseFlow(graph);
  } catch {
    return starterFlow();
  }
}

/** The session the tester sends back: only its expected shape is kept. */
function testSession(value: unknown): EngineSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.nodeId !== 'string') return null;
  const vars: Record<string, string> = {};
  if (typeof raw.vars === 'object' && raw.vars !== null) {
    for (const [key, item] of Object.entries(raw.vars).slice(0, 50)) {
      if (typeof item === 'string') vars[key.slice(0, 31)] = item.slice(0, 500);
    }
  }
  const attempts = Number(raw.attempts);
  return {
    nodeId: raw.nodeId.slice(0, 40),
    vars,
    attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : 0,
  };
}

/** Chatbots of a workspace: their flows, hours, lines and test runs. */
@Injectable()
export class ChatbotsService {
  constructor(
    private readonly store: ChatbotsStore,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly media: MediaStore,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(workspaceId: string): Promise<ChatbotSummary[]> {
    const bots = await this.store.list(workspaceId);
    return bots.map((bot) => this.summary(bot, storedFlow(bot.graph)));
  }

  async get(workspaceId: string, chatbotId: string): Promise<ChatbotView> {
    return this.toView(await this.require(workspaceId, chatbotId));
  }

  async create(
    workspaceId: string,
    name: string,
    actor: Actor,
  ): Promise<ChatbotView> {
    await this.assertIncluded(workspaceId);
    const created = await this.store.create(workspaceId, {
      name: name.trim(),
      graph: starterFlow(),
      createdByUserId: actor.userId,
    });
    await this.record(
      'chatbots.chatbot.created',
      workspaceId,
      created.id,
      actor,
    );
    return this.toView(created);
  }

  async update(
    workspaceId: string,
    chatbotId: string,
    changes: ChatbotChanges,
    actor: Actor,
  ): Promise<ChatbotView> {
    const current = await this.require(workspaceId, chatbotId);
    const graph =
      changes.graph !== undefined ? this.parse(changes.graph) : undefined;
    if (changes.schedule !== undefined && changes.schedule !== null) {
      const problem = scheduleProblem(changes.schedule);
      if (problem) throw ChatbotsErrors.scheduleInvalid(problem);
    }
    const enabled = changes.enabled ?? current.enabled;
    if (enabled) {
      if (changes.enabled === true) await this.assertIncluded(workspaceId);
      // A chatbot never answers customers with a half-built flow.
      const errors = flowIssues(graph ?? storedFlow(current.graph)).filter(
        (issue) => issue.level === 'error',
      );
      if (errors.length > 0) throw ChatbotsErrors.flowIncomplete(errors);
    }
    const updated = await this.store.update(workspaceId, chatbotId, {
      ...(changes.name !== undefined && { name: changes.name.trim() }),
      ...(changes.enabled !== undefined && { enabled: changes.enabled }),
      ...(graph && { graph }),
      ...(changes.schedule !== undefined && { schedule: changes.schedule }),
      ...(changes.restartAfterMinutes !== undefined && {
        restartAfterMinutes: changes.restartAfterMinutes,
      }),
    });
    if (!updated) throw ChatbotsErrors.chatbotNotFound();
    await this.record(
      'chatbots.chatbot.updated',
      workspaceId,
      chatbotId,
      actor,
      {
        fields: Object.keys(changes),
      },
    );
    return this.toView(updated);
  }

  async remove(workspaceId: string, chatbotId: string, actor: Actor) {
    if (!(await this.store.remove(workspaceId, chatbotId))) {
      throw ChatbotsErrors.chatbotNotFound();
    }
    await this.record(
      'chatbots.chatbot.deleted',
      workspaceId,
      chatbotId,
      actor,
    );
  }

  /** A copy to try changes on: turned off and without lines. */
  async duplicate(
    workspaceId: string,
    chatbotId: string,
    actor: Actor,
  ): Promise<ChatbotView> {
    const source = await this.require(workspaceId, chatbotId);
    await this.assertIncluded(workspaceId);
    const copy = await this.store.create(workspaceId, {
      name: `Copia de ${source.name}`.slice(0, 80),
      graph: storedFlow(source.graph),
      createdByUserId: actor.userId,
    });
    const withSettings =
      (await this.store.update(workspaceId, copy.id, {
        schedule: source.schedule ?? null,
        restartAfterMinutes: source.restartAfterMinutes,
      })) ?? copy;
    await this.record('chatbots.chatbot.created', workspaceId, copy.id, actor, {
      duplicateOf: chatbotId,
    });
    return this.toView(withSettings);
  }

  /** The lines this chatbot answers on: one chatbot per line. */
  async setLines(
    workspaceId: string,
    chatbotId: string,
    lineIds: string[],
    takeOver: boolean,
    actor: Actor,
  ): Promise<ChatbotView> {
    const result = await this.store.setLines(
      workspaceId,
      chatbotId,
      [...new Set(lineIds)],
      takeOver,
    );
    if ('kind' in result) {
      if (result.kind === 'chatbot_not_found')
        throw ChatbotsErrors.chatbotNotFound();
      if (result.kind === 'line_not_found') throw ChatbotsErrors.lineNotFound();
      throw ChatbotsErrors.lineHasChatbot({
        lineId: result.lineId,
        lineName: result.lineName,
        chatbot: result.chatbot,
      });
    }
    await this.record(
      'chatbots.chatbot.lines_changed',
      workspaceId,
      chatbotId,
      actor,
      {
        lineIds: result.lines.map((line) => line.id),
      },
    );
    return this.toView(result);
  }

  /** A file the chatbot sends (image, video, audio or document). */
  async uploadMedia(
    workspaceId: string,
    chatbotId: string,
    file: { buffer: Buffer; mimeType: string; filename: string; size: number },
  ): Promise<BotMedia> {
    await this.require(workspaceId, chatbotId);
    const checked = outgoingMedia(file.mimeType, file.size);
    if ('error' in checked) {
      throw checked.error === 'too_large'
        ? InboxErrors.mediaTooLarge(checked.maxBytes)
        : InboxErrors.unsupportedMedia();
    }
    const mimeType = baseMimeType(file.mimeType);
    const filename =
      sanitizeFilename(file.filename) ?? `archivo.${checked.type}`;
    const stored = await this.media.put(workspaceId, {
      body: file.buffer,
      mimeType,
      filename,
    });
    return {
      fileId: stored.fileId,
      type: checked.type,
      mimeType,
      filename,
      size: stored.size,
    };
  }

  async openMedia(
    workspaceId: string,
    chatbotId: string,
    fileId: string,
  ): Promise<StoredMedia> {
    await this.require(workspaceId, chatbotId);
    const file = /^[0-9a-f]{24}$/.test(fileId)
      ? await this.media.open(workspaceId, fileId)
      : null;
    if (!file) throw ChatbotsErrors.mediaNotFound();
    return file;
  }

  /**
   * "Probar chatbot": runs the flow being edited for a pretend customer.
   * Nothing is sent or changed; the actions come back to show them.
   */
  simulate(input: {
    graph: unknown;
    session: unknown;
    text: string | null;
    replyId: string | null;
    contactName: string | null;
  }): { actions: BotAction[]; session: EngineSession | null } {
    const flow = this.parse(input.graph);
    const session = testSession(input.session);
    const waiting =
      session && flow.nodes.some((node) => node.id === session.nodeId)
        ? session
        : null;
    return advance(
      flow,
      waiting,
      { text: input.text, replyId: input.replyId },
      {
        now: this.clock.now(),
        contact: { name: input.contactName, phone: '+00000000000' },
      },
    );
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private parse(graph: unknown): Flow {
    try {
      return parseFlow(graph);
    } catch (error: unknown) {
      if (error instanceof FlowFormatError)
        throw ChatbotsErrors.flowInvalid(error.issues);
      throw error;
    }
  }

  private async require(
    workspaceId: string,
    chatbotId: string,
  ): Promise<ChatbotRecord> {
    const bot = await this.store.find(workspaceId, chatbotId);
    if (!bot) throw ChatbotsErrors.chatbotNotFound();
    return bot;
  }

  private async assertIncluded(workspaceId: string) {
    const plan = await this.entitlements.entitlements(workspaceId);
    if (!plan?.hasFullAccess) throw InboxErrors.subscriptionInactive();
    if (plan.features[FEATURE] === false) {
      throw ChatbotsErrors.featureNotInPlan({
        feature: FEATURE,
        plan: plan.planName,
      });
    }
  }

  private record(
    action: string,
    workspaceId: string,
    chatbotId: string,
    actor: Actor,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      action,
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'chatbot',
      targetId: chatbotId,
      context: actor.context,
      metadata,
    });
  }

  private summary(bot: ChatbotRecord, flow: Flow): ChatbotSummary {
    return {
      id: bot.id,
      name: bot.name,
      enabled: bot.enabled,
      lines: bot.lines,
      errors: flowIssues(flow).filter((issue) => issue.level === 'error')
        .length,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    };
  }

  private toView(bot: ChatbotRecord): ChatbotView {
    const graph = storedFlow(bot.graph);
    return {
      ...this.summary(bot, graph),
      graph,
      schedule: (bot.schedule as Schedule | null) ?? null,
      restartAfterMinutes: bot.restartAfterMinutes,
      issues: flowIssues(graph),
    };
  }
}
