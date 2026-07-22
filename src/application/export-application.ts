import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'

import {
  ExportSnapshotBuilder,
  HtmlDebateExporter,
  LocalExportFileStore,
  MarkdownDebateExporter,
  type DebateExporter,
  type ExportFileStore
} from '../export'
import type { ExportRecord, ExportType, PersistenceContext, PersistenceError } from '../persistence'
import type { ErrorCenter, LoggerLike, PerformanceMetricsCollector } from '../observability'
import { redactSensitiveText } from '../security'
import type { ConfigurationErrorDto } from '../shared/debate-dtos'
import type { DebateExportRecordDto, DebateExportResultDto } from '../shared/export-dtos'
import type { DebateHistoryApplication } from './debate-history-application'

export interface ExportApplicationDependencies {
  persistence: PersistenceContext
  history: DebateHistoryApplication
  appDataDirectory: string
  logger?: LoggerLike
  fileStore?: ExportFileStore
  createId?: () => string
  now?: () => Date
  performanceMetrics?: Pick<PerformanceMetricsCollector, 'recordExport'>
  errorCenter?: ErrorCenter
}

interface ActiveExportTask {
  controller: AbortController
  promise: Promise<void>
}

export class ExportApplication {
  private readonly rootDirectory: string
  private readonly snapshotBuilder: ExportSnapshotBuilder
  private readonly fileStore: ExportFileStore
  private readonly exporters: Record<ExportType, DebateExporter>
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly tasks = new Map<string, ActiveExportTask>()
  private closed = false

  constructor(private readonly dependencies: ExportApplicationDependencies) {
    this.rootDirectory = resolve(dependencies.appDataDirectory, 'exports')
    this.snapshotBuilder = new ExportSnapshotBuilder({
      persistence: dependencies.persistence,
      history: dependencies.history,
      now: dependencies.now
    })
    this.fileStore = dependencies.fileStore ?? new LocalExportFileStore()
    this.exporters = {
      markdown: new MarkdownDebateExporter(),
      html: new HtmlDebateExporter()
    }
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  exportDebateMarkdown(
    debateId: string,
    exportOptions: { includePrivateResearch: boolean },
    destinationFilePath?: string
  ): DebateExportResultDto<DebateExportRecordDto> {
    return this.startExport(debateId, 'markdown', exportOptions.includePrivateResearch, destinationFilePath)
  }

  exportDebateHtml(
    debateId: string,
    exportOptions: { includePrivateResearch: boolean },
    destinationFilePath?: string
  ): DebateExportResultDto<DebateExportRecordDto> {
    return this.startExport(debateId, 'html', exportOptions.includePrivateResearch, destinationFilePath)
  }

  getExportHistory(): DebateExportResultDto<DebateExportRecordDto[]> {
    const result = this.dependencies.persistence.repositories.exports.list()
    if (!result.ok) return this.persistenceFailure(result.error)
    const titles = new Map<string, string>()
    for (const record of result.value) {
      if (titles.has(record.debateId)) continue
      const detail = this.dependencies.history.getDebateDetail(record.debateId)
      titles.set(record.debateId, detail.ok ? detail.value.displayTitle : record.debateId)
    }
    return { ok: true, value: result.value.map((record) => this.recordDto(record, titles.get(record.debateId))) }
  }

  readCompletedExport(exportId: string): DebateExportResultDto<{ fileName: string; mimeType: string; bytes: Uint8Array }> {
    const found = this.dependencies.persistence.repositories.exports.findById(exportId)
    if (!found.ok) return this.persistenceFailure(found.error)
    if (!found.value) return this.failure('EXPORT_NOT_FOUND', '没有找到导出记录', '这条导出记录可能已经被删除。', false)
    if (found.value.status !== 'completed') return this.failure('EXPORT_NOT_READY', '导出文件尚未就绪', '请等待后台生成完成后再下载。', true)
    if (!this.isManagedPath(found.value.filePath)) return this.failure('EXPORT_PATH_REJECTED', '导出路径不安全', '只能下载应用管理的导出文件。', false)
    try {
      return {
        ok: true,
        value: {
          fileName: basename(found.value.filePath),
          mimeType: found.value.type === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
          bytes: readFileSync(found.value.filePath)
        }
      }
    } catch {
      return this.failure('EXPORT_FILE_READ_FAILED', '无法读取导出文件', '文件可能已被移动或删除，请重新导出。', true)
    }
  }

  async cancelExport(exportId: string): Promise<DebateExportResultDto<{ cancelled: boolean }>> {
    const found = this.dependencies.persistence.repositories.exports.findById(exportId)
    if (!found.ok) return this.persistenceFailure(found.error)
    if (!found.value) return this.failure('EXPORT_NOT_FOUND', '没有找到导出记录', '这条导出记录可能已经被删除。', false)
    if (found.value.status !== 'generating') return { ok: true, value: { cancelled: false } }
    const active = this.tasks.get(exportId)
    if (active) {
      active.controller.abort()
      await active.promise
    } else {
      this.persistTerminal({
        ...found.value,
        status: 'cancelled',
        updatedAt: this.timestamp(),
        errorTitle: '导出已取消',
        errorMessage: '导出任务已由用户取消，未完成文件不会保留。'
      })
    }
    return { ok: true, value: { cancelled: true } }
  }

  async deleteExportRecord(exportId: string): Promise<DebateExportResultDto<{ deleted: boolean }>> {
    const found = this.dependencies.persistence.repositories.exports.findById(exportId)
    if (!found.ok) return this.persistenceFailure(found.error)
    if (!found.value) return this.failure('EXPORT_NOT_FOUND', '没有找到导出记录', '这条导出记录可能已经被删除。', false)
    if (found.value.status === 'generating') {
      return this.failure('EXPORT_STILL_RUNNING', '导出仍在进行', '请先取消导出任务，再删除记录。', true)
    }
    if (this.isManagedPath(found.value.filePath)) {
      try {
        await this.fileStore.delete(found.value.filePath)
      } catch (cause) {
        this.dependencies.logger?.error('删除导出文件失败', { source: 'export', metadata: { exportId } })
        return this.failure('EXPORT_FILE_DELETE_FAILED', '无法删除导出文件', this.safeFailureMessage(cause), true)
      }
    }
    const deleted = this.dependencies.persistence.repositories.exports.delete(exportId)
    if (!deleted.ok) return this.persistenceFailure(deleted.error)
    this.dependencies.logger?.info('删除导出记录', { source: 'export', metadata: { exportId } })
    return { ok: true, value: { deleted: deleted.value } }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const active = [...this.tasks.values()]
    for (const task of active) task.controller.abort()
    await Promise.allSettled(active.map((task) => task.promise))
  }

  private startExport(
    debateId: string,
    type: ExportType,
    includePrivateResearch: boolean,
    destinationFilePath?: string
  ): DebateExportResultDto<DebateExportRecordDto> {
    if (this.closed) return this.failure('EXPORT_APPLICATION_CLOSED', '导出服务已关闭', '应用正在退出，无法创建新的导出任务。', true)
    const detail = this.dependencies.history.getDebateDetail(debateId)
    if (!detail.ok) return detail
    if (detail.value.status !== 'completed') {
      return this.failure('EXPORT_DEBATE_NOT_COMPLETED', '辩论尚未完成', '只有已经完成的辩论才能导出，请先完成辩论。', false)
    }

    const exporter = this.exporters[type]
    const createdAt = this.timestamp()
    const record: ExportRecord = {
      id: this.createId(),
      debateId,
      type,
      includePrivateResearch,
      filePath: '',
      createdAt,
      updatedAt: createdAt,
      fileSize: 0,
      status: 'generating',
      progress: 0
    }
    record.filePath = destinationFilePath
      ? this.normalizeSelectedFilePath(destinationFilePath, exporter.extension)
      : this.filePath(detail.value.displayTitle, exporter.extension, createdAt, record.id)
    const created = this.dependencies.persistence.repositories.exports.create(record)
    if (!created.ok) return this.persistenceFailure(created.error)
    this.dependencies.logger?.info('开始生成辩论导出', {
      source: 'export', metadata: { exportId: record.id, debateId, type, includePrivateResearch }
    })
    this.schedule(record)
    return { ok: true, value: this.recordDto(record, detail.value.displayTitle) }
  }

  private schedule(record: ExportRecord): void {
    const controller = new AbortController()
    const promise = new Promise<void>((resolveTask) => {
      setImmediate(() => void this.execute(record, controller.signal).finally(resolveTask))
    }).finally(() => this.tasks.delete(record.id))
    this.tasks.set(record.id, { controller, promise })
  }

  private async execute(initial: ExportRecord, signal: AbortSignal): Promise<void> {
    const startedAt = performance.now()
    let record = initial
    try {
      this.throwIfAborted(signal)
      record = this.updateProgress(record, 10)
      await nextTask()
      const snapshot = this.snapshotBuilder.build(record.debateId, record.includePrivateResearch)
      if (!snapshot.ok) throw new ExportTaskError(snapshot.error.titleZh, snapshot.error.descriptionZh)
      record = this.updateProgress(record, 35)
      await nextTask()
      this.throwIfAborted(signal)
      const content = this.exporters[record.type].render(snapshot.value)
      record = this.updateProgress(record, 55)
      await nextTask()
      const fileSize = await this.fileStore.write(record.filePath, content, {
        signal,
        onProgress: (value) => { record = this.updateProgress(record, 55 + Math.floor(value * 44)) }
      })
      this.throwIfAborted(signal)
      const completed: ExportRecord = {
        ...record,
        fileSize,
        status: 'completed',
        progress: 100,
        updatedAt: this.timestamp(),
        errorTitle: undefined,
        errorMessage: undefined
      }
      this.persistTerminal(completed)
      this.dependencies.performanceMetrics?.recordExport(performance.now() - startedAt, 'completed')
      this.dependencies.logger?.info('辩论导出完成', {
        source: 'export', metadata: { exportId: record.id, debateId: record.debateId, type: record.type, fileSize }
      })
    } catch (cause) {
      if (isAbortError(cause) || signal.aborted) {
        await this.fileStore.delete(record.filePath).catch(() => false)
        const cancelled: ExportRecord = {
          ...record,
          status: 'cancelled',
          updatedAt: this.timestamp(),
          errorTitle: '导出已取消',
          errorMessage: '导出任务已由用户取消，未完成文件不会保留。'
        }
        this.persistTerminal(cancelled)
        this.dependencies.performanceMetrics?.recordExport(performance.now() - startedAt, 'cancelled')
        this.dependencies.logger?.warn('辩论导出已取消', { source: 'export', metadata: { exportId: record.id } })
        return
      }
      const taskError = cause instanceof ExportTaskError ? cause : undefined
      const failed: ExportRecord = {
        ...record,
        status: 'failed',
        updatedAt: this.timestamp(),
        errorTitle: redactSensitiveText(taskError?.title ?? '导出文件生成失败'),
        errorMessage: redactSensitiveText(taskError?.message ?? this.safeFailureMessage(cause))
      }
      this.persistTerminal(failed)
      this.dependencies.performanceMetrics?.recordExport(performance.now() - startedAt, 'failed')
      this.dependencies.logger?.error('辩论导出失败', {
        source: 'export', metadata: { exportId: record.id, debateId: record.debateId, type: record.type }
      })
      this.dependencies.errorCenter?.capture({
        code: 'EXPORT_GENERATION_FAILED',
        titleZh: failed.errorTitle,
        descriptionZh: failed.errorMessage,
        retryable: true
      }, {
        source: 'export', category: 'runtime', metadata: { exportId: record.id, type: record.type }
      })
    }
  }

  private updateProgress(record: ExportRecord, progress: number): ExportRecord {
    const normalized = Math.max(record.progress, Math.min(99, progress))
    if (normalized < record.progress + 4) return record
    const updated = { ...record, progress: normalized, updatedAt: this.timestamp() }
    const persisted = this.dependencies.persistence.repositories.exports.update(updated)
    if (!persisted.ok) this.capturePersistenceFailure(record.id, persisted.error, 'progress')
    return updated
  }

  private persistTerminal(record: ExportRecord): void {
    const persisted = this.dependencies.persistence.repositories.exports.update(record)
    if (!persisted.ok) this.capturePersistenceFailure(record.id, persisted.error, 'terminal')
  }

  private capturePersistenceFailure(exportId: string, error: PersistenceError, phase: string): void {
    this.dependencies.logger?.error('导出状态保存失败', {
      source: 'export', metadata: { exportId, phase, code: error.code }
    })
    this.dependencies.errorCenter?.capture({
      code: 'EXPORT_STATUS_PERSISTENCE_FAILED',
      titleZh: '导出状态保存失败',
      descriptionZh: '导出文件可能已生成，但本地状态未能更新；重启后可重新导出。',
      retryable: true
    }, { source: 'export', category: 'persistence', metadata: { exportId, phase, code: error.code } })
  }

  private recordDto(record: ExportRecord, knownTitle?: string): DebateExportRecordDto {
    let debateTitle = knownTitle
    if (!debateTitle) {
      const detail = this.dependencies.history.getDebateDetail(record.debateId)
      debateTitle = detail.ok ? detail.value.displayTitle : record.debateId
    }
    return {
      exportId: record.id,
      debateId: record.debateId,
      debateTitle,
      type: record.type,
      includePrivateResearch: record.includePrivateResearch,
      filePath: record.filePath,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      fileSize: record.fileSize,
      status: record.status,
      progress: record.progress,
      error: record.status === 'failed' || record.status === 'cancelled' ? {
        titleZh: redactSensitiveText(record.errorTitle ?? '导出失败'),
        descriptionZh: redactSensitiveText(record.errorMessage ?? '无法生成导出文件。')
      } : undefined
    }
  }

  private filePath(title: string, extension: string, createdAt: string, exportId: string): string {
    const safeTitle = title.normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '辩论导出'
    const stamp = createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    const idSuffix = exportId.replace(/[^A-Za-z0-9_-]/g, '').slice(-12) || 'export'
    return join(this.rootDirectory, `${safeTitle}_${stamp}_${idSuffix}.${extension}`)
  }

  private normalizeSelectedFilePath(filePath: string, extension: string): string {
    const selected = resolve(filePath)
    if (extname(selected).toLowerCase() === `.${extension.toLowerCase()}`) return selected
    return `${selected}.${extension}`
  }

  private isManagedPath(filePath: string): boolean {
    const candidate = resolve(filePath)
    return candidate !== this.rootDirectory && candidate.startsWith(`${this.rootDirectory}${sep}`) && basename(candidate) !== ''
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return
    const error = new Error('Export was cancelled.')
    error.name = 'AbortError'
    throw error
  }

  private safeFailureMessage(cause: unknown): string {
    const detail = cause instanceof Error ? cause.message : '本地文件系统拒绝了导出操作。'
    return redactSensitiveText(detail).slice(0, 500)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private persistenceFailure(error: PersistenceError): DebateExportResultDto<never> {
    return this.failure('EXPORT_PERSISTENCE_FAILED', '导出记录保存失败', '无法读写本地导出记录，请稍后重试。', error.code !== 'DATABASE_CLOSED')
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: ConfigurationErrorDto } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}

class ExportTaskError extends Error {
  constructor(readonly title: string, message: string) {
    super(message)
    this.name = 'ExportTaskError'
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

function nextTask(): Promise<void> {
  return new Promise((resolveTask) => setImmediate(resolveTask))
}
