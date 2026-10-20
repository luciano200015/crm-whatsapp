import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { ContactQuota } from '../application/contact-quota';

@Injectable()
export class PrismaContactQuota extends ContactQuota {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  reserve(
    workspaceId: string,
    contactId: string,
    month: Date,
    limit: number | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      const existing = await transaction.workspaceContactUsage.findUnique({
        where: {
          workspaceId_month_contactId: { workspaceId, month, contactId },
        },
      });
      if (existing) return true;
      const used = await transaction.workspaceContactUsage.count({
        where: { workspaceId, month },
      });
      if (limit !== null && used >= limit) return false;
      await transaction.workspaceContactUsage.create({
        data: { workspaceId, month, contactId },
      });
      return true;
    });
  }
}
