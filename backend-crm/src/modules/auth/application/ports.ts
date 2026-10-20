import type {
  SessionRevokeReason,
  SessionStatus,
  UserStatus,
} from '../../../generated/prisma/client';

export type { SessionRevokeReason, SessionStatus, UserStatus };

// ─────────────────────────── Password hashing ───────────────────────────

export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  abstract verify(hash: string, password: string): Promise<boolean>;
  /** Spends the same time as a real verification (unknown-user logins). */
  abstract verifyDummy(password: string): Promise<void>;
  abstract needsRehash(hash: string): boolean;
}

// ─────────────────────────── Access tokens ───────────────────────────

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export abstract class AccessTokens {
  abstract issue(
    claims: AccessTokenClaims,
  ): Promise<{ token: string; expiresIn: number }>;
  /** Returns null for any invalid, expired or forged token. */
  abstract verify(token: string): Promise<AccessTokenClaims | null>;
}

// ─────────────────────────── Persistence ───────────────────────────

export interface LoginCandidate {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

export interface RefreshTokenRecord {
  id: string;
  sessionId: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  session: {
    userId: string;
    status: SessionStatus;
    expiresAt: Date;
    userStatus: UserStatus;
  };
}

export interface SessionForAuth {
  id: string;
  userId: string;
  status: SessionStatus;
  expiresAt: Date;
  userStatus: UserStatus;
}

export interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

export type RegistrationResult =
  | { kind: 'created'; userId: string; workspaceId: string }
  | { kind: 'email_taken' };

export interface NewRegistration {
  email: string;
  displayName: string;
  passwordHash: string;
  workspaceName: string;
  verificationTokenHash: string;
  verificationExpiresAt: Date;
  /** Plan the new workspace starts with, created in the same transaction. */
  subscription: InitialSubscription;
}

// ─────────────────────────── Billing (sign-up plan) ───────────────────────────

export type BillingInterval = 'MONTH' | 'YEAR';

export interface InitialSubscription {
  planId: string;
  priceId: string | null;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  status: 'TRIALING' | 'INCOMPLETE';
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}

/**
 * Decides which plan (and trial) a new workspace gets. Implemented by the
 * billing module; auth only depends on this interface.
 */
export abstract class InitialSubscriptionProvider {
  /** Throws BadRequestException for an unknown or unavailable plan. */
  abstract forSignup(
    planCode?: string,
    interval?: BillingInterval,
  ): Promise<InitialSubscription>;
}

export interface NewSession {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
}

export interface Rotation {
  tokenId: string;
  sessionId: string;
  newTokenHash: string;
  newExpiresAt: Date;
  now: Date;
}

/**
 * Persistence port for the auth use cases. Each method is one atomic
 * operation; implementations own their transactions.
 */
export abstract class AuthStore {
  abstract register(input: NewRegistration): Promise<RegistrationResult>;
  abstract findUserByEmail(email: string): Promise<UserSummary | null>;
  abstract findUserById(userId: string): Promise<UserSummary | null>;

  abstract findLoginCandidate(email: string): Promise<LoginCandidate | null>;
  /** Increments the failure counter; locks the account when it reaches maxAttempts. */
  abstract recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockUntil: Date,
  ): Promise<void>;
  abstract recordSuccessfulLogin(userId: string, now: Date): Promise<void>;
  abstract updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void>;
  abstract getPasswordHash(userId: string): Promise<string | null>;

  abstract createSession(input: NewSession): Promise<{ sessionId: string }>;
  abstract findSessionForAuth(
    sessionId: string,
  ): Promise<SessionForAuth | null>;
  abstract listActiveSessions(
    userId: string,
    now: Date,
  ): Promise<SessionSummary[]>;
  /** Revokes the session and every refresh token in it. Returns false if it was not active. */
  abstract revokeSession(
    sessionId: string,
    reason: SessionRevokeReason,
    now: Date,
  ): Promise<boolean>;
  abstract revokeUserSessions(
    userId: string,
    reason: SessionRevokeReason,
    now: Date,
    exceptSessionId?: string,
  ): Promise<number>;

  abstract findRefreshToken(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null>;
  /**
   * Marks the token used and issues its successor atomically. Returns false
   * if another request already consumed it (lost race).
   */
  abstract rotateRefreshToken(rotation: Rotation): Promise<boolean>;

  abstract createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    requestedIp: string | null,
    now: Date,
  ): Promise<void>;
  /**
   * Consumes a valid reset token, stores the new hash and revokes every
   * session, in one transaction. Returns the user id or null if invalid.
   */
  abstract resetPassword(
    tokenHash: string,
    newPasswordHash: string,
    now: Date,
  ): Promise<string | null>;
  abstract changePassword(
    userId: string,
    newPasswordHash: string,
    keepSessionId: string,
    now: Date,
  ): Promise<number>;

  abstract createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    requestedIp: string | null,
    now: Date,
  ): Promise<void>;
  /** Consumes a valid token and marks the email verified. Returns the user id or null. */
  abstract verifyEmail(tokenHash: string, now: Date): Promise<string | null>;
}
