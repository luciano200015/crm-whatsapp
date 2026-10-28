import type { Connection } from 'mongoose';
import request from 'supertest';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  clearMongo,
  createTestMongo,
  createTestPrisma,
  truncateAll,
} from '../utils/test-db';
import { createTestApp, type TestApp } from '../utils/test-app';

const PASSWORD = 'correct horse battery staple';

interface Owner {
  token: string;
  workspaceId: string;
}

interface ContactBody {
  id: string;
  phone: string;
  name: string | null;
  tags: { id: string; name: string }[];
}

interface TagBody {
  id: string;
  name: string;
  contactCount: number;
}

describe('Contacts and tags (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let mongo: Connection;
  let counter = 0;

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

  async function signUp(): Promise<Owner> {
    const email = `contacts${++counter}@example.com`;
    await http()
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        displayName: 'Owner',
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
    return { token, workspaceId: workspace?.id ?? '' };
  }

  /** An AGENT of the workspace who already replaced the temporary password. */
  async function agentOf(owner: Owner): Promise<Owner> {
    const email = `agent${++counter}@example.com`;
    const roles = await api(owner).get('/roles').expect(200);
    const agentRole = (roles.body as { id: string; key: string }[]).find(
      (r) => r.key === 'AGENT',
    );
    await api(owner)
      .post('/members', { email, displayName: 'Agent', roleId: agentRole?.id })
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
    return { token, workspaceId: owner.workspaceId };
  }

  const api = (owner: Owner) => {
    const url = (path: string) =>
      `/api/v1/workspaces/${owner.workspaceId}${path}`;
    const auth = { Authorization: `Bearer ${owner.token}` };
    return {
      get: (path: string) => http().get(url(path)).set(auth),
      post: (path: string, body: object) =>
        http().post(url(path)).set(auth).send(body),
      patch: (path: string, body: object) =>
        http().patch(url(path)).set(auth).send(body),
      put: (path: string, body: object) =>
        http().put(url(path)).set(auth).send(body),
      delete: (path: string) => http().delete(url(path)).set(auth),
    };
  };

  it('creates, lists, searches, updates and deletes contacts', async () => {
    const owner = await signUp();

    const created = await api(owner)
      .post('/contacts', { phone: '+591 7123-4567', name: ' Lucía Fernández ' })
      .expect(201);
    const contact = created.body as ContactBody;
    expect(contact).toMatchObject({
      phone: '+59171234567',
      name: 'Lucía Fernández',
      tags: [],
    });

    await api(owner)
      .post('/contacts', { phone: '+14155552671', name: 'Bob' })
      .expect(201);
    const duplicate = await api(owner)
      .post('/contacts', { phone: '59171234567' })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: 'CONTACT_PHONE_TAKEN' });
    const invalid = await api(owner)
      .post('/contacts', { phone: '123' })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'INVALID_PHONE' });

    const all = await api(owner).get('/contacts').expect(200);
    expect(
      (all.body as { items: ContactBody[] }).items.map((c) => c.name),
    ).toEqual(['Bob', 'Lucía Fernández']);
    const byName = await api(owner).get('/contacts?search=luc').expect(200);
    expect((byName.body as { items: ContactBody[] }).items).toHaveLength(1);
    const byPhone = await api(owner).get('/contacts?search=4155').expect(200);
    expect((byPhone.body as { items: ContactBody[] }).items[0]?.name).toBe(
      'Bob',
    );

    const page = await api(owner).get('/contacts?limit=1').expect(200);
    const { nextCursor } = page.body as { nextCursor: string };
    const second = await api(owner)
      .get(`/contacts?limit=1&cursor=${nextCursor}`)
      .expect(200);
    expect(second.body).toMatchObject({ nextCursor: null });
    expect((second.body as { items: ContactBody[] }).items[0]?.id).toBe(
      contact.id,
    );

    await api(owner)
      .patch(`/contacts/${contact.id}`, { email: 'Lucia@Example.com' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ email: 'lucia@example.com' }),
      );
    await api(owner).delete(`/contacts/${contact.id}`).expect(204);
    await api(owner).get(`/contacts/${contact.id}`).expect(404);
  });

  it('manages tags and keeps contacts consistent', async () => {
    const owner = await signUp();
    const vip = (
      await api(owner)
        .post('/tags', { name: 'VIP', color: '#EAB308' })
        .expect(201)
    ).body as TagBody;
    const dup = await api(owner)
      .post('/tags', { name: ' vip ', color: '#000000' })
      .expect(409);
    expect(dup.body).toMatchObject({ code: 'TAG_NAME_TAKEN' });
    const lead = (
      await api(owner)
        .post('/tags', { name: 'Prospecto', color: '#3b82f6' })
        .expect(201)
    ).body as TagBody;

    const contact = (
      await api(owner)
        .post('/contacts', { phone: '+59170000001', tagIds: [vip.id, lead.id] })
        .expect(201)
    ).body as ContactBody;
    expect(contact.tags.map((tag) => tag.name).sort()).toEqual([
      'Prospecto',
      'VIP',
    ]);

    const filtered = await api(owner)
      .get(`/contacts?tagId=${vip.id}`)
      .expect(200);
    expect((filtered.body as { items: unknown[] }).items).toHaveLength(1);
    const tags = (await api(owner).get('/tags').expect(200)).body as TagBody[];
    expect(tags.find((tag) => tag.id === vip.id)?.contactCount).toBe(1);

    await api(owner).delete(`/tags/${vip.id}`).expect(204);
    const after = (await api(owner).get(`/contacts/${contact.id}`).expect(200))
      .body as ContactBody;
    expect(after.tags.map((tag) => tag.name)).toEqual(['Prospecto']);

    await api(owner)
      .put(`/contacts/${contact.id}/tags`, { tagIds: [] })
      .expect(200);
  });

  it('isolates workspaces', async () => {
    const a = await signUp();
    const b = await signUp();
    const tag = (
      await api(a)
        .post('/tags', { name: 'Privada', color: '#ef4444' })
        .expect(201)
    ).body as TagBody;
    const contact = (
      await api(a).post('/contacts', { phone: '+59170000002' }).expect(201)
    ).body as ContactBody;

    await api(b).get(`/contacts/${contact.id}`).expect(404);
    await api(b).delete(`/contacts/${contact.id}`).expect(404);
    expect(
      ((await api(b).get('/contacts').expect(200)).body as { items: unknown[] })
        .items,
    ).toEqual([]);
    // The same number can exist in another workspace.
    await api(b).post('/contacts', { phone: '+59170000002' }).expect(201);
    // Tags of another workspace cannot be attached.
    const foreignTag = await api(b)
      .post('/contacts', { phone: '+59170000003', tagIds: [tag.id] })
      .expect(404);
    expect(foreignTag.body).toMatchObject({ code: 'TAG_NOT_FOUND' });
  });

  it('lets agents work with contacts but not manage tags', async () => {
    const owner = await signUp();
    const agent = await agentOf(owner);

    await api(agent).post('/contacts', { phone: '+59170000009' }).expect(201);
    await api(agent).get('/tags').expect(200);
    await api(agent).post('/tags', { name: 'X', color: '#000000' }).expect(403);
  });

  it('keeps custom fields per contact', async () => {
    const owner = await signUp();
    const birthday = (
      await api(owner)
        .post('/contact-fields', { label: 'Fecha de nacimiento', type: 'DATE' })
        .expect(201)
    ).body as { id: string; key: string };
    expect(birthday.key).toBe('fecha_de_nacimiento');
    const city = (
      await api(owner)
        .post('/contact-fields', {
          label: 'Ciudad',
          type: 'SELECT',
          options: ['La Paz', 'Santa Cruz', 'la paz'],
        })
        .expect(201)
    ).body as { id: string; options: string[] };
    expect(city.options).toEqual(['La Paz', 'Santa Cruz']);
    await api(owner)
      .post('/contact-fields', { label: 'ciudad', type: 'TEXT' })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'CONTACT_FIELD_TAKEN' }),
      );
    await api(owner)
      .post('/contact-fields', { label: 'Plan', type: 'SELECT' })
      .expect(400);

    const contact = (
      await api(owner)
        .post('/contacts', {
          phone: '+59170000101',
          fields: { fecha_de_nacimiento: '5/3/1990', ciudad: 'santa cruz' },
        })
        .expect(201)
    ).body as ContactBody & { fields: Record<string, unknown> };
    expect(contact.fields).toEqual({
      fecha_de_nacimiento: '1990-03-05',
      ciudad: 'Santa Cruz',
    });
    await api(owner)
      .patch(`/contacts/${contact.id}`, { fields: { ciudad: 'Oruro' } })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'CONTACT_FIELD_INVALID_VALUE' }),
      );
    await api(owner)
      .patch(`/contacts/${contact.id}`, { fields: { otro: 'x' } })
      .expect(404);
    const cleared = await api(owner)
      .patch(`/contacts/${contact.id}`, { fields: { ciudad: null } })
      .expect(200);
    expect(cleared.body).toMatchObject({
      fields: { fecha_de_nacimiento: '1990-03-05' },
    });

    await api(owner).delete(`/contact-fields/${birthday.id}`).expect(204);
    const after = await api(owner).get(`/contacts/${contact.id}`).expect(200);
    expect(after.body).toMatchObject({ fields: {} });
  });

  it('filters by status and works on selected contacts', async () => {
    const owner = await signUp();
    const vip = (
      await api(owner)
        .post('/tags', { name: 'VIP', color: '#22c55e' })
        .expect(201)
    ).body as TagBody;
    const ids: string[] = [];
    for (const phone of ['+59170000201', '+59170000202', '+59170000203']) {
      const created = await api(owner).post('/contacts', { phone }).expect(201);
      ids.push((created.body as ContactBody).id);
    }
    await api(owner).post(`/contacts/${ids[0]}/block`, {}).expect(200);
    const blocked = await api(owner)
      .get('/contacts?status=BLOCKED')
      .expect(200);
    expect(
      (blocked.body as { items: ContactBody[] }).items.map((c) => c.id),
    ).toEqual([ids[0]]);
    const active = await api(owner).get('/contacts?status=ACTIVE').expect(200);
    expect((active.body as { items: unknown[] }).items).toHaveLength(2);

    await api(owner)
      .post('/contacts/bulk', {
        contactIds: ids,
        action: 'add_tags',
        tagIds: [vip.id],
      })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ affected: 3 }));
    const tagged = await api(owner)
      .get(`/contacts?tagId=${vip.id}`)
      .expect(200);
    expect((tagged.body as { items: unknown[] }).items).toHaveLength(3);
    await api(owner)
      .post('/contacts/bulk', {
        contactIds: [ids[1]],
        action: 'remove_tags',
        tagIds: [vip.id],
      })
      .expect(200);
    await api(owner)
      .post('/contacts/bulk', {
        contactIds: [ids[2], ids[1]],
        action: 'delete',
      })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ affected: 2 }));
    const left = await api(owner).get('/contacts').expect(200);
    expect(
      (left.body as { items: ContactBody[] }).items.map((c) => c.id),
    ).toEqual([ids[0]]);
  });

  it('imports, exports and deletes every contact', async () => {
    const owner = await signUp();
    const agent = await agentOf(owner);
    await api(owner)
      .post('/contact-fields', { label: 'Empresa', type: 'TEXT' })
      .expect(201);
    const old = (
      await api(owner)
        .post('/tags', { name: 'Antigua', color: '#000000' })
        .expect(201)
    ).body as TagBody;
    const existing = (
      await api(owner)
        .post('/contacts', {
          phone: '+59170000301',
          name: 'Ana',
          tagIds: [old.id],
        })
        .expect(201)
    ).body as ContactBody;

    const imported = await api(owner)
      .post('/contacts/import', {
        tagMode: 'MERGE',
        rows: [
          { phone: '59170000301', name: '', tags: ['Feria 2026'] },
          {
            phone: '+59170000302',
            name: 'Beto',
            email: 'BETO@x.com',
            tags: ['feria 2026', 'VIP'],
            fields: { empresa: 'Camsa' },
          },
          { phone: '123', name: 'Malo' },
          { phone: '+59170000303', email: 'no-es-correo' },
        ],
      })
      .expect(200);
    expect(imported.body).toEqual({
      created: 1,
      updated: 1,
      failed: [
        { index: 2, phone: '123', code: 'INVALID_PHONE' },
        { index: 3, phone: '+59170000303', code: 'INVALID_EMAIL' },
      ],
    });
    const ana = (await api(owner).get(`/contacts/${existing.id}`).expect(200))
      .body as ContactBody;
    expect(ana.name).toBe('Ana');
    expect(ana.tags.map((tag) => tag.name).sort()).toEqual([
      'Antigua',
      'Feria 2026',
    ]);
    const tags = (await api(owner).get('/tags').expect(200)).body as TagBody[];
    expect(tags.map((tag) => tag.name).sort()).toEqual([
      'Antigua',
      'Feria 2026',
      'VIP',
    ]);

    await api(owner)
      .post('/contacts/import', {
        tagMode: 'REPLACE',
        rows: [{ phone: '+59170000301', tags: ['VIP'] }],
      })
      .expect(200);
    const replaced = (
      await api(owner).get(`/contacts/${existing.id}`).expect(200)
    ).body as ContactBody;
    expect(replaced.tags.map((tag) => tag.name)).toEqual(['VIP']);

    const csv = await api(owner).get('/contacts/export.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(
      csv.text.startsWith(
        '\uFEFFNombre,Teléfono,Correo,Etiquetas,Estado,Origen,Notas,Último mensaje,Creado,Actualizado,Empresa\r\n',
      ),
    ).toBe(true);
    expect(csv.text).toContain(
      'Beto,+59170000302,beto@x.com,"Feria 2026, VIP",Activo,Importado,,,',
    );
    expect(csv.text).toContain(',Camsa\r\n');
    const filtered = await api(owner)
      .get('/contacts/export.csv?search=beto')
      .expect(200);
    expect(filtered.text.trim().split('\r\n')).toHaveLength(2);

    // Agents work with contacts, but not with the whole base at once.
    await api(agent).get('/contacts/export.csv').expect(403);
    await api(agent)
      .post('/contacts/import', {
        tagMode: 'MERGE',
        rows: [{ phone: '+59170000399' }],
      })
      .expect(403);
    await api(agent)
      .post('/contact-fields', { label: 'X', type: 'TEXT' })
      .expect(403);
    await api(agent)
      .post('/contacts/delete-all', { confirmation: 'ELIMINAR' })
      .expect(403);

    await api(owner)
      .post('/contacts/delete-all', { confirmation: 'eliminar' })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'CONFIRMATION_REQUIRED' }),
      );
    await api(owner)
      .post('/contacts/delete-all', { confirmation: 'ELIMINAR' })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ deleted: 2 }));
    const none = await api(owner).get('/contacts').expect(200);
    expect((none.body as { items: unknown[] }).items).toEqual([]);
  });

  it('lists the lines for «Asignación de asesores»', async () => {
    const owner = await signUp();
    const contact = (
      await api(owner).post('/contacts', { phone: '+59170000401' }).expect(201)
    ).body as ContactBody;
    await api(owner)
      .get(`/contacts/${contact.id}/agents`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
    await api(owner)
      .put(`/contacts/${contact.id}/agents`, {
        agents: [
          {
            lineId: '0190e7a0-0000-7000-8000-000000000000',
            membershipId: '0190e7a0-0000-7000-8000-000000000001',
          },
        ],
      })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'CONTACT_LINE_NOT_FOUND' }),
      );
  });
});
