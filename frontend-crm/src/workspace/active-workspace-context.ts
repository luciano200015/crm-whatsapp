import { createContext, use } from 'react'
import type { MyWorkspace } from '../lib/api/types'

export interface ActiveWorkspaceValue {
  /** Workspaces where the membership and the workspace are both active. */
  workspaces: MyWorkspace[]
  active: MyWorkspace | null
  select: (workspaceId: string) => void
}

export const ActiveWorkspaceContext = createContext<ActiveWorkspaceValue | null>(null)

export function useActiveWorkspace(): ActiveWorkspaceValue {
  const context = use(ActiveWorkspaceContext)
  if (!context) throw new Error('useActiveWorkspace must be used inside <ActiveWorkspaceProvider>')
  return context
}
