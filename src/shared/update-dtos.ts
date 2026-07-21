export const APPLICATION_UPDATE_STATUSES = [
  'idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded',
  'preparing-install', 'waiting-for-restart', 'install-failed', 'rolled-back', 'error'
] as const
export type ApplicationUpdateStatusDto = typeof APPLICATION_UPDATE_STATUSES[number]
export type UpdateVerificationStatusDto = 'not-verified' | 'verifying' | 'verified' | 'failed'

export interface ApplicationUpdateProgressDto { percent: number; transferredBytes: number; totalBytes: number; bytesPerSecond: number }
export interface ApplicationUpdateErrorDto { code: string; titleZh: string; descriptionZh: string; retryable: boolean }
export interface ApplicationUpdateStateDto {
  currentVersion: string; supported: boolean; automaticCheckEnabled: boolean; automaticDownloadEnabled: false
  status: ApplicationUpdateStatusDto; messageZh: string; availableVersion?: string; releaseName?: string
  releaseNotes?: string; releaseDate?: string; lastCheckedAt?: string; progress?: ApplicationUpdateProgressDto
  error?: ApplicationUpdateErrorDto; updatePackageSizeBytes?: number; cacheSizeBytes: number
  verificationStatus: UpdateVerificationStatusDto; manualInstallAvailable: boolean
}
export type ApplicationUpdateResultDto<T> = { ok: true; value: T } | { ok: false; error: ApplicationUpdateErrorDto }

export interface CommunityUpdateManifest {
  schemaVersion: 1; channel: 'stable'; version: string; platform: 'darwin'; arch: 'arm64'; tag: string
  assetName: string; size: number; sha256: string; releaseDate: string; releaseNotes?: string
  notesSha256: string; bundleId: 'com.leander.debatestudio'; keyId: string; signature: string
}
export interface CommunityUpdateInfo { version: string; size: number; releaseName?: string; releaseNotes?: string; releaseDate?: string; manifest: CommunityUpdateManifest }
