import type { BillingInterval } from './plan-catalog';

export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'INCOMPLETE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export interface SubscriptionTimeline {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * The stored status can lag behind the clock (no background job yet), so
 * callers always use the effective status:
 * - a trial past its end is EXPIRED;
 * - a paid period past its end is CANCELED if it was set to cancel, else PAST_DUE.
 */
export function effectiveStatus(
  subscription: SubscriptionTimeline,
  now: Date,
): SubscriptionStatus {
  const { status, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd } =
    subscription;
  if (status === 'TRIALING' && trialEndsAt && trialEndsAt <= now)
    return 'EXPIRED';
  if (status === 'ACTIVE' && currentPeriodEnd && currentPeriodEnd <= now) {
    return cancelAtPeriodEnd ? 'CANCELED' : 'PAST_DUE';
  }
  return status;
}

/** Statuses in which the workspace has full use of its plan. */
export function hasFullAccess(status: SubscriptionStatus): boolean {
  return status === 'TRIALING' || status === 'ACTIVE';
}

/** Whole days left in the trial, rounded up (0 when not trialing). */
export function trialDaysLeft(
  subscription: SubscriptionTimeline,
  now: Date,
): number {
  if (
    effectiveStatus(subscription, now) !== 'TRIALING' ||
    !subscription.trialEndsAt
  )
    return 0;
  const ms = subscription.trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function trialWindow(
  now: Date,
  days: number,
): { startsAt: Date; endsAt: Date } | null {
  if (days <= 0) return null;
  return { startsAt: now, endsAt: new Date(now.getTime() + days * 86_400_000) };
}

/**
 * Adds one billing interval in calendar terms, clamping to the end of the
 * month (Jan 31 + 1 month = Feb 28/29; Feb 29 + 1 year = Feb 28).
 */
export function addInterval(date: Date, interval: BillingInterval): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  if (interval === 'MONTH') result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Percentage saved by paying yearly instead of 12 monthly payments. */
export function yearlySavingsPercent(
  monthlyCents: number,
  yearlyCents: number,
): number {
  if (monthlyCents <= 0) return 0;
  return Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
}

/** True when `limit` (null = unlimited) can hold `usage`. */
export function fitsLimit(usage: number, limit: number | null): boolean {
  return limit === null || usage <= limit;
}
