const SENSITIVE_FIELD = /api[-_]?key|token|secret|password|authorization|credential/i
const KEY_LIKE_VALUE = /\b(?:sk|pk|key|token)-[A-Za-z0-9._-]{8,}\b/g
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi
const ASSIGNMENT_VALUE = /\b(api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi

export const REDACTED = '[REDACTED]'

export function maskSecret(secret: string, visibleStart = 3, visibleEnd = 3): string {
  if (!secret || secret.length <= visibleStart + visibleEnd + 4) return REDACTED
  return `${secret.slice(0, visibleStart)}…${secret.slice(-visibleEnd)}`
}

export function redactSensitiveText(text: string, knownSecrets: readonly string[] = []): string {
  let redacted = text
  for (const secret of [...knownSecrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join(REDACTED)
  }
  return redacted
    .replace(BEARER_VALUE, `Bearer ${REDACTED}`)
    .replace(ASSIGNMENT_VALUE, (_match, label: string) => `${label}=${REDACTED}`)
    .replace(KEY_LIKE_VALUE, REDACTED)
}

export function redactForExport<T>(value: T, knownSecrets: readonly string[] = []): T {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, key?: string): unknown => {
    if (key && SENSITIVE_FIELD.test(key)) return REDACTED
    if (typeof current === 'string') return redactSensitiveText(current, knownSecrets)
    if (!current || typeof current !== 'object') return current
    if (seen.has(current)) return REDACTED
    seen.add(current)
    if (Array.isArray(current)) return current.map((item) => visit(item))
    return Object.fromEntries(Object.entries(current).map(([entryKey, entryValue]) => [entryKey, visit(entryValue, entryKey)]))
  }

  return visit(value) as T
}

