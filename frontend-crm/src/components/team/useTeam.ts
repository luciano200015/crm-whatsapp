import { useQuery } from '@tanstack/react-query'
import { useMe } from '../../auth/useMe'
import { teamApi, teamKeys } from '../../lib/api/team'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { useCatalog } from '../billing/useCatalog'

/**
 * What the current user may do in the active workspace's team, from
 * /users/me and the public plan catalog. The API checks everything again.
 */
export function useTeamAccess() {
  const { active } = useActiveWorkspace()
  const { data: me } = useMe()
  const catalog = useCatalog()

  const permissions = new Set(active?.permissions ?? [])
  const plan = catalog.data?.plans.find((p) => p.code === active?.plan?.code)
  const customRolesIncluded =
    plan?.features.find((f) => f.key === 'features.custom_roles')?.value === true

  return {
    workspaceId: active?.id ?? null,
    userId: me?.id ?? null,
    permissions,
    can: (permission: string) => permissions.has(permission),
    planName: active?.plan?.name ?? '',
    /** Trial running or paid: new and reactivated members are allowed. */
    planActive: active?.plan?.hasFullAccess ?? false,
    customRolesIncluded,
  }
}

export function useRoles(workspaceId: string | null) {
  return useQuery({
    queryKey: teamKeys.roles(workspaceId ?? ''),
    queryFn: () => teamApi.roles(workspaceId ?? ''),
    enabled: workspaceId !== null,
  })
}

export function usePermissionCatalog(workspaceId: string | null) {
  return useQuery({
    queryKey: teamKeys.permissions(workspaceId ?? ''),
    queryFn: () => teamApi.permissions(workspaceId ?? ''),
    enabled: workspaceId !== null,
    staleTime: 10 * 60_000,
  })
}
