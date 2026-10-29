import { INTERACTIVE_LIMITS as LIMITS } from '../../channels/domain/interactive';
import { normalizePhone } from '../../contacts/domain/phone';
import { BOT_PAUSES, type BotPause } from '../../inbox/domain/bot-pause';
import { scheduleProblem, type Schedule } from './schedule';
import {
  CONTACT_VARIABLES,
  VARIABLE_NAME as VARIABLE,
  type BotVariable,
} from './variables';

/**
 * The flow of a chatbot as the editor saves it: nodes (with their position
 * on the canvas) and edges. Each edge leaves a node through a handle: the
 * option chosen, the branch of a condition, or "next".
 */
export const NODE_KINDS = [
  'start',
  'message',
  'url',
  'question',
  'location',
  'contact_card',
  'condition',
  'hours',
  'tags',
  'funnel',
  'contact_field',
  'api',
  'transfer',
  'status',
  'end',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Cards of older flows, read as a «Respuesta» with its options: reply
 * buttons and lists are now the options of the message itself.
 */
const LEGACY_MENUS: readonly string[] = ['buttons', 'list'];

/** Options of a «Respuesta»: up to 3 go as buttons, 4 to 10 as a list. */
export const MAX_OPTIONS = 10;
/** «Aceptar cualquier mensaje»: the "Respuesta del usuario" that takes any text. */
export const ANY_MESSAGE = '*';

export const MAX_NODES = 200;

/** What the customer reads when the chatbot hands the chat over. */
export const DEFAULT_TRANSFER_TEXT =
  'Te comunicamos con {{agente}}. En breve te atenderá.';
export const MAX_EDGES = 400;
/** Files a node sends (each one is its own WhatsApp message). */
export const MAX_ATTACHMENTS = 5;
/** Name of a card in the diagram, only for whoever builds the flow. */
export const MAX_TITLE = 60;
/** "Respuesta del usuario": words that open a card, separated by commas. */
export const MAX_TRIGGER = 100;

/** A file uploaded for the chatbot (GridFS), sent with a message node. */
export interface BotMedia {
  fileId: string;
  type: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  filename: string;
  size: number;
}

export interface FlowOption {
  id: string;
  title: string;
}

/** An option of a «Respuesta»; the description only shows in a list. */
export interface FlowReplyOption extends FlowOption {
  description: string;
}

export const VALIDATIONS = ['any', 'number', 'email', 'phone'] as const;
export const OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'is_number',
  'is_not_number',
  'is_empty',
  'is_not_empty',
  'greater_than',
  'gte',
  'less_than',
  'lte',
  'in',
  'not_in',
  'is_true',
  'is_false',
] as const;
export type Operator = (typeof OPERATORS)[number];
/** Operators that compare with a value («Valor de comparación»). */
export const VALUE_OPERATORS: readonly Operator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'greater_than',
  'gte',
  'less_than',
  'lte',
  'in',
  'not_in',
];
/**
 * «Cumplimiento de condiciones»: all of them or any of them (ways out
 * «Cumple» / «No cumple»), or one way out per condition (older flows).
 */
export const CONDITION_MATCHES = ['all', 'any', 'each'] as const;
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const API_AUTH = ['none', 'bearer', 'basic', 'headers'] as const;
/** Limits of «Consulta API». */
export const API_LIMITS = {
  url: 2000,
  headers: 20,
  params: 30,
  responses: 20,
  key: 100,
  value: 1000,
  path: 200,
} as const;
/** Contact cards a «Enviar contacto» sends at most. */
export const MAX_CONTACT_CARDS = 5;
/** Variables of the contact's custom fields: {{campo_<key>}}. */
export const FIELD_VARIABLE = /^campo_[a-z0-9_]{1,40}$/;
/** Contact fields "Guardar respuesta" can also update. */
export const CONTACT_FIELDS = ['none', 'name', 'email'] as const;

export interface ConditionRule {
  id: string;
  /** message: the customer's last message; variable: a saved answer. */
  source: 'message' | 'variable';
  variable: string;
  operator: Operator;
  value: string;
}

/** Optional texts are '' when empty, so the editor's forms stay simple. */
export interface NodeData {
  start: Record<string, never>;
  /**
   * «Respuesta». Without options, files go after the text and a single file
   * takes the text as its caption. wait: instead of "Enviar mensaje y saltar
   * al siguiente nodo", waits for the customer and follows the connected
   * card whose "Respuesta del usuario" matches (a menu written as text).
   *
   * With options («Botones interactivos») it waits for one: up to 3 short
   * ones are reply buttons (one image, video or document goes as their
   * header); more, longer than 20 characters or with a description, a list
   * opened by `listButton`. One way out per option.
   */
  message: {
    text: string;
    attachments: BotMedia[];
    wait?: boolean;
    options: FlowReplyOption[];
    listButton: string;
    header: string;
    footer: string;
    /** Said when the answer matches no option ('' the bot's fallback text). */
    invalidText: string;
  };
  url: {
    header: string;
    body: string;
    footer: string;
    text: string;
    url: string;
    /** Like message: waits for an answer that opens a connected card. */
    wait?: boolean;
    /** An image, video or document shown above the text. */
    attachment: BotMedia | null;
  };
  /** «Enviar ubicación»: a point on the map. */
  location: {
    latitude: number | null;
    longitude: number | null;
    name: string;
    address: string;
  };
  /** «Enviar contacto»: cards the customer can save or write to. */
  contact_card: { contacts: { name: string; phone: string }[] };
  /**
   * «Actualizar campo de contacto»: name, email or a custom field (its key),
   * from the customer's last message (answer) or a text with variables.
   * Ways out: ok («Campo actualizado») and fail («Campo no actualizado»).
   */
  contact_field: {
    field: string;
    source: 'answer' | 'manual';
    value: string;
  };
  /**
   * «Consulta API»: calls an external HTTPS service; `responses` save values
   * of its JSON answer in variables. Ways out: ok and error.
   */
  api: {
    method: (typeof HTTP_METHODS)[number];
    url: string;
    auth: {
      type: (typeof API_AUTH)[number];
      token: string;
      user: string;
      password: string;
    };
    headers: { key: string; value: string }[];
    /** Query string of a GET, JSON body of the other methods. */
    params: { key: string; value: string }[];
    responses: { path: string; variable: string }[];
  };
  question: {
    text: string;
    variable: string;
    validation: (typeof VALIDATIONS)[number];
    invalidText: string;
    /** Also saves the answer in the contact (name or email). */
    saveTo: (typeof CONTACT_FIELDS)[number];
  };
  condition: {
    match: (typeof CONDITION_MATCHES)[number];
    rules: ConditionRule[];
  };
  hours: { schedule: Schedule };
  tags: { add: string[]; remove: string[] };
  /** «Establecer contacto en embudo»: puts the contact in that stage. */
  funnel: { funnelId: string; stageId: string };
  transfer: {
    /** auto: in turns among the line's agents; unassigned: the queue. */
    to: 'auto' | 'unassigned' | 'member';
    membershipId: string | null;
    /** Told to the customer after the handover ({{agente}}: who got it). Empty: nothing. */
    message: string;
    /** How long the chatbot stays off in the chat afterwards. */
    pause: BotPause;
    /** «Mensaje para el agente»: an internal note in the chat ('' none). */
    note: string;
  };
  /** bot pause: «Desactivar bot», the chatbot stops answering this chat. */
  status: { status: 'OPEN' | 'ON_HOLD' | 'CLOSED'; bot: 'keep' | 'pause' };
  end: Record<string, never>;
}

export type FlowNode = {
  [K in NodeKind]: {
    id: string;
    type: K;
    /** Name of the card in the diagram ('' none). */
    title: string;
    /**
     * "Respuesta del usuario": what the customer writes to open this card,
     * after a message that waits, or at any moment when nothing connects to
     * it. '' (or missing) none.
     */
    trigger?: string;
    position: { x: number; y: number };
    data: NodeData[K];
  };
}[NodeKind];

export type NodeOf<K extends NodeKind> = Extract<FlowNode, { type: K }>;

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Something to fix in the flow. Errors keep the chatbot from being enabled. */
export interface FlowIssue {
  nodeId: string | null;
  level: 'error' | 'warning';
  message: string;
}

/** The flow could not be read at all (not what the editor saves). */
export class FlowFormatError extends Error {
  constructor(readonly issues: FlowIssue[]) {
    super('Invalid chatbot flow');
    this.name = 'FlowFormatError';
  }
}

/** Handles a node can leave through. */
export function outputs(node: FlowNode): string[] {
  switch (node.type) {
    case 'start':
    case 'url':
    case 'tags':
    case 'funnel':
    case 'location':
    case 'contact_card':
      return ['next'];
    case 'message':
      return node.data.options.length > 0
        ? node.data.options.map((option) => option.id)
        : ['next'];
    case 'question':
      return ['next', 'other'];
    case 'condition':
      return node.data.match === 'each'
        ? [...node.data.rules.map((rule) => rule.id), 'else']
        : ['yes', 'no'];
    case 'hours':
      return ['in', 'out'];
    case 'contact_field':
      return ['ok', 'fail'];
    case 'api':
      return ['ok', 'error'];
    case 'status':
      return node.data.status === 'CLOSED' || node.data.bot === 'pause'
        ? []
        : ['next'];
    case 'transfer':
    case 'end':
      return [];
  }
}

// ─────────────────────────── Reading ───────────────────────────

const ID = /^[A-Za-z0-9_-]{1,40}$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Reader {
  readonly issues: FlowIssue[] = [];
  constructor(private nodeId: string | null = null) {}

  at(nodeId: string | null) {
    this.nodeId = nodeId;
    return this;
  }

  fail(message: string) {
    this.issues.push({ nodeId: this.nodeId, level: 'error', message });
  }

  text(source: Json, key: string, max: number, label: string): string {
    const value = source[key];
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
      this.fail(`${label}: debe ser texto`);
      return '';
    }
    if (value.length > max) this.fail(`${label}: máximo ${max} caracteres`);
    return value.slice(0, max);
  }

  id(source: Json, key: string, label: string): string {
    const value = source[key];
    if (typeof value !== 'string' || !ID.test(value)) {
      this.fail(`${label}: identificador inválido`);
      return '';
    }
    return value;
  }

  list(source: Json, key: string, max: number, label: string): unknown[] {
    const value = source[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.fail(`${label}: debe ser una lista`);
      return [];
    }
    if (value.length > max) this.fail(`${label}: máximo ${max}`);
    return value.slice(0, max);
  }

  bool(source: Json, key: string): boolean {
    const value = source[key];
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      this.fail(`Valor inválido en ${key}`);
      return false;
    }
    return value;
  }

  /** A number between min and max, or null when missing. */
  number(
    source: Json,
    key: string,
    min: number,
    max: number,
    label: string,
  ): number | null {
    const value = source[key];
    if (value === undefined || value === null || value === '') return null;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      this.fail(`${label}: debe ser un número entre ${min} y ${max}`);
      return null;
    }
    return value;
  }

  oneOf<T extends string>(
    source: Json,
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const value = source[key];
    if (value === undefined || value === null) return fallback;
    if (
      typeof value === 'string' &&
      (allowed as readonly string[]).includes(value)
    )
      return value as T;
    this.fail(`Valor inválido en ${key}`);
    return fallback;
  }
}

/** Files of a node; flows saved with one `media` keep it. */
function readAttachments(read: Reader, data: Json): BotMedia[] {
  if (data.attachments === undefined && data.media !== undefined) {
    const single = readMedia(read, data.media);
    return single ? [single] : [];
  }
  return read
    .list(data, 'attachments', MAX_ATTACHMENTS, 'Archivos')
    .map((item) => readMedia(read, item))
    .filter((media): media is BotMedia => media !== null);
}

function readMedia(read: Reader, value: unknown): BotMedia | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    read.fail('Archivo inválido');
    return null;
  }
  const fileId = value.fileId;
  const size = value.size;
  const type = read.oneOf(
    value,
    'type',
    ['image', 'video', 'audio', 'document'] as const,
    'document',
  );
  if (typeof fileId !== 'string' || !/^[0-9a-f]{24}$/.test(fileId)) {
    read.fail('Archivo inválido');
    return null;
  }
  return {
    fileId,
    type,
    mimeType: read.text(value, 'mimeType', 120, 'Archivo'),
    filename: read.text(value, 'filename', 200, 'Archivo'),
    size: typeof size === 'number' && size >= 0 ? size : 0,
  };
}

const UUID = /^[0-9a-f-]{36}$/i;

/** «Botones interactivos» of a «Respuesta». */
const replyOptions = (read: Reader, items: unknown[]): FlowReplyOption[] =>
  items.map((item) => {
    const option = isObject(item) ? item : {};
    return {
      id: read.id(option, 'id', 'Botón'),
      title: read.text(option, 'title', LIMITS.rowTitle, 'Botón'),
      description: read.text(
        option,
        'description',
        LIMITS.rowDescription,
        'Descripción',
      ),
    };
  });

/** A «Respuesta» from the buttons and list cards of older flows. */
function legacyMenu(read: Reader, type: string, data: Json): unknown {
  const common = {
    text: read.text(data, 'body', LIMITS.body, 'Mensaje'),
    attachments: readAttachments(read, data),
    wait: false,
    header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
    footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
    invalidText: read.text(data, 'invalidText', 1024, 'Respuesta no válida'),
  };
  if (type === 'buttons')
    return {
      ...common,
      options: replyOptions(
        read,
        read.list(data, 'buttons', LIMITS.buttons, 'Botones'),
      ),
      listButton: '',
    };
  const rows = read
    .list(data, 'sections', LIMITS.listSections, 'Secciones')
    .flatMap((section) =>
      isObject(section)
        ? read.list(section, 'rows', MAX_OPTIONS, 'Opciones')
        : [],
    );
  return {
    ...common,
    options: replyOptions(read, rows.slice(0, MAX_OPTIONS)),
    listButton: read.text(
      data,
      'button',
      LIMITS.listButton,
      'Botón de la lista',
    ),
  };
}

function readData(read: Reader, type: NodeKind, data: Json): unknown {
  switch (type) {
    case 'start':
    case 'end':
      return {};
    case 'message': {
      const options = replyOptions(
        read,
        read.list(data, 'options', MAX_OPTIONS, 'Botones'),
      );
      return {
        text: read.text(
          data,
          'text',
          options.length > 0 ? LIMITS.body : LIMITS.text,
          'Respuesta del bot',
        ),
        attachments: readAttachments(read, data),
        wait: read.bool(data, 'wait'),
        options,
        listButton: read.text(
          data,
          'listButton',
          LIMITS.listButton,
          'Botón de la lista',
        ),
        header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
        footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
        invalidText: read.text(
          data,
          'invalidText',
          1024,
          'Respuesta no válida',
        ),
      };
    }
    case 'url': {
      const attachment = readMedia(read, data.attachment);
      if (attachment?.type === 'audio')
        read.fail('El encabezado admite imagen, video o documento');
      return {
        header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
        body: read.text(data, 'body', LIMITS.body, 'Mensaje'),
        footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
        text: read.text(data, 'text', LIMITS.urlText, 'Texto del botón'),
        url: read.text(data, 'url', LIMITS.url, 'Enlace'),
        wait: read.bool(data, 'wait'),
        attachment,
      };
    }
    case 'question':
      return {
        text: read.text(data, 'text', LIMITS.text, 'Pregunta'),
        variable: read.text(data, 'variable', 31, 'Variable'),
        validation: read.oneOf(data, 'validation', VALIDATIONS, 'any'),
        invalidText: read.text(
          data,
          'invalidText',
          1024,
          'Respuesta no válida',
        ),
        saveTo: read.oneOf(data, 'saveTo', CONTACT_FIELDS, 'none'),
      };
    case 'location':
      return {
        latitude: read.number(data, 'latitude', -90, 90, 'Latitud'),
        longitude: read.number(data, 'longitude', -180, 180, 'Longitud'),
        name: read.text(data, 'name', 100, 'Nombre'),
        address: read.text(data, 'address', 100, 'Dirección'),
      };
    case 'contact_card':
      return {
        contacts: read
          .list(data, 'contacts', MAX_CONTACT_CARDS, 'Contactos')
          .map((item) => {
            const card = isObject(item) ? item : {};
            return {
              name: read.text(card, 'name', 80, 'Nombre del contacto'),
              phone: read.text(card, 'phone', 30, 'Teléfono del contacto'),
            };
          }),
      };
    case 'contact_field':
      return {
        field: read.text(data, 'field', 40, 'Campo para actualizar'),
        source: read.oneOf(
          data,
          'source',
          ['answer', 'manual'] as const,
          'answer',
        ),
        value: read.text(data, 'value', 500, 'Valor'),
      };
    case 'api': {
      const auth = isObject(data.auth) ? data.auth : {};
      const pairs = (key: string, max: number, label: string) =>
        read.list(data, key, max, label).map((item) => {
          const pair = isObject(item) ? item : {};
          return {
            key: read.text(pair, 'key', API_LIMITS.key, label),
            value: read.text(pair, 'value', API_LIMITS.value, label),
          };
        });
      return {
        method: read.oneOf(data, 'method', HTTP_METHODS, 'GET'),
        url: read.text(data, 'url', API_LIMITS.url, 'URL API externa'),
        auth: {
          type: read.oneOf(auth, 'type', API_AUTH, 'none'),
          token: read.text(auth, 'token', API_LIMITS.value, 'Token'),
          user: read.text(auth, 'user', API_LIMITS.key, 'Usuario'),
          password: read.text(auth, 'password', API_LIMITS.value, 'Contraseña'),
        },
        headers: pairs('headers', API_LIMITS.headers, 'Cabeceras'),
        params: pairs('params', API_LIMITS.params, 'Parámetros'),
        responses: read
          .list(data, 'responses', API_LIMITS.responses, 'Respuesta')
          .map((item) => {
            const pair = isObject(item) ? item : {};
            return {
              path: read.text(pair, 'path', API_LIMITS.path, 'Ruta'),
              variable: read.text(pair, 'variable', 31, 'Variable'),
            };
          }),
      };
    }
    case 'condition':
      return {
        // Flows saved before «Cumple / No cumple» keep one way per rule.
        match: read.oneOf(data, 'match', CONDITION_MATCHES, 'each'),
        rules: read.list(data, 'rules', 10, 'Condiciones').map((item) => {
          const rule = isObject(item) ? item : {};
          return {
            id: read.id(rule, 'id', 'Condición'),
            source: read.oneOf(
              rule,
              'source',
              ['message', 'variable'] as const,
              'message',
            ),
            variable: read.text(rule, 'variable', 47, 'Variable'),
            operator: read.oneOf(rule, 'operator', OPERATORS, 'contains'),
            value: read.text(rule, 'value', 200, 'Valor'),
          };
        }),
      };
    case 'hours': {
      const schedule = data.schedule;
      const problem = scheduleProblem(schedule);
      if (problem) read.fail(problem);
      return {
        schedule: problem
          ? { timezone: 'UTC', days: [] }
          : (schedule as Schedule),
      };
    }
    case 'tags': {
      const ids = (key: string) =>
        read.list(data, key, 50, 'Etiquetas').filter((id): id is string => {
          const valid = typeof id === 'string' && /^[0-9a-f]{24}$/.test(id);
          if (!valid) read.fail('Etiqueta inválida');
          return valid;
        });
      return { add: ids('add'), remove: ids('remove') };
    }
    case 'funnel': {
      const id = (key: string) => {
        const value = data[key];
        return typeof value === 'string' && UUID.test(value) ? value : '';
      };
      return { funnelId: id('funnelId'), stageId: id('stageId') };
    }
    case 'transfer': {
      const membershipId = data.membershipId;
      return {
        to: read.oneOf(
          data,
          'to',
          ['auto', 'unassigned', 'member'] as const,
          'auto',
        ),
        membershipId:
          typeof membershipId === 'string' && UUID.test(membershipId)
            ? membershipId
            : null,
        // Flows saved before the message existed keep the default one.
        message:
          data.message === undefined
            ? DEFAULT_TRANSFER_TEXT
            : read.text(data, 'message', LIMITS.text, 'Mensaje al transferir'),
        pause: read.oneOf(data, 'pause', BOT_PAUSES, '24h'),
        note: read.text(data, 'note', 1024, 'Mensaje para el agente'),
      };
    }
    case 'status':
      return {
        status: read.oneOf(
          data,
          'status',
          ['OPEN', 'ON_HOLD', 'CLOSED'] as const,
          'CLOSED',
        ),
        bot: read.oneOf(data, 'bot', ['keep', 'pause'] as const, 'keep'),
      };
  }
}

/**
 * Reads a flow sent by the editor: shapes, sizes and WhatsApp limits.
 * Throws FlowFormatError listing what is wrong.
 */
export function parseFlow(value: unknown): Flow {
  const read = new Reader();
  if (!isObject(value))
    throw new FlowFormatError([
      { nodeId: null, level: 'error', message: 'Flujo inválido' },
    ]);
  const rawNodes = read.list(value, 'nodes', MAX_NODES, 'Nodos');
  const rawEdges = read.list(value, 'edges', MAX_EDGES, 'Conexiones');

  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  /** Buttons and list cards of older flows, now a «Respuesta». */
  const menus = new Set<string>();
  for (const item of rawNodes) {
    const raw = isObject(item) ? item : {};
    read.at(null);
    const id = read.id(raw, 'id', 'Nodo');
    read.at(id || null);
    if (id && ids.has(id)) read.fail('Nodo repetido');
    ids.add(id);
    const type = raw.type;
    const legacy = typeof type === 'string' && LEGACY_MENUS.includes(type);
    if (
      typeof type !== 'string' ||
      (!legacy && !(NODE_KINDS as readonly string[]).includes(type))
    ) {
      read.fail('Tipo de nodo desconocido');
      continue;
    }
    if (legacy) menus.add(id);
    const position = isObject(raw.position) ? raw.position : {};
    const x = Number(position.x);
    const y = Number(position.y);
    const data = isObject(raw.data) ? raw.data : {};
    nodes.push({
      id,
      type: legacy ? 'message' : type,
      title: read.text(raw, 'title', MAX_TITLE, 'Título'),
      trigger:
        type === 'start'
          ? ''
          : read.text(raw, 'trigger', MAX_TRIGGER, 'Respuesta del usuario'),
      position: {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      },
      data: legacy
        ? legacyMenu(read, type, data)
        : readData(read, type as NodeKind, data),
    } as FlowNode);
  }

  read.at(null);
  const starts = nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) read.fail('El flujo debe tener un solo inicio');

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: FlowEdge[] = [];
  const used = new Set<string>();
  for (const item of rawEdges) {
    const raw = isObject(item) ? item : {};
    read.at(null);
    const edge = {
      id: read.id(raw, 'id', 'Conexión'),
      source: read.id(raw, 'source', 'Conexión'),
      sourceHandle:
        typeof raw.sourceHandle === 'string' && raw.sourceHandle
          ? raw.sourceHandle
          : 'next',
      target: read.id(raw, 'target', 'Conexión'),
    };
    const source = byId.get(edge.source);
    read.at(edge.source || null);
    if (!source || !byId.has(edge.target)) {
      read.fail('Conexión a un nodo que no existe');
      continue;
    }
    // Menus had an "otra respuesta" output: the chatbot now answers that
    // itself, so those old connections are dropped.
    if (edge.sourceHandle === 'other' && menus.has(source.id)) continue;
    if (!outputs(source).includes(edge.sourceHandle)) {
      read.fail('Conexión desde una salida que no existe');
      continue;
    }
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (used.has(key) && !waitsForAnswer(source)) {
      read.fail('Una salida solo puede ir a un nodo');
      continue;
    }
    used.add(key);
    edges.push(edge);
  }
  if (read.issues.length > 0) throw new FlowFormatError(read.issues);
  return { nodes, edges };
}

// ─────────────────────────── Completeness ───────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL.test(value);

/**
 * What still needs work before the chatbot can answer customers (errors)
 * and what is probably a mistake (warnings, e.g. a node nobody reaches).
 */
export function flowIssues(
  flow: Flow,
  variables: BotVariable[] = [],
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const error = (nodeId: string | null, message: string) =>
    issues.push({ nodeId, level: 'error', message });
  const warn = (nodeId: string | null, message: string) =>
    issues.push({ nodeId, level: 'warning', message });
  const next = new Map(
    flow.edges.map((edge) => [
      `${edge.source}:${edge.sourceHandle}`,
      edge.target,
    ]),
  );
  const unique = (titles: string[]) =>
    new Set(titles.map((title) => title.trim().toLowerCase())).size ===
    titles.length;
  // Created in Variables, contact data, or filled by a "Guardar respuesta"
  // or a «Consulta API».
  const known = new Set([
    ...variables.map((variable) => variable.name.toLowerCase()),
    ...CONTACT_VARIABLES,
    ...flow.nodes.flatMap((node) =>
      node.type === 'question'
        ? [node.data.variable.toLowerCase()]
        : node.type === 'api'
          ? node.data.responses.map((item) => item.variable.toLowerCase())
          : [],
    ),
  ]);
  const contactVariables = new Set<string>(CONTACT_VARIABLES);
  /** A variable the bot saves into: its own, never contact data. */
  const saveVariable = (id: string, name: string) => {
    if (!VARIABLE.test(name))
      error(id, 'Elige la variable donde se guarda la respuesta');
    else if (contactVariables.has(name.toLowerCase()))
      error(
        id,
        'Los datos del contacto no se sobrescriben: usa «Actualizar campo de contacto»',
      );
    else if (
      !variables.some((v) => v.name.toLowerCase() === name.toLowerCase())
    )
      warn(id, `Crea la variable «${name}» en Variables`);
  };

  for (const node of flow.nodes) {
    const id = node.id;
    switch (node.type) {
      case 'start':
        if (!next.has(`${id}:next`))
          error(id, 'Conecta el inicio con el primer mensaje');
        break;
      case 'message': {
        const { options } = node.data;
        if (!node.data.text.trim() && node.data.attachments.length === 0)
          error(id, 'Escribe el mensaje o adjunta un archivo');
        if (options.length === 0) break;
        if (!node.data.text.trim())
          error(id, 'Escribe el mensaje que acompaña a los botones');
        if (options.some((option) => !option.title.trim()))
          error(id, 'Cada botón necesita un texto');
        else if (!unique(options.map((option) => option.title)))
          error(id, 'Los botones no pueden repetirse');
        break;
      }
      case 'url':
        if (!node.data.body.trim()) error(id, 'Escribe el mensaje');
        if (!node.data.text.trim()) error(id, 'Escribe el texto del botón');
        if (!/^https:\/\/[^\s]+\.[^\s]+/.test(node.data.url))
          error(id, 'El enlace debe empezar con https://');
        break;
      case 'question':
        // Without a question it saves the message that opened the card.
        if (!node.data.text.trim() && triggerWords(node.trigger).length === 0)
          error(
            id,
            'Escribe la pregunta, o la «Respuesta del usuario» que se guarda',
          );
        saveVariable(id, node.data.variable);
        break;
      case 'location':
        if (node.data.latitude === null || node.data.longitude === null)
          error(id, 'Escribe la latitud y la longitud');
        break;
      case 'contact_card':
        if (node.data.contacts.length === 0)
          error(id, 'Agrega al menos un contacto');
        if (
          node.data.contacts.some(
            (card) => !card.name.trim() || !normalizePhone(card.phone),
          )
        )
          error(id, 'Cada contacto necesita nombre y un teléfono válido');
        break;
      case 'contact_field':
        if (!node.data.field) error(id, 'Elige el campo para actualizar');
        if (node.data.source === 'manual' && !node.data.value.trim())
          error(id, 'Escribe el valor que se guarda');
        break;
      case 'api':
        if (!/^https:\/\/[^\s/]+/i.test(node.data.url.trim()))
          error(id, 'La URL debe empezar con https://');
        if (node.data.auth.type === 'bearer' && !node.data.auth.token.trim())
          error(id, 'Escribe el token');
        if (node.data.auth.type === 'basic' && !node.data.auth.user.trim())
          error(id, 'Escribe el usuario');
        if (
          node.data.auth.type === 'headers' &&
          !node.data.headers.some((header) => header.key.trim())
        )
          error(id, 'Agrega las cabeceras de autenticación');
        if (
          [...node.data.headers, ...node.data.params].some(
            (pair) => !pair.key.trim() && pair.value.trim(),
          )
        )
          error(id, 'Cada cabecera y parámetro necesita su nombre');
        for (const item of node.data.responses) {
          if (!item.path.trim())
            error(id, 'Escribe la ruta de cada valor de la respuesta');
          saveVariable(id, item.variable);
        }
        break;
      case 'condition':
        if (node.data.rules.length === 0)
          error(id, 'Agrega al menos una condición');
        for (const rule of node.data.rules) {
          const name = rule.variable.toLowerCase();
          if (
            rule.source === 'variable' &&
            !VARIABLE.test(rule.variable) &&
            !FIELD_VARIABLE.test(name)
          )
            error(id, 'Elige la variable de cada condición');
          else if (
            rule.source === 'variable' &&
            !known.has(name) &&
            !FIELD_VARIABLE.test(name)
          )
            warn(id, `La variable «${rule.variable}» no existe`);
          if (VALUE_OPERATORS.includes(rule.operator) && !rule.value.trim())
            error(id, 'Escribe el valor de cada condición');
        }
        break;
      case 'hours':
        if (node.data.schedule.days.every((day) => day.ranges.length === 0))
          error(id, 'Define al menos un horario');
        break;
      case 'tags':
        if (node.data.add.length === 0 && node.data.remove.length === 0)
          error(id, 'Elige las etiquetas que agrega o quita');
        break;
      case 'funnel':
        if (!node.data.funnelId || !node.data.stageId)
          error(id, 'Elige el embudo y la etapa');
        break;
      case 'transfer':
        if (node.data.to === 'member' && !node.data.membershipId)
          error(id, 'Elige el agente');
        break;
      case 'status':
      case 'end':
        break;
    }
  }

  // A message that waits needs cards to open, each with its own words.
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const targets = new Set(flow.edges.map((edge) => edge.target));
  for (const node of flow.nodes) {
    if (!waitsForAnswer(node)) continue;
    const children = flow.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => byId.get(edge.target));
    if (children.length === 0)
      error(
        node.id,
        'Conecta las tarjetas que responden o marca «Enviar mensaje y saltar al siguiente nodo»',
      );
    else if (
      children.some((child) => triggerWords(child?.trigger).length === 0)
    )
      error(
        node.id,
        'Cada tarjeta conectada necesita su «Respuesta del usuario»',
      );
    else if (!uniqueWords(children.map((child) => child?.trigger)))
      error(
        node.id,
        'Las respuestas del usuario de las tarjetas conectadas se repiten',
      );
  }
  // Cards opened by their words from anywhere.
  const entries = flow.nodes.filter(
    (node) => !targets.has(node.id) && triggerWords(node.trigger).length > 0,
  );
  for (const node of entries)
    if (triggerWords(node.trigger).includes(ANY_MESSAGE))
      error(
        node.id,
        '«Aceptar cualquier mensaje» solo sirve en tarjetas conectadas a un mensaje que espera',
      );
  if (!uniqueWords(entries.map((node) => node.trigger)))
    error(
      null,
      'Dos tarjetas sin conexiones se activan con la misma «Respuesta del usuario»',
    );

  // Nodes nobody reaches never run.
  const start = flow.nodes.find((node) => node.type === 'start');
  const reached = new Set<string>();
  const pending = [
    ...(start ? [start.id] : []),
    ...entries.map((node) => node.id),
  ];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of flow.edges)
      if (edge.source === id) pending.push(edge.target);
  }
  for (const node of flow.nodes) {
    if (!reached.has(node.id)) warn(node.id, 'Ningún camino llega a este nodo');
  }
  return issues;
}

/**
 * Message and link cards that wait for an answer written by the customer
 * (a menu as text) instead of moving on. A «Respuesta» with options waits
 * for one of them instead.
 */
export const waitsForAnswer = (node: FlowNode) =>
  (node.type === 'message' &&
    node.data.wait === true &&
    node.data.options.length === 0) ||
  (node.type === 'url' && node.data.wait === true);

/** A «Respuesta» with «Botones interactivos». */
export const hasOptions = (node: FlowNode) =>
  node.type === 'message' && node.data.options.length > 0;

const simplify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // "1." or "1)" are the same answer as "1".
    .replace(/[.):\-\s]+$/, '')
    .replace(/\s+/g, ' ');

/** The answers a "Respuesta del usuario" accepts ("1, ventas" → two). */
export function triggerWords(trigger: string | undefined): string[] {
  return (trigger ?? '')
    .split(',')
    .map(simplify)
    .filter((word) => word !== '');
}

/** Whether the customer's text is one of the answers of a card («*» aside). */
export const matchesTrigger = (trigger: string | undefined, text: string) => {
  const typed = simplify(text);
  return typed !== '' && triggerWords(trigger).includes(typed);
};

/** «Aceptar cualquier mensaje»: the card takes whatever the customer writes. */
export const acceptsAny = (trigger: string | undefined) =>
  triggerWords(trigger).includes(ANY_MESSAGE);

function uniqueWords(triggers: (string | undefined)[]): boolean {
  const words = triggers.flatMap(triggerWords);
  return new Set(words).size === words.length;
}

/** The flow of a new chatbot: a greeting with two options after the start. */
export function starterFlow(): Flow {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        title: '',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: 'welcome',
        type: 'message',
        title: 'Saludo inicial',
        position: { x: 0, y: 140 },
        data: {
          text: '¡Hola {{nombre}}! 👋 Gracias por escribirnos. ¿En qué te ayudamos?',
          attachments: [],
          options: [
            { id: 'o1', title: 'Opción 1', description: '' },
            { id: 'o2', title: 'Opción 2', description: '' },
          ],
          listButton: '',
          header: '',
          footer: '',
          invalidText: '',
        },
      },
    ],
    edges: [
      {
        id: 'e-start',
        source: 'start',
        sourceHandle: 'next',
        target: 'welcome',
      },
    ],
  };
}
