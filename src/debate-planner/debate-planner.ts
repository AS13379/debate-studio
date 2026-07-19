import { randomUUID } from 'node:crypto'

import type { ModelRoutingService, ResolvedModelRoute } from '../model-routing'
import { ModelAdapterError, type UnifiedRequest } from '../providers'
import { redactSensitiveText } from '../security'
import type { PromptRuntime } from '../prompt-studio'
import { DEBATE_PLANNING_PROMPT_VERSION, DebatePlanningPrompt } from './debate-planning-prompt'
import type {
  DebatePlan,
  DebatePlannerError,
  DebatePlannerProgressEvent,
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
  private readonly activeControllers = new Map<string, AbortController>()

  constructor(private readonly options: DebatePlannerOptions) {
    this.prompt = options.prompt ?? new DebatePlanningPrompt()
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  async plan(input: DebatePlanningInput, onProgress?: (event: DebatePlannerProgressEvent) => void): Promise<DebatePlannerResult> {
    onProgress?.({ stage: 'preparing', progress: 8, labelZh: '正在检查辩题', detailZh: '确认输入完整，尚未创建 Session。' })
    const invalid = this.validateInput(input)
    if (invalid) {
      onProgress?.({ stage: 'failed', progress: 100, labelZh: invalid.titleZh, detailZh: invalid.descriptionZh })
      return { ok: false, error: invalid }
    }
    const route = this.resolveRoute()
    if (!route.ok) {
      onProgress?.({ stage: 'failed', progress: 100, labelZh: route.error.titleZh, detailZh: route.error.descriptionZh })
      return route
    }
    onProgress?.({ stage: 'routing', progress: 20, labelZh: '已选择规划模型', detailZh: `${route.route.modelProfile.displayName} · ${route.route.modelProfile.modelId}` })
    const prompt = this.prompt.build(input)
    const experiment = this.options.promptRuntime?.resolveActive('debate_planning')
    const requestId = this.createId()
    const controller = new AbortController()
    const operationId = input.operationId ?? requestId
    this.activeControllers.set(operationId, controller)
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
      stream: true,
      maxTokens: undefined,
      runtimeMetadata: {
        sessionId: 'debate-planner', role: 'moderator', turnId: requestId, stage: 'moderating',
        modelProfileId: route.route.modelProfile.id,
        providerConnectionId: route.route.providerConnection.id,
        providerId: route.route.providerConnection.providerId,
        baseUrl: route.route.providerConnection.baseUrl,
        reasoningEnabled: route.route.modelProfile.capabilities.reasoning,
        purpose: 'debate-planning'
      }
    }
    this.options.promptRuntime?.recordUsage({
      task: 'debate_planning', modelProfileId: route.route.modelProfile.id,
      modelId: route.route.modelProfile.modelId, turnId: requestId
    })

    const rawInput = request.messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join('\n\n')
    onProgress?.({
      stage: 'requesting', progress: 34, labelZh: '正在把规划要求发送给 AI',
      detailZh: `请求 ${route.route.providerConnection.displayName}，应用不设输出上限，由服务商管理模型额度。`,
      rawInput: visibleText(rawInput)
    })

    try {
      let content = ''
      let reasoningContent = ''
      let streamError: ModelAdapterError | undefined
      let emittedAtLength = 0
      let reasoningEmittedAtLength = 0
      let reasoningEmittedAt = 0
      for await (const event of route.route.adapter.stream(request)) {
        if (event.type === 'error') {
          streamError = new ModelAdapterError(event.error)
          break
        }
        if (event.type === 'textDelta') {
          content += event.delta
          if (content.length - emittedAtLength >= 80) {
            emittedAtLength = content.length
            onProgress?.({
              stage: 'streaming', progress: Math.min(84, 44 + Math.floor(content.length / 120)),
              labelZh: 'AI 正在生成辩论方案', detailZh: `已收到 ${content.length.toLocaleString()} 个字符。`,
              rawOutput: visibleText(content)
            })
          }
        }
        if (event.type === 'reasoningDelta') {
          reasoningContent += event.delta
          const now = Date.now()
          if (reasoningContent.length - reasoningEmittedAtLength >= 32 || now - reasoningEmittedAt >= 250) {
            reasoningEmittedAtLength = reasoningContent.length
            reasoningEmittedAt = now
            onProgress?.({
              stage: 'streaming', progress: Math.min(72, 40 + Math.floor(reasoningContent.length / 180)),
              labelZh: 'AI 正在思考辩题', detailZh: `已收到 ${reasoningContent.length.toLocaleString()} 个思考字符，模型仍在运行。`,
              rawReasoning: visibleText(reasoningContent)
            })
          }
        }
        if (event.type === 'completed') content = event.response.content || content
      }
      if (reasoningContent.length > reasoningEmittedAtLength) {
        onProgress?.({
          stage: 'streaming', progress: 84, labelZh: 'AI 已完成思考',
          detailZh: '正在整理最终结构化方案。', rawReasoning: visibleText(reasoningContent)
        })
      }
      if (streamError) throw streamError
      if (!content.trim()) throw new ModelAdapterError({ code: 'EMPTY_RESPONSE', message: 'Planner stream returned no content.', retryable: true })
      onProgress?.({ stage: 'parsing', progress: 90, labelZh: '正在整理 AI 返回内容', detailZh: '检查 JSON 字段，不会偷偷补全解析失败的结果。', rawOutput: visibleText(content), rawReasoning: reasoningContent ? visibleText(reasoningContent) : undefined })
      const parsed = parsePlan(content, input.topic.trim())
      if (!parsed.ok) {
        onProgress?.({ stage: 'failed', progress: 100, labelZh: parsed.error.titleZh, detailZh: parsed.error.descriptionZh, rawOutput: visibleText(content), rawReasoning: reasoningContent ? visibleText(reasoningContent) : undefined })
        return parsed
      }
      onProgress?.({ stage: 'completed', progress: 100, labelZh: '辩论方案已生成', detailZh: '可以关闭窗口并逐项编辑方案。', rawOutput: visibleText(content), rawReasoning: reasoningContent ? visibleText(reasoningContent) : undefined })
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
      const result: DebatePlannerResult = {
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
      onProgress?.({ stage: 'failed', progress: 100, labelZh: result.error.titleZh, detailZh: result.error.descriptionZh })
      return result
    } finally {
      if (this.activeControllers.get(operationId) === controller) this.activeControllers.delete(operationId)
    }
  }

  cancel(operationId: string): boolean {
    const controller = this.activeControllers.get(operationId)
    if (!controller) return false
    controller.abort(new Error('Debate planning cancelled by user.'))
    return true
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

function visibleText(value: string): string {
  const limit = 40_000
  if (value.length <= limit) return value
  return `${value.slice(0, 24_000)}\n\n……内容过长，已省略中间部分……\n\n${value.slice(-12_000)}`
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
