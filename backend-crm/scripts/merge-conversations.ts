/**
 * Since chats are reopened instead of duplicated, a contact has ONE
 * conversation per line. This joins the conversations created before that
 * change: messages move to the most recent conversation of the contact and
 * line, and the emptied ones are deleted. No message is lost.
 *
 *   npm run inbox:merge-conversations            # only shows what it would do
 *   npm run inbox:merge-conversations -- --apply # does it
 *
 * Reads MONGODB_URI from .env.
 */
import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

config({ path: resolve(__dirname, '../.env'), quiet: true });

interface ConversationRow {
  _id: Types.ObjectId;
  workspaceId: string;
  lineId: string;
  contactId: string;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  assignee: unknown;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  unreadCount: number;
  closedAt: Date | null;
  createdAt: Date;
}

const RANK = { OPEN: 0, ON_HOLD: 1, CLOSED: 2 } as const;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false } },
  });
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must be set in .env');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  const conversations = db.collection<ConversationRow>('conversations');
  const messages = db.collection('messages');

  const groups = await conversations
    .aggregate<{ _id: unknown; ids: Types.ObjectId[] }>([
      {
        $group: {
          _id: {
            workspaceId: '$workspaceId',
            lineId: '$lineId',
            contactId: '$contactId',
          },
          ids: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  let moved = 0;
  let removed = 0;
  for (const group of groups) {
    const rows = await conversations
      .find({ _id: { $in: group.ids } })
      .sort({ lastActivityAt: -1, _id: -1 })
      .toArray();
    const [keep, ...others] = rows;
    if (!keep) continue;
    // The merged chat keeps the most "alive" status: open, then on hold, then closed.
    const state =
      [...rows].sort((a, b) => RANK[a.status] - RANK[b.status])[0] ?? keep;
    const otherIds = others.map((row) => row._id);
    const count = await messages.countDocuments({
      workspaceId: keep.workspaceId,
      conversationId: { $in: otherIds },
    });
    console.log(
      `Contact ${keep.contactId} on line ${keep.lineId}: ${rows.length} chats → 1 (${count} messages to move, status ${state.status})`,
    );
    moved += count;
    removed += others.length;
    if (!values.apply) continue;

    await messages.updateMany(
      { workspaceId: keep.workspaceId, conversationId: { $in: otherIds } },
      { $set: { conversationId: keep._id } },
    );
    const inbound = rows
      .map((row) => row.lastInboundAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    await conversations.updateOne(
      { _id: keep._id },
      {
        $set: {
          status: state.status,
          assignee: state.assignee,
          closedAt: state.status === 'CLOSED' ? keep.closedAt : null,
          unreadCount: rows.reduce(
            (sum, row) => sum + (row.unreadCount ?? 0),
            0,
          ),
          lastInboundAt: inbound ? new Date(inbound) : null,
          createdAt: rows.reduce(
            (first, row) => (row.createdAt < first ? row.createdAt : first),
            keep.createdAt,
          ),
        },
      },
    );
    await conversations.deleteMany({ _id: { $in: otherIds } });
  }

  console.log(
    `${groups.length} contacts with several chats: ${moved} messages ${values.apply ? 'moved' : 'to move'}, ${removed} empty chats ${values.apply ? 'deleted' : 'to delete'}.`,
  );
  if (!values.apply && groups.length > 0) {
    console.log('Nothing changed. Run again with --apply to merge them.');
  }
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
