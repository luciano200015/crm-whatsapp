import type {
  FeatureKey,
  FeatureValue,
} from '../../modules/billing/domain/plan-catalog';

export interface WorkspaceEntitlementsView {
  planName: string;
  /** Trial running or paid: creating new members, lines… is allowed. */
  hasFullAccess: boolean;
  /** number|null for limits (null = unlimited), boolean for inclusions. */
  features: Partial<Record<FeatureKey, FeatureValue>>;
}

/**
 * What a workspace's plan allows. Implemented by the billing module
 * (BillingService); team, channels and other modules only depend on this.
 */
export abstract class WorkspaceEntitlements {
  /** Null when the workspace has no subscription. */
  abstract entitlements(
    workspaceId: string,
  ): Promise<WorkspaceEntitlementsView | null>;
}

/** A LIMIT feature of the plan: a number, or null for unlimited/unknown. */
export function planLimit(
  plan: WorkspaceEntitlementsView,
  key: FeatureKey,
): number | null {
  const value = plan.features[key];
  return typeof value === 'number' ? value : null;
}
