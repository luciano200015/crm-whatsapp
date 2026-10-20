import { es } from '../i18n/es'
import type {
  BillingInterval,
  CatalogFeature,
  FeatureValue,
  Plan,
  PlanPrice,
  SubscriptionStatus,
} from './api/types'

/** Latin American Spanish: "$2,290" and "5,000", like most pricing pages in the region. */
export const NUMBER_LOCALE = 'es-419'

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE).format(value)
}

/** `wholeUnits` rounds to whole dollars (used for "per month" equivalents of yearly prices). */
export function formatMoney(cents: number, currency: string, wholeUnits = false): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: wholeUnits || cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: wholeUnits ? 0 : 2,
  }).format(cents / 100)
}

export function priceFor(plan: Plan, interval: BillingInterval): PlanPrice | undefined {
  return plan.prices.find((price) => price.interval === interval)
}

/** Human value of a feature in a plan: "10 agentes", "Ilimitado", "Mensual", or a boolean. */
export function featureLabel(feature: CatalogFeature, value: FeatureValue): string | boolean {
  if (feature.kind === 'BOOLEAN') return value === true
  if (feature.kind === 'TEXT') return typeof value === 'string' ? value : false
  if (value === null) return es.billing.unlimited
  if (value === 0) return false
  const amount = formatNumber(Number(value))
  return feature.unit ? `${amount} ${feature.unit}` : amount
}

export function planFeatureValue(plan: Plan, key: string): FeatureValue {
  return plan.features.find((feature) => feature.key === key)?.value ?? null
}

export type StatusTone = 'success' | 'info' | 'warning' | 'error'

export function statusTone(status: SubscriptionStatus): StatusTone {
  switch (status) {
    case 'ACTIVE':
      return 'success'
    case 'TRIALING':
      return 'info'
    case 'PAST_DUE':
    case 'INCOMPLETE':
      return 'warning'
    case 'EXPIRED':
    case 'CANCELED':
      return 'error'
  }
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date(value))
}
