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
  sourceType: 'manual-url' | 'manual-text' | 'mock-search'
  evaluation?: string
}

export type ResearchAssetKind = 'text' | 'url' | 'image'

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
  visibility: PrivateResearchVisibility
  query: string
  signal: AbortSignal
}

export interface SearchResult {
  title: string
  url: string
  summary: string
  domain: string
  publishedAt?: string
  fetchedAt: string
}

export interface SearchTool {
  readonly name: string
  search(request: SearchRequest): Promise<SearchResult[]>
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
}
