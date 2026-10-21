import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { ChannelsModule } from '../channels/channels.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ContactBlockService } from './application/contact-block.service';
import { ConversationTimeline } from './application/conversation-timeline';
import { InboxEvents } from './application/inbox-events';
import { InboxMediaService } from './application/inbox-media.service';
import { MediaStore } from './application/media';
import { GridFsMediaStore } from './infrastructure/gridfs-media-store';
import { InboxIngestService } from './application/inbox-ingest.service';
import { InboxStreamService } from './application/inbox-stream.service';
import { InboxService } from './application/inbox.service';
import { AssignmentStore, InboxStore } from './application/ports';
import { ContactQuota } from './application/contact-quota';
import { PrismaContactQuota } from './infrastructure/prisma-contact-quota';
import {
  CONVERSATION_MODEL,
  ConversationSchema,
  MESSAGE_MODEL,
  MessageSchema,
} from './infrastructure/inbox.schemas';
import { MongoInboxStore } from './infrastructure/mongo-inbox-store';
import { PrismaAssignmentStore } from './infrastructure/prisma-assignment-store';
import {
  AutoAssignmentController,
  ContactBlockController,
  ConversationsController,
} from './presentation/inbox.controller';

/**
 * Inbox: conversations and messages (MongoDB), auto-assignment (PostgreSQL
 * lines and agents), replies through WhatsApp and real-time events.
 * InboxIngestService receives the WhatsApp webhook events.
 */
@Module({
  imports: [
    AuthModule,
    BillingModule,
    ChannelsModule,
    ContactsModule,
    MongooseModule.forFeature([
      { name: CONVERSATION_MODEL, schema: ConversationSchema },
      { name: MESSAGE_MODEL, schema: MessageSchema },
    ]),
  ],
  controllers: [
    ConversationsController,
    AutoAssignmentController,
    ContactBlockController,
  ],
  providers: [
    InboxService,
    InboxIngestService,
    InboxStreamService,
    InboxEvents,
    ConversationTimeline,
    InboxMediaService,
    ContactBlockService,
    { provide: MediaStore, useClass: GridFsMediaStore },
    { provide: ContactQuota, useClass: PrismaContactQuota },
    { provide: InboxStore, useClass: MongoInboxStore },
    { provide: AssignmentStore, useClass: PrismaAssignmentStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [InboxIngestService],
})
export class InboxModule {}
