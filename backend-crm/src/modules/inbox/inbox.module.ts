import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { ChannelsModule } from '../channels/channels.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AutoAssigner } from './application/auto-assigner';
import {
  ChatSettingsService,
  ChatSettingsStore,
} from './application/chat-settings';
import { ContactBlockService } from './application/contact-block.service';
import { ConversationRelinker } from './application/conversation-relinker';
import { InboxPresence } from './application/inbox-presence';
import { PrismaChatSettingsStore } from './infrastructure/prisma-chat-settings-store';
import { ConversationTimeline } from './application/conversation-timeline';
import { InboxEvents } from './application/inbox-events';
import { InboxMediaService } from './application/inbox-media.service';
import { MediaStore } from './application/media';
import {
  QuickRepliesService,
  QuickRepliesStore,
} from './application/quick-replies';
import {
  MongoQuickRepliesStore,
  QUICK_REPLY_MODEL,
  QuickReplySchema,
} from './infrastructure/mongo-quick-replies-store';
import { QuickRepliesController } from './presentation/quick-replies.controller';
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
  ChatSettingsController,
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
      { name: QUICK_REPLY_MODEL, schema: QuickReplySchema },
    ]),
  ],
  controllers: [
    ConversationsController,
    AutoAssignmentController,
    ChatSettingsController,
    ContactBlockController,
    QuickRepliesController,
  ],
  providers: [
    InboxService,
    InboxIngestService,
    InboxStreamService,
    InboxEvents,
    ConversationTimeline,
    ConversationRelinker,
    InboxMediaService,
    ContactBlockService,
    QuickRepliesService,
    ChatSettingsService,
    InboxPresence,
    AutoAssigner,
    { provide: ChatSettingsStore, useClass: PrismaChatSettingsStore },
    { provide: QuickRepliesStore, useClass: MongoQuickRepliesStore },
    { provide: MediaStore, useClass: GridFsMediaStore },
    { provide: ContactQuota, useClass: PrismaContactQuota },
    { provide: InboxStore, useClass: MongoInboxStore },
    { provide: AssignmentStore, useClass: PrismaAssignmentStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  // The chatbots module answers through the inbox and listens to its events.
  exports: [
    InboxIngestService,
    InboxService,
    InboxEvents,
    InboxStore,
    MediaStore,
    ConversationTimeline,
  ],
})
export class InboxModule {}
