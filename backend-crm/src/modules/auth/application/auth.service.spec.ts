import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { AppConfigService } from '../../../config/app-config.service';
import type { Env } from '../../../config/env.schema';
import type { TokenHasher } from '../../../shared/security/token-hasher';
import type { AuditService } from '../../audit/audit.service';
import { AuthService, MAX_FAILED_LOGINS } from './auth.service';
import type {
  AccessTokens,
  AuthStore,
  LoginCandidate,
  PasswordHasher,
  RefreshTokenRecord,
} from './ports';

const NOW = new Date('2026-10-19T12:00:00Z');
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000);
const context = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'r1' };

const configValues: Partial<Env> = {
  EMAIL_VERIFICATION_TTL_HOURS: 24,
  PASSWORD_RESET_TTL_MINUTES: 30,
  SESSION_MAX_AGE_DAYS: 30,
  REFRESH_TOKEN_TTL_DAYS: 7,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  WEB_APP_URL: 'http://localhost:5173',
};

type Mocked<T> = { [K in keyof T]: jest.Mock };

function setup() {
  const store = {
    register: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    findLoginCandidate: jest.fn(),
    recordFailedLogin: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    updatePasswordHash: jest.fn(),
    getPasswordHash: jest.fn(),
    createSession: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
    findSessionForAuth: jest.fn(),
    listActiveSessions: jest.fn(),
    revokeSession: jest.fn().mockResolvedValue(true),
    revokeUserSessions: jest.fn(),
    findRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn().mockResolvedValue(true),
    createPasswordResetToken: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    createEmailVerificationToken: jest.fn(),
    verifyEmail: jest.fn(),
  } satisfies Mocked<AuthStore>;
  const passwords = {
    hash: jest.fn().mockResolvedValue('$argon2id$new'),
    verify: jest.fn(),
    verifyDummy: jest.fn().mockResolvedValue(undefined),
    needsRehash: jest.fn().mockReturnValue(false),
  } satisfies Mocked<PasswordHasher>;
  const accessTokens = {
    issue: jest.fn().mockResolvedValue({ token: 'jwt', expiresIn: 900 }),
    verify: jest.fn(),
  } satisfies Mocked<AccessTokens>;
  let counter = 0;
  const tokens = {
    generate: jest.fn(() => {
      counter++;
      return { token: `token-${counter}`, hash: `hash-${counter}` };
    }),
    hash: jest.fn((token: string) => `hash(${token})`),
  };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (key: keyof Env) => configValues[key],
  } as unknown as AppConfigService;
  const clock = { now: () => NOW };

  const subscriptions = {
    forSignup: jest.fn().mockResolvedValue({
      planId: 'plan-team',
      priceId: 'price-team-month',
      interval: 'MONTH',
      amountCents: 9_900,
      currency: 'USD',
      status: 'TRIALING',
      trialStartedAt: NOW,
      trialEndsAt: seconds(7 * 86_400),
    }),
  };
  const service = new AuthService(
    store,
    passwords,
    accessTokens,
    tokens as unknown as TokenHasher,
    mailer,
    audit as unknown as AuditService,
    config,
    clock,
    subscriptions,
  );
  return {
    service,
    store,
    passwords,
    accessTokens,
    mailer,
    audit,
    subscriptions,
  };
}

const candidate = (
  overrides: Partial<LoginCandidate> = {},
): LoginCandidate => ({
  id: 'user-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  status: 'ACTIVE',
  emailVerifiedAt: null,
  passwordHash: '$argon2id$old',
  failedLoginCount: 0,
  lockedUntil: null,
  mustChangePassword: false,
  ...overrides,
});

const refreshRecord = (
  overrides: Partial<RefreshTokenRecord> = {},
  session: Partial<RefreshTokenRecord['session']> = {},
): RefreshTokenRecord => ({
  id: 'rt-1',
  sessionId: 'session-1',
  usedAt: null,
  revokedAt: null,
  expiresAt: seconds(3600),
  ...overrides,
  session: {
    userId: 'user-1',
    status: 'ACTIVE',
    expiresAt: seconds(86_400),
    userStatus: 'ACTIVE',
    ...session,
  },
});

describe('AuthService', () => {
  describe('login', () => {
    it('signs in with valid credentials and starts a session', async () => {
      const { service, store, passwords } = setup();
      store.findLoginCandidate.mockResolvedValue(candidate());
      passwords.verify.mockResolvedValue(true);

      const result = await service.login(' Ana@Example.com ', 'pw', context);

      expect(store.findLoginCandidate).toHaveBeenCalledWith('ana@example.com');
      expect(store.recordSuccessfulLogin).toHaveBeenCalledWith('user-1', NOW);
      expect(store.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          refreshTokenHash: 'hash-1',
        }),
      );
      expect(result).toMatchObject({
        accessToken: 'jwt',
        refreshToken: 'token-1',
        sessionId: 'session-1',
        user: { id: 'user-1', email: 'ana@example.com' },
      });
      // Refresh tokens expire before the session's absolute limit.
      expect(result.refreshExpiresAt).toEqual(seconds(7 * 86_400));
    });

    it('spends hashing time and fails generically for an unknown email', async () => {
      const { service, store, passwords } = setup();
      store.findLoginCandidate.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', 'pw', context),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
      expect(passwords.verifyDummy).toHaveBeenCalled();
      expect(store.createSession).not.toHaveBeenCalled();
    });

    it('records a failure with the lock policy on a wrong password', async () => {
      const { service, store, passwords } = setup();
      store.findLoginCandidate.mockResolvedValue(candidate());
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login('ana@example.com', 'bad', context),
      ).rejects.toThrow('Invalid email or password');
      expect(store.recordFailedLogin).toHaveBeenCalledWith(
        'user-1',
        MAX_FAILED_LOGINS,
        seconds(15 * 60),
      );
    });

    it('rejects a locked account without checking the password', async () => {
      const { service, store, passwords } = setup();
      store.findLoginCandidate.mockResolvedValue(
        candidate({ lockedUntil: seconds(60) }),
      );

      await expect(
        service.login('ana@example.com', 'pw', context),
      ).rejects.toThrow('Invalid email or password');
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(passwords.verifyDummy).toHaveBeenCalled();
    });

    it.each(['SUSPENDED', 'DISABLED'] as const)(
      'rejects a %s account with the same generic error',
      async (status) => {
        const { service, store, passwords } = setup();
        store.findLoginCandidate.mockResolvedValue(candidate({ status }));
        passwords.verify.mockResolvedValue(true);

        await expect(
          service.login('ana@example.com', 'pw', context),
        ).rejects.toThrow('Invalid email or password');
        expect(store.createSession).not.toHaveBeenCalled();
      },
    );

    it('upgrades the hash when parameters changed', async () => {
      const { service, store, passwords } = setup();
      store.findLoginCandidate.mockResolvedValue(candidate());
      passwords.verify.mockResolvedValue(true);
      passwords.needsRehash.mockReturnValue(true);

      await service.login('ana@example.com', 'pw', context);

      expect(store.updatePasswordHash).toHaveBeenCalledWith(
        'user-1',
        '$argon2id$new',
      );
    });
  });

  describe('refresh', () => {
    it('rotates a valid token', async () => {
      const { service, store } = setup();
      store.findRefreshToken.mockResolvedValue(refreshRecord());

      const result = await service.refresh('raw', context);

      expect(store.findRefreshToken).toHaveBeenCalledWith('hash(raw)');
      expect(store.rotateRefreshToken).toHaveBeenCalledWith({
        tokenId: 'rt-1',
        sessionId: 'session-1',
        newTokenHash: 'hash-1',
        newExpiresAt: seconds(86_400), // capped by the session's absolute expiry
        now: NOW,
      });
      expect(result).toMatchObject({
        accessToken: 'jwt',
        refreshToken: 'token-1',
      });
    });

    it.each([
      ['missing cookie', undefined, null],
      ['unknown token', 'raw', null],
      ['expired token', 'raw', refreshRecord({ expiresAt: seconds(-1) })],
      ['revoked token', 'raw', refreshRecord({ revokedAt: seconds(-60) })],
      ['revoked session', 'raw', refreshRecord({}, { status: 'REVOKED' })],
      ['expired session', 'raw', refreshRecord({}, { expiresAt: seconds(-1) })],
    ])('rejects a %s', async (_case, raw, record) => {
      const { service, store } = setup();
      store.findRefreshToken.mockResolvedValue(record);

      await expect(service.refresh(raw, context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(store.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('revokes the session when an old token is reused after the grace window', async () => {
      const { service, store, audit } = setup();
      store.findRefreshToken.mockResolvedValue(
        refreshRecord({ usedAt: seconds(-11) }),
      );

      await expect(service.refresh('raw', context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(store.revokeSession).toHaveBeenCalledWith(
        'session-1',
        'REUSE_DETECTED',
        NOW,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.refresh.reuse_detected' }),
      );
    });

    it('rejects a concurrent duplicate inside the grace window without revoking', async () => {
      const { service, store } = setup();
      store.findRefreshToken.mockResolvedValue(
        refreshRecord({ usedAt: seconds(-2) }),
      );

      await expect(service.refresh('raw', context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(store.revokeSession).not.toHaveBeenCalled();
    });

    it('rejects the loser of a rotation race', async () => {
      const { service, store, accessTokens } = setup();
      store.findRefreshToken.mockResolvedValue(refreshRecord());
      store.rotateRefreshToken.mockResolvedValue(false);

      await expect(service.refresh('raw', context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(accessTokens.issue).not.toHaveBeenCalled();
    });

    it('revokes the session of a user who was suspended', async () => {
      const { service, store } = setup();
      store.findRefreshToken.mockResolvedValue(
        refreshRecord({}, { userStatus: 'SUSPENDED' }),
      );

      await expect(service.refresh('raw', context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(store.revokeSession).toHaveBeenCalledWith(
        'session-1',
        'ADMIN',
        NOW,
      );
    });
  });

  describe('authenticate', () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      status: 'ACTIVE',
      expiresAt: seconds(60),
      userStatus: 'ACTIVE',
      mustChangePassword: false,
    };

    it('accepts a valid token bound to an active session', async () => {
      const { service, store, accessTokens } = setup();
      accessTokens.verify.mockResolvedValue({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      store.findSessionForAuth.mockResolvedValue(session);

      await expect(service.authenticate('jwt')).resolves.toEqual({
        userId: 'user-1',
        sessionId: 'session-1',
        mustChangePassword: false,
      });
    });

    it('reports a pending temporary password so the guard can block the route', async () => {
      const { service, store, accessTokens } = setup();
      accessTokens.verify.mockResolvedValue({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      store.findSessionForAuth.mockResolvedValue({
        ...session,
        mustChangePassword: true,
      });

      await expect(service.authenticate('jwt')).resolves.toMatchObject({
        mustChangePassword: true,
      });
    });

    it.each([
      ['invalid JWT', null, session],
      ['missing session', { userId: 'user-1', sessionId: 'session-1' }, null],
      [
        'revoked session',
        { userId: 'user-1', sessionId: 'session-1' },
        { ...session, status: 'REVOKED' },
      ],
      [
        'session of another user',
        { userId: 'user-2', sessionId: 'session-1' },
        session,
      ],
      [
        'suspended user',
        { userId: 'user-1', sessionId: 'session-1' },
        { ...session, userStatus: 'SUSPENDED' },
      ],
    ])('rejects a %s', async (_case, claims, found) => {
      const { service, store, accessTokens } = setup();
      accessTokens.verify.mockResolvedValue(claims);
      store.findSessionForAuth.mockResolvedValue(found);

      await expect(service.authenticate('jwt')).resolves.toBeNull();
    });
  });

  describe('register', () => {
    const input = {
      email: 'Ana@Example.com',
      password: 'correct horse battery staple',
      displayName: 'Ana',
    };

    it('creates the account and emails a verification token', async () => {
      const { service, store, mailer } = setup();
      store.register.mockResolvedValue({
        kind: 'created',
        userId: 'u',
        workspaceId: 'w',
      });

      await service.register(input, context);

      expect(store.register).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ana@example.com',
          workspaceName: "Ana's workspace",
          passwordHash: '$argon2id$new',
        }),
      );
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Confirm your email address' }),
      );
    });

    it('answers the same way for a taken email but warns the owner by email', async () => {
      const { service, store, mailer, passwords } = setup();
      store.register.mockResolvedValue({ kind: 'email_taken' });

      await expect(service.register(input, context)).resolves.toBeUndefined();
      expect(passwords.hash).toHaveBeenCalled(); // same cost as a real sign-up
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Someone tried to sign up with your email',
        }),
      );
    });

    it('rejects a weak password before touching the database', async () => {
      const { service, store } = setup();

      await expect(
        service.register({ ...input, password: 'short' }, context),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(store.register).not.toHaveBeenCalled();
    });
  });

  describe('password reset', () => {
    it('does nothing visible for an unknown email', async () => {
      const { service, store, mailer } = setup();
      store.findUserByEmail.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset('nobody@example.com', context),
      ).resolves.toBeUndefined();
      expect(store.createPasswordResetToken).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('rejects an invalid or used token', async () => {
      const { service, store } = setup();
      store.resetPassword.mockResolvedValue(null);

      await expect(
        service.resetPassword('raw', 'a brand new passphrase', context),
      ).rejects.toThrow('Invalid or expired reset token');
    });
  });
});
