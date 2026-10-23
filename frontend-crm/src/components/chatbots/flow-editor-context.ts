import { createContext, useContext } from 'react'
import type { FlowIssue } from '../../lib/api/chatbots'
import type { TagSummary } from '../../lib/api/types'

export interface FlowEditorValue {
  /** Issues of the last save, by node. */
  issues: Map<string, FlowIssue[]>
  tags: Map<string, TagSummary>
  /** Opens the node's settings. */
  onEdit: (nodeId: string) => void
}

export const FlowEditorContext = createContext<FlowEditorValue>({
  issues: new Map(),
  tags: new Map(),
  onEdit: () => {},
})

export const useFlowEditor = () => useContext(FlowEditorContext)
