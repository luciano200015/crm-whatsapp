import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom has no matchMedia; MUI's color-scheme detection needs it.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

// jsdom has no object URLs; media previews and downloads use them.
if (!URL.createObjectURL) {
  let next = 0
  URL.createObjectURL = () => `blob:test/${++next}`
  URL.revokeObjectURL = () => undefined
}

// Routes are lazy-loaded: the first render of a test file compiles the page
// on demand, which can exceed the 1 s default when several files run at once.
configure({ asyncUtilTimeout: 15_000 })

afterEach(() => {
  cleanup()
  localStorage.clear()
})
