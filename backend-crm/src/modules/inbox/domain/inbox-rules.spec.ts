import {
  canSee,
  isWindowOpen,
  nextStatus,
  pickNextAgent,
  startOfMonth,
  type InboxScope,
} from './inbox-rules';

const NOW = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('inbox rules', () => {
  it('keeps the reply window open for 24 h after the last inbound message', () => {
    expect(isWindowOpen(hoursAgo(23), NOW)).toBe(true);
    expect(isWindowOpen(hoursAgo(25), NOW)).toBe(false);
    expect(isWindowOpen(null, NOW)).toBe(false);
  });

  it('rotates agents in turns', () => {
    const agents = ['a', 'b', 'c'];
    expect(pickNextAgent(agents, null)).toBe('a');
    expect(pickNextAgent(agents, 'a')).toBe('b');
    expect(pickNextAgent(agents, 'c')).toBe('a');
    // The previous agent left the line: start over.
    expect(pickNextAgent(agents, 'gone')).toBe('a');
    expect(pickNextAgent([], 'a')).toBeNull();
  });

  describe('visibility', () => {
    const scope: InboxScope = {
      membershipId: 'me',
      viewAll: false,
      lineIds: ['line-1'],
    };

    it.each([
      [
        'assigned to me',
        { lineId: 'line-2', assignee: { membershipId: 'me' } },
        true,
      ],
      ['unassigned on my line', { lineId: 'line-1', assignee: null }, true],
      [
        'unassigned on another line',
        { lineId: 'line-2', assignee: null },
        false,
      ],
      [
        'assigned to someone else',
        { lineId: 'line-1', assignee: { membershipId: 'other' } },
        false,
      ],
    ])('%s', (_case, conversation, visible) => {
      expect(canSee(conversation, scope)).toBe(visible);
      expect(canSee(conversation, { ...scope, viewAll: true })).toBe(true);
    });
  });

  it('starts the month in UTC', () => {
    expect(startOfMonth(NOW)).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('only moves delivery statuses forward', () => {
    expect(nextStatus('sent', 'delivered')).toBe('delivered');
    expect(nextStatus('read', 'delivered')).toBe('read');
    expect(nextStatus('delivered', 'failed')).toBe('failed');
    expect(nextStatus('failed', 'read')).toBe('failed');
    expect(nextStatus('received', 'read')).toBe('received');
  });
});
