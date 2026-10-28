import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import {
  InboxEvents,
  type InboxEvent,
} from '../../inbox/application/inbox-events';
import { FunnelsService } from './funnels.service';

const ARCHIVE_EVERY_MS = 15 * 60_000;

/**
 * Keeps the funnels in step with the inbox, after each change is stored:
 * - a brand-new chat joins the first stage of the line's primary funnel;
 * - a chat that changes status follows the rule of its line;
 * - a customer message keeps its leads active (and restores those archived
 *   for inactivity);
 * - every 15 minutes, idle leads of funnels with auto-archive are archived.
 * Moving a lead never changes the chat status, so rules cannot loop. Work
 * runs in order per conversation.
 */
@Injectable()
export class FunnelAutomation implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FunnelAutomation.name);
  private subscription: Subscription | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly events: InboxEvents,
    private readonly funnels: FunnelsService,
  ) {}

  onModuleInit() {
    this.subscription = this.events.events$.subscribe((event) => {
      if (this.concerns(event))
        this.enqueue(event.conversation.id, () => this.handle(event));
    });
    this.timer = setInterval(() => {
      this.funnels
        .archiveIdle()
        .catch((error: unknown) =>
          this.logger.error(
            `Funnel auto-archive failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }, ARCHIVE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  /** Waits until every queued change is handled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running.values()]);
    }
  }

  private concerns(event: InboxEvent): boolean {
    return (
      event.created === true ||
      this.statusChanged(event) ||
      (event.type === 'message.created' && event.message?.direction === 'IN')
    );
  }

  private statusChanged(event: InboxEvent): boolean {
    return (
      event.previousStatus !== undefined &&
      event.previousStatus !== event.conversation.status
    );
  }

  private async handle(event: InboxEvent): Promise<void> {
    const { conversation } = event;
    if (event.created) await this.funnels.onNewConversation(conversation);
    if (this.statusChanged(event))
      await this.funnels.onStatusChange(conversation);
    if (event.type === 'message.created' && event.message?.direction === 'IN')
      await this.funnels.onInbound(conversation, event.message.createdAt);
  }

  private enqueue(conversationId: string, work: () => Promise<void>) {
    const previous = this.running.get(conversationId) ?? Promise.resolve();
    const task = previous
      .then(work)
      .catch((error: unknown) =>
        this.logger.error(
          `Funnel automation failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        if (this.running.get(conversationId) === task)
          this.running.delete(conversationId);
      });
    this.running.set(conversationId, task);
  }
}
