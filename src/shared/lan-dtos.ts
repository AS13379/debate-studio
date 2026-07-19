import type { DebateHistorySummaryDto } from './history-dtos'
import type {
  CreateDebateInput,
  DebateDetailDto,
  DebatePlannerResultDto,
  DebateTurnDto,
  DebateTurnPageDto,
  ModelProfileDto,
  PlanDebateInputDto
} from './debate-dtos'
import type { DebateQualitySnapshotDto } from './quality-dtos'
import type { ResearchAssetDto, ResearchWorkspaceDto } from './research-dtos'
import type { CostSummaryDto } from './workbench-dtos'
import type { DebateExportRecordDto, DebateExportTypeDto } from './export-dtos'
import type { RunEventDto, RunStateDto } from './ipc-contract'

export type LanAuthenticationMode = 'none'
export type LanAccessMode = 'localhost' | 'lan'
export type LanServerLifecycleState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'suspended'
  | 'error'

export interface LanServerConfigDto {
  enabled: boolean
  accessMode: LanAccessMode
  host: string
  port: number
  authenticationMode: LanAuthenticationMode
  sessionTimeoutMinutes: number
  allowFileUpload: boolean
  autoPort: boolean
}

export interface LanConnectedDeviceDto {
  id: string
  label: string
  address: string
  createdAt: string
  lastAccessAt: string
  expiresAt: string
}

export interface LanServerErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export interface LanServerStatusDto {
  lifecycle: LanServerLifecycleState
  config: LanServerConfigDto
  accessUrls: string[]
  startedAt?: string
  lastAccessAt?: string
  devices: LanConnectedDeviceDto[]
  error?: LanServerErrorDto
}

export type LanResultDto<T> =
  | { ok: true; value: T }
  | { ok: false; error: LanServerErrorDto }

export interface LanPublicStatusDto {
  appName: 'Debate Studio'
  version: string
  authenticationRequired: false
}

export interface LanAuthSessionDto {
  deviceId: string
  expiresAt: string
  csrfToken: string
}

export interface LanDebateDetailDto extends DebateDetailDto {
  displayTitle: string
}

export interface LanSessionSnapshotDto {
  streamEpoch: string
  latestSequence: number
  debate: LanDebateDetailDto
  state: RunStateDto
  turnPage: DebateTurnPageDto
}

export type LanRunCommand = 'start' | 'pause' | 'resume' | 'stop'

export interface LanEventEnvelopeDto {
  protocolVersion: 1
  streamEpoch: string
  sequence: number
  eventId: string
  sessionId: string
  createdAt: string
  event: RunEventDto
}

export interface LanDebateListDto {
  debates: DebateHistorySummaryDto[]
  hasMore: boolean
}

export interface LanCreateDebateInputDto {
  debate: CreateDebateInput
  bindings: {
    affirmativeModelProfileId: string
    negativeModelProfileId: string
    moderatorModelProfileId: string
    judgeModelProfileId?: string
  }
}

export type LanPlanDebateInputDto = PlanDebateInputDto
export type LanPlanDebateResultDto = DebatePlannerResultDto
export type LanModelProfileDto = ModelProfileDto
export type LanResearchWorkspaceDto = ResearchWorkspaceDto
export type LanResearchAssetDto = ResearchAssetDto

export interface LanDebateInsightsDto {
  quality?: DebateQualitySnapshotDto
  cost?: CostSummaryDto['byDebate'][number]
}

export type LanExportRecordDto = Omit<DebateExportRecordDto, 'filePath'>

export interface LanCreateExportInputDto {
  type: DebateExportTypeDto
  includePrivateResearch: boolean
}

export type LanSafeTurnDto = DebateTurnDto

export interface LanDesktopApi {
  getLanServerStatus(): Promise<LanResultDto<LanServerStatusDto>>
  startLanServer(): Promise<LanResultDto<LanServerStatusDto>>
  stopLanServer(): Promise<LanResultDto<LanServerStatusDto>>
  updateLanServerConfig(input: Partial<Pick<LanServerConfigDto, 'accessMode' | 'port' | 'sessionTimeoutMinutes' | 'autoPort'>>): Promise<LanResultDto<LanServerStatusDto>>
  logoutAllLanDevices(): Promise<LanResultDto<boolean>>
  kickLanDevice(input: { deviceId: string }): Promise<LanResultDto<boolean>>
  openLanPreview(): Promise<LanResultDto<boolean>>
  onLanStatusChanged(listener: (status: LanServerStatusDto) => void): () => void
}
