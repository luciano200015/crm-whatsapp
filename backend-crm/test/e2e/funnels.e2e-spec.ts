import type { Connection } from 'mongoose';
import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { ChatbotRunner } from '../../src/modules/chatbots/application/chatbot-runner.service';
import { signBody } from '../../src/modules/channels/domain/webhook-signature';
import { textMessagePayload } from '../../src/modules/channels/domain/whatsapp-payload';
import { FunnelAutomation } from '../../src/modules/funnels/application/funnel-automation.service';
import { FunnelsService } from '../../src/modules/funnels/application/funnels.service';
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

interface Stage {
  id: string;
  name: string;
}

interface Funnel {
  id: string;
  name: string;
  isPrimary: boolean;
  leads: number;
  stages: Stage[];
}

interface Lead {
  id: string;
  stageId: string;
  contactId: string;
  amountCents: number;
  version: number;
  archivedAt: string | null;
  contact: { name: string | null; phone: string } | null;
  conversation: {
    id: string;
    status: string;
    visible: boolean;
    assignee: { name: string } | null;
    lastMessage: { text: string | null } | null;
  } | null;
}

interface Board {
  count: number;
  totalCents: number;
  columns: {
    stage: Stage;
    count: number;
    totalCents: number;
    leads: Lead[];
  }[];
}

describe('Funnels (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let mongo: Connection;
  let runner: ChatbotRunner;
  let automation: FunnelAutomation;
  let counter = 0;
  let phoneIds = 600000000000;
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
    automation = t.app.get(FunnelAutomation);
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

  async function signUp(planCode = 'business'): Promise<Session> {
    const email = `funnels${++counter}@example.com`;
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Olga Owner', planCode })
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
    const email = `funnelagent${++counter}@example.com`;
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
      delete: (path: string) => http().delete(url(path)).set(auth),
    };
  };

  async function newLine(owner: Session, agents: Session[] = []) {
    const phoneNumberId = String(++phoneIds);
    const line = (
      await api(owner)
        .post('/channels/lines', {
          name: `Línea ${phoneNumberId}`,
          phoneNumberId,
          accessToken: 'EAAG-token-for-funnel-tests-1234',
          appSecret: APP_SECRET,
        })
        .expect(201)
    ).body as { id: string };
    await api(owner)
      .put(`/channels/lines/${line.id}/agents`, {
        membershipIds: agents.map((agent) => agent.membershipId),
      })
      .expect(200);
    return { id: line.id, phoneNumberId };
  }

  /** A customer writes; waits until the funnels followed. */
  async function incoming(
    line: Line,
    from: string,
    name: string,
    text = 'Hola',
  ) {
    const body = JSON.stringify(
      textMessagePayload({
        phoneNumberId: line.phoneNumberId,
        from,
        text,
        profileName: name,
        waMessageId: `wamid.funnel.${++waIds}`,
      }),
    );
    await http()
      .post(`/api/v1/webhooks/whatsapp/${line.id}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(body, APP_SECRET))
      .send(body)
      .expect(200);
    await runner.idle();
    await automation.idle();
  }

  async function newFunnel(
    owner: Session,
    line: Line,
    changes: object = {},
  ): Promise<Funnel> {
    return (
      await api(owner)
        .post('/funnels', {
          lineId: line.id,
          name: `Ventas ${++counter}`,
          defaultStages: true,
          ...changes,
        })
        .expect(201)
    ).body as Funnel;
  }

  async function board(session: Session, funnel: Funnel, query = '') {
    return (
      await api(session).get(`/funnels/${funnel.id}/board${query}`).expect(200)
    ).body as Board;
  }

  const column = (view: Board, name: string) =>
    view.columns.find((item) => item.stage.name === name);

  const stageId = (funnel: Funnel, name: string) =>
    funnel.stages.find((stage) => stage.name === name)?.id ?? '';

  it('creates funnels with the default stages, one primary per line', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    const first = await newFunnel(owner, line, { isPrimary: true });
    expect(first.stages.map((stage) => stage.name)).toEqual([
      'Nuevo',
      'En atención',
      'Esperando cliente',
      'Cerrado',
    ]);
    const empty = await newFunnel(owner, line, { defaultStages: false });
    expect(empty.stages).toEqual([]);
    await api(owner)
      .post(`/funnels/${empty.id}/stages`, { name: 'Contacto inicial' })
      .expect(201);

    const second = await newFunnel(owner, line, { isPrimary: true });
    const list = (await api(owner).get('/funnels').expect(200))
      .body as Funnel[];
    expect(list.filter((funnel) => funnel.isPrimary).map((f) => f.id)).toEqual([
      second.id,
    ]);

    const taken = await api(owner)
      .post('/funnels', { lineId: line.id, name: second.name.toUpperCase() })
      .expect(409);
    expect(taken.body).toMatchObject({ code: 'FUNNEL_NAME_TAKEN' });

    // Reorder: the columns change, the leads stay.
    const ids = second.stages.map((stage) => stage.id).reverse();
    const reordered = (
      await api(owner)
        .put(`/funnels/${second.id}/stages/order`, { stageIds: ids })
        .expect(200)
    ).body as Funnel;
    expect(reordered.stages.map((stage) => stage.id)).toEqual(ids);
    await api(owner)
      .put(`/funnels/${second.id}/stages/order`, { stageIds: ids.slice(1) })
      .expect(400);
  });

  it('is not in the Equipo plan', async () => {
    const owner = await signUp('team');
    const line = await newLine(owner);
    const response = await api(owner)
      .post('/funnels', { lineId: line.id, name: 'Ventas' })
      .expect(403);
    expect(response.body).toMatchObject({
      code: 'FEATURE_NOT_IN_PLAN',
      details: { feature: 'features.sales_funnels' },
    });
  });

  it('puts new chats in the first stage of the primary funnel, and moves them with values', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    const other = await newLine(owner);
    const funnel = await newFunnel(owner, line, { isPrimary: true });

    await incoming(line, '59171000001', 'Lucía');
    await incoming(line, '59171000002', 'Mario');
    // A line without a primary funnel: the chat is there, no lead.
    await incoming(other, '59171000003', 'Nadia');
    const chats = (
      await api(owner)
        .get(`/conversations?view=all&status=ALL&lineId=${other.id}`)
        .expect(200)
    ).body as { items: unknown[] };
    expect(chats.items).toHaveLength(1);

    let view = await board(owner, funnel);
    expect(column(view, 'Nuevo')?.count).toBe(2);
    expect(view.count).toBe(2);
    const lucia = column(view, 'Nuevo')?.leads.find(
      (lead) => lead.contact?.name === 'Lucía',
    ) as Lead;
    // Nobody took it yet: it waits in «En espera».
    expect(lucia.conversation).toMatchObject({
      status: 'ON_HOLD',
      visible: true,
    });
    expect(lucia.conversation?.lastMessage?.text).toBe('Hola');

    // Writing again does not add it twice.
    await incoming(line, '59171000001', 'Lucía', 'Sigo aquí');
    expect(column(await board(owner, funnel), 'Nuevo')?.count).toBe(2);

    const valued = (
      await api(owner)
        .patch(`/funnels/${funnel.id}/leads/${lucia.id}/amount`, {
          amountCents: 50000,
          version: lucia.version,
        })
        .expect(200)
    ).body as Lead;
    const moved = (
      await api(owner)
        .patch(`/funnels/${funnel.id}/leads/${lucia.id}/stage`, {
          stageId: stageId(funnel, 'En atención'),
          version: valued.version,
        })
        .expect(200)
    ).body as Lead;
    expect(moved.stageId).toBe(stageId(funnel, 'En atención'));

    // An older version: someone else changed it first.
    const stale = await api(owner)
      .patch(`/funnels/${funnel.id}/leads/${lucia.id}/stage`, {
        stageId: stageId(funnel, 'Cerrado'),
        version: valued.version,
      })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'LEAD_CHANGED' });

    view = await board(owner, funnel);
    expect(column(view, 'Nuevo')).toMatchObject({ count: 1, totalCents: 0 });
    expect(column(view, 'En atención')).toMatchObject({
      count: 1,
      totalCents: 50000,
    });
    expect(view.totalCents).toBe(50000);

    // The chat shows the move in its history.
    const messages = (
      await api(owner)
        .get(`/conversations/${lucia.conversation?.id}/messages?limit=100`)
        .expect(200)
    ).body as {
      items: {
        event: {
          kind: string;
          funnel?: { to: string; from: string | null };
        } | null;
      }[];
    };
    const moves = messages.items
      .map((message) => message.event)
      .filter((event) => event?.kind === 'funnel_stage');
    expect(moves.map((event) => event?.funnel)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: null, to: 'Nuevo' }),
        expect.objectContaining({ from: 'Nuevo', to: 'En atención' }),
      ]),
    );

    // From the chat: the stage selector of the contact.
    const fromChat = (
      await api(owner)
        .put(`/funnels/contacts/${lucia.contactId}`, {
          funnelId: funnel.id,
          stageId: stageId(funnel, 'Cerrado'),
        })
        .expect(200)
    ).body as { funnelId: string; lead: { stageId: string } | null }[];
    expect(
      fromChat.find((item) => item.funnelId === funnel.id)?.lead,
    ).toMatchObject({
      stageId: stageId(funnel, 'Cerrado'),
    });
  });

  it('adds contacts once, and deletes stages only with a destination for their leads', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    const funnel = await newFunnel(owner, line);
    const contact = (
      await api(owner)
        .post('/contacts', { phone: '+59172000001', name: 'Pedro' })
        .expect(201)
    ).body as { id: string };
    const lead = (
      await api(owner)
        .post(`/funnels/${funnel.id}/leads`, {
          contactId: contact.id,
          stageId: stageId(funnel, 'Esperando cliente'),
        })
        .expect(201)
    ).body as Lead;
    // No chat on this line yet.
    expect(lead.conversation).toBeNull();
    const again = await api(owner)
      .post(`/funnels/${funnel.id}/leads`, {
        contactId: contact.id,
        stageId: stageId(funnel, 'Nuevo'),
      })
      .expect(409);
    expect(again.body).toMatchObject({
      code: 'LEAD_EXISTS',
      details: { leadId: lead.id },
    });

    const refused = await api(owner)
      .delete(
        `/funnels/${funnel.id}/stages/${stageId(funnel, 'Esperando cliente')}`,
      )
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'STAGE_HAS_LEADS',
      details: { leads: 1 },
    });
    const after = (
      await api(owner)
        .delete(
          `/funnels/${funnel.id}/stages/${stageId(funnel, 'Esperando cliente')}?moveTo=${stageId(funnel, 'Cerrado')}`,
        )
        .expect(200)
    ).body as Funnel;
    expect(after.stages.map((stage) => stage.name)).toEqual([
      'Nuevo',
      'En atención',
      'Cerrado',
    ]);
    expect(column(await board(owner, funnel), 'Cerrado')?.count).toBe(1);
    // An empty stage goes without asking.
    await api(owner)
      .delete(`/funnels/${funnel.id}/stages/${stageId(funnel, 'Nuevo')}`)
      .expect(200);

    // Out of the funnel: the contact stays.
    await api(owner)
      .delete(`/funnels/${funnel.id}/leads/${lead.id}`)
      .expect(204);
    await api(owner).get(`/contacts/${contact.id}`).expect(200);

    // A funnel with leads is deleted only when confirmed.
    await api(owner)
      .post(`/funnels/${funnel.id}/leads`, {
        contactId: contact.id,
        stageId: stageId(funnel, 'Cerrado'),
      })
      .expect(201);
    await api(owner).delete(`/funnels/${funnel.id}`).expect(409);
    await api(owner).delete(`/funnels/${funnel.id}?confirm=true`).expect(204);
    await api(owner).get(`/funnels/${funnel.id}`).expect(404);
  });

  it('syncs chats by status only for contacts not in the funnel, and follows the automation rules', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    await incoming(line, '59173000001', 'Abierta');
    await incoming(line, '59173000002', 'Cerrada');
    const chats = (
      await api(owner)
        .get(`/conversations?view=all&status=ALL&lineId=${line.id}`)
        .expect(200)
    ).body as { items: { id: string; contact: { name: string } }[] };
    const closed = chats.items.find((chat) => chat.contact.name === 'Cerrada');
    const taken = chats.items.find((chat) => chat.contact.name === 'Abierta');
    await api(owner).post(`/conversations/${closed?.id}/close`).expect(200);
    // Taking it moves it from «En espera» to Abierto.
    await api(owner).post(`/conversations/${taken?.id}/take`).expect(200);

    const funnel = await newFunnel(owner, line);
    const rules = [
      { status: 'OPEN', stageId: stageId(funnel, 'En atención') },
      { status: 'CLOSED', stageId: stageId(funnel, 'Cerrado') },
    ];
    const first = await api(owner)
      .post(`/funnels/${funnel.id}/sync`, { rules })
      .expect(200);
    expect(first.body).toEqual({ created: 2, skipped: 0, failed: 0 });
    let view = await board(owner, funnel);
    expect(column(view, 'En atención')?.count).toBe(1);
    expect(column(view, 'Cerrado')?.count).toBe(1);

    // A manual move is kept: a second sync adds nothing.
    const open = column(view, 'En atención')?.leads[0] as Lead;
    await api(owner)
      .patch(`/funnels/${funnel.id}/leads/${open.id}/stage`, {
        stageId: stageId(funnel, 'Esperando cliente'),
      })
      .expect(200);
    const second = await api(owner)
      .post(`/funnels/${funnel.id}/sync`, { rules })
      .expect(200);
    expect(second.body).toEqual({ created: 0, skipped: 2, failed: 0 });
    expect(
      (await api(owner).get(`/funnels/${funnel.id}`).expect(200)).body,
    ).toMatchObject({
      syncRules: rules,
    });

    // Automation: closing the chat moves the lead.
    await api(owner)
      .put(`/funnel-automation?lineId=${line.id}`, {
        rules: [
          {
            status: 'CLOSED',
            funnelId: funnel.id,
            stageId: stageId(funnel, 'Cerrado'),
          },
          {
            status: 'ON_HOLD',
            funnelId: funnel.id,
            stageId: stageId(funnel, 'Nuevo'),
          },
        ],
      })
      .expect(200);
    await api(owner)
      .put(`/funnel-automation?lineId=${line.id}`, {
        rules: [
          {
            status: 'CLOSED',
            funnelId: funnel.id,
            stageId: stageId(funnel, 'Cerrado'),
          },
          {
            status: 'CLOSED',
            funnelId: funnel.id,
            stageId: stageId(funnel, 'Nuevo'),
          },
        ],
      })
      .expect(400);
    const openChat = chats.items.find(
      (chat) => chat.contact.name === 'Abierta',
    );
    await api(owner).post(`/conversations/${openChat?.id}/close`).expect(200);
    await automation.idle();
    view = await board(owner, funnel);
    expect(column(view, 'Cerrado')?.count).toBe(2);
    expect(column(view, 'Esperando cliente')?.count).toBe(0);

    // The customer writes to the closed chat: it comes back waiting in
    // «En espera» and the ON_HOLD rule applies, once.
    await incoming(line, '59173000001', 'Abierta', 'Volví');
    view = await board(owner, funnel);
    expect(column(view, 'Nuevo')?.count).toBe(1);
    const automated = await prisma.auditLog.count({
      where: {
        workspaceId: owner.workspaceId,
        action: 'funnels.lead.moved',
        metadata: { path: ['source'], equals: 'automation' },
      },
    });
    expect(automated).toBe(2);
  });

  it('shows agents only their lines and the stages of their privileges, also through the API and the CSV', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana Agente');
    const beto = await agentOf(owner, 'Beto Agente');
    const line = await newLine(owner, [ana]);
    const funnel = await newFunnel(owner, line, { isPrimary: true });
    await incoming(line, '59174000001', '=HYPERLINK("http://x")');
    await incoming(line, '59174000002', 'Rosa, la del "centro"');
    let view = await board(owner, funnel);
    const leads = column(view, 'Nuevo')?.leads ?? [];
    // One stays in Nuevo, Rosa goes to Cerrado.
    const one = leads.find((lead) => lead.contact?.name?.startsWith('='));
    const two = leads.find((lead) => lead.contact?.name?.startsWith('Rosa'));
    await api(owner)
      .patch(`/funnels/${funnel.id}/leads/${two?.id}/stage`, {
        stageId: stageId(funnel, 'Cerrado'),
      })
      .expect(200);

    // Beto does not attend the line: the funnel does not exist for him.
    expect((await api(beto).get('/funnels').expect(200)).body).toEqual([]);
    await api(beto).get(`/funnels/${funnel.id}/board`).expect(404);

    await api(owner)
      .put(`/funnels/${funnel.id}/permissions`, {
        members: [
          {
            membershipId: ana.membershipId,
            stageIds: [stageId(funnel, 'Nuevo')],
          },
        ],
      })
      .expect(200);
    view = await board(ana, funnel);
    expect(view.columns.map((item) => item.stage.name)).toEqual(['Nuevo']);
    await api(ana)
      .get(`/funnels/${funnel.id}/stages/${stageId(funnel, 'Cerrado')}/leads`)
      .expect(403);
    const forbidden = await api(ana)
      .patch(`/funnels/${funnel.id}/leads/${one?.id}/stage`, {
        stageId: stageId(funnel, 'Cerrado'),
      })
      .expect(403);
    expect(forbidden.body).toMatchObject({ code: 'STAGE_FORBIDDEN' });
    await api(ana)
      .patch(`/funnels/${funnel.id}/leads/${two?.id}/amount`, {
        amountCents: 1,
      })
      .expect(404);
    // Managing funnels is for owners and admins.
    await api(ana)
      .put(`/funnels/${funnel.id}/permissions`, { members: [] })
      .expect(403);

    const csv = await api(ana)
      .get(`/funnels/${funnel.id}/export.csv`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Nombre,Teléfono,Embudo,Etapa,Valor,Agente,Etiquetas,Estado del chat,Archivado,Creado,Última actividad',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"'=HYPERLINK\(""http:\/\/x""\)",/);

    const all = await api(owner)
      .get(`/funnels/${funnel.id}/export.csv`)
      .expect(200);
    expect(all.text).toContain('"Rosa, la del ""centro"""');

    // Another workspace never sees it.
    const stranger = await signUp();
    await api({ ...stranger, workspaceId: owner.workspaceId })
      .get(`/funnels/${funnel.id}`)
      .expect(404);
    await api(stranger).get(`/funnels/${funnel.id}`).expect(404);
  });

  it('filters by agent, tags, chat status and value together', async () => {
    const owner = await signUp();
    const ana = await agentOf(owner, 'Ana Agente');
    const line = await newLine(owner, [ana]);
    const funnel = await newFunnel(owner, line, { isPrimary: true });
    const vip = (
      await api(owner)
        .post('/tags', { name: 'VIP', color: '#22c55e' })
        .expect(201)
    ).body as { id: string };
    await incoming(line, '59175000001', 'Uno');
    await incoming(line, '59175000002', 'Dos');
    await incoming(line, '59175000003', 'Tres');
    const leads = column(await board(owner, funnel), 'Nuevo')?.leads ?? [];
    const byName = (name: string) =>
      leads.find((lead) => lead.contact?.name === name) as Lead;
    await api(owner)
      .put(`/contacts/${byName('Uno').contactId}/tags`, { tagIds: [vip.id] })
      .expect(200);
    await api(owner)
      .put(`/contacts/${byName('Dos').contactId}/tags`, { tagIds: [vip.id] })
      .expect(200);
    await api(owner)
      .post(`/conversations/${byName('Uno').conversation?.id}/assign`, {
        membershipId: ana.membershipId,
      })
      .expect(200);
    for (const [name, cents] of [
      ['Uno', 10000],
      ['Dos', 90000],
      ['Tres', 50000],
    ] as const) {
      await api(owner)
        .patch(`/funnels/${funnel.id}/leads/${byName(name).id}/amount`, {
          amountCents: cents,
        })
        .expect(200);
    }

    const names = async (query: string) =>
      (column(await board(owner, funnel, query), 'Nuevo')?.leads ?? [])
        .map((lead) => lead.contact?.name)
        .sort();
    expect(await names(`?tagIds=${vip.id}`)).toEqual(['Dos', 'Uno']);
    expect(await names(`?tagIds=${vip.id}&unassigned=true`)).toEqual(['Dos']);
    expect(
      await names(`?agentIds=${ana.membershipId}&unassigned=true`),
    ).toEqual(['Dos', 'Tres', 'Uno']);
    expect(await names('?minCents=20000&maxCents=60000')).toEqual(['Tres']);
    expect(await names('?search=tre')).toEqual(['Tres']);
    expect(await names('?statuses=CLOSED')).toEqual([]);
    const sorted = column(
      await board(owner, funnel, '?sort=value_desc'),
      'Nuevo',
    );
    expect(sorted?.leads.map((lead) => lead.contact?.name)).toEqual([
      'Dos',
      'Tres',
      'Uno',
    ]);
    expect(sorted?.totalCents).toBe(150000);
  });

  it('archives by hand or for inactivity, and a new message restores the latter', async () => {
    const owner = await signUp();
    const line = await newLine(owner);
    const funnel = await newFunnel(owner, line, {
      isPrimary: true,
      archiveAfterDays: 7,
    });
    await incoming(line, '59176000001', 'Quieta');
    await incoming(line, '59176000002', 'Manual');
    const leads = column(await board(owner, funnel), 'Nuevo')?.leads ?? [];
    const manual = leads.find(
      (lead) => lead.contact?.name === 'Manual',
    ) as Lead;
    await api(owner)
      .patch(`/funnels/${funnel.id}/leads/${manual.id}/archive`, {
        archived: true,
      })
      .expect(200);

    await mongo
      .collection('funnel_leads')
      .updateMany(
        { workspaceId: owner.workspaceId },
        { $set: { activityAt: new Date(Date.now() - 8 * 86_400_000) } },
      );
    await t.app.get(FunnelsService).archiveIdle();

    expect(column(await board(owner, funnel), 'Nuevo')?.count).toBe(0);
    const archived = await board(owner, funnel, '?archived=true');
    expect(column(archived, 'Nuevo')?.count).toBe(2);

    await incoming(line, '59176000001', 'Quieta', 'Hola de nuevo');
    await incoming(line, '59176000002', 'Manual', 'Hola de nuevo');
    const back = column(await board(owner, funnel), 'Nuevo');
    // Only the one archived for inactivity comes back.
    expect(back?.leads.map((lead) => lead.contact?.name)).toEqual(['Quieta']);
  });
});
