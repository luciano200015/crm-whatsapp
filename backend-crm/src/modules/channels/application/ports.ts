import type { Readable } from 'node:stream';
import type {
  LineStatus,
  MembershipStatus,
} from '../../../generated/prisma/client';
import type { SharedContact, WebhookEvents } from '../domain/whatsapp-payload';

export type { LineStatus };

export interface LineAgent {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  status: MembershipStatus;
}

export interface LineRecord {
  id: string;
  workspaceId: string;
  name: string;
  provider: 'WHATSAPP_CLOUD';
  phoneNumberId: string;
  wabaId: string | null;
  displayPhone: string | null;
  verifiedName: string | null;
  accessTokenLast4: string;
  /** When the access token expires (from the last connection test); null = unknown or never. */
  accessTokenExpiresAt: Date | null;
  webhookVerifyToken: string;
  status: LineStatus;
  lastError: string | null;
  lastWebhookAt: Date | null;
  autoAssign: boolean;
  /** #rrggbb shown around its chats in the inbox; null = default. */
  color: string | null;
  agents: LineAgent[];
  createdAt: Date;
  updatedAt: Date;
}

/** Encrypted credentials (SecretBox) of a line. */
export interface LineSecrets {
  accessTokenEnc: string;
  appSecretEnc: string;
}

export interface NewLine {
  name: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhone: string | null;
  accessTokenEnc: string;
  accessTokenLast4: string;
  appSecretEnc: string;
  webhookVerifyToken: string;
  color?: string | null;
}

export type LineUpdate = Partial<
  Omit<NewLine, 'webhookVerifyToken'> & {
    status: LineStatus;
    lastError: string | null;
    verifiedName: string | null;
    autoAssign: boolean;
    accessTokenExpiresAt: Date | null;
  }
>;

/** Persistence of WhatsApp lines (PostgreSQL). */
export abstract class ChannelsStore {
  abstract listLines(workspaceId: string): Promise<LineRecord[]>;
  abstract findLine(
    workspaceId: string,
    lineId: string,
  ): Promise<LineRecord | null>;
  /** For the public webhook: the line by id, whatever its workspace. */
  abstract findLineById(lineId: string): Promise<LineRecord | null>;
  /** Lines of a workspace that own these Meta phone number ids. */
  abstract findLinesByPhoneNumberIds(
    workspaceId: string,
    phoneNumberIds: string[],
  ): Promise<LineRecord[]>;
  abstract getSecrets(lineId: string): Promise<LineSecrets | null>;
  /** Counts and inserts under a lock on the workspace row (plan limit). */
  abstract createLine(
    workspaceId: string,
    data: NewLine,
    maxLines: number | null,
  ): Promise<
    | LineRecord
    | { kind: 'limit_reached'; lines: number }
    | { kind: 'phone_number_taken' }
  >;
  abstract updateLine(
    workspaceId: string,
    lineId: string,
    data: LineUpdate,
  ): Promise<LineRecord | 'phone_number_taken' | null>;
  abstract deleteLine(workspaceId: string, lineId: string): Promise<boolean>;
  /** Replaces the agents. 'member_not_found' if a membership is not an active one of the workspace. */
  abstract setAgents(
    workspaceId: string,
    lineId: string,
    membershipIds: string[],
  ): Promise<LineRecord | 'member_not_found' | null>;
  /** A signed webhook arrived: PENDING/ERROR lines become CONNECTED. */
  abstract recordWebhook(lineId: string, at: Date): Promise<void>;
  /** Meta verified the callback URL: only the time, the status stays as is. */
  abstract recordVerification(lineId: string, at: Date): Promise<void>;
  /**
   * Events arrived with a signature that does not match the stored App
   * Secret: the line shows ERROR until a correctly signed webhook arrives.
   */
  abstract recordSignatureFailure(
    lineId: string,
    message: string,
  ): Promise<void>;
}

export interface LineCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Meta's error code (e.g. 131005), when Meta returned one. */
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

/**
 * Port to the WhatsApp Cloud API. "live" talks to Meta's Graph API;
 * "simulated" succeeds without network calls (development and tests).
 */
export abstract class WhatsAppGateway {
  abstract readonly mode: 'live' | 'simulated';
  /** Throws WhatsAppApiError when the credentials are rejected. */
  abstract fetchPhoneNumber(
    credentials: LineCredentials,
  ): Promise<{ displayPhone: string | null; verifiedName: string | null }>;
  /** `to`: the recipient's WhatsApp id (digits only). */
  abstract sendText(
    credentials: LineCredentials,
    to: string,
    text: string,
  ): Promise<{ waMessageId: string }>;
  /**
   * Subscribes the Meta app of the token to the WhatsApp Business Account so
   * Meta delivers its `messages` webhooks. Idempotent.
   */
  abstract subscribeApp(
    credentials: LineCredentials,
    wabaId: string,
  ): Promise<void>;
  /** A media file a customer sent (Meta keeps it about 30 days). */
  abstract downloadMedia(
    credentials: LineCredentials,
    mediaId: string,
  ): Promise<{ body: Readable; mimeType: string | null }>;
  /** Uploads a file to Meta to send it; returns Meta's media id. */
  abstract uploadMedia(
    credentials: LineCredentials,
    file: { body: Buffer; mimeType: string; filename: string },
  ): Promise<{ mediaId: string }>;
  abstract sendMedia(
    credentials: LineCredentials,
    to: string,
    media: OutgoingMedia,
  ): Promise<{ waMessageId: string }>;
  /** Contact cards the customer can save or message. */
  abstract sendContacts(
    credentials: LineCredentials,
    to: string,
    contacts: SharedContact[],
  ): Promise<{ waMessageId: string }>;
  /**
   * Blocks or unblocks a WhatsApp user on the number. Meta only allows
   * blocking users who wrote in the last 24 hours.
   */
  abstract setUserBlocked(
    credentials: LineCredentials,
    waId: string,
    blocked: boolean,
  ): Promise<void>;
  /** What the access token is allowed to do on this WhatsApp Business Account. */
  abstract inspectToken(
    credentials: LineCredentials,
    wabaId: string | null,
  ): Promise<TokenInfo>;
}

export interface TokenInfo {
  valid: boolean;
  /** null: the token does not expire (system user tokens). */
  expiresAt: Date | null;
  /** whatsapp_business_messaging on the account: needed to send. */
  canMessage: boolean;
  /** whatsapp_business_management on the account: needed to subscribe the webhook. */
  canManage: boolean;
}

export interface OutgoingMedia {
  type: 'image' | 'video' | 'audio' | 'document';
  mediaId: string;
  /** Not allowed by WhatsApp on audio. */
  caption: string | null;
  /** Shown to the customer for documents. */
  filename: string | null;
}

/**
 * Receives the events of a verified webhook for one line. Implemented by the
 * inbox (conversations); the channels module only knows this interface.
 */
export abstract class WhatsAppEventsSink {
  abstract handle(line: LineRecord, events: WebhookEvents): Promise<void>;
}
