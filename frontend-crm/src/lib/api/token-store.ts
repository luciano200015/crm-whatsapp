/**
 * The access token lives only in memory: never in localStorage/sessionStorage,
 * where any injected script could read it. A page reload loses it on purpose;
 * the HttpOnly refresh cookie gets a new one (see AuthProvider bootstrap).
 */
type Listener = (token: string | null) => void

let accessToken: string | null = null
let expiresAt = 0
const listeners = new Set<Listener>()

export const tokenStore = {
  get(): string | null {
    return accessToken
  },

  /** Milliseconds until expiry (0 when there is no token). */
  msUntilExpiry(now = Date.now()): number {
    return accessToken ? Math.max(0, expiresAt - now) : 0
  },

  set(token: string, expiresInSeconds: number): void {
    accessToken = token
    expiresAt = Date.now() + expiresInSeconds * 1000
    listeners.forEach((listener) => listener(token))
  },

  clear(): void {
    if (accessToken === null) return
    accessToken = null
    expiresAt = 0
    listeners.forEach((listener) => listener(null))
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
