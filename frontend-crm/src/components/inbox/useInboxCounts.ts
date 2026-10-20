import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '../../auth/usePermissions'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

export function useInboxCounts() {
  const { active } = useActiveWorkspace()
  const { has } = usePermissions()
  const workspaceId = active?.id ?? ''
  return useQuery({
    queryKey: inboxKeys.counts(workspaceId),
    queryFn: ({ signal }) => inboxApi.counts(workspaceId, signal),
    enabled: !!workspaceId && has('messages.read'),
    refetchInterval: 30_000,
  })
}
