/** Mirrors of the backend DTOs (see http://localhost:3000/docs). */

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'
export type WorkspaceStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'
export type MembershipStatus = 'ACTIVE' | 'DEACTIVATED'

export interface ErrorResponse {
  statusCode: number
  error: string
  message: string | string[]
  /** Stable code for errors the UI translates (see es.apiErrors). */
  code?: string
  details?: Record<string, unknown>
  requestId?: string
  timestamp: string
  path: string
}

export interface MessageResponse {
  message: string
}

export interface AccessTokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface AuthUser {
  id: string
  email: string
  displayName: string
  status: UserStatus
  emailVerified: boolean
}

export interface LoginResponse extends AccessTokenResponse {
  user: AuthUser
}

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
  workspaceName?: string
  planCode?: string
  interval?: BillingInterval
}

export interface MyWorkspace {
  id: string
  name: string
  slug: string
  status: WorkspaceStatus
  membershipStatus: MembershipStatus
  roles: string[]
  permissions: string[]
  plan: WorkspacePlan | null
}

export interface Me {
  id: string
  email: string
  displayName: string
  status: UserStatus
  emailVerified: boolean
  avatarUrl: string | null
  locale: string | null
  timezone: string | null
  createdAt: string
  lastLoginAt: string | null
  workspaces: MyWorkspace[]
}

export interface UpdateMeRequest {
  displayName?: string
  locale?: string | null
  timezone?: string | null
  avatarUrl?: string | null
}

export interface Session {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  current: boolean
}

// ─────────────────────────── Billing ───────────────────────────

export type BillingInterval = 'MONTH' | 'YEAR'
export type FeatureKind = 'LIMIT' | 'BOOLEAN' | 'TEXT'
export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'INCOMPLETE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
/** LIMIT: number (null = unlimited). BOOLEAN: included. TEXT: label or null. */
export type FeatureValue = number | boolean | string | null

export interface CatalogFeature {
  key: string
  name: string
  description: string | null
  kind: FeatureKind
  unit: string | null
  group: string | null
}

export interface PlanPrice {
  interval: BillingInterval
  currency: string
  amountCents: number
  monthlyEquivalentCents: number
}

export interface Plan {
  code: string
  name: string
  tagline: string | null
  description: string | null
  highlighted: boolean
  prices: PlanPrice[]
  yearlySavingsPercent: number
  features: { key: string; value: FeatureValue }[]
}

export interface PlanCatalog {
  currency: string
  trialDays: number
  defaultPlan: string
  paymentsEnabled: boolean
  features: CatalogFeature[]
  plans: Plan[]
}

export interface Entitlement {
  key: string
  name: string
  kind: FeatureKind
  unit: string | null
  value: FeatureValue
  usage: number | null
}

export interface Subscription {
  workspaceId: string
  plan: { code: string; name: string }
  interval: BillingInterval
  amountCents: number
  currency: string
  status: SubscriptionStatus
  hasFullAccess: boolean
  trialEndsAt: string | null
  trialDaysLeft: number
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  paymentsEnabled: boolean
  entitlements: Entitlement[]
}

/** Plan summary included in /users/me for every workspace. */
export interface WorkspacePlan {
  code: string
  name: string
  status: SubscriptionStatus
  hasFullAccess: boolean
  trialEndsAt: string | null
  trialDaysLeft: number
}
