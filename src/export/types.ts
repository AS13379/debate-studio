import type { ResearchOwnerRole, ResearchVisibility } from '../research'
import type { ExportType } from '../persistence'

export interface ExportSnapshotModel {
  role: string
  participantDisplayName: string
  modelId: string
  modelDisplayName: string
  providerDisplayName: string
}

export interface ExportResearchRoleSummary {
  role: ResearchOwnerRole
  status: string
  goalCount: number
  sourceCount: number
  assetCount: number
  noteCount: number
  claimCount: number
}

export interface ExportResearchItem {
  id: string
  ownerRole: ResearchOwnerRole
  visibility: ResearchVisibility
  kind: 'goal' | 'source' | 'asset' | 'note' | 'claim' | 'source-evaluation' | 'web-page'
  title: string
  content?: string
  sourceUrl?: string
  sourceType?: string
  publishedAt?: string
  createdAt: string
}

export interface ExportEvidenceHistoryItem {
  fromStatus?: string
  toStatus: string
  changedBy: string
  note: string
  createdAt: string
}

export interface ExportEvidenceItem {
  publicCode: string
  submitterRole: ResearchOwnerRole
  title: string
  summary?: string
  sourceUrl?: string
  currentStatus: string
  createdAt: string
  history: ExportEvidenceHistoryItem[]
}

export interface ExportTurnItem {
  id: string
  role: string
  participantName: string
  stage: string
  status: string
  content: string
  createdAt: string
  completedAt?: string
}

export interface DebateExportSnapshot {
  metadata: {
    debateId: string
    sessionId: string
    title: string
    topic: string
    createdAt: string
    updatedAt: string
    completionStatus: string
    includePrivateResearch: boolean
    generatedAt: string
  }
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  models: ExportSnapshotModel[]
  publicPool?: {
    topicDefinition: string
    temporalScope?: string
    geographicScope?: string
    keyConcepts: string[]
    controversyDirections: string[]
    factBoundaries: string[]
    moderatorNotes?: string
    updatedAt: string
  }
  roleSummaries: ExportResearchRoleSummary[]
  publicResearch: ExportResearchItem[]
  privateResearch?: ExportResearchItem[]
  evidence: ExportEvidenceItem[]
  turns: ExportTurnItem[]
}

export interface DebateExporter {
  readonly type: ExportType
  readonly extension: string
  render(snapshot: DebateExportSnapshot): string
}

export interface ExportFileStore {
  write(filePath: string, content: string): number
  delete(filePath: string): boolean
}
