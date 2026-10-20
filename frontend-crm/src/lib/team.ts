import { es } from '../i18n/es'
import type { MyRole, Role } from './api/types'

/** Groups in the order they are shown when building a role. */
export const PERMISSION_GROUP_ORDER = [
  'workspace',
  'members',
  'roles',
  'contacts',
  'messages',
  'billing',
] as const

/** System roles are translated by key; custom roles keep the name their workspace gave them. */
export function roleName(role: Pick<MyRole, 'key' | 'name' | 'system'>): string {
  return (role.system ? es.roles.system[role.key]?.name : undefined) ?? role.name
}

export function roleDescription(role: Pick<Role, 'key' | 'description' | 'system'>): string {
  return (
    (role.system ? es.roles.system[role.key]?.description : undefined) ?? role.description ?? ''
  )
}

export function permissionLabel(key: string): string {
  return es.roles.permissions[key] ?? key
}

export function groupLabel(group: string): string {
  return es.roles.groups[group] ?? group
}

/**
 * Mirrors the API's anti-escalation rule so the UI only offers what will be
 * accepted: you can only grant or manage permissions you hold.
 */
export function holdsAll(held: ReadonlySet<string>, wanted: readonly string[]): boolean {
  return wanted.every((permission) => held.has(permission))
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : [parts[0]]
  return letters.map((part) => part?.[0]?.toUpperCase() ?? '').join('') || '?'
}
