import type { InteractiveReply } from './interactive';

/**
 * Normalizes WhatsApp Cloud API webhook payloads
 * (`object: whatsapp_business_account`) into plain events. The payload comes
 * from outside: every field is checked, unknown shapes are skipped.
 */

export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  /** Buttons, list or link button sent by a chatbot (never received). */
  | 'interactive'
  | 'unsupported';

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface MediaInfo {
  /** Meta media id (downloadable with the line's token). */
  id: string;
  mimeType: string | null;
  caption: string | null;
  filename: string | null;
}

export interface LocationInfo {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
}

/** A contact card shared in WhatsApp ("Enviar contacto"). */
export interface SharedContact {
  name: string;
  phones: { phone: string; waId: string | null; type: string | null }[];
  emails: string[];
  organization: string | null;
}

export interface InboundMessage {
  phoneNumberId: string;
  waMessageId: string;
  /** Sender's WhatsApp id: digits of their phone number. */
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: MessageType;
  /** Text body, caption or a short description (location, button reply). */
  text: string | null;
  media: MediaInfo | null;
  location: LocationInfo | null;
  contacts?: SharedContact[] | null;
  /** The option the customer tapped in a buttons or list message. */
  reply?: InteractiveReply | null;
}

export interface StatusUpdate {
  phoneNumberId: string;
  waMessageId: string;
  status: DeliveryStatus;
  timestamp: Date;
  recipient: string;
  error: string | null;
}

export interface WebhookEvents {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const obj = (value: unknown): Json => (isObject(value) ? value : {});

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'] as const;
const STATUSES: readonly DeliveryStatus[] = [
  'sent',
  'delivered',
  'read',
  'failed',
];

function timestampOf(value: unknown): Date {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

function parseMessage(
  raw: Json,
  phoneNumberId: string,
  names: Map<string, string>,
): InboundMessage | null {
  const waMessageId = str(raw.id);
  const from = str(raw.from);
  const type = str(raw.type);
  if (!waMessageId || !from || !type) return null;
  // Reactions and system notices are not conversation messages.
  if (type === 'reaction' || type === 'system' || type === 'ephemeral')
    return null;

  const base = {
    phoneNumberId,
    waMessageId,
    from,
    profileName: names.get(from) ?? null,
    timestamp: timestampOf(raw.timestamp),
  };

  if (type === 'text') {
    return {
      ...base,
      type: 'text',
      text: str(obj(raw.text).body),
      media: null,
      location: null,
    };
  }
  const mediaType = MEDIA_TYPES.find((media) => media === type);
  if (mediaType) {
    const media = obj(raw[mediaType]);
    const id = str(media.id);
    return {
      ...base,
      type: mediaType,
      text: str(media.caption),
      media: id
        ? {
            id,
            mimeType: str(media.mime_type),
            caption: str(media.caption),
            filename: str(media.filename),
          }
        : null,
      location: null,
    };
  }
  if (type === 'location') {
    const location = obj(raw.location);
    const description = [str(location.name), str(location.address)]
      .filter(Boolean)
      .join(', ');
    const { latitude, longitude } = location;
    const valid =
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude);
    const coordinates = `${String(location.latitude)},${String(location.longitude)}`;
    return {
      ...base,
      type: 'location',
      text: description || coordinates,
      media: null,
      location: valid
        ? {
            latitude,
            longitude,
            name: str(location.name),
            address: str(location.address),
          }
        : null,
    };
  }
  if (type === 'contacts') {
    const contacts = arr(raw.contacts)
      .slice(0, 20)
      .map((item) => parseSharedContact(obj(item)))
      .filter((contact): contact is SharedContact => contact !== null);
    return {
      ...base,
      type: 'contacts',
      text: contacts.map((contact) => contact.name).join(', ') || null,
      media: null,
      location: null,
      contacts,
    };
  }
  // Quick-reply buttons and list replies arrive as their visible title; the
  // id of the option is kept so a chatbot can follow it.
  if (type === 'button') {
    const button = obj(raw.button);
    const text = str(button.text);
    const id = str(button.payload);
    return {
      ...base,
      type: 'text',
      text,
      media: null,
      location: null,
      reply: id ? { id: id.slice(0, 256), title: text ?? '' } : null,
    };
  }
  if (type === 'interactive') {
    const interactive = obj(raw.interactive);
    const reply = obj(interactive.button_reply ?? interactive.list_reply);
    const text = str(reply.title);
    const id = str(reply.id);
    return {
      ...base,
      type: 'text',
      text,
      media: null,
      location: null,
      reply: id ? { id: id.slice(0, 256), title: text ?? '' } : null,
    };
  }
  return {
    ...base,
    type: 'unsupported',
    text: null,
    media: null,
    location: null,
  };
}

function parseSharedContact(raw: Json): SharedContact | null {
  const name = obj(raw.name);
  const phones = arr(raw.phones)
    .map((item) => obj(item))
    .map((phone) => ({
      phone: str(phone.phone) ?? str(phone.wa_id) ?? '',
      waId: str(phone.wa_id),
      type: str(phone.type),
    }))
    .filter((phone) => phone.phone);
  const display =
    str(name.formatted_name) ??
    ([str(name.first_name), str(name.last_name)].filter(Boolean).join(' ') ||
      null) ??
    phones[0]?.phone ??
    null;
  if (!display) return null;
  return {
    name: display,
    phones,
    emails: arr(raw.emails)
      .map((email) => str(obj(email).email))
      .filter((email): email is string => email !== null),
    organization: str(obj(raw.org).company),
  };
}

function parseStatus(raw: Json, phoneNumberId: string): StatusUpdate | null {
  const waMessageId = str(raw.id);
  const status = STATUSES.find((s) => s === raw.status);
  if (!waMessageId || !status) return null;
  const firstError = obj(arr(raw.errors)[0]);
  return {
    phoneNumberId,
    waMessageId,
    status,
    timestamp: timestampOf(raw.timestamp),
    recipient: str(raw.recipient_id) ?? '',
    error:
      status === 'failed'
        ? (str(obj(firstError.error_data).details) ??
          str(firstError.message) ??
          str(firstError.title))
        : null,
  };
}

export function parseWebhook(body: unknown): WebhookEvents {
  const events: WebhookEvents = { messages: [], statuses: [] };
  if (!isObject(body) || body.object !== 'whatsapp_business_account') {
    return events;
  }
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const { field, value } = obj(change);
      if (field !== 'messages' || !isObject(value)) continue;
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        const waId = str(obj(contact).wa_id);
        const name = str(obj(obj(contact).profile).name);
        if (waId && name) names.set(waId, name);
      }
      for (const message of arr(value.messages)) {
        const parsed = parseMessage(obj(message), phoneNumberId, names);
        if (parsed) events.messages.push(parsed);
      }
      for (const status of arr(value.statuses)) {
        const parsed = parseStatus(obj(status), phoneNumberId);
        if (parsed) events.statuses.push(parsed);
      }
    }
  }
  return events;
}

/** Builds a Cloud API-like payload with one text message (tests, simulator). */
export function textMessagePayload(input: {
  phoneNumberId: string;
  from: string;
  text: string;
  profileName?: string;
  waMessageId?: string;
  timestamp?: Date;
  /** The customer tapped this reply button instead of typing. */
  reply?: InteractiveReply;
}): Json {
  const seconds = Math.floor((input.timestamp ?? new Date()).getTime() / 1000);
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: input.phoneNumberId },
              contacts: [
                {
                  profile: { name: input.profileName ?? '' },
                  wa_id: input.from,
                },
              ],
              messages: [
                {
                  from: input.from,
                  id:
                    input.waMessageId ??
                    `wamid.SIM.${seconds}.${Math.random().toString(36).slice(2)}`,
                  timestamp: String(seconds),
                  ...(input.reply
                    ? {
                        type: 'interactive',
                        interactive: {
                          type: 'button_reply',
                          button_reply: input.reply,
                        },
                      }
                    : { type: 'text', text: { body: input.text } }),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
