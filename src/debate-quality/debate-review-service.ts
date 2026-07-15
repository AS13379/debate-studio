import { randomUUID } from 'node:crypto'

import { ModelAdapterError, type UnifiedRequest } from '../providers'
import { redactSensitiveText } from '../security'
import { loadQualitySource, publicDebateInput } from './quality-utils'
import type { DebateQualityServiceDependencies } from './service-dependencies'
import type { DebateQualityResult, DebateReview, DebateReviewRecord } from './types'

export const DEBATE_REVIEW_PROMPT_VERSION = 'debate-review-v1'

export class DebateReviewService {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: DebateQualityServiceDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  async review(sessionId: string): Promise<DebateQualityResult<DebateReviewRecord>> {
    const source = loadQualitySource(this.dependencies.persistence, sessionId)
    const evaluation = this.dependencies.persistence.repositories.debateQuality.findEvaluationBySession(sessionId)
    if (!source || !evaluation.ok || !evaluation.value) return this.failure('REVIEW_SOURCE_MISSING', '复盘资料不完整', '需要辩论结果、公开证据和裁判评分才能生成复盘。', true)
    let route = this.dependencies.routing.resolve('judge')
    if (!route.ok) { this.dependencies.routing.createDefaults(); route = this.dependencies.routing.resolve('judge') }
    if (!route.ok) return this.failure('REVIEW_ROUTE_MISSING', '缺少复盘模型', '请先配置裁判模型策略。', false)
    const activePrompt = this.dependencies.prompts.resolveActive('review')
    if (!activePrompt) return this.failure('REVIEW_PROMPT_MISSING', '复盘 Prompt 不可用', '无法读取当前激活的复盘 Prompt 版本。', true)
    const requestId = this.createId()
    const input = `${publicDebateInput(source)}\n\n结构化裁判评分：\n${JSON.stringify(evaluation.value.evaluation)}`
    const request: UnifiedRequest = {
      requestId, turnId: requestId, sessionId, stage: 'adjudication', topic: source.debate.topic,
      participant: { id: 'debate-reviewer', role: 'judge', name: '赛后复盘员' }, prompt: input,
      signal: new AbortController().signal, modelId: route.route.modelProfile.modelId, stream: false,
      maxTokens: Math.min(route.route.modelProfile.maxOutputTokens ?? 2_000, 3_000),
      messages: [
        { role: 'system', content: reviewSystemPrompt(activePrompt.version.content) },
        { role: 'user', content: input }
      ],
      runtimeMetadata: {
        sessionId, role: 'judge', turnId: requestId, stage: 'adjudication',
        modelProfileId: route.route.modelProfile.id,
        providerConnectionId: route.route.providerConnection.id,
        providerId: route.route.providerConnection.providerId,
        baseUrl: route.route.providerConnection.baseUrl,
        reasoningEnabled: route.route.modelProfile.capabilities.reasoning,
        purpose: 'debate-review'
      }
    }
    this.dependencies.prompts.recordUsage({ task: 'review', modelProfileId: route.route.modelProfile.id, modelId: route.route.modelProfile.modelId, sessionId, turnId: requestId })
    try {
      const response = await route.route.adapter.complete(request)
      const review = parseReview(response.content)
      if (!review.ok) return review
      const record: DebateReviewRecord = {
        id: this.createId(), debateId: source.debate.id, sessionId, review: review.value,
        reviewerModelProfileId: route.route.modelProfile.id, reviewerModelId: route.route.modelProfile.modelId,
        promptTemplateId: activePrompt.template.id, promptVersion: activePrompt.version.version,
        createdAt: this.now().toISOString()
      }
      const saved = this.dependencies.persistence.repositories.debateQuality.saveReview(record)
      return saved.ok ? { ok: true, value: record } : this.failure('REVIEW_SAVE_FAILED', '复盘保存失败', '复盘已生成，但未能写入本地数据库。', true)
    } catch (cause) {
      const description = cause instanceof ModelAdapterError ? cause.detail.descriptionZh ?? '复盘模型请求失败。' : '复盘模型未成功返回报告。'
      return this.failure('REVIEW_REQUEST_FAILED', '赛后复盘失败', description, true, cause)
    }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean, cause?: unknown): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean; technicalDetails?: string } } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable, technicalDetails: cause ? redactSensitiveText(cause instanceof Error ? cause.message : String(cause)) : undefined } }
  }
}

function reviewSystemPrompt(experiment: string): string {
  return [
    '你是辩论赛后复盘员，只生成可公开检查的复盘。',
    '不要输出隐藏思维链或内部推理过程。尽量指出具体 Turn 或证据编号。',
    '只返回严格 JSON，不要 Markdown 代码块或额外文字。',
    `当前 Prompt 实验指令：${experiment}`,
    'JSON 形状：{"summary":"","bestArguments":[],"bestRebuttals":[],"missedOpportunities":[],"evidenceAnalysis":[],"improvementSuggestions":[]}'
  ].join('\n')
}

function parseReview(content: string): DebateQualityResult<DebateReview> {
  let raw: unknown
  try { raw = JSON.parse(content.trim()) }
  catch { return invalid('模型返回的复盘不是严格 JSON。') }
  if (!isRecord(raw) || typeof raw.summary !== 'string' || !raw.summary.trim()) return invalid('复盘摘要缺失。')
  const bestArguments = list(raw.bestArguments); const bestRebuttals = list(raw.bestRebuttals)
  const missedOpportunities = list(raw.missedOpportunities); const evidenceAnalysis = list(raw.evidenceAnalysis)
  const improvementSuggestions = list(raw.improvementSuggestions)
  if (!bestArguments || !bestRebuttals || !missedOpportunities || !evidenceAnalysis || !improvementSuggestions) return invalid('复盘列表字段不完整。')
  return { ok: true, value: { summary: raw.summary.trim().slice(0, 8_000), bestArguments, bestRebuttals, missedOpportunities, evidenceAnalysis, improvementSuggestions } }
}
function list(value: unknown): string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value.map((item) => item.trim()).filter(Boolean).slice(0, 30) : undefined }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function invalid(descriptionZh: string): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } } { return { ok: false, error: { code: 'INVALID_REVIEW_JSON', titleZh: '复盘报告格式无效', descriptionZh, retryable: true } } }
