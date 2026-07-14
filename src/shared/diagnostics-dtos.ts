export type ErrorCategoryDto =
  | 'provider' | 'network' | 'authentication' | 'validation'
  | 'persistence' | 'runtime' | 'renderer' | 'unknown'
export type ErrorSeverityDto = 'warning' | 'error' | 'critical'
export type LogLevelDto = 'debug' | 'info' | 'warn' | 'error'

export interface ErrorRecordDto {
  id: string
  timestamp: string
  category: ErrorCategoryDto
  severity: ErrorSeverityDto
  title: string
  userMessage: string
  technicalMessage: string
  source: string
  sessionId?: string
  turnId?: string
  retryable: boolean
  metadata: Record<string, unknown>
}

export interface LogEntryDto {
  id: string
  timestamp: string
  level: LogLevelDto
  message: string
  source: string
  sessionId?: string
  turnId?: string
  metadata: Record<string, unknown>
}

export type DiagnosticsResultDto<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } }

export interface DiagnosticExportDto {
  filePath: string
  generatedAt: string
  errorCount: number
}

export interface RendererErrorInputDto {
  title: string
  userMessage: string
  technicalMessage?: string
  source: string
}
