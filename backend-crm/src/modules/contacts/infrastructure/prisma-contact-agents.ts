import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { ContactAgents } from '../application/ports';

@Injectable()
export class PrismaContactAgents extends ContactAgents {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isActiveMember(
    workspaceId: string,
    membershipId: string,
  ): Promise<boolean> {
    const found = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: membershipId,
        workspaceId,
        status: 'ACTIVE',
        user: { status: { notIn: ['SUSPENDED', 'DISABLED'] } },
      },
      select: { id: true },
    });
    return !!found;
  }
}
