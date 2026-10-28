/** Conversation statuses a funnel rule (sync or automation) can start from. */
export const CHAT_STATUSES = ['OPEN', 'ON_HOLD', 'CLOSED'] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];

/** "Crear configuración de etapas por defecto", in this order. */
export const DEFAULT_STAGES = [
  'Nuevo',
  'En atención',
  'Esperando cliente',
  'Cerrado',
] as const;

export const FUNNEL_LIMITS = {
  name: 80,
  description: 300,
  stageName: 40,
  stages: 30,
  /** 100 000 000 000,00: whole cents stay exact in a double. */
  amountCents: 10_000_000_000_000,
  archiveAfterDays: 365,
  /** Leads of each column in the board; the rest with "Cargar más". */
  pageSize: 50,
  /** Larger exports must be filtered first. */
  exportRows: 10_000,
} as const;

/** Where a lead came from or what moved it (audit and timeline). */
export type LeadSource =
  'manual' | 'automation' | 'primary' | 'chatbot' | 'sync';

export type BoardSort = 'recent' | 'value_desc' | 'value_asc';

/**
 * Filters of the board, the stage pages and the export. AND between
 * categories, OR inside each one (any of the agents, any of the tags…).
 */
export interface BoardFilters {
  /** Part of the name or the phone of the contact. */
  search?: string;
  /** Assigned to any of these memberships… */
  agentIds?: string[];
  /** …or to nobody. */
  unassigned?: boolean;
  /** Contact tagged with any of these. */
  tagIds?: string[];
  statuses?: ChatStatus[];
  /** Only archived leads (shown in the stage they were in); otherwise only active ones. */
  archived?: boolean;
  minCents?: number;
  maxCents?: number;
  sort?: BoardSort;
}

/**
 * Stages a member sees. Without rows in "Privilegios del embudo" they see
 * every stage; so do those who manage funnels.
 */
export function visibleStageIds(
  stageIds: readonly string[],
  allowed: readonly string[],
  managesFunnels: boolean,
): string[] {
  if (managesFunnels || allowed.length === 0) return [...stageIds];
  return stageIds.filter((id) => allowed.includes(id));
}

/** The order of the columns: position, then creation. */
export function byPosition<T extends { position: number; createdAt: Date }>(
  a: T,
  b: T,
): number {
  return (
    a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** Names compared without case, accents or extra spaces. */
export function sameName(a: string, b: string): boolean {
  const simple = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  return simple(a) === simple(b);
}

/** 123456 → "1234.56" (plain, for the CSV). */
export function centsToText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(cents);
  return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
