import { useQuery } from '@tanstack/react-query'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

/** Id of the active workspace ('' while there is none; queries stay disabled). */
export function useWorkspaceId(): string {
  return useActiveWorkspace().active?.id ?? ''
}

export function useTags() {
  const workspaceId = useWorkspaceId()
  return useQuery({
    queryKey: contactKeys.tags(workspaceId),
    queryFn: () => contactsApi.tags(workspaceId),
    enabled: workspaceId !== '',
  })
}

/** Custom fields of the contacts («Administrar campos personalizados»). */
export function useContactFields(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: contactKeys.fields(workspaceId),
    queryFn: () => contactsApi.fields(workspaceId),
    enabled: enabled && workspaceId !== '',
  })
}
