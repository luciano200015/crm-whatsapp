import { Injectable } from '@nestjs/common';

/**
 * Who has the inbox open right now: an open event stream (SSE) counts as
 * connected. Kept in memory, so it covers this process only.
 */
@Injectable()
export class InboxPresence {
  private readonly streams = new Map<string, Map<string, number>>();

  /** Returns the function that ends this connection. */
  connect(workspaceId: string, userId: string): () => void {
    const users = this.streams.get(workspaceId) ?? new Map<string, number>();
    this.streams.set(workspaceId, users);
    users.set(userId, (users.get(userId) ?? 0) + 1);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      const left = (users.get(userId) ?? 1) - 1;
      if (left > 0) users.set(userId, left);
      else users.delete(userId);
      if (users.size === 0) this.streams.delete(workspaceId);
    };
  }

  connectedUserIds(workspaceId: string): Set<string> {
    return new Set(this.streams.get(workspaceId)?.keys() ?? []);
  }
}
