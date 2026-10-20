import { describe, expect, it } from 'vitest'
import { es } from '../i18n/es'
import { ApiError, errorMessage } from './api/errors'
import type { CatalogFeature } from './api/types'
import { featureLabel, formatMoney, statusTone } from './billing'

const limit: CatalogFeature = {
  key: 'limits.agents',
  name: 'Agentes',
  description: null,
  kind: 'LIMIT',
  unit: 'agentes',
  group: 'limits',
}

describe('formatMoney', () => {
  it('formats cents with the currency symbol', () => {
    expect(formatMoney(229_000, 'USD')).toBe('$2,290')
    expect(formatMoney(8_250, 'USD')).toBe('$82.50')
  })

  it('rounds to whole units when asked (monthly equivalents)', () => {
    expect(formatMoney(8_250, 'USD', true)).toBe('$83')
    expect(formatMoney(19_083, 'USD', true)).toBe('$191')
  })
})

describe('featureLabel', () => {
  it('describes limits, unlimited and missing quotas', () => {
    expect(featureLabel(limit, 15_000)).toBe('15,000 agentes')
    expect(featureLabel(limit, null)).toBe(es.billing.unlimited)
    expect(featureLabel(limit, 0)).toBe(false)
  })

  it('passes booleans through and shows text values', () => {
    expect(featureLabel({ ...limit, kind: 'BOOLEAN', unit: null }, true)).toBe(true)
    expect(featureLabel({ ...limit, kind: 'BOOLEAN', unit: null }, false)).toBe(false)
    expect(featureLabel({ ...limit, kind: 'TEXT', unit: null }, 'Semanal')).toBe('Semanal')
    expect(featureLabel({ ...limit, kind: 'TEXT', unit: null }, null)).toBe(false)
  })
})

describe('statusTone', () => {
  it('maps every status to a color', () => {
    expect(statusTone('ACTIVE')).toBe('success')
    expect(statusTone('TRIALING')).toBe('info')
    expect(statusTone('PAST_DUE')).toBe('warning')
    expect(statusTone('EXPIRED')).toBe('error')
  })
})

describe('errorMessage with API error codes', () => {
  const apiError = (status: number, code: string, details?: Record<string, unknown>) =>
    new ApiError(status, {
      statusCode: status,
      error: 'Conflict',
      message: 'English message from the API',
      code,
      details,
      timestamp: '',
      path: '',
    })

  it('translates known codes, with details', () => {
    expect(
      errorMessage(apiError(409, 'PLAN_LIMIT_EXCEEDED', { plan: 'Equipo', limit: 3, usage: 4 })),
    ).toBe(es.apiErrors.PLAN_LIMIT_EXCEEDED({ plan: 'Equipo', limit: 3, usage: 4 }))
    expect(errorMessage(apiError(402, 'PAYMENTS_UNAVAILABLE'))).toBe(
      es.apiErrors.PAYMENTS_UNAVAILABLE,
    )
  })

  it('falls back to the API message for unknown codes', () => {
    expect(errorMessage(apiError(409, 'SOMETHING_NEW'))).toBe('English message from the API')
  })
})
