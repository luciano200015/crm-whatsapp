import { buildRequest, valueAt } from './bot-request';
import { isPublicAddress } from './ip-guard';

describe('«Consulta API» addresses', () => {
  it('refuses the private, local and reserved ones, v4 and v6', () => {
    for (const address of [
      '10.0.0.5',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      '172.16.3.4',
      '172.31.255.255',
      '192.168.1.10',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.1.2.3',
      '::ffff:a9fe:a9fe',
      '64:ff9b::192.168.0.1',
      '2001:db8::1',
      'not-an-ip',
    ])
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
  });

  it('allows public addresses', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.4.4',
    ])
      expect([address, isPublicAddress(address)]).toEqual([address, true]);
  });
});

describe('«Consulta API» requests', () => {
  const api = {
    method: 'GET' as const,
    url: 'https://api.example.com/clientes/{{cedula}}',
    auth: {
      type: 'bearer' as const,
      token: 'tok-{{plan}}',
      user: '',
      password: '',
    },
    headers: [{ key: 'X-Canal', value: 'whatsapp\r\nX-Evil: 1' }],
    params: [
      { key: 'nombre', value: '{{nombre}}' },
      { key: '', value: '' },
    ],
    responses: [],
  };
  const vars: Record<string, string> = {
    cedula: '12 34/5',
    plan: 'oro',
    nombre: 'Ana María',
  };
  const fill = (text: string, encode: (value: string) => string = (v) => v) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      encode(vars[name] ?? ''),
    );

  it('encodes variables in the URL and sends GET params as the query', () => {
    expect(buildRequest(api, fill)).toEqual({
      method: 'GET',
      url: 'https://api.example.com/clientes/12%2034%2F5?nombre=Ana+Mar%C3%ADa',
      headers: {
        'X-Canal': 'whatsapp X-Evil: 1',
        Authorization: 'Bearer tok-oro',
      },
      body: null,
    });
  });

  it('sends the params of other methods as JSON, with basic auth', () => {
    expect(
      buildRequest(
        {
          ...api,
          method: 'POST',
          url: 'https://api.example.com/leads',
          auth: { type: 'basic', token: '', user: 'bot', password: 'secreto' },
          headers: [],
        },
        fill,
      ),
    ).toEqual({
      method: 'POST',
      url: 'https://api.example.com/leads',
      headers: {
        Authorization: `Basic ${Buffer.from('bot:secreto').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nombre: 'Ana María' }),
    });
  });

  it('reads values of the JSON answer by path', () => {
    const body = {
      data: { items: [{ nombre: 'Ana', saldo: 12.5, activo: true }] },
    };
    expect(valueAt(body, 'data.items[0].nombre')).toBe('Ana');
    expect(valueAt(body, 'data.items.0.saldo')).toBe('12.5');
    expect(valueAt(body, 'data.items.0.activo')).toBe('true');
    expect(valueAt(body, 'data.items.0')).toBe(
      '{"nombre":"Ana","saldo":12.5,"activo":true}',
    );
    expect(valueAt(body, 'data.nada.mas')).toBe('');
    expect(valueAt('texto', 'data')).toBe('');
  });
});
