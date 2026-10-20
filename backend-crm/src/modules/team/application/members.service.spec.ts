import { HttpException } from '@nestjs/common';
import type { AppConfigService } from '../../../config/app-config.service';
import type { Env } from '../../../config/env.schema';
import type { Mailer, MailMessage } from '../../../shared/mail/mailer';
import type { AuditService } from '../../audit/audit.service';
import type { PasswordHasher } from '../../auth/application/ports';
import { SYSTEM_ROLES } from '../../authorization/domain/permission-catalog';
import { MembersService } from './members.service';
import {
  actorFor,
  FakeEntitlements,
  FakeTeamStore,
  OTHER_WS,
  WS,
} from './team.fakes';

const OWNER = SYSTEM_ROLES.OWNER.permissions;
const ADMIN = SYSTEM_ROLES.ADMIN.permissions;

function setup(entitlements = new FakeEntitlements('business')) {
  const store = new FakeTeamStore();
  const sent: MailMessage[] = [];
  const mailer = {
    send: jest.fn((message: MailMessage) => {
      sent.push(message);
      return Promise.resolve();
    }),
  } as unknown as Mailer;
  const passwords = {
    hash: jest.fn((value: string) => Promise.resolve(`hash:${value}`)),
  } as unknown as PasswordHasher;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const config = {
    get: (key: keyof Env) =>
      key === 'WEB_APP_URL' ? 'http://localhost:5173' : undefined,
  } as unknown as AppConfigService;
  const clock = { now: () => new Date('2026-10-20T12:00:00Z') };
  const service = new MembersService(
    store,
    entitlements,
    passwords,
    mailer,
    audit,
    config,
    clock,
  );
  const owner = store.addFake('owner@example.com', 'OWNER');
  return { service, store, sent, passwords, audit, owner };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await promise.catch((error: HttpException) => {
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('MembersService', () => {
  describe('create', () => {
    it('creates an account with a temporary password and emails it once', async () => {
      const { service, store, sent, passwords, owner } = setup();

      const member = await service.create(actorFor(owner, OWNER), {
        email: ' Carla@Example.com ',
        displayName: ' Carla ',
        roleId: store.roleByKey('AGENT').id,
      });

      expect(member).toMatchObject({
        email: 'carla@example.com',
        status: 'ACTIVE',
        pendingFirstAccess: true,
        role: { key: 'AGENT', system: true },
      });
      const [[temporary]] = (
        passwords.hash as jest.Mock<Promise<string>, [string]>
      ).mock.calls as [[string]];
      expect(temporary).toMatch(/^[A-Za-z0-9]{16}$/);
      await new Promise((resolve) => setImmediate(resolve));
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe('carla@example.com');
      expect(sent[0]?.text).toContain(temporary);
      // The API response never contains the password.
      expect(JSON.stringify(member)).not.toContain(temporary);
    });

    it('adds an existing account without touching its password', async () => {
      const { service, store, sent, passwords, owner } = setup();
      store.users.set('ana@example.com', {
        id: 'user-ana',
        displayName: 'Ana',
      });

      const member = await service.create(actorFor(owner, OWNER), {
        email: 'ana@example.com',
        displayName: 'Whatever',
        roleId: store.roleByKey('AGENT').id,
      });

      expect(member.pendingFirstAccess).toBe(false);
      expect(passwords.hash).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(sent[0]?.subject).toMatch(/added to Acme/);
      expect(sent[0]?.text).not.toMatch(/Temporary password/);
    });

    it('refuses existing and deactivated members', async () => {
      const { service, store, owner } = setup();
      store.addFake('agent@example.com', 'AGENT');
      store.addFake('gone@example.com', 'AGENT', { status: 'DEACTIVATED' });
      const actor = actorFor(owner, OWNER);
      const roleId = store.roleByKey('AGENT').id;

      await expectCode(
        service.create(actor, {
          email: 'agent@example.com',
          displayName: 'A',
          roleId,
        }),
        'MEMBER_ALREADY_EXISTS',
      );
      await expectCode(
        service.create(actor, {
          email: 'gone@example.com',
          displayName: 'G',
          roleId,
        }),
        'MEMBER_DEACTIVATED',
      );
    });

    it('enforces the agent limit of the plan', async () => {
      const { service, store, owner } = setup(new FakeEntitlements('team'));
      store.addFake('a@example.com', 'AGENT');
      store.addFake('b@example.com', 'AGENT');
      // Deactivated members do not count.
      store.addFake('c@example.com', 'AGENT', { status: 'DEACTIVATED' });

      await expect(
        service.create(actorFor(owner, OWNER), {
          email: 'd@example.com',
          displayName: 'D',
          roleId: store.roleByKey('AGENT').id,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'AGENT_LIMIT_REACHED',
          details: { plan: 'Equipo', limit: 3, usage: 3 },
        },
      });
    });

    it('needs an active plan', async () => {
      const { service, store, owner } = setup(
        new FakeEntitlements('business', false),
      );
      await expectCode(
        service.create(actorFor(owner, OWNER), {
          email: 'x@example.com',
          displayName: 'X',
          roleId: store.roleByKey('AGENT').id,
        }),
        'SUBSCRIPTION_INACTIVE',
      );
    });

    it('only assigns custom roles when the plan includes them', async () => {
      const { service, store, owner } = setup(new FakeEntitlements('team'));
      const custom = store.addCustomRole('support', ['contacts.read']);

      await expectCode(
        service.create(actorFor(owner, OWNER), {
          email: 'x@example.com',
          displayName: 'X',
          roleId: custom.id,
        }),
        'FEATURE_NOT_IN_PLAN',
      );
    });

    it('never uses a custom role of another workspace', async () => {
      const { service, store, owner } = setup();
      const foreign = store.addCustomRole('spy', ['contacts.read'], OTHER_WS);

      await expectCode(
        service.create(actorFor(owner, OWNER), {
          email: 'x@example.com',
          displayName: 'X',
          roleId: foreign.id,
        }),
        'ROLE_NOT_FOUND',
      );
    });

    it('does not let an admin grant the owner role', async () => {
      const { service, store } = setup();
      const admin = store.addFake('admin@example.com', 'ADMIN');

      await expect(
        service.create(actorFor(admin, ADMIN), {
          email: 'x@example.com',
          displayName: 'X',
          roleId: store.roleByKey('OWNER').id,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'ROLE_ESCALATION',
          details: { missing: ['roles.manage', 'billing.manage'] },
        },
      });
    });
  });

  describe('changeRole', () => {
    it('replaces the role of a member', async () => {
      const { service, store, owner } = setup();
      const agent = store.addFake('agent@example.com', 'AGENT');

      const updated = await service.changeRole(
        actorFor(owner, OWNER),
        agent.id,
        store.roleByKey('ADMIN').id,
      );
      expect(updated.role?.key).toBe('ADMIN');
    });

    it('refuses to change your own role', async () => {
      const { service, store, owner } = setup();
      await expectCode(
        service.changeRole(
          actorFor(owner, OWNER),
          owner.id,
          store.roleByKey('AGENT').id,
        ),
        'CANNOT_MODIFY_SELF',
      );
    });

    it('does not let an admin act on an owner', async () => {
      const { service, store, owner } = setup();
      const admin = store.addFake('admin@example.com', 'ADMIN');
      await expectCode(
        service.changeRole(
          actorFor(admin, ADMIN),
          owner.id,
          store.roleByKey('AGENT').id,
        ),
        'ROLE_ESCALATION',
      );
    });

    it('keeps at least one active owner', async () => {
      const { service, store, owner } = setup();
      const coOwner = store.addFake('co@example.com', 'OWNER');
      // Demoting the co-owner is fine while another owner remains…
      await service.changeRole(
        actorFor(owner, OWNER),
        coOwner.id,
        store.roleByKey('AGENT').id,
      );
      // …but the last owner cannot be demoted, not even by another owner.
      const third = store.addFake('third@example.com', 'OWNER');
      await service.deactivate(actorFor(third, OWNER), owner.id);
      await expectCode(
        service.changeRole(
          actorFor(owner, OWNER),
          third.id,
          store.roleByKey('AGENT').id,
        ),
        'LAST_OWNER',
      );
    });

    it('reports members of other workspaces as not found', async () => {
      const { service, store, owner } = setup();
      const foreign = store.addFake('x@example.com', 'AGENT', {
        workspaceId: OTHER_WS,
      });
      await expectCode(
        service.changeRole(
          actorFor(owner, OWNER),
          foreign.id,
          store.roleByKey('ADMIN').id,
        ),
        'MEMBER_NOT_FOUND',
      );
    });
  });

  describe('deactivate and reactivate', () => {
    it('deactivates and reactivates within the plan limit', async () => {
      const { service, store, owner } = setup(new FakeEntitlements('team'));
      const agent = store.addFake('agent@example.com', 'AGENT');
      const actor = actorFor(owner, OWNER);

      expect((await service.deactivate(actor, agent.id)).status).toBe(
        'DEACTIVATED',
      );
      store.addFake('b@example.com', 'AGENT');
      store.addFake('c@example.com', 'AGENT');
      await expectCode(
        service.reactivate(actor, agent.id),
        'AGENT_LIMIT_REACHED',
      );
    });

    it('refuses to deactivate yourself', async () => {
      const { service, owner } = setup();
      await expectCode(
        service.deactivate(actorFor(owner, OWNER), owner.id),
        'CANNOT_MODIFY_SELF',
      );
    });
  });

  describe('resendAccess', () => {
    it('emails a new temporary password while the first one is unused', async () => {
      const { service, store, sent, owner } = setup();
      const fresh = store.addFake('new@example.com', 'AGENT', {
        pendingFirstAccess: true,
      });

      await service.resendAccess(actorFor(owner, OWNER), fresh.id);

      expect(store.passwordResets).toEqual([fresh.userId]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(sent[0]?.text).toMatch(/Temporary password: [A-Za-z0-9]{16}/);
    });

    it('refuses once the member chose their own password', async () => {
      const { service, store, owner } = setup();
      const agent = store.addFake('agent@example.com', 'AGENT');
      await expectCode(
        service.resendAccess(actorFor(owner, OWNER), agent.id),
        'ACCESS_ALREADY_SET',
      );
    });
  });

  it('lists members with the plan usage', async () => {
    const { service, store } = setup(new FakeEntitlements('team'));
    store.addFake('agent@example.com', 'AGENT');
    store.addFake('gone@example.com', 'AGENT', { status: 'DEACTIVATED' });

    const result = await service.list(WS, { limit: 50, offset: 0 });

    expect(result.total).toBe(3);
    expect(result.usage).toEqual({ activeMembers: 2, limit: 3 });
  });
});
