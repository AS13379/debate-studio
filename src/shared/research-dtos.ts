import type {
  EvidenceReferenceIssue,
  EvidenceStatus,
  EvidenceStatusHistory,
  ProvisionalClaim,
  PublicResourcePool,
  PublishedEvidence,
  ResearchAsset,
  ResearchGoal,
  ResearchNote,
  ResearchSource,
  ResearchVisibility,
  SearchQuery
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
