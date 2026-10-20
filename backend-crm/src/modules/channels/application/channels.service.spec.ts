import type { AppConfigService } from '../../../config/app-config.service';
import type { WorkspaceEntitlements } from '../../../shared/entitlements/workspace-entitlements';
import type { SecretBox } from '../../../shared/security/secret-box';
import type { AuditService } from '../../audit/audit.service';
import { ChannelsService } from './channels.service';
import {
  WhatsAppApiError,
  type ChannelsStore,
  type LineRecord,
  type LineUpdate,
  type WhatsAppGateway,
} from './ports';

const WS = 'ws-1';

function lineRecord(overrides: Partial<LineRecord> = {}): LineRecord {
  return {
    id: 'line-1',
    workspaceId: WS,
    name: 'Ventas',
    provider: 'WHATSAPP_CLOUD',
    phoneNumberId: '358803983978663',
    wabaId: '360908340436091',
    displayPhone: null,
    verifiedName: null,
    accessTokenLast4: 'abcd',
    webhookVerifyToken: 'verify-token',
    status: 'PENDING',
    lastError: null,
    lastWebhookAt: null,
    autoAssign: false,
    agents: [],
    createdAt: new Date('2026-10-20T00:00:00Z'),
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    ...overrides,
  };
}

function setup(line: LineRecord, gateway: Partial<WhatsAppGateway>) {
  let current = line;
  const store = {
    findLine: jest.fn(() => Promise.resolve(current)),
    getSecrets: jest.fn(() =>
      Promise.resolve({ accessTokenEnc: 'enc:token', appSecretEnc: 'enc:s' }),
    ),
    updateLine: jest.fn((_ws: string, _id: string, data: LineUpdate) => {
      current = { ...current, ...data };
      return Promise.resolve(current);
    }),
  } as unknown as ChannelsStore;
  const secrets = {
    decrypt: (value: string) => value.replace(/^enc:/, ''),
  } as unknown as SecretBox;
  const config = {
    get: () => 'https://crm.example.com',
  } as unknown as AppConfigService;
  const service = new ChannelsService(
    store,
    {
      mode: 'live',
      fetchPhoneNumber: jest.fn().mockResolvedValue({
        displayPhone: '+1 555 0100',
        verifiedName: 'Test Number',
      }),
      subscribeApp: jest.fn().mockResolvedValue(undefined),
      ...gateway,
    } as unknown as WhatsAppGateway,
    {} as WorkspaceEntitlements,
    secrets,
    {} as AuditService,
    config,
  );
  return { service };
}

describe('ChannelsService.test', () => {
  it('subscribes the app to the WABA and connects the line', async () => {
    const subscribeApp = jest.fn().mockResolvedValue(undefined);
    const { service } = setup(lineRecord(), { subscribeApp });

    const view = await service.test(WS, 'line-1');

    expect(subscribeApp).toHaveBeenCalledWith(
      { phoneNumberId: '358803983978663', accessToken: 'token' },
      '360908340436091',
    );
    expect(view).toMatchObject({
      status: 'CONNECTED',
      verifiedName: 'Test Number',
      displayPhone: '+1 555 0100',
      lastError: null,
    });
  });

  it('skips the subscription when the line has no WABA id', async () => {
    const subscribeApp = jest.fn();
    const { service } = setup(lineRecord({ wabaId: null }), { subscribeApp });

    await expect(service.test(WS, 'line-1')).resolves.toMatchObject({
      status: 'CONNECTED',
    });
    expect(subscribeApp).not.toHaveBeenCalled();
  });

  it('marks the line in error when Meta refuses the subscription', async () => {
    const { service } = setup(lineRecord(), {
      subscribeApp: jest
        .fn()
        .mockRejectedValue(new WhatsAppApiError('Missing permission', 403)),
    });

    const view = await service.test(WS, 'line-1');

    expect(view.status).toBe('ERROR');
    expect(view.lastError).toBe(
      'Could not subscribe the app to the WhatsApp Business Account: Missing permission',
    );
  });
});
