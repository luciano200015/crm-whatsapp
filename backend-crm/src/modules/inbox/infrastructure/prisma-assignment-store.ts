import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import type { UserStatus } from '../../../generated/prisma/client';
import { pickNextAgent } from '../domain/inbox-rules';
import {
  AssignmentStore,
  type Assignee,
  type LineBot,
  type LineInfo,
  type MemberReach,
} from '../application/ports';

/**
 * Users who cannot sign in. Unverified users (PENDING_VERIFICATION) can, so
 * they can attend and be assigned conversations.
 */
const BLOCKED_USER_STATUSES: UserStatus[] = ['SUSPENDED', 'DISABLED'];

@Injectable()
export class PrismaAssignmentStore extends AssignmentStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async activeMembers(workspaceId: string): Promise<Assignee[]> {
    const members = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        user: { status: { notIn: BLOCKED_USER_STATUSES } },
      },
      select: { id: true, user: { select: { id: true, displayName: true } } },
    });
    return members.map((member) => ({
      membershipId: member.id,
      userId: member.user.id,
      name: member.user.displayName,
    }));
  }

  async membersReach(workspaceId: string): Promise<MemberReach[]> {
    const members = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        user: { status: { notIn: BLOCKED_USER_STATUSES } },
      },
      select: {
        id: true,
        user: { select: { id: true, displayName: true } },
        lines: { select: { lineId: true } },
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  where: { permission: { key: 'conversations.view_all' } },
                  select: { permissionId: true },
                },
              },
            },
          },
        },
      },
    });
    return members.map((member) => ({
      membershipId: member.id,
      userId: member.user.id,
      name: member.user.displayName,
      lineIds: member.lines.map((line) => line.lineId),
      viewAll: member.roles.some(({ role }) => role.permissions.length > 0),
    }));
  }

  /**
   * Round-robin under a row lock on the line, so two conversations arriving
   * at the same time go to different agents.
   */
  nextAgent(lineId: string): Promise<Assignee | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "channel_lines" WHERE "id" = ${lineId}::uuid FOR UPDATE`;
      const line = await tx.channelLine.findUnique({
        where: { id: lineId },
        select: {
          lastAssignedMembershipId: true,
          agents: {
            where: {
              membership: {
                status: 'ACTIVE',
                user: { status: { notIn: BLOCKED_USER_STATUSES } },
              },
            },
            orderBy: [{ assignedAt: 'asc' }, { membershipId: 'asc' }],
            select: {
              membership: {
                select: {
                  id: true,
                  user: { select: { id: true, displayName: true } },
                },
              },
            },
          },
        },
      });
      if (!line) return null;
      const agents = line.agents.map(({ membership }) => membership);
      const nextId = pickNextAgent(
        agents.map((agent) => agent.id),
        line.lastAssignedMembershipId,
      );
      const next = agents.find((agent) => agent.id === nextId);
      if (!next) return null;
      await tx.channelLine.update({
        where: { id: lineId },
        data: { lastAssignedMembershipId: next.id },
      });
      return {
        membershipId: next.id,
        userId: next.user.id,
        name: next.user.displayName,
      };
    });
  }

  async agentLineIds(
    workspaceId: string,
    membershipId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.channelLineAgent.findMany({
      where: { membershipId, line: { workspaceId } },
      select: { lineId: true },
    });
    return rows.map((row) => row.lineId);
  }

  async activeMember(
    workspaceId: string,
    membershipId: string,
  ): Promise<Assignee | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: membershipId,
        workspaceId,
        status: 'ACTIVE',
        user: { status: { notIn: BLOCKED_USER_STATUSES } },
      },
      select: { id: true, user: { select: { id: true, displayName: true } } },
    });
    return membership
      ? {
          membershipId: membership.id,
          userId: membership.user.id,
          name: membership.user.displayName,
        }
      : null;
  }

  async lineInfo(workspaceId: string): Promise<Map<string, LineInfo>> {
    const lines = await this.prisma.channelLine.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        chatbot: { select: { name: true, enabled: true } },
      },
    });
    return new Map(
      lines.map((line) => [
        line.id,
        {
          name: line.name,
          chatbot: line.chatbot?.enabled ? line.chatbot.name : null,
        },
      ]),
    );
  }

  async lineBot(lineId: string): Promise<LineBot | null> {
    const line = await this.prisma.channelLine.findUnique({
      where: { id: lineId },
      select: {
        chatbot: {
          select: { id: true, name: true, enabled: true, schedule: true },
        },
      },
    });
    return line?.chatbot ?? null;
  }
}
