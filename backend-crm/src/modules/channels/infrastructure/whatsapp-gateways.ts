import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import {
  WhatsAppApiError,
  WhatsAppGateway,
  type LineCredentials,
} from '../application/ports';

const TIMEOUT_MS = 10_000;

type Json = Record<string, unknown>;

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
    const body = await this.call(
      credentials,
      `/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: text },
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

  async subscribeApp(credentials: LineCredentials, wabaId: string) {
    await this.call(
      credentials,
      `/${encodeURIComponent(wabaId)}/subscribed_apps`,
      { method: 'POST' },
    );
  }

  private async call(
    credentials: LineCredentials,
    path: string,
    init: RequestInit,
  ): Promise<Json> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
      throw new WhatsAppApiError(message, response.status);
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
}
