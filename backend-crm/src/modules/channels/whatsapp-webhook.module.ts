import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../shared/time/clock';
import { ChannelsModule } from './channels.module';
import { WhatsAppEventsSink } from './application/ports';
import { WhatsAppWebhookService } from './application/whatsapp-webhook.service';
import { InboxModule } from '../inbox/inbox.module';
import { InboxIngestService } from '../inbox/application/inbox-ingest.service';
import { WhatsAppWebhookController } from './presentation/channels.controller';

/**
 * Public WhatsApp webhook. Kept apart from ChannelsModule so the module that
 * processes the events (the inbox) can depend on channels without a cycle.
 */
@Module({
  imports: [ChannelsModule, InboxModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppWebhookService,
    // Webhook events become conversations and messages in the inbox.
    { provide: WhatsAppEventsSink, useExisting: InboxIngestService },
    { provide: Clock, useClass: SystemClock },
  ],
})
export class WhatsAppWebhookModule {}
