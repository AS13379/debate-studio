import { randomUUID } from 'node:crypto'
import { basename, join, resolve, sep } from 'node:path'

import {
  ExportSnapshotBuilder,
  HtmlDebateExporter,
  LocalExportFileStore,
  MarkdownDebateExporter,
  type DebateExporter,
  type ExportFileStore
} from '../export'
import type { ExportRecord, ExportType, PersistenceContext, PersistenceError } from '../persistence'
import type { LoggerLike } from '../observability'
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
}

export class ExportApplication {
  private readonly rootDirectory: string
  private readonly snapshotBuilder: ExportSnapshotBuilder
  private readonly fileStore: ExportFileStore
  private readonly exporters: Record<ExportType, DebateExporter>
  private readonly createId: () => string
  private readonly now: () => Date

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

  exportDebateMarkdown(debateId: string, exportOptions: { includePrivateResearch: boolean }): DebateExportResultDto<DebateExportRecordDto> {
    return this.export(debateId, 'markdown', exportOptions.includePrivateResearch)
  }

  exportDebateHtml(debateId: string, exportOptions: { includePrivateResearch: boolean }): DebateExportResultDto<DebateExportRecordDto> {
    return this.export(debateId, 'html', exportOptions.includePrivateResearch)
  }

  getExportHistory(): DebateExportResultDto<DebateExportRecordDto[]> {
    const result = this.dependencies.persistence.repositories.exports.list()
    if (!result.ok) return this.persistenceFailure(result.error)
    return { ok: true, value: result.value.map((record) => this.recordDto(record)) }
  }

  deleteExportRecord(exportId: string): DebateExportResultDto<{ deleted: boolean }> {
    const found = this.dependencies.persistence.repositories.exports.findById(exportId)
    if (!found.ok) return this.persistenceFailure(found.error)
    if (!found.value) return this.failure('EXPORT_NOT_FOUND', '没有找到导出记录', '这条导出记录可能已经被删除。', false)
    if (!this.isManagedPath(found.value.filePath)) {
      return this.failure('EXPORT_PATH_REJECTED', '导出路径不安全', '为保护本地文件，只能删除应用导出目录中的文件。', false)
    }

    try {
      this.fileStore.delete(found.value.filePath)
    } catch (cause) {
      this.dependencies.logger?.error('删除导出文件失败', { source: 'export', metadata: { exportId } })
      return this.failure('EXPORT_FILE_DELETE_FAILED', '无法删除导出文件', this.safeFailureMessage(cause), true)
    }
    const deleted = this.dependencies.persistence.repositories.exports.delete(exportId)
    if (!deleted.ok) return this.persistenceFailure(deleted.error)
    this.dependencies.logger?.info('删除导出记录', { source: 'export', metadata: { exportId } })
    return { ok: true, value: { deleted: deleted.value } }
  }

  private export(debateId: string, type: ExportType, includePrivateResearch: boolean): DebateExportResultDto<DebateExportRecordDto> {
    const detail = this.dependencies.history.getDebateDetail(debateId)
    if (!detail.ok) return detail
    if (detail.value.status !== 'completed') {
      return this.failure('EXPORT_DEBATE_NOT_COMPLETED', '辩论尚未完成', '只有已经完成的辩论才能导出，请先完成辩论。', false)
    }

    const exporter = this.exporters[type]
    const createdAt = this.now().toISOString()
    const exportId = this.createId()
    const record: ExportRecord = {
      id: exportId,
      debateId,
      type,
      includePrivateResearch,
      filePath: this.filePath(detail.value.displayTitle, exporter.extension, createdAt, exportId),
      createdAt,
      fileSize: 0,
      status: 'generating'
    }
    const created = this.dependencies.persistence.repositories.exports.create(record)
    if (!created.ok) return this.persistenceFailure(created.error)
    this.dependencies.logger?.info('开始生成辩论导出', { source: 'export', metadata: { exportId: record.id, debateId, type, includePrivateResearch } })

    try {
      const snapshot = this.snapshotBuilder.build(debateId, includePrivateResearch)
      if (!snapshot.ok) return this.failRecord(record, snapshot.error.titleZh, snapshot.error.descriptionZh, snapshot.error)
      const content = exporter.render(snapshot.value)
      const fileSize = this.fileStore.write(record.filePath, content)
      const completed: ExportRecord = { ...record, fileSize, status: 'completed' }
      const updated = this.dependencies.persistence.repositories.exports.update(completed)
      if (!updated.ok) return this.persistenceFailure(updated.error)
      if (!updated.value) return this.failure('EXPORT_RECORD_UPDATE_FAILED', '导出记录更新失败', '文件已生成，但无法更新本地导出记录。', true)
      this.dependencies.logger?.info('辩论导出完成', { source: 'export', metadata: { exportId: record.id, debateId, type, fileSize } })
      return { ok: true, value: this.recordDto(completed, detail.value.displayTitle) }
    } catch (cause) {
      return this.failRecord(record, '导出文件生成失败', this.safeFailureMessage(cause), cause)
    }
  }

  private failRecord(record: ExportRecord, title: string, message: string, cause: unknown): DebateExportResultDto<never> {
    const failed: ExportRecord = {
      ...record,
      status: 'failed',
      errorTitle: redactSensitiveText(title),
      errorMessage: redactSensitiveText(message)
    }
    this.dependencies.persistence.repositories.exports.update(failed)
    this.dependencies.logger?.error('辩论导出失败', { source: 'export', metadata: { exportId: record.id, debateId: record.debateId, type: record.type } })
    return this.failure(
      'EXPORT_GENERATION_FAILED',
      failed.errorTitle ?? '导出文件生成失败',
      failed.errorMessage || this.safeFailureMessage(cause),
      true
    )
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
      fileSize: record.fileSize,
      status: record.status,
      error: record.status === 'failed' ? {
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

  private isManagedPath(filePath: string): boolean {
    const candidate = resolve(filePath)
    return candidate !== this.rootDirectory && candidate.startsWith(`${this.rootDirectory}${sep}`) && basename(candidate) !== ''
  }

  private safeFailureMessage(cause: unknown): string {
    const detail = cause instanceof Error ? cause.message : '本地文件系统拒绝了导出操作。'
    return redactSensitiveText(detail).slice(0, 500)
  }

  private persistenceFailure(error: PersistenceError): DebateExportResultDto<never> {
    return this.failure('EXPORT_PERSISTENCE_FAILED', '导出记录保存失败', '无法读写本地导出记录，请稍后重试。', error.code !== 'DATABASE_CLOSED')
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: ConfigurationErrorDto } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
