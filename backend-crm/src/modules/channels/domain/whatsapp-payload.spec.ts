import { isValidSignature, sameToken, signBody } from './webhook-signature';
import { parseWebhook, textMessagePayload } from './whatsapp-payload';

const change = (value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
});

describe('parseWebhook', () => {
  it('extracts text messages with the sender profile name', () => {
    const events = parseWebhook(
      textMessagePayload({
        phoneNumberId: '1111',
        from: '59171234567',
        text: 'Hola',
        profileName: 'Lucía',
        waMessageId: 'wamid.1',
        timestamp: new Date('2026-10-20T12:00:00Z'),
      }),
    );
    expect(events.messages).toEqual([
      {
        phoneNumberId: '1111',
        waMessageId: 'wamid.1',
        from: '59171234567',
        profileName: 'Lucía',
        timestamp: new Date('2026-10-20T12:00:00Z'),
        type: 'text',
        text: 'Hola',
        media: null,
        location: null,
      },
    ]);
  });

  it('handles media, locations, buttons and unknown types', () => {
    const events = parseWebhook(
      change({
        metadata: { phone_number_id: '1111' },
        messages: [
          {
            from: '1',
            id: 'a',
            timestamp: '1',
            type: 'image',
            image: { id: 'm1', mime_type: 'image/jpeg', caption: 'Foto' },
          },
          {
            from: '1',
            id: 'b',
            timestamp: '1',
            type: 'location',
            location: { latitude: -16.5, longitude: -68.1, name: 'Oficina' },
          },
          {
            from: '1',
            id: 'c',
            timestamp: '1',
            type: 'button',
            button: { text: 'Sí' },
          },
          {
            from: '1',
            id: 'd',
            timestamp: '1',
            type: 'reaction',
            reaction: {},
          },
          { from: '1', id: 'e', timestamp: '1', type: 'order' },
          { id: 'no-sender', type: 'text' },
        ],
      }),
    );
    expect(events.messages.map((m) => [m.waMessageId, m.type, m.text])).toEqual(
      [
        ['a', 'image', 'Foto'],
        ['b', 'location', 'Oficina'],
        ['c', 'text', 'Sí'],
        ['e', 'unsupported', null],
      ],
    );
    expect(events.messages[0]?.media).toEqual({
      id: 'm1',
      mimeType: 'image/jpeg',
      caption: 'Foto',
      filename: null,
    });
    expect(events.messages[1]?.location).toEqual({
      latitude: -16.5,
      longitude: -68.1,
      name: 'Oficina',
      address: null,
    });
  });

  it('extracts delivery statuses and failures', () => {
    const events = parseWebhook(
      change({
        metadata: { phone_number_id: '1111' },
        statuses: [
          { id: 'w1', status: 'read', timestamp: '1', recipient_id: '591' },
          {
            id: 'w2',
            status: 'failed',
            timestamp: '1',
            recipient_id: '591',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'w3', status: 'weird' },
        ],
      }),
    );
    expect(
      events.statuses.map((s) => [s.waMessageId, s.status, s.error]),
    ).toEqual([
      ['w1', 'read', null],
      ['w2', 'failed', 'Re-engagement message'],
    ]);
  });

  it.each([
    null,
    'text',
    { object: 'page' },
    { object: 'whatsapp_business_account', entry: 'x' },
  ])('ignores foreign or malformed payloads (%p)', (body) => {
    expect(parseWebhook(body)).toEqual({ messages: [], statuses: [] });
  });
});

describe('webhook signature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');

  it('accepts the signature Meta computes with the App Secret', () => {
    expect(
      isValidSignature(body, signBody(body, 'app-secret'), 'app-secret'),
    ).toBe(true);
  });

  it.each([
    ['another secret', signBody(body, 'other')],
    ['a missing header', undefined],
    ['a malformed header', 'sha1=abc'],
    ['a truncated digest', signBody(body, 'app-secret').slice(0, 20)],
  ])('rejects %s', (_case, header) => {
    expect(isValidSignature(body, header, 'app-secret')).toBe(false);
  });

  it('compares verify tokens in constant time', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });
});
