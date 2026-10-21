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
  'members.invite': 'Add new members (agents) to the workspace',
  'members.manage': 'Change member roles, deactivate or reactivate members',
  'roles.read': 'View roles and their permissions',
  'roles.manage': 'Create, change and delete custom roles',
  'contacts.read': 'View contacts',
  'contacts.write': 'Create, update and delete contacts and tag them',
  'tags.manage': 'Create, rename and delete contact tags',
  'channels.read': 'View the WhatsApp lines of the workspace',
  'channels.manage':
    'Connect and configure WhatsApp lines, their agents and auto-assignment',
  'messages.read': 'View conversations and messages',
  'messages.send': 'Reply, add notes, close and reopen conversations',
  'conversations.assign': 'Assign or transfer conversations to other agents',
  'conversations.view_all':
    'See every conversation, not only your own and the unassigned ones of your lines',
  'quick_replies.manage':
    'Create, edit and delete the quick replies of the team',
  'billing.read': 'View subscription and invoices',
  'billing.manage': 'Change subscription and payment details',
} as const satisfies Record<string, string>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Modules shown as groups when building a custom role. */
export const PERMISSION_GROUPS = [
  'workspace',
  'members',
  'roles',
  'contacts',
  'tags',
  'channels',
  'messages',
  'conversations',
  'quick_replies',
  'billing',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export function permissionGroup(key: PermissionKey): PermissionGroup {
  return key.split('.')[0] as PermissionGroup;
}

/**
 * Roles shared by every workspace (roles.workspace_id = null), read-only for
 * customers. Workspaces add their own custom roles on top (see the team module).
 */
export const SYSTEM_ROLE_KEYS = ['OWNER', 'ADMIN', 'AGENT'] as const;
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
};

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
