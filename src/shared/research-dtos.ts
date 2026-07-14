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
  ResearchSource,
  ResearchToolCall,
  ResearchVisibility,
  SearchProviderConnection,
  SearchQuery,
  SearchSession,
  SourceEvaluation
} from '../research/types'

export interface ResearchErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export type ResearchResultDto<T> = { ok: true; value: T } | { ok: false; error: ResearchErrorDto }

export type ResearchAssetDto = Omit<ResearchAsset, 'localPath'> & {
  hasLocalFile: boolean
  capabilityWarningZh?: string
}

export interface RoleResearchWorkspaceDto {
  goals: ResearchGoal[]
  queries: SearchQuery[]
  sources: ResearchSource[]
  assets: ResearchAssetDto[]
  notes: ResearchNote[]
  claims: ProvisionalClaim[]
  searchSessions: SearchSession[]
  fetchedPages: Array<Omit<FetchedWebPage, 'bodyText'> & { hasFullText: boolean }>
  sourceEvaluations: SourceEvaluation[]
  toolCalls: ResearchToolCall[]
  loopState?: ResearchLoopState
}

export interface ResearchWorkspaceDto {
  debateSessionId: string
  publicPool?: PublicResourcePool
  publicAssets: ResearchAssetDto[]
  affirmative: RoleResearchWorkspaceDto
  negative: RoleResearchWorkspaceDto
  moderator: RoleResearchWorkspaceDto
  evidence: PublishedEvidence[]
  evidenceHistory: EvidenceStatusHistory[]
  invalidEvidenceReferences: EvidenceReferenceIssue[]
}

export interface AddResearchAssetInput {
  sessionId: string
  ownerParticipantId: string
  visibility: ResearchVisibility
  kind: 'text' | 'url' | 'image'
  title: string
  textContent?: string
  url?: string
  summary?: string
  fileName?: string
  mimeType?: string
  bytes?: number[]
}

export interface PublishEvidenceInput {
  sessionId: string
  assetId: string
  changedBy: string
}

export interface UpdateEvidenceStatusInput {
  sessionId: string
  evidenceId: string
  status: EvidenceStatus
  changedBy: string
  note: string
}

export interface ChallengeEvidenceInput {
  sessionId: string
  evidenceId: string
  changedBy: string
  note: string
}

export interface RunMockSearchInput {
  sessionId: string
  ownerParticipantId: string
  query: string
}

export type SearchProviderConnectionDto = Omit<SearchProviderConnection, 'credentialRef'> & {
  credentialConfigured: boolean
}

export interface SaveSearchProviderConnectionInput {
  id?: string
  displayName: string
  baseUrl: string
  enabled: boolean
  isDefault: boolean
}

export interface ResearchRuntimeSettingsInput {
  mode: 'automatic' | 'step-confirmation'
  limits: {
    maxToolCalls: number
    maxSearches: number
    maxPageReads: number
    maxBodyCharacters: number
  }
}
