import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { SystemRoleKey } from '../../src/modules/authorization/domain/permission-catalog';
import { createTestPrisma, truncateAll } from '../utils/test-db';
import { createTestApp, type TestApp } from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;

interface Owner {
  email: string;
  token: string;
  workspaceId: string;
}

interface SubscriptionBody {
  status: string;
  plan: { code: string };
  interval: string;
  amountCents: number;
  trialDaysLeft: number;
  hasFullAccess: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  entitlements: { key: string; value: unknown; usage: number | null }[];
}

describe('Billing (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let counter = 0;

  const http = () => request(t.app.getHttpServer());
  const email = () => `billing${++counter}@example.com`;

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

  async function login(address: string): Promise<string> {
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password: PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function signUp(plan: Record<string, string> = {}): Promise<Owner> {
    const address = email();
    await http()
      .post('/api/v1/auth/register')
      .send({
        email: address,
        password: PASSWORD,
        displayName: 'Owner',
        workspaceName: 'Shop',
        ...plan,
      })
      .expect(202);
    const token = await login(address);
    const me = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [workspace] = (me.body as { workspaces: { id: string }[] })
      .workspaces;
    return { email: address, token, workspaceId: workspace?.id ?? '' };
  }

  /** Adds a member with a system role directly in the database and signs them in. */
  async function addMember(
    workspaceId: string,
    role: SystemRoleKey,
  ): Promise<string> {
    const address = email();
    await http()
      .post('/api/v1/auth/register')
      .send({ email: address, password: PASSWORD, displayName: role })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    const roleRow = await prisma.role.findFirstOrThrow({
      where: { key: role, workspaceId: null },
    });
    await prisma.workspaceMembership.create({
      data: {
        workspaceId,
        userId: user.id,
        roles: { create: { roleId: roleRow.id } },
      },
    });
    return login(address);
  }

  const subscription = (owner: Owner, token = owner.token) =>
    http()
      .get(`/api/v1/workspaces/${owner.workspaceId}/subscription`)
      .set('Authorization', `Bearer ${token}`);

  const changePlan = (
    owner: Owner,
    planCode: string,
    interval: string,
    token = owner.token,
  ) =>
    http()
      .put(`/api/v1/workspaces/${owner.workspaceId}/subscription/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planCode, interval });

  const action = (owner: Owner, name: 'activate' | 'cancel' | 'resume') =>
    http()
      .post(`/api/v1/workspaces/${owner.workspaceId}/subscription/${name}`)
      .set('Authorization', `Bearer ${owner.token}`);

  const expireTrial = (workspaceId: string) =>
    prisma.subscription.update({
      where: { workspaceId },
      data: {
        trialStartedAt: new Date(Date.now() - 10 * DAY),
        trialEndsAt: new Date(Date.now() - DAY),
      },
    });

  // ─────────────────────────── Catalog ───────────────────────────

  it('publishes the plan catalog without authentication', async () => {
    const response = await http().get('/api/v1/billing/plans').expect(200);
    const body = response.body as {
      trialDays: number;
      defaultPlan: string;
      paymentsEnabled: boolean;
      features: { key: string }[];
      plans: {
        code: string;
        prices: {
          interval: string;
          amountCents: number;
          monthlyEquivalentCents: number;
        }[];
        features: { key: string; value: unknown }[];
      }[];
    };

    expect(body).toMatchObject({
      trialDays: 7,
      defaultPlan: 'team',
      paymentsEnabled: true,
    });
    expect(body.plans.map((p) => p.code)).toEqual([
      'team',
      'business',
      'corporate',
    ]);
    const business = body.plans[1];
    expect(business?.prices).toContainEqual({
      interval: 'YEAR',
      currency: 'USD',
      amountCents: 229_000,
      monthlyEquivalentCents: 19_083,
    });
    expect(business?.features).toContainEqual({
      key: 'limits.agents',
      value: 10,
    });
    expect(body.features.length).toBeGreaterThan(10);
  });

  // ─────────────────────────── Sign-up ───────────────────────────

  describe('sign-up', () => {
    it('starts the basic plan with a 7-day trial by default', async () => {
      const owner = await signUp();

      const me = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(
        (me.body as { workspaces: unknown[] }).workspaces[0],
      ).toMatchObject({
        plan: {
          code: 'team',
          status: 'TRIALING',
          trialDaysLeft: 7,
          hasFullAccess: true,
        },
      });

      const stored = await prisma.subscription.findUniqueOrThrow({
        where: { workspaceId: owner.workspaceId },
      });
      const trialMs =
        (stored.trialEndsAt?.getTime() ?? 0) -
        (stored.trialStartedAt?.getTime() ?? 0);
      expect(trialMs).toBe(7 * DAY);
      expect(stored).toMatchObject({
        status: 'TRIALING',
        amountCents: 9_900,
        interval: 'MONTH',
      });
    });

    it('uses the plan chosen on the pricing page', async () => {
      const owner = await signUp({ planCode: 'corporate', interval: 'YEAR' });

      const response = await subscription(owner).expect(200);
      expect(response.body).toMatchObject({
        plan: { code: 'corporate' },
        interval: 'YEAR',
        amountCents: 599_000,
        status: 'TRIALING',
      });
    });

    it('rejects an unknown plan without creating the account', async () => {
      const address = email();
      await http()
        .post('/api/v1/auth/register')
        .send({
          email: address,
          password: PASSWORD,
          displayName: 'X',
          planCode: 'platinum',
        })
        .expect(400);
      expect(await prisma.user.count({ where: { email: address } })).toBe(0);
    });
  });

  // ─────────────────────────── Access control ───────────────────────────

  describe('access control', () => {
    let owner: Owner;

    beforeAll(async () => {
      owner = await signUp();
    });

    it('shows limits and usage to the owner', async () => {
      const response = await subscription(owner).expect(200);
      const body = response.body as SubscriptionBody;
      expect(body.entitlements).toContainEqual(
        expect.objectContaining({ key: 'limits.agents', value: 3, usage: 1 }),
      );
      expect(body.entitlements).toContainEqual(
        expect.objectContaining({
          key: 'features.sales_funnels',
          value: false,
        }),
      );
    });

    it('lets an ADMIN read but not change the plan', async () => {
      const admin = await addMember(owner.workspaceId, 'ADMIN');

      await subscription(owner, admin).expect(200);
      await changePlan(owner, 'business', 'MONTH', admin).expect(403);
    });

    it('forbids billing to an AGENT', async () => {
      const agent = await addMember(owner.workspaceId, 'AGENT');
      await subscription(owner, agent).expect(403);
    });

    it('hides other workspaces (404) and rejects malformed ids', async () => {
      const stranger = await signUp();

      await subscription(owner, stranger.token).expect(404);
      await changePlan(owner, 'corporate', 'YEAR', stranger.token).expect(404);
      await http()
        .get('/api/v1/workspaces/not-a-uuid/subscription')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await http()
        .get(`/api/v1/workspaces/${owner.workspaceId}/subscription`)
        .expect(401);
    });
  });

  // ─────────────────────────── Lifecycle ───────────────────────────

  describe('lifecycle', () => {
    it('changes plan during the trial without ending it', async () => {
      const owner = await signUp();

      const response = await changePlan(owner, 'business', 'YEAR').expect(200);

      expect(response.body).toMatchObject({
        plan: { code: 'business' },
        interval: 'YEAR',
        status: 'TRIALING',
        trialDaysLeft: 7,
      });
      await changePlan(owner, 'business', 'YEAR').expect(409);
    });

    it('expires the trial, then a plan change pays and activates it', async () => {
      const owner = await signUp();
      await expireTrial(owner.workspaceId);

      const expired = await subscription(owner).expect(200);
      expect(expired.body).toMatchObject({
        status: 'EXPIRED',
        hasFullAccess: false,
      });

      const response = await changePlan(owner, 'business', 'MONTH').expect(200);
      const body = response.body as SubscriptionBody;
      expect(body).toMatchObject({
        status: 'ACTIVE',
        hasFullAccess: true,
        amountCents: 22_900,
      });
      expect(new Date(body.currentPeriodEnd ?? 0).getTime()).toBeGreaterThan(
        Date.now() + 27 * DAY,
      );

      const audit = await prisma.auditLog.findFirst({
        where: {
          workspaceId: owner.workspaceId,
          action: 'billing.plan.changed',
        },
      });
      expect(audit?.metadata).toMatchObject({
        to: 'business/MONTH',
        status: 'ACTIVE',
      });
    });

    it('refuses a downgrade when members exceed the new limit', async () => {
      const owner = await signUp({ planCode: 'business' });
      for (let i = 0; i < 3; i++) await addMember(owner.workspaceId, 'VIEWER');

      const response = await changePlan(owner, 'team', 'MONTH').expect(409);
      expect((response.body as { message: string }).message).toMatch(
        /allows 3 agents/,
      );
      expect(response.body).toMatchObject({
        code: 'PLAN_LIMIT_EXCEEDED',
        details: { feature: 'limits.agents', limit: 3, usage: 4 },
      });
    });

    it('activates early, cancels at period end and resumes', async () => {
      const owner = await signUp();

      await action(owner, 'activate').expect(200);
      await action(owner, 'activate').expect(409);

      const canceled = await action(owner, 'cancel').expect(200);
      expect(canceled.body).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
      });

      const resumed = await action(owner, 'resume').expect(200);
      expect(resumed.body).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
    });

    it('cancels a trial immediately', async () => {
      const owner = await signUp();
      const response = await action(owner, 'cancel').expect(200);
      expect(response.body).toMatchObject({
        status: 'CANCELED',
        hasFullAccess: false,
      });
    });
  });
});

describe('Billing with payments disabled (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    t = await createTestApp({ BILLING_PAYMENTS_MODE: 'disabled' });
  });

  afterAll(async () => {
    await t.app.close();
    await prisma.$disconnect();
  });

  it('allows trial changes but answers 402 when a payment is needed', async () => {
    const http = () => request(t.app.getHttpServer());
    const address = 'nopay@example.com';
    await http()
      .post('/api/v1/auth/register')
      .send({ email: address, password: PASSWORD, displayName: 'No Pay' })
      .expect(202);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password: PASSWORD })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? '';
    const put = (planCode: string) =>
      http()
        .put(`/api/v1/workspaces/${workspaceId}/subscription/plan`)
        .set('Authorization', `Bearer ${token}`)
        .send({ planCode, interval: 'MONTH' });

    const catalog = await http().get('/api/v1/billing/plans').expect(200);
    expect((catalog.body as { paymentsEnabled: boolean }).paymentsEnabled).toBe(
      false,
    );

    await put('business').expect(200);

    await prisma.subscription.update({
      where: { workspaceId },
      data: {
        trialStartedAt: new Date(Date.now() - 10 * DAY),
        trialEndsAt: new Date(Date.now() - DAY),
      },
    });
    const refused = await put('corporate').expect(402);
    expect((refused.body as { message: string }).message).toMatch(
      /not available/,
    );
    expect(refused.body).toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
  });
});
