import type { PersistenceResult } from './errors'
import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { DebateParticipantConfig } from '../participant-config'
import type { DebateTurnFailure } from '../domain'
import type {
  EvidenceReferenceIssue,
  EvidenceStatus,
  EvidenceStatusHistory,
  FetchedWebPage,
  ProvisionalClaim,
  PublicResourcePool,
  PublishedEvidence,
  ResearchAsset,
  ResearchGoal,
  ResearchLoopState,
  ResearchNote,
  ResearchOwnerRole,
  ResearchSession,
  ResearchSource,
  ResearchToolCall,
  SearchProviderConnection,
  SourceEvaluation,
  SearchQuery,
  SearchSession
} from '../research'

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

export type DebateHistoryStatus = 'active' | 'archived' | 'deleted'
export type DebateHistorySort = 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc'

export interface DebateMetadataRecord {
  debateId: string
  customTitle?: string
  favorite: boolean
  status: DebateHistoryStatus
  createdAt: string
  updatedAt: string
}

export interface DebateTagRecord {
  id: string
  debateId: string
  tag: string
}

export interface DebateHistoryListQuery {
  search?: string
  sort: DebateHistorySort
  favoriteOnly: boolean
  tag?: string
  status: DebateHistoryStatus | 'all'
}

export interface DebateHistoryListRecord {
  debateId: string
  sessionId: string
  topic: string
  customTitle?: string
  favorite: boolean
  historyStatus: DebateHistoryStatus
  runStatus: string
  currentStage: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface DebateHistoryModelRecord {
  role: string
  participantDisplayName: string
  modelProfileId: string
  modelId: string
  modelDisplayName: string
  providerDisplayName: string
}

export interface DebateHistoryDetailRecord extends DebateHistoryListRecord {
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  freeDebateRounds: number
  models: DebateHistoryModelRecord[]
  researchStatus: string
  researchSessionCount: number
  completedResearchSessionCount: number
  researchIndexCount: number
  evidenceCount: number
  turnCount: number
  eventCount: number
  finalAdjudication?: {
    turnId: string
    content: string
    completedAt?: string
  }
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

export type ExportType = 'markdown' | 'html'
export type ExportStatus = 'generating' | 'completed' | 'failed'

export interface ExportRecord {
  id: string
  debateId: string
  type: ExportType
  includePrivateResearch: boolean
  filePath: string
  createdAt: string
  fileSize: number
  status: ExportStatus
  errorTitle?: string
  errorMessage?: string
}

export interface EntityRepository<T extends { id: string }> {
  findById(id: string): PersistenceResult<T | undefined>
  save(record: T): PersistenceResult<void>
}

export interface DebateRepository extends EntityRepository<DebateRecord> {
  list(): PersistenceResult<DebateRecord[]>
  delete(id: string): PersistenceResult<boolean>
}
export interface DebateHistoryRepository {
  list(query: DebateHistoryListQuery): PersistenceResult<DebateHistoryListRecord[]>
  getDetail(debateId: string): PersistenceResult<DebateHistoryDetailRecord | undefined>
  getMetadata(debateId: string): PersistenceResult<DebateMetadataRecord | undefined>
  rename(debateId: string, customTitle: string, updatedAt: string): PersistenceResult<boolean>
  setFavorite(debateId: string, favorite: boolean, updatedAt: string): PersistenceResult<boolean>
  addTag(record: DebateTagRecord, updatedAt: string): PersistenceResult<void>
  removeTag(debateId: string, tag: string, updatedAt: string): PersistenceResult<boolean>
  setStatus(debateId: string, status: DebateHistoryStatus, updatedAt: string): PersistenceResult<boolean>
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

export interface ExportRepository {
  create(record: ExportRecord): PersistenceResult<void>
  update(record: ExportRecord): PersistenceResult<boolean>
  findById(id: string): PersistenceResult<ExportRecord | undefined>
  list(): PersistenceResult<ExportRecord[]>
  delete(id: string): PersistenceResult<boolean>
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

export interface ResearchRepository {
  saveSession(session: ResearchSession): PersistenceResult<void>
  findSessionByOwner(debateSessionId: string, ownerRole: ResearchOwnerRole): PersistenceResult<ResearchSession | undefined>
  listSessions(debateSessionId: string): PersistenceResult<ResearchSession[]>
  saveGoal(goal: ResearchGoal): PersistenceResult<void>
  listGoals(debateSessionId: string): PersistenceResult<ResearchGoal[]>
  saveSearchSession(session: SearchSession): PersistenceResult<void>
  listSearchSessions(debateSessionId: string): PersistenceResult<SearchSession[]>
  saveQuery(query: SearchQuery): PersistenceResult<void>
  listQueries(debateSessionId: string): PersistenceResult<SearchQuery[]>
  saveSource(source: ResearchSource): PersistenceResult<void>
  findSourceById(id: string): PersistenceResult<ResearchSource | undefined>
  listSources(debateSessionId: string): PersistenceResult<ResearchSource[]>
  saveAsset(asset: ResearchAsset): PersistenceResult<void>
  findAssetById(id: string): PersistenceResult<ResearchAsset | undefined>
  listAssets(debateSessionId: string): PersistenceResult<ResearchAsset[]>
  saveNote(note: ResearchNote): PersistenceResult<void>
  listNotes(debateSessionId: string): PersistenceResult<ResearchNote[]>
  saveClaim(claim: ProvisionalClaim): PersistenceResult<void>
  listClaims(debateSessionId: string): PersistenceResult<ProvisionalClaim[]>
  savePublicPool(pool: PublicResourcePool): PersistenceResult<void>
  getPublicPool(debateSessionId: string): PersistenceResult<PublicResourcePool | undefined>
  createEvidence(evidence: PublishedEvidence, initialHistory: EvidenceStatusHistory): PersistenceResult<void>
  findEvidenceById(id: string): PersistenceResult<PublishedEvidence | undefined>
  listEvidence(debateSessionId: string): PersistenceResult<PublishedEvidence[]>
  countEvidenceByRole(debateSessionId: string, role: ResearchOwnerRole): PersistenceResult<number>
  changeEvidenceStatus(evidenceId: string, status: EvidenceStatus, history: EvidenceStatusHistory): PersistenceResult<boolean>
  listEvidenceHistory(debateSessionId: string): PersistenceResult<EvidenceStatusHistory[]>
  createReferenceIssue(issue: EvidenceReferenceIssue): PersistenceResult<void>
  listReferenceIssues(debateSessionId: string): PersistenceResult<EvidenceReferenceIssue[]>
  saveFetchedPage(page: FetchedWebPage): PersistenceResult<void>
  findFetchedPageBySource(sourceId: string): PersistenceResult<FetchedWebPage | undefined>
  listFetchedPages(debateSessionId: string): PersistenceResult<FetchedWebPage[]>
  saveSourceEvaluation(evaluation: SourceEvaluation): PersistenceResult<void>
  listSourceEvaluations(debateSessionId: string): PersistenceResult<SourceEvaluation[]>
  saveToolCall(call: ResearchToolCall): PersistenceResult<void>
  findCompletedToolCall(operationKey: string): PersistenceResult<ResearchToolCall | undefined>
  listToolCalls(debateSessionId: string): PersistenceResult<ResearchToolCall[]>
  saveLoopState(state: ResearchLoopState): PersistenceResult<void>
  listLoopStates(debateSessionId: string): PersistenceResult<ResearchLoopState[]>
  markActiveToolCallsInterrupted(updatedAt: string): PersistenceResult<number>
}

export interface SearchProviderConnectionRepository {
  create(connection: SearchProviderConnection): PersistenceResult<void>
  findById(id: string): PersistenceResult<SearchProviderConnection | undefined>
  list(): PersistenceResult<SearchProviderConnection[]>
  update(connection: SearchProviderConnection): PersistenceResult<boolean>
  delete(id: string): PersistenceResult<boolean>
  setDefault(id: string, updatedAt: string): PersistenceResult<boolean>
}

export interface RepositoryCollection {
  settings: SettingsRepository
  providerConnections: ProviderConnectionRepository
  modelProfiles: ModelProfileRepository
  participants: DebateParticipantRepository
  sessions: SessionRepository
  debates: DebateRepository
  debateHistory: DebateHistoryRepository
  turns: TurnRepository
  events: EventRepository
  usage: UsageRepository
  exports: ExportRepository
  research: ResearchRepository
  searchProviderConnections: SearchProviderConnectionRepository
}
