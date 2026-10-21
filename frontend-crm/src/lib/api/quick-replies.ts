import { apiRequest } from './client'

export interface QuickReply {
  id: string
  /** Typed after "/" in the chat. */
  shortcut: string
  text: string
  createdBy: { userId: string; name: string } | null
  createdAt: string
  updatedAt: string
}

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/quick-replies`

export const quickReplyKeys = {
  all: (workspaceId: string) => ['quick-replies', workspaceId] as const,
}

export const quickRepliesApi = {
  list(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<QuickReply[]>(base(workspaceId), { signal })
  },
  create(workspaceId: string, body: { shortcut: string; text: string }) {
    return apiRequest<QuickReply>(base(workspaceId), { method: 'POST', body })
  },
  update(workspaceId: string, id: string, body: { shortcut?: string; text?: string }) {
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
}
