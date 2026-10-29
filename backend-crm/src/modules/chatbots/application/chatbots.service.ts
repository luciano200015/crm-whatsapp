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
import { InboxService } from '../../inbox/application/inbox.service';
import { buildRequest, valueAt, type BotResponse } from '../domain/bot-request';
import {
  flowIssues,
  FlowFormatError,
  parseFlow,
  starterFlow,
  type BotMedia,
  type Flow,
  type FlowIssue,
  type NodeData,
} from '../domain/flow';
import {
  interpolate,
  type BotAction,
  type EngineSession,
} from '../domain/flow-engine';
import { scheduleProblem, type Schedule } from '../domain/schedule';
import {
  CONTACT_VARIABLES,
  parseVariables,
  storedVariables,
  type BotVariable,
} from '../domain/variables';
import { runTurn } from './bot-turn';
import { ChatbotsErrors } from './chatbots-errors';
import {
  BotHttpClient,
  ChatbotsStore,
  type ChatbotChanges,
  type ChatbotRecord,
} from './ports';

/** «Probar conexión» calls per user and minute at most. */
const TESTS_PER_MINUTE = 10;
/** Text of a test answer shown in the editor. */
const TEST_BODY_CHARS = 2000;

export interface ChatbotSummary {
  id: string;
  name: string;
  description: string;
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
  fallbackText: string;
  restartKeywords: string[];
  inactivityMinutes: number | null;
  inactivityText: string;
  variables: BotVariable[];
  /** Contact data every chatbot can use: {{nombre}}, {{email}}… */
  contactVariables: string[];
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
  if (typeof raw.nodeId !== 'string' && raw.nodeId !== null) return null;
  const vars: Record<string, string> = {};
  if (typeof raw.vars === 'object' && raw.vars !== null) {
    for (const [key, item] of Object.entries(raw.vars).slice(0, 50)) {
      if (typeof item === 'string') vars[key.slice(0, 31)] = item.slice(0, 500);
    }
  }
  const attempts = Number(raw.attempts);
  return {
    nodeId: raw.nodeId === null ? null : raw.nodeId.slice(0, 40),
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
    private readonly http: BotHttpClient,
    private readonly inbox: InboxService,
  ) {}

  /** «Probar conexión» calls of each user in the current minute. */
  private readonly tests = new Map<string, { minute: number; count: number }>();

  async list(workspaceId: string): Promise<ChatbotSummary[]> {
    const bots = await this.store.list(workspaceId);
    return bots.map((bot) => this.summary(bot, storedFlow(bot.graph)));
  }

  /** Words of "Palabras para volver al saludo": trimmed, lowercase, unique. */
  private keywords(words: string[]): string[] {
    return [
      ...new Set(
        words.map((word) => word.trim().toLowerCase()).filter(Boolean),
      ),
    ];
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
    let variables: BotVariable[] | undefined;
    if (changes.variables !== undefined) {
      const parsed = parseVariables(changes.variables);
      if ('problem' in parsed)
        throw ChatbotsErrors.variablesInvalid(parsed.problem);
      variables = parsed.variables;
    }
    const enabled = changes.enabled ?? current.enabled;
    if (enabled) {
      if (changes.enabled === true) await this.assertIncluded(workspaceId);
      // A chatbot never answers customers with a half-built flow.
      const errors = flowIssues(
        graph ?? storedFlow(current.graph),
        variables ?? storedVariables(current.variables),
      ).filter((issue) => issue.level === 'error');
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
      ...(changes.description !== undefined && {
        description: changes.description.trim(),
      }),
      ...(changes.fallbackText !== undefined && {
        fallbackText: changes.fallbackText.trim(),
      }),
      ...(changes.restartKeywords !== undefined && {
        restartKeywords: this.keywords(changes.restartKeywords),
      }),
      ...(changes.inactivityMinutes !== undefined && {
        inactivityMinutes: changes.inactivityMinutes,
      }),
      ...(changes.inactivityText !== undefined && {
        inactivityText: changes.inactivityText.trim(),
      }),
      ...(variables && { variables }),
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
        description: source.description,
        schedule: source.schedule ?? null,
        restartAfterMinutes: source.restartAfterMinutes,
        fallbackText: source.fallbackText,
        restartKeywords: source.restartKeywords,
        inactivityMinutes: source.inactivityMinutes,
        inactivityText: source.inactivityText,
        variables: storedVariables(source.variables),
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
   * Nothing is sent or changed; the actions come back to show them. A
   * «Consulta API» does call its service, so the test is real.
   */
  async simulate(
    workspaceId: string,
    input: {
      graph: unknown;
      session: unknown;
      text: string | null;
      replyId: string | null;
      contactName: string | null;
      fallbackText: string;
      restartKeywords: string[];
      variables: unknown;
    },
  ): Promise<{ actions: BotAction[]; session: EngineSession | null }> {
    const flow = this.parse(input.graph);
    const session = testSession(input.session);
    const waiting =
      session &&
      (session.nodeId === null ||
        flow.nodes.some((node) => node.id === session.nodeId))
        ? session
        : null;
    return runTurn(
      flow,
      waiting,
      { text: input.text, replyId: input.replyId },
      {
        now: this.clock.now(),
        contact: {
          name: input.contactName,
          phone: '+59170000000',
          email: 'cliente@ejemplo.com',
        },
        settings: {
          fallbackText: input.fallbackText,
          restartKeywords: this.keywords(input.restartKeywords),
        },
        variables: storedVariables(input.variables),
        contactFields: await this.inbox.botContactFields(workspaceId),
      },
      (request) => this.http.send(request),
    );
  }

  /**
   * «Probar conexión» of a «Consulta API»: calls the service with test
   * values for its {{variables}} and shows what it answered and what each
   * variable would hold.
   */
  async testRequest(
    userId: string,
    api: unknown,
    sample: Record<string, string>,
  ): Promise<{
    ok: boolean;
    status: number;
    error: string | null;
    body: string;
    values: { variable: string; value: string }[];
  }> {
    const minute = Math.floor(this.clock.now().getTime() / 60_000);
    const used = this.tests.get(userId);
    const count = used?.minute === minute ? used.count : 0;
    if (count >= TESTS_PER_MINUTE) throw ChatbotsErrors.tooManyRequests();
    this.tests.set(userId, { minute, count: count + 1 });
    if (this.tests.size > 1000)
      for (const [key, value] of this.tests)
        if (value.minute !== minute) this.tests.delete(key);

    const flow = this.parse({
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'api', type: 'api', position: { x: 0, y: 0 }, data: api },
      ],
      edges: [],
    });
    const node = flow.nodes.find((item) => item.type === 'api');
    const data = node?.data as NodeData['api'];
    const vars = Object.fromEntries(
      Object.entries(sample)
        .slice(0, 50)
        .map(([key, value]) => [key.slice(0, 50), String(value).slice(0, 500)]),
    );
    const contact = { name: null, phone: '', email: null };
    const response: BotResponse = await this.http.send(
      buildRequest(data, (text, encode) =>
        interpolate(text, vars, contact, encode),
      ),
    );
    const body =
      typeof response.body === 'string'
        ? response.body
        : response.body === null || response.body === undefined
          ? ''
          : JSON.stringify(response.body, null, 2);
    return {
      ok: response.ok,
      status: response.status,
      error: response.error ?? null,
      body: body.slice(0, TEST_BODY_CHARS),
      values: response.ok
        ? data.responses.map((item) => ({
            variable: item.variable,
            value: valueAt(response.body, item.path),
          }))
        : [],
    };
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
      description: bot.description,
      enabled: bot.enabled,
      lines: bot.lines,
      errors: flowIssues(flow, storedVariables(bot.variables)).filter(
        (issue) => issue.level === 'error',
      ).length,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    };
  }

  private toView(bot: ChatbotRecord): ChatbotView {
    const graph = storedFlow(bot.graph);
    const variables = storedVariables(bot.variables);
    return {
      ...this.summary(bot, graph),
      graph,
      schedule: (bot.schedule as Schedule | null) ?? null,
      restartAfterMinutes: bot.restartAfterMinutes,
      fallbackText: bot.fallbackText,
      restartKeywords: bot.restartKeywords,
      inactivityMinutes: bot.inactivityMinutes,
      inactivityText: bot.inactivityText,
      variables,
      contactVariables: [...CONTACT_VARIABLES],
      issues: flowIssues(graph, variables),
    };
  }
}
