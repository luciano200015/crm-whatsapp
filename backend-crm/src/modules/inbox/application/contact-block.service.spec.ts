import type { ChannelsService } from '../../channels/application/channels.service';
import {
  WhatsAppApiError,
  type ChannelsStore,
  type WhatsAppGateway,
} from '../../channels/application/ports';
import type { ContactsStore } from '../../contacts/application/ports';
import { ContactBlockService } from './contact-block.service';
import type { ConversationTimeline } from './conversation-timeline';
import type { InboxEvents } from './inbox-events';
import type { InboxActor } from './inbox.service';
import type { AssignmentStore, InboxStore } from './ports';

const actor = {
  userId: 'u1',
  access: { workspaceId: 'ws', membershipId: 'm1' },
} as unknown as InboxActor;

function setup(gateway: Partial<WhatsAppGateway>) {
  const timeline = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ContactBlockService(
    {
      setBlocked: jest
        .fn()
        .mockResolvedValue({ id: 'c1', phone: '+59170000001', blocked: true }),
    } as unknown as ContactsStore,
    {
      contactConversations: jest.fn().mockResolvedValue([
        {
          id: 'conv1',
          workspaceId: 'ws',
          lineId: 'line1',
          status: 'CLOSED',
          assignee: null,
        },
      ]),
    } as unknown as InboxStore,
    {
      activeMember: jest.fn().mockResolvedValue({
        membershipId: 'm1',
        userId: 'u1',
        name: 'Olga',
      }),
    } as unknown as AssignmentStore,
    {
      findLine: jest.fn().mockResolvedValue({
        id: 'line1',
        name: 'Ventas',
        status: 'CONNECTED',
      }),
    } as unknown as ChannelsStore,
    {
      credentials: jest
        .fn()
        .mockResolvedValue({ phoneNumberId: '1', accessToken: 't' }),
    } as unknown as ChannelsService,
    gateway as WhatsAppGateway,
    timeline as unknown as ConversationTimeline,
    { emit: jest.fn() } as unknown as InboxEvents,
    { now: () => new Date('2026-10-21T12:00:00Z') },
  );
  return { service, timeline };
}

describe('ContactBlockService', () => {
  it('keeps the CRM block when WhatsApp refuses it', async () => {
    const { service, timeline } = setup({
      setUserBlocked: jest
        .fn()
        .mockRejectedValue(
          new WhatsAppApiError(
            'User must have messaged in the last 24 hours',
            400,
          ),
        ),
    });

    const result = await service.setBlocked(actor, 'c1', true);

    expect(result).toEqual({
      blocked: true,
      whatsapp: [
        {
          lineId: 'line1',
          lineName: 'Ventas',
          ok: false,
          error: 'User must have messaged in the last 24 hours',
        },
      ],
    });
    // No open chat: the notice goes to the latest one.
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv1' }),
      expect.objectContaining({ kind: 'contact_blocked' }),
    );
  });

  it('blocks on WhatsApp with the WhatsApp id (digits only)', async () => {
    const setUserBlocked = jest.fn().mockResolvedValue(undefined);
    const { service } = setup({ setUserBlocked });

    await service.setBlocked(actor, 'c1', true);

    expect(setUserBlocked).toHaveBeenCalledWith(
      { phoneNumberId: '1', accessToken: 't' },
      '59170000001',
      true,
    );
  });
});
