import { useState } from 'react'

// Survives React StrictMode's double initializer call: the first call strips
// the token from the URL, the second must still be able to read it.
const captured = new Map<string, string>()

/**
 * Reads a one-time token from ?token= once and removes it from the address
 * bar right away, so it does not stay in history or leak through Referer.
 */
export function useTokenFromUrl(): string | null {
  const [token] = useState(() => {
    const url = new URL(window.location.href)
    const value = url.searchParams.get('token')
    if (value) {
      captured.set(url.pathname, value)
      url.searchParams.delete('token')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }
    return captured.get(url.pathname) ?? null
  })
  return token
}
