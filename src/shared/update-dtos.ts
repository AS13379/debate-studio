export const APPLICATION_UPDATE_STATUSES = [
  'idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error'
] as const
export type ApplicationUpdateStatusDto = typeof APPLICATION_UPDATE_STATUSES[number]
export type UpdateVerificationStatusDto = 'not-verified' | 'verifying' | 'verified' | 'failed'

export interface ApplicationUpdateProgressDto { percent: number; transferredBytes: number; totalBytes: number; bytesPerSecond: number }
export interface ApplicationUpdateErrorDto { code: string; titleZh: string; descriptionZh: string; retryable: boolean; detailCode?: string }
export interface ApplicationUpdateStateDto {
  currentVersion: string; supported: boolean; automaticCheckEnabled: boolean; automaticDownloadEnabled: boolean
  status: ApplicationUpdateStatusDto; messageZh: string; availableVersion?: string; releaseName?: string
  releaseNotes?: string; releaseDate?: string; lastCheckedAt?: string; progress?: ApplicationUpdateProgressDto
  error?: ApplicationUpdateErrorDto; updatePackageSizeBytes?: number; cacheSizeBytes: number
  verificationStatus: UpdateVerificationStatusDto; manualInstallAvailable: boolean; sha256Available?: boolean
}
export type ApplicationUpdateResultDto<T> = { ok: true; value: T } | { ok: false; error: ApplicationUpdateErrorDto }

export interface DmgUpdateInfo {
  version: string
  size: number
  sha256: string
  assetName: string
  downloadUrl: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
}
