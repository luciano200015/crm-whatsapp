import { Injectable, Logger } from '@nestjs/common';
import { ChannelsService } from '../../channels/application/channels.service';
import {
  ChannelsStore,
  WhatsAppApiError,
  WhatsAppGateway,
} from '../../channels/application/ports';
import { InboxErrors } from './inbox-errors';
import { InboxEvents } from './inbox-events';
import { baseMimeType, MediaStore, type StoredMedia } from './media';
import {
  InboxStore,
  type ConversationRecord,
  type MessageRecord,
} from './ports';

/**
 * Media of the inbox: files customers send are copied from Meta into our
 * storage (in the background when they arrive, or on first view if that
 * failed) and streamed to members who can see the conversation.
 */
@Injectable()
export class InboxMediaService {
  private readonly logger = new Logger(InboxMediaService.name);
  /** Downloads in progress, so two viewers do not copy the same file twice. */
  private readonly inFlight = new Map<string, Promise<MessageRecord>>();

  constructor(
    private readonly store: InboxStore,
    private readonly media: MediaStore,
    private readonly lines: ChannelsStore,
    private readonly channels: ChannelsService,
    private readonly whatsapp: WhatsAppGateway,
    private readonly events: InboxEvents,
  ) {}

  /** Right after a message arrives: never delays the webhook, failures retry on view. */
  prefetch(conversation: ConversationRecord, message: MessageRecord): void {
    if (!message.media || message.media.fileId) return;
    this.download(conversation, message)
      .then((updated) =>
        this.events.emit({
          workspaceId: conversation.workspaceId,
          type: 'message.updated',
          conversation,
          message: updated,
        }),
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not copy media of message ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  /** The file of a message in a conversation the caller may see. */
  async open(
    conversation: ConversationRecord,
    messageId: string,
  ): Promise<StoredMedia> {
    const { workspaceId } = conversation;
    let message = await this.store.findMessage(workspaceId, messageId);
    if (!message?.media || message.conversationId !== conversation.id) {
      throw InboxErrors.mediaNotFound();
    }
    if (message.media.fileId) {
      const stored = await this.media.open(workspaceId, message.media.fileId);
      if (stored) return stored;
    }
    try {
      message = await this.download(conversation, message);
    } catch (error: unknown) {
      if (error instanceof WhatsAppApiError) {
        throw InboxErrors.mediaUnavailable(error.message);
      }
      throw error;
    }
    const stored = message.media?.fileId
      ? await this.media.open(workspaceId, message.media.fileId)
      : null;
    if (!stored) throw InboxErrors.mediaNotFound();
    return stored;
  }

  private download(
    conversation: ConversationRecord,
    message: MessageRecord,
  ): Promise<MessageRecord> {
    const running = this.inFlight.get(message.id);
    if (running) return running;
    const task = this.copyFromMeta(conversation, message).finally(() =>
      this.inFlight.delete(message.id),
    );
    this.inFlight.set(message.id, task);
    return task;
  }

  private async copyFromMeta(
    conversation: ConversationRecord,
    message: MessageRecord,
  ): Promise<MessageRecord> {
    const { workspaceId } = conversation;
    // Files our agents sent are stored when sent; only Meta's can be fetched.
    if (!message.media || message.direction !== 'IN') {
      throw InboxErrors.mediaNotFound();
    }
    const line = await this.lines.findLine(workspaceId, conversation.lineId);
    if (!line) throw InboxErrors.mediaNotFound();
    const credentials = await this.channels.credentials(line);
    const file = await this.whatsapp.downloadMedia(
      credentials,
      message.media.id,
    );
    const mimeType = baseMimeType(
      message.media.mimeType ?? file.mimeType ?? 'application/octet-stream',
    );
    const { fileId, size } = await this.media.put(workspaceId, {
      body: file.body,
      mimeType,
      filename: message.media.filename,
    });
    const updated = await this.store.setMediaFile(workspaceId, message.id, {
      fileId,
      size,
      mimeType,
    });
    if (!updated) throw InboxErrors.mediaNotFound();
    return updated;
  }
}
