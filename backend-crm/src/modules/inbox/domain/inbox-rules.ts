/** WhatsApp only allows free-form replies within 24 h of the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowExpiresAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt
    ? new Date(lastInboundAt.getTime() + REPLY_WINDOW_MS)
    : null;
}

export function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  const expires = windowExpiresAt(lastInboundAt);
  return expires !== null && expires > now;
}

/**
 * Round-robin: the agent after `last` in the (stable) list of agents, or the
 * first one when `last` left the list or nobody was assigned yet.
 */
export function pickNextAgent(
  agentIds: readonly string[],
  last: string | null,
): string | null {
  if (agentIds.length === 0) return null;
  const index = last ? agentIds.indexOf(last) : -1;
  return agentIds[(index + 1) % agentIds.length] ?? null;
}

/** What a member may see in the inbox. */
export interface InboxScope {
  membershipId: string;
  /** conversations.view_all: everything in the workspace. */
  viewAll: boolean;
  /** Lines the member attends (channel_line_agents). */
  lineIds: readonly string[];
}

/**
 * Without conversations.view_all a member sees the conversations assigned
 * to them and the unassigned ones of the lines they attend.
 */
export function canSee(
  conversation: { lineId: string; assignee: { membershipId: string } | null },
  scope: InboxScope,
): boolean {
  if (scope.viewAll) return true;
  if (conversation.assignee?.membershipId === scope.membershipId) return true;
  return (
    conversation.assignee === null &&
    scope.lineIds.includes(conversation.lineId)
  );
}

/** First day of the month (UTC) for monthly limits such as active contacts. */
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Delivery statuses only move forward; a failure always wins. */
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 } as const;
export type OutboundStatus = keyof typeof STATUS_RANK | 'failed';

export function nextStatus(
  current: OutboundStatus | 'received',
  incoming: OutboundStatus,
): OutboundStatus | 'received' {
  if (current === 'received' || current === 'failed') return current;
  if (incoming === 'failed') return 'failed';
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}
