import { INTERACTIVE_LIMITS as LIMITS } from '../../channels/domain/interactive';
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
  'buttons',
  'list',
  'url',
  'question',
  'condition',
  'hours',
  'tags',
  'transfer',
  'status',
  'end',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

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

export interface FlowListRow extends FlowOption {
  description: string;
}

export interface FlowListSection {
  id: string;
  title: string;
  rows: FlowListRow[];
}

export const VALIDATIONS = ['any', 'number', 'email', 'phone'] as const;
export const OPERATORS = [
  'equals',
  'contains',
  'starts_with',
  'is_number',
  'is_empty',
  'greater_than',
  'less_than',
  'is_true',
  'is_false',
] as const;
/** Contact fields "Guardar respuesta" can also update. */
export const CONTACT_FIELDS = ['none', 'name', 'email'] as const;

export interface ConditionRule {
  id: string;
  /** message: the customer's last message; variable: a saved answer. */
  source: 'message' | 'variable';
  variable: string;
  operator: (typeof OPERATORS)[number];
  value: string;
}

/** Optional texts are '' when empty, so the editor's forms stay simple. */
export interface NodeData {
  start: Record<string, never>;
  /**
   * Files go after the text; a single file takes the text as its caption.
   * wait: instead of "Enviar mensaje y saltar al siguiente nodo", waits for
   * the customer and follows the connected card whose "Respuesta del
   * usuario" matches (a menu written as text: "1. Ventas, 2. Soporte").
   */
  message: { text: string; attachments: BotMedia[]; wait?: boolean };
  buttons: {
    header: string;
    body: string;
    footer: string;
    buttons: FlowOption[];
    /** Said before repeating the question when the answer matches no option. */
    invalidText: string;
    /** Sent before the buttons. */
    attachments: BotMedia[];
  };
  list: {
    header: string;
    body: string;
    footer: string;
    button: string;
    sections: FlowListSection[];
    invalidText: string;
    attachments: BotMedia[];
  };
  url: {
    header: string;
    body: string;
    footer: string;
    text: string;
    url: string;
    /** Like message: waits for an answer that opens a connected card. */
    wait?: boolean;
  };
  question: {
    text: string;
    variable: string;
    validation: (typeof VALIDATIONS)[number];
    invalidText: string;
    /** Also saves the answer in the contact (name or email). */
    saveTo: (typeof CONTACT_FIELDS)[number];
  };
  condition: { rules: ConditionRule[] };
  hours: { schedule: Schedule };
  tags: { add: string[]; remove: string[] };
  transfer: {
    /** auto: in turns among the line's agents; unassigned: the queue. */
    to: 'auto' | 'unassigned' | 'member';
    membershipId: string | null;
    /** Told to the customer after the handover ({{agente}}: who got it). Empty: nothing. */
    message: string;
    /** How long the chatbot stays off in the chat afterwards. */
    pause: BotPause;
  };
  status: { status: 'OPEN' | 'ON_HOLD' | 'CLOSED' };
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
    case 'message':
    case 'url':
    case 'tags':
      return ['next'];
    case 'question':
      return ['next', 'other'];
    case 'buttons':
      return node.data.buttons.map((button) => button.id);
    case 'list':
      return node.data.sections.flatMap((section) =>
        section.rows.map((row) => row.id),
      );
    case 'condition':
      return [...node.data.rules.map((rule) => rule.id), 'else'];
    case 'hours':
      return ['in', 'out'];
    case 'status':
      return node.data.status === 'CLOSED' ? [] : ['next'];
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

const options = (
  read: Reader,
  items: unknown[],
  titleMax: number,
  label: string,
): FlowOption[] =>
  items.map((item) => {
    const option = isObject(item) ? item : {};
    return {
      id: read.id(option, 'id', label),
      title: read.text(option, 'title', titleMax, label),
    };
  });

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

function readData(read: Reader, type: NodeKind, data: Json): unknown {
  switch (type) {
    case 'start':
    case 'end':
      return {};
    case 'message':
      return {
        text: read.text(data, 'text', LIMITS.text, 'Texto'),
        attachments: readAttachments(read, data),
        wait: read.bool(data, 'wait'),
      };
    case 'buttons':
      return {
        header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
        body: read.text(data, 'body', LIMITS.body, 'Mensaje'),
        footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
        buttons: options(
          read,
          read.list(data, 'buttons', LIMITS.buttons, 'Botones'),
          LIMITS.buttonTitle,
          'Botón',
        ),
        invalidText: read.text(
          data,
          'invalidText',
          1024,
          'Respuesta no válida',
        ),
        attachments: readAttachments(read, data),
      };
    case 'list':
      return {
        header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
        body: read.text(data, 'body', LIMITS.body, 'Mensaje'),
        footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
        button: read.text(
          data,
          'button',
          LIMITS.listButton,
          'Botón de la lista',
        ),
        sections: read
          .list(data, 'sections', LIMITS.listSections, 'Secciones')
          .map((item) => {
            const section = isObject(item) ? item : {};
            return {
              id: read.id(section, 'id', 'Sección'),
              title: read.text(
                section,
                'title',
                LIMITS.sectionTitle,
                'Sección',
              ),
              rows: read
                .list(section, 'rows', LIMITS.listRows, 'Opciones')
                .map((rowItem) => {
                  const row = isObject(rowItem) ? rowItem : {};
                  return {
                    id: read.id(row, 'id', 'Opción'),
                    title: read.text(row, 'title', LIMITS.rowTitle, 'Opción'),
                    description: read.text(
                      row,
                      'description',
                      LIMITS.rowDescription,
                      'Descripción',
                    ),
                  };
                }),
            };
          }),
        invalidText: read.text(
          data,
          'invalidText',
          1024,
          'Respuesta no válida',
        ),
        attachments: readAttachments(read, data),
      };
    case 'url':
      return {
        header: read.text(data, 'header', LIMITS.header, 'Encabezado'),
        body: read.text(data, 'body', LIMITS.body, 'Mensaje'),
        footer: read.text(data, 'footer', LIMITS.footer, 'Pie'),
        text: read.text(data, 'text', LIMITS.urlText, 'Texto del botón'),
        url: read.text(data, 'url', LIMITS.url, 'Enlace'),
        wait: read.bool(data, 'wait'),
      };
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
    case 'condition':
      return {
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
            variable: read.text(rule, 'variable', 31, 'Variable'),
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
          typeof membershipId === 'string' &&
          /^[0-9a-f-]{36}$/i.test(membershipId)
            ? membershipId
            : null,
        // Flows saved before the message existed keep the default one.
        message:
          data.message === undefined
            ? DEFAULT_TRANSFER_TEXT
            : read.text(data, 'message', LIMITS.text, 'Mensaje al transferir'),
        pause: read.oneOf(data, 'pause', BOT_PAUSES, '24h'),
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
  for (const item of rawNodes) {
    const raw = isObject(item) ? item : {};
    read.at(null);
    const id = read.id(raw, 'id', 'Nodo');
    read.at(id || null);
    if (id && ids.has(id)) read.fail('Nodo repetido');
    ids.add(id);
    const type = raw.type;
    if (
      typeof type !== 'string' ||
      !(NODE_KINDS as readonly string[]).includes(type)
    ) {
      read.fail('Tipo de nodo desconocido');
      continue;
    }
    const position = isObject(raw.position) ? raw.position : {};
    const x = Number(position.x);
    const y = Number(position.y);
    nodes.push({
      id,
      type,
      title: read.text(raw, 'title', MAX_TITLE, 'Título'),
      trigger:
        type === 'start'
          ? ''
          : read.text(raw, 'trigger', MAX_TRIGGER, 'Respuesta del usuario'),
      position: {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      },
      data: readData(
        read,
        type as NodeKind,
        isObject(raw.data) ? raw.data : {},
      ),
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
    if (
      edge.sourceHandle === 'other' &&
      (source.type === 'buttons' || source.type === 'list')
    )
      continue;
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
  // Created in Variables, contact data, or filled by a "Guardar respuesta".
  const known = new Set([
    ...variables.map((variable) => variable.name.toLowerCase()),
    ...CONTACT_VARIABLES,
    ...flow.nodes.flatMap((node) =>
      node.type === 'question' ? [node.data.variable.toLowerCase()] : [],
    ),
  ]);
  const contactVariables = new Set<string>(CONTACT_VARIABLES);

  for (const node of flow.nodes) {
    const id = node.id;
    switch (node.type) {
      case 'start':
        if (!next.has(`${id}:next`))
          error(id, 'Conecta el inicio con el primer mensaje');
        break;
      case 'message':
        if (!node.data.text.trim() && node.data.attachments.length === 0)
          error(id, 'Escribe el mensaje o adjunta un archivo');
        break;
      case 'buttons':
        if (!node.data.body.trim())
          error(id, 'Escribe el mensaje de los botones');
        if (node.data.buttons.length === 0)
          error(id, 'Agrega al menos un botón');
        if (node.data.buttons.some((button) => !button.title.trim()))
          error(id, 'Cada botón necesita un texto');
        else if (!unique(node.data.buttons.map((button) => button.title)))
          error(id, 'Los botones no pueden repetirse');
        if (!node.data.invalidText.trim())
          error(id, 'Escribe la respuesta cuando el cliente no elige un botón');
        break;
      case 'list': {
        const rows = node.data.sections.flatMap((section) => section.rows);
        if (!node.data.body.trim()) error(id, 'Escribe el mensaje de la lista');
        if (!node.data.button.trim())
          error(id, 'Escribe el texto del botón que abre la lista');
        if (rows.length === 0) error(id, 'Agrega al menos una opción');
        if (rows.length > LIMITS.listRows)
          error(id, `WhatsApp permite hasta ${LIMITS.listRows} opciones`);
        if (rows.some((row) => !row.title.trim()))
          error(id, 'Cada opción necesita un título');
        else if (!unique(rows.map((row) => row.title)))
          error(id, 'Las opciones no pueden repetirse');
        if (
          node.data.sections.length > 1 &&
          node.data.sections.some((s) => !s.title.trim())
        )
          error(id, 'Con varias secciones, cada una necesita título');
        if (!node.data.invalidText.trim())
          error(
            id,
            'Escribe la respuesta cuando el cliente no elige una opción',
          );
        break;
      }
      case 'url':
        if (!node.data.body.trim()) error(id, 'Escribe el mensaje');
        if (!node.data.text.trim()) error(id, 'Escribe el texto del botón');
        if (!/^https:\/\/[^\s]+\.[^\s]+/.test(node.data.url))
          error(id, 'El enlace debe empezar con https://');
        break;
      case 'question':
        if (!node.data.text.trim()) error(id, 'Escribe la pregunta');
        if (!VARIABLE.test(node.data.variable))
          error(id, 'Elige la variable donde se guarda la respuesta');
        else if (contactVariables.has(node.data.variable.toLowerCase()))
          error(
            id,
            'Los datos del contacto no se sobrescriben: usa «Guardar también en el contacto»',
          );
        else if (
          !variables.some(
            (v) => v.name.toLowerCase() === node.data.variable.toLowerCase(),
          )
        )
          warn(id, `Crea la variable «${node.data.variable}» en Variables`);
        break;
      case 'condition':
        if (node.data.rules.length === 0)
          error(id, 'Agrega al menos una condición');
        for (const rule of node.data.rules) {
          if (rule.source === 'variable' && !VARIABLE.test(rule.variable))
            error(id, 'Elige la variable de cada condición');
          else if (
            rule.source === 'variable' &&
            !known.has(rule.variable.toLowerCase())
          )
            warn(id, `La variable «${rule.variable}» no existe`);
          if (
            [
              'equals',
              'contains',
              'starts_with',
              'greater_than',
              'less_than',
            ].includes(rule.operator) &&
            !rule.value.trim()
          )
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

/** Message and link cards that wait for an answer instead of moving on. */
export const waitsForAnswer = (node: FlowNode) =>
  (node.type === 'message' || node.type === 'url') && node.data.wait === true;

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

/** Whether the customer's text is one of the answers of a card. */
export const matchesTrigger = (trigger: string | undefined, text: string) =>
  triggerWords(trigger).includes(simplify(text));

function uniqueWords(triggers: (string | undefined)[]): boolean {
  const words = triggers.flatMap(triggerWords);
  return new Set(words).size === words.length;
}

/** The flow of a new chatbot: a greeting after the start. */
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
          text: '¡Hola {{nombre}}! 👋 Gracias por escribirnos.',
          attachments: [],
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
