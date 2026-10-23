import { Module } from '@nestjs/common';
import { WorkspaceEntitlements } from '../../shared/entitlements/workspace-entitlements';
import { Clock, SystemClock } from '../../shared/time/clock';
import { AuthModule } from '../auth/auth.module';
import { BillingService } from '../billing/application/billing.service';
import { BillingModule } from '../billing/billing.module';
import { ChannelsModule } from '../channels/channels.module';
import { InboxModule } from '../inbox/inbox.module';
import { ChatbotRunner } from './application/chatbot-runner.service';
import { ChatbotsService } from './application/chatbots.service';
import { ChatbotsStore } from './application/ports';
import { PrismaChatbotsStore } from './infrastructure/prisma-chatbots-store';
import { ChatbotsController } from './presentation/chatbots.controller';

/**
 * Chatbots: flows built in the editor that answer the customers of their
 * lines (one chatbot per line). ChatbotRunner listens to the inbox's
 * incoming messages and answers through the inbox.
 */
@Module({
  imports: [AuthModule, BillingModule, ChannelsModule, InboxModule],
  controllers: [ChatbotsController],
  providers: [
    ChatbotsService,
    ChatbotRunner,
    { provide: ChatbotsStore, useClass: PrismaChatbotsStore },
    { provide: WorkspaceEntitlements, useExisting: BillingService },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [ChatbotRunner],
})
export class ChatbotsModule {}
