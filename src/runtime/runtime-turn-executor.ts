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
  RuntimeTurnExecutionError,
  RuntimeTurnPreparationResult
} from './types'

export class RuntimeTurnExecutor implements ModelAdapter {
  constructor(private readonly runtimeConfig: DebateRuntimeConfig) {}

  prepareRequest(request: UnifiedRequest, stream: boolean): RuntimeTurnPreparationResult {
    const role = request.runtimeMetadata.role
    const participant = this.participantFor(role)
    if (!participant) return { ok: false, error: this.missingRoleError(role) }

    return {
      ok: true,
      participant,
      request: {
        ...request,
        modelId: participant.modelProfile.modelId,
        messages: [
          {
            role: 'system',
            content: `辩题：${request.topic}\n角色：${request.participant.name}（${role}）`
          },
          { role: 'user', content: request.prompt }
        ],
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
    }
  }

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    const prepared = this.prepareRequest(request, false)
    if (!prepared.ok) throw new ModelAdapterError(prepared.error)
    return prepared.participant.adapter.complete(prepared.request)
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    const prepared = this.prepareRequest(request, true)
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
}
