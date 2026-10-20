import { apiRequest } from './client'
import type { CursorPage } from './types'

export interface Assignee {
  membershipId: string
  userId: string
  name: string
}

export interface Conversation {
  id: string
  lineId: string
  lineName: string | null
  contactId: string
  contact: { name: string | null; phone: string }
  status: 'OPEN' | 'CLOSED'
  assignee: Assignee | null
  lastMessage: { text: string | null; type: string; direction: string; at: string } | null
  lastActivityAt: string
  lastInboundAt: string | null
  windowOpen: boolean
  windowExpiresAt: string | null
  unreadCount: number
  createdAt: string
  closedAt: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  direction: 'IN' | 'OUT' | 'NOTE'
  type: string
  text: string | null
  media: {
    id: string
    mimeType: string | null
    caption: string | null
    filename: string | null
  } | null
  status: 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  error: string | null
  sentBy: { userId: string; name: string } | null
  createdAt: string
}

export interface InboxFilter {
  view: 'mine' | 'unassigned' | 'all'
  status: 'OPEN' | 'CLOSED'
  search?: string
  lineId?: string
  contactId?: string
}

export interface InboxOptions {
  lines: { id: string; name: string }[]
  members: Assignee[]
}

export interface AutoAssignmentOptions {
  lines: {
    id: string
    name: string
    status: string
    autoAssign: boolean
    membershipIds: string[]
  }[]
  members: Assignee[]
}

export interface InboxCounts {
  mine: number
  unassigned: number
  all: number
  unread: number
}

export const inboxBase = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/conversations`
const conversationPath = (workspaceId: string, id: string) =>
  `${inboxBase(workspaceId)}/${encodeURIComponent(id)}`
export const inboxKeys = {
  all: (workspaceId: string) => ['inbox', workspaceId] as const,
  counts: (workspaceId: string) => ['inbox', workspaceId, 'counts'] as const,
  conversation: (workspaceId: string, id: string) =>
    ['inbox', workspaceId, 'conversation', id] as const,
  messages: (workspaceId: string, id: string) => ['inbox', workspaceId, 'messages', id] as const,
  options: (workspaceId: string) => ['inbox', workspaceId, 'options'] as const,
  assignment: (workspaceId: string) => ['auto-assignment', workspaceId] as const,
}

export const inboxApi = {
  list(workspaceId: string, filter: InboxFilter, cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ view: filter.view, status: filter.status, limit: '30' })
    for (const key of ['search', 'lineId', 'contactId'] as const) {
      if (filter[key]) query.set(key, filter[key])
    }
    if (cursor) query.set('cursor', cursor)
    return apiRequest<CursorPage<Conversation>>(`${inboxBase(workspaceId)}?${query}`, { signal })
  },
  get(workspaceId: string, id: string, signal?: AbortSignal) {
    return apiRequest<Conversation>(conversationPath(workspaceId, id), { signal })
  },
  messages(workspaceId: string, id: string, cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '50' })
    if (cursor) query.set('cursor', cursor)
    return apiRequest<CursorPage<ChatMessage>>(
      `${conversationPath(workspaceId, id)}/messages?${query}`,
      { signal },
    )
  },
  counts(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<InboxCounts>(`${inboxBase(workspaceId)}/counts`, { signal })
  },
  options(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<InboxOptions>(`${inboxBase(workspaceId)}/options`, { signal })
  },
  assignment(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<AutoAssignmentOptions>(
      `/workspaces/${encodeURIComponent(workspaceId)}/channels/auto-assignment`,
      { signal },
    )
  },
  send(workspaceId: string, id: string, text: string, note: boolean) {
    return apiRequest<ChatMessage>(
      `${conversationPath(workspaceId, id)}/${note ? 'notes' : 'messages'}`,
      { method: 'POST', body: { text } },
    )
  },
  action(
    workspaceId: string,
    id: string,
    action: 'take' | 'read' | 'close' | 'reopen' | 'assign',
    membershipId?: string | null,
  ) {
    return apiRequest<Conversation>(`${conversationPath(workspaceId, id)}/${action}`, {
      method: 'POST',
      ...(action === 'assign' ? { body: { membershipId } } : {}),
    })
  },
}
