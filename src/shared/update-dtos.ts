export const APPLICATION_UPDATE_STATUSES = [
  'idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error'
] as const

export type ApplicationUpdateStatusDto = typeof APPLICATION_UPDATE_STATUSES[number]

export interface ApplicationUpdateProgressDto {
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond: number
}

export interface ApplicationUpdateErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export interface ApplicationUpdateStateDto {
  currentVersion: string
  supported: boolean
  automaticCheckEnabled: boolean
  automaticDownloadEnabled: false
  status: ApplicationUpdateStatusDto
  messageZh: string
  availableVersion?: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
  lastCheckedAt?: string
  progress?: ApplicationUpdateProgressDto
  error?: ApplicationUpdateErrorDto
}

export type ApplicationUpdateResultDto<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationUpdateErrorDto }

export interface ApplicationUpdateInfo {
  version: string
  releaseName?: string
  releaseNotes?: string | Array<{ version?: string; note?: string }>
  releaseDate?: string
}
