import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  ChannelsStore,
  type LineRecord,
  type LineSecrets,
  type LineUpdate,
  type NewLine,
} from '../application/ports';

const LINE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  provider: true,
  phoneNumberId: true,
  wabaId: true,
  displayPhone: true,
  verifiedName: true,
  accessTokenLast4: true,
  webhookVerifyToken: true,
  status: true,
  lastError: true,
  lastWebhookAt: true,
  autoAssign: true,
  createdAt: true,
  updatedAt: true,
  agents: {
    orderBy: { assignedAt: 'asc' },
    select: {
      membership: {
        select: {
          id: true,
          status: true,
          user: { select: { id: true, displayName: true, email: true } },
        },
      },
    },
  },
} as const satisfies Prisma.ChannelLineSelect;

type LineRow = Prisma.ChannelLineGetPayload<{ select: typeof LINE_SELECT }>;

function toLine(row: LineRow): LineRecord {
  const { agents, ...line } = row;
  return {
    ...line,
    agents: agents.map(({ membership }) => ({
      membershipId: membership.id,
      userId: membership.user.id,
      displayName: membership.user.displayName,
      email: membership.user.email,
      status: membership.status,
    })),
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class PrismaChannelsStore extends ChannelsStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listLines(workspaceId: string): Promise<LineRecord[]> {
    const rows = await this.prisma.channelLine.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: LINE_SELECT,
    });
    return rows.map(toLine);
  }

  async findLine(
    workspaceId: string,
    lineId: string,
  ): Promise<LineRecord | null> {
    const row = await this.prisma.channelLine.findFirst({
      where: { id: lineId, workspaceId },
      select: LINE_SELECT,
    });
    return row ? toLine(row) : null;
  }

  async findLineById(lineId: string): Promise<LineRecord | null> {
    const row = await this.prisma.channelLine.findUnique({
      where: { id: lineId },
      select: LINE_SELECT,
    });
    return row ? toLine(row) : null;
  }

  async findLinesByPhoneNumberIds(
    workspaceId: string,
    phoneNumberIds: string[],
  ): Promise<LineRecord[]> {
    const rows = await this.prisma.channelLine.findMany({
      where: { workspaceId, phoneNumberId: { in: phoneNumberIds } },
      select: LINE_SELECT,
    });
    return rows.map(toLine);
  }

  getSecrets(lineId: string): Promise<LineSecrets | null> {
    return this.prisma.channelLine.findUnique({
      where: { id: lineId },
      select: { accessTokenEnc: true, appSecretEnc: true },
    });
  }

  async createLine(
    workspaceId: string,
    data: NewLine,
    maxLines: number | null,
  ): Promise<
    | LineRecord
    | { kind: 'limit_reached'; lines: number }
    | { kind: 'phone_number_taken' }
  > {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serializes concurrent creations so the plan limit holds.
        await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId}::uuid FOR UPDATE`;
        const lines = await tx.channelLine.count({ where: { workspaceId } });
        if (maxLines !== null && lines >= maxLines) {
          return { kind: 'limit_reached', lines } as const;
        }
        const row = await tx.channelLine.create({
          data: { workspaceId, ...data },
          select: LINE_SELECT,
        });
        return toLine(row);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return { kind: 'phone_number_taken' };
      throw error;
    }
  }

  async updateLine(
    workspaceId: string,
    lineId: string,
    data: LineUpdate,
  ): Promise<LineRecord | 'phone_number_taken' | null> {
    try {
      const { count } = await this.prisma.channelLine.updateMany({
        where: { id: lineId, workspaceId },
        data,
      });
      return count === 1 ? this.findLine(workspaceId, lineId) : null;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return 'phone_number_taken';
      throw error;
    }
  }

  async deleteLine(workspaceId: string, lineId: string): Promise<boolean> {
    const { count } = await this.prisma.channelLine.deleteMany({
      where: { id: lineId, workspaceId },
    });
    return count === 1;
  }

  async setAgents(
    workspaceId: string,
    lineId: string,
    membershipIds: string[],
  ): Promise<LineRecord | 'member_not_found' | null> {
    const unique = [...new Set(membershipIds)];
    const result = await this.prisma.$transaction(async (tx) => {
      const line = await tx.channelLine.findFirst({
        where: { id: lineId, workspaceId },
        select: { id: true },
      });
      if (!line) return null;
      const members = await tx.workspaceMembership.count({
        where: { id: { in: unique }, workspaceId, status: 'ACTIVE' },
      });
      if (members !== unique.length) return 'member_not_found' as const;
      await tx.channelLineAgent.deleteMany({ where: { lineId } });
      await tx.channelLineAgent.createMany({
        data: unique.map((membershipId) => ({ lineId, membershipId })),
      });
      return 'ok' as const;
    });
    if (result !== 'ok') return result;
    return this.findLine(workspaceId, lineId);
  }

  async recordWebhook(lineId: string, at: Date): Promise<void> {
    await this.prisma.channelLine.update({
      where: { id: lineId },
      data: { lastWebhookAt: at },
    });
    await this.prisma.channelLine.updateMany({
      where: { id: lineId, status: { in: ['PENDING', 'ERROR'] } },
      data: { status: 'CONNECTED', lastError: null },
    });
  }

  async recordSignatureFailure(lineId: string, message: string): Promise<void> {
    // Conditional, so repeated failures do not rewrite the row.
    await this.prisma.channelLine.updateMany({
      where: {
        id: lineId,
        status: { not: 'DISABLED' },
        OR: [{ lastError: null }, { lastError: { not: message } }],
      },
      data: { status: 'ERROR', lastError: message },
    });
  }

  async recordVerification(lineId: string, at: Date): Promise<void> {
    await this.prisma.channelLine.update({
      where: { id: lineId },
      data: { lastWebhookAt: at },
    });
  }
}
