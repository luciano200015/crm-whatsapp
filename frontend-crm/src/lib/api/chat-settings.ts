import { useQuery } from '@tanstack/react-query'
import { apiRequest } from './client'

export type AssignmentMode = 'NONE' | 'LEAST_BUSY' | 'CONTACT_AGENT'
export type SignatureMode = 'AGENT_CHOICE' | 'NEVER' | 'ALWAYS'
export type CloseMessageMode = 'NEVER' | 'ALWAYS' | 'ASK'

/** «Configuración del módulo de chat», as in wasapi. */
export interface ChatSettings {
  assignment: { mode: AssignmentMode; includeAdmins: boolean }
  /** Agents transfer their own chats; off, only who has conversations.assign. */
  transfers: boolean
  signature: SignatureMode
  closeMessage: { mode: CloseMessageMode; text: string }
}

export interface ChatSettingsView extends ChatSettings {
  /** Never saved: each line still uses its own auto-assignment switch. */
  legacyAssignment: boolean
}

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/chat-settings`

export const chatSettingsKeys = {
  all: (workspaceId: string) => ['chat-settings', workspaceId] as const,
}

export const chatSettingsApi = {
  get(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<ChatSettingsView>(path(workspaceId), { signal })
  },
  update(workspaceId: string, body: ChatSettings) {
    return apiRequest<ChatSettingsView>(path(workspaceId), { method: 'PUT', body })
  },
}

export function useChatSettings(workspaceId: string) {
  return useQuery({
    queryKey: chatSettingsKeys.all(workspaceId),
    queryFn: ({ signal }) => chatSettingsApi.get(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60_000,
  })
}
