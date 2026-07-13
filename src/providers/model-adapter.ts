import type { DebateParticipant, DebateStage } from '../domain'

export interface UnifiedModelRuntime {
  modelId: string
  baseUrl: string
  maxOutputTokens?: number
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
  modelRuntime?: UnifiedModelRuntime
}

export interface UnifiedResponse {
  requestId: string
  content: string
  finishReason: 'stop'
}

export interface UnifiedError {
  code: 'REQUEST_FAILED' | 'CANCELLED' | 'EMPTY_RESPONSE'
  message: string
  retryable: boolean
  statusCode?: number
  providerCode?: string
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
