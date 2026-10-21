import { ApiError } from './errors'
import { apiRequest, apiResponse } from './client'
import type { CursorPage, ErrorResponse } from './types'

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
  /** OPEN: abierto. ON_HOLD: en espera. CLOSED: cerrado. */
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED'
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

export type ConversationEventKind =
  | 'auto_assigned'
  | 'assigned'
  | 'transferred'
  | 'unassigned'
  | 'taken'
  | 'claimed'
  | 'on_hold'
  | 'closed'
  | 'reopened'
  | 'contact_blocked'
  | 'contact_unblocked'

export interface ConversationEvent {
  kind: ConversationEventKind
  by: { userId: string; name: string } | null
  from: { membershipId: string; name: string } | null
  to: { membershipId: string; name: string } | null
}

export interface SharedContact {
  name: string
  phones: { phone: string; waId: string | null; type: string | null }[]
  emails: string[]
  organization: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  /** EVENT: a movement of the conversation, shown centered. */
  direction: 'IN' | 'OUT' | 'NOTE' | 'EVENT'
  type: string
  text: string | null
  media: {
    /** The message id: the file is at …/messages/:id/media. */
    id: string
    mimeType: string | null
    caption: string | null
    filename: string | null
    size?: number | null
  } | null
  location?: {
    latitude: number
    longitude: number
    name: string | null
    address: string | null
  } | null
  /** Shared contact cards (type "contacts"). */
  contacts?: SharedContact[]
  event?: ConversationEvent | null
  status: 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  error: string | null
  sentBy: { userId: string; name: string } | null
  createdAt: string
}

export interface InboxFilter {
  view: 'mine' | 'unassigned' | 'all'
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED' | 'ALL'
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
  onHold: number
  closed: number
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
  media: (workspaceId: string, messageId: string) =>
    ['inbox-media', workspaceId, messageId] as const,
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
  sendMedia(workspaceId: string, id: string, file: File, caption: string | null) {
    const form = new FormData()
    form.set('file', file, file.name)
    if (caption) form.set('caption', caption)
    return apiRequest<ChatMessage>(`${conversationPath(workspaceId, id)}/media`, {
      method: 'POST',
      body: form,
    })
  },
  sendContacts(workspaceId: string, id: string, contacts: { name: string; phone: string }[]) {
    return apiRequest<ChatMessage>(`${conversationPath(workspaceId, id)}/contacts`, {
      method: 'POST',
      body: { contacts },
    })
  },
  /** Sends a message WhatsApp refused again (same message, same content). */
  retry(workspaceId: string, id: string, messageId: string) {
    return apiRequest<ChatMessage>(
      `${conversationPath(workspaceId, id)}/messages/${encodeURIComponent(messageId)}/retry`,
      { method: 'POST' },
    )
  },
  /** The file of a message, downloaded with the session token. */
  async media(
    workspaceId: string,
    conversationId: string,
    messageId: string,
    signal?: AbortSignal,
  ) {
    const response = await apiResponse(
      `${conversationPath(workspaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/media`,
      { accept: '*/*', signal },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ErrorResponse | null
      throw new ApiError(response.status, body)
    }
    return response.blob()
  },
  action(
    workspaceId: string,
    id: string,
    action: 'take' | 'read' | 'unread' | 'hold' | 'close' | 'reopen' | 'assign',
    membershipId?: string | null,
  ) {
    return apiRequest<Conversation>(`${conversationPath(workspaceId, id)}/${action}`, {
      method: 'POST',
      ...(action === 'assign' ? { body: { membershipId } } : {}),
    })
  },
}
