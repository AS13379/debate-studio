export const ERROR_CATEGORIES = [
  'provider', 'network', 'authentication', 'validation', 'persistence', 'runtime', 'renderer', 'unknown'
] as const
export type ErrorCategory = typeof ERROR_CATEGORIES[number]

export const ERROR_SEVERITIES = ['warning', 'error', 'critical'] as const
export type ErrorSeverity = typeof ERROR_SEVERITIES[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = typeof LOG_LEVELS[number]

export interface ErrorRecord {
  id: string
  timestamp: string
  category: ErrorCategory
  severity: ErrorSeverity
  title: string
  userMessage: string
  technicalMessage: string
  source: string
  sessionId?: string
  turnId?: string
  retryable: boolean
  metadata: Record<string, unknown>
}

export interface ErrorCaptureContext {
  source: string
  category?: ErrorCategory
  severity?: ErrorSeverity
  sessionId?: string
  turnId?: string
  metadata?: Record<string, unknown>
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  sessionId?: string
  turnId?: string
  metadata: Record<string, unknown>
}

export interface LogContext {
  source: string
  sessionId?: string
  turnId?: string
  metadata?: Record<string, unknown>
}

export interface LoggerLike {
  debug(message: string, context: LogContext): void
  info(message: string, context: LogContext): void
  warn(message: string, context: LogContext): void
  error(message: string, context: LogContext): void
}

export interface RuntimeDiagnosticSnapshot {
  stage: string
  status: string
  timestamp: string
}

export interface DiagnosticReport {
  generatedAt: string
  application: { name: string; version: string }
  system: Record<string, string>
  recentErrors: ErrorRecord[]
  recentRuntime?: RuntimeDiagnosticSnapshot
  testStatus: { status: string; descriptionZh: string }
}

export interface SessionPerformanceMetric {
  sessionId: string
  status: string
  totalDurationMs: number
  turnCount: number
  averageResponseMs: number
  maxGenerationCharacters: number
}

export interface PerformanceMetricSummary {
  count: number
  averageMs: number
  maxMs: number
  p95Ms: number
}

export interface PerformanceSnapshot {
  generatedAt: string
  sessions: SessionPerformanceMetric[]
  sqlite: PerformanceMetricSummary
  renderer: PerformanceMetricSummary
  exports: PerformanceMetricSummary & { completed: number; failed: number; cancelled: number }
  memoryPeakBytes?: number
}
