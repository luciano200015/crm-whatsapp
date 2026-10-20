import type { Connection } from 'mongoose';
import { MissingWorkspaceFilterError } from '../../src/database/mongodb/workspace-scoped.plugin';
import {
  CONTACT_MODEL,
  ContactSchema,
  TAG_MODEL,
  TagSchema,
  type ContactDocument,
  type TagDocument,
} from '../../src/modules/contacts/infrastructure/contact.schemas';
import { clearMongo, createTestMongo } from '../utils/test-db';

const compile = (connection: Connection) => ({
  contacts: connection.model<ContactDocument>(CONTACT_MODEL, ContactSchema),
  tags: connection.model<TagDocument>(TAG_MODEL, TagSchema),
});

describe('MongoDB conventions (integration)', () => {
  let connection: Connection;
  let contacts: ReturnType<typeof compile>['contacts'];
  let tags: ReturnType<typeof compile>['tags'];

  beforeAll(async () => {
    connection = await createTestMongo();
    ({ contacts, tags } = compile(connection));
    await Promise.all([contacts.createIndexes(), tags.createIndexes()]);
  });

  beforeEach(async () => {
    await clearMongo(connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  const contact = (workspaceId: string, phone: string) =>
    contacts.create({ workspaceId, phone, source: 'manual' });

  it('requires workspaceId on every document', async () => {
    await expect(
      contacts.create({ phone: '+59170000001', source: 'manual' }),
    ).rejects.toThrow(/workspaceId/);
  });

  it.each([
    ['find', (m: typeof contacts) => m.find({ phone: '+1' })],
    ['findOne', (m: typeof contacts) => m.findOne({})],
    ['countDocuments', (m: typeof contacts) => m.countDocuments()],
    ['updateMany', (m: typeof contacts) => m.updateMany({}, { name: 'x' })],
    ['deleteMany', (m: typeof contacts) => m.deleteMany({})],
  ])('refuses %s without a workspaceId filter', async (_op, run) => {
    await expect(run(contacts)).rejects.toBeInstanceOf(
      MissingWorkspaceFilterError,
    );
  });

  it('refuses aggregations that do not start by matching the workspace', async () => {
    await expect(
      contacts.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]),
    ).rejects.toBeInstanceOf(MissingWorkspaceFilterError);
    await expect(
      contacts.aggregate([{ $match: { workspaceId: 'w1' } }]),
    ).resolves.toEqual([]);
  });

  it('keeps phones unique per workspace only', async () => {
    await contact('w1', '+59170000001');
    await expect(contact('w1', '+59170000001')).rejects.toMatchObject({
      code: 11000,
    });
    await expect(contact('w2', '+59170000001')).resolves.toBeDefined();
  });

  it('keeps normalized tag names unique per workspace', async () => {
    await tags.create({
      workspaceId: 'w1',
      name: 'VIP',
      normalizedName: 'vip',
      color: '#000000',
    });
    await expect(
      tags.create({
        workspaceId: 'w1',
        name: 'vip',
        normalizedName: 'vip',
        color: '#ffffff',
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
