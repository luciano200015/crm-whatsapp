import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import {
  planLimit,
  WorkspaceEntitlements,
} from '../../../shared/entitlements/workspace-entitlements';
import type { RequestContext } from '../../../shared/http/request-context';
import { SecretBox } from '../../../shared/security/secret-box';
import { AuditService } from '../../audit/audit.service';
import { ChannelsErrors } from './channels-errors';
import {
  ChannelsStore,
  WhatsAppApiError,
  WhatsAppGateway,
  type LineAgent,
  type LineRecord,
  type LineStatus,
  type LineUpdate,
} from './ports';

export interface LineView {
  id: string;
  name: string;
  provider: 'WHATSAPP_CLOUD';
  phoneNumberId: string;
  wabaId: string | null;
  displayPhone: string | null;
  verifiedName: string | null;
  status: LineStatus;
  lastError: string | null;
  lastWebhookAt: Date | null;
  autoAssign: boolean;
  color: string | null;
  agents: LineAgent[];
  /** Credentials are never returned: only that they exist and the last 4 characters. */
  accessTokenLast4: string;
  /** From the last connection test; null when unknown or the token does not expire. */
  accessTokenExpiresAt: Date | null;
  /** Configuration for Meta; only for members with channels.manage. */
  webhook: { url: string; verifyToken: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LineInput {
  name: string;
  phoneNumberId: string;
  wabaId?: string | null;
  displayPhone?: string | null;
  accessToken: string;
  appSecret: string;
  /** #rrggbb; null or absent = default. */
  color?: string | null;
}

export interface LineChanges extends Partial<LineInput> {
  /** false disables the line (webhooks ignored, nothing sent). */
  enabled?: boolean;
  autoAssign?: boolean;
}

const TOKEN_INVALID =
  'El token de acceso ya no es válido (venció o fue revocado). Genera uno nuevo en Meta y guárdalo en la línea.';
const TOKEN_CANNOT_MESSAGE =
  'El token no tiene permiso para enviar mensajes (whatsapp_business_messaging) en esta cuenta de WhatsApp. Genera uno nuevo con ese permiso y guárdalo en la línea.';

interface Actor {
  userId: string;
  context: RequestContext;
}

/** WhatsApp lines of a workspace: credentials, plan limit, agents, auto-assignment flag. */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly store: ChannelsStore,
    private readonly gateway: WhatsAppGateway,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async list(workspaceId: string, canManage: boolean): Promise<LineView[]> {
    const lines = await this.store.listLines(workspaceId);
    return lines.map((line) => this.toView(line, canManage));
  }

  async get(
    workspaceId: string,
    lineId: string,
    canManage: boolean,
  ): Promise<LineView> {
    return this.toView(await this.requireLine(workspaceId, lineId), canManage);
  }

  async create(
    workspaceId: string,
    input: LineInput,
    actor: Actor,
  ): Promise<LineView> {
    const plan = await this.entitlements.entitlements(workspaceId);
    if (!plan?.hasFullAccess) throw ChannelsErrors.subscriptionInactive();
    const limit = planLimit(plan, 'limits.whatsapp_lines');

    const result = await this.store.createLine(
      workspaceId,
      {
        name: input.name.trim(),
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId ?? null,
        displayPhone: input.displayPhone?.trim() || null,
        color: input.color?.toLowerCase() ?? null,
        ...this.sealCredentials(input.accessToken, input.appSecret),
        webhookVerifyToken: randomBytes(24).toString('base64url'),
      },
      limit,
    );
    if ('kind' in result) {
      if (result.kind === 'phone_number_taken') {
        throw ChannelsErrors.phoneNumberIdTaken();
      }
      throw ChannelsErrors.lineLimitReached({
        plan: plan.planName,
        limit: limit ?? 0,
        usage: result.lines,
      });
    }
    await this.audit.record({
      action: 'channels.line.created',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'channel_line',
      targetId: result.id,
      context: actor.context,
      metadata: { phoneNumberId: result.phoneNumberId },
    });
    return this.toView(result, true);
  }

  async update(
    workspaceId: string,
    lineId: string,
    changes: LineChanges,
    actor: Actor,
  ): Promise<LineView> {
    const current = await this.requireLine(workspaceId, lineId);
    const credentialsChanged =
      changes.accessToken !== undefined ||
      changes.appSecret !== undefined ||
      (changes.phoneNumberId !== undefined &&
        changes.phoneNumberId !== current.phoneNumberId);

    const data: LineUpdate = {
      ...(changes.name !== undefined && { name: changes.name.trim() }),
      ...(changes.phoneNumberId !== undefined && {
        phoneNumberId: changes.phoneNumberId,
      }),
      ...(changes.wabaId !== undefined && { wabaId: changes.wabaId }),
      ...(changes.displayPhone !== undefined && {
        displayPhone: changes.displayPhone?.trim() || null,
      }),
      ...(changes.accessToken !== undefined && {
        accessTokenEnc: this.secrets.encrypt(changes.accessToken),
        accessTokenLast4: changes.accessToken.slice(-4),
        accessTokenExpiresAt: null,
      }),
      ...(changes.appSecret !== undefined && {
        appSecretEnc: this.secrets.encrypt(changes.appSecret),
      }),
      ...(changes.autoAssign !== undefined && {
        autoAssign: changes.autoAssign,
      }),
      ...(changes.color !== undefined && {
        color: changes.color?.toLowerCase() ?? null,
      }),
      // New credentials must be verified again; re-enabling also starts over.
      ...((credentialsChanged || changes.enabled === true) && {
        status: 'PENDING',
        lastError: null,
      }),
      ...(changes.enabled === false && { status: 'DISABLED' }),
    };
    const updated = await this.store.updateLine(workspaceId, lineId, data);
    if (updated === 'phone_number_taken') {
      throw ChannelsErrors.phoneNumberIdTaken();
    }
    if (!updated) throw ChannelsErrors.lineNotFound();
    await this.audit.record({
      action: 'channels.line.updated',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'channel_line',
      targetId: lineId,
      context: actor.context,
      // Field names only: the values may be credentials.
      metadata: { fields: Object.keys(changes) },
    });
    return this.toView(updated, true);
  }

  async remove(workspaceId: string, lineId: string, actor: Actor) {
    if (!(await this.store.deleteLine(workspaceId, lineId))) {
      throw ChannelsErrors.lineNotFound();
    }
    await this.audit.record({
      action: 'channels.line.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'channel_line',
      targetId: lineId,
      context: actor.context,
    });
  }

  /**
   * Checks the credentials against Meta and subscribes the app to the WABA
   * (without it Meta sends no `messages` webhooks): CONNECTED with the
   * verified number and name, or ERROR with Meta's message (credentials are
   * never echoed).
   */
  async test(workspaceId: string, lineId: string): Promise<LineView> {
    const line = await this.requireLine(workspaceId, lineId);
    const credentials = await this.credentials(line);
    let data: LineUpdate;
    try {
      const phone = await this.gateway.fetchPhoneNumber(credentials);
      if (line.wabaId) {
        await this.gateway
          .subscribeApp(credentials, line.wabaId)
          .catch((error: unknown) => {
            throw error instanceof WhatsAppApiError
              ? new WhatsAppApiError(
                  `Could not subscribe the app to the WhatsApp Business Account: ${error.message}`,
                  error.status,
                  error.code,
                )
              : error;
          });
      }
      // Reading the number and subscribing need only the management scope:
      // sending also needs whatsapp_business_messaging.
      const token = await this.gateway.inspectToken(credentials, line.wabaId);
      const problem = !token.valid
        ? TOKEN_INVALID
        : !token.canMessage
          ? TOKEN_CANNOT_MESSAGE
          : null;
      data = {
        status: problem
          ? 'ERROR'
          : line.status === 'DISABLED'
            ? 'DISABLED'
            : 'CONNECTED',
        lastError: problem,
        verifiedName: phone.verifiedName,
        accessTokenExpiresAt: token.expiresAt,
        ...(phone.displayPhone && { displayPhone: phone.displayPhone }),
      };
    } catch (error: unknown) {
      if (!(error instanceof WhatsAppApiError)) throw error;
      data = { status: 'ERROR', lastError: error.message.slice(0, 500) };
    }
    const updated = await this.store.updateLine(workspaceId, lineId, data);
    if (!updated || updated === 'phone_number_taken') {
      throw ChannelsErrors.lineNotFound();
    }
    return this.toView(updated, true);
  }

  async setAgents(
    workspaceId: string,
    lineId: string,
    membershipIds: string[],
  ): Promise<LineView> {
    const result = await this.store.setAgents(
      workspaceId,
      lineId,
      membershipIds,
    );
    if (result === 'member_not_found') throw ChannelsErrors.memberNotFound();
    if (!result) throw ChannelsErrors.lineNotFound();
    return this.toView(result, true);
  }

  /** Decrypted credentials, for sending messages (inbox) and tests. */
  async credentials(line: Pick<LineRecord, 'id' | 'phoneNumberId'>) {
    const secrets = await this.store.getSecrets(line.id);
    if (!secrets) throw ChannelsErrors.lineNotFound();
    return {
      phoneNumberId: line.phoneNumberId,
      accessToken: this.secrets.decrypt(secrets.accessTokenEnc),
    };
  }

  webhookUrl(lineId: string): string {
    const base = (this.config.get('PUBLIC_API_URL') ?? '').replace(/\/+$/, '');
    return `${base}/api/v1/webhooks/whatsapp/${lineId}`;
  }

  private sealCredentials(accessToken: string, appSecret: string) {
    return {
      accessTokenEnc: this.secrets.encrypt(accessToken),
      accessTokenLast4: accessToken.slice(-4),
      appSecretEnc: this.secrets.encrypt(appSecret),
    };
  }

  private async requireLine(
    workspaceId: string,
    lineId: string,
  ): Promise<LineRecord> {
    const line = await this.store.findLine(workspaceId, lineId);
    if (!line) throw ChannelsErrors.lineNotFound();
    return line;
  }

  private toView(line: LineRecord, canManage: boolean): LineView {
    const { webhookVerifyToken, workspaceId: _workspaceId, ...rest } = line;
    return {
      ...rest,
      webhook: canManage
        ? { url: this.webhookUrl(line.id), verifyToken: webhookVerifyToken }
        : null,
    };
  }
}
