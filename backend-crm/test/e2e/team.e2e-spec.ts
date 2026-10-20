import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateAll } from '../utils/test-db';
import { createTestApp, type TestApp } from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'my own long passphrase 42';

interface Owner {
  token: string;
  workspaceId: string;
}

interface RoleBody {
  id: string;
  key: string;
  system: boolean;
  permissions: string[];
  memberCount: number;
}

interface MemberBody {
  id: string;
  email: string;
  status: string;
  pendingFirstAccess: boolean;
  role: { key: string } | null;
  permissions: string[];
}

describe('Team (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let counter = 0;

  const http = () => request(t.app.getHttpServer());
  const nextEmail = () => `team${++counter}@example.com`;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await prisma.$disconnect();
  });

  async function login(email: string, password = PASSWORD) {
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body as {
      accessToken: string;
      user: { mustChangePassword: boolean };
    };
  }

  async function signUp(planCode = 'business'): Promise<Owner> {
    const email = nextEmail();
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Owner', planCode })
      .expect(202);
    const { accessToken } = await login(email);
    const me = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const [workspace] = (me.body as { workspaces: { id: string }[] })
      .workspaces;
    return { token: accessToken, workspaceId: workspace?.id ?? '' };
  }

  const api = (owner: Owner, token = owner.token) => ({
    get: (path: string) =>
      http()
        .get(`/api/v1/workspaces/${owner.workspaceId}${path}`)
        .set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      http()
        .post(`/api/v1/workspaces/${owner.workspaceId}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
    patch: (path: string, body: object) =>
      http()
        .patch(`/api/v1/workspaces/${owner.workspaceId}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
    delete: (path: string) =>
      http()
        .delete(`/api/v1/workspaces/${owner.workspaceId}${path}`)
        .set('Authorization', `Bearer ${token}`),
  });

  async function roleId(owner: Owner, key: string): Promise<string> {
    const response = await api(owner).get('/roles').expect(200);
    const role = (response.body as RoleBody[]).find((r) => r.key === key);
    if (!role) throw new Error(`role ${key} not found`);
    return role.id;
  }

  function temporaryPasswordFor(email: string): string {
    const match = /Temporary password: (\S+)/.exec(t.mailer.last(email).text);
    if (!match?.[1]) throw new Error('No temporary password in email');
    return match[1];
  }

  /** Creates a member through the API and completes their first sign-in. */
  async function addAgent(owner: Owner, key = 'AGENT') {
    const email = nextEmail();
    const created = await api(owner)
      .post('/members', {
        email,
        displayName: 'Agent',
        roleId: await roleId(owner, key),
      })
      .expect(201);
    const first = await login(email, temporaryPasswordFor(email));
    await http()
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({
        currentPassword: temporaryPasswordFor(email),
        newPassword: NEW_PASSWORD,
      })
      .expect(204);
    const member = created.body as MemberBody;
    return { email, member, token: first.accessToken };
  }

  describe('new agent with a temporary password', () => {
    it('emails the password, blocks the app until it is changed, then works', async () => {
      const owner = await signUp();
      const email = nextEmail();

      const created = await api(owner)
        .post('/members', {
          email,
          displayName: 'Carla',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(201);
      expect(created.body).toMatchObject({
        email,
        status: 'ACTIVE',
        pendingFirstAccess: true,
        role: { key: 'AGENT', system: true },
      });
      const temporary = temporaryPasswordFor(email);
      expect(JSON.stringify(created.body)).not.toContain(temporary);
      const credential = await prisma.userCredential.findFirstOrThrow({
        where: { user: { email } },
      });
      expect(credential.passwordHash).toMatch(/^\$argon2id\$/);
      expect(credential.mustChangePassword).toBe(true);

      const first = await login(email, temporary);
      expect(first.user.mustChangePassword).toBe(true);
      const agent = { ...owner, token: first.accessToken };

      const blocked = await api(agent).get('/members').expect(403);
      expect(blocked.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      const me = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${first.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({
        mustChangePassword: true,
        emailVerified: false,
      });

      await http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${first.accessToken}`)
        .send({ currentPassword: temporary, newPassword: NEW_PASSWORD })
        .expect(204);

      await api(agent).get('/members').expect(200);
      const after = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${first.accessToken}`)
        .expect(200);
      expect(after.body).toMatchObject({
        mustChangePassword: false,
        emailVerified: true,
      });
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: temporary })
        .expect(401);
    });

    it('adds an existing account without changing its password', async () => {
      const owner = await signUp();
      const other = await signUp();
      const { email } = await addAgent(other);

      await api(owner)
        .post('/members', {
          email,
          displayName: 'Ignored',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(201);
      expect(t.mailer.last(email).text).not.toMatch(/Temporary password/);
      await login(email, NEW_PASSWORD);
    });

    it('resends a new temporary password only before the first change', async () => {
      const owner = await signUp();
      const email = nextEmail();
      const created = await api(owner)
        .post('/members', {
          email,
          displayName: 'Late',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(201);
      const memberId = (created.body as MemberBody).id;
      const firstPassword = temporaryPasswordFor(email);

      await api(owner).post(`/members/${memberId}/resend-access`).expect(204);
      const secondPassword = temporaryPasswordFor(email);
      expect(secondPassword).not.toBe(firstPassword);
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: firstPassword })
        .expect(401);

      const { member } = await addAgent(owner);
      const refused = await api(owner)
        .post(`/members/${member.id}/resend-access`)
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'ACCESS_ALREADY_SET' });
    });
  });

  describe('plan limits', () => {
    it('stops at limits.agents of the Equipo plan and counts reactivations', async () => {
      const owner = await signUp('team');
      const first = await addAgent(owner);
      await addAgent(owner);

      const full = await api(owner)
        .post('/members', {
          email: nextEmail(),
          displayName: 'Fourth',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(409);
      expect(full.body).toMatchObject({
        code: 'AGENT_LIMIT_REACHED',
        details: { limit: 3, usage: 3 },
      });

      const list = await api(owner).get('/members').expect(200);
      expect((list.body as { usage: unknown }).usage).toEqual({
        activeMembers: 3,
        limit: 3,
      });

      await api(owner)
        .post(`/members/${first.member.id}/deactivate`)
        .expect(200);
      await api(owner)
        .post('/members', {
          email: nextEmail(),
          displayName: 'Replacement',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(201);
      const reactivate = await api(owner)
        .post(`/members/${first.member.id}/reactivate`)
        .expect(409);
      expect(reactivate.body).toMatchObject({ code: 'AGENT_LIMIT_REACHED' });
    });

    it('refuses custom roles on the Equipo plan', async () => {
      const owner = await signUp('team');
      const response = await api(owner)
        .post('/roles', { name: 'Supervisor', permissions: ['contacts.read'] })
        .expect(403);
      expect(response.body).toMatchObject({
        code: 'FEATURE_NOT_IN_PLAN',
        details: { feature: 'features.custom_roles', plan: 'Equipo' },
      });
    });

    it('refuses new members when the trial is over', async () => {
      const owner = await signUp();
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: {
          trialStartedAt: new Date(Date.now() - 10 * 86_400_000),
          trialEndsAt: new Date(Date.now() - 86_400_000),
        },
      });
      const response = await api(owner)
        .post('/members', {
          email: nextEmail(),
          displayName: 'Late',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(402);
      expect(response.body).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
    });
  });

  describe('custom roles', () => {
    it('creates, assigns, edits and deletes a custom role', async () => {
      const owner = await signUp();
      const created = await api(owner)
        .post('/roles', {
          name: 'Supervisor',
          description: 'Supervises agents',
          permissions: ['members.read', 'contacts.read', 'messages.read'],
        })
        .expect(201);
      const role = created.body as RoleBody;
      expect(role).toMatchObject({
        key: 'supervisor',
        system: false,
        memberCount: 0,
      });
      const stored = await prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });
      expect(stored).toMatchObject({
        workspaceId: owner.workspaceId,
        isSystem: false,
      });

      const duplicate = await api(owner)
        .post('/roles', { name: 'supervisor', permissions: ['contacts.read'] })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'ROLE_NAME_TAKEN' });

      const { member, token } = await addAgent(owner, 'supervisor');
      expect(member.permissions).toEqual([
        'contacts.read',
        'members.read',
        'messages.read',
      ]);
      const asSupervisor = { ...owner, token };
      await api(asSupervisor).get('/members').expect(200);
      await api(asSupervisor).get('/roles').expect(403);

      await api(owner)
        .patch(`/roles/${role.id}`, {
          permissions: ['members.read', 'roles.read'],
        })
        .expect(200);
      // The change applies to the member on their next request.
      await api(asSupervisor).get('/roles').expect(200);

      const inUse = await api(owner).delete(`/roles/${role.id}`).expect(409);
      expect(inUse.body).toMatchObject({
        code: 'ROLE_IN_USE',
        details: { members: 1 },
      });
      await api(owner)
        .patch(`/members/${member.id}`, {
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(200);
      await api(owner).delete(`/roles/${role.id}`).expect(204);
    });

    it('keeps system roles read-only', async () => {
      const owner = await signUp();
      const agentRole = await roleId(owner, 'AGENT');
      const response = await api(owner)
        .patch(`/roles/${agentRole}`, { name: 'Hacked' })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'SYSTEM_ROLE_READ_ONLY' });
      await api(owner).delete(`/roles/${agentRole}`).expect(403);
    });
  });

  describe('authorization', () => {
    it('isolates workspaces: members and roles of another workspace are not found', async () => {
      const a = await signUp();
      const b = await signUp();
      const { member } = await addAgent(a);
      const custom = await api(a)
        .post('/roles', { name: 'Private', permissions: ['contacts.read'] })
        .expect(201);

      await api(a, b.token).get('/members').expect(404);
      const foreignMember = await api(b)
        .post(`/members/${member.id}/deactivate`)
        .expect(404);
      expect(foreignMember.body).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
      const foreignRole = await api(b)
        .post('/members', {
          email: nextEmail(),
          displayName: 'X',
          roleId: (custom.body as RoleBody).id,
        })
        .expect(404);
      expect(foreignRole.body).toMatchObject({ code: 'ROLE_NOT_FOUND' });
    });

    it('protects owners and the acting member', async () => {
      const owner = await signUp();
      const admin = await addAgent(owner, 'ADMIN');
      const agent = await addAgent(owner);
      const asAdmin = { ...owner, token: admin.token };
      const ownerMember = (
        (await api(owner).get('/members').expect(200)).body as {
          items: MemberBody[];
        }
      ).items.find((m) => m.role?.key === 'OWNER');

      const escalation = await api(asAdmin)
        .post(`/members/${ownerMember?.id}/deactivate`)
        .expect(403);
      expect(escalation.body).toMatchObject({ code: 'ROLE_ESCALATION' });
      await api(asAdmin)
        .patch(`/members/${agent.member.id}`, {
          roleId: await roleId(owner, 'OWNER'),
        })
        .expect(403);

      const self = await api(owner)
        .post(`/members/${ownerMember?.id}/deactivate`)
        .expect(403);
      expect(self.body).toMatchObject({ code: 'CANNOT_MODIFY_SELF' });

      // Admins manage agents; a deactivated agent loses the workspace at once.
      await api(asAdmin)
        .post(`/members/${agent.member.id}/deactivate`)
        .expect(200);
      await api({ ...owner, token: agent.token })
        .get('/roles')
        .expect(404);
      await api(asAdmin)
        .post(`/members/${agent.member.id}/reactivate`)
        .expect(200);
    });

    it('requires members.invite to add members', async () => {
      const owner = await signUp();
      const agent = await addAgent(owner);
      await api({ ...owner, token: agent.token })
        .post('/members', {
          email: nextEmail(),
          displayName: 'X',
          roleId: await roleId(owner, 'AGENT'),
        })
        .expect(403);
    });
  });
});
