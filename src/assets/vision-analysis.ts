import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import type { ModelRoutingService } from '../model-routing'
import type { PersistenceContext } from '../persistence'
import type { ResearchNote } from '../research'
import { ModelAdapterError, type ModelAdapter, type UnifiedRequest } from '../providers'
import type { PromptRuntime } from '../prompt-studio'
import type { ParticipantRole } from '../domain'

export interface VisionAnalysisRequest {
  assetId: string
  modelId: string
  mimeType: string
  bytes: Uint8Array
  sessionId?: string
  topic?: string
  participantId?: string
  participantRole?: ParticipantRole
  modelProfileId?: string
  providerConnectionId?: string
  providerId?: string
  baseUrl?: string
  reasoningEnabled?: boolean
  maxTokens?: number
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

export class OpenAICompatibleVisionAdapter implements VisionAdapter {
  constructor(private readonly adapter: ModelAdapter) {}

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
    if (!request.sessionId || !request.participantId || !request.participantRole || !request.baseUrl) {
      throw new Error('Vision runtime metadata is incomplete.')
    }
    const requestId = `vision-${request.assetId}`
    const stage = request.participantRole === 'affirmative'
      ? 'affirmative_research'
      : request.participantRole === 'negative'
        ? 'negative_research'
        : 'public_pool'
    const unified: UnifiedRequest = {
      requestId, turnId: requestId, sessionId: request.sessionId, stage,
      topic: request.topic ?? '图片证据分析',
      participant: { id: request.participantId, role: request.participantRole, name: '视觉研究员' },
      prompt: '分析这张图片中可公开检查的信息。', signal: new AbortController().signal,
      modelId: request.modelId, stream: false, maxTokens: request.maxTokens,
      messages: [
        {
          role: 'system',
          content: '只返回严格 JSON：{"summary":"","observations":[],"limitations":[]}。不要输出隐藏思维链，不要把无法从图片确认的信息写成事实。'
        },
        {
          role: 'user', content: '请提取与辩题相关的可见内容、数据、图表趋势和明显局限。',
          imageInputs: [{ mimeType: request.mimeType, base64: Buffer.from(request.bytes).toString('base64') }]
        }
      ],
      runtimeMetadata: {
        sessionId: request.sessionId, role: request.participantRole, turnId: requestId, stage,
        modelProfileId: request.modelProfileId, providerConnectionId: request.providerConnectionId,
        providerId: request.providerId, baseUrl: request.baseUrl,
        reasoningEnabled: request.reasoningEnabled,
        purpose: 'vision-analysis'
      }
    }
    const response = await this.adapter.complete(unified)
    return parseVisionResponse(response.content)
  }
}

export type VisionAnalysisServiceResult =
  | { ok: true; value: { noteId: string; modelProfileId: string; modelDisplayName: string; summary: string } }
  | { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } }

export interface VisionAnalysisServiceOptions {
  persistence: PersistenceContext
  routing: ModelRoutingService
  mockAdapter?: VisionAdapter
  promptRuntime?: PromptRuntime
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
    const participant = this.options.persistence.repositories.participants.get(asset.value.ownerParticipantId)
    const session = this.options.persistence.repositories.sessions.get(asset.value.debateSessionId)
    const debate = session.ok && session.value
      ? this.options.persistence.repositories.debates.findById(session.value.debateId)
      : undefined
    if (!participant.ok || !participant.value || !session.ok || !session.value || !debate?.ok || !debate.value) {
      return this.failure('VISION_RUNTIME_MISSING', '图片研究配置不完整', '无法读取图片所属角色或辩论。', false)
    }
    const visionAdapter = route.route.providerConnection.protocolType === 'mock'
      ? this.mockAdapter
      : route.route.providerConnection.protocolType === 'openai-chat'
        ? new OpenAICompatibleVisionAdapter(route.route.adapter)
        : undefined
    if (!visionAdapter) return this.failure('VISION_ADAPTER_UNAVAILABLE', '视觉适配器不可用', '当前协议没有可用的 VisionAdapter，图片未发送。', false)
    const timestamp = this.now().toISOString()
    this.options.persistence.repositories.assetFiles.updateAnalysis(assetId, 'pending', route.route.modelProfile.id, timestamp)
    try {
      this.options.promptRuntime?.recordUsage({
        task: 'research', modelProfileId: route.route.modelProfile.id,
        modelId: route.route.modelProfile.modelId, sessionId: asset.value.debateSessionId,
        turnId: `vision-${assetId}`
      })
      const result = await visionAdapter.analyze({
        assetId,
        modelId: route.route.modelProfile.modelId,
        mimeType: metadata.value.mimeType,
        bytes: readFileSync(asset.value.localPath),
        sessionId: asset.value.debateSessionId,
        topic: debate.value.topic,
        participantId: participant.value.id,
        participantRole: participant.value.role,
        modelProfileId: route.route.modelProfile.id,
        providerConnectionId: route.route.providerConnection.id,
        providerId: route.route.providerConnection.providerId,
        baseUrl: route.route.providerConnection.baseUrl,
        reasoningEnabled: route.route.modelProfile.capabilities.reasoning,
        maxTokens: undefined
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
    } catch (cause) {
      this.options.persistence.repositories.assetFiles.updateAnalysis(assetId, 'failed', route.route.modelProfile.id, timestamp)
      const description = cause instanceof ModelAdapterError
        ? cause.detail.descriptionZh ?? '视觉模型请求失败，图片已保留。'
        : '图片已保留，可检查视觉模型策略后重试。'
      return this.failure('VISION_ANALYSIS_FAILED', '图片分析失败', description, true)
    }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): VisionAnalysisServiceResult {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}

function parseVisionResponse(content: string): VisionAnalysisResult {
  const raw: unknown = JSON.parse(content.trim())
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Vision response is not an object.')
  const record = raw as Record<string, unknown>
  if (typeof record.summary !== 'string' || !record.summary.trim()) throw new Error('Vision summary is missing.')
  if (!Array.isArray(record.observations) || !record.observations.every((item) => typeof item === 'string')) throw new Error('Vision observations are invalid.')
  if (!Array.isArray(record.limitations) || !record.limitations.every((item) => typeof item === 'string')) throw new Error('Vision limitations are invalid.')
  return {
    summary: record.summary.trim().slice(0, 8_000),
    observations: record.observations.map((item) => item.trim()).filter(Boolean).slice(0, 30),
    limitations: record.limitations.map((item) => item.trim()).filter(Boolean).slice(0, 30)
  }
}
