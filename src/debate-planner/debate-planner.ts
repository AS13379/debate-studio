import { randomUUID } from 'node:crypto'

import type { ModelRoutingService, ResolvedModelRoute } from '../model-routing'
import { ModelAdapterError, type UnifiedRequest } from '../providers'
import { redactSensitiveText } from '../security'
import type { PromptRuntime } from '../prompt-studio'
import { DEBATE_PLANNING_PROMPT_VERSION, DebatePlanningPrompt } from './debate-planning-prompt'
import type {
  DebatePlan,
  DebatePlannerError,
  DebatePlannerResult,
  DebatePlanningInput
} from './types'

export interface DebatePlannerOptions {
  routing: ModelRoutingService
  prompt?: DebatePlanningPrompt
  createId?: () => string
  now?: () => Date
  promptRuntime?: PromptRuntime
}

export class DebatePlanner {
  private readonly prompt: DebatePlanningPrompt
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly options: DebatePlannerOptions) {
    this.prompt = options.prompt ?? new DebatePlanningPrompt()
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  async plan(input: DebatePlanningInput): Promise<DebatePlannerResult> {
    const invalid = this.validateInput(input)
    if (invalid) return { ok: false, error: invalid }
    const route = this.resolveRoute()
    if (!route.ok) return route
    const prompt = this.prompt.build(input)
    const experiment = this.options.promptRuntime?.resolveActive('debate_planning')
    const requestId = this.createId()
    const controller = new AbortController()
    const request: UnifiedRequest = {
      requestId,
      turnId: requestId,
      sessionId: 'debate-planner',
      stage: 'moderating',
      topic: input.topic.trim(),
      participant: { id: 'debate-planner', role: 'moderator', name: '辩题规划助手' },
      prompt: prompt.user,
      signal: controller.signal,
      modelId: route.route.modelProfile.modelId,
      messages: [
        { role: 'system', content: experiment ? `${prompt.system}\n\nPrompt Studio 当前版本 v${experiment.version.version}：\n${experiment.version.content}` : prompt.system },
        { role: 'user', content: prompt.user }
      ],
      stream: false,
      maxTokens: Math.min(route.route.modelProfile.maxOutputTokens ?? 1_500, 2_000),
      runtimeMetadata: {
        sessionId: 'debate-planner', role: 'moderator', turnId: requestId, stage: 'moderating',
        modelProfileId: route.route.modelProfile.id,
        providerConnectionId: route.route.providerConnection.id,
        providerId: route.route.providerConnection.providerId,
        baseUrl: route.route.providerConnection.baseUrl,
        purpose: 'debate-planning'
      }
    }
    this.options.promptRuntime?.recordUsage({
      task: 'debate_planning', modelProfileId: route.route.modelProfile.id,
      modelId: route.route.modelProfile.modelId, turnId: requestId
    })

    try {
      const response = await route.route.adapter.complete(request)
      const parsed = parsePlan(response.content, input.topic.trim())
      if (!parsed.ok) return parsed
      return {
        ok: true,
        value: {
          mode: input.mode,
          plan: parsed.plan,
          provenance: {
            promptVersion: DEBATE_PLANNING_PROMPT_VERSION,
            modelProfileId: route.route.modelProfile.id,
            modelId: route.route.modelProfile.modelId,
            createdAt: this.now().toISOString()
          }
        }
      }
    } catch (cause) {
      const detail = cause instanceof ModelAdapterError ? cause.detail : undefined
      return {
        ok: false,
        error: this.error(
          'MODEL_REQUEST_FAILED',
          detail?.titleZh ?? '辩题规划失败',
          detail?.descriptionZh ?? '模型没有成功返回辩论方案。',
          detail?.retryable ?? true,
          detail?.suggestedActionZh ?? '检查规划模型配置后重新生成。',
          cause instanceof Error ? cause.message : String(cause)
        )
      }
    }
  }

  private resolveRoute(): { ok: true; route: ResolvedModelRoute } | { ok: false; error: DebatePlannerError } {
    let resolved = this.options.routing.resolve('debate_planning')
    if (!resolved.ok) {
      this.options.routing.createDefaults()
      resolved = this.options.routing.resolve('debate_planning')
    }
    return resolved.ok
      ? resolved
      : { ok: false, error: this.error('MODEL_ROUTE_UNAVAILABLE', '没有可用的规划模型', resolved.error.descriptionZh, false, '请在“设置 → 模型策略”中配置辩题规划模型。') }
  }

  private validateInput(input: DebatePlanningInput): DebatePlannerError | undefined {
    if (!input.topic.trim()) return this.error('INVALID_INPUT', '请输入辩题', '生成方案前需要先填写辩题。', false, '填写一个明确、可辩论的命题。')
    if (input.mode === 'assist' && (!input.affirmativePosition?.trim() || !input.negativePosition?.trim())) {
      return this.error('INVALID_INPUT', '初始立场不完整', 'AI 辅助完善模式需要正反双方的初始立场。', false, '补充两方初始立场后重试。')
    }
    return undefined
  }

  private error(
    code: DebatePlannerError['code'], titleZh: string, descriptionZh: string,
    retryable: boolean, suggestedActionZh: string, technicalDetails?: string
  ): DebatePlannerError {
    return {
      code, titleZh, descriptionZh, retryable, suggestedActionZh,
      technicalDetails: technicalDetails ? redactSensitiveText(technicalDetails) : undefined
    }
  }
}

function parsePlan(content: string, topic: string): { ok: true; plan: DebatePlan } | { ok: false; error: DebatePlannerError } {
  let value: unknown
  try { value = JSON.parse(content.trim()) }
  catch (cause) { return invalidJson(cause instanceof Error ? cause.message : String(cause)) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidPlan('返回结果不是对象。')
  const record = value as Record<string, unknown>
  const background = text(record.background)
  const affirmativePosition = text(record.affirmativePosition)
  const negativePosition = text(record.negativePosition)
  const keyQuestions = stringList(record.keyQuestions)
  const researchDirections = stringList(record.researchDirections)
  const evidenceSuggestions = record.evidenceSuggestions === undefined ? [] : stringList(record.evidenceSuggestions)
  if (!background || !affirmativePosition || !negativePosition || !keyQuestions || !researchDirections || !evidenceSuggestions) {
    return invalidPlan('必需字段缺失或字段类型不正确。')
  }
  return { ok: true, plan: { topic, background, affirmativePosition, negativePosition, keyQuestions, researchDirections, evidenceSuggestions } }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 20_000) : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 12)
}

function invalidJson(details: string): { ok: false; error: DebatePlannerError } {
  return { ok: false, error: { code: 'INVALID_JSON', titleZh: '模型返回格式无法解析', descriptionZh: '规划模型没有返回约定的 JSON，方案尚未生成。', retryable: true, suggestedActionZh: '可以重新生成；若持续失败，请更换支持结构化输出的模型。', technicalDetails: redactSensitiveText(details) } }
}

function invalidPlan(details: string): { ok: false; error: DebatePlannerError } {
  return { ok: false, error: { code: 'INVALID_PLAN', titleZh: '辩论方案字段不完整', descriptionZh: '模型返回的 JSON 缺少必要字段，系统没有偷偷补全或继续创建。', retryable: true, suggestedActionZh: '重新生成或更换规划模型。', technicalDetails: redactSensitiveText(details) } }
}
