import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { AuthModule } from '../auth/auth.module';
import { BillingService } from '../billing/application/billing.service';
import { BillingModule } from '../billing/billing.module';
import { ChannelsModule } from '../channels/channels.module';
import { ContactsModule } from '../contacts/contacts.module';
import { InboxModule } from '../inbox/inbox.module';
import { FunnelAutomation } from './application/funnel-automation.service';
import { FunnelsService } from './application/funnels.service';
import { FunnelsStore, LeadsStore } from './application/ports';
import {
  FUNNEL_LEAD_MODEL,
  FunnelLeadSchema,
} from './infrastructure/funnel-lead.schemas';
import { MongoLeadsStore } from './infrastructure/mongo-leads-store';
import { PrismaFunnelsStore } from './infrastructure/prisma-funnels-store';
import {
  FunnelAutomationController,
  FunnelsController,
} from './presentation/funnels.controller';

/**
 * Funnels ("Embudos"): Kanban boards of the contacts of each line.
 * Funnels, stages, privileges and rules live in PostgreSQL; leads in
 * MongoDB next to contacts and conversations. FunnelAutomation follows the
 * inbox events; chatbots move leads through FunnelsService.
 */
@Module({
  imports: [
    AuthModule,
    BillingModule,
    ChannelsModule,
    ContactsModule,
    InboxModule,
    MongooseModule.forFeature([
      { name: FUNNEL_LEAD_MODEL, schema: FunnelLeadSchema },
    ]),
  ],
  controllers: [FunnelsController, FunnelAutomationController],
  providers: [
    FunnelsService,
    FunnelAutomation,
    { provide: FunnelsStore, useClass: PrismaFunnelsStore },
    { provide: LeadsStore, useClass: MongoLeadsStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [FunnelsService, FunnelAutomation],
})
export class FunnelsModule {}
