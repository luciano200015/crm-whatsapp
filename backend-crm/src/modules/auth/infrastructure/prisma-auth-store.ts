import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  AuthStore,
  LoginCandidate,
  NewRegistration,
  NewSession,
  RefreshTokenRecord,
  RegistrationResult,
  Rotation,
  SessionForAuth,
  SessionRevokeReason,
  SessionSummary,
  UserSummary,
} from '../application/ports';
import { slugCandidates } from '../domain/slug';

const USER_SUMMARY = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  emailVerifiedAt: true,
} as const;

const MAX_REGISTRATION_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PrismaAuthStore extends AuthStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // ─────────────────────────── Registration ───────────────────────────

  async register(input: NewRegistration): Promise<RegistrationResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.registerOnce(input);
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
        // Either the email was taken concurrently or every slug candidate collided.
        if (await this.findUserByEmail(input.email)) {
          return { kind: 'email_taken' };
        }
        if (attempt >= MAX_REGISTRATION_ATTEMPTS) throw error;
      }
    }
  }

  private registerOnce(input: NewRegistration): Promise<RegistrationResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existing) return { kind: 'email_taken' } as const;

      const ownerRole = await tx.role.findFirst({
        where: { key: 'OWNER', workspaceId: null },
        select: { id: true },
      });
      if (!ownerRole) {
        throw new Error('System role OWNER is missing: run `npm run db:seed`');
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          credential: { create: { passwordHash: input.passwordHash } },
          emailVerificationTokens: {
            create: {
              tokenHash: input.verificationTokenHash,
              expiresAt: input.verificationExpiresAt,
            },
          },
        },
        select: { id: true },
      });

      const candidates = slugCandidates(input.workspaceName);
      const taken = new Set(
        (
          await tx.workspace.findMany({
            where: { slug: { in: candidates } },
            select: { slug: true },
          })
        ).map((workspace) => workspace.slug),
      );
      const slug =
        candidates.find((candidate) => !taken.has(candidate)) ??
        `${candidates[0] ?? 'workspace'}-${randomUUID().slice(0, 8)}`;

      const workspace = await tx.workspace.create({
        data: { name: input.workspaceName, slug, createdById: user.id },
        select: { id: true },
      });
      const membership = await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user.id },
        select: { id: true },
      });
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: ownerRole.id },
      });
      await tx.subscription.create({
        data: { workspaceId: workspace.id, ...input.subscription },
      });

      return {
        kind: 'created',
        userId: user.id,
        workspaceId: workspace.id,
      } as const;
    });
  }

  findUserByEmail(email: string): Promise<UserSummary | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: USER_SUMMARY,
    });
  }

  findUserById(userId: string): Promise<UserSummary | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SUMMARY,
    });
  }

  // ─────────────────────────── Login ───────────────────────────

  async findLoginCandidate(email: string): Promise<LoginCandidate | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...USER_SUMMARY, credential: true },
    });
    if (!user?.credential) return null;
    const { credential, ...summary } = user;
    return {
      ...summary,
      passwordHash: credential.passwordHash,
      failedLoginCount: credential.failedLoginCount,
      lockedUntil: credential.lockedUntil,
      mustChangePassword: credential.mustChangePassword,
    };
  }

  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockUntil: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const credential = await tx.userCredential.update({
        where: { userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (credential.failedLoginCount >= maxAttempts) {
        await tx.userCredential.update({
          where: { userId },
          data: { failedLoginCount: 0, lockedUntil: lockUntil },
        });
      }
    });
  }

  async recordSuccessfulLogin(userId: string, now: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: now,
        credential: {
          update: { failedLoginCount: 0, lockedUntil: null },
        },
      },
    });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.userCredential.update({
      where: { userId },
      data: { passwordHash },
    });
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId },
      select: { passwordHash: true },
    });
    return credential?.passwordHash ?? null;
  }

  // ─────────────────────────── Sessions ───────────────────────────

  async createSession(input: NewSession): Promise<{ sessionId: string }> {
    const session = await this.prisma.userSession.create({
      data: {
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
        refreshTokens: {
          create: {
            tokenHash: input.refreshTokenHash,
            expiresAt: input.refreshExpiresAt,
          },
        },
      },
      select: { id: true },
    });
    return { sessionId: session.id };
  }

  async findSessionForAuth(sessionId: string): Promise<SessionForAuth | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        status: true,
        expiresAt: true,
        user: {
          select: {
            status: true,
            credential: { select: { mustChangePassword: true } },
          },
        },
      },
    });
    if (!session) return null;
    const { user, ...rest } = session;
    return {
      ...rest,
      userStatus: user.status,
      mustChangePassword: user.credential?.mustChangePassword ?? false,
    };
  }

  listActiveSessions(userId: string, now: Date): Promise<SessionSummary[]> {
    return this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: now } },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevokeReason,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userSession.updateMany({
        where: { id: sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: reason },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      return count === 1;
    });
  }

  async revokeUserSessions(
    userId: string,
    reason: SessionRevokeReason,
    now: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    return this.prisma.$transaction((tx) =>
      this.revokeUserSessionsIn(tx, userId, reason, now, exceptSessionId),
    );
  }

  private async revokeUserSessionsIn(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: SessionRevokeReason,
    now: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    const sessionFilter: Prisma.UserSessionWhereInput = {
      userId,
      status: 'ACTIVE',
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    };
    await tx.refreshToken.updateMany({
      where: { revokedAt: null, session: sessionFilter },
      data: { revokedAt: now },
    });
    const { count } = await tx.userSession.updateMany({
      where: sessionFilter,
      data: { status: 'REVOKED', revokedAt: now, revokeReason: reason },
    });
    return count;
  }

  // ─────────────────────────── Refresh tokens ───────────────────────────

  async findRefreshToken(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        sessionId: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        session: {
          select: {
            userId: true,
            status: true,
            expiresAt: true,
            user: { select: { status: true } },
          },
        },
      },
    });
    if (!token) return null;
    const { user, ...session } = token.session;
    return { ...token, session: { ...session, userStatus: user.status } };
  }

  rotateRefreshToken(rotation: Rotation): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional update = compare-and-set. Under concurrency the second
      // request re-checks the WHERE after the first commits and matches 0 rows.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: rotation.tokenId, usedAt: null, revokedAt: null },
        data: { usedAt: rotation.now },
      });
      if (count !== 1) return false;

      await tx.refreshToken.create({
        data: {
          sessionId: rotation.sessionId,
          parentId: rotation.tokenId,
          tokenHash: rotation.newTokenHash,
          expiresAt: rotation.newExpiresAt,
        },
      });
      await tx.userSession.update({
        where: { id: rotation.sessionId },
        data: { lastUsedAt: rotation.now },
      });
      return true;
    });
  }

  // ─────────────────────────── Passwords ───────────────────────────

  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    requestedIp: string | null,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      // Only the most recent reset link stays valid.
      this.prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt, requestedIp },
      }),
    ]);
  }

  resetPassword(
    tokenHash: string,
    newPasswordHash: string,
    now: Date,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });
      if (!token) return null;

      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) return null;

      await tx.userCredential.update({
        where: { userId: token.userId },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
      });
      await this.revokeUserSessionsIn(
        tx,
        token.userId,
        'PASSWORD_CHANGED',
        now,
      );
      return token.userId;
    });
  }

  changePassword(
    userId: string,
    newPasswordHash: string,
    keepSessionId: string,
    now: Date,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.userCredential.findUniqueOrThrow({
        where: { userId },
        select: { mustChangePassword: true },
      });
      await tx.userCredential.update({
        where: { userId },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
        },
      });
      if (previous.mustChangePassword) {
        // Only the mailbox owner could know the emailed temporary password.
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: now },
        });
      }
      return this.revokeUserSessionsIn(
        tx,
        userId,
        'PASSWORD_CHANGED',
        now,
        keepSessionId,
      );
    });
  }

  // ─────────────────────────── Email verification ───────────────────────────

  async createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    requestedIp: string | null,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.emailVerificationToken.create({
        data: { userId, tokenHash, expiresAt, requestedIp },
      }),
    ]);
  }

  verifyEmail(tokenHash: string, now: Date): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });
      if (!token) return null;

      const { count } = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) return null;

      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      });
      // Only promote pending accounts; never re-activate suspended/disabled ones.
      await tx.user.updateMany({
        where: { id: token.userId, status: 'PENDING_VERIFICATION' },
        data: { status: 'ACTIVE' },
      });
      return token.userId;
    });
  }
}
