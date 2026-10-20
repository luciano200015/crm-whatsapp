import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { signBody } from '../../src/modules/channels/domain/webhook-signature';
import { textMessagePayload } from '../../src/modules/channels/domain/whatsapp-payload';
import {
  clearMongo,
  createTestMongo,
  createTestPrisma,
  truncateAll,
} from '../utils/test-db';
import { createTestApp, type TestApp } from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';
const APP_SECRET = 'app-secret-for-inbox-tests-01';

interface Session {
  token: string;
  workspaceId: string;
  membershipId: string;
}

interface ConversationBody {
  id: string;
  lineId: string;
  lineName: string | null;
  status: string;
  contact: { name: string | null; phone: string };
  assignee: { membershipId: string; name: string } | null;
  lastMessage: { text: string | null; direction: string } | null;
  unreadCount: number;
  windowOpen: boolean;
}

interface MessageBody {
  id: string;
  direction: string;
  text: string | null;
  status: string;
  sentBy: { name: string } | null;
}

describe('Inbox (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let mongo: Connection;
  let counter = 0;
  let phoneIds = 300000000000;
  let waIds = 0;

  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    prisma = createTestPrisma();
    mongo = await createTestMongo();
    await truncateAll(prisma);
    await clearMongo(mongo);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await prisma.$disconnect();
    await mongo.close();
  });

  async function sessionFor(token: string, workspaceId: string) {
    const me = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const userId = (me.body as { id: string }).id;
    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return { token, workspaceId, membershipId: membership.id };
  }

  async function signUp(): Promise<Session> {
    const email = `inbox${++counter}@example.com`;
    await http()
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        displayName: 'Olga Owner',
        planCode: 'business',
      })
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
    return sessionFor(token, workspace?.id ?? '');
  }

  async function agentOf(owner: Session, name: string): Promise<Session> {
    const email = `agent${++counter}@example.com`;
    const roles = (await api(owner).get('/roles').expect(200)).body as {
      id: string;
      key: string;
    }[];
    await api(owner)
      .post('/members', {
        email,
        displayName: name,
        roleId: roles.find((r) => r.key === 'AGENT')?.id,
      })
      .expect(201);
    const temporary = /Temporary password: (\S+)/.exec(
      t.mailer.last(email).text,
    )?.[1];
    const first = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: temporary })
      .expect(200);
    const token = (first.body as { accessToken: string }).accessToken;
    await http()
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: temporary, newPassword: PASSWORD })
      .expect(204);
    return sessionFor(token, owner.workspaceId);
  }

  const api = (session: Session) => {
    const url = (path: string) =>
      `/api/v1/workspaces/${session.workspaceId}${path}`;
    const auth = { Authorization: `Bearer ${session.token}` };
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

  async function lineWithAgents(
    owner: Session,
    agents: Session[],
    autoAssign = true,
  ) {
    const phoneNumberId = String(++phoneIds);
    const line = (
      await api(owner)
        .post('/channels/lines', {
          name: 'Ventas',
          phoneNumberId,
          accessToken: 'EAAG-token-for-inbox-tests-1234',
          appSecret: APP_SECRET,
        })
        .expect(201)
    ).body as { id: string };
    await api(owner)
      .put(`/channels/lines/${line.id}/agents`, {
        membershipIds: agents.map((agent) => agent.membershipId),
      })
      .expect(200);
    await api(owner)
      .patch(`/channels/lines/${line.id}`, { autoAssign })
      .expect(200);
    return { id: line.id, phoneNumberId };
  }

  function incoming(
    line: { id: string; phoneNumberId: string },
    from: string,
    text: string,
    options: { name?: string; waMessageId?: string } = {},
  ) {
    const body = JSON.stringify(
      textMessagePayload({
        phoneNumberId: line.phoneNumberId,
        from,
        text,
        profileName: options.name,
        waMessageId: options.waMessageId ?? `wamid.in.${++waIds}`,
      }),
    );
    return http()
      .post(`/api/v1/webhooks/whatsapp/${line.id}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .send(body)
      .expect(200);
  }

  function statusUpdate(
    line: { id: string; phoneNumberId: string },
    waMessageId: string,
    status: string,
  ) {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: line.phoneNumberId },
                statuses: [
                  {
                    id: waMessageId,
                    status,
                    timestamp: '1',
                    recipient_id: '1',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return http()
      .post(`/api/v1/webhooks/whatsapp/${line.id}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .send(body)
      .expect(200);
  }

  const conversations = async (session: Session, query = '') =>
    (
      (await api(session).get(`/conversations${query}`).expect(200)).body as {
        items: ConversationBody[];
      }
    ).items;

  it('turns incoming WhatsApp messages into contacts and conversations, idempotently', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);

    await incoming(line, '59171234567', 'Hola', {
      name: 'Lucía',
      waMessageId: 'wamid.same',
    });
    await incoming(line, '59171234567', 'Hola', {
      name: 'Lucía',
      waMessageId: 'wamid.same',
    });
    await incoming(line, '59171234567', '¿Tienen stock?');

    const [conversation, ...others] = await conversations(owner, '?view=all');
    expect(others).toEqual([]);
    expect(conversation).toMatchObject({
      lineName: 'Ventas',
      status: 'OPEN',
      contact: { name: 'Lucía', phone: '+59171234567' },
      assignee: null,
      lastMessage: { text: '¿Tienen stock?', direction: 'IN' },
      unreadCount: 2,
      windowOpen: true,
    });
    const messages = (
      await api(owner)
        .get(`/conversations/${conversation?.id}/messages`)
        .expect(200)
    ).body as { items: MessageBody[] };
    expect(messages.items.map((m) => m.text)).toEqual([
      '¿Tienen stock?',
      'Hola',
    ]);

    const contacts = (await api(owner).get('/contacts?search=4567').expect(200))
      .body as {
      items: { name: string; source: string }[];
    };
    expect(contacts.items).toEqual([
      expect.objectContaining({ name: 'Lucía', source: 'whatsapp' }),
    ]);
  });

  it('auto-assigns new conversations in turns and limits what agents see', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const beto = await agentOf(owner, 'Beto');
    const line = await lineWithAgents(owner, [ana, beto]);

    await incoming(line, '59170000001', 'uno');
    await incoming(line, '59170000002', 'dos');
    await incoming(line, '59170000003', 'tres');

    const all = await conversations(owner, '?view=all');
    expect(
      all
        .map((c) => [c.contact.phone, c.assignee?.name])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['+59170000001', 'Ana'],
      ['+59170000002', 'Beto'],
      ['+59170000003', 'Ana'],
    ]);

    const anaSees = await conversations(ana, '?view=all');
    expect(anaSees.map((c) => c.contact.phone).sort()).toEqual([
      '+59170000001',
      '+59170000003',
    ]);
    const betosChat = all.find((c) => c.assignee?.name === 'Beto');
    const hidden = await api(ana)
      .get(`/conversations/${betosChat?.id}`)
      .expect(404);
    expect(hidden.body).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });

    const counts = (await api(ana).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({ mine: 2, unassigned: 0, all: 2, unread: 2 });
  });

  it('shows unassigned chats only to the agents of the line', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const outsider = await agentOf(owner, 'Otro');
    const line = await lineWithAgents(owner, [ana], false);
    await incoming(line, '59170000010', 'sin asignar');

    expect(await conversations(ana, '?view=unassigned')).toHaveLength(1);
    expect(await conversations(outsider, '?view=all')).toEqual([]);

    // "Tomar chat", and nobody else can take it afterwards.
    const [chat] = await conversations(ana, '?view=unassigned');
    await api(ana).post(`/conversations/${chat?.id}/take`).expect(200);
    await api(owner).post(`/conversations/${chat?.id}/take`).expect(409);
  });

  it('replies through WhatsApp, records notes and follows delivery statuses', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000020', 'Hola');
    const [chat] = await conversations(owner, '?view=all');

    const reply = (
      await api(owner)
        .post(`/conversations/${chat?.id}/messages`, {
          text: '¡Hola! ¿En qué te ayudo?',
        })
        .expect(201)
    ).body as MessageBody;
    expect(reply).toMatchObject({
      direction: 'OUT',
      status: 'sent',
      sentBy: { name: 'Olga Owner' },
    });

    const after = (
      await api(owner).get(`/conversations/${chat?.id}`).expect(200)
    ).body as ConversationBody;
    expect(after.assignee?.name).toBe('Olga Owner');
    expect(after.unreadCount).toBe(0);

    const stored = await mongo
      .collection('messages')
      .findOne({ text: '¡Hola! ¿En qué te ayudo?' });
    await statusUpdate(line, String(stored?.waMessageId), 'delivered');
    await statusUpdate(line, String(stored?.waMessageId), 'read');
    await statusUpdate(line, String(stored?.waMessageId), 'delivered');
    const messages = (
      await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200)
    ).body as { items: MessageBody[] };
    expect(messages.items[0]).toMatchObject({ id: reply.id, status: 'read' });

    await api(owner)
      .post(`/conversations/${chat?.id}/notes`, { text: 'Cliente VIP' })
      .expect(201);
    const withNote = (
      await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200)
    ).body as { items: MessageBody[] };
    expect(withNote.items[0]).toMatchObject({
      direction: 'NOTE',
      text: 'Cliente VIP',
    });
  });

  it('refuses replies outside the 24 h window and on closed conversations', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000030', 'Hola');
    const [chat] = await conversations(owner, '?view=all');

    await api(owner).post(`/conversations/${chat?.id}/close`).expect(200);
    const closed = await api(owner)
      .post(`/conversations/${chat?.id}/messages`, { text: 'x' })
      .expect(409);
    expect(closed.body).toMatchObject({ code: 'CONVERSATION_CLOSED' });
    expect(await conversations(owner, '?view=all&status=CLOSED')).toHaveLength(
      1,
    );

    await api(owner).post(`/conversations/${chat?.id}/reopen`).expect(200);
    await mongo
      .collection('conversations')
      .updateOne(
        { contactId: { $exists: true }, 'contact.phone': '+59170000030' },
        { $set: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } },
      );
    const expired = await api(owner)
      .post(`/conversations/${chat?.id}/messages`, { text: 'x' })
      .expect(409);
    expect(expired.body).toMatchObject({ code: 'WINDOW_CLOSED' });

    // A new message after closing opens a new conversation.
    await api(owner).post(`/conversations/${chat?.id}/close`).expect(200);
    await incoming(line, '59170000030', 'Volví');
    expect(await conversations(owner, '?view=all')).toHaveLength(1);
    const reopen = await api(owner)
      .post(`/conversations/${chat?.id}/reopen`)
      .expect(409);
    expect(reopen.body).toMatchObject({ code: 'CONVERSATION_ALREADY_OPEN' });
  });

  it('lets admins assign and transfer; agents cannot', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const beto = await agentOf(owner, 'Beto');
    const line = await lineWithAgents(owner, [ana, beto], false);
    await incoming(line, '59170000040', 'Hola');
    const [chat] = await conversations(owner, '?view=all');

    await api(owner)
      .post(`/conversations/${chat?.id}/assign`, {
        membershipId: beto.membershipId,
      })
      .expect(200);
    expect(await conversations(beto, '?view=mine')).toHaveLength(1);
    await api(beto)
      .post(`/conversations/${chat?.id}/assign`, {
        membershipId: ana.membershipId,
      })
      .expect(403);
  });

  it('streams events the member may see (server-sent events)', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    const server = t.app.getHttpServer() as unknown as Server;
    if (!server.listening)
      await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();

    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/workspaces/${owner.workspaceId}/conversations/events`,
      {
        headers: { Authorization: `Bearer ${owner.token}` },
        signal: controller.signal,
      },
    );
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = response.body?.getReader();
    await incoming(line, '59170000050', 'en vivo');

    let received = '';
    const decoder = new TextDecoder();
    while (reader && !received.includes('message.created')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    controller.abort();
    expect(received).toContain('event: message.created');
    expect(received).toContain('en vivo');
  });
});
