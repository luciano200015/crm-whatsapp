import { Injectable } from '@nestjs/common';
import { WorkspaceEntitlements } from '../../../shared/entitlements/workspace-entitlements';
import type { RequestContext } from '../../../shared/http/request-context';
import { Clock } from '../../../shared/time/clock';
import { AuditService } from '../../audit/audit.service';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import { ChannelsStore } from '../../channels/application/ports';
import { ContactsStore } from '../../contacts/application/ports';
import { ConversationTimeline } from '../../inbox/application/conversation-timeline';
import { InboxErrors } from '../../inbox/application/inbox-errors';
import { InboxEvents } from '../../inbox/application/inbox-events';
import { InboxService } from '../../inbox/application/inbox.service';
import {
  InboxStore,
  type ConversationRecord,
} from '../../inbox/application/ports';
import { canSee, type InboxScope } from '../../inbox/domain/inbox-rules';
import { csvDocument } from '../domain/csv';
import {
  CHAT_STATUSES,
  DEFAULT_STAGES,
  FUNNEL_LIMITS,
  centsToText,
  sameName,
  visibleStageIds,
  type BoardFilters,
  type ChatStatus,
  type LeadSource,
} from '../domain/funnel-rules';
import { FunnelsErrors } from './funnels-errors';
import {
  FunnelsStore,
  LeadsStore,
  type BoardPreferences,
  type FunnelRecord,
  type LeadCard,
  type LeadRecord,
  type LeadWrite,
  type StageRecord,
} from './ports';

const FEATURE = 'features.sales_funnels';

const STATUS_LABELS: Record<ChatStatus, string> = {
  OPEN: 'Abierto',
  ON_HOLD: 'En espera',
  CLOSED: 'Cerrado',
};

/** The member acting (resolved by WorkspaceAccessGuard). */
export interface FunnelActor {
  userId: string;
  access: WorkspaceAccess;
  context: RequestContext;
}

/** Who moved a lead, for the chat history: a member, a chatbot or nobody (automation). */
type Mover = { userId: string; name: string; kind?: 'user' | 'bot' } | null;

export interface StageView {
  id: string;
  name: string;
  position: number;
}

export interface FunnelSummary {
  id: string;
  name: string;
  description: string;
  lineId: string;
  lineName: string;
  isPrimary: boolean;
  archiveAfterDays: number | null;
  /** Active leads. */
  leads: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FunnelView extends FunnelSummary {
  /** The stages the member sees, in board order. */
  stages: StageView[];
  syncRules: { status: ChatStatus; stageId: string }[];
}

export interface LeadView {
  id: string;
  funnelId: string;
  stageId: string;
  contactId: string;
  amountCents: number;
  archivedAt: Date | null;
  archivedBy: { userId: string; name: string } | null;
  activityAt: Date;
  version: number;
  createdAt: Date;
  contact: { name: string | null; phone: string; tagIds: string[] } | null;
  /** The chat of the contact on the funnel's line (null: none yet). */
  conversation: {
    id: string;
    status: ChatStatus;
    assignee: { membershipId: string; name: string } | null;
    /** False when the chat is another agent's: no preview then. */
    visible: boolean;
    lastMessage: {
      text: string | null;
      type: string;
      direction: string;
      at: Date;
    } | null;
    unreadCount: number;
  } | null;
}

export interface ColumnView {
  stage: StageView;
  count: number;
  totalCents: number;
  hasMore: boolean;
  leads: LeadView[];
}

export interface BoardView {
  funnel: FunnelView;
  preferences: BoardPreferences;
  columns: ColumnView[];
  totalCents: number;
  count: number;
}

export interface ContactFunnelView {
  funnelId: string;
  funnelName: string;
  lineId: string;
  lineName: string;
  stages: StageView[];
  /** null: the contact is not in this funnel. */
  lead: {
    id: string;
    stageId: string;
    amountCents: number;
    archivedAt: Date | null;
    version: number;
  } | null;
}

export type BulkAction = 'move' | 'archive' | 'restore' | 'remove';

const stageView = (stage: StageRecord): StageView => ({
  id: stage.id,
  name: stage.name,
  position: stage.position,
});

function storedSyncRules(
  value: unknown,
  stageIds: readonly string[],
): { status: ChatStatus; stageId: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { status, stageId } = item as Record<string, unknown>;
    return CHAT_STATUSES.includes(status as ChatStatus) &&
      typeof stageId === 'string' &&
      stageIds.includes(stageId)
      ? [{ status: status as ChatStatus, stageId }]
      : [];
  });
}

/**
 * Funnels ("Embudos"): Kanban boards of the contacts of a line. Every read
 * and change goes through the same checks: the plan includes funnels, the
 * member sees the funnel's line, and only the stages "Privilegios del
 * embudo" lets them see.
 */
@Injectable()
export class FunnelsService {
  constructor(
    private readonly store: FunnelsStore,
    private readonly leads: LeadsStore,
    private readonly lines: ChannelsStore,
    private readonly contacts: ContactsStore,
    private readonly conversations: InboxStore,
    private readonly inbox: InboxService,
    private readonly timeline: ConversationTimeline,
    private readonly events: InboxEvents,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ─────────────────────────── Funnels ───────────────────────────

  async list(actor: FunnelActor): Promise<FunnelSummary[]> {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    const scope = await this.scope(actor);
    const funnels = (await this.store.list(workspaceId)).filter((funnel) =>
      this.seesLine(funnel, scope),
    );
    const counts = await this.leads.countByFunnel(
      workspaceId,
      funnels.map((funnel) => funnel.id),
    );
    return funnels.map((funnel) =>
      this.summary(funnel, counts.get(funnel.id) ?? 0),
    );
  }

  async get(actor: FunnelActor, funnelId: string): Promise<FunnelView> {
    const { funnel, stageIds } = await this.open(actor, funnelId);
    const counts = await this.leads.countByFunnel(actor.access.workspaceId, [
      funnel.id,
    ]);
    return this.view(funnel, stageIds, counts.get(funnel.id) ?? 0);
  }

  async create(
    actor: FunnelActor,
    input: {
      lineId: string;
      name: string;
      description?: string;
      isPrimary?: boolean;
      defaultStages?: boolean;
      archiveAfterDays?: number | null;
    },
  ): Promise<FunnelView> {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    await this.assertLine(workspaceId, input.lineId);
    await this.assertNameFree(workspaceId, input.lineId, input.name);
    const funnel = await this.store.create(workspaceId, {
      lineId: input.lineId,
      name: input.name,
      description: input.description ?? '',
      isPrimary: input.isPrimary ?? false,
      archiveAfterDays: input.archiveAfterDays ?? null,
      stages: input.defaultStages ? DEFAULT_STAGES : [],
      createdByUserId: actor.userId,
    });
    await this.record('funnels.funnel.created', actor, funnel.id, {
      lineId: funnel.lineId,
      isPrimary: funnel.isPrimary,
      stages: funnel.stages.length,
    });
    this.changed(workspaceId, funnel.id);
    return this.view(
      funnel,
      funnel.stages.map((stage) => stage.id),
    );
  }

  async update(
    actor: FunnelActor,
    funnelId: string,
    changes: {
      name?: string;
      description?: string;
      lineId?: string;
      isPrimary?: boolean;
      archiveAfterDays?: number | null;
    },
  ): Promise<FunnelView> {
    const { workspaceId } = actor.access;
    const { funnel } = await this.open(actor, funnelId);
    const lineId = changes.lineId ?? funnel.lineId;
    if (lineId !== funnel.lineId) {
      await this.assertLine(workspaceId, lineId);
      // Leads point to chats of the old line: never moved silently.
      const leads = await this.leads.countFunnel(workspaceId, funnel.id);
      if (leads > 0) throw FunnelsErrors.funnelHasLeads(leads);
    }
    if (
      (changes.name !== undefined && !sameName(changes.name, funnel.name)) ||
      lineId !== funnel.lineId
    ) {
      await this.assertNameFree(
        workspaceId,
        lineId,
        changes.name ?? funnel.name,
        funnel.id,
      );
    }
    const updated = await this.store.update(workspaceId, funnel.id, changes);
    if (!updated) throw FunnelsErrors.funnelNotFound();
    await this.record('funnels.funnel.updated', actor, funnel.id, {
      changed: Object.keys(changes),
    });
    this.changed(workspaceId, funnel.id);
    return this.view(
      updated,
      updated.stages.map((stage) => stage.id),
    );
  }

  /** The funnel and its leads; never the contacts or their chats. */
  async remove(
    actor: FunnelActor,
    funnelId: string,
    confirm: boolean,
  ): Promise<void> {
    const { workspaceId } = actor.access;
    const { funnel } = await this.open(actor, funnelId);
    const leads = await this.leads.countFunnel(workspaceId, funnel.id);
    if (leads > 0 && !confirm) throw FunnelsErrors.funnelHasLeads(leads);
    if (!(await this.store.remove(workspaceId, funnel.id))) {
      throw FunnelsErrors.funnelNotFound();
    }
    const removed = await this.leads.removeFunnel(workspaceId, funnel.id);
    await this.record('funnels.funnel.deleted', actor, funnel.id, {
      name: funnel.name,
      leads: removed,
    });
    this.changed(workspaceId, funnel.id);
  }

  // ─────────────────────────── Stages ───────────────────────────

  async addStage(
    actor: FunnelActor,
    funnelId: string,
    name: string,
  ): Promise<FunnelView> {
    const { funnel } = await this.open(actor, funnelId);
    if (funnel.stages.length >= FUNNEL_LIMITS.stages) {
      throw FunnelsErrors.stageLimit(FUNNEL_LIMITS.stages);
    }
    const stage = await this.store.addStage(funnel.id, name);
    await this.record('funnels.stage.created', actor, funnel.id, {
      stageId: stage.id,
      name,
    });
    return this.reloaded(actor, funnel.id);
  }

  async renameStage(
    actor: FunnelActor,
    funnelId: string,
    stageId: string,
    name: string,
  ): Promise<FunnelView> {
    const { funnel } = await this.open(actor, funnelId);
    const before = this.stage(funnel, stageId);
    await this.store.renameStage(funnel.id, stageId, name);
    await this.record('funnels.stage.renamed', actor, funnel.id, {
      stageId,
      from: before.name,
      to: name,
    });
    return this.reloaded(actor, funnel.id);
  }

  /** The order of the columns; the leads stay in their stages. */
  async reorderStages(
    actor: FunnelActor,
    funnelId: string,
    stageIds: string[],
  ): Promise<FunnelView> {
    const { funnel } = await this.open(actor, funnelId);
    const current = funnel.stages.map((stage) => stage.id);
    if (
      stageIds.length !== current.length ||
      new Set(stageIds).size !== stageIds.length ||
      stageIds.some((id) => !current.includes(id))
    ) {
      throw FunnelsErrors.stageOrderInvalid();
    }
    await this.store.reorderStages(funnel.id, stageIds);
    await this.record('funnels.stage.reordered', actor, funnel.id, {
      stageIds,
    });
    return this.reloaded(actor, funnel.id);
  }

  /** A stage with leads needs `moveTo`: they go there first. */
  async removeStage(
    actor: FunnelActor,
    funnelId: string,
    stageId: string,
    moveTo: string | undefined,
  ): Promise<FunnelView> {
    const { workspaceId } = actor.access;
    const { funnel } = await this.open(actor, funnelId);
    const stage = this.stage(funnel, stageId);
    if (funnel.stages.length === 1) throw FunnelsErrors.lastStage();
    const leads = await this.leads.countStage(workspaceId, funnel.id, stageId);
    let moved = 0;
    if (leads > 0) {
      if (!moveTo) throw FunnelsErrors.stageHasLeads(leads);
      if (moveTo === stageId) throw FunnelsErrors.stageNotFound();
      this.stage(funnel, moveTo);
      moved = await this.leads.moveStage(
        workspaceId,
        funnel.id,
        stageId,
        moveTo,
      );
    }
    await this.store.removeStage(funnel.id, stageId);
    await this.record('funnels.stage.deleted', actor, funnel.id, {
      stageId,
      name: stage.name,
      movedTo: leads > 0 ? (moveTo ?? null) : null,
      leads: moved,
    });
    return this.reloaded(actor, funnel.id);
  }

  // ─────────────────────────── Board ───────────────────────────

  async board(
    actor: FunnelActor,
    funnelId: string,
    filters: BoardFilters,
  ): Promise<BoardView> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    const [columns, preferences] = await Promise.all([
      this.leads.board(
        workspaceId,
        { funnelId: funnel.id, lineId: funnel.lineId, stageIds },
        filters,
        FUNNEL_LIMITS.pageSize,
      ),
      this.store.preferences(actor.userId, funnel.id),
    ]);
    const stages = new Map(funnel.stages.map((stage) => [stage.id, stage]));
    const views = columns.flatMap((column) => {
      const stage = stages.get(column.stageId);
      return stage
        ? [
            {
              stage: stageView(stage),
              count: column.count,
              totalCents: column.totalCents,
              hasMore: column.hasMore,
              leads: column.leads.map((lead) => this.leadView(lead, scope)),
            },
          ]
        : [];
    });
    return {
      funnel: this.view(funnel, stageIds),
      preferences,
      columns: views,
      totalCents: views.reduce((sum, column) => sum + column.totalCents, 0),
      count: views.reduce((sum, column) => sum + column.count, 0),
    };
  }

  /** "Cargar más" of one column. */
  async stageLeads(
    actor: FunnelActor,
    funnelId: string,
    stageId: string,
    filters: BoardFilters,
    offset: number,
  ): Promise<{ leads: LeadView[]; hasMore: boolean }> {
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    this.visibleStage(funnel, stageIds, stageId);
    const page = await this.leads.page(
      actor.access.workspaceId,
      { funnelId: funnel.id, lineId: funnel.lineId, stageIds },
      stageId,
      filters,
      offset,
      FUNNEL_LIMITS.pageSize,
    );
    return {
      leads: page.leads.map((lead) => this.leadView(lead, scope)),
      hasMore: page.hasMore,
    };
  }

  async preferences(
    actor: FunnelActor,
    funnelId: string,
  ): Promise<BoardPreferences> {
    const { funnel } = await this.open(actor, funnelId);
    return this.store.preferences(actor.userId, funnel.id);
  }

  async setPreferences(
    actor: FunnelActor,
    funnelId: string,
    preferences: BoardPreferences,
  ): Promise<BoardPreferences> {
    const { funnel } = await this.open(actor, funnelId);
    return this.store.setPreferences(actor.userId, funnel.id, preferences);
  }

  // ─────────────────────────── Leads ───────────────────────────

  async addLead(
    actor: FunnelActor,
    funnelId: string,
    contactId: string,
    stageId: string,
  ): Promise<LeadView> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    this.visibleStage(funnel, stageIds, stageId);
    const contact = await this.contacts.findContact(workspaceId, contactId);
    if (!contact) throw FunnelsErrors.contactNotFound();
    const { lead, created } = await this.leads.insert(workspaceId, {
      funnelId: funnel.id,
      lineId: funnel.lineId,
      stageId,
      contactId: contact.id,
      activityAt: contact.lastMessageAt ?? this.clock.now(),
      createdBy: actor.userId,
    });
    if (!created) {
      throw FunnelsErrors.leadExists({
        leadId: lead.id,
        stageId: lead.stageId,
      });
    }
    await this.afterPlaced(
      funnel,
      lead,
      null,
      'manual',
      await this.mover(actor),
    );
    await this.record('funnels.lead.added', actor, funnel.id, {
      leadId: lead.id,
      contactId: contact.id,
      stageId,
    });
    return this.leadView(await this.card(funnel, lead), scope);
  }

  async moveLead(
    actor: FunnelActor,
    funnelId: string,
    leadId: string,
    stageId: string,
    version?: number,
  ): Promise<LeadView> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    const lead = await this.visibleLead(funnel, stageIds, leadId, workspaceId);
    this.visibleStage(funnel, stageIds, stageId);
    if (lead.stageId === stageId) {
      return this.leadView(await this.card(funnel, lead), scope);
    }
    const moved = this.written(
      await this.leads.move(workspaceId, lead.id, stageId, version),
    );
    await this.afterPlaced(
      funnel,
      moved,
      lead.stageId,
      'manual',
      await this.mover(actor),
    );
    await this.record('funnels.lead.moved', actor, funnel.id, {
      leadId: lead.id,
      from: lead.stageId,
      to: stageId,
      source: 'manual',
    });
    return this.leadView(await this.card(funnel, moved), scope);
  }

  async setAmount(
    actor: FunnelActor,
    funnelId: string,
    leadId: string,
    amountCents: number,
    version?: number,
  ): Promise<LeadView> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    const lead = await this.visibleLead(funnel, stageIds, leadId, workspaceId);
    const updated = this.written(
      await this.leads.setAmount(workspaceId, lead.id, amountCents, version),
    );
    await this.record('funnels.lead.amount_changed', actor, funnel.id, {
      leadId: lead.id,
      from: lead.amountCents,
      to: amountCents,
    });
    this.changed(workspaceId, funnel.id);
    return this.leadView(await this.card(funnel, updated), scope);
  }

  async archiveLead(
    actor: FunnelActor,
    funnelId: string,
    leadId: string,
    archived: boolean,
  ): Promise<LeadView> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds, scope } = await this.open(actor, funnelId);
    const lead = await this.visibleLead(funnel, stageIds, leadId, workspaceId);
    const updated = await this.leads.setArchived(
      workspaceId,
      lead.id,
      archived ? { at: this.clock.now(), by: await this.mover(actor) } : null,
    );
    if (!updated) throw FunnelsErrors.leadNotFound();
    await this.record(
      archived ? 'funnels.lead.archived' : 'funnels.lead.restored',
      actor,
      funnel.id,
      { leadId: lead.id },
    );
    this.changed(workspaceId, funnel.id);
    return this.leadView(await this.card(funnel, updated), scope);
  }

  /** Out of the funnel; the contact and its chat stay. */
  async removeLead(
    actor: FunnelActor,
    funnelId: string,
    leadId: string,
  ): Promise<void> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds } = await this.open(actor, funnelId);
    const lead = await this.visibleLead(funnel, stageIds, leadId, workspaceId);
    await this.leads.remove(workspaceId, lead.id);
    await this.record('funnels.lead.removed', actor, funnel.id, {
      leadId: lead.id,
      contactId: lead.contactId,
    });
    this.changed(workspaceId, funnel.id);
  }

  /** "Seleccionar leads" / "Seleccionar toda la etapa" and an action for all of them. */
  async bulk(
    actor: FunnelActor,
    funnelId: string,
    input: {
      action: BulkAction;
      leadIds?: string[];
      stageId?: string;
      archived?: boolean;
      moveTo?: string;
    },
  ): Promise<{ affected: number }> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds } = await this.open(actor, funnelId);
    let leadIds: string[];
    if (input.stageId) {
      this.visibleStage(funnel, stageIds, input.stageId);
      const all = await this.leads.all(
        workspaceId,
        {
          funnelId: funnel.id,
          lineId: funnel.lineId,
          stageIds: [input.stageId],
        },
        { archived: input.archived ?? false },
        FUNNEL_LIMITS.exportRows,
      );
      leadIds = all.map((lead) => lead.id);
    } else {
      const found = await this.leads.existing(
        workspaceId,
        funnel.id,
        input.leadIds ?? [],
        stageIds,
      );
      leadIds = found.map((lead) => lead.id);
    }
    if (leadIds.length === 0) return { affected: 0 };
    let affected: number;
    switch (input.action) {
      case 'move': {
        if (!input.moveTo) throw FunnelsErrors.stageNotFound();
        this.visibleStage(funnel, stageIds, input.moveTo);
        affected = await this.leads.moveMany(
          workspaceId,
          funnel.id,
          leadIds,
          input.moveTo,
        );
        break;
      }
      case 'archive':
        affected = await this.leads.archiveMany(
          workspaceId,
          funnel.id,
          leadIds,
          {
            at: this.clock.now(),
            by: await this.mover(actor),
          },
        );
        break;
      case 'restore':
        affected = await this.leads.archiveMany(
          workspaceId,
          funnel.id,
          leadIds,
          null,
        );
        break;
      case 'remove':
        affected = await this.leads.removeMany(workspaceId, funnel.id, leadIds);
        break;
    }
    await this.record(`funnels.lead.bulk_${input.action}`, actor, funnel.id, {
      leads: affected,
      ...(input.moveTo && { to: input.moveTo }),
    });
    this.changed(workspaceId, funnel.id);
    return { affected };
  }

  // ─────────────────────────── From the chat ───────────────────────────

  /** Every funnel the member sees, with the contact's lead in it (if any). */
  async contactFunnels(
    actor: FunnelActor,
    contactId: string,
  ): Promise<ContactFunnelView[]> {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    const scope = await this.scope(actor);
    const [funnels, leads] = await Promise.all([
      this.store.list(workspaceId),
      this.leads.ofContact(workspaceId, contactId),
    ]);
    const byFunnel = new Map(leads.map((lead) => [lead.funnelId, lead]));
    const views: ContactFunnelView[] = [];
    for (const funnel of funnels) {
      if (!this.seesLine(funnel, scope)) continue;
      const stageIds = await this.stagesFor(actor, funnel);
      const lead = byFunnel.get(funnel.id);
      const visible = !lead || stageIds.includes(lead.stageId);
      views.push({
        funnelId: funnel.id,
        funnelName: funnel.name,
        lineId: funnel.lineId,
        lineName: funnel.lineName,
        stages: funnel.stages
          .filter((stage) => stageIds.includes(stage.id))
          .map(stageView),
        lead:
          lead && visible
            ? {
                id: lead.id,
                stageId: lead.stageId,
                amountCents: lead.amountCents,
                archivedAt: lead.archivedAt,
                version: lead.version,
              }
            : null,
      });
    }
    return views;
  }

  /** "Selección de etapas del embudo" from the chat: adds or moves the contact. */
  async setContactStage(
    actor: FunnelActor,
    contactId: string,
    funnelId: string,
    stageId: string,
  ): Promise<ContactFunnelView[]> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds } = await this.open(actor, funnelId);
    this.visibleStage(funnel, stageIds, stageId);
    const existing = await this.leads.findByContact(
      workspaceId,
      funnel.id,
      contactId,
    );
    if (existing) {
      await this.moveLead(actor, funnel.id, existing.id, stageId);
    } else {
      await this.addLead(actor, funnel.id, contactId, stageId);
    }
    return this.contactFunnels(actor, contactId);
  }

  // ─────────────────────────── Privileges ───────────────────────────

  async permissions(actor: FunnelActor, funnelId: string) {
    const { funnel } = await this.open(actor, funnelId);
    const [members, access] = await Promise.all([
      this.store.activeMembers(actor.access.workspaceId),
      this.store.stageAccess(funnel.id),
    ]);
    return {
      stages: funnel.stages.map(stageView),
      members: members.map((member) => ({
        membershipId: member.membershipId,
        name: member.name,
        stageIds: access
          .filter((row) => row.membershipId === member.membershipId)
          .map((row) => row.stageId),
      })),
    };
  }

  /** Replaces every privilege of the funnel; a member without stages sees all of them. */
  async setPermissions(
    actor: FunnelActor,
    funnelId: string,
    members: { membershipId: string; stageIds: string[] }[],
  ) {
    const { funnel } = await this.open(actor, funnelId);
    const active = new Set(
      (await this.store.activeMembers(actor.access.workspaceId)).map(
        (member) => member.membershipId,
      ),
    );
    const stageIds = new Set(funnel.stages.map((stage) => stage.id));
    if (
      new Set(members.map((member) => member.membershipId)).size !==
        members.length ||
      members.some(
        (member) =>
          !active.has(member.membershipId) ||
          member.stageIds.some((id) => !stageIds.has(id)),
      )
    ) {
      throw FunnelsErrors.membersInvalid();
    }
    await this.store.setStageAccess(funnel.id, members);
    await this.record('funnels.permissions.changed', actor, funnel.id, {
      members: members.filter((member) => member.stageIds.length > 0).length,
    });
    this.changed(actor.access.workspaceId, funnel.id);
    return this.permissions(actor, funnel.id);
  }

  // ─────────────────────────── Sync ───────────────────────────

  /**
   * "Sincronizar contactos": chats of the line in each status become leads
   * of the stage. Contacts already in the funnel keep their stage, so
   * running it twice adds nothing.
   */
  async sync(
    actor: FunnelActor,
    funnelId: string,
    rules: { status: ChatStatus; stageId: string }[],
  ): Promise<{ created: number; skipped: number; failed: number }> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds } = await this.open(actor, funnelId);
    if (rules.length === 0) throw FunnelsErrors.rulesInvalid('add a rule');
    if (new Set(rules.map((rule) => rule.status)).size !== rules.length) {
      throw FunnelsErrors.rulesInvalid('one rule per chat status');
    }
    for (const rule of rules) this.visibleStage(funnel, stageIds, rule.stageId);

    const result = { created: 0, skipped: 0, failed: 0 };
    const everything: InboxScope = {
      membershipId: '',
      viewAll: true,
      lineIds: [],
    };
    for (const rule of rules) {
      let cursor: string | undefined;
      do {
        const page = await this.conversations.listConversations(workspaceId, {
          scope: everything,
          view: 'all',
          status: rule.status,
          lineId: funnel.lineId,
          cursor,
          limit: 100,
        });
        for (const conversation of page.items) {
          try {
            const { created } = await this.leads.insert(workspaceId, {
              funnelId: funnel.id,
              lineId: funnel.lineId,
              stageId: rule.stageId,
              contactId: conversation.contactId,
              activityAt: conversation.lastActivityAt,
              createdBy: actor.userId,
            });
            if (created) result.created += 1;
            else result.skipped += 1;
          } catch {
            result.failed += 1;
          }
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    await this.store.update(workspaceId, funnel.id, { syncRules: rules });
    await this.record('funnels.sync.run', actor, funnel.id, {
      rules,
      ...result,
    });
    this.changed(workspaceId, funnel.id);
    return result;
  }

  // ─────────────────────────── Export ───────────────────────────

  async exportCsv(
    actor: FunnelActor,
    funnelId: string,
    filters: BoardFilters,
  ): Promise<{ filename: string; content: string }> {
    const { workspaceId } = actor.access;
    const { funnel, stageIds } = await this.open(actor, funnelId);
    const [leads, tags] = await Promise.all([
      this.leads.all(
        workspaceId,
        { funnelId: funnel.id, lineId: funnel.lineId, stageIds },
        filters,
        FUNNEL_LIMITS.exportRows + 1,
      ),
      this.contacts.listTags(workspaceId),
    ]);
    if (leads.length > FUNNEL_LIMITS.exportRows) {
      throw FunnelsErrors.exportTooLarge(FUNNEL_LIMITS.exportRows);
    }
    const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
    const position = new Map(stageIds.map((id, index) => [id, index]));
    const stageNames = new Map(
      funnel.stages.map((stage) => [stage.id, stage.name]),
    );
    const rows = [...leads]
      .sort(
        (a, b) =>
          (position.get(a.stageId) ?? 0) - (position.get(b.stageId) ?? 0),
      )
      .map((lead) => [
        lead.contact?.name ?? '',
        lead.contact?.phone ?? '',
        funnel.name,
        stageNames.get(lead.stageId) ?? '',
        centsToText(lead.amountCents),
        lead.conversation?.assignee?.name ?? '',
        (lead.contact?.tagIds ?? [])
          .flatMap((id) => tagNames.get(id) ?? [])
          .join('; '),
        lead.conversation ? STATUS_LABELS[lead.conversation.status] : '',
        lead.archivedAt ? 'Sí' : 'No',
        lead.createdAt.toISOString(),
        lead.activityAt.toISOString(),
      ]);
    await this.record('funnels.funnel.exported', actor, funnel.id, {
      leads: rows.length,
    });
    const day = this.clock.now().toISOString().slice(0, 10);
    return {
      filename: `embudo-${funnel.id}-${day}.csv`,
      content: csvDocument(
        [
          'Nombre',
          'Teléfono',
          'Embudo',
          'Etapa',
          'Valor',
          'Agente',
          'Etiquetas',
          'Estado del chat',
          'Archivado',
          'Creado',
          'Última actividad',
        ],
        rows,
      ),
    };
  }

  // ─────────────────────────── Automation rules ───────────────────────────

  async automationRules(actor: FunnelActor, lineId: string) {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    const line = await this.lines.findLine(workspaceId, lineId);
    if (!line) throw FunnelsErrors.lineNotFound();
    return this.store.rules(workspaceId, lineId);
  }

  /** "Automatización de chat con embudos" of a line: one rule per chat status. */
  async setAutomationRules(
    actor: FunnelActor,
    lineId: string,
    rules: { status: ChatStatus; funnelId: string; stageId: string }[],
  ) {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    const line = await this.lines.findLine(workspaceId, lineId);
    if (!line) throw FunnelsErrors.lineNotFound();
    if (new Set(rules.map((rule) => rule.status)).size !== rules.length) {
      throw FunnelsErrors.rulesInvalid('one rule per chat status');
    }
    const funnels = new Map(
      (await this.store.list(workspaceId)).map((funnel) => [funnel.id, funnel]),
    );
    for (const rule of rules) {
      const funnel = funnels.get(rule.funnelId);
      if (!funnel || funnel.lineId !== lineId) {
        throw FunnelsErrors.rulesInvalid('the funnel must be of the line');
      }
      if (!funnel.stages.some((stage) => stage.id === rule.stageId)) {
        throw FunnelsErrors.rulesInvalid('the stage must be of the funnel');
      }
    }
    const saved = await this.store.setRules(workspaceId, lineId, rules);
    await this.audit.record({
      action: 'funnels.rules.changed',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'channel_line',
      targetId: lineId,
      context: actor.context,
      metadata: { rules: rules.length },
    });
    return saved;
  }

  // ─────────────────── Automatic (inbox events, chatbots) ───────────────────

  /** A brand-new chat joins the first stage of the line's primary funnel. */
  async onNewConversation(conversation: ConversationRecord): Promise<void> {
    const { workspaceId } = conversation;
    const funnel = await this.store.primaryOfLine(
      workspaceId,
      conversation.lineId,
    );
    const first = funnel?.stages[0];
    if (!funnel || !first || !(await this.included(workspaceId))) return;
    await this.place(
      funnel,
      conversation.contactId,
      first.id,
      'primary',
      null,
      {
        onlyNew: true,
        activityAt: conversation.lastActivityAt,
      },
    );
  }

  /** The chat changed status: the rule of its line moves (or adds) the lead. */
  async onStatusChange(conversation: ConversationRecord): Promise<void> {
    const { workspaceId } = conversation;
    const rule = await this.store.ruleFor(
      workspaceId,
      conversation.lineId,
      conversation.status,
    );
    if (!rule) return;
    const funnel = await this.store.find(workspaceId, rule.funnelId);
    if (
      !funnel ||
      funnel.lineId !== conversation.lineId ||
      !funnel.stages.some((stage) => stage.id === rule.stageId) ||
      !(await this.included(workspaceId))
    ) {
      return;
    }
    await this.place(
      funnel,
      conversation.contactId,
      rule.stageId,
      'automation',
      null,
      {
        activityAt: conversation.lastActivityAt,
        ruleId: rule.id,
      },
    );
  }

  /** The customer wrote: its leads on that line are active again. */
  async onInbound(conversation: ConversationRecord, at: Date): Promise<void> {
    const funnelIds = await this.leads.touch(
      conversation.workspaceId,
      conversation.lineId,
      conversation.contactId,
      at,
    );
    for (const funnelId of funnelIds)
      this.changed(conversation.workspaceId, funnelId);
  }

  /** Archives the leads of funnels with "archivar tras N días sin mensajes". */
  async archiveIdle(): Promise<number> {
    const now = this.clock.now();
    let total = 0;
    for (const funnel of await this.store.withAutoArchive()) {
      const before = new Date(
        now.getTime() - funnel.archiveAfterDays * 86_400_000,
      );
      const archived = await this.leads.archiveIdle(
        funnel.workspaceId,
        funnel.id,
        before,
        now,
      );
      if (archived > 0) this.changed(funnel.workspaceId, funnel.id);
      total += archived;
    }
    return total;
  }

  /**
   * "Establecer contacto en embudos" of a chatbot. The funnel must be of the
   * chat's line. Moving to the stage it is already in changes nothing, so a
   * retried message does not move it twice.
   */
  async setLeadStage(input: {
    conversation: ConversationRecord;
    funnelId: string;
    stageId: string;
    bot: { id: string; name: string };
  }): Promise<void> {
    const { workspaceId, lineId, contactId } = input.conversation;
    const funnel = await this.store.find(workspaceId, input.funnelId);
    if (!funnel || !funnel.stages.some((stage) => stage.id === input.stageId)) {
      throw FunnelsErrors.funnelNotFound();
    }
    if (funnel.lineId !== lineId) throw FunnelsErrors.funnelNotOnLine();
    await this.assertIncluded(workspaceId);
    await this.place(
      funnel,
      contactId,
      input.stageId,
      'chatbot',
      { userId: `bot:${input.bot.id}`, name: input.bot.name, kind: 'bot' },
      { activityAt: input.conversation.lastActivityAt },
    );
  }

  // ─────────────────────────── Internals ───────────────────────────

  /** Adds the contact to the stage, or moves its lead there. */
  private async place(
    funnel: FunnelRecord,
    contactId: string,
    stageId: string,
    source: LeadSource,
    by: Mover,
    options: { onlyNew?: boolean; activityAt: Date; ruleId?: string },
  ): Promise<void> {
    const { workspaceId } = funnel;
    const { lead, created } = await this.leads.insert(workspaceId, {
      funnelId: funnel.id,
      lineId: funnel.lineId,
      stageId,
      contactId,
      activityAt: options.activityAt,
      createdBy: null,
    });
    let placed: LeadRecord = lead;
    let from: string | null = null;
    if (!created) {
      if (options.onlyNew || lead.stageId === stageId) return;
      const moved = await this.leads.move(workspaceId, lead.id, stageId);
      if (!moved || moved === 'changed') return;
      placed = moved;
      from = lead.stageId;
    }
    await this.afterPlaced(funnel, placed, from, source, by);
    await this.audit.record({
      action: created ? 'funnels.lead.added' : 'funnels.lead.moved',
      actorUserId: by && by.kind !== 'bot' ? by.userId : null,
      workspaceId,
      targetType: 'funnel',
      targetId: funnel.id,
      metadata: {
        leadId: placed.id,
        from,
        to: stageId,
        source,
        ...(options.ruleId && { ruleId: options.ruleId }),
      },
    });
  }

  /** The chat history shows the change and open boards refresh. */
  private async afterPlaced(
    funnel: FunnelRecord,
    lead: LeadRecord,
    fromStageId: string | null,
    _source: LeadSource,
    by: Mover,
  ): Promise<void> {
    const names = new Map(funnel.stages.map((stage) => [stage.id, stage.name]));
    const conversation = await this.chatOf(funnel, lead.contactId);
    if (conversation) {
      await this.timeline.record(conversation, {
        kind: 'funnel_stage',
        by,
        from: null,
        to: null,
        funnel: {
          name: funnel.name,
          from: fromStageId ? (names.get(fromStageId) ?? null) : null,
          to: names.get(lead.stageId) ?? '',
        },
      });
    }
    this.changed(funnel.workspaceId, funnel.id);
  }

  private async chatOf(
    funnel: FunnelRecord,
    contactId: string,
  ): Promise<ConversationRecord | null> {
    const chats = await this.conversations.contactConversations(
      funnel.workspaceId,
      contactId,
      50,
    );
    return chats.find((chat) => chat.lineId === funnel.lineId) ?? null;
  }

  private async card(
    funnel: FunnelRecord,
    lead: LeadRecord,
  ): Promise<LeadCard> {
    const [contact, conversation] = await Promise.all([
      this.contacts.findContact(funnel.workspaceId, lead.contactId),
      this.chatOf(funnel, lead.contactId),
    ]);
    return {
      ...lead,
      contact: contact
        ? { name: contact.name, phone: contact.phone, tagIds: contact.tagIds }
        : null,
      conversation: conversation
        ? {
            id: conversation.id,
            status: conversation.status,
            assignee: conversation.assignee,
            lastMessage: conversation.lastMessage
              ? {
                  text: conversation.lastMessage.text,
                  type: conversation.lastMessage.type,
                  direction: conversation.lastMessage.direction,
                  at: conversation.lastMessage.at,
                }
              : null,
            unreadCount: conversation.unreadCount,
            lastActivityAt: conversation.lastActivityAt,
          }
        : null,
    };
  }

  private leadView(lead: LeadCard, scope: InboxScope): LeadView {
    const chat = lead.conversation;
    const visible =
      !!chat && canSee({ lineId: lead.lineId, assignee: chat.assignee }, scope);
    return {
      id: lead.id,
      funnelId: lead.funnelId,
      stageId: lead.stageId,
      contactId: lead.contactId,
      amountCents: lead.amountCents,
      archivedAt: lead.archivedAt,
      archivedBy: lead.archivedBy,
      activityAt: lead.activityAt,
      version: lead.version,
      createdAt: lead.createdAt,
      contact: lead.contact,
      conversation: chat
        ? {
            id: chat.id,
            status: chat.status,
            assignee: chat.assignee
              ? {
                  membershipId: chat.assignee.membershipId,
                  name: chat.assignee.name,
                }
              : null,
            visible,
            lastMessage: visible ? chat.lastMessage : null,
            unreadCount: visible ? chat.unreadCount : 0,
          }
        : null,
    };
  }

  private written(result: LeadWrite): LeadRecord {
    if (result === 'changed') throw FunnelsErrors.leadChanged();
    if (!result) throw FunnelsErrors.leadNotFound();
    return result;
  }

  /** The funnel if the member sees its line, and the stages they see. */
  private async open(actor: FunnelActor, funnelId: string) {
    const { workspaceId } = actor.access;
    await this.assertIncluded(workspaceId);
    const [funnel, scope] = await Promise.all([
      this.store.find(workspaceId, funnelId),
      this.scope(actor),
    ]);
    if (!funnel || !this.seesLine(funnel, scope)) {
      throw FunnelsErrors.funnelNotFound();
    }
    return { funnel, scope, stageIds: await this.stagesFor(actor, funnel) };
  }

  private async stagesFor(
    actor: FunnelActor,
    funnel: FunnelRecord,
  ): Promise<string[]> {
    const manages = actor.access.permissions.has('funnels.manage');
    const allowed = manages
      ? []
      : await this.store.memberStages(funnel.id, actor.access.membershipId);
    return visibleStageIds(
      funnel.stages.map((stage) => stage.id),
      allowed,
      manages,
    );
  }

  private scope(actor: FunnelActor): Promise<InboxScope> {
    return this.inbox.scope({ userId: actor.userId, access: actor.access });
  }

  /** conversations.view_all sees every line; others, the lines they attend. */
  private seesLine(funnel: FunnelRecord, scope: InboxScope): boolean {
    return scope.viewAll || scope.lineIds.includes(funnel.lineId);
  }

  private stage(funnel: FunnelRecord, stageId: string): StageRecord {
    const stage = funnel.stages.find((item) => item.id === stageId);
    if (!stage) throw FunnelsErrors.stageNotFound();
    return stage;
  }

  private visibleStage(
    funnel: FunnelRecord,
    stageIds: readonly string[],
    stageId: string,
  ): StageRecord {
    const stage = this.stage(funnel, stageId);
    if (!stageIds.includes(stageId)) throw FunnelsErrors.stageForbidden();
    return stage;
  }

  /** A lead of this funnel in a stage the member sees (others look missing). */
  private async visibleLead(
    funnel: FunnelRecord,
    stageIds: readonly string[],
    leadId: string,
    workspaceId: string,
  ): Promise<LeadRecord> {
    const lead = await this.leads.find(workspaceId, leadId);
    if (
      !lead ||
      lead.funnelId !== funnel.id ||
      !stageIds.includes(lead.stageId)
    ) {
      throw FunnelsErrors.leadNotFound();
    }
    return lead;
  }

  private async mover(
    actor: FunnelActor,
  ): Promise<{ userId: string; name: string }> {
    const name = await this.store.memberName(
      actor.access.workspaceId,
      actor.access.membershipId,
    );
    return { userId: actor.userId, name: name ?? '' };
  }

  private async reloaded(
    actor: FunnelActor,
    funnelId: string,
  ): Promise<FunnelView> {
    this.changed(actor.access.workspaceId, funnelId);
    return this.get(actor, funnelId);
  }

  private async assertLine(workspaceId: string, lineId: string) {
    const line = await this.lines.findLine(workspaceId, lineId);
    if (!line) throw FunnelsErrors.lineNotFound();
    if (line.status === 'DISABLED') throw FunnelsErrors.lineDisabled();
  }

  private async assertNameFree(
    workspaceId: string,
    lineId: string,
    name: string,
    except?: string,
  ) {
    const funnels = await this.store.list(workspaceId);
    if (
      funnels.some(
        (funnel) =>
          funnel.id !== except &&
          funnel.lineId === lineId &&
          sameName(funnel.name, name),
      )
    ) {
      throw FunnelsErrors.nameTaken();
    }
  }

  private async included(workspaceId: string): Promise<boolean> {
    const plan = await this.entitlements.entitlements(workspaceId);
    return !!plan?.hasFullAccess && plan.features[FEATURE] !== false;
  }

  private async assertIncluded(workspaceId: string) {
    const plan = await this.entitlements.entitlements(workspaceId);
    if (!plan?.hasFullAccess) throw InboxErrors.subscriptionInactive();
    if (plan.features[FEATURE] === false) {
      throw FunnelsErrors.featureNotInPlan({
        feature: FEATURE,
        plan: plan.planName,
      });
    }
  }

  private changed(workspaceId: string, funnelId: string) {
    this.events.signal({
      workspaceId,
      type: 'funnel.changed',
      data: { funnelId },
    });
  }

  private record(
    action: string,
    actor: FunnelActor,
    funnelId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      action,
      actorUserId: actor.userId,
      workspaceId: actor.access.workspaceId,
      targetType: 'funnel',
      targetId: funnelId,
      context: actor.context,
      metadata,
    });
  }

  private summary(funnel: FunnelRecord, leads: number): FunnelSummary {
    return {
      id: funnel.id,
      name: funnel.name,
      description: funnel.description,
      lineId: funnel.lineId,
      lineName: funnel.lineName,
      isPrimary: funnel.isPrimary,
      archiveAfterDays: funnel.archiveAfterDays,
      leads,
      createdAt: funnel.createdAt,
      updatedAt: funnel.updatedAt,
    };
  }

  private view(
    funnel: FunnelRecord,
    stageIds: readonly string[],
    leads = 0,
  ): FunnelView {
    return {
      ...this.summary(funnel, leads),
      stages: funnel.stages
        .filter((stage) => stageIds.includes(stage.id))
        .map(stageView),
      syncRules: storedSyncRules(funnel.syncRules, stageIds),
    };
  }
}
