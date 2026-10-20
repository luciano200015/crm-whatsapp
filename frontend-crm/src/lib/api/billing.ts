import { apiRequest } from './client'
import type { BillingInterval, PlanCatalog, Subscription } from './types'

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/subscription`

export const billingApi = {
  /** Public: works signed in or not. */
  catalog() {
    return apiRequest<PlanCatalog>('/billing/plans', { auth: false })
  },

  subscription(workspaceId: string) {
    return apiRequest<Subscription>(base(workspaceId))
  },

  changePlan(workspaceId: string, planCode: string, interval: BillingInterval) {
    return apiRequest<Subscription>(`${base(workspaceId)}/plan`, {
      method: 'PUT',
      body: { planCode, interval },
    })
  },

  activate(workspaceId: string) {
    return apiRequest<Subscription>(`${base(workspaceId)}/activate`, { method: 'POST' })
  },

  cancel(workspaceId: string) {
    return apiRequest<Subscription>(`${base(workspaceId)}/cancel`, { method: 'POST' })
  },

  resume(workspaceId: string) {
    return apiRequest<Subscription>(`${base(workspaceId)}/resume`, { method: 'POST' })
  },
}

export const catalogQueryKey = ['billing', 'catalog'] as const
export const subscriptionQueryKey = (workspaceId: string) =>
  ['billing', 'subscription', workspaceId] as const
