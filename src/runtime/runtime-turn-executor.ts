import type { DebateParticipantRole } from '../participant-config'
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
  RuntimeTurnExecutionError,
  RuntimeTurnPreparationResult
} from './types'

export class RuntimeTurnExecutor implements ModelAdapter {
  constructor(
    private readonly runtimeConfig: DebateRuntimeConfig,
    private readonly promptBuilder?: RuntimePromptBuilder
  ) {}

  prepareRequest(request: UnifiedRequest, stream: boolean): RuntimeTurnPreparationResult {
    const role = request.runtimeMetadata.role
    const participant = this.participantFor(role)
    if (!participant) return { ok: false, error: this.missingRoleError(role) }

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
        baseUrl: participant.providerConnection.baseUrl
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
    return prepared.participant.adapter.complete(prepared.request)
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
    yield* prepared.participant.adapter.stream(prepared.request)
  }

  private participantFor(role: DebateParticipantRole): RuntimeParticipant | undefined {
    return this.runtimeConfig[role]
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
