import {
  advance,
  DEFAULT_INVALID_TEXT,
  interpolate,
  nudgeMessage,
  optionReplyId,
  type EngineContext,
  type EngineSession,
} from './flow-engine';
import {
  flowIssues,
  FlowFormatError,
  parseFlow,
  starterFlow,
  type Flow,
} from './flow';
import { isBotPaused, pauseEnd } from '../../inbox/domain/bot-pause';
import { scheduleProblem, withinSchedule } from './schedule';
import { booleanValue, contactValues, parseVariables } from './variables';

const at = (x = 0, y = 0) => ({ x, y });
/** A flow as the editor saves it, read like the API does (older shapes too). */
const flowOf = (raw: { nodes: unknown[]; edges: unknown[] }): Flow =>
  parseFlow(raw);
const context: EngineContext = {
  now: new Date('2026-10-23T15:00:00Z'), // Friday 11:00 in La Paz (UTC-4)
  contact: { name: 'Lucía', phone: '+59170000001', email: null },
};
const settings = {
  fallbackText: 'Mensaje inválido. Escribe menu para volver al inicio.',
  restartKeywords: ['menu', 'inicio'],
};
const photo = (name: string) => ({
  fileId: '6716f0c2a1b2c3d4e5f6071' + name,
  type: 'image' as const,
  mimeType: 'image/jpeg',
  filename: `${name}.jpg`,
  size: 10,
});
/** The chatbot's own buttons after an answer it cannot take. */
const sorry = (text: string, buttons: [string, string][]) => ({
  kind: 'send',
  message: {
    kind: 'interactive',
    content: {
      kind: 'buttons',
      header: null,
      body: text,
      footer: null,
      buttons: buttons.map(([id, title]) => ({ id, title })),
    },
  },
});
const SEE_MENU: [string, string] = ['menu:@menu', 'Ver menú'];
const FROM_START: [string, string] = ['start:@start', 'Volver al inicio'];
const edge = (source: string, target: string, sourceHandle = 'next') => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

/** Start → greeting → menu (Ventas / Soporte) → tag + transfer, or a question. */
function menuFlow(
  extra: { nodes?: unknown[]; edges?: Flow['edges'] } = {},
): Flow {
  const nodes: unknown[] = [
    { id: 'start', type: 'start', title: '', position: at(), data: {} },
    {
      id: 'hello',
      type: 'message',
      title: '',
      position: at(),
      data: { text: 'Hola {{nombre}}', attachments: [] },
    },
    {
      id: 'menu',
      type: 'buttons',
      title: '',
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
        attachments: [],
      },
    },
    {
      id: 'tag',
      type: 'tags',
      title: '',
      position: at(),
      data: { add: ['6716f0c2a1b2c3d4e5f60718'], remove: [] },
    },
    {
      id: 'agent',
      type: 'transfer',
      title: '',
      position: at(),
      data: {
        to: 'auto',
        membershipId: null,
        message: 'Hola {{nombre}}, te atiende {{agente}}.',
        pause: '24h',
      },
    },
    {
      id: 'ask',
      type: 'question',
      title: '',
      position: at(),
      data: {
        text: '¿Cuál es tu correo?',
        variable: 'correo',
        validation: 'email',
        invalidText: 'Ese correo no parece válido',
        saveTo: 'none',
      },
    },
    {
      id: 'thanks',
      type: 'message',
      title: '',
      position: at(),
      data: { text: 'Gracias, te escribiremos a {{correo}}', attachments: [] },
    },
    ...(extra.nodes ?? []),
  ];
  return flowOf({
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
  });
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
        pause: '24h',
        note: null,
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

  it('answers an unknown option with a "Ver menú" button, every time, without repeating the menu', () => {
    let session = { nodeId: 'menu', vars: {}, attempts: 0 };
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = advance(
        menuFlow(),
        session,
        { text: 'precio?', replyId: null },
        context,
      );
      // The first menu of the flow: "Volver al inicio" would show the same.
      expect(result.actions).toEqual([sorry(DEFAULT_INVALID_TEXT, [SEE_MENU])]);
      session = result.session as typeof session;
      expect(session).toEqual({ nodeId: 'menu', vars: {}, attempts: attempt });
    }

    const again = advance(
      menuFlow(),
      session,
      { text: 'Ver menú', replyId: 'menu:@menu' },
      context,
    );
    expect(again.actions).toHaveLength(1);
    expect(again.actions[0]).toMatchObject({
      message: { content: { kind: 'buttons', body: '¿Qué necesitas?' } },
    });
    expect(again.session).toEqual({ nodeId: 'menu', vars: {}, attempts: 0 });
  });

  it('offers "Volver al inicio" from a menu further down the flow', () => {
    const flow = menuFlow({
      nodes: [
        {
          id: 'plans',
          type: 'buttons',
          title: '',
          position: at(),
          data: {
            header: '',
            body: '¿Qué plan?',
            footer: '',
            buttons: [{ id: 'basic', title: 'Básico' }],
            invalidText: 'Toca un plan',
            attachments: [],
          },
        },
      ],
    });
    flow.edges = flow.edges.map((item) =>
      item.sourceHandle === 'sales' ? edge('menu', 'plans', 'sales') : item,
    );
    const session = { nodeId: 'plans', vars: { a: '1' }, attempts: 0 };
    const wrong = advance(
      flow,
      session,
      { text: 'hola', replyId: null },
      context,
    );
    expect(wrong.actions).toEqual([
      sorry('Toca un plan', [['plans:@menu', 'Ver menú'], FROM_START]),
    ]);

    const home = advance(
      flow,
      wrong.session,
      { text: 'Volver al inicio', replyId: 'start:@start' },
      context,
    );
    expect(home.actions[0]).toEqual({
      kind: 'send',
      message: { kind: 'text', text: 'Hola Lucía' },
    });
    // Back at the greeting, with the variables of a new conversation.
    expect(home.session).toEqual({ nodeId: 'menu', vars: {}, attempts: 0 });
  });

  it('follows an option tapped in an older menu, even after the flow ended', () => {
    for (const session of <(EngineSession | null)[]>[
      { nodeId: null, vars: { correo: 'a@b.co' }, attempts: 0 },
      { nodeId: 'ask', vars: {}, attempts: 2 },
      null,
    ]) {
      const result = advance(
        menuFlow(),
        session,
        { text: 'Ventas', replyId: optionReplyId('menu', 'sales') },
        { ...context, settings },
      );
      expect(result.actions.map((action) => action.kind)).toEqual([
        'tags',
        'transfer',
      ]);
      expect(result.session).toBeNull();
    }
    // An option of another chatbot (or a node since deleted) is just text.
    const unknown = advance(
      menuFlow(),
      { nodeId: 'menu', vars: {}, attempts: 0 },
      { text: 'Ventas', replyId: 'gone:sales' },
      context,
    );
    expect(unknown.actions[0]).toMatchObject({ kind: 'tags' });
  });

  it('drops the old "otra respuesta" connections of menus', () => {
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'menu',
          type: 'buttons',
          position: at(),
          data: {
            body: '¿Qué necesitas?',
            buttons: [{ id: 'sales', title: 'Ventas' }],
          },
        },
        {
          id: 'thanks',
          type: 'message',
          position: at(),
          data: { text: 'Gracias' },
        },
      ],
      edges: [
        edge('start', 'menu'),
        edge('menu', 'thanks', 'sales'),
        edge('menu', 'thanks', 'other'),
      ],
    });
    expect(flow.edges.some((item) => item.sourceHandle === 'other')).toBe(
      false,
    );
    const result = advance(
      flow,
      { nodeId: 'menu', vars: {}, attempts: 0 },
      { text: '???', replyId: null },
      context,
    );
    expect(result.actions).toEqual([sorry(DEFAULT_INVALID_TEXT, [SEE_MENU])]);
  });

  it('nudges with a button that shows the waiting node again', () => {
    expect(nudgeMessage('¿Seguimos?', 'menu')).toEqual(
      sorry('¿Seguimos?', [['menu:@menu', 'Continuar']]).message,
    );
    const shown = advance(
      menuFlow(),
      { nodeId: 'ask', vars: {}, attempts: 0 },
      { text: 'Continuar', replyId: 'ask:@menu' },
      context,
    );
    expect(shown.actions).toEqual([
      { kind: 'send', message: { kind: 'text', text: '¿Cuál es tu correo?' } },
    ]);
  });

  it('asks a first question again when the answer is not valid', () => {
    const flow = menuFlow();
    flow.edges = flow.edges.map((item) =>
      item.source === 'hello' ? edge('hello', 'ask') : item,
    );
    const result = advance(
      flow,
      { nodeId: 'ask', vars: {}, attempts: 0 },
      { text: 'no sé', replyId: null },
      context,
    );
    expect(result.actions).toEqual([
      {
        kind: 'send',
        message: { kind: 'text', text: 'Ese correo no parece válido' },
      },
      { kind: 'send', message: { kind: 'text', text: '¿Cuál es tu correo?' } },
    ]);
  });

  it('saves a valid answer in its variable and uses it later', () => {
    const session = { nodeId: 'ask', vars: {}, attempts: 0 };
    const wrong = advance(
      menuFlow(),
      session,
      { text: 'no tengo', replyId: null },
      context,
    );
    // Further down the flow: no menu to show again, only the beginning.
    expect(wrong.actions).toEqual([
      sorry('Ese correo no parece válido', [FROM_START]),
    ]);

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
    expect(right.session).toEqual({
      nodeId: null,
      vars: { correo: 'lu@example.com' },
      attempts: 0,
    });
  });

  it('branches on conditions and opening hours', () => {
    const flow = flowOf({
      nodes: [
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        {
          id: 'cond',
          type: 'condition',
          title: '',
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
          title: '',
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
          title: '',
          position: at(),
          data: { text: 'Abiertos', attachments: [] },
        },
        {
          id: 'closed',
          type: 'message',
          title: '',
          position: at(),
          data: { text: 'Cerrados', attachments: [] },
        },
        {
          id: 'list',
          type: 'message',
          title: '',
          position: at(),
          data: { text: 'Lista', attachments: [] },
        },
      ],
      edges: [
        edge('start', 'cond'),
        edge('cond', 'list', 'price'),
        edge('cond', 'hours', 'else'),
        edge('hours', 'open', 'in'),
        edge('hours', 'closed', 'out'),
      ],
    });
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
    const flow = flowOf({
      nodes: [
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        {
          id: 'a',
          type: 'message',
          title: '',
          position: at(),
          data: { text: 'a', attachments: [] },
        },
        {
          id: 'b',
          type: 'message',
          title: '',
          position: at(),
          data: { text: 'b', attachments: [] },
        },
      ],
      edges: [edge('start', 'a'), edge('a', 'b'), edge('b', 'a')],
    });
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
    const flow = flowOf({
      nodes: [
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        {
          id: 'bye',
          type: 'status',
          title: '',
          position: at(),
          data: { status: 'CLOSED' },
        },
      ],
      edges: [edge('start', 'bye')],
    });
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
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        {
          id: 'menu',
          type: 'list',
          title: '',
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
          title: '',
          position: at(),
          data: {
            header: '',
            body: 'Paga aquí',
            footer: '',
            text: 'Pagar',
            url: 'https://pagos.example.com',
          },
        },
        { id: 'bye', type: 'end', title: '', position: at(), data: {} },
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
                  title: null,
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
    expect(loose).toEqual({
      actions: [],
      session: { nodeId: null, vars: {}, attempts: 0 },
    });
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

  it('answers the fallback text after the end, and "menu" starts again', () => {
    const ended = {
      nodeId: null,
      vars: { correo: 'lu@example.com' },
      attempts: 0,
    };
    const after = advance(
      menuFlow(),
      ended,
      { text: 'gracias', replyId: null },
      { ...context, settings },
    );
    expect(after).toEqual({
      actions: [sorry(settings.fallbackText, [FROM_START])],
      session: ended,
    });

    // From anywhere, even while a menu waits.
    for (const session of [ended, { nodeId: 'ask', vars: {}, attempts: 1 }]) {
      const again = advance(
        menuFlow(),
        session,
        { text: ' Menú ', replyId: null },
        { ...context, settings },
      );
      expect(again.actions[0]).toEqual({
        kind: 'send',
        message: { kind: 'text', text: 'Hola Lucía' },
      });
      expect(again.session).toEqual({ nodeId: 'menu', vars: {}, attempts: 0 });
    }
  });

  it("uses the node's invalid-answer text, or the bot's when it is empty", () => {
    const flow = menuFlow();
    const menu = flow.nodes.find((node) => node.id === 'menu');
    const session = { nodeId: 'menu', vars: {}, attempts: 0 };
    const general = advance(
      flow,
      session,
      { text: 'precio?', replyId: null },
      { ...context, settings },
    );
    expect(general.actions).toEqual([sorry(settings.fallbackText, [SEE_MENU])]);
    if (menu?.type === 'message') menu.data.invalidText = 'Toca un botón 👇';
    const own = advance(
      flow,
      session,
      { text: 'precio?', replyId: null },
      { ...context, settings },
    );
    expect(own.actions).toEqual([sorry('Toca un botón 👇', [SEE_MENU])]);
  });

  it('sends the files of a node: one takes the text as caption, several go after it', () => {
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'one',
          type: 'message',
          position: at(),
          data: { text: 'Catálogo', attachments: [photo('1')] },
        },
        {
          id: 'many',
          type: 'message',
          position: at(),
          data: { text: 'Sucursales', attachments: [photo('2'), photo('3')] },
        },
        {
          id: 'menu',
          type: 'buttons',
          position: at(),
          data: {
            body: '¿Te gustó?',
            buttons: [{ id: 'yes', title: 'Sí' }],
            invalidText: 'Toca Sí',
            attachments: [photo('4')],
          },
        },
      ],
      edges: [edge('start', 'one'), edge('one', 'many'), edge('many', 'menu')],
    });
    const result = advance(
      flow,
      null,
      { text: 'hola', replyId: null },
      context,
    );
    expect(
      result.actions.map((action) =>
        action.kind === 'send' && action.message.kind === 'media'
          ? `${action.message.media.filename}:${action.message.caption}`
          : action.kind === 'send' && action.message.kind === 'text'
            ? action.message.text
            : action.kind,
      ),
    ).toEqual([
      '1.jpg:Catálogo',
      'Sucursales',
      '2.jpg:null',
      '3.jpg:null',
      'send',
    ]);
    // The only file of a «Respuesta» with buttons goes as their header.
    expect(result.actions.at(-1)).toMatchObject({
      message: {
        kind: 'interactive',
        content: {
          kind: 'buttons',
          header: null,
          headerMedia: { type: 'image', filename: '4.jpg' },
        },
      },
    });
    // A message saved with one file (before several were allowed) keeps it.
    const legacy = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'm',
          type: 'message',
          position: at(),
          data: { text: '', media: photo('5') },
        },
      ],
      edges: [edge('start', 'm')],
    });
    expect(legacy.nodes[1]).toMatchObject({
      title: '',
      data: { attachments: [photo('5')] },
    });
  });

  it('starts with the default values and saves answers by the type of the variable', () => {
    const variables = parseVariables([
      { name: 'cuotas', type: 'number', defaultValue: '0', description: '' },
      { name: 'cliente', type: 'boolean', defaultValue: 'no', description: '' },
    ]);
    if (!('variables' in variables)) throw new Error(variables.problem);
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', position: at(), data: {} },
        {
          id: 'q1',
          type: 'question',
          position: at(),
          data: {
            text: '¿Cuántas cuotas? Llevas {{cuotas}}',
            variable: 'cuotas',
            invalidText: 'Solo números',
          },
        },
        {
          id: 'q2',
          type: 'question',
          position: at(),
          data: {
            text: '¿Ya eres cliente?',
            variable: 'cliente',
            invalidText: 'Responde sí o no',
          },
        },
        {
          id: 'q3',
          type: 'question',
          position: at(),
          data: {
            text: '¿Tu correo?',
            variable: 'correo',
            validation: 'email',
            saveTo: 'email',
          },
        },
        {
          id: 'cond',
          type: 'condition',
          position: at(),
          data: {
            rules: [
              {
                id: 'vip',
                source: 'variable',
                variable: 'cuotas',
                operator: 'greater_than',
                value: '6',
              },
              {
                id: 'old',
                source: 'variable',
                variable: 'cliente',
                operator: 'is_true',
                value: '',
              },
            ],
          },
        },
        {
          id: 'vip',
          type: 'message',
          position: at(),
          data: { text: 'VIP {{apellido}}' },
        },
        {
          id: 'old',
          type: 'message',
          position: at(),
          data: { text: 'Hola de nuevo {{email}}' },
        },
      ],
      edges: [
        edge('start', 'q1'),
        edge('q1', 'q2'),
        edge('q2', 'q3'),
        edge('q3', 'cond'),
        edge('cond', 'vip', 'vip'),
        edge('cond', 'old', 'old'),
      ],
    });
    const ctx = {
      ...context,
      contact: {
        name: 'Lucía Pérez Gómez',
        phone: '+59170000001',
        email: 'lu@example.com',
      },
      variables: variables.variables,
    };
    const first = advance(flow, null, { text: 'hola', replyId: null }, ctx);
    expect(first.actions).toEqual([
      {
        kind: 'send',
        message: { kind: 'text', text: '¿Cuántas cuotas? Llevas 0' },
      },
    ]);
    expect(first.session?.vars).toEqual({ cuotas: '0', cliente: 'false' });

    const notNumber = advance(
      flow,
      first.session,
      { text: 'muchas', replyId: null },
      ctx,
    );
    expect(notNumber.actions[0]).toEqual({
      kind: 'send',
      message: { kind: 'text', text: 'Solo números' },
    });
    const twelve = advance(
      flow,
      first.session,
      { text: '12', replyId: null },
      ctx,
    );
    const yes = advance(
      flow,
      twelve.session,
      { text: 'Sí', replyId: null },
      ctx,
    );
    expect(yes.session?.vars).toEqual({ cuotas: '12', cliente: 'true' });
    const email = advance(
      flow,
      yes.session,
      { text: 'nuevo@example.com', replyId: null },
      ctx,
    );
    expect(email.actions).toEqual([
      { kind: 'contact', field: 'email', value: 'nuevo@example.com' },
      { kind: 'send', message: { kind: 'text', text: 'VIP Pérez Gómez' } },
    ]);
  });
});

describe('chatbot variables', () => {
  it('reads the contact data', () => {
    expect(
      contactValues({ name: '  Ana  María Ruiz ', phone: '+591', email: null }),
    ).toEqual({
      nombre: 'Ana',
      apellido: 'María Ruiz',
      nombre_completo: 'Ana María Ruiz',
      email: '',
      telefono: '+591',
    });
  });

  it('understands yes and no', () => {
    expect(['Sí', 'si!', 'YES', '1'].map(booleanValue)).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(['No', 'falso', '0'].map(booleanValue)).toEqual([
      'false',
      'false',
      'false',
    ]);
    expect(booleanValue('tal vez')).toBeNull();
  });

  it('refuses names already taken, repeated or with spaces, and wrong defaults', () => {
    const problem = (value: unknown) => {
      const parsed = parseVariables(value);
      return 'problem' in parsed ? parsed.problem : null;
    };
    expect(problem([{ name: 'email', type: 'text' }])).toMatch(
      /dato del contacto/,
    );
    expect(
      problem([
        { name: 'a', type: 'text' },
        { name: 'A', type: 'number' },
      ]),
    ).toMatch(/repetida/);
    expect(problem([{ name: 'mi variable', type: 'text' }])).toMatch(
      /sin espacios/,
    );
    expect(
      problem([{ name: 'n', type: 'number', defaultValue: 'diez' }]),
    ).toMatch(/número/);
    expect(
      problem([{ name: 'ok', type: 'boolean', defaultValue: 'quizá' }]),
    ).toMatch(/sí o no/);
    expect(problem([{ name: 'ok', type: 'boolean' }])).toBeNull();
  });
});

describe('chatbot pause in a chat', () => {
  const now = new Date('2026-10-23T15:00:00Z');

  it('lasts 24 hours, or until someone turns it on', () => {
    const day = pauseEnd('24h', now);
    expect(day?.toISOString()).toBe('2026-10-24T15:00:00.000Z');
    expect(pauseEnd('permanent', now)).toBeNull();
    expect(isBotPaused({ paused: true, pausedUntil: day }, now)).toBe(true);
    expect(
      isBotPaused(
        { paused: true, pausedUntil: day },
        new Date('2026-10-24T15:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isBotPaused({ paused: true, pausedUntil: null }, new Date('2030-01-01')),
    ).toBe(true);
    expect(isBotPaused(null, now)).toBe(false);
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
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        { id: 'x', type: 'teleport', title: '', position: at(), data: {} },
        {
          id: 'menu',
          type: 'buttons',
          title: '',
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
        'Botón: máximo 24 caracteres',
        'Conexión a un nodo que no existe',
      ]),
    );
  });

  it('lists what is missing before the bot can answer', () => {
    const flow = parseFlow({
      nodes: [
        { id: 'start', type: 'start', title: '', position: at(), data: {} },
        {
          id: 'menu',
          type: 'message',
          title: '',
          position: at(),
          data: { text: '', options: [{ id: 'a', title: '' }] },
        },
        {
          id: 'web',
          type: 'url',
          title: '',
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
          nodeId: 'menu',
          level: 'error',
          message: 'Escribe el mensaje que acompaña a los botones',
        },
        {
          nodeId: 'start',
          level: 'error',
          message: 'Conecta el inicio con el primer mensaje',
        },
        {
          nodeId: 'menu',
          level: 'error',
          message: 'Cada botón necesita un texto',
        },
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
