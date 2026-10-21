import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppConfigService } from '../../../config/app-config.service';
import {
  WhatsAppApiError,
  WhatsAppGateway,
  type LineCredentials,
  type OutgoingMedia,
} from '../application/ports';
import type { SharedContact } from '../domain/whatsapp-payload';

const TIMEOUT_MS = 10_000;
/** Uploads and downloads of media can take longer than API calls. */
const MEDIA_TIMEOUT_MS = 60_000;
/** Meta's largest media (documents) is 100 MB. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

type Json = Record<string, unknown>;

/**
 * Meta echoes the access token in some errors ("Malformed access token
 * EAAG…"). Errors are stored on lines and messages and shown to members, so
 * the token (and anything shaped like one) is removed first.
 */
export function redactToken(message: string, accessToken: string): string {
  const withoutToken = accessToken
    ? message.split(accessToken).join('[token]')
    : message;
  return withoutToken.replace(/\bEAA[A-Za-z0-9_-]{8,}/g, '[token]');
}

/** WhatsApp Cloud API through Meta's Graph API. */
@Injectable()
export class GraphWhatsAppGateway extends WhatsAppGateway {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;

  constructor(config: AppConfigService) {
    super();
    const base = config.get('WHATSAPP_GRAPH_BASE_URL').replace(/\/+$/, '');
    this.baseUrl = `${base}/${config.get('WHATSAPP_GRAPH_VERSION')}`;
  }

  async fetchPhoneNumber(credentials: LineCredentials) {
    const body = await this.call(
      credentials,
      `/${encodeURIComponent(credentials.phoneNumberId)}?fields=display_phone_number,verified_name`,
      { method: 'GET' },
    );
    return {
      displayPhone:
        typeof body.display_phone_number === 'string'
          ? body.display_phone_number
          : null,
      verifiedName:
        typeof body.verified_name === 'string' ? body.verified_name : null,
    };
  }

  async sendText(credentials: LineCredentials, to: string, text: string) {
    return this.sendMessage(credentials, {
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    });
  }

  async subscribeApp(credentials: LineCredentials, wabaId: string) {
    await this.call(
      credentials,
      `/${encodeURIComponent(wabaId)}/subscribed_apps`,
      { method: 'POST' },
    );
  }

  async downloadMedia(credentials: LineCredentials, mediaId: string) {
    const info = await this.call(
      credentials,
      `/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(credentials.phoneNumberId)}`,
      { method: 'GET' },
    );
    const url = typeof info.url === 'string' ? info.url : null;
    if (!url)
      throw new WhatsAppApiError('Meta did not return a media URL', 502);
    if (Number(info.file_size) > MAX_DOWNLOAD_BYTES) {
      throw new WhatsAppApiError('Media file is too large', 413);
    }
    let response: Response;
    try {
      // The URL is Meta's CDN, valid for a few minutes, and needs the token.
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new WhatsAppApiError(
        `Could not download the media: ${error instanceof Error ? error.name : 'NetworkError'}`,
        503,
      );
    }
    if (!response.ok || !response.body) {
      throw new WhatsAppApiError(
        `Meta refused the media download (${response.status})`,
        response.status,
      );
    }
    return {
      body: Readable.fromWeb(response.body as WebReadableStream),
      mimeType:
        typeof info.mime_type === 'string'
          ? info.mime_type
          : response.headers.get('content-type'),
    };
  }

  async uploadMedia(
    credentials: LineCredentials,
    file: { body: Buffer; mimeType: string; filename: string },
  ) {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', file.mimeType);
    form.set(
      'file',
      new Blob([new Uint8Array(file.body)], { type: file.mimeType }),
      file.filename,
    );
    const body = await this.call(
      credentials,
      `/${encodeURIComponent(credentials.phoneNumberId)}/media`,
      { method: 'POST', body: form },
      MEDIA_TIMEOUT_MS,
    );
    if (typeof body.id !== 'string') {
      throw new WhatsAppApiError('Meta did not return a media id', 502);
    }
    return { mediaId: body.id };
  }

  async sendMedia(
    credentials: LineCredentials,
    to: string,
    media: OutgoingMedia,
  ) {
    const object: Json = { id: media.mediaId };
    if (media.caption && media.type !== 'audio') object.caption = media.caption;
    if (media.filename && media.type === 'document') {
      object.filename = media.filename;
    }
    return this.sendMessage(credentials, {
      to,
      type: media.type,
      [media.type]: object,
    });
  }

  async sendContacts(
    credentials: LineCredentials,
    to: string,
    contacts: SharedContact[],
  ) {
    return this.sendMessage(credentials, {
      to,
      type: 'contacts',
      contacts: contacts.map((contact) => ({
        name: { formatted_name: contact.name, first_name: contact.name },
        phones: contact.phones.map((phone) => ({
          phone: phone.phone,
          type: phone.type ?? 'CELL',
          // Lets the customer open a chat with the contact from the card.
          ...(phone.waId && { wa_id: phone.waId }),
        })),
        ...(contact.emails.length > 0 && {
          emails: contact.emails.map((email) => ({ email, type: 'WORK' })),
        }),
        ...(contact.organization && {
          org: { company: contact.organization },
        }),
      })),
    });
  }

  async setUserBlocked(
    credentials: LineCredentials,
    waId: string,
    blocked: boolean,
  ) {
    const body = await this.call(
      credentials,
      `/${encodeURIComponent(credentials.phoneNumberId)}/block_users`,
      {
        method: blocked ? 'POST' : 'DELETE',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          block_users: [{ user: waId }],
        }),
      },
    );
    // A 200 can still list the user under failed_users.
    const result = (body.block_users ?? {}) as Json;
    const failed = Array.isArray(result.failed_users)
      ? (result.failed_users as Json[])
      : [];
    if (failed.length > 0) {
      const errors = Array.isArray(failed[0]?.errors)
        ? (failed[0].errors as Json[])
        : [];
      const reason = errors[0]?.message ?? errors[0]?.error_data;
      throw new WhatsAppApiError(
        typeof reason === 'string' ? reason : 'WhatsApp refused the request',
        400,
      );
    }
  }

  private async sendMessage(credentials: LineCredentials, message: Json) {
    const body = await this.call(
      credentials,
      `/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...message,
        }),
      },
    );
    const messages: unknown[] = Array.isArray(body.messages)
      ? body.messages
      : [];
    const id = (messages[0] as Json | undefined)?.id;
    if (typeof id !== 'string') {
      throw new WhatsAppApiError('Meta did not return a message id', 502);
    }
    return { waMessageId: id };
  }

  private async call(
    credentials: LineCredentials,
    path: string,
    init: RequestInit,
    timeoutMs = TIMEOUT_MS,
  ): Promise<Json> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          // FormData sets its own multipart boundary.
          ...(!(init.body instanceof FormData) && {
            'Content-Type': 'application/json',
          }),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      throw new WhatsAppApiError(
        `Could not reach WhatsApp: ${error instanceof Error ? error.name : 'NetworkError'}`,
        503,
      );
    }
    const body = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      const error = (body.error ?? {}) as Json;
      const message =
        typeof error.message === 'string' ? error.message : response.statusText;
      throw new WhatsAppApiError(
        redactToken(message, credentials.accessToken),
        response.status,
      );
    }
    return body;
  }
}

/** Development and tests: everything succeeds and nothing leaves the server. */
@Injectable()
export class SimulatedWhatsAppGateway extends WhatsAppGateway {
  readonly mode = 'simulated' as const;

  fetchPhoneNumber() {
    return Promise.resolve({
      displayPhone: null,
      verifiedName: 'Simulated line',
    });
  }

  sendText() {
    return Promise.resolve({
      waMessageId: `wamid.SIMULATED.${randomBytes(12).toString('hex')}`,
    });
  }

  subscribeApp() {
    return Promise.resolve();
  }

  /** A 1x1 PNG stands for any media a simulated customer sent. */
  downloadMedia() {
    return Promise.resolve({
      body: Readable.from(Buffer.from(SAMPLE_PNG, 'base64')),
      mimeType: 'image/png',
    });
  }

  uploadMedia() {
    return Promise.resolve({
      mediaId: `SIMULATED.${randomBytes(8).toString('hex')}`,
    });
  }

  sendMedia() {
    return this.sendText();
  }

  setUserBlocked() {
    return Promise.resolve();
  }

  sendContacts() {
    return this.sendText();
  }
}

const SAMPLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
