/**
 * Chats left behind by deleted contacts are now given back when the number
 * returns. This does it for the chats that already exist: a chat whose
 * contact was deleted goes to the current contact with the same phone,
 * merged with the chat that contact may already have on the line (messages
 * move, the emptied chat is deleted). No message is lost.
 *
 *   npm run inbox:relink-conversations            # only shows what it would do
 *   npm run inbox:relink-conversations -- --apply # does it
 *
 * Reads MONGODB_URI from .env.
 */
import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  adoptConversations,
  type MergeRow,
} from '../src/modules/inbox/infrastructure/conversation-merge';

config({ path: resolve(__dirname, '../.env'), quiet: true });

interface ContactRow {
  _id: Types.ObjectId;
  workspaceId: string;
  phone: string;
  name: string | null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false } },
  });
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must be set in .env');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  const conversations = db.collection<MergeRow>('conversations');
  const messages = db.collection('messages');
  const contacts = db.collection<ContactRow>('contacts');

  // Every (workspace, contactId, phone) of the chats.
  const owners = await conversations
    .aggregate<{
      _id: { workspaceId: string; contactId: string; phone: string };
      chats: number;
    }>([
      {
        $group: {
          _id: {
            workspaceId: '$workspaceId',
            contactId: '$contactId',
            phone: '$contact.phone',
          },
          chats: { $sum: 1 },
        },
      },
    ])
    .toArray();

  let relinked = 0;
  let chats = 0;
  for (const { _id: owner, chats: count } of owners) {
    const exists =
      Types.ObjectId.isValid(owner.contactId) &&
      (await contacts.countDocuments({
        workspaceId: owner.workspaceId,
        _id: new Types.ObjectId(owner.contactId),
      })) > 0;
    if (exists) continue;
    const current = await contacts.findOne({
      workspaceId: owner.workspaceId,
      phone: owner.phone,
    });
    if (!current) continue;
    console.log(
      `Deleted contact ${owner.contactId} (${owner.phone}): ${count} chat(s) → contact ${current._id.toHexString()}`,
    );
    relinked++;
    chats += count;
    if (!values.apply) continue;
    const result = await adoptConversations(
      { conversations, messages },
      owner.workspaceId,
      {
        contactId: current._id.toHexString(),
        contact: { name: current.name, phone: current.phone },
      },
      [owner.contactId],
    );
    console.log(
      `  ${result.movedMessages} messages moved, ${result.removedIds.length} emptied chat(s) deleted`,
    );
  }

  console.log(
    `${relinked} deleted contacts with a current contact: ${chats} chat(s) ${values.apply ? 'given back' : 'to give back'}.`,
  );
  if (!values.apply && relinked > 0) {
    console.log('Nothing changed. Run again with --apply to give them back.');
  }
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
