import {
  advance,
  DEFAULT_INVALID_TEXT,
  interpolate,
  MAX_ATTEMPTS,
  optionReplyId,
  type EngineContext,
} from './flow-engine';
import {
  flowIssues,
  FlowFormatError,
  parseFlow,
  starterFlow,
  type Flow,
  type FlowNode,
} from './flow';
import { scheduleProblem, withinSchedule } from './schedule';

const at = (x = 0, y = 0) => ({ x, y });
const context: EngineContext = {
  now: new Date('2026-10-23T15:00:00Z'), // Friday 11:00 in La Paz (UTC-4)
  contact: { name: 'Lucía', phone: '+59170000001' },
};
const edge = (source: string, target: string, sourceHandle = 'next') => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

/** Start → greeting → menu (Ventas / Soporte) → tag + transfer, or a question. */
function menuFlow(extra: Partial<Flow> = {}): Flow {
  const nodes: FlowNode[] = [
    { id: 'start', type: 'start', position: at(), data: {} },
    {
      id: 'hello',
      type: 'message',
      position: at(),
      data: { text: 'Hola {{nombre}}', media: null },
    },
    {
      id: 'menu',
      type: 'buttons',
      position: at(),
      data: {
        header: '',
        body: '¿Qué necesitas?',
        footer: '',
        buttons: [
          { id: 'sales', title: 'Ventas' },
          { id: 'help', title: 'Soporte' },
        ],
        invalidText: '',
      },
    },
    {
      id: 'tag',
      type: 'tags',
      position: at(),
      data: { add: ['6716f0c2a1b2c3d4e5f60718'], remove: [] },
    },
    {
      id: 'agent',
      type: 'transfer',
      position: at(),
      data: {
        to: 'auto',
        membershipId: null,
        message: 'Hola {{nombre}}, te atiende {{agente}}.',
      },
    },
    {
      id: 'ask',
      type: 'question',
      position: at(),
      data: {
        text: '¿Cuál es tu correo?',
        variable: 'correo',
        validation: 'email',
        invalidText: 'Ese correo no parece válido',
      },
    },
    {
      id: 'thanks',
      type: 'message',
      position: at(),
      data: { text: 'Gracias, te escribiremos a {{correo}}', media: null },
    },
    ...(extra.nodes ?? []),
  ];
  return {
    nodes,
    edges: [
      edge('start', 'hello'),
      edge('hello', 'menu'),
      edge('menu', 'tag', 'sales'),
      edge('tag', 'agent'),
      edge('menu', 'ask', 'help'),
      edge('ask', 'thanks'),
      ...(extra.edges ?? []),
    ],
  };
}

describe('chatbot flow engine', () => {
  it('greets with the contact name and waits on the buttons', () => {
    const result = advance(
      menuFlow(),
      null,
      { text: 'hola', replyId: null },
      context,
    );

    expect(result.actions).toEqual([
      { kind: 'send', message: { kind: 'text', text: 'Hola Lucía' } },
      {
        kind: 'send',
        message: {
          kind: 'interactive',
          content: {
            kind: 'buttons',
            header: null,
            body: '¿Qué necesitas?',
            footer: null,
            buttons: [
              { id: 'menu:sales', title: 'Ventas' },
              { id: 'menu:help', title: 'Soporte' },
            ],
          },
        },
      },
    ]);
    expect(result.session).toEqual({ nodeId: 'menu', vars: {}, attempts: 0 });
  });

  it('follows the button the customer tapped: tags and hands over the chat', () => {
    const session = { nodeId: 'menu', vars: {}, attempts: 0 };
    const result = advance(
      menuFlow(),
      session,
      { text: 'Ventas', replyId: optionReplyId('menu', 'sales') },
      context,
    );

    expect(result.actions).toEqual([
      { kind: 'tags', add: ['6716f0c2a1b2c3d4e5f60718'], remove: [] },
      {
        kind: 'transfer',
        to: 'auto',
        membershipId: null,
        message: 'Hola Lucía, te atiende {{agente}}.',
      },
    ]);
    expect(result.session).toBeNull();
  });

  it('also understands the title typed by hand or the number of the option', () => {
    const session = { nodeId: 'menu', vars: {}, attempts: 0 };
    const typed = advance(
      menuFlow(),
      session,
      { text: ' soporte ', replyId: null },
      context,
    );
    expect(typed.session?.nodeId).toBe('ask');
    const numbered = advance(
      menuFlow(),
      session,
      { text: '2', replyId: null },
      context,
    );
    expect(numbered.session?.nodeId).toBe('ask');
  });

  it('asks again when the answer matches no option, and gives up after a few tries', () => {
    let session = { nodeId: 'menu', vars: {}, attempts: 0 };
    const first = advance(
      menuFlow(),
      session,
      { text: 'precio?', replyId: null },
      context,
    );
    expect(first.actions[0]).toEqual({
      kind: 'send',
      message: { kind: 'text', text: DEFAULT_INVALID_TEXT },
    });
    expect(first.actions[1]).toMatchObject({
      message: { kind: 'interactive', content: { kind: 'buttons' } },
    });
    session = first.session as typeof session;
    expect(session.attempts).toBe(1);

    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) {
      session = advance(
        menuFlow(),
        session,
        { text: 'x', replyId: null },
        context,
      ).session as typeof session;
    }
    const last = advance(
      menuFlow(),
      session,
      { text: 'x', replyId: null },
      context,
    );
    expect(last).toEqual({ actions: [], session: null });
  });

  it('takes the "otra respuesta" branch when it is connected', () => {
    const flow = menuFlow({
      nodes: [
        {
          id: 'sorry',
          type: 'message',
          position: at(),
          data: { text: 'Un agente te ayudará', media: null },
        },
      ],
      edges: [edge('menu', 'sorry', 'other')],
    });
    const result = advance(
      flow,
      { nodeId: 'menu', vars: {}, attempts: 0 },
      { text: '???', replyId: null },
      context,
    );
    expect(result.actions).toEqual([
      { kind: 'send', message: { kind: 'text', text: 'Un agente te ayudará' } },
    ]);
    expect(result.session).toBeNull();
  });

  it('saves a valid answer in its variable and uses it later', () => {
    const session = { nodeId: 'ask', vars: {}, attempts: 0 };
    const wrong = advance(
      menuFlow(),
      session,
      { text: 'no tengo', replyId: null },
      context,
    );
    expect(wrong.actions[0]).toEqual({
      kind: 'send',
      message: { kind: 'text', text: 'Ese correo no parece válido' },
    });

    const right = advance(
      menuFlow(),
      session,
      { text: 'lu@example.com', replyId: null },
      context,
    );
    expect(right.actions).toEqual([
      {
        kind: 'send',
        message: {
          kind: 'text',
          text: 'Gracias, te escribiremos a lu@example.com',
        },
      },
    ]);
    expect(right.session).toBeNull();
  });

  it('branches on conditions and opening hours', () => {
    const flow: Flow = {
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'cond',
          type: 'condition',
          position: at(),
          data: {
            rules: [
              {
                id: 'price',
                source: 'message',
                variable: '',
                operator: 'contains',
                value: 'precio',
              },
            ],
          },
        },
        {
          id: 'hours',
          type: 'hours',
          position: at(),
          data: {
            schedule: {
              timezone: 'America/La_Paz',
              days: [{ day: 5, ranges: [{ from: '09:00', to: '18:00' }] }],
            },
          },
        },
        {
          id: 'open',
          type: 'message',
          position: at(),
          data: { text: 'Abiertos', media: null },
        },
        {
          id: 'closed',
          type: 'message',
          position: at(),
          data: { text: 'Cerrados', media: null },
        },
        {
          id: 'list',
          type: 'message',
          position: at(),
          data: { text: 'Lista', media: null },
        },
      ],
      edges: [
        edge('start', 'cond'),
        edge('cond', 'list', 'price'),
        edge('cond', 'hours', 'else'),
        edge('hours', 'open', 'in'),
        edge('hours', 'closed', 'out'),
      ],
    };
    const say = (text: string, now = context.now) =>
      advance(flow, null, { text, replyId: null }, { ...context, now }).actions;

    expect(say('¿Qué PRECIO tiene?')).toEqual([
      { kind: 'send', message: { kind: 'text', text: 'Lista' } },
    ]);
    expect(say('hola')).toEqual([
      { kind: 'send', message: { kind: 'text', text: 'Abiertos' } },
    ]);
    // Saturday: outside the hours.
    expect(say('hola', new Date('2026-10-24T15:00:00Z'))).toEqual([
      { kind: 'send', message: { kind: 'text', text: 'Cerrados' } },
    ]);
  });

  it('stops a flow that loops forever', () => {
    const flow: Flow = {
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'a',
          type: 'message',
          position: at(),
          data: { text: 'a', media: null },
        },
        {
          id: 'b',
          type: 'message',
          position: at(),
          data: { text: 'b', media: null },
        },
      ],
      edges: [edge('start', 'a'), edge('a', 'b'), edge('b', 'a')],
    };
    const result = advance(
      flow,
      null,
      { text: 'hola', replyId: null },
      context,
    );
    expect(result.actions.length).toBeLessThan(25);
    expect(result.session).toBeNull();
  });

  it('closes the chat with the status node and ends there', () => {
    const flow: Flow = {
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'bye',
          type: 'status',
          position: at(),
          data: { status: 'CLOSED' },
        },
      ],
      edges: [edge('start', 'bye')],
    };
    expect(
      advance(flow, null, { text: 'chau', replyId: null }, context),
    ).toEqual({
      actions: [{ kind: 'status', status: 'CLOSED' }],
      session: null,
    });
  });

  it('starts over when the waiting node no longer exists', () => {
    const result = advance(
      menuFlow(),
      { nodeId: 'deleted', vars: {}, attempts: 0 },
      { text: 'hola', replyId: null },
      context,
    );
    expect(result.session?.nodeId).toBe('menu');
  });

  it('shows a list, follows the row chosen, sends a link button and ends', () => {
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'menu',
          type: 'list',
          position: at(),
          data: {
            header: '',
            body: 'Elige, {{nombre}}',
            footer: 'Atención 24/7',
            button: 'Ver menú',
            sections: [
              {
                id: 's1',
                title: 'Opciones',
                rows: [
                  { id: 'buy', title: 'Comprar', description: 'Precios' },
                  { id: 'pay', title: 'Pagar', description: '' },
                ],
              },
            ],
            invalidText: '',
          },
        },
        {
          id: 'link',
          type: 'url',
          position: at(),
          data: {
            header: '',
            body: 'Paga aquí',
            footer: '',
            text: 'Pagar',
            url: 'https://pagos.example.com',
          },
        },
        { id: 'bye', type: 'end', position: at(), data: {} },
      ],
      edges: [
        edge('start', 'menu'),
        edge('menu', 'link', 'pay'),
        edge('link', 'bye'),
      ],
    });

    const first = advance(flow, null, { text: 'hola', replyId: null }, context);
    expect(first.actions).toEqual([
      {
        kind: 'send',
        message: {
          kind: 'interactive',
          content: {
            kind: 'list',
            header: null,
            body: 'Elige, Lucía',
            footer: 'Atención 24/7',
            list: {
              button: 'Ver menú',
              sections: [
                {
                  title: 'Opciones',
                  rows: [
                    {
                      id: optionReplyId('menu', 'buy'),
                      title: 'Comprar',
                      description: 'Precios',
                    },
                    {
                      id: optionReplyId('menu', 'pay'),
                      title: 'Pagar',
                      description: null,
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    ]);
    expect(first.session).toMatchObject({ nodeId: 'menu' });

    const chosen = advance(
      flow,
      first.session,
      { text: 'Pagar', replyId: optionReplyId('menu', 'pay') },
      context,
    );
    expect(chosen.actions).toEqual([
      {
        kind: 'send',
        message: {
          kind: 'interactive',
          content: {
            kind: 'cta_url',
            header: null,
            body: 'Paga aquí',
            footer: null,
            url: { text: 'Pagar', url: 'https://pagos.example.com' },
          },
        },
      },
    ]);
    // "Finalizar": nothing waits for the customer any more.
    expect(chosen.session).toBeNull();

    // A row without a connection ends the flow quietly.
    const loose = advance(
      flow,
      first.session,
      { text: 'Comprar', replyId: optionReplyId('menu', 'buy') },
      context,
    );
    expect(loose).toEqual({ actions: [], session: null });
  });

  it('fills variables, the name and the phone', () => {
    expect(
      interpolate(
        '{{nombre}} ({{telefono}}) quiere {{producto}}{{nada}}',
        { producto: 'TV' },
        context.contact,
      ),
    ).toBe('Lucía (+59170000001) quiere TV');
  });
});

describe('chatbot flow format', () => {
  it('reads the starter flow and finds nothing to fix', () => {
    const flow = parseFlow(JSON.parse(JSON.stringify(starterFlow())));
    expect(flowIssues(flow)).toEqual([]);
  });

  it('refuses shapes the editor never saves', () => {
    const broken = {
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        { id: 'x', type: 'teleport', position: at(), data: {} },
        {
          id: 'menu',
          type: 'buttons',
          position: at(),
          data: {
            body: 'Hola',
            buttons: [
              { id: 'a', title: 'Un texto demasiado largo para WhatsApp' },
              { id: 'b', title: 'B' },
              { id: 'c', title: 'C' },
              { id: 'd', title: 'D' },
            ],
          },
        },
      ],
      edges: [
        { id: 'e', source: 'start', sourceHandle: 'next', target: 'nowhere' },
      ],
    };
    let error: unknown;
    try {
      parseFlow(broken);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FlowFormatError);
    const messages = (error as FlowFormatError).issues.map(
      (issue) => issue.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        'Tipo de nodo desconocido',
        'Botones: máximo 3',
        'Botón: máximo 20 caracteres',
        'Conexión a un nodo que no existe',
      ]),
    );
  });

  it('lists what is missing before the bot can answer', () => {
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'menu',
          type: 'buttons',
          position: at(),
          data: { body: '', buttons: [] },
        },
        {
          id: 'web',
          type: 'url',
          position: at(),
          data: { body: 'Mira', text: 'Ver', url: 'http://x.com' },
        },
      ],
      edges: [],
    });
    const issues = flowIssues(flow);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          nodeId: 'start',
          level: 'error',
          message: 'Conecta el inicio con el primer mensaje',
        },
        { nodeId: 'menu', level: 'error', message: 'Agrega al menos un botón' },
        {
          nodeId: 'web',
          level: 'error',
          message: 'El enlace debe empezar con https://',
        },
        {
          nodeId: 'web',
          level: 'warning',
          message: 'Ningún camino llega a este nodo',
        },
      ]),
    );
  });
});

describe('chatbot schedule', () => {
  const schedule = {
    timezone: 'America/La_Paz',
    days: [
      {
        day: 1,
        ranges: [
          { from: '08:30', to: '12:00' },
          { from: '14:00', to: '24:00' },
        ],
      },
    ],
  };

  it('opens only within its ranges, in its time zone', () => {
    // Monday 2026-10-26 in La Paz (UTC-4).
    expect(withinSchedule(schedule, new Date('2026-10-26T12:29:00Z'))).toBe(
      false,
    );
    expect(withinSchedule(schedule, new Date('2026-10-26T12:30:00Z'))).toBe(
      true,
    );
    expect(withinSchedule(schedule, new Date('2026-10-26T16:00:00Z'))).toBe(
      false,
    );
    expect(withinSchedule(schedule, new Date('2026-10-27T03:59:00Z'))).toBe(
      true,
    );
    expect(withinSchedule(null, new Date())).toBe(true);
  });

  it('explains what is wrong', () => {
    expect(scheduleProblem(schedule)).toBeNull();
    expect(scheduleProblem({ timezone: 'Marte/Base', days: [] })).toBe(
      'Zona horaria inválida',
    );
    expect(
      scheduleProblem({
        timezone: 'UTC',
        days: [{ day: 1, ranges: [{ from: '18:00', to: '09:00' }] }],
      }),
    ).toMatch(/hora menor a una mayor/);
  });
});
