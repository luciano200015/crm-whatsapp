import { redactToken } from './whatsapp-gateways';

describe('redactToken', () => {
  it('removes the access token Meta echoes in its errors', () => {
    expect(
      redactToken(
        'Malformed access token EAAG-qa-fake-token-f6f117aeb7a93eb9',
        'EAAG-qa-fake-token-f6f117aeb7a93eb9',
      ),
    ).toBe('Malformed access token [token]');
  });

  it('also removes other token-shaped values', () => {
    expect(redactToken('Invalid OAuth token EAAJZBabc123XYZ_-9', 'other')).toBe(
      'Invalid OAuth token [token]',
    );
    expect(redactToken('(#100) Param to must be valid', 'EAAtoken')).toBe(
      '(#100) Param to must be valid',
    );
  });
});
