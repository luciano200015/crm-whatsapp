import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  FEATURE_KEYS,
  PLAN_CODES,
  PLANS,
} from '../../src/modules/billing/domain/plan-catalog';
import { createTestPrisma, errorCodeOf, truncateAll } from '../utils/test-db';

describe('billing seed (integration)', () => {
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

  const counts = async () => ({
    features: await prisma.feature.count(),
    plans: await prisma.plan.count(),
    prices: await prisma.planPrice.count(),
    planFeatures: await prisma.planFeature.count(),
  });

  it('creates the catalog and is idempotent', async () => {
    await seedBilling(prisma);
    const first = await counts();

    await seedBilling(prisma);

    expect(first).toEqual({
      features: FEATURE_KEYS.length,
      plans: PLAN_CODES.length,
      prices: PLAN_CODES.length * 2,
      planFeatures: PLAN_CODES.length * FEATURE_KEYS.length,
    });
    expect(await counts()).toEqual(first);
  });

  it('stores limits, inclusions and text values per plan', async () => {
    await seedBilling(prisma);

    const business = await prisma.plan.findUniqueOrThrow({
      where: { code: 'business' },
      include: { features: { include: { feature: true } }, prices: true },
    });
    const value = (key: string) =>
      business.features.find((f) => f.feature.key === key);

    expect(business.isHighlighted).toBe(true);
    expect(value('limits.agents')?.limitValue).toBe(
      PLANS.business.features['limits.agents'],
    );
    expect(value('features.sales_funnels')?.enabled).toBe(true);
    expect(value('features.audit_log')?.enabled).toBe(false);
    expect(value('features.backups')?.textValue).toBe('Mensual');
    expect(
      business.prices.map((p) => [p.interval, p.amountCents]).sort(),
    ).toEqual([
      ['MONTH', 22_900],
      ['YEAR', 229_000],
    ]);
  });

  it('updates prices in place and retires plans removed from the catalog', async () => {
    await seedBilling(prisma);
    await prisma.planPrice.updateMany({ data: { amountCents: 1 } });
    await prisma.plan.create({ data: { code: 'legacy', name: 'Legacy' } });

    const result = await seedBilling(prisma);

    expect(result.retiredPlans).toEqual(['legacy']);
    expect(await prisma.planPrice.count({ where: { amountCents: 1 } })).toBe(0);
    await expect(
      prisma.plan.findUniqueOrThrow({ where: { code: 'legacy' } }),
    ).resolves.toMatchObject({
      isActive: false,
      isPublic: false,
    });
  });

  it('enforces money and code constraints in the database', async () => {
    await seedBilling(prisma);
    const plan = await prisma.plan.findUniqueOrThrow({
      where: { code: 'team' },
    });

    await expect(
      prisma.planPrice.update({
        where: {
          planId_interval_currency: {
            planId: plan.id,
            interval: 'MONTH',
            currency: 'USD',
          },
        },
        data: { amountCents: -1 },
      }),
    ).rejects.toThrow(/plan_prices_amount_check/);
    await expect(
      prisma.plan.create({ data: { code: 'Bad Code', name: 'x' } }),
    ).rejects.toThrow(/plans_code_format_check/);
    expect(
      await errorCodeOf(
        prisma.plan.create({ data: { code: 'team', name: 'dup' } }),
      ),
    ).toBe('P2002');
  });
});
