import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { RequestContext } from '../../../shared/http/request-context';
import { Mailer, MailMessage } from '../../../shared/mail/mailer';
import { TokenHasher } from '../../../shared/security/token-hasher';
import { Clock } from '../../../shared/time/clock';
import { AuditService } from '../../audit/audit.service';
import { normalizeEmail } from '../domain/email';
import { passwordPolicyViolations } from '../domain/password-policy';
import { authEmails } from './auth-emails';
import {
  AccessTokens,
  AuthStore,
  InitialSubscriptionProvider,
  type BillingInterval,
  PasswordHasher,
  SessionSummary,
  UserStatus,
  UserSummary,
} from './ports';

/** Failed attempts before a temporary lock, and how long the lock lasts. */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MINUTES = 15;

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid or expired session';
const BLOCKED_STATUSES: readonly UserStatus[] = ['SUSPENDED', 'DISABLED'];

export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Temporary password: everything except changing it is blocked. */
  mustChangePassword: boolean;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

export interface LoginResult extends IssuedTokens {
  user: UserSummary & { mustChangePassword: boolean };
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  workspaceName?: string;
  /** Plan code from the pricing page; BILLING_DEFAULT_PLAN when omitted. */
  planCode?: string;
  interval?: BillingInterval;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordHasher,
    private readonly accessTokens: AccessTokens,
    private readonly tokens: TokenHasher,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
    private readonly subscriptions: InitialSubscriptionProvider,
  ) {}

  // ─────────────────────────── Registration ───────────────────────────

  /**
   * Enumeration-safe: the caller gets the same answer whether or not the
   * email already has an account; the mailbox owner learns which case it was.
   */
  async register(input: RegisterInput, context: RequestContext): Promise<void> {
    const email = normalizeEmail(input.email);
    this.assertPasswordPolicy(input.password, email);
    // Invalid plan choices fail before any work is done.
    const subscription = await this.subscriptions.forSignup(
      input.planCode,
      input.interval,
    );

    // Hash before looking anything up so both paths cost the same time.
    const passwordHash = await this.passwords.hash(input.password);
    const verification = this.tokens.generate();
    const now = this.clock.now();
    const ttlHours = this.config.get('EMAIL_VERIFICATION_TTL_HOURS');
    const displayName = input.displayName.trim();

    const result = await this.store.register({
      email,
      displayName,
      passwordHash,
      workspaceName:
        input.workspaceName?.trim() || `${displayName}'s workspace`,
      verificationTokenHash: verification.hash,
      verificationExpiresAt: addMs(now, ttlHours * 3_600_000),
      subscription,
    });

    const webAppUrl = this.config.get('WEB_APP_URL');
    if (result.kind === 'email_taken') {
      const existing = await this.store.findUserByEmail(email);
      this.sendInBackground(authEmails.accountAlreadyExists(email, webAppUrl));
      await this.audit.record({
        action: 'auth.register.duplicate_email',
        targetType: 'user',
        targetId: existing?.id,
        context,
      });
      return;
    }

    this.sendInBackground(
      authEmails.verifyEmail(email, webAppUrl, verification.token, ttlHours),
    );
    await this.audit.record({
      action: 'auth.user.registered',
      actorUserId: result.userId,
      workspaceId: result.workspaceId,
      targetType: 'user',
      targetId: result.userId,
      context,
      metadata: {
        plan: input.planCode ?? 'default',
        trialEndsAt: subscription.trialEndsAt,
      },
    });
  }

  // ─────────────────────────── Login ───────────────────────────

  async login(
    rawEmail: string,
    password: string,
    context: RequestContext,
  ): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();
    const candidate = await this.store.findLoginCandidate(email);

    if (!candidate) {
      await this.passwords.verifyDummy(password);
      return this.loginFailed(null, 'unknown_email', context);
    }

    if (candidate.lockedUntil && candidate.lockedUntil > now) {
      await this.passwords.verifyDummy(password);
      return this.loginFailed(candidate.id, 'account_locked', context);
    }

    if (!(await this.passwords.verify(candidate.passwordHash, password))) {
      await this.store.recordFailedLogin(
        candidate.id,
        MAX_FAILED_LOGINS,
        addMs(now, LOGIN_LOCK_MINUTES * 60_000),
      );
      return this.loginFailed(candidate.id, 'bad_password', context);
    }

    // Checked after the password so a blocked status is never revealed to guessers.
    if (BLOCKED_STATUSES.includes(candidate.status)) {
      return this.loginFailed(candidate.id, 'account_blocked', context);
    }

    if (this.passwords.needsRehash(candidate.passwordHash)) {
      await this.store.updatePasswordHash(
        candidate.id,
        await this.passwords.hash(password),
      );
    }
    await this.store.recordSuccessfulLogin(candidate.id, now);

    const tokens = await this.startSession(candidate.id, context, now);
    await this.audit.record({
      action: 'auth.login.succeeded',
      actorUserId: candidate.id,
      targetType: 'session',
      targetId: tokens.sessionId,
      context,
    });

    const { id, displayName, status, emailVerifiedAt } = candidate;
    return {
      ...tokens,
      user: {
        id,
        email: candidate.email,
        displayName,
        status,
        emailVerifiedAt,
        mustChangePassword: candidate.mustChangePassword,
      },
    };
  }

  private async loginFailed(
    userId: string | null,
    reason: string,
    context: RequestContext,
  ): Promise<never> {
    await this.audit.record({
      action: 'auth.login.failed',
      actorUserId: userId,
      context,
      metadata: { reason },
    });
    throw new UnauthorizedException(INVALID_CREDENTIALS);
  }

  private async startSession(
    userId: string,
    context: RequestContext,
    now: Date,
  ): Promise<IssuedTokens> {
    const sessionExpiresAt = addMs(
      now,
      this.config.get('SESSION_MAX_AGE_DAYS') * 86_400_000,
    );
    const refreshExpiresAt = this.refreshExpiry(now, sessionExpiresAt);
    const refresh = this.tokens.generate();

    const { sessionId } = await this.store.createSession({
      userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      expiresAt: sessionExpiresAt,
      refreshTokenHash: refresh.hash,
      refreshExpiresAt,
    });
    const access = await this.accessTokens.issue({ userId, sessionId });

    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshExpiresAt,
      sessionId,
    };
  }

  // ─────────────────────────── Refresh ───────────────────────────

  /**
   * Rotates the refresh token. Presenting an already-used token outside the
   * grace window is treated as theft: the whole session is revoked.
   */
  async refresh(
    rawToken: string | undefined,
    context: RequestContext,
  ): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException(INVALID_REFRESH);

    const now = this.clock.now();
    const record = await this.store.findRefreshToken(
      this.tokens.hash(rawToken),
    );
    if (!record) throw new UnauthorizedException(INVALID_REFRESH);

    const { session } = record;
    if (
      session.status !== 'ACTIVE' ||
      session.expiresAt <= now ||
      record.revokedAt
    ) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    if (BLOCKED_STATUSES.includes(session.userStatus)) {
      await this.store.revokeSession(record.sessionId, 'ADMIN', now);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    if (record.usedAt) {
      const graceMs = this.config.get('REFRESH_REUSE_GRACE_SECONDS') * 1000;
      if (now.getTime() - record.usedAt.getTime() <= graceMs) {
        // Two tabs refreshing at once: reject the loser without punishing the user.
        throw new UnauthorizedException(INVALID_REFRESH);
      }
      await this.store.revokeSession(record.sessionId, 'REUSE_DETECTED', now);
      await this.audit.record({
        action: 'auth.refresh.reuse_detected',
        actorUserId: session.userId,
        targetType: 'session',
        targetId: record.sessionId,
        context,
      });
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    if (record.expiresAt <= now) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const next = this.tokens.generate();
    const refreshExpiresAt = this.refreshExpiry(now, session.expiresAt);
    const rotated = await this.store.rotateRefreshToken({
      tokenId: record.id,
      sessionId: record.sessionId,
      newTokenHash: next.hash,
      newExpiresAt: refreshExpiresAt,
      now,
    });
    if (!rotated) throw new UnauthorizedException(INVALID_REFRESH);

    const access = await this.accessTokens.issue({
      userId: session.userId,
      sessionId: record.sessionId,
    });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: next.token,
      refreshExpiresAt,
      sessionId: record.sessionId,
    };
  }

  private refreshExpiry(now: Date, sessionExpiresAt: Date): Date {
    const ttl = addMs(
      now,
      this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    );
    return ttl < sessionExpiresAt ? ttl : sessionExpiresAt;
  }

  // ─────────────────────────── Logout ───────────────────────────

  /** Idempotent: unknown or already-revoked tokens are not an error. */
  async logout(
    rawToken: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    if (!rawToken) return;
    const record = await this.store.findRefreshToken(
      this.tokens.hash(rawToken),
    );
    if (!record) return;

    const revoked = await this.store.revokeSession(
      record.sessionId,
      'LOGOUT',
      this.clock.now(),
    );
    if (revoked) {
      await this.audit.record({
        action: 'auth.logout',
        actorUserId: record.session.userId,
        targetType: 'session',
        targetId: record.sessionId,
        context,
      });
    }
  }

  // ─────────────────────────── Access token validation ───────────────────────────

  /**
   * Used by the auth guard on every request. Besides the JWT signature it
   * checks the session, so logout and revocation take effect immediately.
   */
  async authenticate(accessToken: string): Promise<AuthContext | null> {
    const claims = await this.accessTokens.verify(accessToken);
    if (!claims) return null;

    const session = await this.store.findSessionForAuth(claims.sessionId);
    if (
      !session ||
      session.userId !== claims.userId ||
      session.status !== 'ACTIVE' ||
      session.expiresAt <= this.clock.now() ||
      BLOCKED_STATUSES.includes(session.userStatus)
    ) {
      return null;
    }
    return {
      userId: claims.userId,
      sessionId: claims.sessionId,
      mustChangePassword: session.mustChangePassword,
    };
  }

  // ─────────────────────────── Passwords ───────────────────────────

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async requestPasswordReset(
    rawEmail: string,
    context: RequestContext,
  ): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.store.findUserByEmail(email);
    if (!user || BLOCKED_STATUSES.includes(user.status)) return;

    const now = this.clock.now();
    const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES');
    const reset = this.tokens.generate();
    await this.store.createPasswordResetToken(
      user.id,
      reset.hash,
      addMs(now, ttlMinutes * 60_000),
      context.ipAddress,
      now,
    );
    this.sendInBackground(
      authEmails.passwordReset(
        user.email,
        this.config.get('WEB_APP_URL'),
        reset.token,
        ttlMinutes,
      ),
    );
    await this.audit.record({
      action: 'auth.password_reset.requested',
      actorUserId: user.id,
      context,
    });
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertPasswordPolicy(newPassword);
    const newHash = await this.passwords.hash(newPassword);
    const userId = await this.store.resetPassword(
      this.tokens.hash(rawToken),
      newHash,
      this.clock.now(),
    );
    if (!userId) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.store.findUserById(userId);
    if (user) this.sendInBackground(authEmails.passwordChanged(user.email));
    await this.audit.record({
      action: 'auth.password_reset.completed',
      actorUserId: userId,
      context,
      metadata: { sessionsRevoked: 'all' },
    });
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const [user, currentHash] = await Promise.all([
      this.store.findUserById(auth.userId),
      this.store.getPasswordHash(auth.userId),
    ]);
    if (!user || !currentHash) throw new UnauthorizedException();

    if (!(await this.passwords.verify(currentHash, currentPassword))) {
      await this.audit.record({
        action: 'auth.password_change.failed',
        actorUserId: auth.userId,
        context,
      });
      throw new BadRequestException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }
    this.assertPasswordPolicy(newPassword, user.email);

    const revoked = await this.store.changePassword(
      auth.userId,
      await this.passwords.hash(newPassword),
      auth.sessionId,
      this.clock.now(),
    );
    this.sendInBackground(authEmails.passwordChanged(user.email));
    await this.audit.record({
      action: 'auth.password.changed',
      actorUserId: auth.userId,
      context,
      metadata: { otherSessionsRevoked: revoked },
    });
  }

  // ─────────────────────────── Email verification ───────────────────────────

  async verifyEmail(rawToken: string, context: RequestContext): Promise<void> {
    const userId = await this.store.verifyEmail(
      this.tokens.hash(rawToken),
      this.clock.now(),
    );
    if (!userId) {
      throw new BadRequestException('Invalid or expired verification token');
    }
    await this.audit.record({
      action: 'auth.email.verified',
      actorUserId: userId,
      context,
    });
  }

  async resendVerification(
    auth: AuthContext,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.store.findUserById(auth.userId);
    if (!user || user.emailVerifiedAt) return;

    const now = this.clock.now();
    const ttlHours = this.config.get('EMAIL_VERIFICATION_TTL_HOURS');
    const verification = this.tokens.generate();
    await this.store.createEmailVerificationToken(
      user.id,
      verification.hash,
      addMs(now, ttlHours * 3_600_000),
      context.ipAddress,
      now,
    );
    this.sendInBackground(
      authEmails.verifyEmail(
        user.email,
        this.config.get('WEB_APP_URL'),
        verification.token,
        ttlHours,
      ),
    );
  }

  // ─────────────────────────── Sessions ───────────────────────────

  async listSessions(
    auth: AuthContext,
  ): Promise<(SessionSummary & { current: boolean })[]> {
    const sessions = await this.store.listActiveSessions(
      auth.userId,
      this.clock.now(),
    );
    return sessions.map((session) => ({
      ...session,
      current: session.id === auth.sessionId,
    }));
  }

  async revokeSession(
    auth: AuthContext,
    sessionId: string,
    context: RequestContext,
  ): Promise<void> {
    const session = await this.store.findSessionForAuth(sessionId);
    // Someone else's session is reported exactly like a missing one.
    if (!session || session.userId !== auth.userId) {
      throw new NotFoundException('Session not found');
    }
    await this.store.revokeSession(sessionId, 'LOGOUT', this.clock.now());
    await this.audit.record({
      action: 'auth.session.revoked',
      actorUserId: auth.userId,
      targetType: 'session',
      targetId: sessionId,
      context,
    });
  }

  async revokeOtherSessions(
    auth: AuthContext,
    context: RequestContext,
  ): Promise<number> {
    const count = await this.store.revokeUserSessions(
      auth.userId,
      'LOGOUT',
      this.clock.now(),
      auth.sessionId,
    );
    await this.audit.record({
      action: 'auth.session.revoked_others',
      actorUserId: auth.userId,
      context,
      metadata: { count },
    });
    return count;
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private assertPasswordPolicy(password: string, email?: string): void {
    const violations = passwordPolicyViolations(password, { email });
    if (violations.length > 0) throw new BadRequestException(violations);
  }

  /**
   * Email delivery never blocks or fails the request, and its timing does not
   * reveal whether an account exists. Failures are logged without content.
   */
  private sendInBackground(message: MailMessage): void {
    this.mailer.send(message).catch((error: unknown) => {
      this.logger.error(
        `Failed to send "${message.subject}": ${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
      );
    });
  }
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
