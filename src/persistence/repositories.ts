import type { PersistenceResult } from './errors'

export interface DebateRecord {
  id: string
  topic: string
  background?: string
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

export interface ParticipantRecord {
  id: string
  debateId: string
  sessionId?: string
  role: string
  name: string
  modelProfileId?: string
  createdAt: string
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

export interface DebateRepository extends EntityRepository<DebateRecord> {}
export interface SessionRepository extends EntityRepository<SessionRecord> {}
export interface ParticipantRepository extends EntityRepository<ParticipantRecord> {}
export interface TurnRepository extends EntityRepository<TurnRecord> {}
export interface EventRepository extends EntityRepository<EventRecord> {}
export interface UsageRepository extends EntityRepository<UsageRecord> {}

export interface SettingsRepository {
  get<T>(key: string): PersistenceResult<T | undefined>
  set<T>(key: string, value: T): PersistenceResult<void>
  delete(key: string): PersistenceResult<boolean>
}

export interface RepositoryCollection {
  settings: SettingsRepository
  debates?: DebateRepository
  sessions?: SessionRepository
  participants?: ParticipantRepository
  turns?: TurnRepository
  events?: EventRepository
  usage?: UsageRepository
}

