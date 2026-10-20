import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
} from './permission-catalog';

describe('permission catalog', () => {
  it('uses dotted resource.action keys', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('defines every system role', () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual(
      [...SYSTEM_ROLE_KEYS].sort(),
    );
  });

  it('only grants permissions that exist in the catalog', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const permission of role.permissions) {
        expect(isPermissionKey(permission)).toBe(true);
      }
    }
  });

  it('never grants the same permission twice to a role', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('gives OWNER every permission', () => {
    expect([...SYSTEM_ROLES.OWNER.permissions].sort()).toEqual(
      Object.keys(PERMISSIONS).sort(),
    );
  });

  it('keeps billing and role management exclusive to OWNER', () => {
    for (const key of ['ADMIN', 'AGENT', 'VIEWER'] as const) {
      expect(SYSTEM_ROLES[key].permissions).not.toContain('billing.manage');
      expect(SYSTEM_ROLES[key].permissions).not.toContain('roles.manage');
    }
  });

  it('keeps VIEWER read-only', () => {
    for (const permission of SYSTEM_ROLES.VIEWER.permissions) {
      expect(permission.endsWith('.read')).toBe(true);
    }
  });

  it('does not let AGENT invite or manage members', () => {
    expect(SYSTEM_ROLES.AGENT.permissions).not.toContain('members.invite');
    expect(SYSTEM_ROLES.AGENT.permissions).not.toContain('members.manage');
  });

  it('rejects unknown permission keys', () => {
    expect(isPermissionKey('contacts.delete_everything')).toBe(false);
    expect(isPermissionKey('toString')).toBe(false);
  });
});
