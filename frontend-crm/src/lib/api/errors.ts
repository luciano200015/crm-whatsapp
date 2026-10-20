import { es } from '../../i18n/es'
import type { ErrorResponse } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorResponse | null

  constructor(status: number, body: ErrorResponse | null) {
    super(apiMessage(body) ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  /** Server validation messages as a list (the API may send one or many). */
  get messages(): string[] {
    const message = this.body?.message
    if (Array.isArray(message)) return message
    return message ? [message] : []
  }
}

/** Raised when fetch itself fails (server down, offline, CORS). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(es.errors.network, { cause })
    this.name = 'NetworkError'
  }
}

function apiMessage(body: ErrorResponse | null): string | undefined {
  if (!body) return undefined
  return Array.isArray(body.message) ? body.message.join('. ') : body.message
}

/**
 * Human-readable message for any error thrown by the API layer.
 * `overrides` maps status codes to screen-specific texts (e.g. 401 on login).
 */
export function errorMessage(
  error: unknown,
  overrides: Partial<Record<number, string>> = {},
): string {
  if (error instanceof NetworkError) return error.message
  if (error instanceof ApiError) {
    const override = overrides[error.status]
    if (override) return override
    const translated = translateCode(error.body)
    if (translated) return translated
    if (error.status === 429) return es.errors.tooManyRequests
    if (error.status >= 500) return es.errors.generic
    return error.messages.join('. ') || es.errors.generic
  }
  return es.errors.generic
}

type Translator = (details: Record<string, unknown>) => string

/** Localized text for API errors that carry a stable `code`. */
function translateCode(body: ErrorResponse | null): string | undefined {
  if (!body?.code) return undefined
  const translators: Record<string, Translator | string> = es.apiErrors
  const translator = translators[body.code]
  if (!translator) return undefined
  return typeof translator === 'string' ? translator : translator(body.details ?? {})
}
