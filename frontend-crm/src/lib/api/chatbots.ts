import { apiRequest, apiResponse } from './client'
import { ApiError } from './errors'
import type { ErrorResponse } from './types'

/** The kinds of node of a chatbot flow (see the backend's chatbots/domain/flow.ts). */
export type NodeKind =
  | 'start'
  | 'message'
  | 'buttons'
  | 'list'
  | 'url'
  | 'question'
  | 'condition'
  | 'hours'
  | 'tags'
  | 'funnel'
  | 'transfer'
  | 'status'
  | 'end'

export interface BotMedia {
  fileId: string
  type: 'image' | 'video' | 'audio' | 'document'
  mimeType: string
  filename: string
  size: number
}

export interface FlowOption {
  id: string
  title: string
}

export interface FlowListRow extends FlowOption {
  description: string
}

export interface FlowListSection {
  id: string
  title: string
  rows: FlowListRow[]
}

export interface ScheduleRange {
  from: string
  to: string
}

export interface Schedule {
  timezone: string
  days: { day: number; ranges: ScheduleRange[] }[]
}

export type Validation = 'any' | 'number' | 'email' | 'phone'
export type Operator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'is_number'
  | 'is_empty'
  | 'greater_than'
  | 'less_than'
  | 'is_true'
  | 'is_false'

/** How long the bot stays off in a chat: a day (it comes back alone) or until turned on. */
export type BotPause = '24h' | 'permanent'

export type VariableType = 'text' | 'number' | 'boolean'

/** A variable created for the chatbot ({{name}} in texts). */
export interface BotVariable {
  name: string
  type: VariableType
  /** '' none; 'true' / 'false' for yes/no. */
  defaultValue: string
  description: string
}

export interface ConditionRule {
  id: string
  source: 'message' | 'variable'
  variable: string
  operator: Operator
  value: string
}

export interface NodeData {
  start: Record<string, never>
  /** One file takes the text as caption; several go after it. */
  /** wait: waits for an answer instead of "Enviar mensaje y saltar al siguiente nodo". */
  message: { text: string; attachments: BotMedia[]; wait?: boolean }
  buttons: {
    header: string
    body: string
    footer: string
    buttons: FlowOption[]
    invalidText: string
    /** Sent before the buttons. */
    attachments: BotMedia[]
  }
  list: {
    header: string
    body: string
    footer: string
    button: string
    sections: FlowListSection[]
    invalidText: string
    attachments: BotMedia[]
  }
  url: { header: string; body: string; footer: string; text: string; url: string; wait?: boolean }
  question: {
    text: string
    variable: string
    validation: Validation
    invalidText: string
    /** Also saves the answer in the contact. */
    saveTo: 'none' | 'name' | 'email'
  }
  condition: { rules: ConditionRule[] }
  hours: { schedule: Schedule }
  tags: { add: string[]; remove: string[] }
  /** «Establecer contacto en embudo». */
  funnel: { funnelId: string; stageId: string }
  transfer: {
    to: 'auto' | 'unassigned' | 'member'
    membershipId: string | null
    /** Told to the customer after the handover; {{agente}}: who got the chat. Empty: nothing. */
    message?: string
    /** How long the bot stays off in the chat afterwards. */
    pause?: BotPause
  }
  status: { status: 'OPEN' | 'ON_HOLD' | 'CLOSED' }
  end: Record<string, never>
}

export type FlowNode = {
  [K in NodeKind]: {
    id: string
    type: K
    /** Name of the card in the diagram, only for whoever builds the flow. */
    title: string
    /** "Respuesta del usuario": words (comma separated) that open the card. */
    trigger?: string
    position: { x: number; y: number }
    data: NodeData[K]
  }
}[NodeKind]

export interface FlowEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowIssue {
  nodeId: string | null
  level: 'error' | 'warning'
  message: string
}

export interface ChatbotSummary {
  id: string
  name: string
  description: string
  enabled: boolean
  lines: { id: string; name: string }[]
  /** Errors to fix before it can be turned on. */
  errors: number
  createdAt: string
  updatedAt: string
}

/** General settings ("Configuración del Chatbot"). */
export interface ChatbotSettings {
  description: string
  schedule: Schedule | null
  /** Idle minutes before the conversation starts again with the greeting. */
  restartAfterMinutes: number
  /** Sent when the customer writes something the flow does not expect. */
  fallbackText: string
  /** Words that send the customer back to the greeting. */
  restartKeywords: string[]
  /** Minutes without an answer before the inactivity message; null: never. */
  inactivityMinutes: number | null
  inactivityText: string
}

export interface Chatbot extends ChatbotSummary, ChatbotSettings {
  graph: FlowGraph
  variables: BotVariable[]
  /** Contact data every bot can use: {{nombre}}, {{email}}… */
  contactVariables: string[]
  issues: FlowIssue[]
}

export interface ChatbotChanges extends Partial<ChatbotSettings> {
  name?: string
  enabled?: boolean
  graph?: FlowGraph
  variables?: BotVariable[]
}

export interface InteractiveContent {
  kind: 'buttons' | 'list' | 'cta_url'
  header: string | null
  body: string
  footer: string | null
  buttons?: { id: string; title: string }[]
  list?: {
    button: string
    sections: {
      title: string | null
      rows: { id: string; title: string; description: string | null }[]
    }[]
  }
  url?: { text: string; url: string }
}

export type BotMessage =
  | { kind: 'text'; text: string }
  | { kind: 'interactive'; content: InteractiveContent }
  | { kind: 'media'; media: BotMedia; caption: string | null }

export type BotAction =
  | { kind: 'send'; message: BotMessage }
  | { kind: 'tags'; add: string[]; remove: string[] }
  | { kind: 'funnel'; funnelId: string; stageId: string }
  | {
      kind: 'transfer'
      to: 'auto' | 'unassigned' | 'member'
      membershipId: string | null
      message?: string | null
      pause?: BotPause
    }
  | { kind: 'status'; status: 'OPEN' | 'ON_HOLD' | 'CLOSED' }
  | { kind: 'contact'; field: 'name' | 'email'; value: string }

export interface SimulationSession {
  /** null: the flow ended; what the customer writes gets the fallback text. */
  nodeId: string | null
  vars: Record<string, string>
  attempts: number
}

export interface Simulation {
  actions: BotAction[]
  session: SimulationSession | null
}

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/chatbots`
const one = (workspaceId: string, id: string) => `${base(workspaceId)}/${encodeURIComponent(id)}`

export const chatbotKeys = {
  all: (workspaceId: string) => ['chatbots', workspaceId] as const,
  one: (workspaceId: string, id: string) => ['chatbots', workspaceId, id] as const,
  media: (workspaceId: string, id: string, fileId: string) =>
    ['chatbots', workspaceId, id, 'media', fileId] as const,
}

export const chatbotsApi = {
  list(workspaceId: string, signal?: AbortSignal) {
    return apiRequest<ChatbotSummary[]>(base(workspaceId), { signal })
  },
  get(workspaceId: string, id: string, signal?: AbortSignal) {
    return apiRequest<Chatbot>(one(workspaceId, id), { signal })
  },
  create(workspaceId: string, name: string) {
    return apiRequest<Chatbot>(base(workspaceId), { method: 'POST', body: { name } })
  },
  update(workspaceId: string, id: string, changes: ChatbotChanges) {
    return apiRequest<Chatbot>(one(workspaceId, id), { method: 'PATCH', body: changes })
  },
  remove(workspaceId: string, id: string) {
    return apiRequest<void>(one(workspaceId, id), { method: 'DELETE' })
  },
  duplicate(workspaceId: string, id: string) {
    return apiRequest<Chatbot>(`${one(workspaceId, id)}/duplicate`, { method: 'POST' })
  },
  setLines(workspaceId: string, id: string, lineIds: string[], takeOver = false) {
    return apiRequest<Chatbot>(`${one(workspaceId, id)}/lines`, {
      method: 'PUT',
      body: { lineIds, takeOver },
    })
  },
  uploadMedia(workspaceId: string, id: string, file: File) {
    const form = new FormData()
    form.set('file', file, file.name)
    return apiRequest<BotMedia>(`${one(workspaceId, id)}/media`, { method: 'POST', body: form })
  },
  async media(workspaceId: string, id: string, fileId: string, signal?: AbortSignal) {
    const response = await apiResponse(
      `${one(workspaceId, id)}/media/${encodeURIComponent(fileId)}`,
      { accept: '*/*', signal },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ErrorResponse | null
      throw new ApiError(response.status, body)
    }
    return response.blob()
  },
  simulate(
    workspaceId: string,
    input: {
      graph: FlowGraph
      session: SimulationSession | null
      text: string | null
      replyId: string | null
      contactName: string | null
      fallbackText?: string
      restartKeywords?: string[]
      variables?: BotVariable[]
    },
  ) {
    return apiRequest<Simulation>(`${base(workspaceId)}/simulate`, {
      method: 'POST',
      body: input,
    })
  },
}
