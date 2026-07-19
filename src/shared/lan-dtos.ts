import type { DebateHistorySummaryDto } from './history-dtos'
import type { DebateDetailDto, DebateTurnDto, DebateTurnPageDto } from './debate-dtos'
import type { RunEventDto, RunStateDto } from './ipc-contract'

export type LanAuthenticationMode = 'password'
export type LanServerLifecycleState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'suspended'
  | 'error'

export interface LanServerConfigDto {
  enabled: boolean
  host: string
  port: number
  authenticationMode: LanAuthenticationMode
  sessionTimeoutMinutes: number
  allowFileUpload: false
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
  passwordConfigured: boolean
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
  authenticationRequired: true
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

export type LanSafeTurnDto = DebateTurnDto

export interface LanDesktopApi {
  getLanServerStatus(): Promise<LanResultDto<LanServerStatusDto>>
  startLanServer(): Promise<LanResultDto<LanServerStatusDto>>
  stopLanServer(): Promise<LanResultDto<LanServerStatusDto>>
  updateLanServerConfig(input: Partial<Pick<LanServerConfigDto, 'port' | 'sessionTimeoutMinutes' | 'autoPort'>>): Promise<LanResultDto<LanServerStatusDto>>
  revealLanPassword(): Promise<LanResultDto<{ password: string }>>
  setLanPassword(input: { password: string }): Promise<LanResultDto<boolean>>
  regenerateLanPassword(): Promise<LanResultDto<{ password: string }>>
  logoutAllLanDevices(): Promise<LanResultDto<boolean>>
  kickLanDevice(input: { deviceId: string }): Promise<LanResultDto<boolean>>
  openLanPreview(): Promise<LanResultDto<boolean>>
  onLanStatusChanged(listener: (status: LanServerStatusDto) => void): () => void
}
