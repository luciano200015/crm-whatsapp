import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { ContactAgents, type LineOption } from '../application/ports';

@Injectable()
export class PrismaContactAgents extends ContactAgents {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async lineOptions(workspaceId: string): Promise<LineOption[]> {
    const [lines, members] = await Promise.all([
      this.prisma.channelLine.findMany({
        where: { workspaceId, status: { not: 'DISABLED' } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, displayPhone: true },
      }),
      this.prisma.workspaceMembership.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          user: { status: { notIn: ['SUSPENDED', 'DISABLED'] } },
        },
        orderBy: { user: { displayName: 'asc' } },
        select: {
          id: true,
          user: { select: { displayName: true } },
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
      }),
    ]);
    return lines.map((line) => ({
      lineId: line.id,
      name: line.name,
      displayPhone: line.displayPhone,
      agents: members
        .filter(
          (member) =>
            member.lines.some(({ lineId }) => lineId === line.id) ||
            member.roles.some(({ role }) => role.permissions.length > 0),
        )
        .map((member) => ({
          membershipId: member.id,
          name: member.user.displayName,
        })),
    }));
  }
}
