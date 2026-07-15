import type { ConfigurationResultDto, DebateSummaryDto } from './debate-dtos'

export type DebateHistoryStatusDto = 'active' | 'archived' | 'deleted'
export type DebateHistorySortDto = 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc'

export interface DebateHistoryListQueryDto {
  search?: string
  sort?: DebateHistorySortDto
  favoriteOnly?: boolean
  tag?: string
  status?: DebateHistoryStatusDto | 'all'
}

export interface DebateHistorySummaryDto extends DebateSummaryDto {
  customTitle?: string
  displayTitle: string
  favorite: boolean
  historyStatus: DebateHistoryStatusDto
  tags: string[]
}

export interface DebateHistoryModelDto {
  role: string
  participantDisplayName: string
  modelProfileId: string
  modelId: string
  modelDisplayName: string
  providerDisplayName: string
}

export interface DebateHistoryDetailDto extends DebateHistorySummaryDto {
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  freeDebateRounds: number
  models: DebateHistoryModelDto[]
  research: {
    status: string
    sessionCount: number
    completedSessionCount: number
    indexCount: number
  }
  evidenceCount: number
  turnCount: number
  eventCount: number
  finalAdjudication?: {
    turnId: string
    content: string
    completedAt?: string
  }
  deleteImpact: {
    debateRecords: number
    eventRecords: number
    researchIndexes: number
    evidenceLinks: number
    turnRecords: number
    providersAffected: 0
    modelProfilesAffected: 0
    credentialsAffected: 0
  }
}

export type DebateHistoryResultDto<T> = ConfigurationResultDto<T>

export interface RenameDebateInputDto { id: string; customTitle: string }
export interface ToggleFavoriteInputDto { id: string; favorite: boolean }
export interface DebateTagInputDto { id: string; tag: string }
export interface DeleteDebateInputDto { id: string; confirmed: boolean }
