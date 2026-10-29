import { runTurn } from '../application/bot-turn';
import {
  advance,
  DEFAULT_INVALID_ANSWER,
  interpolate,
  type BotAction,
  type EngineContext,
} from './flow-engine';
import { flowIssues, FlowFormatError, parseFlow, type Flow } from './flow';

const at = () => ({ x: 0, y: 0 });
const flowOf = (raw: { nodes: unknown[]; edges: unknown[] }): Flow =>
  parseFlow(raw);
const context: EngineContext = {
  now: new Date('2026-10-23T15:00:00Z'),
  contact: { name: 'Lucía', phone: '+59170000001', email: null },
};
const edge = (source: string, target: string, sourceHandle = 'next') => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});
const start = { id: 'start', type: 'start', position: at(), data: {} };
const say = (id: string, text: string, extra: object = {}) => ({
  id,
  type: 'message',
  position: at(),
  data: { text },
  ...extra,
});
const hello = { text: 'hola', replyId: null };
/** What was sent, and the kind of everything else. */
const sent = (actions: BotAction[]) =>
  actions.map((action) =>
    action.kind === 'send' ? action.message : { kind: action.kind },
  );
const errors = (flow: Flow) =>
  flowIssues(flow).filter((issue) => issue.level === 'error');

describe('«Respuesta» with options', () => {
  const options = (count: number, title = 'Opción') =>
    Array.from({ length: count }, (_, index) => ({
      id: `o${index}`,
      title: `${title} ${index + 1}`,
    }));
  const reply = (list: object[], listButton = '') =>
    advance(
      flowOf({
        nodes: [
          start,
          say('menu', 'Elige', {
            data: { text: 'Elige', options: list, listButton },
          }),
        ],
        edges: [edge('start', 'menu')],
      }),
      null,
      hello,
      context,
    ).actions[0];

  it('sends 1 to 3 short options as buttons', () => {
    expect(reply(options(3))).toMatchObject({
      message: { content: { kind: 'buttons' } },
    });
  });

  it('sends 4 or more, or long titles, as a list named by its button', () => {
    expect(reply(options(4))).toMatchObject({
      message: {
        content: {
          kind: 'list',
          list: { button: 'Ver opciones', sections: [{ title: null }] },
        },
      },
    });
    expect(reply(options(10), 'Ver planes')).toMatchObject({
      message: { content: { list: { button: 'Ver planes' } } },
    });
    expect(reply(options(2, 'Título bastante largo'))).toMatchObject({
      message: { content: { kind: 'list' } },
    });
  });

  it('refuses more than ten options', () => {
    expect(() =>
      parseFlow({
        nodes: [
          start,
          say('m', 'Hola', { data: { text: 'Hola', options: options(11) } }),
        ],
        edges: [edge('start', 'm')],
      }),
    ).toThrow(FlowFormatError);
  });
});

describe('«Aceptar cualquier mensaje»', () => {
  const flow = flowOf({
    nodes: [
      start,
      say('ask', '¿Ventas o soporte?', {
        data: { text: '¿Ventas o soporte?', wait: true },
      }),
      say('sales', 'Ventas', { trigger: 'ventas' }),
      say('other', 'Te leo', { trigger: '*' }),
    ],
    edges: [edge('start', 'ask'), edge('ask', 'sales'), edge('ask', 'other')],
  });
  const waiting = { nodeId: 'ask', vars: {}, attempts: 0 };
  const answer = (text: string) =>
    sent(advance(flow, waiting, { text, replyId: null }, context).actions);

  it('opens the card only when no words match', () => {
    expect(answer('Ventas')).toEqual([{ kind: 'text', text: 'Ventas' }]);
    expect(answer('quiero un precio')).toEqual([
      { kind: 'text', text: 'Te leo' },
    ]);
    expect(errors(flow)).toEqual([]);
  });

  it('is an error on a card nothing leads to', () => {
    const loose = flowOf({
      nodes: [
        start,
        say('hello', 'Hola'),
        say('any', 'Todo', { trigger: '*' }),
      ],
      edges: [edge('start', 'hello')],
    });
    expect(errors(loose)).toContainEqual(
      expect.objectContaining({ nodeId: 'any' }),
    );
  });
});

describe('«Condiciones»', () => {
  const rules = [
    {
      id: 'r1',
      source: 'variable',
      variable: 'edad',
      operator: 'gte',
      value: '18',
    },
    {
      id: 'r2',
      source: 'variable',
      variable: 'ciudad',
      operator: 'in',
      value: 'La Paz, Cochabamba',
    },
  ];
  const run = (match: string, edad: string, ciudad: string) => {
    const flow = flowOf({
      nodes: [
        start,
        {
          id: 'cond',
          type: 'condition',
          position: at(),
          data: { match, rules },
        },
        say('yes', 'Cumple'),
        say('no', 'No cumple'),
        say('first', 'Primera'),
      ],
      edges: [
        edge('start', 'cond'),
        ...(match === 'each'
          ? [edge('cond', 'first', 'r1'), edge('cond', 'no', 'else')]
          : [edge('cond', 'yes', 'yes'), edge('cond', 'no', 'no')]),
      ],
    });
    return sent(
      advance(flow, null, hello, {
        ...context,
        variables: [
          { name: 'edad', type: 'number', defaultValue: edad, description: '' },
          {
            name: 'ciudad',
            type: 'text',
            defaultValue: ciudad,
            description: '',
          },
        ],
      }).actions,
    );
  };
  const yes = [{ kind: 'text', text: 'Cumple' }];
  const no = [{ kind: 'text', text: 'No cumple' }];

  it('meets all or any rule, with the new operators', () => {
    expect(run('all', '18', 'cochabamba')).toEqual(yes);
    expect(run('all', '17', 'La Paz')).toEqual(no);
    expect(run('any', '17', 'La Paz')).toEqual(yes);
    expect(run('any', '3', 'Sucre')).toEqual(no);
  });

  it('keeps one way out per rule for chatbots saved before', () => {
    expect(run('each', '18', 'Sucre')).toEqual([
      { kind: 'text', text: 'Primera' },
    ]);
    expect(run('each', '3', 'Sucre')).toEqual(no);
    expect(
      parseFlow({
        nodes: [
          start,
          { id: 'c', type: 'condition', position: at(), data: { rules } },
        ],
        edges: [],
      }).nodes[1],
    ).toMatchObject({ data: { match: 'each' } });
  });
});

describe('«Guardar respuesta» without a question', () => {
  const flow = flowOf({
    nodes: [
      start,
      say('ask', 'Escribe tu cédula', {
        data: { text: 'Escribe tu cédula', wait: true },
      }),
      {
        id: 'save',
        type: 'question',
        trigger: '*',
        position: at(),
        data: { text: '', variable: 'cedula', validation: 'number' },
      },
      say('thanks', 'Gracias, {{cedula}}'),
    ],
    edges: [edge('start', 'ask'), edge('ask', 'save'), edge('save', 'thanks')],
  });
  const waiting = { nodeId: 'ask', vars: {}, attempts: 0 };

  it('saves the message that opened the card', () => {
    const result = advance(
      flow,
      waiting,
      { text: '1234567', replyId: null },
      context,
    );
    expect(sent(result.actions)).toEqual([
      { kind: 'text', text: 'Gracias, 1234567' },
    ]);
    expect(errors(flow)).toEqual([]);
  });

  it('asks again on the card when the answer does not fit', () => {
    const bad = advance(
      flow,
      waiting,
      { text: 'no tengo', replyId: null },
      context,
    );
    expect(sent(bad.actions)).toEqual([
      { kind: 'text', text: DEFAULT_INVALID_ANSWER },
    ]);
    expect(bad.session).toMatchObject({ nodeId: 'save' });
    const retry = advance(
      flow,
      bad.session,
      { text: '765', replyId: null },
      context,
    );
    expect(sent(retry.actions)).toEqual([
      { kind: 'text', text: 'Gracias, 765' },
    ]);
  });
});

describe('«Actualizar campo de contacto»', () => {
  const flow = flowOf({
    nodes: [
      start,
      {
        id: 'field',
        type: 'contact_field',
        position: at(),
        data: { field: 'nacimiento', source: 'answer' },
      },
      say('ok', 'Guardado'),
      say('fail', 'Fecha inválida'),
    ],
    edges: [
      edge('start', 'field'),
      edge('field', 'ok', 'ok'),
      edge('field', 'fail', 'fail'),
    ],
  });
  const withFields: EngineContext = {
    ...context,
    contactFields: [
      { key: 'nacimiento', label: 'Nacimiento', type: 'DATE', options: [] },
    ],
  };
  const answer = (text: string, ctx = withFields) =>
    advance(flow, null, { text, replyId: null }, ctx).actions;

  it('updates the field when the value fits', () => {
    expect(answer('31/12/1990')).toEqual([
      { kind: 'contact', field: 'nacimiento', value: '1990-12-31' },
      { kind: 'send', message: { kind: 'text', text: 'Guardado' } },
    ]);
  });

  it('goes down «Campo no actualizado» when it does not, or the field is gone', () => {
    const failed = [
      { kind: 'send', message: { kind: 'text', text: 'Fecha inválida' } },
    ];
    expect(answer('mañana')).toEqual(failed);
    expect(answer('31/12/1990', context)).toEqual(failed);
  });

  it('reads custom fields as {{campo_<key>}}', () => {
    expect(
      interpolate(
        'Naciste el {{campo_nacimiento}}',
        {},
        { ...context.contact, fields: { nacimiento: '1990-12-31' } },
      ),
    ).toBe('Naciste el 1990-12-31');
  });
});

describe('«Consulta API»', () => {
  const flow = flowOf({
    nodes: [
      start,
      {
        id: 'api',
        type: 'api',
        position: at(),
        data: {
          method: 'GET',
          url: 'https://api.example.com/saldo?tel={{telefono}}',
          responses: [{ path: 'data.saldo', variable: 'saldo' }],
        },
      },
      say('ok', 'Tu saldo es {{saldo}}'),
      say('error', 'No pudimos consultar'),
    ],
    edges: [
      edge('start', 'api'),
      edge('api', 'ok', 'ok'),
      edge('api', 'error', 'error'),
    ],
  });

  it('stops with the request, then goes on with its answer', () => {
    const first = advance(flow, null, hello, context);
    expect(first.actions).toEqual([]);
    expect(first.session).toMatchObject({ nodeId: 'api' });
    expect(first.request).toEqual({
      method: 'GET',
      url: 'https://api.example.com/saldo?tel=%2B59170000001',
      headers: {},
      body: null,
    });
    const ok = advance(
      flow,
      first.session,
      {
        ...hello,
        response: { ok: true, status: 200, body: { data: { saldo: 50 } } },
      },
      context,
    );
    expect(sent(ok.actions)).toEqual([
      { kind: 'text', text: 'Tu saldo es 50' },
    ]);
    expect(ok.request).toBeUndefined();
    const failed = advance(
      flow,
      first.session,
      { ...hello, response: { ok: false, status: 500, body: null } },
      context,
    );
    expect(sent(failed.actions)).toEqual([
      { kind: 'text', text: 'No pudimos consultar' },
    ]);
  });

  it('only takes https addresses', () => {
    const http = flowOf({
      nodes: [
        start,
        {
          id: 'api',
          type: 'api',
          position: at(),
          data: { url: 'http://x.com' },
        },
      ],
      edges: [edge('start', 'api')],
    });
    expect(errors(http)).toContainEqual(
      expect.objectContaining({ nodeId: 'api' }),
    );
  });

  it('stops a turn that calls too many times', async () => {
    const loop = flowOf({
      nodes: [
        start,
        {
          id: 'api',
          type: 'api',
          position: at(),
          data: {
            url: 'https://api.example.com/x',
            responses: [{ path: 'n', variable: 'n' }],
          },
        },
        say('count', 'n={{n}}'),
      ],
      edges: [
        edge('start', 'api'),
        edge('api', 'count', 'ok'),
        edge('count', 'api'),
      ],
    });
    let calls = 0;
    const result = await runTurn(loop, null, hello, context, () =>
      Promise.resolve({ ok: true, status: 200, body: { n: ++calls } }),
    );
    expect(calls).toBe(5);
    expect(result.session).toBeNull();
    expect(sent(result.actions)).toHaveLength(5);
  });
});

describe('location, contact cards, transfer note and «Desactivar bot»', () => {
  it('sends the location and the cards, and leaves a note for the agent', () => {
    const flow = flowOf({
      nodes: [
        start,
        {
          id: 'map',
          type: 'location',
          position: at(),
          data: {
            latitude: -16.5,
            longitude: -68.15,
            name: 'Oficina',
            address: 'Av. Arce',
          },
        },
        {
          id: 'card',
          type: 'contact_card',
          position: at(),
          data: { contacts: [{ name: 'Soporte', phone: '+59170000009' }] },
        },
        {
          id: 'agent',
          type: 'transfer',
          position: at(),
          data: { to: 'unassigned', note: 'Pidió hablar con {{nombre}}' },
        },
      ],
      edges: [edge('start', 'map'), edge('map', 'card'), edge('card', 'agent')],
    });
    expect(errors(flow)).toEqual([]);
    expect(advance(flow, null, hello, context).actions).toEqual([
      {
        kind: 'send',
        message: {
          kind: 'location',
          location: {
            latitude: -16.5,
            longitude: -68.15,
            name: 'Oficina',
            address: 'Av. Arce',
          },
        },
      },
      {
        kind: 'send',
        message: {
          kind: 'contacts',
          contacts: [{ name: 'Soporte', phone: '+59170000009' }],
        },
      },
      expect.objectContaining({
        kind: 'transfer',
        to: 'unassigned',
        note: 'Pidió hablar con Lucía',
      }),
    ]);
  });

  it('turns the chatbot off for the chat and ends the flow', () => {
    const flow = flowOf({
      nodes: [
        start,
        {
          id: 'st',
          type: 'status',
          position: at(),
          data: { status: 'ON_HOLD', bot: 'pause' },
        },
      ],
      edges: [edge('start', 'st')],
    });
    expect(advance(flow, null, hello, context)).toEqual({
      actions: [{ kind: 'status', status: 'ON_HOLD' }, { kind: 'pause' }],
      session: null,
    });
  });
});
