import { createContext, useContext } from 'react'
import type { BotVariable, FlowIssue } from '../../lib/api/chatbots'
import type { TagSummary } from '../../lib/api/types'

export interface FlowEditorValue {
  /** Issues of the last save, by node. */
  issues: Map<string, FlowIssue[]>
  tags: Map<string, TagSummary>
  /** Opens the node's settings. */
  onEdit: (nodeId: string) => void
  /** Variables of the bot, and the contact data every bot can use. */
  variables: BotVariable[]
  contactVariables: string[]
  /** Opens the "Variables" dialog. */
  onOpenVariables: () => void
  /** Lines of the bot: its funnel nodes should use funnels of these. */
  lineIds: string[]
}

export const FlowEditorContext = createContext<FlowEditorValue>({
  issues: new Map(),
  tags: new Map(),
  onEdit: () => {},
  variables: [],
  contactVariables: ['nombre', 'apellido', 'nombre_completo', 'email', 'telefono'],
  onOpenVariables: () => {},
  lineIds: [],
})

export const useFlowEditor = () => useContext(FlowEditorContext)
