import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import {
  DEMO_USERS,
  DEMO_WORKSPACES,
  seedDemoData,
} from '../../prisma/seed-demo';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateAll } from '../utils/test-db';

const options = {
  password: 'demo passphrase for tests',
  hashPassword: (password: string) => Promise.resolve(`hashed:${password}`),
};

describe('demo seed (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const counts = async () => ({
    users: await prisma.user.count(),
    workspaces: await prisma.workspace.count(),
    memberships: await prisma.workspaceMembership.count(),
    membershipRoles: await prisma.membershipRole.count(),
  });

  it('creates the demo users, workspaces and memberships', async () => {
    const result = await seedDemoData(prisma, options);

    const expectedMemberships = DEMO_USERS.reduce(
      (total, user) => total + user.memberships.length,
      0,
    );
    expect(result).toEqual({
      usersCreated: DEMO_USERS.length,
      workspacesCreated: DEMO_WORKSPACES.length,
      membershipsCreated: expectedMemberships,
      subscriptionsCreated: DEMO_WORKSPACES.length,
    });
    expect(await counts()).toEqual({
      users: DEMO_USERS.length,
      workspaces: DEMO_WORKSPACES.length,
      memberships: expectedMemberships,
      membershipRoles: expectedMemberships,
    });
  });

  it('is idempotent', async () => {
    await seedDemoData(prisma, options);
    const first = await counts();

    const second = await seedDemoData(prisma, options);

    expect(second).toEqual({
      usersCreated: 0,
      workspacesCreated: 0,
      membershipsCreated: 0,
      subscriptionsCreated: 0,
    });
    expect(await counts()).toEqual(first);
  });

  it('makes the super user OWNER of every demo workspace', async () => {
    await seedDemoData(prisma, options);

    const superUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'superadmin@example.com' },
      include: {
        memberships: {
          include: { workspace: true, roles: { include: { role: true } } },
        },
      },
    });
    expect(superUser.status).toBe('ACTIVE');
    expect(superUser.emailVerifiedAt).not.toBeNull();
    expect(
      superUser.memberships
        .map((m) => [m.workspace.slug, m.roles[0]?.role.key])
        .sort(),
    ).toEqual([
      ['acme', 'OWNER'],
      ['globex', 'OWNER'],
      ['initech', 'OWNER'],
    ]);
  });

  it('keeps a deactivated membership for the viewer in globex', async () => {
    await seedDemoData(prisma, options);

    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: {
        user: { email: 'viewer@example.com' },
        workspace: { slug: 'globex' },
      },
    });
    expect(membership.status).toBe('DEACTIVATED');
    expect(membership.deactivatedAt).not.toBeNull();
  });

  it('never overwrites an existing password', async () => {
    await seedDemoData(prisma, options);
    await prisma.userCredential.updateMany({
      where: { user: { email: 'admin@example.com' } },
      data: { passwordHash: 'changed-by-user' },
    });

    await seedDemoData(prisma, {
      ...options,
      password: 'another demo passphrase',
    });

    const credential = await prisma.userCredential.findFirstOrThrow({
      where: { user: { email: 'admin@example.com' } },
    });
    expect(credential.passwordHash).toBe('changed-by-user');
  });

  it('gives each demo workspace a different subscription state', async () => {
    await seedDemoData(prisma, options);

    const rows = await prisma.subscription.findMany({
      include: { workspace: true, plan: true },
      orderBy: { workspace: { slug: 'asc' } },
    });
    expect(
      rows.map((r) => [r.workspace.slug, r.plan.code, r.interval, r.status]),
    ).toEqual([
      ['acme', 'business', 'YEAR', 'ACTIVE'],
      ['globex', 'team', 'MONTH', 'TRIALING'],
      ['initech', 'corporate', 'MONTH', 'EXPIRED'],
    ]);
  });

  it('rejects a weak demo password', async () => {
    await expect(
      seedDemoData(prisma, { ...options, password: 'short' }),
    ).rejects.toThrow(/SEED_DEMO_PASSWORD/);
  });
});
