import type {
  BillingInterval,
  FeatureKey,
  FeatureKind,
  FeatureValue,
} from '../domain/plan-catalog';
import type { SubscriptionStatus } from '../domain/subscription-rules';

export interface CatalogFeature {
  key: FeatureKey;
  name: string;
  description: string | null;
  kind: FeatureKind;
  unit: string | null;
  group: string | null;
}

export interface PlanPriceRecord {
  id: string;
  interval: BillingInterval;
  currency: string;
  amountCents: number;
}

export interface PlanRecord {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isHighlighted: boolean;
  isPublic: boolean;
  isActive: boolean;
  prices: PlanPriceRecord[];
  /** Feature key → value (number|null for limits, boolean, string|null). */
  features: Partial<Record<FeatureKey, FeatureValue>>;
}

export interface SubscriptionRecord {
  id: string;
  workspaceId: string;
  plan: { id: string; code: string; name: string };
  priceId: string | null;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  status: SubscriptionStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  provider: string;
}

/** Everything needed to create or replace a workspace's subscription. */
export interface SubscriptionWrite {
  planId: string;
  priceId: string | null;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  status: SubscriptionStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  provider: string;
  providerReference: string | null;
}

export abstract class BillingStore {
  abstract listFeatures(): Promise<CatalogFeature[]>;
  /** Plans ordered by sort order, with prices and features. */
  abstract listPlans(filter: { publicOnly: boolean }): Promise<PlanRecord[]>;
  abstract findPlan(code: string): Promise<PlanRecord | null>;
  abstract findPlanById(id: string): Promise<PlanRecord | null>;
  abstract findSubscription(
    workspaceId: string,
  ): Promise<SubscriptionRecord | null>;
  /** Creates or replaces the workspace's single subscription row. */
  abstract saveSubscription(
    workspaceId: string,
    data: SubscriptionWrite,
  ): Promise<SubscriptionRecord>;
  abstract updateSubscription(
    workspaceId: string,
    data: Partial<SubscriptionWrite>,
  ): Promise<SubscriptionRecord>;
  abstract countActiveMembers(workspaceId: string): Promise<number>;
}

export interface ChargeRequest {
  workspaceId: string;
  planCode: string;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
}

export class PaymentsUnavailableError extends Error {
  constructor() {
    super('Online payments are not available yet');
    this.name = 'PaymentsUnavailableError';
  }
}

/**
 * Port for collecting money. Today: "simulated" (development) or "disabled".
 * A real provider (Stripe, etc.) will implement the same interface.
 */
export abstract class PaymentGateway {
  abstract readonly enabled: boolean;
  /** Throws PaymentsUnavailableError when payments are disabled. */
  abstract charge(
    request: ChargeRequest,
  ): Promise<{ provider: string; reference: string }>;
}
