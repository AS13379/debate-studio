import type { DebateParticipantRole } from '../participant-config'
import type { DebateStage } from '../domain'
import type { ModelRoutingTask } from '../model-routing'
import {
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from '../providers'
import type {
  DebateRuntimeConfig,
  RuntimeParticipant,
  RuntimePromptBuilder,
  RuntimeResearchExecutor,
  RuntimeTurnExecutionError,
  RuntimeTurnPreparationResult
} from './types'

export class RuntimeTurnExecutor implements ModelAdapter {
  constructor(
    private readonly runtimeConfig: DebateRuntimeConfig,
    private readonly promptBuilder?: RuntimePromptBuilder,
    private readonly researchExecutor?: RuntimeResearchExecutor
  ) {}

  prepareRequest(request: UnifiedRequest, stream: boolean): RuntimeTurnPreparationResult {
    const role = request.runtimeMetadata.role
    const roleParticipant = this.participantFor(role)
    if (!roleParticipant) return { ok: false, error: this.missingRoleError(role) }
    const route = this.runtimeConfig.routes?.[this.taskFor(request.stage)]
    const participant: RuntimeParticipant = route ? {
      ...roleParticipant,
      modelProfile: route.modelProfile,
      providerConnection: route.providerConnection,
      adapter: route.adapter
    } : roleParticipant

    const runtimeRequest: UnifiedRequest = {
      ...request,
      modelId: participant.modelProfile.modelId,
      messages: [],
      stream,
      maxTokens: participant.modelProfile.maxOutputTokens,
      runtimeMetadata: {
        sessionId: request.sessionId,
        role,
        turnId: request.turnId,
        stage: request.stage,
        modelProfileId: participant.modelProfile.id,
        providerConnectionId: participant.providerConnection.id,
        providerId: participant.providerConnection.providerId,
        baseUrl: participant.providerConnection.baseUrl,
        reasoningEnabled: participant.modelProfile.capabilities.reasoning
      }
    }
    runtimeRequest.messages = this.promptBuilder?.build(runtimeRequest, participant, this.runtimeConfig) ?? [
      {
        role: 'system',
        content: `辩题：${request.topic}\n角色：${request.participant.name}（${role}）`
      },
      { role: 'user', content: request.prompt }
    ]

    return {
      ok: true,
      participant,
      request: runtimeRequest
    }
  }

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    let prepared: RuntimeTurnPreparationResult
    try {
      prepared = this.prepareRequest(request, false)
    } catch (cause) {
      throw new ModelAdapterError(this.promptBuildError(cause))
    }
    if (!prepared.ok) throw new ModelAdapterError(prepared.error)
    if (this.researchExecutor?.shouldHandle(prepared.request, prepared.participant)) {
      return this.withRuntimeMetadata(await this.researchExecutor.complete(prepared.request, prepared.participant), prepared)
    }
    return this.withRuntimeMetadata(await prepared.participant.adapter.complete(prepared.request), prepared)
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    let prepared: RuntimeTurnPreparationResult
    try {
      prepared = this.prepareRequest(request, true)
    } catch (cause) {
      yield { type: 'started', requestId: request.requestId }
      yield { type: 'error', requestId: request.requestId, error: this.promptBuildError(cause) }
      return
    }
    if (!prepared.ok) {
      yield { type: 'started', requestId: request.requestId }
      yield { type: 'error', requestId: request.requestId, error: prepared.error }
      return
    }
    if (this.researchExecutor?.shouldHandle(prepared.request, prepared.participant)) {
      for await (const event of this.researchExecutor.stream(prepared.request, prepared.participant)) {
        yield event.type === 'completed'
          ? { ...event, response: this.withRuntimeMetadata(event.response, prepared) }
          : event
      }
      return
    }
    for await (const event of prepared.participant.adapter.stream(prepared.request)) {
      yield event.type === 'completed'
        ? { ...event, response: this.withRuntimeMetadata(event.response, prepared) }
        : event
    }
  }

  private withRuntimeMetadata(response: UnifiedResponse, prepared: Extract<RuntimeTurnPreparationResult, { ok: true }>): UnifiedResponse {
    return {
      ...response,
      runtimeMetadata: {
        modelProfileId: prepared.participant.modelProfile.id,
        providerConnectionId: prepared.participant.providerConnection.id,
        providerId: prepared.participant.providerConnection.providerId,
        modelId: prepared.participant.modelProfile.modelId
      }
    }
  }

  private participantFor(role: DebateParticipantRole): RuntimeParticipant | undefined {
    return this.runtimeConfig[role]
  }

  private taskFor(stage: Exclude<DebateStage, 'draft' | 'completed'>): ModelRoutingTask {
    if (stage === 'affirmative_research' || stage === 'negative_research' || stage === 'affirmative_planning' || stage === 'negative_planning') return 'research'
    if (stage === 'public_pool' || stage === 'moderating') return 'search_summary'
    if (stage === 'rebuttal' || stage === 'cross_examination') return 'rebuttal'
    if (stage === 'adjudication') return 'judge'
    return 'argument_generation'
  }

  private missingRoleError(role: DebateParticipantRole): RuntimeTurnExecutionError {
    const roleLabel = {
      affirmative: '正方',
      negative: '反方',
      moderator: '主持人',
      judge: '裁判'
    }[role]
    return {
      code: 'RUNTIME_CONFIGURATION_ERROR',
      titleZh: '运行角色配置缺失',
      descriptionZh: `当前 Turn 需要${roleLabel}，但 DebateRuntimeConfig 中没有对应的 RuntimeParticipant。`,
      message: `Runtime participant is missing for role: ${role}.`,
      role,
      retryable: false
    }
  }

  private promptBuildError(cause: unknown) {
    return {
      code: 'REQUEST_FAILED' as const,
      message: cause instanceof Error ? cause.message : 'Failed to build the role-visible prompt context.',
      titleZh: '阶段提示词构造失败',
      descriptionZh: '无法读取当前角色有权查看的研究资料，未发起模型请求。',
      retryable: true,
      suggestedActionZh: '检查本地数据库状态后重试当前 Turn。'
    }
  }
}
