import { Module, type Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { ChannelsService } from './application/channels.service';
import { ChannelsStore, WhatsAppGateway } from './application/ports';
import { PrismaChannelsStore } from './infrastructure/prisma-channels-store';
import {
  GraphWhatsAppGateway,
  SimulatedWhatsAppGateway,
} from './infrastructure/whatsapp-gateways';
import { LinesController } from './presentation/channels.controller';

const whatsAppGateway: Provider = {
  provide: WhatsAppGateway,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    config.get('WHATSAPP_MODE') === 'simulated'
      ? new SimulatedWhatsAppGateway()
      : new GraphWhatsAppGateway(config),
};

/**
 * WhatsApp lines (Cloud API with manual credentials). The public webhook is
 * wired in WhatsAppWebhookModule, which decides who receives its events.
 */
@Module({
  imports: [BillingModule],
  controllers: [LinesController],
  providers: [
    ChannelsService,
    whatsAppGateway,
    { provide: ChannelsStore, useClass: PrismaChannelsStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [ChannelsService, ChannelsStore, WhatsAppGateway],
})
export class ChannelsModule {}
