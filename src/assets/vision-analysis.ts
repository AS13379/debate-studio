import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import type { ModelRoutingService } from '../model-routing'
import type { PersistenceContext } from '../persistence'
import type { ResearchNote } from '../research'

export interface VisionAnalysisRequest {
  assetId: string
  modelId: string
  mimeType: string
  bytes: Uint8Array
}

export interface VisionAnalysisResult {
  summary: string
  observations: string[]
  limitations: string[]
}

export interface VisionAdapter {
  analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult>
}

export class MockVisionAdapter implements VisionAdapter {
  readonly requests: VisionAnalysisRequest[] = []

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    this.requests.push(request)
    return {
      summary: '[Mock Vision] 图片已完成结构化分析。',
      observations: ['检测到一项可用于研究笔记的视觉信息。'],
      limitations: ['这是离线 Mock 结果，不代表真实视觉模型判断。']
    }
  }
}

export type VisionAnalysisServiceResult =
  | { ok: true; value: { noteId: string; modelProfileId: string; modelDisplayName: string; summary: string } }
  | { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } }

export interface VisionAnalysisServiceOptions {
  persistence: PersistenceContext
  routing: ModelRoutingService
  mockAdapter?: VisionAdapter
  createId?: () => string
  now?: () => Date
}

export class VisionAnalysisService {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly mockAdapter: VisionAdapter

  constructor(private readonly options: VisionAnalysisServiceOptions) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.mockAdapter = options.mockAdapter ?? new MockVisionAdapter()
  }

  async analyze(assetId: string): Promise<VisionAnalysisServiceResult> {
    const asset = this.options.persistence.repositories.research.findAssetById(assetId)
    const metadata = this.options.persistence.repositories.assetFiles.findByAssetId(assetId)
    if (!asset.ok || !asset.value || !metadata.ok || !metadata.value || metadata.value.mediaType !== 'image' || !asset.value.localPath) {
      return this.failure('VISION_ASSET_INVALID', '图片资产不可用', '仅已保存的图片资产可以进行视觉分析。', false)
    }
    const route = this.options.routing.resolve('vision_analysis')
    if (!route.ok) return { ok: false, error: route.error }
    if (!route.route.modelProfile.capabilities.imageInput) {
      return this.failure('VISION_UNSUPPORTED', '模型不支持图片', '当前策略选择的是文本模型，图片没有被发送。', false)
    }
    if (route.route.providerConnection.protocolType !== 'mock') {
      return this.failure('VISION_ADAPTER_UNAVAILABLE', '视觉适配器尚未接入', '当前阶段只提供 MockVisionAdapter；真实图片不会发送给文本 Adapter。', false)
    }
    const timestamp = this.now().toISOString()
    this.options.persistence.repositories.assetFiles.updateAnalysis(assetId, 'pending', route.route.modelProfile.id, timestamp)
    try {
      const result = await this.mockAdapter.analyze({
        assetId,
        modelId: route.route.modelProfile.modelId,
        mimeType: metadata.value.mimeType,
        bytes: readFileSync(asset.value.localPath)
      })
      const researchSession = asset.value.researchSessionId
      if (!researchSession) return this.failure('VISION_RESEARCH_SESSION_MISSING', '研究会话不存在', '图片未关联到有效研究会话。', false)
      const note: ResearchNote = {
        id: this.createId(),
        debateSessionId: asset.value.debateSessionId,
        researchSessionId: researchSession,
        ownerParticipantId: asset.value.ownerParticipantId,
        visibility: asset.value.visibility,
        assetId,
        content: JSON.stringify({ type: 'vision-analysis', ...result }),
        createdAt: timestamp
      }
      const saved = this.options.persistence.repositories.research.saveNote(note)
      if (!saved.ok) throw saved.error
      this.options.persistence.repositories.assetFiles.updateAnalysis(assetId, 'completed', route.route.modelProfile.id, timestamp)
      return {
        ok: true,
        value: {
          noteId: note.id,
          modelProfileId: route.route.modelProfile.id,
          modelDisplayName: route.route.modelProfile.displayName,
          summary: result.summary
        }
      }
    } catch {
      this.options.persistence.repositories.assetFiles.updateAnalysis(assetId, 'failed', route.route.modelProfile.id, timestamp)
      return this.failure('VISION_ANALYSIS_FAILED', '图片分析失败', '图片已保留，可检查模型策略后重试。', true)
    }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): VisionAnalysisServiceResult {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
