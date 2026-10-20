import type { PermissionKey } from '../../authorization/domain/permission-catalog';
import { slugify } from '../../auth/domain/slug';

/** The system role that owns a workspace; there must always be one active. */
export const OWNER_ROLE_KEY = 'OWNER';

/**
 * Key of a custom role, derived from its name. Keys are unique per workspace
 * (roles_workspace_key_key), so "Supervisor" and "supervisor " collide.
 */
export function customRoleKey(name: string): string {
  return slugify(name, 'role');
}

/**
 * Anti-escalation rule: a member may only grant (assign, create or edit a
 * role with) permissions they hold themselves, and may only act on members
 * whose permissions they hold. Returns what is missing.
 */
export function missingPermissions(
  wanted: Iterable<PermissionKey>,
  held: ReadonlySet<PermissionKey>,
): PermissionKey[] {
  return [...new Set(wanted)].filter((permission) => !held.has(permission));
}

/** Plan limit check: null means unlimited. */
export function hasRoomFor(
  activeMembers: number,
  limit: number | null,
): boolean {
  return limit === null || activeMembers < limit;
}
