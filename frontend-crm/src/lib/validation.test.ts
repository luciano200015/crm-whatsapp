import { describe, expect, it } from 'vitest'
import { es } from '../i18n/es'
import { describeDevice } from './device'
import { safeRedirect } from './redirect'
import { resetSchema, signUpSchema } from './validation'

const valid = {
  displayName: 'Ana López',
  email: 'ana@example.com',
  confirmEmail: 'ana@example.com',
  workspaceName: 'Acme',
  password: 'correct horse battery staple',
}

const issues = (result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) => result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]) ?? []

describe('signUpSchema', () => {
  it('accepts a valid form', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it('requires both emails to match (case-insensitive)', () => {
    expect(signUpSchema.safeParse({ ...valid, confirmEmail: 'ANA@example.com' }).success).toBe(true)
    expect(
      issues(signUpSchema.safeParse({ ...valid, confirmEmail: 'other@example.com' })),
    ).toContainEqual(['confirmEmail', es.validation.emailsMismatch])
  })

  it('applies the backend password policy', () => {
    expect(issues(signUpSchema.safeParse({ ...valid, password: 'short' }))).toContainEqual([
      'password',
      es.validation.passwordMin(12),
    ])
    expect(issues(signUpSchema.safeParse({ ...valid, password: 'x'.repeat(129) }))).toContainEqual([
      'password',
      es.validation.passwordMax(128),
    ])
  })

  it('rejects the email as password', () => {
    const email = 'long.address@example.com'
    expect(
      issues(signUpSchema.safeParse({ ...valid, email, confirmEmail: email, password: email })),
    ).toContainEqual(['password', es.validation.passwordIsEmail])
  })
})

describe('resetSchema', () => {
  it('requires the confirmation to match', () => {
    expect(
      issues(
        resetSchema.safeParse({ password: 'a long new passphrase', confirm: 'different one!!' }),
      ),
    ).toContainEqual(['confirm', es.validation.passwordsMismatch])
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/account/security', '/account/security'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('maps %p to %p', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})

describe('describeDevice', () => {
  it('summarizes common user agents', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toEqual({ label: 'Chrome · Windows', mobile: false })
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ label: 'Safari · iOS', mobile: true })
    expect(describeDevice(null).label).toBe(es.security.unknownDevice)
  })
})
