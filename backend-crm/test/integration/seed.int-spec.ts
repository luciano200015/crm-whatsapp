import { seedAuthorization } from '../../prisma/seed-authorization';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
} from '../../src/modules/authorization/domain/permission-catalog';
import { createTestPrisma, truncateAll } from '../utils/test-db';

const expectedGrantCount = Object.values(SYSTEM_ROLES).reduce(
  (total, role) => total + role.permissions.length,
  0,
);

describe('authorization seed (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function counts() {
    return {
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count(),
      grants: await prisma.rolePermission.count(),
    };
  }

  it('creates the catalog on an empty database', async () => {
    const result = await seedAuthorization(prisma);

    expect(result.grantsAdded).toBe(expectedGrantCount);
    expect(await counts()).toEqual({
      permissions: ALL_PERMISSION_KEYS.length,
      roles: SYSTEM_ROLE_KEYS.length,
      grants: expectedGrantCount,
    });
  });

  it('is idempotent when run repeatedly', async () => {
    await seedAuthorization(prisma);
    const first = await counts();

    const second = await seedAuthorization(prisma);
    await seedAuthorization(prisma);

    expect(second.grantsAdded).toBe(0);
    expect(second.grantsRemoved).toBe(0);
    expect(await counts()).toEqual(first);
  });

  it('stores exactly the catalog grants for each system role', async () => {
    await seedAuthorization(prisma);

    for (const key of SYSTEM_ROLE_KEYS) {
      const role = await prisma.role.findFirstOrThrow({
        where: { key, workspaceId: null },
        include: { permissions: { include: { permission: true } } },
      });
      const granted = role.permissions.map((grant) => grant.permission.key);
      expect(role.isSystem).toBe(true);
      expect(granted.sort()).toEqual([...SYSTEM_ROLES[key].permissions].sort());
    }
  });

  it('repairs drift: restores missing grants and removes extra ones', async () => {
    await seedAuthorization(prisma);
    const viewer = await prisma.role.findFirstOrThrow({
      where: { key: 'VIEWER', workspaceId: null },
    });
    const owner = await prisma.role.findFirstOrThrow({
      where: { key: 'OWNER', workspaceId: null },
    });
    const billingManage = await prisma.permission.findUniqueOrThrow({
      where: { key: 'billing.manage' },
    });

    await prisma.rolePermission.create({
      data: { roleId: viewer.id, permissionId: billingManage.id },
    });
    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: owner.id,
          permissionId: billingManage.id,
        },
      },
    });

    const result = await seedAuthorization(prisma);

    expect(result).toMatchObject({ grantsAdded: 1, grantsRemoved: 1 });
    expect(await counts()).toMatchObject({ grants: expectedGrantCount });
  });

  it('reports permissions that are no longer in the catalog without deleting them', async () => {
    await prisma.permission.create({ data: { key: 'legacy.feature' } });

    const result = await seedAuthorization(prisma);

    expect(result.unknownPermissions).toEqual(['legacy.feature']);
    expect(
      await prisma.permission.count({ where: { key: 'legacy.feature' } }),
    ).toBe(1);
  });
});
