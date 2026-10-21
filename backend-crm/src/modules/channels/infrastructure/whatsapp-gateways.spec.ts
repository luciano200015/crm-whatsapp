import {
  metaErrorMessage,
  redactToken,
  tokenScopes,
} from './whatsapp-gateways';

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

describe('metaErrorMessage', () => {
  it('adds the details and the trace id Meta sends', () => {
    expect(
      metaErrorMessage(
        {
          message: '(#131005) Access denied',
          code: 131005,
          error_data: { details: 'Permission denied for this phone number' },
          fbtrace_id: 'AbC123',
        },
        'Forbidden',
      ),
    ).toBe(
      '(#131005) Access denied: Permission denied for this phone number [trace AbC123]',
    );
  });

  it('falls back to the HTTP status text', () => {
    expect(metaErrorMessage({}, 'Forbidden')).toBe('Forbidden');
  });

  it('does not repeat details already in the message', () => {
    expect(
      metaErrorMessage(
        { message: 'Invalid parameter', error_data: { details: 'Invalid' } },
        'Bad Request',
      ),
    ).toBe('Invalid parameter');
  });
});

describe('tokenScopes', () => {
  const data = {
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    granular_scopes: [
      { scope: 'whatsapp_business_management', target_ids: ['111'] },
      { scope: 'whatsapp_business_messaging', target_ids: ['111'] },
    ],
  };

  it('allows the accounts listed in target_ids', () => {
    expect(tokenScopes(data, '111')).toEqual({
      canMessage: true,
      canManage: true,
    });
    expect(tokenScopes(data, '222')).toEqual({
      canMessage: false,
      canManage: false,
    });
  });

  it('needs the messaging scope to send', () => {
    expect(
      tokenScopes({ scopes: ['whatsapp_business_management'] }, '111'),
    ).toEqual({ canMessage: false, canManage: true });
  });

  it('without target_ids the scope covers every account', () => {
    expect(
      tokenScopes({ scopes: ['whatsapp_business_messaging'] }, '111'),
    ).toEqual({ canMessage: true, canManage: false });
  });
});
