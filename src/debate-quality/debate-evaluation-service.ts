import { randomUUID } from 'node:crypto'

import { ModelAdapterError, type UnifiedRequest } from '../providers'
import { redactSensitiveText } from '../security'
import { loadQualitySource, publicDebateInput } from './quality-utils'
import type { DebateQualityServiceDependencies } from './service-dependencies'
import {
  DEBATE_SCORE_DIMENSIONS,
  type DebateEvaluation,
  type DebateEvaluationRecord,
  type DebateQualityResult,
  type DebateSideScores
} from './types'

export const DEBATE_EVALUATION_PROMPT_VERSION = 'debate-evaluation-v1'

export class DebateEvaluationService {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: DebateQualityServiceDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  async evaluate(sessionId: string): Promise<DebateQualityResult<DebateEvaluationRecord>> {
    const source = loadQualitySource(this.dependencies.persistence, sessionId)
    if (!source) return this.failure('QUALITY_SOURCE_MISSING', '评分资料不完整', '无法读取这场辩论的公开发言或证据。', true)
    let route = this.dependencies.routing.resolve('judge')
    if (!route.ok) { this.dependencies.routing.createDefaults(); route = this.dependencies.routing.resolve('judge') }
    if (!route.ok) return this.failure('JUDGE_ROUTE_MISSING', '缺少裁判模型', '请先在模型策略中配置裁判模型。', false)
    const activePrompt = this.dependencies.prompts.resolveActive('judge')
    if (!activePrompt) return this.failure('JUDGE_PROMPT_MISSING', '裁判 Prompt 不可用', '无法读取当前激活的裁判 Prompt 版本。', true)
    const requestId = this.createId()
    const request: UnifiedRequest = {
      requestId, turnId: requestId, sessionId, stage: 'adjudication', topic: source.debate.topic,
      participant: { id: 'debate-evaluator', role: 'judge', name: '结构化裁判员' },
      prompt: publicDebateInput(source), signal: new AbortController().signal,
      modelId: route.route.modelProfile.modelId, stream: false,
      maxTokens: undefined,
      messages: [
        { role: 'system', content: evaluationSystemPrompt(activePrompt.version.content) },
        { role: 'user', content: publicDebateInput(source) }
      ],
      runtimeMetadata: {
        sessionId, role: 'judge', turnId: requestId, stage: 'adjudication',
        modelProfileId: route.route.modelProfile.id,
        providerConnectionId: route.route.providerConnection.id,
        providerId: route.route.providerConnection.providerId,
        baseUrl: route.route.providerConnection.baseUrl,
        reasoningEnabled: route.route.modelProfile.capabilities.reasoning,
        purpose: 'debate-evaluation'
      }
    }
    this.dependencies.prompts.recordUsage({
      task: 'judge', modelProfileId: route.route.modelProfile.id,
      modelId: route.route.modelProfile.modelId, sessionId, turnId: requestId
    })
    try {
      const response = await route.route.adapter.complete(request)
      const evaluation = parseEvaluation(response.content)
      if (!evaluation.ok) return evaluation
      const record: DebateEvaluationRecord = {
        id: this.createId(), debateId: source.debate.id, sessionId, evaluation: evaluation.value,
        evaluatorModelProfileId: route.route.modelProfile.id,
        evaluatorModelId: route.route.modelProfile.modelId,
        promptTemplateId: activePrompt.template.id,
        promptVersion: activePrompt.version.version,
        createdAt: this.now().toISOString()
      }
      const saved = this.dependencies.persistence.repositories.debateQuality.saveEvaluation(record)
      return saved.ok ? { ok: true, value: record } : this.failure('EVALUATION_SAVE_FAILED', '评分保存失败', '评分已生成，但未能写入本地数据库。', true)
    } catch (cause) {
      const description = cause instanceof ModelAdapterError
        ? cause.detail.descriptionZh ?? '裁判模型请求失败。'
        : '裁判模型未成功返回评分。'
      return this.failure('EVALUATION_REQUEST_FAILED', '辩论评分失败', description, true, cause)
    }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean, cause?: unknown): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean; technicalDetails?: string } } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable, technicalDetails: cause ? redactSensitiveText(cause instanceof Error ? cause.message : String(cause)) : undefined } }
  }
}

function evaluationSystemPrompt(experiment: string): string {
  return [
    '你是辩论质量裁判员。只基于提供的公开发言和公开证据评分。',
    '不要输出或描述隐藏思维链、内部推理过程或私有研究。',
    '每个分数必须是 0 到 10 之间的数字，reason 只写简短、可公开的理由。',
    '只返回严格 JSON，不要 Markdown 代码块或额外文字。',
    `当前 Prompt 实验指令：${experiment}`,
    `JSON 形状：${JSON.stringify(evaluationShape())}`
  ].join('\n')
}

function evaluationShape() {
  const dimension = { score: 0, reason: '' }
  const scores = Object.fromEntries(DEBATE_SCORE_DIMENSIONS.map((key) => [key, dimension]))
  return {
    winner: 'affirmative|negative|draw', scores: { affirmative: scores, negative: scores },
    strengths: { affirmative: [''], negative: [''] }, weaknesses: { affirmative: [''], negative: [''] },
    keyTurningPoints: [''], evidenceUsage: { affirmative: '', negative: '' },
    reasoningQuality: { affirmative: '', negative: '' }
  }
}

function parseEvaluation(content: string): DebateQualityResult<DebateEvaluation> {
  let raw: unknown
  try { raw = JSON.parse(content.trim()) }
  catch { return invalid('模型返回的评分不是严格 JSON。') }
  if (!isRecord(raw) || !['affirmative', 'negative', 'draw'].includes(String(raw.winner))) return invalid('胜负字段无效。')
  const scoresRaw = isRecord(raw.scores) ? raw.scores : undefined
  const affirmative = parseScores(scoresRaw?.affirmative)
  const negative = parseScores(scoresRaw?.negative)
  const strengths = sidesOfLists(raw.strengths)
  const weaknesses = sidesOfLists(raw.weaknesses)
  const evidenceUsage = sidesOfText(raw.evidenceUsage)
  const reasoningQuality = sidesOfText(raw.reasoningQuality)
  const keyTurningPoints = list(raw.keyTurningPoints)
  if (!affirmative || !negative || !strengths || !weaknesses || !evidenceUsage || !reasoningQuality || !keyTurningPoints) return invalid('评分字段缺失或类型错误。')
  return { ok: true, value: { winner: raw.winner as DebateEvaluation['winner'], scores: { affirmative, negative }, strengths, weaknesses, keyTurningPoints, evidenceUsage, reasoningQuality } }
}

function parseScores(value: unknown): DebateSideScores | undefined {
  if (!isRecord(value)) return undefined
  const output = {} as DebateSideScores
  for (const dimension of DEBATE_SCORE_DIMENSIONS) {
    const item = value[dimension]
    if (!isRecord(item) || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 10 || typeof item.reason !== 'string' || !item.reason.trim()) return undefined
    output[dimension] = { score: Math.round(item.score * 10) / 10, reason: item.reason.trim().slice(0, 1_000) }
  }
  return output
}

function sidesOfLists(value: unknown): Record<'affirmative' | 'negative', string[]> | undefined {
  if (!isRecord(value)) return undefined
  const affirmative = list(value.affirmative); const negative = list(value.negative)
  return affirmative && negative ? { affirmative, negative } : undefined
}

function sidesOfText(value: unknown): Record<'affirmative' | 'negative', string> | undefined {
  if (!isRecord(value)) return undefined
  const affirmative = text(value.affirmative); const negative = text(value.negative)
  return affirmative && negative ? { affirmative, negative } : undefined
}

function list(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : undefined
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4_000) : undefined }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function invalid(descriptionZh: string): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } } {
  return { ok: false, error: { code: 'INVALID_EVALUATION_JSON', titleZh: '裁判评分格式无效', descriptionZh, retryable: true } }
}
