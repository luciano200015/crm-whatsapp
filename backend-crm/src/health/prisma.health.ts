import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../database/postgres/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const check = this.indicator.check(key);
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return check.up();
    } catch (error: unknown) {
      // Only the error class is reported; messages may contain connection details.
      return check.down({
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
