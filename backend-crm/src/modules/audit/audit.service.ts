import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/postgres/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../../shared/http/request-context';
import { AuditMetadata, sanitizeAuditMetadata } from './audit-sanitizer';

export interface AuditEntry {
  /** Dotted action, e.g. "auth.login.succeeded". */
  action: string;
  actorUserId?: string | null;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string;
  context?: RequestContext;
  metadata?: AuditMetadata;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a sensitive operation. An audit failure is logged but never
   * breaks the user-facing operation that already happened.
   */
  async record(entry: AuditEntry): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      workspaceId: entry.workspaceId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ipAddress: entry.context?.ipAddress ?? null,
      userAgent: entry.context?.userAgent ?? null,
      requestId: entry.context?.requestId ?? null,
      metadata: sanitizeAuditMetadata(
        entry.metadata ?? {},
      ) as Prisma.InputJsonObject,
    };
    try {
      await this.prisma.auditLog.create({ data });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to write audit entry "${entry.action}": ${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
      );
    }
  }
}
