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
import {
  InboxStore,
  type ConversationRecord,
} from '../../inbox/application/ports';
import { isBotPaused } from '../../inbox/domain/bot-pause';
import { FunnelsService } from '../../funnels/application/funnels.service';
import { FlowFormatError, parseFlow, type Flow } from '../domain/flow';
import {
  advance,
  AGENT,
  nudgeMessage,
  type BotAction,
  type BotMessage,
} from '../domain/flow-engine';
import { withinSchedule, type Schedule } from '../domain/schedule';
import { storedVariables } from '../domain/variables';
import { ChatbotsStore, type ChatbotRecord } from './ports';

const toOutgoing = (message: BotMessage): BotOutgoing =>
  message.kind === 'text'
    ? { kind: 'text', text: message.text }
    : message.kind === 'interactive'
      ? { kind: 'interactive', content: message.content }
      : { kind: 'media', media: message.media, caption: message.caption };

/** How often due inactivity messages are looked for. */
const NUDGE_EVERY_MS = 30_000;

/**
 * Answers customers with the chatbot of their line. It listens to the
 * inbox's incoming messages (after the webhook answered Meta) and handles
 * the messages of one conversation in order. Every 30 s it also sends the
 * inactivity messages that are due.
 *
 * In-process: with several API instances it must move to a queue (see
 * docs/limitations.md).
 */
@Injectable()
export class ChatbotRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotRunner.name);
  private subscription: Subscription | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** The last task of each conversation: the next message waits for it. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly events: InboxEvents,
    private readonly inbox: InboxService,
    private readonly conversations: InboxStore,
    private readonly lines: ChannelsStore,
    private readonly bots: ChatbotsStore,
    private readonly clock: Clock,
    private readonly funnels: FunnelsService,
  ) {}

  onModuleInit() {
    this.subscription = this.events.events$.subscribe((event) => {
      if (event.type === 'message.created' && event.message?.direction === 'IN')
        this.enqueue(event.conversation.id, () => this.handle(event));
    });
    this.timer = setInterval(() => {
      this.sendDueNudges().catch((error: unknown) =>
        this.logger.error(
          `Inactivity messages failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, NUDGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  /** Waits until every conversation has been handled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running.values()]);
    }
  }

  /**
   * "Mensaje de inactividad": the customer did not answer the node the
   * chatbot is waiting on. Sent once, in the conversation's queue.
   */
  async sendDueNudges(): Promise<void> {
    for (const workspaceId of await this.bots.workspacesWithInactivity()) {
      for (const conversation of await this.inbox.claimBotNudges(workspaceId)) {
        this.enqueue(conversation.id, () =>
          this.nudge(workspaceId, conversation.id),
        );
      }
    }
  }

  private enqueue(conversationId: string, work: () => Promise<void>) {
    const previous = this.running.get(conversationId) ?? Promise.resolve();
    const task = previous
      .then(work)
      .catch((error: unknown) =>
        this.logger.error(
          `Chatbot failed in conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        if (this.running.get(conversationId) === task)
          this.running.delete(conversationId);
      });
    this.running.set(conversationId, task);
  }

  /** The line's chatbot when it answers this conversation now, with its flow. */
  private async attending(
    conversation: ConversationRecord | null,
    now: Date,
  ): Promise<{ bot: ChatbotRecord; flow: Flow } | null> {
    if (
      !conversation ||
      conversation.status === 'CLOSED' ||
      isBotPaused(conversation.bot, now)
    )
      return null;
    const { workspaceId } = conversation;
    const line = await this.lines.findLine(workspaceId, conversation.lineId);
    if (!line?.chatbotId || line.status === 'DISABLED') return null;
    const bot = await this.bots.find(workspaceId, line.chatbotId);
    if (!bot?.enabled || !withinSchedule(bot.schedule as Schedule | null, now))
      return null;
    try {
      return { bot, flow: parseFlow(bot.graph) };
    } catch (error: unknown) {
      if (error instanceof FlowFormatError) {
        this.logger.warn(`Chatbot ${bot.id} has an unreadable flow`);
        return null;
      }
      throw error;
    }
  }

  private async handle(event: InboxEvent): Promise<void> {
    const { workspaceId, message } = event;
    if (!message) return;
    const conversation = await this.conversations.findConversation(
      workspaceId,
      event.conversation.id,
    );
    const now = this.clock.now();
    const attending = await this.attending(conversation, now);
    if (!conversation || !attending) return;
    const { bot, flow } = attending;

    // A conversation idle for a while (or of another bot) starts over with
    // the greeting ("Duración de conversación activa").
    const saved = conversation.bot?.session ?? null;
    const session =
      saved &&
      saved.chatbotId === bot.id &&
      now.getTime() - saved.updatedAt.getTime() <=
        bot.restartAfterMinutes * 60_000
        ? { nodeId: saved.nodeId, vars: saved.vars, attempts: saved.attempts }
        : null;

    const contact = await this.inbox.botContact(
      workspaceId,
      conversation.contactId,
    );
    const result = advance(
      flow,
      session,
      { text: message.text, replyId: message.reply?.id ?? null },
      {
        now,
        contact: {
          name: contact?.name ?? conversation.contact.name,
          phone: conversation.contact.phone,
          email: contact?.email ?? null,
        },
        settings: {
          fallbackText: bot.fallbackText,
          restartKeywords: bot.restartKeywords,
        },
        variables: storedVariables(bot.variables),
      },
    );
    const sender: BotSender = { id: bot.id, name: bot.name };
    for (const action of result.actions) {
      if (!(await this.apply(conversation, sender, action))) break;
    }
    const waiting = result.session?.nodeId ?? null;
    await this.inbox.saveBotSession(
      workspaceId,
      conversation.id,
      result.session
        ? {
            ...result.session,
            chatbotId: bot.id,
            updatedAt: now,
            // Only while it waits for an answer to one of its questions.
            nudgeAt:
              waiting && bot.inactivityMinutes && bot.inactivityText.trim()
                ? new Date(now.getTime() + bot.inactivityMinutes * 60_000)
                : null,
          }
        : null,
    );
  }

  private async nudge(
    workspaceId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.conversations.findConversation(
      workspaceId,
      conversationId,
    );
    const attending = await this.attending(conversation, this.clock.now());
    const session = conversation?.bot?.session;
    // Still waiting on the same chatbot (nobody answered or restarted it).
    if (
      !conversation ||
      !attending ||
      !session?.nodeId ||
      session.chatbotId !== attending.bot.id ||
      !attending.bot.inactivityText.trim()
    )
      return;
    await this.apply(
      conversation,
      { id: attending.bot.id, name: attending.bot.name },
      {
        kind: 'send',
        message: nudgeMessage(
          attending.bot.inactivityText.trim(),
          session.nodeId,
        ),
      },
    );
  }

  /** False when the rest of the actions must not run (a message was refused). */
  private async apply(
    conversation: ConversationRecord,
    bot: BotSender,
    action: BotAction,
  ): Promise<boolean> {
    const { workspaceId, id: conversationId } = conversation;
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
          await this.inbox.botTags(workspaceId, conversationId, bot, action);
          return true;
        case 'funnel':
          // A funnel deleted, of another line or out of the plan: the
          // contact is not placed, and the flow goes on.
          await this.funnels
            .setLeadStage({ conversation, bot, ...action })
            .catch((error: unknown) => {
              if (!(error instanceof HttpException)) throw error;
              this.logger.warn(
                `Chatbot ${bot.id} could not set the funnel stage in conversation ${conversationId}: ${error.message}`,
              );
            });
          return true;
        case 'transfer': {
          const assignee = await this.inbox.botTransfer(
            workspaceId,
            conversationId,
            bot,
            action,
          );
          if (action.message) {
            await this.inbox.sendAsBot(workspaceId, conversationId, bot, {
              kind: 'text',
              text: action.message
                .split(AGENT)
                .join(assignee?.name ?? 'un agente'),
            });
          }
          return true;
        }
        case 'status':
          await this.inbox.botSetStatus(
            workspaceId,
            conversationId,
            bot,
            action.status,
          );
          return true;
        case 'contact':
          await this.inbox.botUpdateContact(
            workspaceId,
            conversation.contactId,
            action.field,
            action.value,
          );
          return true;
      }
    } catch (error: unknown) {
      // Closed chat, 24 h window, plan limits, an email already in use…:
      // the bot stops quietly.
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
