import { randomUUID } from 'node:crypto'

import type {
  DebateHistoryDetailRecord,
  DebateHistoryListQuery,
  DebateHistoryListRecord,
  DebateHistoryStatus,
  DebateMetadataRecord,
  PersistenceContext,
  PersistenceError,
  PersistenceResult
} from '../persistence'
import type { LoggerLike } from '../observability'
import type { ConfigurationErrorDto, ConfigurationResultDto } from '../shared/debate-dtos'
import type {
  DebateHistoryDetailDto,
  DebateHistoryListQueryDto,
  DebateHistorySummaryDto
} from '../shared/history-dtos'

export interface DebateHistoryApplicationDependencies {
  persistence: PersistenceContext
  logger?: LoggerLike
  createId?: () => string
  now?: () => Date
}

export class DebateHistoryApplication {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: DebateHistoryApplicationDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  listDebates(query: DebateHistoryListQueryDto = {}): ConfigurationResultDto<DebateHistorySummaryDto[]> {
    const normalized: DebateHistoryListQuery = {
      search: query.search?.trim() || undefined,
      sort: query.sort ?? 'updated-desc',
      favoriteOnly: query.favoriteOnly ?? false,
      tag: query.tag?.trim() || undefined,
      status: query.status ?? 'active'
    }
    const result = this.dependencies.persistence.repositories.debateHistory.list(normalized)
    return result.ok
      ? { ok: true, value: result.value.map((record) => this.summaryDto(record)) }
      : this.persistenceError(result.error)
  }

  getDebateDetail(id: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    const result = this.dependencies.persistence.repositories.debateHistory.getDetail(id)
    if (!result.ok) return this.persistenceError(result.error)
    if (!result.value) return this.notFound(id)
    return { ok: true, value: this.detailDto(result.value) }
  }

  renameDebate(id: string, customTitle: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    const title = customTitle.trim()
    if (!title) return this.invalid('名称不能为空', '请输入用于识别这场辩论的名称。')
    if (title.length > 200) return this.invalid('名称过长', '自定义名称不能超过 200 个字符。')
    return this.mutate(id, 'rename', () => this.dependencies.persistence.repositories.debateHistory.rename(id, title, this.timestamp()))
  }

  favoriteDebate(id: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    return this.setFavorite(id, true)
  }

  unfavoriteDebate(id: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    return this.setFavorite(id, false)
  }

  toggleFavorite(id: string, favorite: boolean): ConfigurationResultDto<DebateHistoryDetailDto> {
    return favorite ? this.favoriteDebate(id) : this.unfavoriteDebate(id)
  }

  addTag(id: string, tag: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    const normalized = tag.trim().replace(/\s+/g, ' ')
    if (!normalized) return this.invalid('标签不能为空', '请输入标签内容。')
    if (normalized.length > 50) return this.invalid('标签过长', '单个标签不能超过 50 个字符。')
    const existing = this.requireMetadata(id)
    if (!existing.ok) return existing
    const result = this.dependencies.persistence.repositories.debateHistory.addTag({
      id: this.createId(), debateId: id, tag: normalized
    }, this.timestamp())
    if (!result.ok) return this.persistenceError(result.error)
    this.log('添加历史标签', id, { operation: 'addTag' })
    return this.getDebateDetail(id)
  }

  removeTag(id: string, tag: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    const normalized = tag.trim()
    if (!normalized) return this.invalid('标签不能为空', '请选择要移除的标签。')
    return this.mutate(id, 'removeTag', () => this.dependencies.persistence.repositories.debateHistory.removeTag(id, normalized, this.timestamp()), false)
  }

  archiveDebate(id: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    const metadata = this.requireMetadata(id)
    if (!metadata.ok) return metadata
    if (metadata.value.status === 'deleted') {
      return this.invalid('已删除记录不能归档', '请先恢复这场辩论，再执行归档。')
    }
    return this.setStatus(id, 'archived', 'archive')
  }

  restoreDebate(id: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    return this.setStatus(id, 'active', 'restore')
  }

  deleteDebate(id: string, confirmed: boolean): ConfigurationResultDto<DebateHistoryDetailDto> {
    if (!confirmed) {
      return this.failure(
        'DELETE_CONFIRMATION_REQUIRED',
        '需要确认删除',
        '请先查看影响范围并明确确认。此操作只会软删除记录，关联数据仍会保留。',
        false
      )
    }
    return this.setStatus(id, 'deleted', 'softDelete')
  }

  private setFavorite(id: string, favorite: boolean): ConfigurationResultDto<DebateHistoryDetailDto> {
    return this.mutate(id, favorite ? 'favorite' : 'unfavorite', () =>
      this.dependencies.persistence.repositories.debateHistory.setFavorite(id, favorite, this.timestamp()))
  }

  private setStatus(id: string, status: DebateHistoryStatus, operation: string): ConfigurationResultDto<DebateHistoryDetailDto> {
    return this.mutate(id, operation, () =>
      this.dependencies.persistence.repositories.debateHistory.setStatus(id, status, this.timestamp()))
  }

  private mutate(
    id: string,
    operation: string,
    action: () => PersistenceResult<boolean>,
    requireChange = true
  ): ConfigurationResultDto<DebateHistoryDetailDto> {
    const metadata = this.requireMetadata(id)
    if (!metadata.ok) return metadata
    const result = action()
    if (!result.ok) return this.persistenceError(result.error)
    if (requireChange && !result.value) return this.notFound(id)
    this.log('更新辩论历史', id, { operation })
    return this.getDebateDetail(id)
  }

  private requireMetadata(id: string): ConfigurationResultDto<DebateMetadataRecord> {
    const result = this.dependencies.persistence.repositories.debateHistory.getMetadata(id)
    if (!result.ok) return this.persistenceError(result.error)
    return result.value ? { ok: true, value: result.value } : this.notFound(id)
  }

  private summaryDto(record: DebateHistoryListRecord): DebateHistorySummaryDto {
    return {
      id: record.debateId,
      sessionId: record.sessionId,
      topic: record.topic,
      customTitle: record.customTitle,
      displayTitle: record.customTitle ?? record.topic,
      favorite: record.favorite,
      historyStatus: record.historyStatus,
      tags: [...record.tags],
      status: record.runStatus,
      currentStage: record.currentStage,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  private detailDto(record: DebateHistoryDetailRecord): DebateHistoryDetailDto {
    return {
      ...this.summaryDto(record),
      background: record.background,
      affirmativePosition: record.affirmativePosition,
      negativePosition: record.negativePosition,
      freeDebateRounds: record.freeDebateRounds,
      models: record.models.map((model) => ({ ...model })),
      research: {
        status: record.researchStatus,
        sessionCount: record.researchSessionCount,
        completedSessionCount: record.completedResearchSessionCount,
        indexCount: record.researchIndexCount
      },
      evidenceCount: record.evidenceCount,
      turnCount: record.turnCount,
      eventCount: record.eventCount,
      finalAdjudication: record.finalAdjudication ? { ...record.finalAdjudication } : undefined,
      deleteImpact: {
        debateRecords: 1,
        eventRecords: record.eventCount,
        researchIndexes: record.researchIndexCount,
        evidenceLinks: record.evidenceCount,
        turnRecords: record.turnCount,
        providersAffected: 0,
        modelProfilesAffected: 0,
        credentialsAffected: 0
      }
    }
  }

  private timestamp(): string { return this.now().toISOString() }

  private log(message: string, debateId: string, metadata: Record<string, unknown>): void {
    this.dependencies.logger?.info(message, { source: 'history', metadata: { ...metadata, debateId } })
  }

  private invalid(titleZh: string, descriptionZh: string): ConfigurationResultDto<never> {
    return this.failure('INVALID_HISTORY_INPUT', titleZh, descriptionZh, false)
  }

  private notFound(id: string): ConfigurationResultDto<never> {
    return this.failure('DEBATE_HISTORY_NOT_FOUND', '没有找到辩论记录', `辩论记录 ${id} 不存在。`, false)
  }

  private persistenceError(error: PersistenceError): ConfigurationResultDto<never> {
    return this.failure(
      'HISTORY_PERSISTENCE_FAILED',
      '历史记录操作失败',
      'SQLite 读取或写入失败，请稍后重试。',
      error.code !== 'DATABASE_CLOSED'
    )
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: ConfigurationErrorDto } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
