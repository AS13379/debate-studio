export { ErrorCenter } from './error-center'
export type { ErrorCenterOptions } from './error-center'
export { ObservedCredentialStore } from './observed-credential-store'
export { sanitizeObservabilityMetadata, sanitizeObservabilityText } from './sanitizer'
export { StructuredLogger } from './structured-logger'
export { StructuredLogger as Logger } from './structured-logger'
export { PerformanceMetricsCollector } from './performance-metrics'
export type { PerformanceMetricsOptions } from './performance-metrics'
export type { StructuredLoggerOptions } from './structured-logger'
export { ERROR_CATEGORIES, ERROR_SEVERITIES, LOG_LEVELS } from './types'
export type {
  DiagnosticReport, ErrorCaptureContext, ErrorCategory, ErrorRecord, ErrorSeverity,
  LogContext, LogEntry, LogLevel, LoggerLike, PerformanceMetricSummary, PerformanceSnapshot,
  RuntimeDiagnosticSnapshot, SessionPerformanceMetric
} from './types'
