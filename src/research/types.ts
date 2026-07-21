import type { ParticipantRole } from '../domain/debate-types'

export const RESEARCH_VISIBILITIES = [
  'public',
  'affirmative-private',
  'negative-private',
  'moderator-private'
] as const

export type ResearchVisibility = (typeof RESEARCH_VISIBILITIES)[number]
export type PrivateResearchVisibility = Exclude<ResearchVisibility, 'public'>
export type ResearchOwnerRole = Extract<ParticipantRole, 'affirmative' | 'negative' | 'moderator'>

export interface OwnedResearchRecord {
  id: string
  debateSessionId: string
  ownerParticipantId: string
  visibility: ResearchVisibility
  createdAt: string
}

export interface ResearchSession extends OwnedResearchRecord {
  ownerRole: ResearchOwnerRole
  status: 'planning' | 'researching' | 'drafting' | 'completed'
  updatedAt: string
}

export interface ResearchGoal extends OwnedResearchRecord {
  researchSessionId: string
  description: string
  status: 'planned' | 'active' | 'completed'
  updatedAt: string
}

export interface SearchSession extends OwnedResearchRecord {
  researchSessionId: string
  toolName: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  completedAt?: string
}

export interface SearchQuery extends OwnedResearchRecord {
  researchSessionId: string
  searchSessionId?: string
  query: string
}

export interface ResearchSource extends OwnedResearchRecord {
  researchSessionId?: string
  searchSessionId?: string
  title: string
  url?: string
  domain?: string
  summary?: string
  publishedAt?: string
  fetchedAt?: string
  sourceType: 'manual-url' | 'manual-text' | 'mock-search' | 'tavily-search'
  evaluation?: string
  score?: number
  verificationLevel?: 'summary-only' | 'full-text-read'
}

export type SearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'
export type SearchTimeRange = 'day' | 'week' | 'month' | 'year'

export interface SearchProviderConnection {
  id: string
  displayName: string
  providerType: 'tavily'
  baseUrl: string
  credentialRef: string
  enabled: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface FetchedWebPage extends OwnedResearchRecord {
  researchSessionId: string
  sourceId: string
  url: string
  finalUrl: string
  title: string
  author?: string
  publishedAt?: string
  contentType: string
  bodyText: string
  summary: string
  excerpt: string
  bodyCharacters: number
  status: 'completed' | 'inaccessible'
  errorCode?: string
  fetchedAt: string
}

export const RESEARCH_SOURCE_TYPES = [
  '官方机构', '学术研究', '新闻媒体', '企业资料', '评论或博客', '论坛或社交内容', '未知'
] as const
export type ResearchSourceCategory = (typeof RESEARCH_SOURCE_TYPES)[number]

export interface SourceEvaluation extends OwnedResearchRecord {
  researchSessionId: string
  sourceId: string
  purpose: string
  relevance: string
  stance: string
  sourceType: ResearchSourceCategory
  publishedAt?: string
  credibility: string
  limitations: string
  recommendPublication: boolean
  basedOn: 'summary-only' | 'full-text'
}

export type ResearchMode = 'automatic' | 'step-confirmation'
export type ResearchToolName =
  | 'searchWeb'
  | 'readWebPage'
  | 'saveResearchNote'
  | 'saveProvisionalClaim'
  | 'publishEvidence'
  | 'finishResearch'

export interface ResearchToolLimits {
  /** Legacy aggregate action ceiling kept for settings compatibility and diagnostics. */
  maxToolCalls: number
  maxSearches: number
  maxPageReads: number
  maxBodyCharacters: number
  /** Maximum model decisions during discovery before switching to local finalization tools. */
  maxDecisionRounds?: number
  /** Repeated rounds without a new source, page, note, claim or evidence trigger finalization. */
  maxNoProgressRounds?: number
  /** Finalization retains local tools but still has a generous loop guard. */
  maxFinalizationRounds?: number
  /** A quality target, not a requirement to publish unreliable material. */
  targetEvidenceCount?: number
}

export type ResearchBudgetPhase = 'discovery' | 'finalizing'
export type ResearchCompletionReason =
  | 'model-finished'
  | 'model-summary'
  | 'decision-limit'
  | 'no-progress'
  | 'discovery-limit'
  | 'finalization-limit'

export interface ResearchToolCall extends OwnedResearchRecord {
  researchSessionId: string
  role: ResearchOwnerRole
  toolName: ResearchToolName
  operationKey: string
  argumentsJson: string
  status: 'pending-approval' | 'running' | 'completed' | 'failed' | 'denied' | 'interrupted'
  resultSummary?: string
  errorCode?: string
  errorDescriptionZh?: string
  completedAt?: string
}

export interface ResearchLoopState {
  debateSessionId: string
  researchSessionId: string
  ownerParticipantId: string
  role: ResearchOwnerRole
  mode: ResearchMode
  status: 'idle' | 'running' | 'waiting-approval' | 'finalizing' | 'summarizing' | 'completed' | 'failed' | 'interrupted'
  goal?: string
  phase?: ResearchBudgetPhase
  decisionRoundCount?: number
  noProgressRoundCount?: number
  finalizationRoundCount?: number
  completionReason?: ResearchCompletionReason
  toolCallCount: number
  searchCount: number
  pageReadCount: number
  bodyCharacters: number
  limits: ResearchToolLimits
  updatedAt: string
}

export type ResearchAssetKind = 'text' | 'url' | 'image' | 'pdf'

export interface ResearchAsset extends OwnedResearchRecord {
  researchSessionId?: string
  kind: ResearchAssetKind
  title: string
  textContent?: string
  url?: string
  summary?: string
  localPath?: string
  mimeType?: string
  sourceName?: string
  sourceDate?: string
  createdBy: string
  isOriginal: boolean
}

export interface ResearchNote extends OwnedResearchRecord {
  researchSessionId: string
  sourceId?: string
  assetId?: string
  content: string
}

export interface ProvisionalClaim extends OwnedResearchRecord {
  researchSessionId: string
  claim: string
  supportingSourceIds: string[]
  unresolved: boolean
}

export interface PublicResourcePool extends OwnedResearchRecord {
  topicDefinition: string
  temporalScope?: string
  geographicScope?: string
  keyConcepts: string[]
  controversyDirections: string[]
  userSubmittedSourceIds: string[]
  factBoundaries: string[]
  moderatorNotes?: string
  updatedAt: string
}

export const EVIDENCE_STATUSES = [
  'unverified',
  'supported',
  'disputed',
  'outdated',
  'inaccessible',
  'misleading',
  'rejected'
] as const

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

export interface PublishedEvidence {
  id: string
  debateSessionId: string
  publicCode: string
  submittedByParticipantId: string
  submitterRole: ResearchOwnerRole
  sourceId?: string
  assetId?: string
  title: string
  summary?: string
  sourceUrl?: string
  currentStatus: EvidenceStatus
  createdAt: string
}

export interface EvidenceStatusHistory {
  id: string
  debateSessionId: string
  evidenceId: string
  fromStatus?: EvidenceStatus
  toStatus: EvidenceStatus
  changedBy: string
  note: string
  createdAt: string
}

export interface EvidenceReferenceIssue {
  id: string
  debateSessionId: string
  turnId: string
  participantId: string
  referenceCode: string
  reason: 'EVIDENCE_NOT_FOUND'
  createdAt: string
}

export interface RoleResearchWorkspace {
  session?: ResearchSession
  goals: ResearchGoal[]
  queries: SearchQuery[]
  sources: ResearchSource[]
  assets: ResearchAsset[]
  notes: ResearchNote[]
  claims: ProvisionalClaim[]
}

export interface ResearchWorkspace {
  debateSessionId: string
  publicPool?: PublicResourcePool
  publicAssets: ResearchAsset[]
  affirmative: RoleResearchWorkspace
  negative: RoleResearchWorkspace
  moderator: RoleResearchWorkspace
  evidence: PublishedEvidence[]
  evidenceHistory: EvidenceStatusHistory[]
  invalidEvidenceReferences: EvidenceReferenceIssue[]
}

export interface SearchRequest {
  debateSessionId: string
  researchSessionId: string
  ownerParticipantId: string
  visibility: ResearchVisibility
  query: string
  signal: AbortSignal
  maxResults?: number
  searchDepth?: SearchDepth
  timeRange?: SearchTimeRange
  includeDomains?: string[]
  excludeDomains?: string[]
}

export interface SearchResult {
  title: string
  url: string
  summary: string
  domain: string
  publishedAt?: string
  fetchedAt: string
  score?: number
}

export interface SearchTool {
  readonly name: string
  search(request: SearchRequest): Promise<SearchResult[]>
}

export interface PublicDebateTurn {
  id: string
  stage: string
  participantId: string
  participantRole: ParticipantRole
  participantName: string
  content: string
  createdAt: string
}

export interface ResearchPromptContext {
  debateSessionId: string
  participantId: string
  role: ParticipantRole
  topic: string
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  publicPool?: PublicResourcePool
  visibleSources: ResearchSource[]
  visibleAssets: ResearchAsset[]
  visibleNotes: ResearchNote[]
  visibleClaims: ProvisionalClaim[]
  publishedEvidence: PublishedEvidence[]
  publicDebateTurns: PublicDebateTurn[]
}
