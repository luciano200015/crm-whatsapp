import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '../../auth/usePermissions'
import { funnelKeys, funnelsApi } from '../../lib/api/funnels'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
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

/** Lines and members you can see (the inbox's options). */
export function useInboxOptions() {
  const workspaceId = useWorkspaceId()
  const { has } = usePermissions()
  return useQuery({
    queryKey: inboxKeys.options(workspaceId),
    queryFn: ({ signal }) => inboxApi.options(workspaceId, signal),
    enabled: has('messages.read'),
  })
}

/** The contact's funnels you see: those of the chat's line first. */
export function useContactFunnels(workspaceId: string, contactId: string, lineId?: string) {
  const { has } = usePermissions()
  const query = useQuery({
    queryKey: funnelKeys.contact(workspaceId, contactId),
    queryFn: ({ signal }) => funnelsApi.contactFunnels(workspaceId, contactId, signal),
    enabled: has('funnels.read') && !!contactId,
    retry: false,
  })
  const all = query.data ?? []
  return {
    query,
    own: all.filter((funnel) => funnel.lineId === lineId),
    others: all.filter((funnel) => funnel.lineId !== lineId),
  }
}
