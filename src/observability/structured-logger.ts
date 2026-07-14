import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { sanitizeObservabilityMetadata, sanitizeObservabilityText } from './sanitizer'
import type { LogContext, LogEntry, LogLevel, LoggerLike } from './types'

export interface StructuredLoggerOptions {
  directory: string
  fileName?: string
  maxFileSizeBytes?: number
  maxFiles?: number
  createId?: () => string
  now?: () => Date
}

export class StructuredLogger implements LoggerLike {
  readonly filePath: string
  private readonly maxFileSizeBytes: number
  private readonly maxFiles: number
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(options: StructuredLoggerOptions) {
    this.filePath = join(options.directory, options.fileName ?? 'application.jsonl')
    this.maxFileSizeBytes = Math.max(512, options.maxFileSizeBytes ?? 512 * 1024)
    this.maxFiles = Math.max(1, options.maxFiles ?? 3)
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    mkdirSync(dirname(this.filePath), { recursive: true })
  }

  debug(message: string, context: LogContext): void { this.write('debug', message, context) }
  info(message: string, context: LogContext): void { this.write('info', message, context) }
  warn(message: string, context: LogContext): void { this.write('warn', message, context) }
  error(message: string, context: LogContext): void { this.write('error', message, context) }

  getRecentLogs(limit = 200): LogEntry[] {
    const entries: LogEntry[] = []
    for (let index = this.maxFiles; index >= 1; index -= 1) entries.push(...this.readFile(`${this.filePath}.${index}`))
    entries.push(...this.readFile(this.filePath))
    return entries.slice(-Math.max(0, limit))
  }

  clearLogs(): void {
    for (let index = 1; index <= this.maxFiles; index += 1) this.remove(`${this.filePath}.${index}`)
    this.remove(this.filePath)
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    const entry: LogEntry = {
      id: this.createId(), timestamp: this.now().toISOString(), level,
      message: sanitizeObservabilityText(message, '日志事件'), source: sanitizeObservabilityText(context.source, 'unknown'),
      sessionId: context.sessionId ? sanitizeObservabilityText(context.sessionId) : undefined,
      turnId: context.turnId ? sanitizeObservabilityText(context.turnId) : undefined,
      metadata: sanitizeObservabilityMetadata(context.metadata ?? {})
    }
    const line = `${JSON.stringify(entry)}\n`
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      if (existsSync(this.filePath) && statSync(this.filePath).size + Buffer.byteLength(line) > this.maxFileSizeBytes) this.rotate()
      appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Observability must never interrupt the application path it observes.
    }
  }

  private rotate(): void {
    this.remove(`${this.filePath}.${this.maxFiles}`)
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const from = `${this.filePath}.${index}`
      if (existsSync(from)) renameSync(from, `${this.filePath}.${index + 1}`)
    }
    if (existsSync(this.filePath)) renameSync(this.filePath, `${this.filePath}.1`)
  }

  private readFile(path: string): LogEntry[] {
    if (!existsSync(path)) return []
    try {
      return readFileSync(path, 'utf8').split('\n').flatMap((line): LogEntry[] => {
        if (!line.trim()) return []
        try { return [JSON.parse(line) as LogEntry] } catch { return [] }
      })
    } catch { return [] }
  }

  private remove(path: string): void {
    try { rmSync(path, { force: true }) } catch { /* best effort */ }
  }
}
