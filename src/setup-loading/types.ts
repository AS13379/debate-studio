import type { DebateParticipantConfig } from '../participant-config'
import type { ModelProfile, ProtocolType, ProviderConnection } from '../provider-config'
import type {
  DebateParticipantRepository,
  ModelProfileRepository,
  ProviderConnectionRepository,
  SessionRecord,
  SessionRepository
} from '../persistence'
import type { DebateCapabilityRequirements, DebateSetupValidationResult } from '../setup-validation'
import type { DebateSetupValidator } from '../setup-validation'

export type DebateSetupLoadErrorCode =
  | 'INVALID_SESSION_ID'
  | 'SESSION_NOT_FOUND'
  | 'PARTICIPANTS_EMPTY'
  | 'MODEL_PROFILE_NOT_FOUND'
  | 'PROVIDER_CONNECTION_NOT_FOUND'
  | 'REPOSITORY_READ_FAILED'
  | 'ENVIRONMENT_READ_FAILED'
  | 'APPLICATION_CLOSED'

export interface DebateSetupLoadError {
  code: DebateSetupLoadErrorCode
  titleZh: string
  descriptionZh: string
  relatedId?: string
  retryable: boolean
}

export interface LoadedParticipantSetup {
  participant: DebateParticipantConfig
  modelProfile?: ModelProfile
  providerConnection?: ProviderConnection
}

export interface LoadedDebateSetup {
  session: SessionRecord
  affirmative?: LoadedParticipantSetup
  negative?: LoadedParticipantSetup
  moderator?: LoadedParticipantSetup
  judge?: LoadedParticipantSetup
  modelProfiles: ModelProfile[]
  providerConnections: ProviderConnection[]
  availableProtocolTypes: ProtocolType[]
  requirements?: DebateCapabilityRequirements
}

export interface DebateSetupLoadResult {
  setup?: LoadedDebateSetup
  validation: DebateSetupValidationResult
  loadErrors: DebateSetupLoadError[]
}

export interface DebateSetupLoaderRepositories {
  sessions: Pick<SessionRepository, 'get'>
  participants: Pick<DebateParticipantRepository, 'listBySession'>
  modelProfiles: Pick<ModelProfileRepository, 'findById'>
  providerConnections: Pick<ProviderConnectionRepository, 'findById'>
}

export interface DebateSetupEnvironmentSource {
  getAvailableProtocolTypes(): readonly ProtocolType[]
  getCapabilityRequirements(sessionId: string): DebateCapabilityRequirements | undefined
}

export interface DebateSetupLoaderDependencies {
  repositories: DebateSetupLoaderRepositories
  environment: DebateSetupEnvironmentSource
  validator: Pick<DebateSetupValidator, 'validate'>
}
