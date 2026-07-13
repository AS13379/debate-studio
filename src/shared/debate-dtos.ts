export type ProtocolTypeDto =
  | 'mock'
  | 'openai-chat'
  | 'openai-responses'
  | 'gemini-native'
  | 'dashscope-native'
  | 'mimo-native'

export type DebateParticipantRoleDto = 'affirmative' | 'negative' | 'moderator' | 'judge'

export interface ModelCapabilitiesDto {
  textInput: boolean
  imageInput: boolean
  documentInput: boolean
  audioInput: boolean
  videoInput: boolean
  streaming: boolean
  reasoning: boolean
  toolCalling: boolean
  webSearch: boolean
  structuredOutput: boolean
}

export interface ProviderConnectionDto {
  id: string
  providerId: string
  displayName: string
  protocolType: ProtocolTypeDto
  baseUrl: string
  enabled: boolean
  credentialConfigured: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveProviderConnectionInput {
  id?: string
  providerId: string
  displayName: string
  protocolType: ProtocolTypeDto
  baseUrl: string
  enabled: boolean
}

export interface ModelProfileDto {
  id: string
  connectionId: string
  modelId: string
  displayName: string
  alias?: string
  capabilities: ModelCapabilitiesDto
  contextWindow?: number
  maxOutputTokens?: number
  createdAt: string
  updatedAt: string
}

export interface SaveModelProfileInput {
  id?: string
  connectionId: string
  modelId: string
  displayName: string
  alias?: string
  capabilities: ModelCapabilitiesDto
  contextWindow?: number
  maxOutputTokens?: number
}

export interface CreateDebateInput {
  topic: string
  background?: string
  affirmativePosition: string
  negativePosition: string
  freeDebateRounds: number
}

export interface ParticipantBindingInput {
  modelProfileId: string
  displayName: string
  systemPromptTemplate?: string
}

export interface SaveParticipantBindingsInput {
  sessionId: string
  affirmative: ParticipantBindingInput
  negative: ParticipantBindingInput
  moderator: ParticipantBindingInput
  judge?: ParticipantBindingInput
}

export interface ParticipantBindingDto extends ParticipantBindingInput {
  id: string
  sessionId: string
  role: DebateParticipantRoleDto
}

export interface DebateSummaryDto {
  id: string
  sessionId: string
  topic: string
  status: string
  currentStage: string
  createdAt: string
  updatedAt: string
}

export interface DebateDetailDto extends DebateSummaryDto {
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  freeDebateRounds: number
  participants: ParticipantBindingDto[]
}

export interface DebateTurnDto {
  id: string
  sessionId: string
  participantId: string
  stage: string
  status: string
  content?: string
  retryOfTurnId?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface DebateSetupDto {
  sessionId: string
  validation: {
    valid: boolean
    errors: Array<{ code: string; titleZh: string; descriptionZh: string }>
    warnings: Array<{ code: string; titleZh: string; descriptionZh: string }>
  }
  participants: ParticipantBindingDto[]
  modelProfiles: ModelProfileDto[]
  providerConnections: ProviderConnectionDto[]
}

export interface ConnectionTestDto {
  success: boolean
  latencyMs: number
  providerStatus?: number
  error?: {
    code: string
    titleZh: string
    descriptionZh: string
    retryable: boolean
  }
}

export interface ConfigurationErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export type ConfigurationResultDto<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConfigurationErrorDto }
