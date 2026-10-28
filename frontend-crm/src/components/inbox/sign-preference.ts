import { useState } from 'react'

const KEY = 'crm.inbox.sign'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * «Firmar mensajes» chosen by the agent (when the workspace lets them
 * choose), remembered in this browser.
 */
export function useSignPreference(): [boolean, (sign: boolean) => void] {
  const [sign, setSign] = useState(read)
  const change = (value: boolean) => {
    setSign(value)
    try {
      localStorage.setItem(KEY, value ? '1' : '0')
    } catch {
      // Private mode: it lasts until the page reloads.
    }
  }
  return [sign, change]
}
