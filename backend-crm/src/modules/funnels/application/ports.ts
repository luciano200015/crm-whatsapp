import type { BoardFilters, ChatStatus } from '../domain/funnel-rules';

export interface StageRecord {
  id: string;
  funnelId: string;
  name: string;
  position: number;
  createdAt: Date;
}

/** A funnel as stored (PostgreSQL), with its stages in board order. */
export interface FunnelRecord {
  id: string;
  workspaceId: string;
  lineId: string;
  lineName: string;
  name: string;
  description: string;
  isPrimary: boolean;
  archiveAfterDays: number | null;
  /** Last "Sincronizar contactos" rules: [{ status, stageId }]. */
  syncRules: unknown;
  stages: StageRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FunnelChanges {
  name?: string;
  description?: string;
  lineId?: string;
  isPrimary?: boolean;
  archiveAfterDays?: number | null;
  syncRules?: unknown;
}

export interface AutomationRuleRecord {
  id: string;
  lineId: string;
  status: ChatStatus;
  funnelId: string;
  stageId: string;
}

export interface BoardPreferences {
  showValue: boolean;
  showAgent: boolean;
}

export interface FunnelMember {
  membershipId: string;
  userId: string;
  name: string;
}

/** Funnels, stages, privileges, rules and preferences (PostgreSQL). */
export abstract class FunnelsStore {
  abstract list(workspaceId: string): Promise<FunnelRecord[]>;
  abstract find(
    workspaceId: string,
    funnelId: string,
  ): Promise<FunnelRecord | null>;
  abstract primaryOfLine(
    workspaceId: string,
    lineId: string,
  ): Promise<FunnelRecord | null>;
  /** The funnel and its stages in one transaction; a primary one replaces the previous primary of the line. */
  abstract create(
    workspaceId: string,
    input: {
      lineId: string;
      name: string;
      description: string;
      isPrimary: boolean;
      archiveAfterDays: number | null;
      stages: readonly string[];
      createdByUserId: string | null;
    },
  ): Promise<FunnelRecord>;
  abstract update(
    workspaceId: string,
    funnelId: string,
    changes: FunnelChanges,
  ): Promise<FunnelRecord | null>;
  abstract remove(workspaceId: string, funnelId: string): Promise<boolean>;

  /** Added after the last column. */
  abstract addStage(funnelId: string, name: string): Promise<StageRecord>;
  abstract renameStage(
    funnelId: string,
    stageId: string,
    name: string,
  ): Promise<StageRecord | null>;
  /** `stageIds` is every stage of the funnel in its new order. */
  abstract reorderStages(
    funnelId: string,
    stageIds: readonly string[],
  ): Promise<void>;
  abstract removeStage(funnelId: string, stageId: string): Promise<boolean>;

  abstract stageAccess(
    funnelId: string,
  ): Promise<{ membershipId: string; stageId: string }[]>;
  abstract memberStages(
    funnelId: string,
    membershipId: string,
  ): Promise<string[]>;
  /** Replaces every privilege of the funnel at once. */
  abstract setStageAccess(
    funnelId: string,
    members: { membershipId: string; stageIds: string[] }[],
  ): Promise<void>;
  abstract activeMembers(workspaceId: string): Promise<FunnelMember[]>;
  abstract memberName(
    workspaceId: string,
    membershipId: string,
  ): Promise<string | null>;

  abstract preferences(
    userId: string,
    funnelId: string,
  ): Promise<BoardPreferences>;
  abstract setPreferences(
    userId: string,
    funnelId: string,
    preferences: BoardPreferences,
  ): Promise<BoardPreferences>;

  abstract rules(
    workspaceId: string,
    lineId: string,
  ): Promise<AutomationRuleRecord[]>;
  /** Replaces the rules of a line. */
  abstract setRules(
    workspaceId: string,
    lineId: string,
    rules: { status: ChatStatus; funnelId: string; stageId: string }[],
  ): Promise<AutomationRuleRecord[]>;
  abstract ruleFor(
    workspaceId: string,
    lineId: string,
    status: ChatStatus,
  ): Promise<AutomationRuleRecord | null>;
  /** Funnels that archive idle leads. */
  abstract withAutoArchive(): Promise<
    { id: string; workspaceId: string; archiveAfterDays: number }[]
  >;
}

export interface LeadRecord {
  id: string;
  funnelId: string;
  lineId: string;
  stageId: string;
  contactId: string;
  amountCents: number;
  archivedAt: Date | null;
  archivedBy: { userId: string; name: string } | null;
  activityAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A lead with what its card shows: the contact and its chat on the funnel's line. */
export interface LeadCard extends LeadRecord {
  contact: { name: string | null; phone: string; tagIds: string[] } | null;
  conversation: {
    id: string;
    status: ChatStatus;
    assignee: { membershipId: string; userId: string; name: string } | null;
    lastMessage: {
      text: string | null;
      type: string;
      direction: string;
      at: Date;
    } | null;
    unreadCount: number;
    lastActivityAt: Date;
  } | null;
}

export interface StageColumn {
  stageId: string;
  count: number;
  totalCents: number;
  leads: LeadCard[];
  hasMore: boolean;
}

/** Where to look: the funnel, its line and the stages the member sees. */
export interface BoardScope {
  funnelId: string;
  lineId: string;
  stageIds: string[];
}

export type LeadWrite =
  | LeadRecord
  /** Someone changed it first (older `version`). */
  | 'changed'
  | null;

/** The leads of the funnels (MongoDB). */
export abstract class LeadsStore {
  abstract find(
    workspaceId: string,
    leadId: string,
  ): Promise<LeadRecord | null>;
  abstract findByContact(
    workspaceId: string,
    funnelId: string,
    contactId: string,
  ): Promise<LeadRecord | null>;
  abstract ofContact(
    workspaceId: string,
    contactId: string,
  ): Promise<LeadRecord[]>;
  /** Adds the contact unless it is already in the funnel (then `created: false`). */
  abstract insert(
    workspaceId: string,
    input: {
      funnelId: string;
      lineId: string;
      stageId: string;
      contactId: string;
      activityAt: Date;
      createdBy: string | null;
    },
  ): Promise<{ lead: LeadRecord; created: boolean }>;
  abstract move(
    workspaceId: string,
    leadId: string,
    stageId: string,
    version?: number,
  ): Promise<LeadWrite>;
  abstract setAmount(
    workspaceId: string,
    leadId: string,
    amountCents: number,
    version?: number,
  ): Promise<LeadWrite>;
  abstract setArchived(
    workspaceId: string,
    leadId: string,
    archived: { at: Date; by: { userId: string; name: string } | null } | null,
  ): Promise<LeadRecord | null>;
  abstract remove(workspaceId: string, leadId: string): Promise<boolean>;

  /** Leads of the funnel among `leadIds` that are in `stageIds`. */
  abstract existing(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    stageIds: readonly string[],
  ): Promise<LeadRecord[]>;
  abstract moveMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    stageId: string,
  ): Promise<number>;
  abstract archiveMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    archived: { at: Date; by: { userId: string; name: string } } | null,
  ): Promise<number>;
  abstract removeMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
  ): Promise<number>;
  /** Every lead of a stage goes to another one (before deleting the stage). */
  abstract moveStage(
    workspaceId: string,
    funnelId: string,
    fromStageId: string,
    toStageId: string,
  ): Promise<number>;
  abstract countStage(
    workspaceId: string,
    funnelId: string,
    stageId: string,
  ): Promise<number>;
  /** Active (not archived) leads of each funnel. */
  abstract countByFunnel(
    workspaceId: string,
    funnelIds: readonly string[],
  ): Promise<Map<string, number>>;
  abstract countFunnel(workspaceId: string, funnelId: string): Promise<number>;
  abstract removeFunnel(workspaceId: string, funnelId: string): Promise<number>;

  /** The first page of each column, with counts and totals for the filters. */
  abstract board(
    workspaceId: string,
    scope: BoardScope,
    filters: BoardFilters,
    pageSize: number,
  ): Promise<StageColumn[]>;
  abstract page(
    workspaceId: string,
    scope: BoardScope,
    stageId: string,
    filters: BoardFilters,
    offset: number,
    limit: number,
  ): Promise<{ leads: LeadCard[]; hasMore: boolean }>;
  /** Up to `limit` cards of the visible stages, for the CSV. */
  abstract all(
    workspaceId: string,
    scope: BoardScope,
    filters: BoardFilters,
    limit: number,
  ): Promise<LeadCard[]>;

  /**
   * A message of the contact on the line: the activity of its leads moves
   * on, and those archived for inactivity come back.
   */
  abstract touch(
    workspaceId: string,
    lineId: string,
    contactId: string,
    at: Date,
  ): Promise<string[]>;
  /** Archives the leads idle since before `before`; returns how many. */
  abstract archiveIdle(
    workspaceId: string,
    funnelId: string,
    before: Date,
    at: Date,
  ): Promise<number>;
}
