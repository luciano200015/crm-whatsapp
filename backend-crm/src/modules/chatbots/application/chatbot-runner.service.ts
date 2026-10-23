import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { Clock } from '../../../shared/time/clock';
import { ChannelsStore } from '../../channels/application/ports';
import {
  InboxEvents,
  type InboxEvent,
} from '../../inbox/application/inbox-events';
import {
  InboxService,
  type BotOutgoing,
  type BotSender,
} from '../../inbox/application/inbox.service';
import { InboxStore } from '../../inbox/application/ports';
import { FlowFormatError, parseFlow } from '../domain/flow';
import {
  advance,
  type BotAction,
  type BotMessage,
} from '../domain/flow-engine';
import { withinSchedule, type Schedule } from '../domain/schedule';
import { ChatbotsStore } from './ports';

const toOutgoing = (message: BotMessage): BotOutgoing =>
  message.kind === 'text'
    ? { kind: 'text', text: message.text }
    : message.kind === 'interactive'
      ? { kind: 'interactive', content: message.content }
      : { kind: 'media', media: message.media, caption: message.caption };

/**
 * Answers customers with the chatbot of their line. It listens to the
 * inbox's incoming messages (after the webhook answered Meta) and handles
 * the messages of one conversation in order.
 *
 * In-process: with several API instances it must move to a queue (see
 * docs/limitations.md).
 */
@Injectable()
export class ChatbotRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotRunner.name);
  private subscription: Subscription | null = null;
  /** The last task of each conversation: the next message waits for it. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly events: InboxEvents,
    private readonly inbox: InboxService,
    private readonly conversations: InboxStore,
    private readonly lines: ChannelsStore,
    private readonly bots: ChatbotsStore,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    this.subscription = this.events.events$.subscribe((event) => {
      if (event.type === 'message.created' && event.message?.direction === 'IN')
        this.enqueue(event);
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  /** Waits until every conversation has been handled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running.values()]);
    }
  }

  private enqueue(event: InboxEvent) {
    const id = event.conversation.id;
    const previous = this.running.get(id) ?? Promise.resolve();
    const task = previous
      .then(() => this.handle(event))
      .catch((error: unknown) =>
        this.logger.error(
          `Chatbot failed in conversation ${id}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        if (this.running.get(id) === task) this.running.delete(id);
      });
    this.running.set(id, task);
  }

  private async handle(event: InboxEvent): Promise<void> {
    const { workspaceId, message } = event;
    if (!message) return;
    const conversation = await this.conversations.findConversation(
      workspaceId,
      event.conversation.id,
    );
    if (
      !conversation ||
      conversation.status === 'CLOSED' ||
      conversation.bot?.paused
    )
      return;
    const line = await this.lines.findLine(workspaceId, conversation.lineId);
    if (!line?.chatbotId || line.status === 'DISABLED') return;
    const bot = await this.bots.find(workspaceId, line.chatbotId);
    const now = this.clock.now();
    if (!bot?.enabled || !withinSchedule(bot.schedule as Schedule | null, now))
      return;

    let flow;
    try {
      flow = parseFlow(bot.graph);
    } catch (error: unknown) {
      if (error instanceof FlowFormatError) {
        this.logger.warn(`Chatbot ${bot.id} has an unreadable flow`);
        return;
      }
      throw error;
    }

    // A conversation idle for a while (or of another bot) starts over.
    const saved = conversation.bot?.session ?? null;
    const session =
      saved &&
      saved.chatbotId === bot.id &&
      now.getTime() - saved.updatedAt.getTime() <=
        bot.restartAfterMinutes * 60_000
        ? { nodeId: saved.nodeId, vars: saved.vars, attempts: saved.attempts }
        : null;

    const result = advance(
      flow,
      session,
      { text: message.text, replyId: message.reply?.id ?? null },
      { now, contact: conversation.contact },
    );
    const sender: BotSender = { id: bot.id, name: bot.name };
    for (const action of result.actions) {
      if (!(await this.apply(workspaceId, conversation.id, sender, action)))
        break;
    }
    await this.inbox.saveBotSession(
      workspaceId,
      conversation.id,
      result.session
        ? { ...result.session, chatbotId: bot.id, updatedAt: now }
        : null,
    );
  }

  /** False when the rest of the actions must not run (a message was refused). */
  private async apply(
    workspaceId: string,
    conversationId: string,
    bot: BotSender,
    action: BotAction,
  ): Promise<boolean> {
    try {
      switch (action.kind) {
        case 'send': {
          const sent = await this.inbox.sendAsBot(
            workspaceId,
            conversationId,
            bot,
            toOutgoing(action.message),
          );
          return sent.status !== 'failed';
        }
        case 'tags':
          await this.inbox.botTags(workspaceId, conversationId, action);
          return true;
        case 'transfer':
          await this.inbox.botTransfer(workspaceId, conversationId, action);
          return true;
        case 'status':
          await this.inbox.botSetStatus(
            workspaceId,
            conversationId,
            action.status,
          );
          return true;
      }
    } catch (error: unknown) {
      // Closed chat, 24 h window, plan limits…: the bot stops quietly.
      if (error instanceof HttpException) {
        this.logger.warn(
          `Chatbot ${bot.id} stopped in conversation ${conversationId}: ${error.message}`,
        );
        return false;
      }
      throw error;
    }
  }
}
