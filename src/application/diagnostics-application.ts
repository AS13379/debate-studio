import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ErrorCenter, PerformanceMetricsCollector, StructuredLogger } from '../observability'
import type { DebateRunEvent } from './debate-run-application'
import type {
  DiagnosticExportDto, DiagnosticsResultDto, ErrorRecordDto, LogEntryDto,
  PerformanceSnapshotDto, RendererErrorInputDto, RendererPerformanceInputDto
} from '../shared/diagnostics-dtos'

export interface DiagnosticsApplicationOptions {
  appDataDirectory: string
  errorCenter: ErrorCenter
  logger: StructuredLogger
  performanceMetrics?: PerformanceMetricsCollector
  now?: () => Date
}

export class DiagnosticsApplication {
  private readonly now: () => Date
  private readonly performanceMetrics: PerformanceMetricsCollector

  constructor(private readonly options: DiagnosticsApplicationOptions) {
    this.now = options.now ?? (() => new Date())
    this.performanceMetrics = options.performanceMetrics ?? new PerformanceMetricsCollector({ now: options.now })
  }

  listRecentErrors(): DiagnosticsResultDto<ErrorRecordDto[]> {
    return { ok: true, value: this.options.errorCenter.listRecentErrors() }
  }

  getErrorDetail(id: string): DiagnosticsResultDto<ErrorRecordDto | undefined> {
    return { ok: true, value: this.options.errorCenter.getErrorDetail(id) }
  }

  clearErrors(): DiagnosticsResultDto<boolean> {
    this.options.errorCenter.clearErrors()
    this.options.logger.info('已清理错误中心', { source: 'diagnostics' })
    return { ok: true, value: true }
  }

  getRecentLogs(): DiagnosticsResultDto<LogEntryDto[]> {
    return { ok: true, value: this.options.logger.getRecentLogs() }
  }

  clearLogs(): DiagnosticsResultDto<boolean> {
    this.options.logger.clearLogs()
    return { ok: true, value: true }
  }

  reportRendererError(input: RendererErrorInputDto): DiagnosticsResultDto<boolean> {
    this.options.logger.error('界面运行异常', { source: 'renderer', metadata: { rendererSource: input.source } })
    this.options.errorCenter.capture({
      code: 'RENDERER_ERROR', titleZh: input.title, descriptionZh: input.userMessage,
      technicalDetails: input.technicalMessage, retryable: true
    }, { source: `renderer:${input.source}`, category: 'renderer' })
    return { ok: true, value: true }
  }

  reportRendererPerformance(input: RendererPerformanceInputDto): DiagnosticsResultDto<boolean> {
    this.performanceMetrics.recordRenderer(input.durationMs)
    return { ok: true, value: true }
  }

  getPerformanceSnapshot(): DiagnosticsResultDto<PerformanceSnapshotDto> {
    return { ok: true, value: this.performanceMetrics.snapshot() }
  }

  exportDiagnosticReport(): DiagnosticsResultDto<DiagnosticExportDto> {
    try {
      const report = {
        ...this.options.errorCenter.exportDiagnosticReport(),
        performance: this.performanceMetrics.snapshot()
      }
      const directory = join(this.options.appDataDirectory, 'diagnostics', 'exports')
      mkdirSync(directory, { recursive: true })
      const stamp = this.now().toISOString().replace(/[:.]/g, '-')
      const filePath = join(directory, `debate-studio-diagnostic-${stamp}.json`)
      writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      this.options.logger.info('脱敏诊断报告已生成', { source: 'diagnostics', metadata: { errorCount: report.recentErrors.length } })
      return { ok: true, value: { filePath, generatedAt: report.generatedAt, errorCount: report.recentErrors.length } }
    } catch {
      return {
        ok: false,
        error: {
          code: 'DIAGNOSTIC_EXPORT_FAILED', titleZh: '诊断报告导出失败',
          descriptionZh: '无法将脱敏诊断报告写入应用数据目录。', retryable: true
        }
      }
    }
  }

  observeRunEvent(event: DebateRunEvent): void {
    if (event.type === 'stateChanged') {
      if (event.event.to.status === 'running') this.performanceMetrics.sessionStarted(event.sessionId, event.createdAt)
      this.options.errorCenter.updateRuntimeSnapshot(event.event.to.stage, event.event.to.status, event.createdAt)
      this.options.logger.info('SessionRunner 状态变更', {
        source: 'session-runner', sessionId: event.sessionId,
        metadata: { stage: event.event.to.stage, status: event.event.to.status }
      })
      return
    }
    if (event.type === 'turnStarted') {
      this.performanceMetrics.turnStarted(event.sessionId, event.turn.id, event.createdAt)
      this.options.logger.info('Provider Turn 请求开始', {
        source: 'provider-request', sessionId: event.sessionId, turnId: event.turn.id,
        metadata: { stage: event.turn.stage, participantId: event.turn.participantId }
      })
      return
    }
    if (event.type === 'turnCompleted') {
      this.performanceMetrics.turnFinished(event.sessionId, event.turn.id, event.createdAt, event.turn.content?.length ?? 0)
      this.options.logger.info('Provider Turn 请求完成', {
        source: 'provider-request', sessionId: event.sessionId, turnId: event.turn.id,
        metadata: { stage: event.turn.stage, status: event.turn.status }
      })
      return
    }
    if (event.type === 'turnFailed') {
      this.performanceMetrics.turnFinished(event.sessionId, event.turn.id, event.createdAt, event.turn.content?.length ?? 0)
      const failure = event.turn.failure ?? { code: 'TURN_FAILED', message: event.turn.error, retryable: true }
      this.options.logger.error('模型 Turn 请求失败', {
        source: 'provider-request', sessionId: event.sessionId, turnId: event.turn.id,
        metadata: { stage: event.turn.stage, status: event.turn.status, code: failure.code }
      })
      this.options.errorCenter.capture(failure, {
        source: 'provider-request', category: 'provider', sessionId: event.sessionId, turnId: event.turn.id,
        metadata: { stage: event.turn.stage, status: event.turn.status }
      })
      return
    }
    if (event.type === 'sessionPaused' || event.type === 'sessionStopped' || event.type === 'sessionCompleted') {
      if (event.type !== 'sessionPaused') this.performanceMetrics.sessionFinished(event.sessionId, event.createdAt, event.type === 'sessionCompleted' ? 'completed' : 'stopped')
      this.options.logger.info(`SessionRunner ${event.type}`, { source: 'session-runner', sessionId: event.sessionId })
    }
  }
}
