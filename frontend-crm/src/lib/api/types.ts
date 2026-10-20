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
  /** Temporary password from an admin: must be changed before using the app. */
  mustChangePassword: boolean
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

/** A role as seen by its member: system roles have workspaceId null in the API. */
export interface MyRole {
  id: string
  key: string
  name: string
  system: boolean
}

export interface MyWorkspace {
  id: string
  name: string
  slug: string
  status: WorkspaceStatus
  membershipStatus: MembershipStatus
  roles: MyRole[]
  permissions: string[]
  plan: WorkspacePlan | null
}

export interface Me {
  id: string
  email: string
  displayName: string
  status: UserStatus
  emailVerified: boolean
  mustChangePassword: boolean
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

// ─────────────────────────── Team ───────────────────────────

export interface Member {
  /** Membership id. */
  id: string
  userId: string
  email: string
  displayName: string
  avatarUrl: string | null
  status: MembershipStatus
  /** Still has the temporary password sent by email. */
  pendingFirstAccess: boolean
  lastLoginAt: string | null
  joinedAt: string
  deactivatedAt: string | null
  role: MyRole | null
  permissions: string[]
}

export interface MemberList {
  items: Member[]
  total: number
  /** Active members against limits.agents (null = unlimited). */
  usage: { activeMembers: number; limit: number | null }
}

export interface Role {
  id: string
  key: string
  name: string
  description: string | null
  /** System role: shared by every workspace and read-only. */
  system: boolean
  permissions: string[]
  memberCount: number
  createdAt: string
  updatedAt: string
}

export interface PermissionInfo {
  key: string
  group: string
  description: string
}

export interface NewMemberRequest {
  email: string
  displayName: string
  roleId: string
}

export interface RoleRequest {
  name: string
  description?: string | null
  permissions: string[]
}
