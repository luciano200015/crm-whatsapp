/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Defaults to the dev proxy path `/api/v1`. */
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BRAND_NAME?: string
  readonly VITE_BRAND_TAGLINE?: string
  readonly VITE_BRAND_LOGO_URL?: string
  readonly VITE_PRIMARY_COLOR?: string
  readonly VITE_DEFAULT_COLOR_MODE?: string
  /** Shown on "check your email" screens in development. */
  readonly VITE_MAILPIT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
