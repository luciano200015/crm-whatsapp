import type { PermissionKey } from '../../authorization/domain/permission-catalog';
import { customRoleKey, hasRoomFor, missingPermissions } from './team-rules';

describe('team rules', () => {
  it('derives custom role keys from the name', () => {
    expect(customRoleKey('Supervisor de Ventas')).toBe('supervisor-de-ventas');
    expect(customRoleKey('  Atención Ñandú ')).toBe('atencion-nandu');
    expect(customRoleKey('🙂')).toBe('role');
  });

  it('lists the permissions the actor does not hold', () => {
    const held = new Set<PermissionKey>(['members.read', 'contacts.read']);
    expect(
      missingPermissions(
        ['members.read', 'billing.manage', 'billing.manage'],
        held,
      ),
    ).toEqual(['billing.manage']);
    expect(missingPermissions(['contacts.read'], held)).toEqual([]);
  });

  it('checks plan room, with null as unlimited', () => {
    expect(hasRoomFor(2, 3)).toBe(true);
    expect(hasRoomFor(3, 3)).toBe(false);
    expect(hasRoomFor(500, null)).toBe(true);
  });
});
