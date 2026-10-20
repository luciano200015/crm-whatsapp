import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { ChannelsModule } from '../channels/channels.module';
import { ContactsModule } from '../contacts/contacts.module';
import { InboxEvents } from './application/inbox-events';
import { InboxIngestService } from './application/inbox-ingest.service';
import { InboxStreamService } from './application/inbox-stream.service';
import { InboxService } from './application/inbox.service';
import { AssignmentStore, InboxStore } from './application/ports';
import {
  CONVERSATION_MODEL,
  ConversationSchema,
  MESSAGE_MODEL,
  MessageSchema,
} from './infrastructure/inbox.schemas';
import { MongoInboxStore } from './infrastructure/mongo-inbox-store';
import { PrismaAssignmentStore } from './infrastructure/prisma-assignment-store';
import { ConversationsController } from './presentation/inbox.controller';

/**
 * Inbox: conversations and messages (MongoDB), auto-assignment (PostgreSQL
 * lines and agents), replies through WhatsApp and real-time events.
 * InboxIngestService receives the WhatsApp webhook events.
 */
@Module({
  imports: [
    BillingModule,
    ChannelsModule,
    ContactsModule,
    MongooseModule.forFeature([
      { name: CONVERSATION_MODEL, schema: ConversationSchema },
      { name: MESSAGE_MODEL, schema: MessageSchema },
    ]),
  ],
  controllers: [ConversationsController],
  providers: [
    InboxService,
    InboxIngestService,
    InboxStreamService,
    InboxEvents,
    { provide: InboxStore, useClass: MongoInboxStore },
    { provide: AssignmentStore, useClass: PrismaAssignmentStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [InboxIngestService],
})
export class InboxModule {}
