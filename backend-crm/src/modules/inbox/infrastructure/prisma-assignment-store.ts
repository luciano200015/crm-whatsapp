import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { pickNextAgent } from '../domain/inbox-rules';
import { AssignmentStore, type Assignee } from '../application/ports';

@Injectable()
export class PrismaAssignmentStore extends AssignmentStore {
  constructor(private readonly prisma: PrismaService) {
    super();
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
            where: { membership: { status: 'ACTIVE' } },
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
      where: { id: membershipId, workspaceId, status: 'ACTIVE' },
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

  async lineNames(workspaceId: string): Promise<Map<string, string>> {
    const lines = await this.prisma.channelLine.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });
    return new Map(lines.map((line) => [line.id, line.name]));
  }
}
