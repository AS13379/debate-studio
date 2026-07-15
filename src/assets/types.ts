export type AssetMediaType = 'image' | 'pdf'
export type AssetAnalysisStatus = 'not-requested' | 'pending' | 'completed' | 'failed'

export interface AssetFileRecord {
  assetId: string
  mediaType: AssetMediaType
  mimeType: string
  fileSize: number
  pageCount?: number
  width?: number
  height?: number
  thumbnailPath?: string
  analysisStatus: AssetAnalysisStatus
  analysisModelProfileId?: string
  createdAt: string
  updatedAt: string
}

export interface ProcessAssetInput {
  assetId: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
  createdAt: string
}

export interface ProcessedAsset {
  localPath: string
  metadata: AssetFileRecord
}

export interface AssetProcessingError {
  code: 'UNSUPPORTED_ASSET_TYPE' | 'ASSET_TOO_LARGE' | 'INVALID_ASSET' | 'ASSET_WRITE_FAILED'
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export type ProcessAssetResult =
  | { ok: true; value: ProcessedAsset }
  | { ok: false; error: AssetProcessingError }
