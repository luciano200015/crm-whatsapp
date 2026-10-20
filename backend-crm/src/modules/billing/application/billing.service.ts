import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { RequestContext } from '../../../shared/http/request-context';
import { Clock } from '../../../shared/time/clock';
import { AuditService } from '../../audit/audit.service';
import type { InitialSubscriptionProvider } from '../../auth/application/ports';
import type {
  WorkspaceEntitlements,
  WorkspaceEntitlementsView,
} from '../../../shared/entitlements/workspace-entitlements';
import {
  type BillingInterval,
  type FeatureKey,
  type FeatureValue,
} from '../domain/plan-catalog';
import {
  addInterval,
  effectiveStatus,
  fitsLimit,
  hasFullAccess,
  trialDaysLeft,
  trialWindow,
  yearlySavingsPercent,
  type SubscriptionStatus,
} from '../domain/subscription-rules';
import {
  BillingStore,
  PaymentGateway,
  PaymentsUnavailableError,
  type CatalogFeature,
  type PlanRecord,
  type SubscriptionRecord,
  type SubscriptionWrite,
} from './ports';
import { BillingErrors } from './billing-errors';

export interface PlanView {
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  highlighted: boolean;
  prices: {
    interval: BillingInterval;
    currency: string;
    amountCents: number;
    /** Yearly price divided by 12 (what pricing pages show as "per month"). */
    monthlyEquivalentCents: number;
  }[];
  yearlySavingsPercent: number;
  features: { key: FeatureKey; value: FeatureValue }[];
}

export interface CatalogView {
  currency: string;
  trialDays: number;
  defaultPlan: string;
  paymentsEnabled: boolean;
  features: CatalogFeature[];
  plans: PlanView[];
}

export interface EntitlementView {
  key: FeatureKey;
  name: string;
  kind: CatalogFeature['kind'];
  unit: string | null;
  value: FeatureValue;
  /** Current usage, for limits that are measured today. */
  usage: number | null;
}

export interface SubscriptionView {
  workspaceId: string;
  plan: { code: string; name: string };
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  status: SubscriptionStatus;
  hasFullAccess: boolean;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  paymentsEnabled: boolean;
  entitlements: EntitlementView[];
}

/** What a new workspace subscribes to at sign-up (created in the same transaction). */
export interface SignupSubscription {
  planId: string;
  priceId: string | null;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  status: 'TRIALING' | 'INCOMPLETE';
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}

export interface ChangePlanInput {
  planCode: string;
  interval: BillingInterval;
}

interface Actor {
  userId: string;
  context: RequestContext;
}

@Injectable()
export class BillingService
  implements InitialSubscriptionProvider, WorkspaceEntitlements
{
  constructor(
    private readonly store: BillingStore,
    private readonly payments: PaymentGateway,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
  ) {}

  // ─────────────────────────── Catalog ───────────────────────────

  async catalog(): Promise<CatalogView> {
    const [features, plans] = await Promise.all([
      this.store.listFeatures(),
      this.store.listPlans({ publicOnly: true }),
    ]);
    const currency = this.config.get('BILLING_CURRENCY');
    return {
      currency,
      trialDays: this.config.get('BILLING_TRIAL_DAYS'),
      defaultPlan: this.config.get('BILLING_DEFAULT_PLAN'),
      paymentsEnabled: this.payments.enabled,
      features,
      plans: plans.map((plan) => this.toPlanView(plan, currency)),
    };
  }

  private toPlanView(plan: PlanRecord, currency: string): PlanView {
    const prices = plan.prices.filter((price) => price.currency === currency);
    const monthly =
      prices.find((p) => p.interval === 'MONTH')?.amountCents ?? 0;
    const yearly = prices.find((p) => p.interval === 'YEAR')?.amountCents ?? 0;
    return {
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline,
      description: plan.description,
      highlighted: plan.isHighlighted,
      prices: prices.map((price) => ({
        interval: price.interval,
        currency: price.currency,
        amountCents: price.amountCents,
        monthlyEquivalentCents:
          price.interval === 'YEAR'
            ? Math.round(price.amountCents / 12)
            : price.amountCents,
      })),
      yearlySavingsPercent: yearlySavingsPercent(monthly, yearly),
      features: Object.entries(plan.features).map(([key, value]) => ({
        key: key as FeatureKey,
        value: value ?? null,
      })),
    };
  }

  // ─────────────────────────── Sign-up ───────────────────────────

  /**
   * The subscription a new workspace starts with: the requested public plan
   * (or BILLING_DEFAULT_PLAN) with a BILLING_TRIAL_DAYS trial. Without a trial
   * it starts INCOMPLETE until the first payment.
   */
  async forSignup(
    planCode?: string,
    interval?: BillingInterval,
  ): Promise<SignupSubscription> {
    const code = planCode ?? this.config.get('BILLING_DEFAULT_PLAN');
    const { plan, price } = await this.purchasablePrice(
      code,
      interval ?? this.config.get('BILLING_DEFAULT_INTERVAL'),
    );
    const trial = trialWindow(
      this.clock.now(),
      this.config.get('BILLING_TRIAL_DAYS'),
    );
    return {
      planId: plan.id,
      priceId: price.id,
      interval: price.interval,
      amountCents: price.amountCents,
      currency: price.currency,
      status: trial ? 'TRIALING' : 'INCOMPLETE',
      trialStartedAt: trial?.startsAt ?? null,
      trialEndsAt: trial?.endsAt ?? null,
    };
  }

  // ─────────────────────────── Workspace subscription ───────────────────────────

  async getSubscription(workspaceId: string): Promise<SubscriptionView> {
    const subscription = await this.currentSubscription(workspaceId);
    if (!subscription) throw BillingErrors.noSubscription();
    return this.toView(subscription);
  }

  /**
   * During a trial: switches plan/interval and keeps the trial.
   * Otherwise: charges the new plan and starts a new paid period.
   * Downgrades are refused if current usage does not fit the new limits.
   */
  async changePlan(
    workspaceId: string,
    input: ChangePlanInput,
    actor: Actor,
  ): Promise<SubscriptionView> {
    const now = this.clock.now();
    const current = await this.currentSubscription(workspaceId);
    const { plan, price } = await this.purchasablePrice(
      input.planCode,
      input.interval,
    );
    const status = current?.status ?? 'INCOMPLETE';

    if (
      current &&
      current.plan.code === plan.code &&
      current.interval === price.interval &&
      (status === 'TRIALING' || status === 'ACTIVE')
    ) {
      throw BillingErrors.alreadyOnPlan();
    }
    await this.assertUsageFits(workspaceId, plan);

    const planFields = {
      planId: plan.id,
      priceId: price.id,
      interval: price.interval,
      amountCents: price.amountCents,
      currency: price.currency,
    };

    let saved: SubscriptionRecord;
    if (current && status === 'TRIALING') {
      saved = await this.store.updateSubscription(workspaceId, planFields);
    } else {
      const charge = await this.charge(workspaceId, plan.code, price);
      saved = await this.store.saveSubscription(workspaceId, {
        ...planFields,
        status: 'ACTIVE',
        trialStartedAt: current?.trialStartedAt ?? null,
        trialEndsAt: current?.trialEndsAt ?? null,
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, price.interval),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        provider: charge.provider,
        providerReference: charge.reference,
      });
    }

    await this.audit.record({
      action: 'billing.plan.changed',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'subscription',
      targetId: saved.id,
      context: actor.context,
      metadata: {
        from: current ? `${current.plan.code}/${current.interval}` : null,
        to: `${plan.code}/${price.interval}`,
        status: saved.status,
      },
    });
    return this.toView(saved);
  }

  /** Pays for the current plan: ends a trial early or reactivates a lapsed plan. */
  async activate(workspaceId: string, actor: Actor): Promise<SubscriptionView> {
    const current = await this.requireSubscription(workspaceId);
    if (current.status === 'ACTIVE') {
      throw BillingErrors.alreadyActive();
    }
    const { plan, price } = await this.purchasablePrice(
      current.plan.code,
      current.interval,
    );
    await this.assertUsageFits(workspaceId, plan);
    const charge = await this.charge(workspaceId, plan.code, price);
    const now = this.clock.now();

    const saved = await this.store.updateSubscription(workspaceId, {
      priceId: price.id,
      amountCents: price.amountCents,
      currency: price.currency,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, price.interval),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      provider: charge.provider,
      providerReference: charge.reference,
    });
    await this.audit.record({
      action: 'billing.subscription.activated',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'subscription',
      targetId: saved.id,
      context: actor.context,
      metadata: {
        plan: plan.code,
        interval: price.interval,
        from: current.status,
      },
    });
    return this.toView(saved);
  }

  /** Trial: ends now. Paid plan: stays usable until the end of the period. */
  async cancel(workspaceId: string, actor: Actor): Promise<SubscriptionView> {
    const current = await this.requireSubscription(workspaceId);
    const now = this.clock.now();

    let changes: Partial<SubscriptionWrite>;
    if (current.status === 'TRIALING') {
      changes = { status: 'CANCELED', canceledAt: now };
    } else if (current.status === 'ACTIVE' && !current.cancelAtPeriodEnd) {
      changes = { cancelAtPeriodEnd: true, canceledAt: now };
    } else {
      throw BillingErrors.nothingToCancel();
    }

    const saved = await this.store.updateSubscription(workspaceId, changes);
    await this.audit.record({
      action: 'billing.subscription.canceled',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'subscription',
      targetId: saved.id,
      context: actor.context,
      metadata: { atPeriodEnd: current.status === 'ACTIVE' },
    });
    return this.toView(saved);
  }

  /** Undoes a pending cancellation of a paid plan. */
  async resume(workspaceId: string, actor: Actor): Promise<SubscriptionView> {
    const current = await this.requireSubscription(workspaceId);
    if (current.status !== 'ACTIVE' || !current.cancelAtPeriodEnd) {
      throw BillingErrors.noPendingCancellation();
    }
    const saved = await this.store.updateSubscription(workspaceId, {
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
    await this.audit.record({
      action: 'billing.subscription.resumed',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'subscription',
      targetId: saved.id,
      context: actor.context,
    });
    return this.toView(saved);
  }

  // ─────────────────────────── Entitlements ───────────────────────────

  /** What the plan allows today (used by the team module for its limits). */
  async entitlements(
    workspaceId: string,
  ): Promise<WorkspaceEntitlementsView | null> {
    const subscription = await this.currentSubscription(workspaceId);
    if (!subscription) return null;
    const plan = await this.store.findPlanById(subscription.plan.id);
    return {
      planName: subscription.plan.name,
      hasFullAccess: hasFullAccess(subscription.status),
      features: plan?.features ?? {},
    };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /**
   * Reads the subscription and persists the effective status when the clock
   * moved past a trial or period end (no background job yet).
   */
  private async currentSubscription(
    workspaceId: string,
  ): Promise<SubscriptionRecord | null> {
    const subscription = await this.store.findSubscription(workspaceId);
    if (!subscription) return null;
    const status = effectiveStatus(subscription, this.clock.now());
    if (status === subscription.status) return subscription;
    return this.store.updateSubscription(workspaceId, { status });
  }

  private async requireSubscription(
    workspaceId: string,
  ): Promise<SubscriptionRecord> {
    const subscription = await this.currentSubscription(workspaceId);
    if (!subscription) throw BillingErrors.noSubscription();
    return subscription;
  }

  private async purchasablePrice(code: string, interval: BillingInterval) {
    const plan = await this.store.findPlan(code);
    const currency = this.config.get('BILLING_CURRENCY');
    const price = plan?.prices.find(
      (p) => p.interval === interval && p.currency === currency,
    );
    if (!plan || !plan.isActive || !plan.isPublic || !price) {
      throw BillingErrors.planUnavailable();
    }
    return { plan, price };
  }

  private async assertUsageFits(workspaceId: string, plan: PlanRecord) {
    const limit = plan.features['limits.agents'];
    const members = await this.store.countActiveMembers(workspaceId);
    if (typeof limit === 'number' || limit === null) {
      if (!fitsLimit(members, limit)) {
        throw BillingErrors.limitExceeded({
          feature: 'limits.agents',
          plan: plan.name,
          limit: limit ?? 0,
          usage: members,
        });
      }
    }
  }

  private async charge(
    workspaceId: string,
    planCode: string,
    price: PlanRecord['prices'][number],
  ) {
    try {
      return await this.payments.charge({
        workspaceId,
        planCode,
        interval: price.interval,
        amountCents: price.amountCents,
        currency: price.currency,
      });
    } catch (error: unknown) {
      if (error instanceof PaymentsUnavailableError) {
        throw BillingErrors.paymentsUnavailable();
      }
      throw error;
    }
  }

  private async toView(
    subscription: SubscriptionRecord,
  ): Promise<SubscriptionView> {
    const now = this.clock.now();
    const [plan, features, members] = await Promise.all([
      this.store.findPlanById(subscription.plan.id),
      this.store.listFeatures(),
      this.store.countActiveMembers(subscription.workspaceId),
    ]);
    const status = effectiveStatus(subscription, now);

    return {
      workspaceId: subscription.workspaceId,
      plan: { code: subscription.plan.code, name: subscription.plan.name },
      interval: subscription.interval,
      amountCents: subscription.amountCents,
      currency: subscription.currency,
      status,
      hasFullAccess: hasFullAccess(status),
      trialEndsAt: subscription.trialEndsAt,
      trialDaysLeft: trialDaysLeft(subscription, now),
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
      paymentsEnabled: this.payments.enabled,
      entitlements: features.map((feature) => ({
        key: feature.key,
        name: feature.name,
        kind: feature.kind,
        unit: feature.unit,
        value: plan?.features[feature.key] ?? null,
        usage: feature.key === 'limits.agents' ? members : null,
      })),
    };
  }
}
