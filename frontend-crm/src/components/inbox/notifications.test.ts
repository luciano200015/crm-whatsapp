import { describe, expect, it } from 'vitest'
import { withUnreadCount } from './notifications'

describe('withUnreadCount', () => {
  it('puts the unread count in front of the title once', () => {
    expect(withUnreadCount('Bandeja | CRM', 3)).toBe('(3) Bandeja | CRM')
    expect(withUnreadCount('(3) Bandeja | CRM', 5)).toBe('(5) Bandeja | CRM')
    expect(withUnreadCount('(5) Bandeja | CRM', 0)).toBe('Bandeja | CRM')
    expect(withUnreadCount('Bandeja | CRM', 150)).toBe('(99+) Bandeja | CRM')
  })
})
