import type { SecretBox } from '../../../shared/security/secret-box';
import { signBody } from '../domain/webhook-signature';
import type { ChannelsStore } from './ports';
import {
  SIGNATURE_MISMATCH_ERROR,
  WhatsAppWebhookService,
} from './whatsapp-webhook.service';

const APP_SECRET = '0123456789abcdef0123456789abcdef';
const BODY = Buffer.from(
  JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
);

function setup() {
  const store = {
    findLineById: jest.fn().mockResolvedValue({
      id: 'line-1',
      workspaceId: 'ws-1',
    }),
    getSecrets: jest
      .fn()
      .mockResolvedValue({ accessTokenEnc: 'x', appSecretEnc: 'secret' }),
    findLinesByPhoneNumberIds: jest.fn().mockResolvedValue([]),
    recordSignatureFailure: jest.fn().mockResolvedValue(undefined),
  };
  const secrets = { decrypt: () => APP_SECRET } as unknown as SecretBox;
  const service = new WhatsAppWebhookService(
    store as unknown as ChannelsStore,
    secrets,
    { handle: jest.fn() },
    { now: () => new Date('2026-10-21T12:00:00Z') },
  );
  return { service, store };
}

describe('WhatsAppWebhookService.receive', () => {
  it('flags the line when Meta signs with another App Secret', async () => {
    const { service, store } = setup();

    await expect(
      service.receive('line-1', BODY, signBody(BODY, 'another-secret')),
    ).rejects.toMatchObject({ status: 401 });
    expect(store.recordSignatureFailure).toHaveBeenCalledWith(
      'line-1',
      SIGNATURE_MISMATCH_ERROR,
    );
  });

  it('leaves the line alone for unsigned requests', async () => {
    const { service, store } = setup();

    await expect(
      service.receive('line-1', BODY, undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(store.recordSignatureFailure).not.toHaveBeenCalled();
  });

  it('accepts events signed with the line App Secret', async () => {
    const { service, store } = setup();

    await service.receive('line-1', BODY, signBody(BODY, APP_SECRET));
    expect(store.recordSignatureFailure).not.toHaveBeenCalled();
  });
});
