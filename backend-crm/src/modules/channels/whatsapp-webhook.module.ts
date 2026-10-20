import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/time/clock';
import { ChannelsModule } from './channels.module';
import { WhatsAppEventsSink } from './application/ports';
import { WhatsAppWebhookService } from './application/whatsapp-webhook.service';
import { LoggingEventsSink } from './infrastructure/whatsapp-gateways';
import { WhatsAppWebhookController } from './presentation/channels.controller';

/**
 * Public WhatsApp webhook. Kept apart from ChannelsModule so the module that
 * processes the events (the inbox) can depend on channels without a cycle.
 */
@Module({
  imports: [ChannelsModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppWebhookService,
    { provide: WhatsAppEventsSink, useClass: LoggingEventsSink },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class WhatsAppWebhookModule {}
