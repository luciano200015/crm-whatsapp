import type { PrismaClient } from '../src/generated/prisma/client';
import {
  FEATURES,
  FEATURE_KEYS,
  PLANS,
  PLAN_CODES,
  type BillingInterval,
  type FeatureValue,
} from '../src/modules/billing/domain/plan-catalog';

export interface SeedBillingResult {
  features: number;
  plans: number;
  prices: number;
  planFeatures: number;
  retiredPlans: string[];
}

function planFeatureValues(
  kind: 'LIMIT' | 'BOOLEAN' | 'TEXT',
  value: FeatureValue,
) {
  if (kind === 'LIMIT') {
    return {
      limitValue: typeof value === 'number' ? value : null,
      enabled: true,
      textValue: null,
    };
  }
  if (kind === 'BOOLEAN') {
    return { limitValue: null, enabled: value === true, textValue: null };
  }
  return {
    limitValue: null,
    enabled: typeof value === 'string',
    textValue: typeof value === 'string' ? value : null,
  };
}

/**
 * Idempotent: syncs features, plans, prices and plan entitlements with
 * src/modules/billing/domain/plan-catalog.ts. Plans removed from the catalog
 * are retired (isActive=false), never deleted: subscriptions may use them.
 */
export async function seedBilling(
  prisma: PrismaClient,
): Promise<SeedBillingResult> {
  return prisma.$transaction(
    async (tx) => {
      const featureIds = new Map<string, string>();
      for (const [index, key] of FEATURE_KEYS.entries()) {
        const definition = FEATURES[key];
        const data = {
          name: definition.name,
          description:
            'description' in definition ? definition.description : null,
          kind: definition.kind,
          unit: 'unit' in definition ? definition.unit : null,
          group: definition.group,
          sortOrder: index,
        };
        const feature = await tx.feature.upsert({
          where: { key },
          create: { key, ...data },
          update: data,
          select: { id: true },
        });
        featureIds.set(key, feature.id);
      }

      let prices = 0;
      let planFeatures = 0;
      for (const [index, code] of PLAN_CODES.entries()) {
        const definition = PLANS[code];
        const data = {
          name: definition.name,
          tagline: definition.tagline,
          description: definition.description,
          sortOrder: index,
          isPublic:
            'isPublic' in definition ? definition.isPublic !== false : true,
          isActive: true,
          isHighlighted:
            'highlighted' in definition && definition.highlighted === true,
        };
        const plan = await tx.plan.upsert({
          where: { code },
          create: { code, ...data },
          update: data,
          select: { id: true },
        });

        const byCurrency: Record<
          string,
          Record<BillingInterval, number>
        > = definition.prices;
        for (const [currency, amounts] of Object.entries(byCurrency)) {
          for (const interval of ['MONTH', 'YEAR'] as const) {
            await tx.planPrice.upsert({
              where: {
                planId_interval_currency: {
                  planId: plan.id,
                  interval,
                  currency,
                },
              },
              create: {
                planId: plan.id,
                interval,
                currency,
                amountCents: amounts[interval],
              },
              update: { amountCents: amounts[interval], isActive: true },
            });
            prices++;
          }
        }

        const values: Record<string, FeatureValue> = definition.features;
        for (const key of FEATURE_KEYS) {
          const featureId = featureIds.get(key);
          if (!featureId) continue;
          const columns = planFeatureValues(
            FEATURES[key].kind,
            values[key] ?? null,
          );
          await tx.planFeature.upsert({
            where: { planId_featureId: { planId: plan.id, featureId } },
            create: { planId: plan.id, featureId, ...columns },
            update: columns,
          });
          planFeatures++;
        }
      }

      const retired = await tx.plan.findMany({
        where: { code: { notIn: PLAN_CODES }, isActive: true },
        select: { code: true },
      });
      if (retired.length > 0) {
        await tx.plan.updateMany({
          where: { code: { in: retired.map((plan) => plan.code) } },
          data: { isActive: false, isPublic: false },
        });
      }

      return {
        features: featureIds.size,
        plans: PLAN_CODES.length,
        prices,
        planFeatures,
        retiredPlans: retired.map((plan) => plan.code),
      };
    },
    { timeout: 30_000 },
  );
}
