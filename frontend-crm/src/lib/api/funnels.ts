import { apiRequest, apiResponse } from './client'
import { ApiError } from './errors'
import type { ErrorResponse } from './types'

/** Conversation statuses a funnel rule starts from. */
export type ChatStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED'
export const CHAT_STATUSES: ChatStatus[] = ['OPEN', 'ON_HOLD', 'CLOSED']

export interface FunnelStage {
  id: string
  name: string
  position: number
}

export interface FunnelSummary {
  id: string
  name: string
  description: string
  lineId: string
  lineName: string
  isPrimary: boolean
  archiveAfterDays: number | null
  /** Active (not archived) leads. */
  leads: number
  createdAt: string
  updatedAt: string
}

export interface Funnel extends FunnelSummary {
  /** The stages you see, in board order. */
  stages: FunnelStage[]
  syncRules: SyncRule[]
}

export interface SyncRule {
  status: ChatStatus
  stageId: string
}

export interface Lead {
  id: string
  funnelId: string
  stageId: string
  contactId: string
  /** "Valor", in cents. */
  amountCents: number
  archivedAt: string | null
  /** null with archivedAt: archived for inactivity. */
  archivedBy: { userId: string; name: string } | null
  activityAt: string
  version: number
  createdAt: string
  contact: { name: string | null; phone: string; tagIds: string[] } | null
  /** The chat of the contact on the funnel's line (null: none yet). */
  conversation: {
    id: string
    status: ChatStatus
    assignee: { membershipId: string; name: string } | null
    /** False for a chat of another agent: no preview, and it does not open. */
    visible: boolean
    lastMessage: { text: string | null; type: string; direction: string; at: string } | null
    unreadCount: number
  } | null
}

export interface BoardColumn {
  stage: FunnelStage
  count: number
  totalCents: number
  hasMore: boolean
  leads: Lead[]
}

export interface BoardPreferences {
  showValue: boolean
  showAgent: boolean
}

export interface Board {
  funnel: Funnel
  preferences: BoardPreferences
  columns: BoardColumn[]
  count: number
  totalCents: number
}

export type BoardSort = 'recent' | 'value_desc' | 'value_asc'

/** Filters of the board: AND between them, OR inside each list. */
export interface BoardFilters {
  search: string
  agentIds: string[]
  unassigned: boolean
  tagIds: string[]
  statuses: ChatStatus[]
  archived: boolean
  minCents: number | null
  maxCents: number | null
  sort: BoardSort
}

export const NO_BOARD_FILTERS: BoardFilters = {
  search: '',
  agentIds: [],
  unassigned: false,
  tagIds: [],
  statuses: [],
  archived: false,
  minCents: null,
  maxCents: null,
  sort: 'recent',
}

export interface ContactFunnel {
  funnelId: string
  funnelName: string
  lineId: string
  lineName: string
  stages: FunnelStage[]
  lead: {
    id: string
    stageId: string
    amountCents: number
    archivedAt: string | null
    version: number
  } | null
}

export interface FunnelPermissions {
  stages: FunnelStage[]
  members: { membershipId: string; name: string; stageIds: string[] }[]
}

export interface AutomationRule {
  id?: string
  status: ChatStatus
  funnelId: string
  stageId: string
}

export interface FunnelInput {
  lineId: string
  name: string
  description: string
  isPrimary: boolean
  archiveAfterDays: number | null
}

export type BulkAction = 'move' | 'archive' | 'restore' | 'remove'

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/funnels`
const one = (workspaceId: string, id: string) => `${base(workspaceId)}/${encodeURIComponent(id)}`

export const funnelKeys = {
  all: (workspaceId: string) => ['funnels', workspaceId] as const,
  list: (workspaceId: string) => ['funnels', workspaceId, 'list'] as const,
  detail: (workspaceId: string, id: string) => ['funnels', workspaceId, 'detail', id] as const,
  board: (workspaceId: string, id: string, filters: BoardFilters) =>
    ['funnels', workspaceId, 'board', id, filters] as const,
  boards: (workspaceId: string, id: string) => ['funnels', workspaceId, 'board', id] as const,
  contact: (workspaceId: string, contactId: string) =>
    ['funnels', workspaceId, 'contact', contactId] as const,
  permissions: (workspaceId: string, id: string) =>
    ['funnels', workspaceId, 'permissions', id] as const,
  automation: (workspaceId: string, lineId: string) =>
    ['funnels', workspaceId, 'automation', lineId] as const,
}

/** Query string of the filters (only those in use). */
export function filtersQuery(filters: BoardFilters): string {
  const params = new URLSearchParams()
  if (filters.search.trim()) params.set('search', filters.search.trim())
  if (filters.agentIds.length > 0) params.set('agentIds', filters.agentIds.join(','))
  if (filters.unassigned) params.set('unassigned', 'true')
  if (filters.tagIds.length > 0) params.set('tagIds', filters.tagIds.join(','))
  if (filters.statuses.length > 0) params.set('statuses', filters.statuses.join(','))
  if (filters.archived) params.set('archived', 'true')
  if (filters.minCents !== null) params.set('minCents', String(filters.minCents))
  if (filters.maxCents !== null) params.set('maxCents', String(filters.maxCents))
  if (filters.sort !== 'recent') params.set('sort', filters.sort)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const funnelsApi = {
  list(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<FunnelSummary[]>(base(workspaceId), { signal })
  },
  get(workspaceId: string, id: string, signal?: AbortSignal) {
    return apiRequest<Funnel>(one(workspaceId, id), { signal })
  },
  create(workspaceId: string, input: FunnelInput & { defaultStages: boolean }) {
    return apiRequest<Funnel>(base(workspaceId), { method: 'POST', body: input })
  },
  update(workspaceId: string, id: string, changes: Partial<FunnelInput>) {
    return apiRequest<Funnel>(one(workspaceId, id), { method: 'PATCH', body: changes })
  },
  remove(workspaceId: string, id: string, confirm: boolean) {
    return apiRequest<void>(`${one(workspaceId, id)}${confirm ? '?confirm=true' : ''}`, {
      method: 'DELETE',
    })
  },
  addStage(workspaceId: string, id: string, name: string) {
    return apiRequest<Funnel>(`${one(workspaceId, id)}/stages`, {
      method: 'POST',
      body: { name },
    })
  },
  renameStage(workspaceId: string, id: string, stageId: string, name: string) {
    return apiRequest<Funnel>(`${one(workspaceId, id)}/stages/${encodeURIComponent(stageId)}`, {
      method: 'PATCH',
      body: { name },
    })
  },
  reorderStages(workspaceId: string, id: string, stageIds: string[]) {
    return apiRequest<Funnel>(`${one(workspaceId, id)}/stages/order`, {
      method: 'PUT',
      body: { stageIds },
    })
  },
  removeStage(workspaceId: string, id: string, stageId: string, moveTo?: string) {
    const query = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''
    return apiRequest<Funnel>(
      `${one(workspaceId, id)}/stages/${encodeURIComponent(stageId)}${query}`,
      { method: 'DELETE' },
    )
  },
  board(workspaceId: string, id: string, filters: BoardFilters, signal?: AbortSignal) {
    return apiRequest<Board>(`${one(workspaceId, id)}/board${filtersQuery(filters)}`, { signal })
  },
  stageLeads(
    workspaceId: string,
    id: string,
    stageId: string,
    filters: BoardFilters,
    offset: number,
  ) {
    const query = filtersQuery(filters)
    return apiRequest<{ leads: Lead[]; hasMore: boolean }>(
      `${one(workspaceId, id)}/stages/${encodeURIComponent(stageId)}/leads${query}${query ? '&' : '?'}offset=${offset}`,
    )
  },
  addLead(workspaceId: string, id: string, contactId: string, stageId: string) {
    return apiRequest<Lead>(`${one(workspaceId, id)}/leads`, {
      method: 'POST',
      body: { contactId, stageId },
    })
  },
  moveLead(workspaceId: string, id: string, leadId: string, stageId: string, version?: number) {
    return apiRequest<Lead>(`${one(workspaceId, id)}/leads/${encodeURIComponent(leadId)}/stage`, {
      method: 'PATCH',
      body: { stageId, version },
    })
  },
  setAmount(
    workspaceId: string,
    id: string,
    leadId: string,
    amountCents: number,
    version?: number,
  ) {
    return apiRequest<Lead>(`${one(workspaceId, id)}/leads/${encodeURIComponent(leadId)}/amount`, {
      method: 'PATCH',
      body: { amountCents, version },
    })
  },
  archiveLead(workspaceId: string, id: string, leadId: string, archived: boolean) {
    return apiRequest<Lead>(`${one(workspaceId, id)}/leads/${encodeURIComponent(leadId)}/archive`, {
      method: 'PATCH',
      body: { archived },
    })
  },
  removeLead(workspaceId: string, id: string, leadId: string) {
    return apiRequest<void>(`${one(workspaceId, id)}/leads/${encodeURIComponent(leadId)}`, {
      method: 'DELETE',
    })
  },
  bulk(
    workspaceId: string,
    id: string,
    input: {
      action: BulkAction
      leadIds?: string[]
      stageId?: string
      archived?: boolean
      moveTo?: string
    },
  ) {
    return apiRequest<{ affected: number }>(`${one(workspaceId, id)}/leads/bulk`, {
      method: 'POST',
      body: input,
    })
  },
  contactFunnels(workspaceId: string, contactId: string, signal?: AbortSignal) {
    return apiRequest<ContactFunnel[]>(
      `${base(workspaceId)}/contacts/${encodeURIComponent(contactId)}`,
      { signal },
    )
  },
  setContactStage(workspaceId: string, contactId: string, funnelId: string, stageId: string) {
    return apiRequest<ContactFunnel[]>(
      `${base(workspaceId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: 'PUT', body: { funnelId, stageId } },
    )
  },
  permissions(workspaceId: string, id: string, signal?: AbortSignal) {
    return apiRequest<FunnelPermissions>(`${one(workspaceId, id)}/permissions`, { signal })
  },
  setPermissions(
    workspaceId: string,
    id: string,
    members: { membershipId: string; stageIds: string[] }[],
  ) {
    return apiRequest<FunnelPermissions>(`${one(workspaceId, id)}/permissions`, {
      method: 'PUT',
      body: { members },
    })
  },
  sync(workspaceId: string, id: string, rules: SyncRule[]) {
    return apiRequest<{ created: number; skipped: number; failed: number }>(
      `${one(workspaceId, id)}/sync`,
      { method: 'POST', body: { rules } },
    )
  },
  setPreferences(workspaceId: string, id: string, preferences: BoardPreferences) {
    return apiRequest<BoardPreferences>(`${one(workspaceId, id)}/preferences`, {
      method: 'PUT',
      body: preferences,
    })
  },
  async exportCsv(workspaceId: string, id: string, filters: BoardFilters) {
    const response = await apiResponse(
      `${one(workspaceId, id)}/export.csv${filtersQuery(filters)}`,
      {
        accept: 'text/csv',
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ErrorResponse | null
      throw new ApiError(response.status, body)
    }
    return response.blob()
  },
  automation(workspaceId: string, lineId: string, signal?: AbortSignal) {
    return apiRequest<AutomationRule[]>(
      `/workspaces/${encodeURIComponent(workspaceId)}/funnel-automation?lineId=${encodeURIComponent(lineId)}`,
      { signal },
    )
  },
  setAutomation(workspaceId: string, lineId: string, rules: AutomationRule[]) {
    return apiRequest<AutomationRule[]>(
      `/workspaces/${encodeURIComponent(workspaceId)}/funnel-automation?lineId=${encodeURIComponent(lineId)}`,
      {
        method: 'PUT',
        body: {
          rules: rules.map(({ status, funnelId, stageId }) => ({ status, funnelId, stageId })),
        },
      },
    )
  },
}
