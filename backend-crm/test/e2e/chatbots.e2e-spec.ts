import { Types, type Connection } from 'mongoose';
import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { ChatbotRunner } from '../../src/modules/chatbots/application/chatbot-runner.service';
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

interface Line {
  id: string;
  phoneNumberId: string;
}

interface ConversationBody {
  id: string;
  status: string;
  unreadCount: number;
  assignee: { membershipId: string; name: string } | null;
  contactTagIds: string[];
  bot: {
    state: string;
    name: string | null;
    pausedBy: { name: string } | null;
    pausedUntil: string | null;
  };
}

interface MessageBody {
  direction: string;
  type: string;
  text: string | null;
  sentBy: { name: string; kind?: string } | null;
  interactive: {
    kind: string;
    buttons?: { id: string; title: string }[];
  } | null;
  reply: { id: string; title: string } | null;
  event: { kind: string; to: { name: string } | null } | null;
}

const at = { x: 0, y: 0 };

/** Greeting, then Ventas → tag + transfer in turns; Soporte → a message. */
const menuGraph = (tagId: string) => ({
  nodes: [
    { id: 'start', type: 'start', position: at, data: {} },
    {
      id: 'hello',
      type: 'message',
      position: at,
      data: { text: 'Hola {{nombre}}' },
    },
    {
      id: 'menu',
      type: 'buttons',
      position: at,
      data: {
        body: '¿Qué necesitas?',
        buttons: [
          { id: 'sales', title: 'Ventas' },
          { id: 'help', title: 'Soporte' },
        ],
        invalidText: 'Toca uno de los botones',
      },
    },
    { id: 'tag', type: 'tags', position: at, data: { add: [tagId] } },
    { id: 'agent', type: 'transfer', position: at, data: { to: 'auto' } },
    {
      id: 'help',
      type: 'message',
      position: at,
      data: { text: 'Escribe tu consulta' },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'hello' },
    { id: 'e2', source: 'hello', sourceHandle: 'next', target: 'menu' },
    { id: 'e3', source: 'menu', sourceHandle: 'sales', target: 'tag' },
    { id: 'e4', source: 'tag', sourceHandle: 'next', target: 'agent' },
    { id: 'e5', source: 'menu', sourceHandle: 'help', target: 'help' },
  ],
});

describe('Chatbots (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let mongo: Connection;
  let runner: ChatbotRunner;
  let counter = 0;
  let phoneIds = 500000000000;
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
    runner = t.app.get(ChatbotRunner);
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
    const email = `bots${++counter}@example.com`;
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
    const email = `botagent${++counter}@example.com`;
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

  async function newLine(owner: Session, agents: Session[] = []) {
    const phoneNumberId = String(++phoneIds);
    const line = (
      await api(owner)
        .post('/channels/lines', {
          name: 'Ventas',
          phoneNumberId,
          accessToken: 'EAAG-token-for-chatbot-tests-1234',
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
      .patch(`/channels/lines/${line.id}`, { autoAssign: true })
      .expect(200);
    return { id: line.id, phoneNumberId };
  }

  /** A customer writes (or taps a button); waits until the bot answered. */
  async function incoming(
    line: Line,
    text: string,
    reply?: { id: string; title: string },
  ) {
    const body = JSON.stringify(
      textMessagePayload({
        phoneNumberId: line.phoneNumberId,
        from: '59170000001',
        text,
        profileName: 'Lucía',
        waMessageId: `wamid.bot.${++waIds}`,
        reply,
      }),
    );
    await http()
      .post(`/api/v1/webhooks/whatsapp/${line.id}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .send(body)
      .expect(200);
    await runner.idle();
  }

  async function chatOf(owner: Session, line: Line) {
    const page = await api(owner)
      .get(`/conversations?view=all&lineId=${line.id}`)
      .expect(200);
    return (page.body as { items: ConversationBody[] })
      .items[0] as ConversationBody;
  }

  async function messagesOf(owner: Session, conversationId: string) {
    const page = await api(owner)
      .get(`/conversations/${conversationId}/messages?limit=100`)
      .expect(200);
    return ((page.body as { items: MessageBody[] }).items ?? []).reverse();
  }

  async function botOn(
    owner: Session,
    line: Line,
    graph: object,
    settings: object = {},
  ) {
    const bot = (
      await api(owner).post('/chatbots', { name: 'Bot de ventas' }).expect(201)
    ).body as { id: string };
    await api(owner)
      .patch(`/chatbots/${bot.id}`, { graph, enabled: true, ...settings })
      .expect(200);
    await api(owner)
      .put(`/chatbots/${bot.id}/lines`, { lineIds: [line.id] })
      .expect(200);
    return bot;
  }

  it('answers on its line: menu, the button tapped, a tag and the transfer', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana Agente');
    const line = await newLine(owner, [ana]);
    const tag = (
      await api(owner)
        .post('/tags', { name: 'Interesado', color: '#22c55e' })
        .expect(201)
    ).body as { id: string };
    await botOn(owner, line, menuGraph(tag.id));

    await incoming(line, 'hola');
    let chat = await chatOf(owner, line);
    // The bot answers first: auto-assignment waits for its transfer.
    expect(chat.assignee).toBeNull();
    expect(chat.bot).toMatchObject({ state: 'active', name: 'Bot de ventas' });
    // Its replies are not a person reading the chat.
    expect(chat.unreadCount).toBe(1);
    let messages = await messagesOf(owner, chat.id);
    expect(messages.map((m) => [m.direction, m.type, m.text])).toEqual([
      ['IN', 'text', 'hola'],
      ['OUT', 'text', 'Hola Lucía'],
      ['OUT', 'interactive', '¿Qué necesitas?'],
    ]);
    expect(messages[1]?.sentBy).toEqual({
      name: 'Bot de ventas',
      kind: 'bot',
      userId: expect.stringMatching(/^bot:/) as string,
    });
    expect(messages[2]?.interactive?.buttons).toEqual([
      { id: 'menu:sales', title: 'Ventas' },
      { id: 'menu:help', title: 'Soporte' },
    ]);

    await incoming(line, 'Ventas', { id: 'menu:sales', title: 'Ventas' });
    chat = await chatOf(owner, line);
    expect(chat.assignee).toMatchObject({ name: 'Ana Agente' });
    expect(chat.contactTagIds).toEqual([tag.id]);
    // Off for a day after the handover (the node's default).
    expect(chat.bot).toMatchObject({ state: 'paused', pausedBy: null });
    expect(
      new Date(chat.bot.pausedUntil ?? 0).getTime() - Date.now(),
    ).toBeGreaterThan(23 * 3_600_000);
    expect(chat.unreadCount).toBe(2);
    messages = await messagesOf(owner, chat.id);
    expect(messages.at(-4)?.reply).toEqual({
      id: 'menu:sales',
      title: 'Ventas',
    });
    // The history says what the bot did, signed by the bot.
    const bot = { name: 'Bot de ventas', kind: 'bot' };
    expect(messages.at(-3)?.event).toMatchObject({
      kind: 'bot_tagged',
      by: bot,
      tags: { added: ['Interesado'], removed: [] },
    });
    expect(messages.at(-2)?.event).toMatchObject({
      kind: 'bot_transferred',
      by: bot,
      to: { name: 'Ana Agente' },
    });
    // And the customer is told who will answer.
    expect(messages.at(-1)).toMatchObject({
      direction: 'OUT',
      text: 'Te comunicamos con Ana Agente. En breve te atenderá.',
      sentBy: bot,
    });

    // With the chat in an agent's hands, the bot stays quiet.
    await incoming(line, '¿Cuánto cuesta?');
    const after = await messagesOf(owner, chat.id);
    expect(after.filter((m) => m.direction === 'OUT')).toHaveLength(3);
  });

  it('lets an agent turn the bot off in a chat and on again', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    await botOn(owner, line, menuGraph('6716f0c2a1b2c3d4e5f60718'));
    await incoming(line, 'hola');
    const chat = await chatOf(owner, line);

    const paused = await api(owner)
      .post(`/conversations/${chat.id}/bot/pause`, { duration: 'permanent' })
      .expect(200);
    expect((paused.body as ConversationBody).bot).toMatchObject({
      state: 'paused',
      pausedBy: { name: 'Olga Owner' },
      pausedUntil: null,
    });
    await incoming(line, 'Soporte');
    let outgoing = (await messagesOf(owner, chat.id)).filter(
      (m) => m.direction === 'OUT',
    );
    expect(outgoing).toHaveLength(2);

    // Off for this contact: closing and writing again does not wake it up.
    await api(owner).post(`/conversations/${chat.id}/close`).expect(200);
    await incoming(line, 'hola otra vez');
    expect((await chatOf(owner, line)).bot.state).toBe('paused');
    outgoing = (await messagesOf(owner, chat.id)).filter(
      (m) => m.direction === 'OUT',
    );
    expect(outgoing).toHaveLength(2);

    await api(owner).post(`/conversations/${chat.id}/bot/resume`).expect(200);
    await incoming(line, 'hola de nuevo');
    const messages = await messagesOf(owner, chat.id);
    outgoing = messages.filter((m) => m.direction === 'OUT');
    expect(outgoing.map((m) => m.text).slice(-2)).toEqual([
      'Hola Lucía',
      '¿Qué necesitas?',
    ]);
    expect(
      messages.filter((m) => m.direction === 'EVENT').map((m) => m.event?.kind),
    ).toEqual(['bot_paused', 'closed', 'reopened', 'bot_resumed']);
  });

  it('turns on only a complete flow, with one chatbot per line', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    const first = (
      await api(owner).post('/chatbots', { name: 'Uno' }).expect(201)
    ).body as { id: string; issues: unknown[]; enabled: boolean };
    expect(first).toMatchObject({ enabled: false, issues: [] });

    const invalid = await api(owner)
      .patch(`/chatbots/${first.id}`, {
        graph: { nodes: [{ id: 'x', type: 'teleport' }], edges: [] },
      })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'FLOW_INVALID' });

    const incomplete = {
      nodes: [
        { id: 'start', type: 'start', position: at, data: {} },
        { id: 'menu', type: 'buttons', position: at, data: { body: '' } },
      ],
      edges: [
        { id: 'e', source: 'start', sourceHandle: 'next', target: 'menu' },
      ],
    };
    await api(owner)
      .patch(`/chatbots/${first.id}`, { graph: incomplete })
      .expect(200);
    const refused = await api(owner)
      .patch(`/chatbots/${first.id}`, { enabled: true })
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'FLOW_INCOMPLETE',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'menu',
            message: 'Agrega al menos un botón',
          }),
        ]) as unknown,
      },
    });

    await api(owner)
      .put(`/chatbots/${first.id}/lines`, { lineIds: [line.id] })
      .expect(200);
    const second = (
      await api(owner).post('/chatbots', { name: 'Dos' }).expect(201)
    ).body as { id: string };
    const taken = await api(owner)
      .put(`/chatbots/${second.id}/lines`, { lineIds: [line.id] })
      .expect(409);
    expect(taken.body).toMatchObject({
      code: 'LINE_HAS_CHATBOT',
      details: { lineId: line.id, chatbot: 'Uno' },
    });
    await api(owner)
      .put(`/chatbots/${second.id}/lines`, {
        lineIds: [line.id],
        takeOver: true,
      })
      .expect(200);
    const list = (await api(owner).get('/chatbots').expect(200)).body as {
      name: string;
      lines: { id: string }[];
    }[];
    expect(
      Object.fromEntries(list.map((bot) => [bot.name, bot.lines.length])),
    ).toEqual({ Uno: 0, Dos: 1 });
  });

  it('tries a flow without sending anything', async () => {
    const owner = await signUp();
    const first = await api(owner)
      .post('/chatbots/simulate', {
        graph: menuGraph('6716f0c2a1b2c3d4e5f60718'),
        text: 'hola',
        contactName: 'Prueba',
      })
      .expect(200);
    const run = first.body as {
      actions: { kind: string; message?: { text?: string } }[];
      session: { nodeId: string } | null;
    };
    expect(run.actions[0]).toEqual({
      kind: 'send',
      message: { kind: 'text', text: 'Hola Prueba' },
    });
    expect(run.session).toMatchObject({ nodeId: 'menu' });

    const next = await api(owner)
      .post('/chatbots/simulate', {
        graph: menuGraph('6716f0c2a1b2c3d4e5f60718'),
        session: run.session,
        text: 'Ventas',
        replyId: 'menu:sales',
      })
      .expect(200);
    expect((next.body as { actions: { kind: string }[] }).actions).toEqual([
      { kind: 'tags', add: ['6716f0c2a1b2c3d4e5f60718'], remove: [] },
      {
        kind: 'transfer',
        to: 'auto',
        membershipId: null,
        message: 'Te comunicamos con {{agente}}. En breve te atenderá.',
        pause: '24h',
      },
    ]);
  });

  it('turns off for 24 hours, and the bot answers again once they pass', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    await botOn(owner, line, menuGraph('6716f0c2a1b2c3d4e5f60718'));
    await incoming(line, 'hola');
    const chat = await chatOf(owner, line);

    const paused = await api(owner)
      .post(`/conversations/${chat.id}/bot/pause`)
      .expect(200);
    const until = (paused.body as ConversationBody).bot.pausedUntil;
    expect(new Date(until ?? 0).getTime() - Date.now()).toBeGreaterThan(
      23.9 * 3_600_000,
    );
    await api(owner)
      .post(`/conversations/${chat.id}/bot/pause`, { duration: 'forever' })
      .expect(400);
    await incoming(line, 'Soporte');
    expect(
      (await messagesOf(owner, chat.id)).filter((m) => m.direction === 'OUT'),
    ).toHaveLength(2);

    // A day later (the pause ended), it starts its flow again.
    await mongo
      .collection('conversations')
      .updateOne(
        { _id: new Types.ObjectId(chat.id) },
        { $set: { 'bot.pausedUntil': new Date(Date.now() - 1000) } },
      );
    expect((await chatOf(owner, line)).bot).toMatchObject({
      state: 'active',
      pausedUntil: null,
    });
    await incoming(line, 'hola');
    const outgoing = (await messagesOf(owner, chat.id)).filter(
      (m) => m.direction === 'OUT',
    );
    expect(outgoing.map((m) => m.text).slice(-2)).toEqual([
      'Hola Lucía',
      '¿Qué necesitas?',
    ]);
  });

  it('keeps unread what nobody read when the bot closes the chat', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    await botOn(owner, line, {
      nodes: [
        { id: 'start', type: 'start', position: at, data: {} },
        {
          id: 'bye',
          type: 'message',
          position: at,
          data: { text: 'Gracias, ¡hasta luego!' },
        },
        {
          id: 'close',
          type: 'status',
          position: at,
          data: { status: 'CLOSED' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', sourceHandle: 'next', target: 'bye' },
        { id: 'e2', source: 'bye', sourceHandle: 'next', target: 'close' },
      ],
    });
    await incoming(line, 'hola');
    const chat = (
      (
        await api(owner)
          .get(`/conversations?view=all&status=CLOSED&lineId=${line.id}`)
          .expect(200)
      ).body as { items: ConversationBody[] }
    ).items[0];
    expect(chat).toMatchObject({ status: 'CLOSED', unreadCount: 1 });
    const counts = (await api(owner).get('/conversations/counts').expect(200))
      .body as Record<string, number>;
    expect(counts).toMatchObject({ closed: 1, closedUnread: 1 });

    // Once someone opens it, it is read.
    await api(owner).post(`/conversations/${chat?.id}/read`).expect(200);
    expect(
      (
        (await api(owner).get('/conversations/counts').expect(200)).body as {
          closedUnread: number;
        }
      ).closedUnread,
    ).toBe(0);
  });

  it('answers the fallback after the end, starts again with "menu" and nudges the idle', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    await botOn(owner, line, menuGraph('6716f0c2a1b2c3d4e5f60718'), {
      fallbackText: 'Mensaje inválido. Escribe menu para volver.',
      restartKeywords: ['Menu', ' inicio '],
      inactivityMinutes: 5,
      inactivityText: '¿Sigues ahí?',
    });
    await incoming(line, 'hola');
    const chat = await chatOf(owner, line);
    const outTexts = async () =>
      (await messagesOf(owner, chat.id))
        .filter((m) => m.direction === 'OUT')
        .map((m) => m.text);

    // Nobody answers the menu: after the wait, one inactivity message.
    await mongo
      .collection('conversations')
      .updateOne(
        { _id: new Types.ObjectId(chat.id) },
        { $set: { 'bot.session.nudgeAt': new Date(Date.now() - 1000) } },
      );
    await runner.sendDueNudges();
    await runner.idle();
    await runner.sendDueNudges();
    await runner.idle();
    expect(await outTexts()).toEqual([
      'Hola Lucía',
      '¿Qué necesitas?',
      '¿Sigues ahí?',
    ]);
    // With a button that shows the menu again.
    const nudge = (await messagesOf(owner, chat.id)).at(-1);
    expect(nudge?.interactive?.buttons).toEqual([
      { id: 'menu:@menu', title: 'Continuar' },
    ]);
    await incoming(line, 'Continuar', { id: 'menu:@menu', title: 'Continuar' });
    expect((await outTexts()).at(-1)).toBe('¿Qué necesitas?');

    await incoming(line, 'Soporte', { id: 'menu:help', title: 'Soporte' });
    await incoming(line, 'gracias');
    expect((await outTexts()).slice(-2)).toEqual([
      'Escribe tu consulta',
      'Mensaje inválido. Escribe menu para volver.',
    ]);
    // The general message carries a way back to the beginning.
    expect(
      (await messagesOf(owner, chat.id)).at(-1)?.interactive?.buttons,
    ).toEqual([{ id: 'start:@start', title: 'Volver al inicio' }]);
    await incoming(line, 'MENU');
    expect((await outTexts()).slice(-2)).toEqual([
      'Hola Lucía',
      '¿Qué necesitas?',
    ]);
  });

  it('saves the general settings and the variables of the bot', async () => {
    const owner = await signUp();
    const bot = (
      await api(owner).post('/chatbots', { name: 'Call Center' }).expect(201)
    ).body as { id: string; restartAfterMinutes: number };
    expect(bot.restartAfterMinutes).toBe(30);
    const saved = await api(owner)
      .patch(`/chatbots/${bot.id}`, {
        description: 'Atención al cliente',
        fallbackText: 'Mensaje inválido.',
        restartKeywords: ['Menu', 'menu', ' inicio '],
        restartAfterMinutes: 2,
        inactivityMinutes: 29,
        variables: [
          { name: 'cuotas', type: 'number', defaultValue: '0' },
          { name: 'cliente', type: 'boolean', description: '¿Ya compró?' },
        ],
      })
      .expect(200);
    expect(saved.body).toMatchObject({
      description: 'Atención al cliente',
      fallbackText: 'Mensaje inválido.',
      restartKeywords: ['menu', 'inicio'],
      restartAfterMinutes: 2,
      inactivityMinutes: 29,
      variables: [
        { name: 'cuotas', type: 'number', defaultValue: '0', description: '' },
        {
          name: 'cliente',
          type: 'boolean',
          defaultValue: 'false',
          description: '¿Ya compró?',
        },
      ],
      contactVariables: [
        'nombre',
        'apellido',
        'nombre_completo',
        'email',
        'telefono',
      ],
    });
    await api(owner)
      .patch(`/chatbots/${bot.id}`, { inactivityMinutes: 30 })
      .expect(400);
    await api(owner)
      .patch(`/chatbots/${bot.id}`, { restartAfterMinutes: 1 })
      .expect(400);
    const invalid = await api(owner)
      .patch(`/chatbots/${bot.id}`, {
        variables: [{ name: 'email', type: 'text' }],
      })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'VARIABLES_INVALID' });
  });

  it('is only for chatbots.manage', async () => {
    const owner = await signUp();
    const agent = await agentOf(owner, 'Beto Agente');
    await api(agent).get('/chatbots').expect(403);
    await api(agent).post('/chatbots', { name: 'Mío' }).expect(403);
  });
});
