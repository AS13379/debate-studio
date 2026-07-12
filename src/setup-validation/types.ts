import type { DebateParticipantConfig, DebateParticipantRole } from '../participant-config'
import type { ModelCapabilities, ModelProfile, ProtocolType, ProviderConnection } from '../provider-config'

export type DebateSetupIssueCode =
  | 'MISSING_AFFIRMATIVE'
  | 'MISSING_NEGATIVE'
  | 'MISSING_MODERATOR'
  | 'JUDGE_NOT_CONFIGURED'
  | 'MODEL_PROFILE_NOT_FOUND'
  | 'PROVIDER_CONNECTION_NOT_FOUND'
  | 'PROVIDER_CONNECTION_DISABLED'
  | 'INVALID_BASE_URL'
  | 'ADAPTER_UNAVAILABLE'
  | 'CREDENTIAL_REFERENCE_MISSING'
  | 'MODEL_ID_MISSING'
  | 'MODEL_CAPABILITY_UNSUPPORTED'
  | 'CONTEXT_WINDOW_INSUFFICIENT'
  | 'OUTPUT_LIMIT_INSUFFICIENT'
  | 'DUPLICATE_MODEL_PROFILE'
  | 'MODERATOR_MODEL_SHARED'
  | 'CONTEXT_WINDOW_UNKNOWN'

export interface DebateSetupIssue {
  code: DebateSetupIssueCode
  titleZh: string
  descriptionZh: string
  role?: DebateParticipantRole
  configId?: string
  suggestedActionZh: string
}

export interface DebateCapabilityRequirements {
  requiredCapabilities?: Partial<ModelCapabilities>
  minimumContextWindow?: number
  minimumMaxOutputTokens?: number
}

export interface DebateSetupValidationInput {
  sessionId: string
  participants: readonly DebateParticipantConfig[]
  modelProfiles: readonly ModelProfile[]
  providerConnections: readonly ProviderConnection[]
  requirements?: DebateCapabilityRequirements
}

export interface DebateSetupValidationResult {
  valid: boolean
  errors: DebateSetupIssue[]
  warnings: DebateSetupIssue[]
}

export interface DebateSetupValidatorOptions {
  availableProtocolTypes: readonly ProtocolType[]
}

