import { apiRequest } from './client'
import type { ChatMessage } from './inbox'

export interface QuickReplyAttachment {
  fileId: string
  filename: string
  mimeType: string
  /** Bytes. */
  size: number
}

export interface QuickReply {
  id: string
  /** What agents search and see, e.g. «Lavadoras monstruosas». */
  title: string
  /** Unique key derived from the title. */
  shortcut: string
  text: string
  /** Sent after the text. */
  attachments: QuickReplyAttachment[]
  createdBy: { userId: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface QuickReplyInput {
  title: string
  text: string
  attachmentIds: string[]
}

export const MAX_QUICK_REPLY_ATTACHMENTS = 5

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/quick-replies`

export const quickReplyKeys = {
  all: (workspaceId: string) => ['quick-replies', workspaceId] as const,
}

export const quickRepliesApi = {
  list(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<QuickReply[]>(base(workspaceId), { signal })
  },
  create(workspaceId: string, body: QuickReplyInput) {
    return apiRequest<QuickReply>(base(workspaceId), { method: 'POST', body })
  },
  update(workspaceId: string, id: string, body: Partial<QuickReplyInput>) {
    return apiRequest<QuickReply>(`${base(workspaceId)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    })
  },
  remove(workspaceId: string, id: string) {
    return apiRequest<void>(`${base(workspaceId)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
  /** Stores a file to attach; its fileId goes in attachmentIds. */
  upload(workspaceId: string, file: File) {
    const form = new FormData()
    form.set('file', file, file.name)
    return apiRequest<QuickReplyAttachment>(`${base(workspaceId)}/attachments`, {
      method: 'POST',
      body: form,
    })
  },
  /** Sends the text and then each file in the chat. */
  send(workspaceId: string, conversationId: string, id: string, sign: boolean) {
    return apiRequest<ChatMessage[]>(
      `/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(
        conversationId,
      )}/quick-replies/${encodeURIComponent(id)}`,
      { method: 'POST', body: { sign } },
    )
  },
}

/** Matches the title or the content, ignoring case and accents. */
export function matchesQuickReply(reply: QuickReply, search: string) {
  const plain = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  const wanted = plain(search.trim())
  return !wanted || plain(`${reply.title}\n${reply.text}`).includes(wanted)
}
