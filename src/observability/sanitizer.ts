import { redactSensitiveText, REDACTED } from '../security'

const OMITTED_FIELD = /api[-_]?key|token|secret|password|authorization|credential|prompt|messages?|content|body|private|research|pageText|sourceText/i
const SAFE_STRING_LIMIT = 500
const SAFE_DEPTH_LIMIT = 4

export function sanitizeObservabilityText(value: unknown, fallback = '未提供技术信息。'): string {
  const text = typeof value === 'string' ? value : value instanceof Error ? value.message : fallback
  return redactSensitiveText(text)
    .replace(/\b(?:api[-_]?key|authorization|credential(?:Ref)?|token|secret|password)\b/gi, '[SENSITIVE_FIELD]')
    .slice(0, SAFE_STRING_LIMIT)
}

export function sanitizeObservabilityMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>())
  return isRecord(sanitized) ? sanitized : {}
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > SAFE_DEPTH_LIMIT) return '[TRUNCATED]'
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, SAFE_STRING_LIMIT)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (value === undefined) return undefined
  if (typeof value !== 'object') return String(value).slice(0, SAFE_STRING_LIMIT)
  if (seen.has(value)) return REDACTED
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1, seen))

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (OMITTED_FIELD.test(key)) continue
    const safe = sanitizeValue(entry, depth + 1, seen)
    if (safe !== undefined) output[key] = safe
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
