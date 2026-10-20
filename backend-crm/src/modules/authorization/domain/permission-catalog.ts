/**
 * Single source of truth for permissions and system-role grants.
 *
 * Extending the catalog: add the permission here, grant it in
 * SYSTEM_ROLE_GRANTS if needed, and re-run `npm run db:seed`. Guards check
 * permission keys, never role names, so no authorization logic changes.
 */
export const PERMISSIONS = {
  'workspace.read': 'View workspace details and settings',
  'workspace.update': 'Change workspace name and settings',
  'members.read': 'List workspace members',
  'members.invite': 'Invite new members to the workspace',
  'members.manage': 'Change member roles, deactivate or reactivate members',
  'roles.read': 'View roles and their permissions',
  'roles.manage': 'Create, change and delete custom roles',
  'contacts.read': 'View contacts',
  'contacts.write': 'Create, update and delete contacts',
  'messages.read': 'View conversations and messages',
  'messages.send': 'Send messages',
  'billing.read': 'View subscription and invoices',
  'billing.manage': 'Change subscription and payment details',
} as const satisfies Record<string, string>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const SYSTEM_ROLE_KEYS = ['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

const exceptPermissions = (
  ...excluded: PermissionKey[]
): readonly PermissionKey[] =>
  ALL_PERMISSION_KEYS.filter((key) => !excluded.includes(key));

export const SYSTEM_ROLES: Record<SystemRoleKey, SystemRoleDefinition> = {
  OWNER: {
    name: 'Owner',
    description:
      'Full control of the workspace, including billing and ownership transfer',
    permissions: ALL_PERMISSION_KEYS,
  },
  ADMIN: {
    name: 'Admin',
    description:
      'Manages the workspace and its members, without billing changes',
    permissions: exceptPermissions('roles.manage', 'billing.manage'),
  },
  AGENT: {
    name: 'Agent',
    description: 'Works with contacts and conversations',
    permissions: [
      'workspace.read',
      'members.read',
      'contacts.read',
      'contacts.write',
      'messages.read',
      'messages.send',
    ],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to workspace data',
    permissions: [
      'workspace.read',
      'members.read',
      'contacts.read',
      'messages.read',
    ],
  },
};

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
