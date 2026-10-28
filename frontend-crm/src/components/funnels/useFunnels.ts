import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '../../auth/usePermissions'
import { funnelKeys, funnelsApi } from '../../lib/api/funnels'
import { useWorkspaceId } from '../contacts/useContacts'

/** The funnels you can see (an error when the plan does not include them). */
export function useFunnelList(enabled = true) {
  const workspaceId = useWorkspaceId()
  const { has } = usePermissions()
  return useQuery({
    queryKey: funnelKeys.list(workspaceId),
    queryFn: ({ signal }) => funnelsApi.list(workspaceId, signal),
    enabled: enabled && has('funnels.read'),
    retry: false,
  })
}

/** One funnel with the stages you see ('' asks for nothing). */
export function useFunnel(funnelId: string) {
  const workspaceId = useWorkspaceId()
  return useQuery({
    queryKey: funnelKeys.detail(workspaceId, funnelId),
    queryFn: ({ signal }) => funnelsApi.get(workspaceId, funnelId, signal),
    enabled: funnelId !== '',
    retry: false,
  })
}
