import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import type { ProcessAssetInput, ProcessAssetResult } from './types'

export interface AssetProcessorOptions {
  directory: string
  createImageThumbnail?: (bytes: Uint8Array, mimeType: string) => Uint8Array | undefined
  maxImageBytes?: number
  maxPdfBytes?: number
}

export class AssetProcessor {
  private readonly maxImageBytes: number
  private readonly maxPdfBytes: number

  constructor(private readonly options: AssetProcessorOptions) {
    this.maxImageBytes = options.maxImageBytes ?? 10 * 1024 * 1024
    this.maxPdfBytes = options.maxPdfBytes ?? 25 * 1024 * 1024
  }

  process(input: ProcessAssetInput): ProcessAssetResult {
    const mediaType: 'image' | 'pdf' | undefined = input.mimeType === 'application/pdf'
      ? 'pdf'
      : input.mimeType.startsWith('image/')
        ? 'image'
        : undefined
    if (!mediaType) return this.failure('UNSUPPORTED_ASSET_TYPE', '不支持的资产类型', '当前仅支持常见图片和 PDF 文件。', false)
    const maximum = mediaType === 'image' ? this.maxImageBytes : this.maxPdfBytes
    if (input.bytes.byteLength > maximum) {
      return this.failure('ASSET_TOO_LARGE', '文件过大', `文件超过 ${Math.round(maximum / 1024 / 1024)} MB 限制。`, false)
    }
    if (mediaType === 'pdf' && !this.isPdf(input.bytes)) {
      return this.failure('INVALID_ASSET', 'PDF 文件无效', '文件内容不是有效的 PDF，未保存。', false)
    }

    try {
      mkdirSync(this.options.directory, { recursive: true, mode: 0o700 })
      const extension = this.extension(input.fileName, input.mimeType)
      const localPath = join(this.options.directory, `${input.assetId}${extension}`)
      writeFileSync(localPath, input.bytes, { mode: 0o600 })
      let thumbnailPath: string | undefined
      if (mediaType === 'image') {
        const thumbnail = this.options.createImageThumbnail?.(input.bytes, input.mimeType)
        if (thumbnail?.byteLength) {
          thumbnailPath = join(this.options.directory, `${input.assetId}.thumbnail.png`)
          writeFileSync(thumbnailPath, thumbnail, { mode: 0o600 })
        }
      }
      const dimensions = mediaType === 'image' ? this.imageDimensions(input.bytes, input.mimeType) : undefined
      const metadata = {
        assetId: input.assetId,
        mediaType,
        mimeType: input.mimeType,
        fileSize: input.bytes.byteLength,
        pageCount: mediaType === 'pdf' ? this.pdfPageCount(input.bytes) : undefined,
        width: dimensions?.width,
        height: dimensions?.height,
        thumbnailPath,
        analysisStatus: 'not-requested' as const,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }
      return { ok: true, value: { localPath, metadata } }
    } catch {
      return this.failure('ASSET_WRITE_FAILED', '资产保存失败', '无法将文件安全保存到应用数据目录。', true)
    }
  }

  private extension(fileName: string, mimeType: string): string {
    const candidate = extname(fileName).toLowerCase()
    if (/^\.[a-z0-9]{1,6}$/.test(candidate)) return candidate
    if (mimeType === 'application/pdf') return '.pdf'
    if (mimeType === 'image/png') return '.png'
    if (mimeType === 'image/gif') return '.gif'
    if (mimeType === 'image/webp') return '.webp'
    return '.jpg'
  }

  private isPdf(bytes: Uint8Array): boolean {
    return bytes.byteLength >= 5 && new TextDecoder('ascii').decode(bytes.slice(0, 5)) === '%PDF-'
  }

  private pdfPageCount(bytes: Uint8Array): number {
    const text = new TextDecoder('latin1').decode(bytes)
    const count = text.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0
    return Math.max(1, count)
  }

  private imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
    if (mimeType === 'image/png' && bytes.byteLength >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    if (mimeType === 'image/gif' && bytes.byteLength >= 10) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    }
    return undefined
  }

  private failure(
    code: 'UNSUPPORTED_ASSET_TYPE' | 'ASSET_TOO_LARGE' | 'INVALID_ASSET' | 'ASSET_WRITE_FAILED',
    titleZh: string,
    descriptionZh: string,
    retryable: boolean
  ): ProcessAssetResult {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
