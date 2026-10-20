import { useActiveWorkspace } from '../workspace/active-workspace-context'

/** A permission requirement: every key in `allOf` and at least one in `anyOf`. */
export interface PermissionRule {
  anyOf?: readonly string[]
  allOf?: readonly string[]
}

/**
 * Permissions of the signed-in user in the active workspace, as loaded from
 * /users/me. They only decide what the UI shows: the API checks every request.
 */
export function usePermissions() {
  const { active } = useActiveWorkspace()
  const granted = new Set(active?.permissions ?? [])
  const has = (permission: string) => granted.has(permission)
  const allows = ({ anyOf, allOf }: PermissionRule) =>
    (!allOf || allOf.every(has)) && (!anyOf || anyOf.length === 0 || anyOf.some(has))
  return { granted, has, allows }
}
