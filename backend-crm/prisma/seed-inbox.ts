import { createHash, randomBytes } from 'node:crypto';
import { Types, type Connection } from 'mongoose';
import type { PrismaClient } from '../src/generated/prisma/client';
import { SecretBox } from '../src/shared/security/secret-box';
import {
  ContactSchema,
  TagSchema,
} from '../src/modules/contacts/infrastructure/contact.schemas';
import {
  ConversationSchema,
  MessageSchema,
} from '../src/modules/inbox/infrastructure/inbox.schemas';

export async function seedInboxDemo(
  prisma: PrismaClient,
  connection: Connection,
  secrets: SecretBox,
): Promise<void> {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.WHATSAPP_MODE !== 'simulated'
  ) {
    throw new Error(
      'Inbox demo requires non-production and WHATSAPP_MODE=simulated',
    );
  }
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: 'acme' },
  });
  const workspaceId = workspace.id;
  const members = await prisma.workspaceMembership.findMany({
    where: {
      workspaceId,
      status: 'ACTIVE',
      user: {
        email: {
          in: [
            'admin@example.com',
            'agent@example.com',
            'superadmin@example.com',
          ],
        },
      },
    },
    include: { user: true },
    orderBy: { user: { email: 'asc' } },
  });
  if (members.length !== 3)
    throw new Error('Create demo users before inbox demo');
  const phoneNumberId = `900${BigInt(`0x${workspaceId.replaceAll('-', '').slice(0, 12)}`)}`;
  const line = await prisma.channelLine.upsert({
    where: { phoneNumberId },
    update: {},
    create: {
      workspaceId,
      name: 'Ventas Acme (demo)',
      phoneNumberId,
      displayPhone: '+59170000999',
      status: 'CONNECTED',
      autoAssign: true,
      accessTokenEnc: secrets.encrypt(randomBytes(32).toString('hex')),
      accessTokenLast4: 'demo',
      appSecretEnc: secrets.encrypt(randomBytes(16).toString('hex')),
      webhookVerifyToken: randomBytes(24).toString('hex'),
      agents: {
        create: members.map((member) => ({ membershipId: member.id })),
      },
    },
  });
  if (line.workspaceId !== workspaceId)
    throw new Error('Demo line belongs to another workspace');
  const tags = connection.model('DemoTag', TagSchema);
  const contacts = connection.model('DemoContact', ContactSchema);
  const conversations = connection.model(
    'DemoConversation',
    ConversationSchema,
  );
  const messages = connection.model('DemoMessage', MessageSchema);
  await Promise.all([
    tags.createIndexes(),
    contacts.createIndexes(),
    conversations.createIndexes(),
    messages.createIndexes(),
  ]);
  const tagIds: Types.ObjectId[] = [];
  for (const [name, color] of [
    ['Cliente', '#22c55e'],
    ['Prospecto', '#3b82f6'],
    ['VIP', '#a855f7'],
  ] as const) {
    const tag = await tags.findOneAndUpdate(
      { workspaceId, normalizedName: name.toLowerCase() },
      { $setOnInsert: { name, color } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    tagIds.push(tag._id);
  }
  const now = new Date();
  for (let index = 0; index < 10; index++) {
    const phone = `+591700001${String(index).padStart(2, '0')}`;
    const name = [
      'Ana Flores',
      'Carlos Rojas',
      'María López',
      'Diego Pérez',
      'Lucía Soto',
      'Pedro Ruiz',
      'Elena Vargas',
      'Luis Salas',
      'Sofía Méndez',
      'Jorge Cruz',
    ][index];
    const at = new Date(now.getTime() - index * 60_000);
    const contact = await contacts.findOneAndUpdate(
      { workspaceId, phone },
      {
        $setOnInsert: {
          name,
          source: 'whatsapp',
          tagIds: [tagIds[index % 3]],
          lastMessageAt: at,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    const conversationId = new Types.ObjectId(
      createHash('sha256')
        .update(`${workspaceId}:inbox-demo:${index}`)
        .digest('hex')
        .slice(0, 24),
    );
    const member = index % 4 === 3 ? null : members[index % members.length];
    const text = [
      'Hola, quisiera información sobre sus servicios.',
      '¿Me pueden ayudar con mi pedido?',
      'Gracias por la atención.',
    ][index % 3];
    const closed = index >= 8;
    await conversations.findOneAndUpdate(
      { workspaceId, _id: conversationId },
      {
        $setOnInsert: {
          lineId: line.id,
          contactId: contact._id.toHexString(),
          contact: { name, phone },
          status: closed ? 'CLOSED' : 'OPEN',
          assignee: member
            ? {
                membershipId: member.id,
                userId: member.userId,
                name: member.user.displayName,
              }
            : null,
          lastMessage: { text, type: 'text', direction: 'IN', at },
          lastActivityAt: at,
          lastInboundAt: at,
          unreadCount: closed ? 0 : 1,
          closedAt: closed ? at : null,
        },
      },
      { upsert: true, runValidators: true },
    );
    await messages.findOneAndUpdate(
      { workspaceId, waMessageId: `demo:${workspaceId}:${index}` },
      {
        $setOnInsert: {
          conversationId,
          direction: 'IN',
          type: 'text',
          text,
          status: 'received',
          createdAt: at,
        },
      },
      { upsert: true, runValidators: true },
    );
  }
}
