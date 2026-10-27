import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { es } from '../../i18n/es'
import type { FlowGraph, FlowNode, NodeData, NodeKind } from '../../lib/api/chatbots'

/** WhatsApp's limits for interactive messages (same as the API checks). */
export const LIMITS = {
  title: 60,
  trigger: 100,
  text: 4096,
  body: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listRows: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  urlText: 20,
  invalidText: 1024,
} as const

/** A node of the canvas: its `type` is the kind, its data the node's settings. */
export type EditorNode = Node<Record<string, unknown>, NodeKind>
export type EditorEdge = Edge

/** Kinds offered in "Opciones de respuesta", in that order. */
export const PALETTE: NodeKind[] = [
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
]

/** Accent of each kind on the canvas. */
export const NODE_COLORS: Record<NodeKind, string> = {
  start: '#22c55e',
  message: '#3b82f6',
  buttons: '#8b5cf6',
  list: '#a855f7',
  url: '#0ea5e9',
  question: '#14b8a6',
  condition: '#f59e0b',
  hours: '#f97316',
  tags: '#ec4899',
  transfer: '#ef4444',
  status: '#64748b',
  end: '#475569',
}

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
      return { text: '', attachments: [] }
    case 'buttons':
      return {
        header: '',
        body: '',
        footer: '',
        buttons: [
          { id: newId('b'), title: 'Opción 1' },
          { id: newId('b'), title: 'Opción 2' },
        ],
        invalidText: es.chatbots.node.invalidDefault,
        attachments: [],
      }
    case 'list':
      return {
        header: '',
        body: '',
        footer: '',
        button: 'Ver opciones',
        sections: [
          {
            id: newId('s'),
            title: '',
            rows: [{ id: newId('r'), title: 'Opción 1', description: '' }],
          },
        ],
        invalidText: es.chatbots.node.invalidDefault,
        attachments: [],
      }
    case 'url':
      return { header: '', body: '', footer: '', text: 'Abrir', url: 'https://' }
    case 'question':
      return { text: '', variable: '', validation: 'any', invalidText: '', saveTo: 'none' }
    case 'condition':
      return {
        rules: [
          { id: newId('c'), source: 'message', variable: '', operator: 'contains', value: '' },
        ],
      }
    case 'hours':
      return {
        schedule: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          days: WEEKDAYS.map((day) => ({ day, ranges: [{ from: '09:00', to: '18:00' }] })),
        },
      }
    case 'tags':
      return { add: [], remove: [] }
    case 'transfer':
      return {
        to: 'auto',
        membershipId: null,
        message: es.chatbots.node.transferMessageDefault,
        pause: '24h',
      }
    case 'status':
      return { status: 'CLOSED' }
  }
}

/** Outputs (handles) of a node, with their labels. Mirrors the API. */
export function outputsOf(kind: NodeKind, data: Record<string, unknown>) {
  const labels = es.chatbots.node
  switch (kind) {
    case 'start':
    case 'message':
    case 'url':
    case 'tags':
      return [{ id: 'next', label: labels.next }]
    case 'question':
      return [
        { id: 'next', label: labels.next },
        { id: 'other', label: labels.other },
      ]
    case 'buttons':
      return (data as NodeData['buttons']).buttons.map((button) => ({
        id: button.id,
        label: button.title || labels.empty,
      }))
    case 'list':
      return (data as NodeData['list']).sections.flatMap((section) =>
        section.rows.map((row) => ({ id: row.id, label: row.title || labels.empty })),
      )
    case 'condition':
      return [
        ...(data as NodeData['condition']).rules.map((rule, index) => ({
          id: rule.id,
          label: labels.rule(index + 1),
        })),
        { id: 'else', label: labels.else },
      ]
    case 'hours':
      return [
        { id: 'in', label: labels.in },
        { id: 'out', label: labels.out },
      ]
    case 'status':
      return (data as NodeData['status']).status === 'CLOSED'
        ? []
        : [{ id: 'next', label: labels.next }]
    case 'transfer':
    case 'end':
      return []
  }
}

/** Every connection: with an arrow and an ✕ to remove it (DeletableEdge). */
export const EDGE_DEFAULTS = {
  type: 'deletable',
  markerEnd: { type: MarkerType.ArrowClosed },
} as const

/** The title of a card travels inside its canvas data, next to its settings. */
export const titleOf = (data: Record<string, unknown>) =>
  typeof data.title === 'string' ? data.title : ''

/** "Respuesta del usuario" of a card, also kept in its canvas data. */
export const triggerOf = (data: Record<string, unknown>) =>
  typeof data.trigger === 'string' ? data.trigger : ''

/** A message or link that waits for an answer instead of moving on. */
export const waitsForAnswer = (kind: NodeKind | undefined, data: Record<string, unknown>) =>
  (kind === 'message' || kind === 'url') && data.wait === true

export function fromGraph(graph: FlowGraph): { nodes: EditorNode[]; edges: EditorEdge[] } {
  // Menus had an "otra respuesta" output: the chatbot now answers that itself.
  const menus = new Set(
    graph.nodes
      .filter((node) => node.type === 'buttons' || node.type === 'list')
      .map((node) => node.id),
  )
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...(node.data as Record<string, unknown>),
        title: node.title ?? '',
        trigger: node.trigger ?? '',
      },
      deletable: node.type !== 'start',
    })),
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

export function toGraph(nodes: EditorNode[], edges: EditorEdge[]): FlowGraph {
  // Cards reached by buttons, lists or a card that moves on by itself are
  // not opened by words: their "Respuesta del usuario" is dropped.
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const locked = new Set(
    edges
      .filter((edge) => {
        const source = byId.get(edge.source)
        return !waitsForAnswer(source?.type, source?.data ?? {})
      })
      .map((edge) => edge.target),
  )
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

/** One-line summary of a node for its card on the canvas. */
export function preview(kind: NodeKind, data: Record<string, unknown>): string {
  switch (kind) {
    case 'message': {
      const message = data as NodeData['message']
      return (
        message.text ||
        (message.attachments[0] ? es.chatbots.tester.file(message.attachments[0].filename) : '')
      )
    }
    case 'buttons':
    case 'list':
    case 'url':
      return (data as NodeData['buttons']).body
    case 'question':
      return (data as NodeData['question']).text
    case 'status':
      return es.chatbots.node.statuses[(data as NodeData['status']).status]
    default:
      return ''
  }
}
