import type { DebateParticipant, DebateStage, ParticipantRole } from '../domain'

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface UnifiedRuntimeMetadata {
  sessionId: string
  role: ParticipantRole
  turnId: string
  stage: Exclude<DebateStage, 'draft' | 'completed'>
  modelProfileId?: string
  providerConnectionId?: string
  baseUrl?: string
}

export interface UnifiedRequest {
  requestId: string
  turnId: string
  sessionId: string
  stage: Exclude<DebateStage, 'draft' | 'completed'>
  topic: string
  participant: DebateParticipant
  prompt: string
  signal: AbortSignal
  modelId: string
  messages: UnifiedMessage[]
  stream: boolean
  maxTokens: number | undefined
  runtimeMetadata: UnifiedRuntimeMetadata
}

export interface UnifiedResponse {
  requestId: string
  content: string
  finishReason: 'stop'
}

export interface UnifiedError {
  code: 'REQUEST_FAILED' | 'CANCELLED' | 'EMPTY_RESPONSE' | 'RUNTIME_CONFIGURATION_ERROR'
  message: string
  retryable: boolean
  statusCode?: number
  providerCode?: string
  titleZh?: string
  descriptionZh?: string
  role?: ParticipantRole
}

export type UnifiedStreamEvent =
  | { type: 'started'; requestId: string }
  | { type: 'textDelta'; requestId: string; delta: string }
  | { type: 'completed'; response: UnifiedResponse }
  | { type: 'error'; requestId: string; error: UnifiedError }

export interface ModelAdapter {
  complete(request: UnifiedRequest): Promise<UnifiedResponse>
  stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent>
}

export class ModelAdapterError extends Error {
  constructor(readonly detail: UnifiedError) {
    super(detail.message)
    this.name = 'ModelAdapterError'
  }
}
