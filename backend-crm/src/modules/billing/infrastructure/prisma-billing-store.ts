import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import {
  BillingStore,
  CatalogFeature,
  PlanRecord,
  SubscriptionRecord,
  SubscriptionWrite,
} from '../application/ports';
import {
  isFeatureKey,
  type FeatureKey,
  type FeatureValue,
} from '../domain/plan-catalog';

const PLAN_INCLUDE = {
  prices: {
    where: { isActive: true },
    orderBy: [{ currency: 'asc' }, { interval: 'asc' }],
  },
  features: { include: { feature: true } },
} as const satisfies Prisma.PlanInclude;

type PlanRow = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

const SUBSCRIPTION_INCLUDE = {
  plan: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

function toPlan(row: PlanRow): PlanRecord {
  const features: Partial<Record<FeatureKey, FeatureValue>> = {};
  for (const planFeature of row.features) {
    const { key, kind } = planFeature.feature;
    if (!isFeatureKey(key)) continue;
    features[key] =
      kind === 'LIMIT'
        ? planFeature.limitValue
        : kind === 'BOOLEAN'
          ? planFeature.enabled
          : planFeature.textValue;
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    isHighlighted: row.isHighlighted,
    isPublic: row.isPublic,
    isActive: row.isActive,
    prices: row.prices.map((price) => ({
      id: price.id,
      interval: price.interval,
      currency: price.currency,
      amountCents: price.amountCents,
    })),
    features,
  };
}

function toSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    plan: row.plan,
    priceId: row.priceId,
    interval: row.interval,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    trialStartedAt: row.trialStartedAt,
    trialEndsAt: row.trialEndsAt,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt,
    provider: row.provider,
  };
}

@Injectable()
export class PrismaBillingStore extends BillingStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listFeatures(): Promise<CatalogFeature[]> {
    const rows = await this.prisma.feature.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return rows.flatMap((row) =>
      isFeatureKey(row.key)
        ? [
            {
              key: row.key,
              name: row.name,
              description: row.description,
              kind: row.kind,
              unit: row.unit,
              group: row.group,
            },
          ]
        : [],
    );
  }

  async listPlans(filter: { publicOnly: boolean }): Promise<PlanRecord[]> {
    const rows = await this.prisma.plan.findMany({
      where: filter.publicOnly ? { isPublic: true, isActive: true } : {},
      include: PLAN_INCLUDE,
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toPlan);
  }

  async findPlan(code: string): Promise<PlanRecord | null> {
    const row = await this.prisma.plan.findUnique({
      where: { code },
      include: PLAN_INCLUDE,
    });
    return row ? toPlan(row) : null;
  }

  async findPlanById(id: string): Promise<PlanRecord | null> {
    const row = await this.prisma.plan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });
    return row ? toPlan(row) : null;
  }

  async findSubscription(
    workspaceId: string,
  ): Promise<SubscriptionRecord | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: SUBSCRIPTION_INCLUDE,
    });
    return row ? toSubscription(row) : null;
  }

  async saveSubscription(
    workspaceId: string,
    data: SubscriptionWrite,
  ): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
      include: SUBSCRIPTION_INCLUDE,
    });
    return toSubscription(row);
  }

  async updateSubscription(
    workspaceId: string,
    data: Partial<SubscriptionWrite>,
  ): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.update({
      where: { workspaceId },
      data,
      include: SUBSCRIPTION_INCLUDE,
    });
    return toSubscription(row);
  }

  countActiveMembers(workspaceId: string): Promise<number> {
    return this.prisma.workspaceMembership.count({
      where: { workspaceId, status: 'ACTIVE' },
    });
  }
}
