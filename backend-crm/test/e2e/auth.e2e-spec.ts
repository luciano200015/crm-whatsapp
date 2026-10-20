import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateAll } from '../utils/test-db';
import {
  cookieFrom,
  createTestApp,
  setCookieHeader,
  type TestApp,
} from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

interface Session {
  accessToken: string;
  refreshCookie: string;
  csrf: string;
}

describe('Auth (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let emailCounter = 0;

  const http = () => request(t.app.getHttpServer());
  const uniqueEmail = () => `user${++emailCounter}@example.com`;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await prisma.$disconnect();
  });

  function register(email: string, password = PASSWORD) {
    return http().post('/api/v1/auth/register').send({
      email,
      password,
      displayName: 'Test User',
      workspaceName: 'Acme',
    });
  }

  async function login(email: string, password = PASSWORD): Promise<Session> {
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      accessToken: (response.body as { accessToken: string }).accessToken,
      refreshCookie: cookieFrom(response, 'crm_rt') ?? '',
      csrf: cookieFrom(response, 'crm_csrf') ?? '',
    };
  }

  async function registeredUser(): Promise<{
    email: string;
    session: Session;
  }> {
    const email = uniqueEmail();
    await register(email).expect(202);
    return { email, session: await login(email) };
  }

  function refresh(session: Session, csrf = session.csrf) {
    return http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', [
        `crm_rt=${session.refreshCookie}`,
        `crm_csrf=${session.csrf}`,
      ])
      .set('X-CSRF-Token', csrf);
  }

  const me = (accessToken: string) =>
    http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

  // ─────────────────────────── Registration ───────────────────────────

  describe('register', () => {
    it('creates user, workspace and OWNER membership in one go', async () => {
      const email = uniqueEmail();
      const response = await register(email).expect(202);
      expect(response.body).toHaveProperty('message');

      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: {
          credential: true,
          memberships: {
            include: { workspace: true, roles: { include: { role: true } } },
          },
        },
      });
      expect(user.status).toBe('PENDING_VERIFICATION');
      expect(user.credential?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.credential?.passwordHash).not.toContain(PASSWORD);
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]?.workspace.slug).toMatch(
        /^acme(-[0-9a-f]{6})?$/,
      );
      expect(user.memberships[0]?.roles.map((r) => r.role.key)).toEqual([
        'OWNER',
      ]);
      expect(t.mailer.last(email).subject).toBe('Confirm your email address');
    });

    it('normalizes the email before storing it', async () => {
      await register('  Mixed.Case@Example.COM ').expect(202);
      await expect(
        prisma.user.count({ where: { email: 'mixed.case@example.com' } }),
      ).resolves.toBe(1);
    });

    it('gives an identical answer for an existing email (no enumeration)', async () => {
      const email = uniqueEmail();
      const first = await register(email).expect(202);
      const second = await register(email).expect(202);

      expect(second.body).toEqual(first.body);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(t.mailer.last(email).subject).toBe(
        'Someone tried to sign up with your email',
      );
    });

    it('creates a single account under concurrent sign-ups', async () => {
      const email = uniqueEmail();
      const responses = await Promise.all([register(email), register(email)]);

      expect(responses.map((r) => r.status)).toEqual([202, 202]);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it.each([
      ['a weak password', { password: 'short' }],
      ['an invalid email', { email: 'not-an-email' }],
      ['an unexpected field', { role: 'OWNER' }],
    ])('rejects %s', async (_case, patch) => {
      await http()
        .post('/api/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: PASSWORD,
          displayName: 'X',
          ...patch,
        })
        .expect(400);
    });
  });

  // ─────────────────────────── Login ───────────────────────────

  describe('login', () => {
    it('returns an access token and secure cookies', async () => {
      const email = uniqueEmail();
      await register(email).expect(202);

      const response = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      expect(response.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { email, emailVerified: false, status: 'PENDING_VERIFICATION' },
      });
      const refreshCookie = setCookieHeader(response, 'crm_rt') ?? '';
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
      expect(setCookieHeader(response, 'crm_csrf')).not.toMatch(/HttpOnly/i);
      // The refresh token travels only in the HttpOnly cookie, never in the body.
      expect(JSON.stringify(response.body)).not.toContain(
        cookieFrom(response, 'crm_rt') ?? '<none>',
      );
    });

    it('fails identically for a wrong password and an unknown email', async () => {
      const email = uniqueEmail();
      await register(email).expect(202);

      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong password!!' })
        .expect(401);
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong password!!' })
        .expect(401);

      expect((wrong.body as { message: string }).message).toBe(
        GENERIC_LOGIN_ERROR,
      );
      expect((unknown.body as { message: string }).message).toBe(
        GENERIC_LOGIN_ERROR,
      );
      expect(setCookieHeader(wrong, 'crm_rt')).toBeUndefined();
    });

    it('locks the account after 5 failures, even for the right password', async () => {
      const email = uniqueEmail();
      await register(email).expect(202);

      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong password!!' })
          .expect(401);
      }
      const locked = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);

      expect((locked.body as { message: string }).message).toBe(
        GENERIC_LOGIN_ERROR,
      );
      const credential = await prisma.userCredential.findFirstOrThrow({
        where: { user: { email } },
      });
      expect(credential.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects suspended accounts with the generic error', async () => {
      const email = uniqueEmail();
      await register(email).expect(202);
      await prisma.user.update({
        where: { email },
        data: { status: 'SUSPENDED' },
      });

      const response = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      expect((response.body as { message: string }).message).toBe(
        GENERIC_LOGIN_ERROR,
      );
    });
  });

  // ─────────────────────────── Access token ───────────────────────────

  describe('access token', () => {
    it('grants access to /users/me with workspace roles and permissions', async () => {
      const { email, session } = await registeredUser();

      const response = await me(session.accessToken).expect(200);

      expect(response.body).toMatchObject({
        email,
        emailVerified: false,
        mustChangePassword: false,
      });
      const [workspace] = (response.body as { workspaces: unknown })
        .workspaces as {
        roles: { key: string; name: string; system: boolean }[];
        permissions: string[];
      }[];
      expect(workspace?.roles).toEqual([
        expect.objectContaining({ key: 'OWNER', name: 'Owner', system: true }),
      ]);
      expect(workspace?.permissions).toContain('billing.manage');
    });

    it('requires a token', async () => {
      await http().get('/api/v1/users/me').expect(401);
      await http()
        .get('/api/v1/users/me')
        .set('Authorization', 'Basic abc')
        .expect(401);
    });

    describe('rejects forged and invalid JWTs', () => {
      const b64url = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');

      function es256(payload: object, privateKey: string): string {
        const unsigned = `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url(payload)}`;
        const signature = sign('sha256', Buffer.from(unsigned), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url');
        return `${unsigned}.${signature}`;
      }

      let claims: Record<string, unknown>;
      let session: Session;

      beforeAll(async () => {
        ({ session } = await registeredUser());
        const [, payload] = session.accessToken.split('.');
        claims = JSON.parse(
          Buffer.from(payload ?? '', 'base64url').toString(),
        ) as Record<string, unknown>;
      });

      it('accepts a token we sign ourselves with the real key (control)', async () => {
        const token = es256(claims, t.config.get('JWT_PRIVATE_KEY'));
        await me(token).expect(200);
      });

      it('rejects alg=none', async () => {
        const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
        await me(token).expect(401);
      });

      it('rejects HS256 signed with the public key (algorithm confusion)', async () => {
        const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}`;
        const signature = createHmac('sha256', t.config.get('JWT_PUBLIC_KEY'))
          .update(unsigned)
          .digest('base64url');
        await me(`${unsigned}.${signature}`).expect(401);
      });

      it('rejects a token signed with another key', async () => {
        const { privateKey } = generateKeyPairSync('ec', {
          namedCurve: 'P-256',
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        await me(es256(claims, privateKey)).expect(401);
      });

      it('rejects a tampered payload', async () => {
        const [header, , signature] = session.accessToken.split('.');
        const tampered = `${header}.${b64url({ ...claims, sub: '00000000-0000-0000-0000-000000000000' })}.${signature}`;
        await me(tampered).expect(401);
      });

      it.each([
        ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
        ['wrong issuer', { iss: 'someone-else' }],
        ['wrong audience', { aud: 'another-api' }],
      ])(
        'rejects an %s token signed with the real key',
        async (_case, patch) => {
          const token = es256(
            { ...claims, ...patch },
            t.config.get('JWT_PRIVATE_KEY'),
          );
          await me(token).expect(401);
        },
      );
    });
  });

  // ─────────────────────────── Refresh ───────────────────────────

  describe('refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const { session } = await registeredUser();

      const response = await refresh(session).expect(200);

      const newCookie = cookieFrom(response, 'crm_rt');
      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(session.refreshCookie);
      await me((response.body as { accessToken: string }).accessToken).expect(
        200,
      );
    });

    it('requires a matching CSRF header', async () => {
      const { session } = await registeredUser();

      await refresh(session, '').expect(403);
      await refresh(session, 'not-the-cookie-value').expect(403);
    });

    it('rejects a request without the refresh cookie', async () => {
      const { session } = await registeredUser();
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`crm_csrf=${session.csrf}`])
        .set('X-CSRF-Token', session.csrf)
        .expect(401);
    });

    it('revokes the whole session when an old refresh token is reused', async () => {
      const { session } = await registeredUser();
      const rotated = await refresh(session).expect(200);
      const newAccess = (rotated.body as { accessToken: string }).accessToken;

      // Move the use of the old token outside the grace window.
      await prisma.refreshToken.updateMany({
        where: { usedAt: { not: null } },
        data: { usedAt: new Date(Date.now() - 60_000) },
      });

      await refresh(session).expect(401);

      // Theft response: the rotated tokens of that session stop working too.
      await me(newAccess).expect(401);
      await refresh({
        ...session,
        refreshCookie: cookieFrom(rotated, 'crm_rt') ?? '',
      }).expect(401);
      const revoked = await prisma.userSession.findFirstOrThrow({
        where: { revokeReason: 'REUSE_DETECTED' },
      });
      expect(revoked.status).toBe('REVOKED');
    });

    it('lets exactly one of two concurrent refreshes win, without revoking', async () => {
      const { session } = await registeredUser();

      const responses = await Promise.all([refresh(session), refresh(session)]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
      const winner = responses.find((r) => r.status === 200);
      await me((winner?.body as { accessToken: string }).accessToken).expect(
        200,
      );
    });

    it('rejects an expired refresh token', async () => {
      const { session } = await registeredUser();
      await prisma.refreshToken.updateMany({
        where: { usedAt: null, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await refresh(session).expect(401);
    });
  });

  // ─────────────────────────── Logout & sessions ───────────────────────────

  describe('logout and sessions', () => {
    it('revokes the session: access and refresh stop working', async () => {
      const { session } = await registeredUser();

      const response = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', [
          `crm_rt=${session.refreshCookie}`,
          `crm_csrf=${session.csrf}`,
        ])
        .set('X-CSRF-Token', session.csrf)
        .expect(204);

      expect(setCookieHeader(response, 'crm_rt')).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
      await me(session.accessToken).expect(401);
      await refresh(session).expect(401);
    });

    it('is idempotent and requires CSRF', async () => {
      const { session } = await registeredUser();
      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', [`crm_rt=${session.refreshCookie}`])
        .expect(403);
      for (let i = 0; i < 2; i++) {
        await http()
          .post('/api/v1/auth/logout')
          .set('Cookie', [
            `crm_rt=${session.refreshCookie}`,
            `crm_csrf=${session.csrf}`,
          ])
          .set('X-CSRF-Token', session.csrf)
          .expect(204);
      }
    });

    it('lists my sessions and lets me revoke one, but not someone else’s', async () => {
      const { email, session: first } = await registeredUser();
      const second = await login(email);
      const { session: stranger } = await registeredUser();

      const list = await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${first.accessToken}`)
        .expect(200);
      const sessions = list.body as { id: string; current: boolean }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
      const other = sessions.find((s) => !s.current);

      const strangerSessions = await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(200);
      const strangerId = (strangerSessions.body as { id: string }[])[0]?.id;

      // Horizontal access: someone else's session looks like a missing one.
      await http()
        .delete(`/api/v1/auth/sessions/${strangerId}`)
        .set('Authorization', `Bearer ${first.accessToken}`)
        .expect(404);
      await me(stranger.accessToken).expect(200);

      await http()
        .delete(`/api/v1/auth/sessions/${other?.id}`)
        .set('Authorization', `Bearer ${first.accessToken}`)
        .expect(204);
      await me(second.accessToken).expect(401);
      await me(first.accessToken).expect(200);
    });

    it('revokes every other session on request', async () => {
      const { email, session: current } = await registeredUser();
      const other = await login(email);

      const response = await http()
        .post('/api/v1/auth/sessions/revoke-others')
        .set('Authorization', `Bearer ${current.accessToken}`)
        .expect(200);

      expect(response.body).toEqual({ revoked: 1 });
      await me(other.accessToken).expect(401);
      await me(current.accessToken).expect(200);
    });
  });

  // ─────────────────────────── Passwords ───────────────────────────

  describe('password recovery', () => {
    it('answers identically for known and unknown emails', async () => {
      const { email } = await registeredUser();
      const sentBefore = t.mailer.sent.length;

      const known = await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      const unknown = await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'ghost@example.com' })
        .expect(202);

      expect(unknown.body).toEqual(known.body);
      expect(t.mailer.sent.length).toBe(sentBefore + 1);
    });

    it('resets the password once and signs out every session', async () => {
      const { email, session } = await registeredUser();
      await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      const token = t.mailer.tokenIn(
        t.mailer.last(email, 'Reset your password'),
      );

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      await me(session.accessToken).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      await login(email, NEW_PASSWORD);

      // Single use.
      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'yet another passphrase' })
        .expect(400);

      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { user: { email } },
      });
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('invalidates older reset links and rejects expired ones', async () => {
      const { email } = await registeredUser();
      await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      const older = t.mailer.tokenIn(
        t.mailer.last(email, 'Reset your password'),
      );
      await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      const newer = t.mailer.tokenIn(
        t.mailer.last(email, 'Reset your password'),
      );

      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: older, newPassword: NEW_PASSWORD })
        .expect(400);

      await prisma.passwordResetToken.updateMany({
        where: { user: { email }, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: newer, newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('changes the password with the current one and keeps only this session', async () => {
      const { email, session } = await registeredUser();
      const other = await login(email);
      const change = (currentPassword: string) =>
        http()
          .post('/api/v1/auth/password/change')
          .set('Authorization', `Bearer ${session.accessToken}`)
          .send({ currentPassword, newPassword: NEW_PASSWORD });

      await change('not my password').expect(400);
      await change(PASSWORD).expect(204);

      await me(session.accessToken).expect(200);
      await me(other.accessToken).expect(401);
      await login(email, NEW_PASSWORD);
    });
  });

  // ─────────────────────────── Email verification ───────────────────────────

  describe('email verification', () => {
    it('verifies the email once and activates the account', async () => {
      const email = uniqueEmail();
      await register(email).expect(202);
      const token = t.mailer.tokenIn(
        t.mailer.last(email, 'Confirm your email address'),
      );

      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token })
        .expect(204);
      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token })
        .expect(400);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.status).toBe('ACTIVE');
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('rejects malformed tokens before hitting the database', async () => {
      await http()
        .post('/api/v1/auth/email/verify')
        .send({ token: "' OR 1=1 --" })
        .expect(400);
    });
  });

  // ─────────────────────────── Leaks ───────────────────────────

  describe('secrets never leak', () => {
    it('keeps passwords and tokens out of audit logs', async () => {
      const { session } = await registeredUser();
      await refresh(session).expect(200);

      const logs = await prisma.auditLog.findMany();
      const dump = JSON.stringify(logs);
      expect(logs.length).toBeGreaterThan(0);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toContain(session.refreshCookie);
      expect(dump).not.toContain(session.accessToken);
    });
  });
});

describe('Auth rate limiting (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ AUTH_THROTTLE_LIMIT: 3 });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('answers 429 once an IP exceeds the login limit', async () => {
    const attempt = () =>
      request(t.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'brute@example.com', password: 'guess guess guess' });

    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
