/** Only same-app paths are allowed as redirect targets (no open redirects). */
export function safeRedirect(target: string | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/'
  return target
}
