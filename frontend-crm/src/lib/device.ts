import { es } from '../i18n/es'

/** Rough, dependency-free user-agent summary ("Chrome · Windows"). */
export function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: es.security.unknownDevice, mobile: false }
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
  const label = [browser, os].filter(Boolean).join(' · ')
  return {
    label: label || es.security.unknownDevice,
    mobile: /Mobile|Android|iPhone/.test(userAgent),
  }
}
