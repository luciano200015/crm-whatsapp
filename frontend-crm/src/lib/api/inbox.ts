import type { InteractiveContent } from './chatbots'
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
  /** Tags of the contact (ids of the workspace tags). */
  contactTagIds?: string[]
  lastMessage: {
    text: string | null
    type: string
    direction: string
    at: string
    messageId?: string | null
    /** Delivery status of that message, for the ✓✓ in the list. */
    status?: ChatMessage['status'] | null
  } | null
  lastActivityAt: string
  lastInboundAt: string | null
  windowOpen: boolean
  windowExpiresAt: string | null
  unreadCount: number
  createdAt: string
  closedAt: string | null
  /**
   * The chatbot of the line in this chat. paused: an agent turned it off
   * (pausedBy) or it handed the chat to an agent (pausedBy null).
   */
  bot?: {
    state: 'none' | 'active' | 'paused'
    name: string | null
    pausedBy: { userId: string; name: string } | null
  }
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
  | 'bot_paused'
  | 'bot_resumed'
  | 'bot_transferred'
  | 'bot_tagged'

export interface ConversationEvent {
  kind: ConversationEventKind
  /** kind 'bot': a chatbot did it. */
  by: { userId: string; name: string; kind?: 'user' | 'bot' } | null
  from: { membershipId: string; name: string } | null
  to: { membershipId: string; name: string } | null
  /** bot_tagged: names of the tags added and removed. */
  tags?: { added: string[]; removed: string[] } | null
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
  /** Buttons, list or link button sent by a chatbot (type "interactive"). */
  interactive?: InteractiveContent | null
  /** The option the customer tapped (its id and title). */
  reply?: { id: string; title: string } | null
  status: 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  error: string | null
  /** kind 'bot': sent by the line's chatbot. */
  sentBy: { userId: string; name: string; kind?: 'user' | 'bot' } | null
  /** Id this browser gave the message when sending it. */
  clientId?: string | null
  /** Only on a bubble still being sent: the file, shown from memory. */
  localFile?: File
  createdAt: string
}

export interface InboxFilter {
  /** mine: only my chats. all: mine, my agents' and the unassigned ones I can see. */
  view: 'mine' | 'all'
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED' | 'ALL'
  search?: string
  lineId?: string
  contactId?: string
  tagIds?: string[]
  /** Membership ids; 'none' = unassigned (needs conversations.view_all). */
  assigneeIds?: string[]
  /** Last activity from / to (ISO). */
  from?: string
  to?: string
  sort?: 'recent' | 'oldest'
}

export interface InboxOptions {
  /** conversations.view_all: sees the chats of every line. */
  viewAll?: boolean
  /** Lines the user attends; without viewAll, the only chats they see. */
  myLineIds?: string[]
  /** Lines the user sees (every line with viewAll). */
  lines: {
    id: string
    name: string
    displayPhone?: string | null
    status?: string
    /** Color of the line (#rrggbb): frames its chats in the list. */
    color?: string | null
  }[]
  /** Who a chat can be transferred to (with conversations.assign). */
  members: (Assignee & { lineIds?: string[]; viewAll?: boolean })[]
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
  mineOnHold?: number
  mineClosed?: number
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
    for (const key of ['search', 'lineId', 'contactId', 'from', 'to', 'sort'] as const) {
      if (filter[key]) query.set(key, filter[key])
    }
    if (filter.tagIds?.length) query.set('tagIds', filter.tagIds.join(','))
    if (filter.assigneeIds?.length) query.set('assigneeIds', filter.assigneeIds.join(','))
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
  send(workspaceId: string, id: string, text: string, note: boolean, clientId?: string) {
    return apiRequest<ChatMessage>(
      `${conversationPath(workspaceId, id)}/${note ? 'notes' : 'messages'}`,
      { method: 'POST', body: { text, ...(clientId && { clientId }) } },
    )
  },
  sendMedia(
    workspaceId: string,
    id: string,
    file: File,
    caption: string | null,
    clientId?: string,
  ) {
    const form = new FormData()
    form.set('file', file, file.name)
    if (caption) form.set('caption', caption)
    if (clientId) form.set('clientId', clientId)
    return apiRequest<ChatMessage>(`${conversationPath(workspaceId, id)}/media`, {
      method: 'POST',
      body: form,
    })
  },
  sendContacts(
    workspaceId: string,
    id: string,
    contacts: { name: string; phone: string }[],
    clientId?: string,
  ) {
    return apiRequest<ChatMessage>(`${conversationPath(workspaceId, id)}/contacts`, {
      method: 'POST',
      body: { contacts, ...(clientId && { clientId }) },
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
  /** The tags of the chat's contact (contacts.write). */
  setTags(workspaceId: string, id: string, tagIds: string[]) {
    return apiRequest<Conversation>(`${conversationPath(workspaceId, id)}/tags`, {
      method: 'PUT',
      body: { tagIds },
    })
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
  /** Turns the line's chatbot off (or back on) in this chat. */
  bot(workspaceId: string, id: string, action: 'pause' | 'resume') {
    return apiRequest<Conversation>(`${conversationPath(workspaceId, id)}/bot/${action}`, {
      method: 'POST',
    })
  },
}
