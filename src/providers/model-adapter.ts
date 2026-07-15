import type { DebateParticipant, DebateStage, ParticipantRole } from '../domain'
import type { ProviderFailureCode } from './provider-error-presentation'

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  toolCallId?: string
  toolCalls?: UnifiedToolCall[]
  imageInputs?: Array<{ mimeType: string; base64: string }>
}

export interface UnifiedToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface UnifiedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface UnifiedRuntimeMetadata {
  sessionId: string
  role: ParticipantRole
  turnId: string
  stage: Exclude<DebateStage, 'draft' | 'completed'>
  modelProfileId?: string
  providerConnectionId?: string
  providerId?: string
  baseUrl?: string
  reasoningEnabled?: boolean
  purpose?: 'debate-planning' | 'debate-evaluation' | 'debate-review' | 'vision-analysis'
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
  tools?: UnifiedToolDefinition[]
  toolChoice?: 'auto' | 'none'
}

export interface UnifiedResponse {
  requestId: string
  content: string
  finishReason: 'stop' | 'tool_calls'
  toolCalls?: UnifiedToolCall[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  runtimeMetadata?: Pick<UnifiedRuntimeMetadata, 'modelProfileId' | 'providerConnectionId' | 'providerId'> & {
    modelId?: string
  }
}

export interface UnifiedError {
  code: 'REQUEST_FAILED' | 'CANCELLED' | 'EMPTY_RESPONSE' | 'RUNTIME_CONFIGURATION_ERROR'
  message: string
  retryable: boolean
  statusCode?: number
  providerCode?: string
  titleZh?: string
  descriptionZh?: string
  failureCode?: ProviderFailureCode
  suggestedActionZh?: string
  technicalDetails?: string
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
