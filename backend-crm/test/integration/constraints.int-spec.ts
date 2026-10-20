import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, errorCodeOf, truncateAll } from '../utils/test-db';

const UNIQUE_VIOLATION = 'P2002';

const tokenHash = () => randomBytes(32).toString('hex');

describe('PostgreSQL constraints (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createUser = (email: string) =>
    prisma.user.create({ data: { email, displayName: 'Test User' } });

  const createWorkspace = (slug: string) =>
    prisma.workspace.create({ data: { name: 'Acme', slug } });

  const createRole = (key: string, workspaceId: string | null = null) =>
    prisma.role.create({
      data: { key, name: key, workspaceId, isSystem: workspaceId === null },
    });

  describe('users', () => {
    it('rejects a duplicate email', async () => {
      await createUser('ana@example.com');
      expect(await errorCodeOf(createUser('ana@example.com'))).toBe(
        UNIQUE_VIOLATION,
      );
    });

    it('rejects emails that are not normalized', async () => {
      await expect(createUser('Ana@Example.com')).rejects.toThrow(
        /users_email_normalized_check/,
      );
      await expect(createUser(' ana@example.com')).rejects.toThrow(
        /users_email_normalized_check/,
      );
    });

    it('lets exactly one of two concurrent sign-ups with the same email win', async () => {
      const results = await Promise.allSettled([
        createUser('race@example.com'),
        createUser('race@example.com'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.user.count()).toBe(1);
    });

    it('cascades credentials and sessions when a user is deleted', async () => {
      const user = await createUser('gone@example.com');
      await prisma.userCredential.create({
        data: { userId: user.id, passwordHash: '$argon2id$placeholder' },
      });
      const session = await prisma.userSession.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: tokenHash(),
          expiresAt: session.expiresAt,
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      expect(await prisma.userCredential.count()).toBe(0);
      expect(await prisma.userSession.count()).toBe(0);
      expect(await prisma.refreshToken.count()).toBe(0);
    });
  });

  describe('refresh tokens', () => {
    it('rejects a duplicate token hash and a second child of the same token', async () => {
      const user = await createUser('rt@example.com');
      const session = await prisma.userSession.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      const base = { sessionId: session.id, expiresAt: session.expiresAt };
      const hash = tokenHash();
      const parent = await prisma.refreshToken.create({
        data: { ...base, tokenHash: hash },
      });

      expect(
        await errorCodeOf(
          prisma.refreshToken.create({ data: { ...base, tokenHash: hash } }),
        ),
      ).toBe(UNIQUE_VIOLATION);

      // A token can be rotated only once: parentId is unique.
      await prisma.refreshToken.create({
        data: { ...base, tokenHash: tokenHash(), parentId: parent.id },
      });
      expect(
        await errorCodeOf(
          prisma.refreshToken.create({
            data: { ...base, tokenHash: tokenHash(), parentId: parent.id },
          }),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });
  });

  describe('workspaces', () => {
    it('rejects a duplicate slug', async () => {
      await createWorkspace('acme');
      expect(await errorCodeOf(createWorkspace('acme'))).toBe(UNIQUE_VIOLATION);
    });

    it.each(['Acme', 'acme_corp', '-acme', 'acme-', 'acme corp'])(
      'rejects the invalid slug %p',
      async (slug) => {
        await expect(createWorkspace(slug)).rejects.toThrow(
          /workspaces_slug_format_check/,
        );
      },
    );

    it('rejects slugs longer than 63 characters', async () => {
      await expect(createWorkspace('a'.repeat(64))).rejects.toThrow(/too long/);
      await expect(createWorkspace('a'.repeat(63))).resolves.toBeDefined();
    });

    it('rejects a duplicate membership for the same user and workspace', async () => {
      const user = await createUser('member@example.com');
      const workspace = await createWorkspace('acme');
      const data = { userId: user.id, workspaceId: workspace.id };

      await prisma.workspaceMembership.create({ data });
      expect(
        await errorCodeOf(prisma.workspaceMembership.create({ data })),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('lets the same user belong to several workspaces', async () => {
      const user = await createUser('multi@example.com');
      const first = await createWorkspace('first');
      const second = await createWorkspace('second');

      await prisma.workspaceMembership.createMany({
        data: [
          { userId: user.id, workspaceId: first.id },
          { userId: user.id, workspaceId: second.id },
        ],
      });

      expect(
        await prisma.workspaceMembership.count({ where: { userId: user.id } }),
      ).toBe(2);
    });

    it('does not delete a workspace that still has members', async () => {
      const user = await createUser('keep@example.com');
      const workspace = await createWorkspace('keep');
      await prisma.workspaceMembership.create({
        data: { userId: user.id, workspaceId: workspace.id },
      });

      await expect(
        prisma.workspace.delete({ where: { id: workspace.id } }),
      ).rejects.toThrow();
    });
  });

  describe('roles', () => {
    it('rejects two system roles with the same key', async () => {
      await createRole('OWNER');
      expect(await errorCodeOf(createRole('OWNER'))).toBe(UNIQUE_VIOLATION);
    });

    it('scopes custom role keys to their workspace', async () => {
      const acme = await createWorkspace('acme');
      const globex = await createWorkspace('globex');

      await createRole('SUPPORT', acme.id);
      await createRole('SUPPORT', globex.id);
      expect(await errorCodeOf(createRole('SUPPORT', acme.id))).toBe(
        UNIQUE_VIOLATION,
      );
    });

    it('keeps is_system consistent with workspace_id (null = system role)', async () => {
      const workspace = await createWorkspace('acme');
      await expect(
        prisma.role.create({
          data: { key: 'X', name: 'X', workspaceId: null, isSystem: false },
        }),
      ).rejects.toThrow(/roles_system_scope_check/);
      await expect(
        prisma.role.create({
          data: {
            key: 'x',
            name: 'x',
            workspaceId: workspace.id,
            isSystem: true,
          },
        }),
      ).rejects.toThrow(/roles_system_scope_check/);
    });

    it('rejects assigning the same role twice to a membership', async () => {
      const user = await createUser('roles@example.com');
      const workspace = await createWorkspace('acme');
      const role = await createRole('AGENT');
      const membership = await prisma.workspaceMembership.create({
        data: { userId: user.id, workspaceId: workspace.id },
      });
      const data = { membershipId: membership.id, roleId: role.id };

      await prisma.membershipRole.create({ data });
      expect(await errorCodeOf(prisma.membershipRole.create({ data }))).toBe(
        UNIQUE_VIOLATION,
      );
    });
  });

  describe('invitations', () => {
    it('allows only one pending invitation per workspace and email', async () => {
      const workspace = await createWorkspace('acme');
      const role = await createRole('AGENT');
      const invite = () =>
        prisma.workspaceInvitation.create({
          data: {
            workspaceId: workspace.id,
            email: 'new@example.com',
            roleId: role.id,
            tokenHash: tokenHash(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        });

      const first = await invite();
      expect(await errorCodeOf(invite())).toBe(UNIQUE_VIOLATION);

      // Once the first one is no longer pending, a new invitation is allowed.
      await prisma.workspaceInvitation.update({
        where: { id: first.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await expect(invite()).resolves.toMatchObject({ status: 'PENDING' });
    });

    it('rejects invitation emails that are not normalized', async () => {
      const workspace = await createWorkspace('acme');
      const role = await createRole('AGENT');

      await expect(
        prisma.workspaceInvitation.create({
          data: {
            workspaceId: workspace.id,
            email: 'New@Example.com',
            roleId: role.id,
            tokenHash: tokenHash(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow(/workspace_invitations_email_normalized_check/);
    });
  });

  describe('transactions', () => {
    it('rolls back every write when one statement fails', async () => {
      await createWorkspace('taken');

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: { email: 'rollback@example.com', displayName: 'Rollback' },
          });
          await tx.workspace.create({ data: { name: 'Dup', slug: 'taken' } });
        }),
      ).rejects.toThrow();

      expect(
        await prisma.user.count({ where: { email: 'rollback@example.com' } }),
      ).toBe(0);
    });
  });
});
