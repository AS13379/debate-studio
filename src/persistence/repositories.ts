import type { PersistenceResult } from './errors'
import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { DebateParticipantConfig } from '../participant-config'
import type { DebateTurnFailure } from '../domain'

export interface DebateRecord {
  id: string
  topic: string
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  freeDebateRounds?: number
  status: string
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  id: string
  debateId: string
  status: string
  currentStage: string
  createdAt: string
  updatedAt: string
}

export interface TurnRecord {
  id: string
  sessionId: string
  participantId: string
  stage: string
  status: string
  content?: string
  retryOfTurnId?: string
  error?: string
  failure?: DebateTurnFailure
  createdAt: string
  completedAt?: string
}

export interface EventRecord {
  id: string
  sessionId: string
  turnId?: string
  type: string
  payloadJson: string
  createdAt: string
}

export interface UsageRecord {
  id: string
  sessionId: string
  turnId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedCost?: number
  costIsEstimated: boolean
  durationMs?: number
  createdAt: string
}

export interface EntityRepository<T extends { id: string }> {
  findById(id: string): PersistenceResult<T | undefined>
  save(record: T): PersistenceResult<void>
}

export interface DebateRepository extends EntityRepository<DebateRecord> {
  list(): PersistenceResult<DebateRecord[]>
  delete(id: string): PersistenceResult<boolean>
}
export interface SessionRepository {
  create(record: SessionRecord): PersistenceResult<void>
  get(id: string): PersistenceResult<SessionRecord | undefined>
  exists(id: string): PersistenceResult<boolean>
  listByDebate(debateId: string): PersistenceResult<SessionRecord[]>
  updateRuntimeState(id: string, status: string, currentStage: string, updatedAt: string): PersistenceResult<boolean>
  markInProgressInterrupted(updatedAt: string): PersistenceResult<number>
}
export interface TurnRepository {
  findById(id: string): PersistenceResult<TurnRecord | undefined>
  create(record: TurnRecord): PersistenceResult<void>
  update(record: TurnRecord): PersistenceResult<boolean>
  listBySession(sessionId: string): PersistenceResult<TurnRecord[]>
  findLatestRetryable(sessionId: string): PersistenceResult<TurnRecord | undefined>
  markInProgressInterrupted(completedAt: string): PersistenceResult<number>
}
export interface EventRepository {
  findById(id: string): PersistenceResult<EventRecord | undefined>
  create(record: EventRecord): PersistenceResult<void>
  listBySession(sessionId: string): PersistenceResult<EventRecord[]>
}
export interface UsageRepository {
  findById(id: string): PersistenceResult<UsageRecord | undefined>
  create(record: UsageRecord): PersistenceResult<void>
  listBySession(sessionId: string): PersistenceResult<UsageRecord[]>
}

export interface SettingsRepository {
  get<T>(key: string): PersistenceResult<T | undefined>
  set<T>(key: string, value: T): PersistenceResult<void>
  delete(key: string): PersistenceResult<boolean>
}

export interface ProviderConnectionRepository {
  create(connection: ProviderConnection): PersistenceResult<void>
  findById(id: string): PersistenceResult<ProviderConnection | undefined>
  list(): PersistenceResult<ProviderConnection[]>
  update(connection: ProviderConnection): PersistenceResult<boolean>
  delete(id: string): PersistenceResult<boolean>
}

export interface ModelProfileRepository {
  create(profile: ModelProfile): PersistenceResult<void>
  findById(id: string): PersistenceResult<ModelProfile | undefined>
  list(): PersistenceResult<ModelProfile[]>
  listByConnection(connectionId: string): PersistenceResult<ModelProfile[]>
  update(profile: ModelProfile): PersistenceResult<boolean>
  delete(id: string): PersistenceResult<boolean>
}

export interface DebateParticipantRepository {
  create(participant: DebateParticipantConfig): PersistenceResult<void>
  get(id: string): PersistenceResult<DebateParticipantConfig | undefined>
  listBySession(sessionId: string): PersistenceResult<DebateParticipantConfig[]>
  update(participant: DebateParticipantConfig): PersistenceResult<boolean>
  delete(id: string): PersistenceResult<boolean>
}

export interface RepositoryCollection {
  settings: SettingsRepository
  providerConnections: ProviderConnectionRepository
  modelProfiles: ModelProfileRepository
  participants: DebateParticipantRepository
  sessions: SessionRepository
  debates: DebateRepository
  turns: TurnRepository
  events: EventRepository
  usage: UsageRepository
}
