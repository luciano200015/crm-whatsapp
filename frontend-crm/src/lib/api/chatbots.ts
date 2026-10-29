import { apiRequest, apiResponse } from './client'
import { ApiError } from './errors'
import type { ErrorResponse } from './types'

/** The kinds of node of a chatbot flow (see the backend's chatbots/domain/flow.ts). */
export type NodeKind =
  | 'start'
  | 'message'
  | 'url'
  | 'question'
  | 'location'
  | 'contact_card'
  | 'condition'
  | 'hours'
  | 'tags'
  | 'funnel'
  | 'contact_field'
  | 'api'
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

/** An option of «Botones interactivos»: a button, or a row when they go as a list. */
export interface FlowOption {
  id: string
  title: string
  /** Only shown when the options go as a list ('' none). */
  description?: string
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
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'is_number'
  | 'is_not_number'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'gte'
  | 'less_than'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'is_true'
  | 'is_false'

/** «Cumplimiento de condiciones»: all, any (Cumple / No cumple) or one way out per rule. */
export type ConditionMatch = 'all' | 'any' | 'each'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ApiAuth = 'none' | 'bearer' | 'basic' | 'headers'
export interface KeyValue {
  key: string
  value: string
}

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
  /**
   * «Respuesta». Without options, one file takes the text as caption and
   * several go after it; wait: waits for an answer instead of "Enviar mensaje
   * y saltar al siguiente nodo". With options («Botones interactivos») it
   * waits for one: up to 3 short ones go as buttons, more as a list.
   */
  message: {
    text: string
    attachments: BotMedia[]
    wait?: boolean
    options: FlowOption[]
    /** «Nombre del botón de la lista» ('' «Ver opciones»). */
    listButton: string
    header: string
    footer: string
    /** «Texto si elige otra cosa» ('' the bot's fallback text). */
    invalidText: string
  }
  url: {
    header: string
    body: string
    footer: string
    text: string
    url: string
    wait?: boolean
    /** An image, video or document above the text. */
    attachment: BotMedia | null
  }
  question: {
    /** '' saves the message that opened the card (it needs a trigger). */
    text: string
    variable: string
    validation: Validation
    invalidText: string
    /** Also saves the answer in the contact. */
    saveTo: 'none' | 'name' | 'email'
  }
  /** «Enviar ubicación». */
  location: { latitude: number | null; longitude: number | null; name: string; address: string }
  /** «Enviar contacto»: 1 to 5 cards. */
  contact_card: { contacts: { name: string; phone: string }[] }
  condition: { match: ConditionMatch; rules: ConditionRule[] }
  hours: { schedule: Schedule }
  tags: { add: string[]; remove: string[] }
  /** «Establecer contacto en embudo». */
  funnel: { funnelId: string; stageId: string }
  /** «Actualizar campo de contacto»: name, email or the key of a custom field. */
  contact_field: { field: string; source: 'answer' | 'manual'; value: string }
  /** «Consulta API»: an HTTPS call; `responses` save values of its JSON in variables. */
  api: {
    method: HttpMethod
    url: string
    auth: { type: ApiAuth; token: string; user: string; password: string }
    headers: KeyValue[]
    params: KeyValue[]
    responses: { path: string; variable: string }[]
  }
  transfer: {
    to: 'auto' | 'unassigned' | 'member'
    membershipId: string | null
    /** Told to the customer after the handover; {{agente}}: who got the chat. Empty: nothing. */
    message?: string
    /** How long the bot stays off in the chat afterwards. */
    pause?: BotPause
    /** «Mensaje para el agente»: an internal note in the chat ('' none). */
    note?: string
  }
  /** bot pause: «Desactivar bot» in that chat. */
  status: { status: 'OPEN' | 'ON_HOLD' | 'CLOSED'; bot?: 'keep' | 'pause' }
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
  /** A file shown above the buttons. */
  headerMedia?: { type: string; fileId: string; mimeType: string; filename: string } | null
}

export interface BotLocation {
  latitude: number
  longitude: number
  name: string | null
  address: string | null
}

export type BotMessage =
  | { kind: 'text'; text: string }
  | { kind: 'interactive'; content: InteractiveContent }
  | { kind: 'media'; media: BotMedia; caption: string | null }
  | { kind: 'location'; location: BotLocation }
  | { kind: 'contacts'; contacts: { name: string; phone: string }[] }

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
      note?: string | null
    }
  | { kind: 'status'; status: 'OPEN' | 'ON_HOLD' | 'CLOSED' }
  | { kind: 'pause' }
  /** name, email or the key of a custom field. */
  | { kind: 'contact'; field: string; value: string }

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

/** «Probar conexión» of a «Consulta API». */
export interface ApiTestResult {
  ok: boolean
  status: number
  error: string | null
  body: string
  values: { variable: string; value: string }[]
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
  testRequest(workspaceId: string, api: NodeData['api'], sample: Record<string, string>) {
    return apiRequest<ApiTestResult>(`${base(workspaceId)}/test-request`, {
      method: 'POST',
      body: { api, sample },
    })
  },
}
