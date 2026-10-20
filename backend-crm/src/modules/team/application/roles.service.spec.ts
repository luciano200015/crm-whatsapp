import { HttpException } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
} from '../../authorization/domain/permission-catalog';
import { RolesService } from './roles.service';
import {
  actorFor,
  FakeEntitlements,
  FakeTeamStore,
  OTHER_WS,
  WS,
} from './team.fakes';

const OWNER = SYSTEM_ROLES.OWNER.permissions;

function setup(entitlements = new FakeEntitlements('business')) {
  const store = new FakeTeamStore();
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const service = new RolesService(store, entitlements, audit);
  const owner = store.addFake('owner@example.com', 'OWNER');
  return { service, store, owner, actor: actorFor(owner, OWNER) };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await promise.catch((error: HttpException) => {
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('RolesService', () => {
  it('lists the system roles as read-only plus the custom roles of the workspace only', async () => {
    const { service, store } = setup();
    store.addCustomRole('supervisor', ['contacts.read']);
    store.addCustomRole('foreign', ['contacts.read'], OTHER_WS);

    const roles = await service.list(WS);

    expect(roles.map((r) => [r.key, r.system])).toEqual([
      ['OWNER', true],
      ['ADMIN', true],
      ['AGENT', true],
      ['supervisor', false],
    ]);
    expect(roles[0]?.memberCount).toBe(1);
  });

  it('exposes the permission catalog grouped by module', () => {
    const { service } = setup();
    const permissions = service.permissions();
    expect(permissions).toHaveLength(ALL_PERMISSION_KEYS.length);
    expect(permissions).toContainEqual(
      expect.objectContaining({ key: 'members.invite', group: 'members' }),
    );
  });

  it('creates a custom role from existing permissions', async () => {
    const { service, actor } = setup();

    const role = await service.create(actor, {
      name: ' Supervisor de Ventas ',
      description: '  ',
      permissions: ['messages.send', 'contacts.read', 'contacts.read'],
    });

    expect(role).toMatchObject({
      key: 'supervisor-de-ventas',
      name: 'Supervisor de Ventas',
      description: null,
      system: false,
      permissions: ['contacts.read', 'messages.send'],
    });
  });

  it('rejects duplicate names in the same workspace', async () => {
    const { service, actor } = setup();
    await service.create(actor, {
      name: 'Supervisor',
      permissions: ['contacts.read'],
    });
    await expectCode(
      service.create(actor, {
        name: 'supervisor',
        permissions: ['contacts.read'],
      }),
      'ROLE_NAME_TAKEN',
    );
  });

  it('needs a plan with custom roles to create or edit them', async () => {
    const { service, store, actor } = setup(new FakeEntitlements('team'));
    const legacy = store.addCustomRole('legacy', ['contacts.read']);

    await expectCode(
      service.create(actor, { name: 'X', permissions: ['contacts.read'] }),
      'FEATURE_NOT_IN_PLAN',
    );
    await expectCode(
      service.update(actor, legacy.id, { name: 'Y' }),
      'FEATURE_NOT_IN_PLAN',
    );
    // Deleting stays possible after a downgrade.
    await expect(service.remove(actor, legacy.id)).resolves.toBeUndefined();
  });

  it('keeps system roles read-only', async () => {
    const { service, store, actor } = setup();
    const agent = store.roleByKey('AGENT').id;

    await expectCode(
      service.update(actor, agent, { name: 'Hacked' }),
      'SYSTEM_ROLE_READ_ONLY',
    );
    await expectCode(service.remove(actor, agent), 'SYSTEM_ROLE_READ_ONLY');
  });

  it('does not let anyone grant permissions they lack', async () => {
    const { service, store } = setup();
    const manager = store.addCustomRole('manager', [
      'roles.read',
      'roles.manage',
      'contacts.read',
    ]);
    const member = store.addFake('m@example.com', 'manager');
    const actor = actorFor(member, manager.permissions);

    await expect(
      service.create(actor, {
        name: 'Billing',
        permissions: ['contacts.read', 'billing.manage'],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'ROLE_ESCALATION',
        details: { missing: ['billing.manage'] },
      },
    });
  });

  it('refuses to delete a role that members still have', async () => {
    const { service, store, actor } = setup();
    const role = store.addCustomRole('support', ['contacts.read']);
    store.addFake('s@example.com', 'support');

    await expect(service.remove(actor, role.id)).rejects.toMatchObject({
      response: { code: 'ROLE_IN_USE', details: { members: 1 } },
    });
  });

  it('never touches a custom role of another workspace', async () => {
    const { service, store, actor } = setup();
    const foreign = store.addCustomRole('foreign', ['contacts.read'], OTHER_WS);

    await expectCode(service.get(WS, foreign.id), 'ROLE_NOT_FOUND');
    await expectCode(service.remove(actor, foreign.id), 'ROLE_NOT_FOUND');
  });
});
