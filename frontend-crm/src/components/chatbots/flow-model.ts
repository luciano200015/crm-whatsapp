import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { es } from '../../i18n/es'
import type {
  ConditionRule,
  FlowGraph,
  FlowNode,
  FlowOption,
  NodeData,
  NodeKind,
  Operator,
} from '../../lib/api/chatbots'

/** WhatsApp's limits for interactive messages (same as the API checks). */
export const LIMITS = {
  title: 60,
  trigger: 100,
  text: 4096,
  body: 1024,
  header: 60,
  footer: 60,
  /** More than this, or a longer title, and the options go as a list. */
  buttons: 3,
  buttonTitle: 20,
  options: 10,
  optionTitle: 24,
  optionDescription: 72,
  listButton: 20,
  urlText: 20,
  invalidText: 1024,
  placeName: 100,
  contactName: 80,
  contactCards: 5,
  rules: 10,
  ruleValue: 200,
  apiUrl: 2000,
  apiHeaders: 20,
  apiParams: 30,
  apiResponses: 20,
  apiKey: 100,
  apiValue: 1000,
  apiPath: 200,
} as const

/** «Aceptar cualquier mensaje» in "Respuesta del usuario". */
export const ANY_MESSAGE = '*'

/** A node of the canvas: its `type` is the kind, its data the node's settings. */
export type EditorNode = Node<Record<string, unknown>, NodeKind>
export type EditorEdge = Edge

/** «Agregar nodo», by group, as in wasapi. */
export const PALETTE: { group: keyof typeof es.chatbots.editor.groups; kinds: NodeKind[] }[] = [
  { group: 'messages', kinds: ['message', 'url', 'question', 'location', 'contact_card'] },
  {
    group: 'actions',
    kinds: ['tags', 'transfer', 'status', 'contact_field', 'funnel', 'api'],
  },
  { group: 'logic', kinds: ['condition', 'hours', 'end'] },
]
export const NODE_KINDS: NodeKind[] = ['start', ...PALETTE.flatMap((item) => item.kinds)]

/** Accent of each kind on the canvas. */
export const NODE_COLORS: Record<NodeKind, string> = {
  start: '#22c55e',
  message: '#3b82f6',
  url: '#0ea5e9',
  question: '#14b8a6',
  location: '#ef4444',
  contact_card: '#06b6d4',
  condition: '#f59e0b',
  hours: '#f97316',
  tags: '#ec4899',
  funnel: '#6366f1',
  contact_field: '#8b5cf6',
  api: '#0f766e',
  transfer: '#e11d48',
  status: '#64748b',
  end: '#475569',
}

/** Connection points and pills, green as in wasapi. */
export const HANDLE_COLOR = '#22c55e'

/** Short random ids, valid for the API (letters, digits, - and _). */
export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${random}`
}

const WEEKDAYS = [1, 2, 3, 4, 5]

/** Settings of a new node of each kind. */
export function defaultData(kind: NodeKind): NodeData[NodeKind] {
  switch (kind) {
    case 'start':
    case 'end':
      return {}
    case 'message':
      return {
        text: '',
        attachments: [],
        options: [],
        listButton: '',
        header: '',
        footer: '',
        invalidText: '',
      }
    case 'url':
      return {
        header: '',
        body: '',
        footer: '',
        text: 'Abrir',
        url: 'https://',
        attachment: null,
      }
    case 'question':
      return { text: '', variable: '', validation: 'any', invalidText: '', saveTo: 'none' }
    case 'location':
      return { latitude: null, longitude: null, name: '', address: '' }
    case 'contact_card':
      return { contacts: [{ name: '', phone: '' }] }
    case 'condition':
      return { match: 'all', rules: [] }
    case 'hours':
      return {
        schedule: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          days: WEEKDAYS.map((day) => ({ day, ranges: [{ from: '09:00', to: '18:00' }] })),
        },
      }
    case 'tags':
      return { add: [], remove: [] }
    case 'funnel':
      return { funnelId: '', stageId: '' }
    case 'contact_field':
      return { field: '', source: 'answer', value: '' }
    case 'api':
      return {
        method: 'GET',
        url: 'https://',
        auth: { type: 'none', token: '', user: '', password: '' },
        headers: [],
        params: [],
        responses: [],
      }
    case 'transfer':
      return {
        to: 'auto',
        membershipId: null,
        message: es.chatbots.node.transferMessageDefault,
        pause: '24h',
        note: '',
      }
    case 'status':
      return { status: 'CLOSED', bot: 'keep' }
  }
}

/** Options of a «Respuesta» (old cards may lack them). */
export const optionsOf = (data: Record<string, unknown>): FlowOption[] =>
  Array.isArray(data.options) ? (data.options as FlowOption[]) : []

/** As the API sends them: up to 3 short options without description are buttons. */
export const sentAsButtons = (options: FlowOption[]) =>
  options.length <= LIMITS.buttons &&
  options.every((option) => option.title.length <= LIMITS.buttonTitle && !option.description)

export interface Output {
  id: string
  label: string
  /** A named branch: ✓ (it happened) or ✗ (it did not). */
  mark?: 'yes' | 'no'
}

/** Outputs (handles) of a node, with their labels. Mirrors the API. */
export function outputsOf(kind: NodeKind, data: Record<string, unknown>): Output[] {
  const labels = es.chatbots.node
  const next = [{ id: 'next', label: labels.next }]
  switch (kind) {
    case 'start':
    case 'url':
    case 'location':
    case 'contact_card':
    case 'tags':
    case 'funnel':
      return next
    case 'message': {
      const options = optionsOf(data)
      return options.length > 0
        ? options.map((option) => ({ id: option.id, label: option.title || labels.empty }))
        : next
    }
    case 'question':
      return [
        { id: 'next', label: labels.next, mark: 'yes' },
        { id: 'other', label: labels.other, mark: 'no' },
      ]
    case 'condition': {
      const condition = data as NodeData['condition']
      if (condition.match !== 'each')
        return [
          { id: 'yes', label: labels.yes, mark: 'yes' },
          { id: 'no', label: labels.no, mark: 'no' },
        ]
      return [
        ...condition.rules.map((rule, index) => ({ id: rule.id, label: labels.rule(index + 1) })),
        { id: 'else', label: labels.else, mark: 'no' as const },
      ]
    }
    case 'hours':
      return [
        { id: 'in', label: labels.in, mark: 'yes' },
        { id: 'out', label: labels.out, mark: 'no' },
      ]
    case 'contact_field':
      return [
        { id: 'ok', label: labels.fieldOk, mark: 'yes' },
        { id: 'fail', label: labels.fieldFail, mark: 'no' },
      ]
    case 'api':
      return [
        { id: 'ok', label: labels.ok, mark: 'yes' },
        { id: 'error', label: labels.error, mark: 'no' },
      ]
    case 'status': {
      const status = data as NodeData['status']
      return status.status === 'CLOSED' || status.bot === 'pause' ? [] : next
    }
    case 'transfer':
    case 'end':
      return []
  }
}

/** Every connection: with an arrow and an ✕ to remove it (DeletableEdge). */
export const EDGE_DEFAULTS = {
  type: 'deletable',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
} as const

/** The title of a card travels inside its canvas data, next to its settings. */
export const titleOf = (data: Record<string, unknown>) =>
  typeof data.title === 'string' ? data.title : ''

/** "Respuesta del usuario" of a card, also kept in its canvas data. */
export const triggerOf = (data: Record<string, unknown>) =>
  typeof data.trigger === 'string' ? data.trigger : ''

/** A message (without options) or link that waits for an answer instead of moving on. */
export const waitsForAnswer = (kind: NodeKind | undefined, data: Record<string, unknown>) =>
  (kind === 'message' || kind === 'url') && data.wait === true && optionsOf(data).length === 0

type Json = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const list = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => !!item && typeof item === 'object')
    : []

/**
 * Buttons and lists saved before «Respuesta» (the API converts them too):
 * one message with their options, ids kept so connections stay.
 */
function legacyMenu(type: string, data: Json): NodeData['message'] {
  const rows =
    type === 'buttons'
      ? list(data.buttons)
      : list(data.sections).flatMap((section) => list(section.rows))
  return {
    text: text(data.body),
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as NodeData['message']['attachments'])
      : [],
    options: rows.slice(0, LIMITS.options).map((row) => ({
      id: text(row.id),
      title: text(row.title),
      ...(text(row.description) && { description: text(row.description) }),
    })),
    listButton: type === 'list' ? text(data.button) : '',
    header: text(data.header),
    footer: text(data.footer),
    invalidText: text(data.invalidText),
  }
}

/** Fills what older cards of a kind lack, so forms and the canvas can rely on it. */
function upgrade(type: string, data: Json): { type: NodeKind; data: Json } {
  if (type === 'buttons' || type === 'list')
    return { type: 'message', data: { ...legacyMenu(type, data) } }
  const kind = type as NodeKind
  const defaults = defaultData(kind) as Json
  if (kind === 'condition') return { type: kind, data: { ...defaults, match: 'each', ...data } }
  return { type: kind, data: { ...defaults, ...data } }
}

export function fromGraph(graph: FlowGraph): { nodes: EditorNode[]; edges: EditorEdge[] } {
  // Menus had an "otra respuesta" output: the chatbot now answers that itself.
  const menus = new Set(
    graph.nodes
      .filter((node) => (node.type as string) === 'buttons' || (node.type as string) === 'list')
      .map((node) => node.id),
  )
  return {
    nodes: graph.nodes.map((node) => {
      const { type, data } = upgrade(node.type, node.data as Json)
      return {
        id: node.id,
        type,
        position: node.position,
        data: { ...data, title: node.title ?? '', trigger: node.trigger ?? '' },
        deletable: type !== 'start',
      }
    }),
    edges: graph.edges
      .filter((edge) => !(edge.sourceHandle === 'other' && menus.has(edge.source)))
      .map((edge) => ({
        ...EDGE_DEFAULTS,
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
      })),
  }
}

/** Cards reached by an option or a card that moves on by itself: no words open them. */
export function lockedTargets(nodes: EditorNode[], edges: EditorEdge[]): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return new Set(
    edges
      .filter((edge) => {
        const source = byId.get(edge.source)
        return !waitsForAnswer(source?.type, source?.data ?? {})
      })
      .map((edge) => edge.target),
  )
}

export function toGraph(nodes: EditorNode[], edges: EditorEdge[]): FlowGraph {
  // Their "Respuesta del usuario" is dropped.
  const locked = lockedTargets(nodes, edges)
  return {
    nodes: nodes.map((node) => {
      const { title, trigger, ...data } = node.data
      return {
        id: node.id,
        type: node.type,
        title: typeof title === 'string' ? title.trim() : '',
        trigger: typeof trigger === 'string' && !locked.has(node.id) ? trigger.trim() : '',
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        data,
      } as FlowNode
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? 'next',
      target: edge.target,
    })),
  }
}

/**
 * «Mensaje de usuario» of each card, as wasapi shows it: the option that
 * leads to it, or the words that open it («*»: any message).
 */
export function userMessages(nodes: EditorNode[], edges: EditorEdge[]): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const result = new Map<string, string>()
  for (const edge of edges) {
    const source = byId.get(edge.source)
    if (source?.type !== 'message') continue
    const option = optionsOf(source.data).find((item) => item.id === edge.sourceHandle)
    if (!option) continue
    const before = result.get(edge.target)
    result.set(edge.target, before ? `${before}, ${option.title}` : option.title)
  }
  const locked = lockedTargets(nodes, edges)
  for (const node of nodes) {
    const trigger = triggerOf(node.data).trim()
    if (!trigger || locked.has(node.id) || result.has(node.id)) continue
    result.set(node.id, trigger === ANY_MESSAGE ? es.chatbots.node.acceptsAny : trigger)
  }
  return result
}

/** One-line summary of a node, for its accessible name on the canvas. */
export function preview(kind: NodeKind, data: Record<string, unknown>): string {
  switch (kind) {
    case 'message': {
      const message = data as NodeData['message']
      return (
        message.text ||
        (message.attachments[0] ? es.chatbots.tester.file(message.attachments[0].filename) : '')
      )
    }
    case 'url':
      return (data as NodeData['url']).body
    case 'question':
      return (data as NodeData['question']).text
    case 'location':
      return (data as NodeData['location']).name
    case 'status':
      return es.chatbots.node.statuses[(data as NodeData['status']).status]
    case 'api':
      return (data as NodeData['api']).url
    default:
      return ''
  }
}

/** The {{variables}} a text uses, without repeats. */
export function variablesIn(...texts: string[]): string[] {
  const names = texts.flatMap((value) =>
    [...value.matchAll(/\{\{\s*([\p{L}\w]+)\s*\}\}/gu)].map((match) => match[1] ?? ''),
  )
  return [...new Set(names.filter(Boolean))]
}

/** Operators that compare with a value (the API's VALUE_OPERATORS). */
export const VALUE_OPERATORS: Operator[] = [
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
]

/** "{{edad}} es mayor o igual que «18»", as the card and the list show it. */
export function ruleText(rule: ConditionRule): string {
  const subject = rule.source === 'message' ? es.chatbots.node.lastMessage : `{{${rule.variable}}}`
  const value = VALUE_OPERATORS.includes(rule.operator) ? ` «${rule.value}»` : ''
  return `${subject} ${es.chatbots.node.operators[rule.operator]}${value}`
}
