import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/time/clock';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { MembersService } from './application/members.service';
import { TeamStore, WorkspaceEntitlements } from './application/ports';
import { RolesService } from './application/roles.service';
import { PrismaTeamStore } from './infrastructure/prisma-team-store';
import {
  MembersController,
  RolesController,
} from './presentation/team.controller';

/**
 * Team of a workspace: members (agents) and custom roles. Plan limits come
 * from billing through the WorkspaceEntitlements port; password hashing from auth.
 */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [MembersController, RolesController],
  providers: [
    MembersService,
    RolesService,
    { provide: TeamStore, useClass: PrismaTeamStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class TeamModule {}
