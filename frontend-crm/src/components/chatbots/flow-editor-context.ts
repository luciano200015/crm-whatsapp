import { createContext, useContext } from 'react'
import type { BotVariable, FlowIssue } from '../../lib/api/chatbots'
import type { ContactField } from '../../lib/api/contacts'
import type { TagSummary } from '../../lib/api/types'

export interface FlowEditorValue {
  /** Issues of the last save, by node. */
  issues: Map<string, FlowIssue[]>
  tags: Map<string, TagSummary>
  /** «Mensaje de usuario» of each card: the option or words that open it. */
  userMessages: Map<string, string>
  /** Opens the node's settings. */
  onEdit: (nodeId: string) => void
  onDuplicate: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  /** Variables of the bot, and the contact data every bot can use. */
  variables: BotVariable[]
  contactVariables: string[]
  /** Custom fields of contacts: {{campo_<key>}}. */
  contactFields: ContactField[]
  /** Opens the "Variables" dialog. */
  onOpenVariables: () => void
  /** Lines of the bot: its funnel nodes should use funnels of these. */
  lineIds: string[]
}

export const FlowEditorContext = createContext<FlowEditorValue>({
  issues: new Map(),
  tags: new Map(),
  userMessages: new Map(),
  onEdit: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
  variables: [],
  contactVariables: ['nombre', 'apellido', 'nombre_completo', 'email', 'telefono'],
  contactFields: [],
  onOpenVariables: () => {},
  lineIds: [],
})

export const useFlowEditor = () => useContext(FlowEditorContext)

/** {{campo_<key>}}: a custom field of the contact in texts and conditions. */
export const fieldVariable = (key: string) => `campo_${key}`
