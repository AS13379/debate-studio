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

export interface ProviderPresetDto {
  providerId: string
  displayName: string
  defaultBaseUrl: string
  platformUrl: string
  documentationUrl: string
  pricingUrl: string
  supportedProtocols: ProtocolTypeDto[]
  capabilityHints: Partial<ModelCapabilitiesDto>
}

export interface AvailableProviderModelDto {
  id: string
  displayName: string
  ownedBy?: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: Partial<ModelCapabilitiesDto>
}

export interface ProviderModelDiscoveryDto {
  models: AvailableProviderModelDto[]
  source: 'provider-api' | 'built-in'
  warningZh?: string
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
  planning?: PlannedDebateDto
}

export type DebatePlanningModeDto = 'auto' | 'assist'
export type DebatePlanningDepthDto = 'light' | 'standard' | 'deep'

export interface DebatePlanDto {
  topic: string
  background: string
  affirmativePosition: string
  negativePosition: string
  keyQuestions: string[]
  researchDirections: string[]
  evidenceSuggestions: string[]
}

export interface PlannedDebateDto {
  mode: DebatePlanningModeDto
  plan: DebatePlanDto
  provenance: {
    promptVersion: string
    modelProfileId: string
    modelId: string
    createdAt: string
  }
}

export interface PlanDebateInputDto {
  operationId: string
  mode: DebatePlanningModeDto
  topic: string
  background?: string
  domain?: string
  depth?: DebatePlanningDepthDto
  affirmativePosition?: string
  negativePosition?: string
}

export interface DebatePlannerProgressDto {
  operationId: string
  stage: 'preparing' | 'routing' | 'requesting' | 'streaming' | 'parsing' | 'completed' | 'failed'
  progress: number
  labelZh: string
  detailZh?: string
  rawInput?: string
  rawOutput?: string
}

export interface DebatePlannerErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh: string
  technicalDetails?: string
}

export type DebatePlannerResultDto =
  | { ok: true; value: PlannedDebateDto }
  | { ok: false; error: DebatePlannerErrorDto }

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
  failure?: DebateTurnFailureDto
  createdAt: string
  completedAt?: string
}

export interface DebateTurnPageDto {
  turns: DebateTurnDto[]
  nextCursor?: { createdAt: string; id: string }
}

export interface DebateTurnPageInputDto {
  sessionId: string
  limit?: number
  before?: { createdAt: string; id: string }
}

export interface DebateTurnFailureDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh: string
  technicalDetails?: string
}

export interface DebateSetupIssueDto {
  code: string
  titleZh: string
  descriptionZh: string
  role?: DebateParticipantRoleDto
  configId?: string
  suggestedActionZh: string
}

export interface DebateSetupDto {
  sessionId: string
  validation: {
    valid: boolean
    errors: DebateSetupIssueDto[]
    warnings: DebateSetupIssueDto[]
  }
  participants: ParticipantBindingDto[]
  modelProfiles: ModelProfileDto[]
  providerConnections: ProviderConnectionDto[]
}

export interface ConnectionTestDto {
  success: boolean
  latencyMs: number
  providerStatus?: number
  responsePreview?: string
  error?: {
    code: string
    titleZh: string
    descriptionZh: string
    retryable: boolean
    suggestedActionZh: string
    technicalDetails: string
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
