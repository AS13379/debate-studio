import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

import { sanitizeObservabilityMetadata, sanitizeObservabilityText } from './sanitizer'
import type {
  DiagnosticReport, ErrorCaptureContext, ErrorCategory, ErrorRecord, ErrorSeverity, RuntimeDiagnosticSnapshot
} from './types'

export interface ErrorCenterOptions {
  filePath: string
  appVersion: string
  systemInfo?: Record<string, string>
  maxRecords?: number
  createId?: () => string
  now?: () => Date
  testStatus?: DiagnosticReport['testStatus']
}

export class ErrorCenter {
  private readonly records: ErrorRecord[]
  private readonly maxRecords: number
  private readonly createId: () => string
  private readonly now: () => Date
  private runtimeSnapshot?: RuntimeDiagnosticSnapshot

  constructor(private readonly options: ErrorCenterOptions) {
    this.maxRecords = Math.max(1, options.maxRecords ?? 200)
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    ensurePrivateDirectory(dirname(options.filePath))
    this.records = this.readRecords().slice(-this.maxRecords)
  }

  capture(error: unknown, context: ErrorCaptureContext): ErrorRecord {
    const structured = isRecord(error) ? error : {}
    const code = stringValue(structured.code)
    const timestamp = this.now().toISOString()
    const record: ErrorRecord = {
      id: this.createId(), timestamp,
      category: context.category ?? inferCategory(code, context.source),
      severity: context.severity ?? inferSeverity(code),
      title: sanitizeObservabilityText(structured.titleZh ?? structured.title, '应用运行错误'),
      userMessage: sanitizeObservabilityText(structured.descriptionZh ?? structured.userMessage, '操作未能完成，请查看详情或稍后重试。'),
      technicalMessage: sanitizeObservabilityText(
        structured.technicalDetails ?? structured.technicalMessage ?? structured.message ?? (error instanceof Error ? error.message : code),
        code || '未知错误'
      ),
      source: sanitizeObservabilityText(context.source, 'unknown'),
      sessionId: context.sessionId ? sanitizeObservabilityText(context.sessionId) : undefined,
      turnId: context.turnId ? sanitizeObservabilityText(context.turnId) : undefined,
      retryable: typeof structured.retryable === 'boolean' ? structured.retryable : false,
      metadata: sanitizeObservabilityMetadata({
        ...context.metadata,
        ...(code ? { code } : {}),
        ...(typeof structured.statusCode === 'number' ? { statusCode: structured.statusCode } : {}),
        ...(typeof structured.providerCode === 'string' ? { providerCode: structured.providerCode } : {}),
        ...(typeof structured.operation === 'string' ? { operation: structured.operation } : {})
      })
    }
    const duplicate = this.records.at(-1)
    if (duplicate && duplicate.source === record.source && duplicate.title === record.title &&
      duplicate.technicalMessage === record.technicalMessage && duplicate.sessionId === record.sessionId &&
      duplicate.turnId === record.turnId && Date.parse(record.timestamp) - Date.parse(duplicate.timestamp) < 2_000) {
      return cloneRecord(duplicate)
    }
    this.records.push(record)
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords)
    this.persist()
    return { ...record, metadata: { ...record.metadata } }
  }

  listRecentErrors(limit = 100): ErrorRecord[] {
    return this.records.slice(-Math.max(0, limit)).reverse().map(cloneRecord)
  }

  getErrorDetail(id: string): ErrorRecord | undefined {
    const found = this.records.find((record) => record.id === id)
    return found ? cloneRecord(found) : undefined
  }

  clearErrors(): void {
    this.records.length = 0
    try { rmSync(this.options.filePath, { force: true }) } catch { /* best effort */ }
  }

  updateRuntimeSnapshot(stage: string, status: string, timestamp = this.now().toISOString()): void {
    this.runtimeSnapshot = {
      stage: sanitizeObservabilityText(stage), status: sanitizeObservabilityText(status), timestamp
    }
  }

  exportDiagnosticReport(): DiagnosticReport {
    return {
      generatedAt: this.now().toISOString(),
      application: { name: 'Debate Studio', version: sanitizeObservabilityText(this.options.appVersion, 'unknown') },
      system: sanitizeStringRecord(this.options.systemInfo ?? {}),
      recentErrors: this.listRecentErrors(this.maxRecords),
      recentRuntime: this.runtimeSnapshot ? { ...this.runtimeSnapshot } : undefined,
      testStatus: this.options.testStatus ?? {
        status: 'not-run-in-app',
        descriptionZh: '自动化测试不会在用户应用内自动运行；请以发布验证记录为准。'
      }
    }
  }

  private readRecords(): ErrorRecord[] {
    if (!existsSync(this.options.filePath)) return []
    try {
      return readFileSync(this.options.filePath, 'utf8').split('\n').flatMap((line): ErrorRecord[] => {
        if (!line.trim()) return []
        try { return [JSON.parse(line) as ErrorRecord] } catch { return [] }
      })
    } catch { return [] }
  }

  private persist(): void {
    try {
      ensurePrivateDirectory(dirname(this.options.filePath))
      const body = this.records.map((record) => JSON.stringify(record)).join('\n')
      writeFileSync(this.options.filePath, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 })
      chmodSync(this.options.filePath, 0o600)
    } catch {
      // Error capture remains available in memory if its diagnostic file cannot be written.
    }
  }
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

function inferCategory(code: string, source: string): ErrorCategory {
  const value = `${code} ${source}`.toLowerCase()
  if (/credential|auth|unauthor|keychain/.test(value)) return 'authentication'
  if (/validation|invalid|schema/.test(value)) return 'validation'
  if (/network|http|transport|timeout|stream|fetch/.test(value)) return 'network'
  if (/provider|model|adapter|openai|tavily|search/.test(value)) return 'provider'
  if (/sqlite|database|persistence|repository|migration/.test(value)) return 'persistence'
  if (/renderer/.test(value)) return 'renderer'
  if (/runtime|runner|session|turn/.test(value)) return 'runtime'
  return 'unknown'
}

function inferSeverity(code: string): ErrorSeverity {
  return /validation|invalid|cancelled|rate.?limit/i.test(code) ? 'warning' : 'error'
}

function cloneRecord(record: ErrorRecord): ErrorRecord {
  return { ...record, metadata: { ...record.metadata } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeObservabilityText(item)]))
}
