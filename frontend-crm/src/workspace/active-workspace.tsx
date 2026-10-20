import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMe } from '../auth/useMe'
import { ActiveWorkspaceContext } from './active-workspace-context'

const STORAGE_KEY = 'crm.activeWorkspaceId'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Remembers which workspace the user is working in. For now this only drives
 * the UI; workspace-scoped API calls arrive with the workspace endpoints.
 * The server still authorizes every request, whatever is selected here.
 */
export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const [selectedId, setSelectedId] = useState<string | null>(readStored)

  const workspaces = useMemo(
    () =>
      (me?.workspaces ?? []).filter(
        (w) => w.membershipStatus === 'ACTIVE' && w.status === 'ACTIVE',
      ),
    [me],
  )
  const active = workspaces.find((w) => w.id === selectedId) ?? workspaces[0] ?? null

  const select = useCallback((workspaceId: string) => {
    setSelectedId(workspaceId)
    try {
      localStorage.setItem(STORAGE_KEY, workspaceId)
    } catch {
      // Storage unavailable (private mode): the choice lasts for this tab only.
    }
  }, [])

  const value = useMemo(() => ({ workspaces, active, select }), [workspaces, active, select])
  return <ActiveWorkspaceContext value={value}>{children}</ActiveWorkspaceContext>
}
