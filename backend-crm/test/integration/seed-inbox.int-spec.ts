import { randomBytes } from 'node:crypto';
import type { Connection } from 'mongoose';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { seedAuthorization } from '../../prisma/seed-authorization';
import { seedBilling } from '../../prisma/seed-billing';
import { seedDemoData } from '../../prisma/seed-demo';
import { seedInboxDemo } from '../../prisma/seed-inbox';
import { SecretBox } from '../../src/shared/security/secret-box';
import {
  clearMongo,
  createTestMongo,
  createTestPrisma,
  truncateAll,
} from '../utils/test-db';

describe('inbox demo seed', () => {
  let prisma: PrismaClient;
  let mongo: Connection;
  const box = SecretBox.withKey(randomBytes(32));
  beforeAll(async () => {
    prisma = createTestPrisma();
    mongo = await createTestMongo();
    await truncateAll(prisma);
    await clearMongo(mongo);
    await seedAuthorization(prisma);
    await seedBilling(prisma);
    await seedDemoData(prisma, {
      password: 'safe demonstration passphrase',
      hashPassword: () => Promise.resolve('test-only-password-hash'),
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await mongo.close();
  });

  it('is idempotent and preserves edited conversations', async () => {
    await seedInboxDemo(prisma, mongo, box);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: 'acme' },
    });
    const workspaceId = workspace.id;
    const conversation = await mongo
      .collection('conversations')
      .findOne({ workspaceId, status: 'OPEN' });
    await mongo
      .collection('conversations')
      .updateOne(
        { workspaceId, _id: conversation!._id },
        { $set: { status: 'CLOSED', unreadCount: 0 } },
      );
    await seedInboxDemo(prisma, mongo, box);
    expect(await prisma.channelLine.count({ where: { workspaceId } })).toBe(1);
    expect(
      await mongo.collection('contacts').countDocuments({ workspaceId }),
    ).toBe(10);
    expect(await mongo.collection('tags').countDocuments({ workspaceId })).toBe(
      3,
    );
    expect(
      await mongo.collection('conversations').countDocuments({ workspaceId }),
    ).toBe(10);
    expect(
      await mongo.collection('messages').countDocuments({ workspaceId }),
    ).toBe(10);
    expect(
      await mongo
        .collection('conversations')
        .findOne({ workspaceId, _id: conversation!._id }),
    ).toMatchObject({ status: 'CLOSED', unreadCount: 0 });
  });
});
