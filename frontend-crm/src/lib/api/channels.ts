import { apiRequest } from './client'
import type { Line, LineChanges, LineRequest } from './types'

const lines = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/channels/lines`
const line = (workspaceId: string, lineId: string) =>
  `${lines(workspaceId)}/${encodeURIComponent(lineId)}`

export const channelsApi = {
  lines(workspaceId: string) {
    return apiRequest<Line[]>(lines(workspaceId))
  },

  create(workspaceId: string, body: LineRequest) {
    return apiRequest<Line>(lines(workspaceId), { method: 'POST', body })
  },

  update(workspaceId: string, lineId: string, body: LineChanges) {
    return apiRequest<Line>(line(workspaceId, lineId), { method: 'PATCH', body })
  },

  test(workspaceId: string, lineId: string) {
    return apiRequest<Line>(`${line(workspaceId, lineId)}/test`, { method: 'POST' })
  },

  setAgents(workspaceId: string, lineId: string, membershipIds: string[]) {
    return apiRequest<Line>(`${line(workspaceId, lineId)}/agents`, {
      method: 'PUT',
      body: { membershipIds },
    })
  },

  remove(workspaceId: string, lineId: string) {
    return apiRequest<void>(line(workspaceId, lineId), { method: 'DELETE' })
  },
}

export const channelKeys = {
  lines: (workspaceId: string) => ['channels', workspaceId, 'lines'] as const,
}
