import type { DebateParticipantConfig, DebateParticipantRole } from '../participant-config'
import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { SessionRecord } from '../persistence'
import type { ModelAdapter, UnifiedError, UnifiedRequest } from '../providers'

export interface RuntimeParticipant {
  role: DebateParticipantRole
  participant: DebateParticipantConfig
  modelProfile: ModelProfile
  providerConnection: ProviderConnection
  adapter: ModelAdapter
}

export interface DebateRuntimeConfig {
  session: SessionRecord
  affirmative: RuntimeParticipant
  negative: RuntimeParticipant
  moderator: RuntimeParticipant
  judge?: RuntimeParticipant
}

export type RuntimeResolveErrorCode =
  | 'REQUIRED_PARTICIPANT_MISSING'
  | 'MODEL_PROFILE_MISSING'
  | 'PROVIDER_CONNECTION_MISSING'
  | 'PROVIDER_CONNECTION_DISABLED'
  | 'ADAPTER_UNAVAILABLE'

export interface RuntimeResolveError {
  code: RuntimeResolveErrorCode
  titleZh: string
  descriptionZh: string
  role: DebateParticipantRole
  retryable: boolean
}

export type RuntimeResolveResult =
  | { ok: true; config: DebateRuntimeConfig }
  | { ok: false; errors: RuntimeResolveError[] }

export interface RuntimeTurnExecutionError extends UnifiedError {
  code: 'RUNTIME_CONFIGURATION_ERROR'
  titleZh: string
  descriptionZh: string
  role: DebateParticipantRole
  retryable: false
}

export type RuntimeTurnPreparationResult =
  | { ok: true; request: UnifiedRequest; participant: RuntimeParticipant }
  | { ok: false; error: RuntimeTurnExecutionError }
