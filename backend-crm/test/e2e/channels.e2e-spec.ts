import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { signBody } from '../../src/modules/channels/domain/webhook-signature';
import { textMessagePayload } from '../../src/modules/channels/domain/whatsapp-payload';
import { createTestPrisma, truncateAll } from '../utils/test-db';
import { createTestApp, type TestApp } from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';
const ACCESS_TOKEN = 'EAAGtest-access-token-1234567890abcd';
const APP_SECRET = 'app-secret-for-tests-0123456789';

interface Owner {
  token: string;
  workspaceId: string;
}

interface LineBody {
  id: string;
  status: string;
  verifiedName: string | null;
  accessTokenLast4: string;
  webhook: { url: string; verifyToken: string } | null;
  agents: { membershipId: string }[];
  lastWebhookAt: string | null;
}

describe('Channels: WhatsApp lines (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let counter = 0;
  let phoneIds = 100000;

  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await prisma.$disconnect();
  });

  async function signUp(planCode = 'business'): Promise<Owner> {
    const email = `lines${++counter}@example.com`;
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Owner', planCode })
      .expect(202);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;
    const me = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [workspace] = (me.body as { workspaces: { id: string }[] })
      .workspaces;
    return { token, workspaceId: workspace?.id ?? '' };
  }

  const api = (owner: Owner) => {
    const url = (path: string) =>
      `/api/v1/workspaces/${owner.workspaceId}${path}`;
    const auth = { Authorization: `Bearer ${owner.token}` };
    return {
      get: (path: string) => http().get(url(path)).set(auth),
      post: (path: string, body: object = {}) =>
        http().post(url(path)).set(auth).send(body),
      patch: (path: string, body: object) =>
        http().patch(url(path)).set(auth).send(body),
      put: (path: string, body: object) =>
        http().put(url(path)).set(auth).send(body),
    };
  };

  const newLine = (owner: Owner, phoneNumberId = String(++phoneIds)) =>
    api(owner).post('/channels/lines', {
      name: 'Ventas',
      phoneNumberId,
      accessToken: ACCESS_TOKEN,
      appSecret: APP_SECRET,
    });

  const webhook = (lineId: string, body: string, signature?: string) => {
    const req = http()
      .post(`/api/v1/webhooks/whatsapp/${lineId}`)
      .set('Content-Type', 'application/json');
    return (signature ? req.set('X-Hub-Signature-256', signature) : req).send(
      body,
    );
  };

  it('connects a line without ever returning its credentials', async () => {
    const owner = await signUp();
    const created = await newLine(owner, '106540352242922').expect(201);
    const line = created.body as LineBody;

    expect(line).toMatchObject({ status: 'PENDING', accessTokenLast4: 'abcd' });
    expect(line.webhook?.url).toMatch(
      new RegExp(`/api/v1/webhooks/whatsapp/${line.id}$`),
    );
    expect(JSON.stringify(created.body)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(created.body)).not.toContain(APP_SECRET);

    const stored = await prisma.channelLine.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(stored.accessTokenEnc).not.toContain('EAAG');
    expect(stored.appSecretEnc).not.toContain(APP_SECRET);

    const tested = await api(owner)
      .post(`/channels/lines/${line.id}/test`)
      .expect(200);
    expect(tested.body).toMatchObject({
      status: 'CONNECTED',
      verifiedName: 'Simulated line',
    });

    const duplicate = await newLine(owner, '106540352242922').expect(409);
    expect(duplicate.body).toMatchObject({ code: 'PHONE_NUMBER_ID_TAKEN' });
  });

  it('respects limits.whatsapp_lines of the plan', async () => {
    const owner = await signUp('team');
    await newLine(owner).expect(201);
    await newLine(owner).expect(201);
    const third = await newLine(owner).expect(409);
    expect(third.body).toMatchObject({
      code: 'LINE_LIMIT_REACHED',
      details: { limit: 2, usage: 2 },
    });
  });

  it('assigns only active members of the same workspace as agents', async () => {
    const owner = await signUp();
    const other = await signUp();
    const line = (await newLine(owner).expect(201)).body as LineBody;
    const members = (await api(owner).get('/members').expect(200)).body as {
      items: { id: string }[];
    };
    const foreign = (await api(other).get('/members').expect(200)).body as {
      items: { id: string }[];
    };

    const assigned = await api(owner)
      .put(`/channels/lines/${line.id}/agents`, {
        membershipIds: [members.items[0]?.id],
      })
      .expect(200);
    expect((assigned.body as LineBody).agents).toHaveLength(1);

    const refused = await api(owner)
      .put(`/channels/lines/${line.id}/agents`, {
        membershipIds: [foreign.items[0]?.id],
      })
      .expect(404);
    expect(refused.body).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('isolates lines between workspaces', async () => {
    const a = await signUp();
    const b = await signUp();
    const line = (await newLine(a).expect(201)).body as LineBody;
    await api(b).get(`/channels/lines/${line.id}`).expect(404);
    await api(b).post(`/channels/lines/${line.id}/test`).expect(404);
  });

  describe('webhook', () => {
    it('answers Meta verification only with the right verify token', async () => {
      const owner = await signUp();
      const line = (await newLine(owner).expect(201)).body as LineBody;
      const verify = (token: string) =>
        http().get(`/api/v1/webhooks/whatsapp/${line.id}`).query({
          'hub.mode': 'subscribe',
          'hub.verify_token': token,
          'hub.challenge': '1158201444',
        });

      const ok = await verify(line.webhook?.verifyToken ?? '').expect(200);
      expect(ok.text).toBe('1158201444');
      await verify('wrong').expect(403);
    });

    it('accepts signed events, rejects unsigned ones and marks the line connected', async () => {
      const owner = await signUp();
      const line = (await newLine(owner, '200000000001').expect(201))
        .body as LineBody;
      const body = JSON.stringify(
        textMessagePayload({
          phoneNumberId: '200000000001',
          from: '59171234567',
          text: 'Hola',
        }),
      );

      await webhook(line.id, body).expect(401);
      await webhook(line.id, body, signBody(body, 'another-secret')).expect(
        401,
      );
      await webhook(line.id, body, signBody(body, APP_SECRET)).expect(200);

      const after = (
        await api(owner).get(`/channels/lines/${line.id}`).expect(200)
      ).body as LineBody;
      expect(after.status).toBe('CONNECTED');
      expect(after.lastWebhookAt).not.toBeNull();
    });

    it('ignores events of disabled lines but still answers 200', async () => {
      const owner = await signUp();
      const line = (await newLine(owner, '200000000002').expect(201))
        .body as LineBody;
      await api(owner)
        .patch(`/channels/lines/${line.id}`, { enabled: false })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({ status: 'DISABLED' }),
        );
      const body = JSON.stringify(
        textMessagePayload({
          phoneNumberId: '200000000002',
          from: '1',
          text: 'x',
        }),
      );
      await webhook(line.id, body, signBody(body, APP_SECRET)).expect(200);
    });
  });

  it('requires channels permissions', async () => {
    const owner = await signUp();
    const roles = (await api(owner).get('/roles').expect(200)).body as {
      id: string;
      key: string;
    }[];
    const email = `agentlines${++counter}@example.com`;
    await api(owner)
      .post('/members', {
        email,
        displayName: 'Agent',
        roleId: roles.find((r) => r.key === 'AGENT')?.id,
      })
      .expect(201);
    const temporary = /Temporary password: (\S+)/.exec(
      t.mailer.last(email).text,
    )?.[1];
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: temporary })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;
    await http()
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: temporary, newPassword: PASSWORD })
      .expect(204);

    const agent = { token, workspaceId: owner.workspaceId };
    await api(agent).get('/channels/lines').expect(403);
    await newLine(agent).expect(403);
  });
});
