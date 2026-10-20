import { Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '../../../shared/security/secret-box';
import { Clock } from '../../../shared/time/clock';
import { isValidSignature, sameToken } from '../domain/webhook-signature';
import { parseWebhook, type WebhookEvents } from '../domain/whatsapp-payload';
import { ChannelsErrors } from './channels-errors';
import { ChannelsStore, WhatsAppEventsSink, type LineRecord } from './ports';

/**
 * Public webhook of a line (`/webhooks/whatsapp/:lineId`).
 * - GET: Meta's subscription check with the line's verify token.
 * - POST: events signed with the App Secret. They are routed by
 *   `phone_number_id` to the lines of the same workspace, so several numbers
 *   of one Meta app can share a callback URL.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly store: ChannelsStore,
    private readonly secrets: SecretBox,
    private readonly sink: WhatsAppEventsSink,
    private readonly clock: Clock,
  ) {}

  async verify(
    lineId: string,
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): Promise<string> {
    const line = await this.store.findLineById(lineId);
    if (
      !line ||
      mode !== 'subscribe' ||
      !token ||
      !challenge ||
      !sameToken(token, line.webhookVerifyToken)
    ) {
      throw ChannelsErrors.verificationFailed();
    }
    await this.store.recordVerification(line.id, this.clock.now());
    return challenge;
  }

  async receive(
    lineId: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const line = await this.store.findLineById(lineId);
    const secrets = line ? await this.store.getSecrets(line.id) : null;
    if (!line || !secrets) throw ChannelsErrors.lineNotFound();
    if (
      !rawBody ||
      !isValidSignature(
        rawBody,
        signature,
        this.secrets.decrypt(secrets.appSecretEnc),
      )
    ) {
      // Usually a wrong App Secret on the line. Never log the body or header.
      this.logger.warn(
        `Rejected webhook with an invalid signature for line ${line.id}`,
      );
      throw ChannelsErrors.invalidSignature();
    }

    const events = parseWebhook(
      JSON.parse(rawBody.toString('utf8')) as unknown,
    );
    const phoneNumberIds = [
      ...new Set([
        ...events.messages.map((m) => m.phoneNumberId),
        ...events.statuses.map((s) => s.phoneNumberId),
      ]),
    ];
    const lines = await this.store.findLinesByPhoneNumberIds(
      line.workspaceId,
      phoneNumberIds,
    );
    const now = this.clock.now();

    for (const target of lines) {
      const forLine: WebhookEvents = {
        messages: events.messages.filter(
          (m) => m.phoneNumberId === target.phoneNumberId,
        ),
        statuses: events.statuses.filter(
          (s) => s.phoneNumberId === target.phoneNumberId,
        ),
      };
      await this.store.recordWebhook(target.id, now);
      if (target.status === 'DISABLED') continue;
      await this.sink.handle(target, forLine);
    }
    this.logUnknown(line, phoneNumberIds, lines);
  }

  private logUnknown(
    line: LineRecord,
    phoneNumberIds: string[],
    found: LineRecord[],
  ) {
    const unknown = phoneNumberIds.filter(
      (id) => !found.some((target) => target.phoneNumberId === id),
    );
    if (unknown.length > 0) {
      this.logger.warn(
        `Webhook of line ${line.id} carried events for numbers without a line in its workspace: ${unknown.join(', ')}`,
      );
    }
  }
}
