import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types, type Connection } from 'mongoose';
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
const APP_SECRET = 'fedcba9876543210fedcba9876543210';

interface Session {
  token: string;
  workspaceId: string;
  membershipId: string;
}

interface ConversationBody {
  id: string;
  contactId: string;
  lineId: string;
  lineName: string | null;
  status: string;
  contact: { name: string | null; phone: string };
  assignee: { membershipId: string; name: string } | null;
  lastMessage: {
    text: string | null;
    direction: string;
    messageId?: string | null;
    status?: string | null;
  } | null;
  contactTagIds?: string[];
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

  function incomingImage(
    line: { id: string; phoneNumberId: string },
    from: string,
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
                contacts: [{ wa_id: from, profile: { name: 'Foto' } }],
                messages: [
                  {
                    id: `wamid.img.${++waIds}`,
                    from,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'image',
                    image: {
                      id: 'meta-media-1',
                      mime_type: 'image/jpeg',
                      caption: 'Mi pedido',
                    },
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
    await api(owner)
      .post(`/conversations/${conversation?.id}/close`)
      .expect(200);
    await incoming(line, '59171234567', 'Hola', { waMessageId: 'wamid.same' });
    expect(await conversations(owner, '?view=all')).toHaveLength(0);
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

  it('lists mine or mine plus my agents, and filters by tag, agent, dates and order', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const outsider = await agentOf(owner, 'Otro');
    const line = await lineWithAgents(owner, [ana], false);
    await incoming(line, '59170000041', 'uno');
    await incoming(line, '59170000042', 'dos');
    await incoming(line, '59170000043', 'tres');
    const byPhone = async (session: Session, query: string) =>
      (await conversations(session, query)).map((c) => c.contact.phone);
    const [newest, middle, oldest] = await conversations(owner, '?view=all');
    await api(ana).post(`/conversations/${newest?.id}/take`).expect(200);
    await api(owner).post(`/conversations/${middle?.id}/take`).expect(200);

    // Only mine; mine + my agents + the unassigned (agents: theirs + unassigned of their lines).
    expect(await byPhone(ana, '?view=mine')).toEqual(['+59170000043']);
    expect(await byPhone(ana, '?view=all')).toEqual([
      '+59170000043',
      '+59170000041',
    ]);
    expect(await byPhone(owner, '?view=all')).toEqual([
      '+59170000043',
      '+59170000042',
      '+59170000041',
    ]);
    expect(await byPhone(outsider, '?view=all')).toEqual([]);

    // By agent ('none' = unassigned), only with conversations.view_all.
    expect(
      await byPhone(owner, `?view=all&assigneeIds=${ana.membershipId},none`),
    ).toEqual(['+59170000043', '+59170000041']);
    const forbidden = await api(ana)
      .get(`/conversations?view=all&assigneeIds=${owner.membershipId}`)
      .expect(403);
    expect(forbidden.body).toMatchObject({ code: 'AGENT_FILTER_FORBIDDEN' });

    // By tag of the contact; the list says the tags of each chat.
    const tag = (
      await api(owner)
        .post('/tags', { name: 'VIP', color: '#22c55e' })
        .expect(201)
    ).body as { id: string };
    await api(owner)
      .put(`/contacts/${middle?.contactId}/tags`, { tagIds: [tag.id] })
      .expect(200);
    const tagged = await conversations(owner, `?view=all&tagIds=${tag.id}`);
    expect(tagged.map((c) => [c.contact.phone, c.contactTagIds])).toEqual([
      ['+59170000042', [tag.id]],
    ]);

    // Oldest first, page by page.
    const first = (
      await api(owner)
        .get('/conversations?view=all&sort=oldest&limit=2')
        .expect(200)
    ).body as { items: ConversationBody[]; nextCursor: string };
    const second = (
      await api(owner)
        .get(
          `/conversations?view=all&sort=oldest&limit=2&cursor=${first.nextCursor}`,
        )
        .expect(200)
    ).body as { items: ConversationBody[] };
    expect(
      [...first.items, ...second.items].map((c) => c.contact.phone),
    ).toEqual(['+59170000041', '+59170000042', '+59170000043']);
    expect(oldest?.contact.phone).toBe('+59170000041');

    // Date range on the last activity.
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await byPhone(owner, `?view=all&from=${future}`)).toEqual([]);
    expect(await byPhone(owner, `?view=all&to=${future}&limit=1`)).toHaveLength(
      1,
    );

    const counts = (await api(ana).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({
      mine: 1,
      mineOnHold: 0,
      mineClosed: 0,
      all: 2,
    });
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
          clientId: '0b9f6d3e-6c1a-4d8e-9a5e-2f1c3b4a5d6e',
        })
        .expect(201)
    ).body as MessageBody;
    expect(reply).toMatchObject({
      direction: 'OUT',
      status: 'sent',
      sentBy: { name: 'Olga Owner' },
      // The browser matches its own bubble by this id.
      clientId: '0b9f6d3e-6c1a-4d8e-9a5e-2f1c3b4a5d6e',
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
    const [listed] = await conversations(owner, '?view=all');
    expect(listed?.lastMessage).toMatchObject({
      messageId: reply.id,
      status: 'read',
      direction: 'OUT',
    });

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

    // A new message after closing reopens the SAME conversation.
    await api(owner).post(`/conversations/${chat?.id}/close`).expect(200);
    await incoming(line, '59170000030', 'Volví');
    const all = await conversations(owner, '?view=all&status=ALL');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: chat?.id, status: 'OPEN' });
  });

  it('keeps one chat per contact: reopened unassigned when the customer writes again', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const line = await lineWithAgents(owner, [ana], true);
    await incoming(line, '59170000090', 'Hola');
    const [chat] = await conversations(owner, '?view=all');
    expect(chat?.assignee?.name).toBe('Ana');

    await api(ana).post(`/conversations/${chat?.id}/close`).expect(200);
    await incoming(line, '59170000090', 'Otra consulta');

    const [again] = await conversations(owner, '?view=all&status=ALL');
    expect(again).toMatchObject({
      id: chat?.id,
      status: 'OPEN',
      assignee: null,
    });
    const history = (
      (await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200))
        .body as {
        items: {
          direction: string;
          text: string | null;
          event: { kind: string; by: unknown } | null;
        }[];
      }
    ).items;
    // Newest first: the customer's message, then the reopen notice before it.
    expect(history[0]).toMatchObject({
      direction: 'IN',
      text: 'Otra consulta',
    });
    expect(history[1]?.event).toEqual({
      kind: 'reopened',
      by: null,
      from: null,
      to: null,
    });
    expect(history.filter((m) => m.direction === 'IN')).toHaveLength(2);
  });

  it('puts chats on hold; they stay on hold when the customer writes', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000091', 'Necesito una cotización');
    const [chat] = await conversations(owner, '?view=all');

    const held = await api(owner)
      .post(`/conversations/${chat?.id}/hold`)
      .expect(200);
    expect(held.body).toMatchObject({ status: 'ON_HOLD' });
    await incoming(line, '59170000091', '¿Alguna novedad?');

    expect(await conversations(owner, '?view=all')).toHaveLength(0);
    const waiting = await conversations(owner, '?view=all&status=ON_HOLD');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ id: chat?.id, unreadCount: 2 });
    const counts = (await api(owner).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({ all: 0, onHold: 1, unread: 2 });

    // Replying is allowed while on hold; reopening brings it back.
    await api(owner)
      .post(`/conversations/${chat?.id}/messages`, { text: 'Ya casi' })
      .expect(201);
    await api(owner).post(`/conversations/${chat?.id}/reopen`).expect(200);
    expect(await conversations(owner, '?view=all')).toHaveLength(1);
  });

  it('applies the chat module settings: assignment, transfers, signature and closing message', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana Agente');
    const beto = await agentOf(owner, 'Beto Agente');
    const line = await lineWithAgents(owner, [ana, beto], false);

    const defaults = await api(ana).get('/chat-settings').expect(200);
    expect(defaults.body).toMatchObject({
      assignment: { mode: 'NONE', includeAdmins: false },
      transfers: false,
      signature: 'AGENT_CHOICE',
      closeMessage: { mode: 'NEVER', text: '' },
      legacyAssignment: true,
    });
    const settings = {
      assignment: { mode: 'LEAST_BUSY', includeAdmins: false },
      transfers: false,
      signature: 'NEVER',
      closeMessage: { mode: 'ASK', text: '¡Gracias por escribirnos!' },
    };
    await api(ana).put('/chat-settings', settings).expect(403);
    await api(owner)
      .put('/chat-settings', { ...settings, signature: 'SOMETIMES' })
      .expect(400);
    await api(owner).put('/chat-settings', settings).expect(200);

    // Nobody has the inbox open: the chat waits unassigned.
    await incoming(line, '59170000201', 'Hola');
    const [waiting] = await conversations(owner, '?view=all');
    expect(waiting?.assignee).toBeNull();

    // Ana opens the inbox: new chats go to her, Beto is away.
    const server = t.app.getHttpServer() as unknown as Server;
    if (!server.listening)
      await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    await fetch(
      `http://127.0.0.1:${port}/api/v1/workspaces/${owner.workspaceId}/conversations/events`,
      {
        headers: { Authorization: `Bearer ${ana.token}` },
        signal: controller.signal,
      },
    );
    try {
      await incoming(line, '59170000202', 'Buenas');
      await incoming(line, '59170000203', 'Consulta');
      const assigned = (await conversations(owner, '?view=all'))
        .filter((chat) => chat.id !== waiting?.id)
        .map((chat) => chat.assignee?.name);
      expect(assigned).toEqual(['Ana Agente', 'Ana Agente']);

      // «Asignar según el agente registrado»: Beto gets his contact even away.
      await api(owner)
        .put('/chat-settings', {
          ...settings,
          assignment: { mode: 'CONTACT_AGENT', includeAdmins: false },
        })
        .expect(200);
      await api(owner)
        .patch(`/contacts/${waiting?.contactId}`, {
          agentMembershipId: '0190e7a0-0000-7000-8000-000000000000',
        })
        .expect(404);
      const contact = await api(owner)
        .patch(`/contacts/${waiting?.contactId}`, {
          agentMembershipId: beto.membershipId,
        })
        .expect(200);
      expect(contact.body).toMatchObject({
        agentMembershipId: beto.membershipId,
      });
      await api(owner).post(`/conversations/${waiting?.id}/close`).expect(200);
      await incoming(line, '59170000201', 'Volví');
      const reopened = (await conversations(owner, '?view=all')).find(
        (chat) => chat.id === waiting?.id,
      );
      expect(reopened?.assignee?.name).toBe('Beto Agente');
    } finally {
      controller.abort();
    }

    // Transfers: off, agents cannot pass on their chats; on, only their own.
    const [anas] = await conversations(ana);
    await api(ana)
      .post(`/conversations/${anas?.id}/assign`, {
        membershipId: beto.membershipId,
      })
      .expect(403);
    await api(owner)
      .put('/chat-settings', { ...settings, transfers: true })
      .expect(200);
    const options = (await api(ana).get('/conversations/options').expect(200))
      .body as { transfers: boolean; members: unknown[] };
    expect(options.transfers).toBe(true);
    expect(options.members.length).toBeGreaterThan(0);
    await api(ana)
      .post(`/conversations/${anas?.id}/assign`, { membershipId: null })
      .expect(403);
    await api(ana)
      .post(`/conversations/${anas?.id}/assign`, {
        membershipId: beto.membershipId,
      })
      .expect(200);

    // Signature: ALWAYS signs with the agent's name, NEVER ignores the choice.
    const unsigned = await api(beto)
      .post(`/conversations/${anas?.id}/messages`, { text: 'Hola', sign: true })
      .expect(201);
    expect((unsigned.body as { text: string }).text).toBe('Hola');
    await api(owner)
      .put('/chat-settings', { ...settings, signature: 'ALWAYS' })
      .expect(200);
    const signedReply = await api(beto)
      .post(`/conversations/${anas?.id}/messages`, { text: 'Te ayudo' })
      .expect(201);
    expect((signedReply.body as { text: string }).text).toBe(
      '*Beto Agente*:\nTe ayudo',
    );

    // Closing message (ASK): only when the agent says so.
    await api(beto).post(`/conversations/${anas?.id}/close`).expect(200);
    let history = (
      await api(owner).get(`/conversations/${anas?.id}/messages`).expect(200)
    ).body as { items: { text: string | null }[] };
    expect(history.items.map((item) => item.text)).not.toContain(
      '*Beto Agente*:\n¡Gracias por escribirnos!',
    );
    await api(beto).post(`/conversations/${anas?.id}/reopen`).expect(200);
    await api(beto)
      .post(`/conversations/${anas?.id}/close`, { sendMessage: true })
      .expect(200);
    history = (
      await api(owner).get(`/conversations/${anas?.id}/messages`).expect(200)
    ).body as { items: { text: string | null }[] };
    expect(history.items.map((item) => item.text)).toContain(
      '*Beto Agente*:\n¡Gracias por escribirnos!',
    );
  });

  it('quick replies have a title and files, and send everything at once', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    const upload = await http()
      .post(`/api/v1/workspaces/${owner.workspaceId}/quick-replies/attachments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('%PDF-1.4 catálogo'), {
        filename: 'catálogo.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const file = upload.body as { fileId: string; filename: string };
    expect(file.filename).toBe('catálogo.pdf');
    await http()
      .post(`/api/v1/workspaces/${owner.workspaceId}/quick-replies/attachments`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('MZ'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(415);

    const created = await api(owner)
      .post('/quick-replies', {
        title: 'Lavadoras Monstruosas 🎃',
        text: '¡Llegaron los Ahorros Monstruosos!',
        attachmentIds: [file.fileId],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      title: 'Lavadoras Monstruosas 🎃',
      shortcut: 'lavadoras-monstruosas',
      attachments: [
        {
          fileId: file.fileId,
          filename: 'catálogo.pdf',
          mimeType: 'application/pdf',
        },
      ],
    });
    await api(owner)
      .post('/quick-replies', { title: 'lavadoras monstruosas', text: 'x' })
      .expect(409);
    await api(owner)
      .post('/quick-replies', {
        title: 'Otra',
        text: 'x',
        attachmentIds: ['6716f0c2a1b2c3d4e5f60718'],
      })
      .expect(422);

    await incoming(line, '59170000301', 'Hola');
    const [chat] = await conversations(owner, '?view=all');
    const sent = await api(owner)
      .post(
        `/conversations/${chat?.id}/quick-replies/${(created.body as { id: string }).id}`,
      )
      .expect(201);
    expect(sent.body).toEqual([
      expect.objectContaining({
        type: 'text',
        text: '¡Llegaron los Ahorros Monstruosos!',
      }),
      expect.objectContaining({ type: 'document' }),
    ]);
  });

  it('counts unread messages by status and «Aceptar» takes a chat on hold', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana Agente');
    const beto = await agentOf(owner, 'Beto Agente');
    const line = await lineWithAgents(owner, [ana, beto], false);
    await incoming(line, '59170000093', 'Hola');
    await incoming(line, '59170000093', '¿Están?');
    await incoming(line, '59170000094', 'Buenas');
    // Newest first: the chat with two messages is the second one.
    const [second, first] = await conversations(owner, '?view=all');
    await api(owner).post(`/conversations/${first?.id}/hold`).expect(200);

    // Messages, not chats: 2 waiting on hold and 1 open.
    let counts = (await api(ana).get('/conversations/counts').expect(200))
      .body as Record<string, unknown>;
    expect(counts).toMatchObject({
      unreadByStatus: { OPEN: 1, ON_HOLD: 2, CLOSED: 0 },
      mineUnreadByStatus: { OPEN: 0, ON_HOLD: 0, CLOSED: 0 },
    });

    const accepted = await api(ana)
      .post(`/conversations/${first?.id}/accept`)
      .expect(200);
    expect(accepted.body).toMatchObject({
      status: 'OPEN',
      assignee: { name: 'Ana Agente' },
    });
    counts = (await api(ana).get('/conversations/counts').expect(200))
      .body as Record<string, unknown>;
    expect(counts).toMatchObject({
      mineUnreadByStatus: { OPEN: 2, ON_HOLD: 0, CLOSED: 0 },
    });

    // Ana's chat, on hold again: Beto cannot take it, the owner can.
    await api(ana).post(`/conversations/${first?.id}/hold`).expect(200);
    await api(owner).post(`/conversations/${second?.id}/hold`).expect(200);
    const taken = await api(beto)
      .post(`/conversations/${first?.id}/accept`)
      .expect(404);
    expect(taken.body).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    await api(owner).post(`/conversations/${first?.id}/accept`).expect(200);
    await api(beto).post(`/conversations/${second?.id}/accept`).expect(200);
  });

  it('sends contact cards and reads the ones customers share', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000092', 'Pásame el contacto del técnico');
    const [chat] = await conversations(owner, '?view=all');

    const sent = await api(owner)
      .post(`/conversations/${chat?.id}/contacts`, {
        contacts: [{ name: 'Técnico Juan', phone: '+591 71234567' }],
      })
      .expect(201);
    expect(sent.body).toMatchObject({
      type: 'contacts',
      status: 'sent',
      text: 'Técnico Juan',
      contacts: [
        {
          name: 'Técnico Juan',
          phones: [
            { phone: '+59171234567', waId: '59171234567', type: 'CELL' },
          ],
        },
      ],
    });
    const invalid = await api(owner)
      .post(`/conversations/${chat?.id}/contacts`, {
        contacts: [{ name: 'X', phone: '12345' }],
      })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'INVALID_PHONE' });

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
                messages: [
                  {
                    id: `wamid.vcard.${++waIds}`,
                    from: '59170000092',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'contacts',
                    contacts: [
                      {
                        name: { formatted_name: 'María Proveedora' },
                        phones: [
                          {
                            phone: '+591 70000999',
                            wa_id: '59170000999',
                            type: 'CELL',
                          },
                        ],
                        org: { company: 'Proveedora SRL' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await http()
      .post(`/api/v1/webhooks/whatsapp/${line.id}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .send(body)
      .expect(200);
    const [latest] = (
      (await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200))
        .body as { items: unknown[] }
    ).items;
    expect(latest).toMatchObject({
      direction: 'IN',
      type: 'contacts',
      text: 'María Proveedora',
      contacts: [
        {
          name: 'María Proveedora',
          organization: 'Proveedora SRL',
          phones: [{ phone: '+591 70000999', waId: '59170000999' }],
        },
      ],
    });
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

  it('records every movement of a conversation in its history', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const beto = await agentOf(owner, 'Beto');
    // Beto attends the line too; turns start with Ana.
    const line = await lineWithAgents(owner, [ana, beto], true);
    await incoming(line, '59170000050', 'Hola');
    const [chat] = await conversations(owner, '?view=all');
    const id = chat?.id ?? '';

    await api(owner)
      .post(`/conversations/${id}/assign`, { membershipId: beto.membershipId })
      .expect(200);
    await api(owner)
      .post(`/conversations/${id}/assign`, { membershipId: null })
      .expect(200);
    await api(ana).post(`/conversations/${id}/take`).expect(200);
    await api(ana).post(`/conversations/${id}/close`).expect(200);
    await api(ana).post(`/conversations/${id}/reopen`).expect(200);

    const history = (
      (await api(owner).get(`/conversations/${id}/messages`).expect(200))
        .body as {
        items: {
          direction: string;
          event: {
            kind: string;
            by: { name: string } | null;
            from: { name: string } | null;
            to: { name: string } | null;
          } | null;
        }[];
      }
    ).items
      .filter((m) => m.direction === 'EVENT')
      .reverse()
      .map((m) => [
        m.event?.kind,
        m.event?.by?.name ?? null,
        m.event?.from?.name ?? null,
        m.event?.to?.name ?? null,
      ]);
    expect(history).toEqual([
      ['auto_assigned', null, null, 'Ana'],
      ['transferred', 'Olga Owner', 'Ana', 'Beto'],
      ['unassigned', 'Olga Owner', 'Beto', null],
      ['taken', 'Ana', null, 'Ana'],
      ['closed', 'Ana', null, null],
      ['reopened', 'Ana', null, null],
    ]);

    // Movements never replace the preview of the last message.
    const [after] = await conversations(owner, '?view=all');
    expect(after?.lastMessage).toMatchObject({ text: 'Hola', direction: 'IN' });
  });

  it('limits agents to the lines they attend, set from Agentes', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const ventas = await lineWithAgents(owner, [ana], false);
    const soporte = await lineWithAgents(owner, [], false);
    await incoming(soporte, '59170000060', 'Soporte');
    const [chat] = await conversations(owner, '?view=all');
    const id = chat?.id ?? '';

    // Ana does not attend Soporte: she cannot receive its chats.
    const refused = await api(owner)
      .post(`/conversations/${id}/assign`, { membershipId: ana.membershipId })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'AGENT_NOT_ON_LINE' });

    // Only who manages channels assigns lines, and only lines of the workspace.
    await api(ana)
      .put(`/members/${ana.membershipId}/lines`, { lineIds: [ventas.id] })
      .expect(403);
    const other = await signUp();
    const foreign = await lineWithAgents(other, [], false);
    const missing = await api(owner)
      .put(`/members/${ana.membershipId}/lines`, { lineIds: [foreign.id] })
      .expect(404);
    expect(missing.body).toMatchObject({ code: 'LINE_NOT_FOUND' });

    const both = await api(owner)
      .put(`/members/${ana.membershipId}/lines`, {
        lineIds: [ventas.id, soporte.id],
      })
      .expect(200);
    expect(
      (both.body as { lines: { id: string }[] }).lines.map((l) => l.id).sort(),
    ).toEqual([ventas.id, soporte.id].sort());
    await api(owner)
      .post(`/conversations/${id}/assign`, { membershipId: ana.membershipId })
      .expect(200);
    expect(await conversations(ana, '?view=mine')).toHaveLength(1);

    const transfer = (
      await api(owner).get('/conversations/options').expect(200)
    ).body as {
      viewAll: boolean;
      members: { membershipId: string; lineIds: string[]; viewAll: boolean }[];
    };
    expect(transfer.viewAll).toBe(true);
    expect(
      transfer.members.find((m) => m.membershipId === ana.membershipId),
    ).toMatchObject({ viewAll: false });

    // Without Soporte she stops seeing its chats, even the ones assigned to her.
    await api(owner)
      .put(`/members/${ana.membershipId}/lines`, { lineIds: [ventas.id] })
      .expect(200);
    expect(await conversations(ana, '?view=all')).toEqual([]);
    await api(ana).get(`/conversations/${id}`).expect(404);
    const counts = (await api(ana).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({ mine: 0, all: 0, unread: 0 });
    const mine = (await api(ana).get('/conversations/options').expect(200))
      .body as {
      viewAll: boolean;
      myLineIds: string[];
      lines: { id: string; displayPhone: string | null; status: string }[];
    };
    expect(mine).toMatchObject({ viewAll: false, myLineIds: [ventas.id] });
    expect(mine.lines.map((l) => l.id)).toEqual([ventas.id]);
    expect(mine.lines[0]).toHaveProperty('status');

    // Without lines, an agent has an empty inbox.
    await api(owner)
      .put(`/members/${ana.membershipId}/lines`, { lineIds: [] })
      .expect(200);
    await incoming(ventas, '59170000061', 'Ventas');
    expect(await conversations(ana, '?view=all')).toEqual([]);
    expect(await conversations(owner, '?view=all')).toHaveLength(2);
  });

  it('tags the chat: the tags of its contact', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const line = await lineWithAgents(owner, [ana], false);
    await incoming(line, '59170000070', 'Quiero comprar');
    const [chat] = await conversations(ana, '?view=all');
    const id = chat?.id ?? '';
    const tag = (
      await api(owner)
        .post('/tags', { name: 'Interesado', color: '#2e7d32' })
        .expect(201)
    ).body as { id: string };

    const tagged = await api(ana)
      .put(`/conversations/${id}/tags`, { tagIds: [tag.id] })
      .expect(200);
    expect(tagged.body).toMatchObject({ id, contactTagIds: [tag.id] });
    const [listed] = await conversations(ana, '?view=all');
    expect(listed?.contactTagIds).toEqual([tag.id]);
    const contact = (
      await api(owner).get(`/contacts/${chat?.contactId}`).expect(200)
    ).body as { tags: { id: string }[] };
    expect(contact.tags.map((t) => t.id)).toEqual([tag.id]);

    const unknown = await api(ana)
      .put(`/conversations/${id}/tags`, {
        tagIds: ['64b000000000000000000000'],
      })
      .expect(404);
    expect(unknown.body).toMatchObject({ code: 'TAG_NOT_FOUND' });
    // A chat the member cannot see is reported as missing.
    const outsider = await agentOf(owner, 'Otro');
    await api(outsider)
      .put(`/conversations/${id}/tags`, { tagIds: [] })
      .expect(404);
  });

  it('filters by open, closed or all and marks conversations as unread', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000060', 'uno');
    await incoming(line, '59170000061', 'dos');
    const [first] = await conversations(owner, '?view=all');
    await api(owner).post(`/conversations/${first?.id}/close`).expect(200);

    expect(await conversations(owner, '?view=all')).toHaveLength(1);
    expect(await conversations(owner, '?view=all&status=CLOSED')).toHaveLength(
      1,
    );
    expect(await conversations(owner, '?view=all&status=ALL')).toHaveLength(2);
    const counts = (await api(owner).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({ all: 1, closed: 1 });

    const [open] = await conversations(owner, '?view=all');
    await api(owner).post(`/conversations/${open?.id}/read`).expect(200);
    const unread = await api(owner)
      .post(`/conversations/${open?.id}/unread`)
      .expect(200);
    expect(unread.body).toMatchObject({ unreadCount: 1 });
  });

  it('stores the files customers send and streams them only to who may see the chat', async () => {
    const owner = await signUp();
    const other = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incomingImage(line, '59170000070');
    const [chat] = await conversations(owner, '?view=all');
    const [message] = (
      (await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200))
        .body as {
        items: { id: string; type: string; media: { id: string } | null }[];
      }
    ).items;
    expect(message).toMatchObject({
      type: 'image',
      media: { id: message?.id },
    });

    const file = await api(owner)
      .get(`/conversations/${chat?.id}/messages/${message?.id}/media`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    expect((file.body as Buffer).subarray(1, 4).toString()).toBe('PNG');

    await http()
      .get(
        `/api/v1/workspaces/${owner.workspaceId}/conversations/${chat?.id}/messages/${message?.id}/media`,
      )
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await api(other)
      .get(`/conversations/${chat?.id}/messages/${message?.id}/media`)
      .expect(404);
  });

  it('sends files through WhatsApp with the rules of a reply', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000071', 'Mándame el catálogo');
    const [chat] = await conversations(owner, '?view=all');
    const upload = (name: string, type: string, content: Buffer) =>
      http()
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/conversations/${chat?.id}/media`,
        )
        .set('Authorization', `Bearer ${owner.token}`)
        .field('caption', 'Catálogo 2026')
        .attach('file', content, { filename: name, contentType: type });

    const pdf = Buffer.from('%PDF-1.4 catálogo');
    const sent = await upload(
      '../../catálogo.pdf',
      'application/pdf',
      pdf,
    ).expect(201);
    expect(sent.body).toMatchObject({
      direction: 'OUT',
      type: 'document',
      text: 'Catálogo 2026',
      status: 'sent',
      media: { filename: 'catálogo.pdf', size: pdf.length },
    });
    const download = await api(owner)
      .get(
        `/conversations/${chat?.id}/messages/${(sent.body as { id: string }).id}/media`,
      )
      .expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');

    const html = await upload(
      'x.html',
      'text/html',
      Buffer.from('<b>x</b>'),
    ).expect(415);
    expect(html.body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    const big = await upload(
      'big.png',
      'image/png',
      Buffer.alloc(6 * 1024 * 1024),
    ).expect(413);
    expect(big.body).toMatchObject({ code: 'MEDIA_TOO_LARGE' });

    const [after] = await conversations(owner, '?view=all');
    expect(after?.lastMessage).toMatchObject({
      text: 'Catálogo 2026',
      direction: 'OUT',
    });
  });

  it('sends again a text or a file that WhatsApp refused, without duplicating it', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000072', 'Hola');
    const [chat] = await conversations(owner, '?view=all');
    const text = (
      await api(owner)
        .post(`/conversations/${chat?.id}/messages`, { text: 'Precio: 100' })
        .expect(201)
    ).body as MessageBody;
    const file = (
      await http()
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/conversations/${chat?.id}/media`,
        )
        .set('Authorization', `Bearer ${owner.token}`)
        .attach('file', Buffer.from('%PDF-1.4 lista'), {
          filename: 'lista.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
    ).body as MessageBody;

    // Sent messages cannot be retried.
    const sent = await api(owner)
      .post(`/conversations/${chat?.id}/messages/${text.id}/retry`)
      .expect(409);
    expect(sent.body).toMatchObject({ code: 'MESSAGE_NOT_RETRYABLE' });

    // What Meta refused (the simulated gateway never fails).
    await mongo.collection('messages').updateMany(
      { text: { $in: ['Precio: 100', null] }, direction: 'OUT' },
      {
        $set: {
          status: 'failed',
          error: '(#131005) Access denied',
          waMessageId: null,
        },
      },
    );

    for (const message of [text, file]) {
      const retried = (
        await api(owner)
          .post(`/conversations/${chat?.id}/messages/${message.id}/retry`)
          .expect(200)
      ).body as MessageBody;
      expect(retried).toMatchObject({
        id: message.id,
        status: 'sent',
        error: null,
      });
    }
    const stored = await mongo
      .collection('messages')
      .find({ conversationId: new Types.ObjectId(chat?.id), direction: 'OUT' })
      .toArray();
    expect(stored).toHaveLength(2);
    expect(stored.every((message) => message.waMessageId)).toBe(true);

    // Someone else's chat: not found.
    const other = await signUp();
    await api(other)
      .post(`/conversations/${chat?.id}/messages/${text.id}/retry`)
      .expect(404);
  });

  it('blocks a contact: closes the chat, ignores new messages and can unblock', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000080', 'Spam');
    const [chat] = await conversations(owner, '?view=all');

    const blocked = await api(owner)
      .post(`/contacts/${chat?.contactId}/block`)
      .expect(200);
    expect(blocked.body).toEqual({
      blocked: true,
      whatsapp: [
        { lineId: line.id, lineName: 'Ventas', ok: true, error: null },
      ],
    });
    const contact = await api(owner)
      .get(`/contacts/${chat?.contactId}`)
      .expect(200);
    expect(contact.body).toMatchObject({
      blocked: true,
      blockedBy: { name: 'Olga Owner' },
    });
    const [closed] = await conversations(owner, '?view=all&status=ALL');
    expect(closed).toMatchObject({ id: chat?.id, status: 'CLOSED' });
    const history = (
      (await api(owner).get(`/conversations/${chat?.id}/messages`).expect(200))
        .body as { items: { event: { kind: string } | null }[] }
    ).items;
    expect(history[0]?.event?.kind).toBe('contact_blocked');

    // Their messages no longer open chats.
    await incoming(line, '59170000080', 'Hola de nuevo');
    expect(await conversations(owner, '?view=all&status=ALL')).toHaveLength(1);

    await api(owner).post(`/contacts/${chat?.contactId}/unblock`).expect(200);
    await incoming(line, '59170000080', 'Ya puedo escribir');
    const open = await conversations(owner, '?view=all');
    expect(open).toHaveLength(1);
    expect(open[0]?.lastMessage).toMatchObject({ text: 'Ya puedo escribir' });
  });

  it('manages quick replies per workspace; agents only use them', async () => {
    const owner = await signUp();
    const other = await signUp();
    const ana = await agentOf(owner, 'Ana');

    const created = await api(owner)
      .post('/quick-replies', {
        shortcut: '/Saludo',
        text: '¡Hola! ¿En qué te ayudamos?',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      shortcut: 'saludo',
      createdBy: { name: 'Olga Owner' },
    });
    const id = (created.body as { id: string }).id;
    await api(owner)
      .post('/quick-replies', { shortcut: 'saludo', text: 'Otro' })
      .expect(409);
    await api(owner)
      .post('/quick-replies', { shortcut: 'con espacios', text: 'x' })
      .expect(422);

    const forAgent = await api(ana).get('/quick-replies').expect(200);
    expect(forAgent.body).toEqual([
      expect.objectContaining({ id, shortcut: 'saludo' }),
    ]);
    await api(ana)
      .post('/quick-replies', { shortcut: 'mio', text: 'x' })
      .expect(403);
    expect((await api(other).get('/quick-replies').expect(200)).body).toEqual(
      [],
    );
    await api(other).patch(`/quick-replies/${id}`, { text: 'x' }).expect(404);

    await api(owner)
      .patch(`/quick-replies/${id}`, { text: 'Hola, gracias por escribir' })
      .expect(200);
    await http()
      .delete(`/api/v1/workspaces/${owner.workspaceId}/quick-replies/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
    expect((await api(owner).get('/quick-replies').expect(200)).body).toEqual(
      [],
    );
  });

  it('exposes minimal options without granting administrative read permissions', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana');
    const line = await lineWithAgents(owner, [ana], true);
    const options = (await api(ana).get('/conversations/options').expect(200))
      .body as {
      lines: { id: string; name: string }[];
      members: unknown[];
    };
    expect(options.lines.map((item) => item.id)).toEqual([line.id]);
    expect(options.members).toEqual([]);
    await api(ana).get('/channels/auto-assignment').expect(403);
    const settings = await api(owner)
      .get('/channels/auto-assignment')
      .expect(200);
    const serialized = JSON.stringify(settings.body);
    expect(serialized).not.toMatch(/accessToken|appSecret|webhook|verifyToken/);
    const other = await signUp();
    const foreign = await http()
      .get(`/api/v1/workspaces/${owner.workspaceId}/conversations/options`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    expect(foreign.status).toBe(404);
  });

  it('ends an open event stream before sending data after session revocation', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    const server = t.app.getHttpServer() as unknown as Server;
    if (!server.listening)
      await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/workspaces/${owner.workspaceId}/conversations/events`,
        {
          headers: { Authorization: `Bearer ${owner.token}` },
          signal: controller.signal,
        },
      );
      const reader = response.body!.getReader();
      const member = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: owner.membershipId },
      });
      await prisma.userSession.updateMany({
        where: { userId: member.userId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await incoming(line, '59170000051', 'must not be delivered');
      let body = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        body += new TextDecoder().decode(chunk.value);
      }
      expect(body).not.toContain('must not be delivered');
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  it('reserves monthly contact slots atomically without dropping inbound messages', async () => {
    const owner = await signUp();
    const line = await lineWithAgents(owner, [], false);
    await incoming(line, '59170000061', 'first');
    await incoming(line, '59170000062', 'second');
    const chats = await conversations(owner, '?view=all');
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { workspaceId: owner.workspaceId },
    });
    const feature = await prisma.feature.findUniqueOrThrow({
      where: { key: 'limits.active_contacts' },
    });
    const featureKey = {
      planId_featureId: { planId: subscription.planId, featureId: feature.id },
    };
    const original = await prisma.planFeature.findUniqueOrThrow({
      where: featureKey,
    });
    await prisma.planFeature.update({
      where: featureKey,
      data: { limitValue: 1 },
    });
    try {
      const replies = await Promise.all(
        chats.map((chat) =>
          api(owner).post(`/conversations/${chat.id}/messages`, {
            text: 'reply',
          }),
        ),
      );
      expect(replies.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const accepted =
        chats[replies.findIndex((response) => response.status === 201)];
      await api(owner)
        .post(`/conversations/${accepted?.id}/messages`, {
          text: 'second reply to same contact',
        })
        .expect(201);
      expect(await conversations(owner, '?view=all')).toHaveLength(2);
      expect(
        await prisma.workspaceContactUsage.count({
          where: { workspaceId: owner.workspaceId },
        }),
      ).toBe(1);
      await prisma.subscription.update({
        where: { workspaceId: owner.workspaceId },
        data: { status: 'EXPIRED' },
      });
      const denied = await api(owner)
        .post(`/conversations/${accepted?.id}/messages`, { text: 'not sent' })
        .expect(402);
      expect(denied.body).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
    } finally {
      await prisma.planFeature.update({
        where: featureKey,
        data: { limitValue: original.limitValue },
      });
    }
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
    expect(received).toContain('event: message.created');
    expect(received).toContain('en vivo');

    // A reply shows at once as pending, then its result follows.
    const [chat] = await conversations(owner, '?view=all');
    const clientId = '5c2a7e1b-3d4f-4a6b-8c9d-0e1f2a3b4c5d';
    await api(owner)
      .post(`/conversations/${chat?.id}/messages`, {
        text: 'al instante',
        clientId,
      })
      .expect(201);
    while (reader && !received.includes('event: message.updated')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    controller.abort();
    const pending = received.indexOf('"status":"pending"');
    expect(pending).toBeGreaterThan(-1);
    expect(received.indexOf(`"clientId":"${clientId}"`)).toBeGreaterThan(-1);
    expect(received.indexOf('event: message.updated')).toBeGreaterThan(pending);
  });
});
