import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '../lib/api/auth'
import { hasSessionCookie, refreshAccessToken, setSessionExpiredHandler } from '../lib/api/client'
import { tokenStore } from '../lib/api/token-store'
import { AuthContext, type AuthStatus } from './auth-context'

const CHANNEL = 'crm-auth'
/** Refresh proactively when 80% of the access token lifetime has passed. */
const REFRESH_AT = 0.8

type AuthMessage = { type: 'logout' } | { type: 'login' }

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const channel = useRef<BroadcastChannel | null>(null)

  const becomeAnonymous = useCallback(() => {
    tokenStore.clear()
    queryClient.clear()
    setStatus('anonymous')
  }, [queryClient])

  // Bootstrap: a page load has no access token; try the refresh cookie once.
  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const ok = hasSessionCookie() ? await refreshAccessToken().catch(() => false) : false
      if (!cancelled) setStatus(ok ? 'authenticated' : 'anonymous')
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // A failed refresh anywhere in the API layer ends the session.
  useEffect(() => {
    setSessionExpiredHandler(becomeAnonymous)
    return () => setSessionExpiredHandler(null)
  }, [becomeAnonymous])

  // Keep the session alive without waiting for a 401.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (token: string | null) => {
      clearTimeout(timer)
      if (!token) return
      const delay = tokenStore.msUntilExpiry() * REFRESH_AT
      timer = setTimeout(() => {
        void refreshAccessToken().then((ok) => {
          if (!ok) becomeAnonymous()
        })
      }, delay)
    }
    schedule(tokenStore.get())
    const unsubscribe = tokenStore.subscribe(schedule)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [becomeAnonymous])

  // Sign-in / sign-out in one tab is mirrored in the others.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(CHANNEL)
    channel.current = bc
    bc.onmessage = (event: MessageEvent<AuthMessage>) => {
      if (event.data.type === 'logout') becomeAnonymous()
      if (event.data.type === 'login') {
        void refreshAccessToken().then((ok) => setStatus(ok ? 'authenticated' : 'anonymous'))
      }
    }
    return () => {
      bc.close()
      channel.current = null
    }
  }, [becomeAnonymous])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login(email, password)
      queryClient.clear()
      setStatus('authenticated')
      channel.current?.postMessage({ type: 'login' } satisfies AuthMessage)
      return result.user
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      becomeAnonymous()
      channel.current?.postMessage({ type: 'logout' } satisfies AuthMessage)
    }
  }, [becomeAnonymous])

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}
