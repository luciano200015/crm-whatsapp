import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../modules/auth/presentation/auth.decorators';
import { PrismaHealthIndicator } from './prisma.health';

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PrismaHealthIndicator,
    private readonly mongo: MongooseHealthIndicator,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is running' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe: PostgreSQL and MongoDB reachable',
  })
  ready() {
    return this.health.check([
      () => this.postgres.isHealthy('postgres'),
      () => this.mongo.pingCheck('mongodb', { timeout: 2_000 }),
    ]);
  }
}
