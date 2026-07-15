import type { DebateHistoryApplication } from '../application/debate-history-application'
import type { PersistenceContext, PersistenceError } from '../persistence'
import type {
  FetchedWebPage,
  ResearchAsset,
  ResearchGoal,
  ResearchNote,
  ResearchOwnerRole,
  ResearchSession,
  ResearchSource,
  SourceEvaluation,
  ProvisionalClaim
} from '../research'
import { redactForExport } from '../security'
import type { ConfigurationErrorDto, ConfigurationResultDto } from '../shared/debate-dtos'
import type { DebateExportSnapshot, ExportResearchItem } from './types'

const FORMAL_DEBATE_STAGES = new Set([
  'moderating', 'affirmative_opening', 'negative_opening', 'cross_examination',
  'rebuttal', 'free_debate', 'negative_closing', 'affirmative_closing', 'closing', 'adjudication'
])

const ROLE_ORDER: ResearchOwnerRole[] = ['moderator', 'affirmative', 'negative']

export interface ExportSnapshotBuilderDependencies {
  persistence: PersistenceContext
  history: DebateHistoryApplication
  now?: () => Date
}

export class ExportSnapshotBuilder {
  private readonly now: () => Date

  constructor(private readonly dependencies: ExportSnapshotBuilderDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  build(debateId: string, includePrivateResearch: boolean): ConfigurationResultDto<DebateExportSnapshot> {
    const history = this.dependencies.history.getDebateDetail(debateId)
    if (!history.ok) return history
    if (history.value.status !== 'completed') {
      return this.failure('EXPORT_DEBATE_NOT_COMPLETED', '辩论尚未完成', '只有已经完成的辩论才能导出，请先完成辩论。', false)
    }

    const { repositories } = this.dependencies.persistence
    const participants = repositories.participants.listBySession(history.value.sessionId)
    if (!participants.ok) return this.persistenceFailure(participants.error)
    const turns = repositories.turns.listBySession(history.value.sessionId)
    if (!turns.ok) return this.persistenceFailure(turns.error)
    const sessions = repositories.research.listSessions(history.value.sessionId)
    if (!sessions.ok) return this.persistenceFailure(sessions.error)
    const goals = repositories.research.listGoals(history.value.sessionId)
    if (!goals.ok) return this.persistenceFailure(goals.error)
    const sources = repositories.research.listSources(history.value.sessionId)
    if (!sources.ok) return this.persistenceFailure(sources.error)
    const assets = repositories.research.listAssets(history.value.sessionId)
    if (!assets.ok) return this.persistenceFailure(assets.error)
    const notes = repositories.research.listNotes(history.value.sessionId)
    if (!notes.ok) return this.persistenceFailure(notes.error)
    const claims = repositories.research.listClaims(history.value.sessionId)
    if (!claims.ok) return this.persistenceFailure(claims.error)
    const pages = repositories.research.listFetchedPageSummaries(history.value.sessionId)
    if (!pages.ok) return this.persistenceFailure(pages.error)
    const evaluations = repositories.research.listSourceEvaluations(history.value.sessionId)
    if (!evaluations.ok) return this.persistenceFailure(evaluations.error)
    const publicPool = repositories.research.getPublicPool(history.value.sessionId)
    if (!publicPool.ok) return this.persistenceFailure(publicPool.error)
    const evidence = repositories.research.listEvidence(history.value.sessionId)
    if (!evidence.ok) return this.persistenceFailure(evidence.error)
    const evidenceHistory = repositories.research.listEvidenceHistory(history.value.sessionId)
    if (!evidenceHistory.ok) return this.persistenceFailure(evidenceHistory.error)

    const participantRoles = new Map(participants.value.map((item) => [item.id, item.role]))
    const participantNames = new Map(participants.value.map((item) => [item.id, item.displayName]))
    const sessionRoles = new Map(sessions.value.map((item) => [item.id, item.ownerRole]))
    const ownerRoles = new Map<string, ResearchOwnerRole>([
      ...participants.value.flatMap((item): Array<[string, ResearchOwnerRole]> =>
        item.role === 'judge' ? [] : [[item.id, item.role]]),
      ...sessions.value.map((item): [string, ResearchOwnerRole] => [item.ownerParticipantId, item.ownerRole])
    ])

    const researchItems = [
      ...goals.value.map((item) => this.goalItem(item, sessionRoles)),
      ...sources.value.map((item) => this.sourceItem(item, sessionRoles, ownerRoles)),
      ...assets.value.map((item) => this.assetItem(item, sessionRoles, ownerRoles)),
      ...notes.value.map((item) => this.noteItem(item, sessionRoles)),
      ...claims.value.map((item) => this.claimItem(item, sessionRoles)),
      ...evaluations.value.map((item) => this.evaluationItem(item, sessionRoles)),
      ...pages.value.map((item) => this.pageItem(item, sessionRoles))
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))

    const snapshot: DebateExportSnapshot = {
      metadata: {
        debateId,
        sessionId: history.value.sessionId,
        title: history.value.displayTitle,
        topic: history.value.topic,
        createdAt: history.value.createdAt,
        updatedAt: history.value.updatedAt,
        completionStatus: history.value.status,
        includePrivateResearch,
        generatedAt: this.now().toISOString()
      },
      background: history.value.background,
      affirmativePosition: history.value.affirmativePosition,
      negativePosition: history.value.negativePosition,
      models: history.value.models.map(({ modelProfileId: _modelProfileId, ...model }) => model),
      publicPool: publicPool.value ? {
        topicDefinition: publicPool.value.topicDefinition,
        temporalScope: publicPool.value.temporalScope,
        geographicScope: publicPool.value.geographicScope,
        keyConcepts: [...publicPool.value.keyConcepts],
        controversyDirections: [...publicPool.value.controversyDirections],
        factBoundaries: [...publicPool.value.factBoundaries],
        moderatorNotes: publicPool.value.moderatorNotes,
        updatedAt: publicPool.value.updatedAt
      } : undefined,
      roleSummaries: ROLE_ORDER.map((role) => this.roleSummary(role, sessions.value, goals.value, sources.value, assets.value, notes.value, claims.value, sessionRoles, ownerRoles)),
      publicResearch: researchItems.filter((item) => item.visibility === 'public'),
      privateResearch: includePrivateResearch ? researchItems.filter((item) => item.visibility !== 'public') : undefined,
      evidence: evidence.value.map((item) => ({
        publicCode: item.publicCode,
        submitterRole: item.submitterRole,
        title: item.title,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        currentStatus: item.currentStatus,
        createdAt: item.createdAt,
        history: evidenceHistory.value.filter((record) => record.evidenceId === item.id).map((record) => ({
          fromStatus: record.fromStatus,
          toStatus: record.toStatus,
          changedBy: record.changedBy,
          note: record.note,
          createdAt: record.createdAt
        }))
      })),
      turns: turns.value
        .filter((turn) => FORMAL_DEBATE_STAGES.has(turn.stage) && Boolean(turn.content?.trim()))
        .map((turn) => ({
          id: turn.id,
          role: participantRoles.get(turn.participantId) ?? 'unknown',
          participantName: participantNames.get(turn.participantId) ?? '未知角色',
          stage: turn.stage,
          status: turn.status,
          content: turn.content ?? '',
          createdAt: turn.createdAt,
          completedAt: turn.completedAt
        }))
    }

    return { ok: true, value: redactForExport(snapshot) }
  }

  private roleSummary(
    role: ResearchOwnerRole,
    sessions: ResearchSession[], goals: ResearchGoal[], sources: ResearchSource[], assets: ResearchAsset[],
    notes: ResearchNote[], claims: ProvisionalClaim[], sessionRoles: Map<string, ResearchOwnerRole>, ownerRoles: Map<string, ResearchOwnerRole>
  ) {
    const roleSessions = sessions.filter((item) => item.ownerRole === role)
    const roleOf = (researchSessionId: string | undefined, ownerParticipantId: string) =>
      (researchSessionId ? sessionRoles.get(researchSessionId) : undefined) ?? ownerRoles.get(ownerParticipantId)
    return {
      role,
      status: roleSessions.at(-1)?.status ?? 'not-started',
      goalCount: goals.filter((item) => roleOf(item.researchSessionId, item.ownerParticipantId) === role).length,
      sourceCount: sources.filter((item) => roleOf(item.researchSessionId, item.ownerParticipantId) === role).length,
      assetCount: assets.filter((item) => roleOf(item.researchSessionId, item.ownerParticipantId) === role).length,
      noteCount: notes.filter((item) => roleOf(item.researchSessionId, item.ownerParticipantId) === role).length,
      claimCount: claims.filter((item) => roleOf(item.researchSessionId, item.ownerParticipantId) === role).length
    }
  }

  private resolveRole(researchSessionId: string | undefined, ownerParticipantId: string, sessionRoles: Map<string, ResearchOwnerRole>, ownerRoles?: Map<string, ResearchOwnerRole>): ResearchOwnerRole {
    return (researchSessionId ? sessionRoles.get(researchSessionId) : undefined) ?? ownerRoles?.get(ownerParticipantId) ?? 'moderator'
  }

  private goalItem(item: ResearchGoal, roles: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles), visibility: item.visibility, kind: 'goal', title: '研究目标', content: item.description, createdAt: item.createdAt }
  }
  private sourceItem(item: ResearchSource, roles: Map<string, ResearchOwnerRole>, owners: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles, owners), visibility: item.visibility, kind: 'source', title: item.title, content: [item.summary, item.evaluation].filter(Boolean).join('\n\n') || undefined, sourceUrl: item.url, sourceType: item.sourceType, publishedAt: item.publishedAt, createdAt: item.createdAt }
  }
  private assetItem(item: ResearchAsset, roles: Map<string, ResearchOwnerRole>, owners: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles, owners), visibility: item.visibility, kind: 'asset', title: item.title, content: item.textContent ?? item.summary, sourceUrl: item.url, sourceType: item.kind, publishedAt: item.sourceDate, createdAt: item.createdAt }
  }
  private noteItem(item: ResearchNote, roles: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles), visibility: item.visibility, kind: 'note', title: '研究笔记', content: item.content, createdAt: item.createdAt }
  }
  private claimItem(item: ProvisionalClaim, roles: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles), visibility: item.visibility, kind: 'claim', title: item.unresolved ? '尚未解决的暂定主张' : '暂定主张', content: item.claim, createdAt: item.createdAt }
  }
  private evaluationItem(item: SourceEvaluation, roles: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles), visibility: item.visibility, kind: 'source-evaluation', title: `来源评价：${item.sourceType}`, content: `用途：${item.purpose}\n相关性：${item.relevance}\n立场：${item.stance}\n可信度：${item.credibility}\n局限：${item.limitations}\n依据：${item.basedOn}`, sourceType: item.sourceType, publishedAt: item.publishedAt, createdAt: item.createdAt }
  }
  private pageItem(item: FetchedWebPage, roles: Map<string, ResearchOwnerRole>): ExportResearchItem {
    return { id: item.id, ownerRole: this.resolveRole(item.researchSessionId, item.ownerParticipantId, roles), visibility: item.visibility, kind: 'web-page', title: item.title, content: [item.summary, item.excerpt].filter(Boolean).join('\n\n'), sourceUrl: item.finalUrl, publishedAt: item.publishedAt, createdAt: item.createdAt }
  }

  private persistenceFailure(error: PersistenceError): ConfigurationResultDto<never> {
    return this.failure('EXPORT_DATA_LOAD_FAILED', '导出数据读取失败', '无法从本地数据库汇集完整辩论，请稍后重试。', error.code !== 'DATABASE_CLOSED')
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: ConfigurationErrorDto } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
