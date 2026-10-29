import {
  advance,
  nudgeMessage,
  type BotAction,
  type EngineSession,
} from './flow-engine';
import { flowIssues, parseFlow, type Flow } from './flow';
import type { BotVariable } from './variables';

/**
 * Whole conversations with chatbots shaped like the ones customers build:
 * what the customer writes or taps, and what they read back.
 */

const FRIDAY_11 = new Date('2026-10-23T15:00:00Z'); // 11:00 in La Paz
const SUNDAY_11 = new Date('2026-10-25T15:00:00Z');
const TAG = '6716f0c2a1b2c3d4e5f60718';
const settings = {
  fallbackText: 'Mensaje inválido. Por favor escoge una de las opciones.',
  restartKeywords: ['menu'],
};

const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  trigger = '',
) => ({ id, type, title: '', trigger, position: { x: 0, y: 0 }, data });
let edgeCount = 0;
const link = (source: string, target: string, sourceHandle = 'next') => ({
  id: `e${++edgeCount}`,
  source,
  sourceHandle,
  target,
});

/** What the customer reads (or the system does), one line per action. */
function line(action: BotAction): string {
  if (action.kind !== 'send') {
    switch (action.kind) {
      case 'tags':
        return `[etiquetas +${action.add.length} -${action.remove.length}]`;
      case 'funnel':
        return `[embudo ${action.funnelId.slice(0, 4)} → ${action.stageId.slice(0, 4)}]`;
      case 'transfer':
        return `[transferir: ${action.to}] ${action.message ?? ''}`.trim();
      case 'status':
        return `[estado: ${action.status}]`;
      case 'contact':
        return `[contacto ${action.field}: ${action.value}]`;
      case 'pause':
        return '[bot desactivado]';
    }
  }
  const message = action.message;
  if (message.kind === 'text') return message.text;
  if (message.kind === 'media') return `(archivo) ${message.caption ?? ''}`;
  if (message.kind === 'location')
    return `(ubicación) ${message.location.name ?? ''}`.trim();
  if (message.kind === 'contacts')
    return `(contacto) ${message.contacts.map((card) => card.name).join(', ')}`;
  const content = message.content;
  if (content.kind === 'cta_url')
    return `${content.body} {${content.url?.text} → ${content.url?.url}}`;
  const options =
    content.kind === 'buttons'
      ? (content.buttons ?? [])
      : (content.list?.sections.flatMap((section) => section.rows) ?? []);
  return `${content.body} [${options.map((option) => option.title).join(' | ')}]`;
}

/** A customer talking to a chatbot, with the transcript of what they got. */
function conversation(
  flow: Flow,
  { now = FRIDAY_11, variables = [] as BotVariable[] } = {},
) {
  let session: EngineSession | null = null;
  const contact = {
    name: 'Lucía' as string | null,
    phone: '+59170000002',
    email: null as string | null,
  };
  const received: BotAction[] = [];
  const send = (text: string, replyId: string | null = null) => {
    const result = advance(
      flow,
      session,
      { text, replyId },
      { now, contact, settings, variables },
    );
    session = result.session;
    for (const action of result.actions) {
      if (action.kind === 'contact' && action.field === 'name')
        contact.name = action.value;
      if (action.kind === 'contact' && action.field === 'email')
        contact.email = action.value;
    }
    received.push(...result.actions);
    return result.actions.map(line);
  };
  return {
    send,
    /** Taps an option of the latest message that has it (even an old one). */
    tap(title: string) {
      for (const action of [...received].reverse()) {
        if (action.kind !== 'send' || action.message.kind !== 'interactive')
          continue;
        const content = action.message.content;
        const option = [
          ...(content.buttons ?? []),
          ...(content.list?.sections.flatMap((section) => section.rows) ?? []),
        ].find((candidate) => candidate.title === title);
        if (option) return send(title, option.id);
      }
      throw new Error(`Nothing to tap: ${title}`);
    },
    /** A message the chatbot sends on its own (the inactivity nudge). */
    receive(action: BotAction) {
      received.push(action);
    },
    get session() {
      return session;
    },
    contact,
  };
}

const errorsOf = (flow: Flow, variables: BotVariable[] = []) =>
  flowIssues(flow, variables).filter((issue) => issue.level === 'error');

/** Tienda: a list menu with a catalogue link, hours, an agent and goodbye. */
const shop = () =>
  parseFlow({
    nodes: [
      node('start', 'start'),
      node('hello', 'message', {
        text: '¡Hola {{nombre}}! Soy el asistente de Tienda Sol.',
      }),
      node('menu', 'list', {
        body: '¿En qué te ayudo?',
        button: 'Ver opciones',
        sections: [
          {
            id: 's1',
            title: '',
            rows: [
              { id: 'cat', title: 'Ver catálogo' },
              { id: 'hrs', title: 'Horarios' },
              { id: 'agent', title: 'Hablar con un agente' },
              { id: 'bye', title: 'Cerrar caso' },
            ],
          },
        ],
        invalidText: 'Esa opción no existe 🙈',
      }),
      node('catalogue', 'url', {
        body: 'Mira nuestro catálogo',
        text: 'Abrir',
        url: 'https://tienda.example.com/catalogo',
      }),
      node('hours', 'hours', {
        schedule: {
          timezone: 'America/La_Paz',
          days: [1, 2, 3, 4, 5].map((day) => ({
            day,
            ranges: [{ from: '08:00', to: '18:00' }],
          })),
        },
      }),
      node('open', 'message', { text: 'Estamos abiertos hasta las 18:00.' }),
      node('closed', 'message', {
        text: 'Ahora estamos cerrados. Te atendemos de lunes a viernes.',
      }),
      node('tag', 'tags', { add: [TAG] }),
      node('handover', 'transfer', {
        to: 'auto',
        message: 'Te atiende {{agente}}.',
      }),
      node('thanks', 'message', { text: '¡Gracias por escribirnos!' }),
      node('close', 'status', { status: 'CLOSED' }),
    ],
    edges: [
      link('start', 'hello'),
      link('hello', 'menu'),
      link('menu', 'catalogue', 'cat'),
      link('menu', 'hours', 'hrs'),
      link('hours', 'open', 'in'),
      link('hours', 'closed', 'out'),
      // Back to the menu after telling the hours.
      link('open', 'menu'),
      link('menu', 'tag', 'agent'),
      link('tag', 'handover'),
      link('menu', 'thanks', 'bye'),
      link('thanks', 'close'),
    ],
  });

const MENU =
  '¿En qué te ayudo? [Ver catálogo | Horarios | Hablar con un agente | Cerrar caso]';

/** Registro: name, e-mail and age, then a condition on the age. */
const signUp = () =>
  parseFlow({
    nodes: [
      node('start', 'start'),
      node('name', 'question', {
        text: '¿Cómo te llamas?',
        variable: 'cliente',
        saveTo: 'name',
      }),
      node('email', 'question', {
        text: '¿Cuál es tu correo?',
        variable: 'correo',
        validation: 'email',
        invalidText: 'Ese correo no parece válido',
        saveTo: 'email',
      }),
      node('age', 'question', {
        text: '¿Cuántos años tienes?',
        variable: 'edad',
        invalidText: 'Escribe solo números, por favor',
      }),
      node('adult', 'condition', {
        rules: [
          {
            id: 'r18',
            source: 'variable',
            variable: 'edad',
            operator: 'greater_than',
            value: '17',
          },
        ],
      }),
      node('welcome', 'message', {
        text: 'Gracias {{cliente}}, te escribiremos a {{correo}}.',
      }),
      node('tag', 'tags', { add: [TAG] }),
      node('minor', 'message', { text: 'Necesitas ser mayor de edad.' }),
      node('end', 'end'),
    ],
    edges: [
      link('start', 'name'),
      link('name', 'email'),
      link('email', 'age'),
      link('age', 'adult'),
      link('adult', 'welcome', 'r18'),
      link('adult', 'minor', 'else'),
      link('welcome', 'tag'),
      link('tag', 'end'),
      link('minor', 'end'),
    ],
  });
const signUpVariables: BotVariable[] = [
  { name: 'cliente', type: 'text', defaultValue: '', description: '' },
  { name: 'correo', type: 'text', defaultValue: '', description: '' },
  { name: 'edad', type: 'number', defaultValue: '', description: '' },
];

/** Menús anidados: Ventas opens the plans, Soporte asks for the problem. */
const nested = () =>
  parseFlow({
    nodes: [
      node('start', 'start'),
      node('main', 'buttons', {
        body: 'Hola {{nombre}}, ¿qué necesitas?',
        buttons: [
          { id: 'sales', title: 'Ventas' },
          { id: 'help', title: 'Soporte' },
        ],
        invalidText: 'Toca Ventas o Soporte 👇',
      }),
      node('plans', 'buttons', {
        body: '¿Qué plan te interesa?',
        buttons: [
          { id: 'basic', title: 'Básico' },
          { id: 'pro', title: 'Pro' },
        ],
        invalidText: 'Elige un plan',
      }),
      node('basic', 'message', { text: 'Básico: 10 USD al mes.' }),
      node('pro', 'message', { text: 'Pro: 25 USD al mes.' }),
      node('seller', 'transfer', {
        to: 'unassigned',
        message: 'Un asesor te escribirá pronto.',
        pause: 'permanent',
      }),
      node('problem', 'question', {
        text: 'Cuéntanos qué pasó',
        variable: 'problema',
      }),
      node('noted', 'message', { text: 'Registramos: «{{problema}}».' }),
      node('hold', 'status', { status: 'ON_HOLD' }),
    ],
    edges: [
      link('start', 'main'),
      link('main', 'plans', 'sales'),
      link('plans', 'basic', 'basic'),
      link('plans', 'pro', 'pro'),
      link('basic', 'seller'),
      link('pro', 'seller'),
      link('main', 'problem', 'help'),
      link('problem', 'noted'),
      link('noted', 'hold'),
    ],
  });
const nestedVariables: BotVariable[] = [
  { name: 'problema', type: 'text', defaultValue: '', description: '' },
];

/**
 * Menú de texto: the greeting waits and the cards answer "1", "2", "3"
 * ("Respuesta del usuario"); "precios" opens its card from anywhere.
 */
const textMenu = () =>
  parseFlow({
    nodes: [
      node('start', 'start'),
      node('hello', 'message', {
        text: 'Hola {{nombre}}. Escribe:\n1. Ventas\n2. Soporte\n3. Pagar',
        wait: true,
      }),
      node('sales', 'message', { text: 'Te paso con ventas.' }, '1, ventas'),
      node('seller', 'transfer', { to: 'auto', message: '' }),
      node(
        'help',
        'message',
        { text: 'Escribe "menu" para volver.' },
        '2, soporte',
      ),
      node(
        'pay',
        'url',
        {
          body: 'Paga en línea',
          text: 'Pagar',
          url: 'https://pagos.example.com',
        },
        '3, pagar',
      ),
      // "Enviar mensaje y saltar al siguiente nodo": no waiting after the link.
      node('paid', 'message', { text: 'Avísanos cuando pagues 🙌' }),
      node(
        'prices',
        'message',
        { text: 'Planes desde 10 USD.' },
        'precios, precio',
      ),
    ],
    edges: [
      link('start', 'hello'),
      link('hello', 'sales'),
      link('hello', 'help'),
      link('hello', 'pay'),
      link('sales', 'seller'),
      link('pay', 'paid'),
    ],
  });
const TEXT_MENU = 'Hola Lucía. Escribe:\n1. Ventas\n2. Soporte\n3. Pagar';

describe('chatbot conversations', () => {
  it('builds flows the editor accepts', () => {
    expect(errorsOf(textMenu())).toEqual([]);
    expect(errorsOf(shop())).toEqual([]);
    expect(errorsOf(signUp(), signUpVariables)).toEqual([]);
    expect(errorsOf(nested(), nestedVariables)).toEqual([]);
  });

  it('Tienda: never loops on errors, keeps old menus working and closes on goodbye', () => {
    const chat = conversation(shop());
    expect(chat.send('hola')).toEqual([
      '¡Hola Lucía! Soy el asistente de Tienda Sol.',
      MENU,
    ]);
    // Something that is not an option, twice: the same short answer, no
    // menu flood and no silence.
    for (const text of ['cuánto cuesta?', 'hola??']) {
      expect(chat.send(text)).toEqual(['Esa opción no existe 🙈 [Ver menú]']);
    }
    expect(chat.tap('Ver menú')).toEqual([MENU]);
    // Hours (open on a Friday morning), then back to the menu by itself.
    expect(chat.tap('Horarios')).toEqual([
      'Estamos abiertos hasta las 18:00.',
      MENU,
    ]);
    // The number of the row also chooses it.
    expect(chat.send('1')).toEqual([
      'Mira nuestro catálogo {Abrir → https://tienda.example.com/catalogo}',
    ]);
    expect(chat.session).toEqual({ nodeId: null, vars: {}, attempts: 0 });
    // Nothing expected now: the general message and a way back.
    expect(chat.send('gracias')).toEqual([
      'Mensaje inválido. Por favor escoge una de las opciones. [Volver al inicio]',
    ]);
    // An option of a menu sent before still works.
    expect(chat.tap('Hablar con un agente')).toEqual([
      '[etiquetas +1 -0]',
      '[transferir: auto] Te atiende {{agente}}.',
    ]);
    expect(chat.session).toBeNull();

    const bye = conversation(shop());
    bye.send('buenas');
    expect(bye.send('cerrar caso')).toEqual([
      '¡Gracias por escribirnos!',
      '[estado: CLOSED]',
    ]);
    expect(bye.session).toBeNull();
  });

  it('Tienda: out of hours, then "Volver al inicio" and "menu" start again', () => {
    const chat = conversation(shop(), { now: SUNDAY_11 });
    chat.send('hola');
    expect(chat.tap('Horarios')).toEqual([
      'Ahora estamos cerrados. Te atendemos de lunes a viernes.',
    ]);
    expect(chat.send('ok')).toEqual([
      'Mensaje inválido. Por favor escoge una de las opciones. [Volver al inicio]',
    ]);
    expect(chat.tap('Volver al inicio')).toEqual([
      '¡Hola Lucía! Soy el asistente de Tienda Sol.',
      MENU,
    ]);
    expect(chat.send('Menu')).toEqual([
      '¡Hola Lucía! Soy el asistente de Tienda Sol.',
      MENU,
    ]);
  });

  it('Tienda: the inactivity nudge brings the menu back', () => {
    const chat = conversation(shop());
    chat.send('hola');
    chat.receive({ kind: 'send', message: nudgeMessage('¿Seguimos?', 'menu') });
    expect(chat.tap('Continuar')).toEqual([MENU]);
    expect(chat.session?.nodeId).toBe('menu');
  });

  it('Registro: validates each answer, fills the contact and branches on the age', () => {
    const chat = conversation(signUp(), { variables: signUpVariables });
    expect(chat.send('hola')).toEqual(['¿Cómo te llamas?']);
    expect(chat.send('Lucía Pérez')).toEqual([
      '[contacto name: Lucía Pérez]',
      '¿Cuál es tu correo?',
    ]);
    expect(chat.send('no tengo')).toEqual([
      'Ese correo no parece válido [Volver al inicio]',
    ]);
    expect(chat.send('lucia@example.com')).toEqual([
      '[contacto email: lucia@example.com]',
      '¿Cuántos años tienes?',
    ]);
    expect(chat.send('veinte')).toEqual([
      'Escribe solo números, por favor [Volver al inicio]',
    ]);
    expect(chat.send('20')).toEqual([
      'Gracias Lucía Pérez, te escribiremos a lucia@example.com.',
      '[etiquetas +1 -0]',
    ]);
    expect(chat.session).toBeNull();
    expect(chat.contact).toMatchObject({
      name: 'Lucía Pérez',
      email: 'lucia@example.com',
    });

    const young = conversation(signUp(), { variables: signUpVariables });
    young.send('hola');
    young.send('Ana');
    young.send('ana@example.com');
    expect(young.send('15')).toEqual(['Necesitas ser mayor de edad.']);
  });

  it('Registro: "Volver al inicio" from a question forgets the answers', () => {
    const chat = conversation(signUp(), { variables: signUpVariables });
    chat.send('hola');
    chat.send('Lucía');
    chat.send('???');
    expect(chat.tap('Volver al inicio')).toEqual(['¿Cómo te llamas?']);
    expect(chat.session).toEqual({
      nodeId: 'name',
      vars: { cliente: '', correo: '', edad: '' },
      attempts: 0,
    });
  });

  it('Menús anidados: a submenu offers both ways back, and old buttons still work', () => {
    const chat = conversation(nested(), { variables: nestedVariables });
    expect(chat.send('hola')).toEqual([
      'Hola Lucía, ¿qué necesitas? [Ventas | Soporte]',
    ]);
    expect(chat.send('no sé')).toEqual(['Toca Ventas o Soporte 👇 [Ver menú]']);
    expect(chat.tap('Ventas')).toEqual([
      '¿Qué plan te interesa? [Básico | Pro]',
    ]);
    expect(chat.send('el más barato')).toEqual([
      'Elige un plan [Ver menú | Volver al inicio]',
    ]);
    expect(chat.tap('Ver menú')).toEqual([
      '¿Qué plan te interesa? [Básico | Pro]',
    ]);
    expect(chat.tap('Volver al inicio')).toEqual([
      'Hola Lucía, ¿qué necesitas? [Ventas | Soporte]',
    ]);
    // "Pro" from the plans sent earlier.
    expect(chat.tap('Pro')).toEqual([
      'Pro: 25 USD al mes.',
      '[transferir: unassigned] Un asesor te escribirá pronto.',
    ]);

    const help = conversation(nested(), { variables: nestedVariables });
    help.send('hola');
    expect(help.tap('Soporte')).toEqual(['Cuéntanos qué pasó']);
    expect(help.send('Mi pedido no llegó')).toEqual([
      'Registramos: «Mi pedido no llegó».',
      '[estado: ON_HOLD]',
    ]);
    // The flow ran out after "En espera": the conversation stays open.
    expect(help.session).toEqual({
      nodeId: null,
      vars: { problema: 'Mi pedido no llegó' },
      attempts: 0,
    });
  });

  it('Menú de texto: the words of each card choose it, and nothing hangs', () => {
    const chat = conversation(textMenu());
    expect(chat.send('hola')).toEqual([TEXT_MENU]);
    expect(chat.session?.nodeId).toBe('hello');
    // Not one of the answers: the general message and the menu again on tap.
    expect(chat.send('5')).toEqual([
      'Mensaje inválido. Por favor escoge una de las opciones. [Ver menú]',
    ]);
    expect(chat.tap('Ver menú')).toEqual([TEXT_MENU]);
    // "3." and "Pagar" both work; the link moves on by itself.
    expect(chat.send('3.')).toEqual([
      'Paga en línea {Pagar → https://pagos.example.com}',
      'Avísanos cuando pagues 🙌',
    ]);
    expect(chat.session?.nodeId).toBeNull();
    // Its words open a card nothing connects to, even after the end.
    expect(chat.send('Precio')).toEqual(['Planes desde 10 USD.']);

    const sales = conversation(textMenu());
    sales.send('hola');
    expect(sales.send(' Ventas ')).toEqual([
      'Te paso con ventas.',
      '[transferir: auto]',
    ]);
  });

  it('Menú de texto: a keyword skips the greeting, or leaves a waiting menu', () => {
    const chat = conversation(textMenu());
    expect(chat.send('precios')).toEqual(['Planes desde 10 USD.']);
    chat.send('menu');
    expect(chat.session?.nodeId).toBe('hello');
    expect(chat.send('precios')).toEqual(['Planes desde 10 USD.']);
  });

  it('asks for the words of the cards a waiting message opens', () => {
    const issues = (flow: Flow) => errorsOf(flow).map((issue) => issue.message);
    const alone = textMenu();
    alone.edges = alone.edges.filter((edge) => edge.source !== 'hello');
    expect(issues(alone)).toContain(
      'Conecta las tarjetas que responden o marca «Enviar mensaje y saltar al siguiente nodo»',
    );
    const silent = textMenu();
    silent.nodes = silent.nodes.map((item) =>
      item.id === 'help' ? { ...item, trigger: '' } : item,
    );
    expect(issues(silent)).toEqual([
      'Cada tarjeta conectada necesita su «Respuesta del usuario»',
    ]);
    const twice = textMenu();
    twice.nodes = twice.nodes.map((item) =>
      item.id === 'help' ? { ...item, trigger: 'soporte, 1' } : item,
    );
    expect(issues(twice)).toEqual([
      'Las respuestas del usuario de las tarjetas conectadas se repiten',
    ]);
    // Only a message that waits may connect "Siguiente" to several cards.
    const raw = textMenu();
    const moving = raw.nodes.find((item) => item.id === 'hello');
    if (moving?.type === 'message') moving.data.wait = false;
    expect(() => parseFlow(raw)).toThrow();
    // A card opened by its words is not "unreachable".
    expect(
      flowIssues(textMenu()).filter((issue) => issue.nodeId === 'prices'),
    ).toEqual([]);
  });

  it('Embudo: puts the contact in the stage and goes on to the next card', () => {
    const FUNNEL = '0199a0b0-0000-7000-8000-000000000001';
    const STAGE = '0199a0b0-0000-7000-8000-000000000002';
    const flow = parseFlow({
      nodes: [
        node('start', 'start'),
        node('lead', 'funnel', { funnelId: FUNNEL, stageId: STAGE }),
        node('hello', 'message', { text: 'Ya te atendemos.' }),
      ],
      edges: [link('start', 'lead'), link('lead', 'hello')],
    });
    expect(errorsOf(flow)).toEqual([]);
    expect(conversation(flow).send('hola')).toEqual([
      '[embudo 0199 → 0199]',
      'Ya te atendemos.',
    ]);

    // Without a funnel or a stage, the editor asks for them.
    const empty = parseFlow({
      nodes: [
        node('start', 'start'),
        node('lead', 'funnel', { funnelId: FUNNEL, stageId: 'nope' }),
      ],
      edges: [link('start', 'lead')],
    });
    expect(errorsOf(empty).map((issue) => issue.message)).toEqual([
      'Elige el embudo y la etapa',
    ]);
  });
});
