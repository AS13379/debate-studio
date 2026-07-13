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
  ResearchOwnerRole,
  ResearchSession,
  ResearchSource,
  SearchQuery,
  SearchSession
} from '../research'
import { Database } from './database'
import type { PersistenceResult } from './errors'
import type { ResearchRepository } from './repositories'

type Row = Record<string, string | number | null>

export class SQLiteResearchRepository implements ResearchRepository {
  constructor(private readonly database: Database) {}

  saveSession(session: ResearchSession): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_sessions
       (id, debate_session_id, owner_participant_id, owner_role, visibility, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      session.id, session.debateSessionId, session.ownerParticipantId, session.ownerRole,
      session.visibility, session.status, session.createdAt, session.updatedAt
    ))
  }

  findSessionByOwner(debateSessionId: string, ownerRole: ResearchOwnerRole): PersistenceResult<ResearchSession | undefined> {
    const result = this.database.get<Row>(
      'SELECT * FROM research_sessions WHERE debate_session_id = ? AND owner_role = ?',
      debateSessionId, ownerRole
    )
    return result.ok ? { ok: true, value: result.value ? this.mapSession(result.value) : undefined } : result
  }

  listSessions(debateSessionId: string): PersistenceResult<ResearchSession[]> {
    return this.mapAll('SELECT * FROM research_sessions WHERE debate_session_id = ? ORDER BY created_at, id',
      (row) => this.mapSession(row), debateSessionId)
  }

  saveGoal(goal: ResearchGoal): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_goals
       (id, debate_session_id, research_session_id, owner_participant_id, visibility,
        description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET description = excluded.description,
         status = excluded.status, updated_at = excluded.updated_at`,
      goal.id, goal.debateSessionId, goal.researchSessionId, goal.ownerParticipantId,
      goal.visibility, goal.description, goal.status, goal.createdAt, goal.updatedAt
    ))
  }

  listGoals(debateSessionId: string): PersistenceResult<ResearchGoal[]> {
    return this.mapAll('SELECT * FROM research_goals WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      description: this.text(row, 'description'), status: this.text(row, 'status') as ResearchGoal['status'],
      updatedAt: this.text(row, 'updated_at')
    }), debateSessionId)
  }

  saveSearchSession(session: SearchSession): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO search_sessions
       (id, debate_session_id, research_session_id, owner_participant_id, visibility,
        tool_name, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at`,
      session.id, session.debateSessionId, session.researchSessionId, session.ownerParticipantId,
      session.visibility, session.toolName, session.status, session.createdAt, session.completedAt ?? null
    ))
  }

  listSearchSessions(debateSessionId: string): PersistenceResult<SearchSession[]> {
    return this.mapAll('SELECT * FROM search_sessions WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      toolName: this.text(row, 'tool_name'), status: this.text(row, 'status') as SearchSession['status'],
      completedAt: this.optional(row, 'completed_at')
    }), debateSessionId)
  }

  saveQuery(query: SearchQuery): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO search_queries
       (id, debate_session_id, research_session_id, search_session_id, owner_participant_id,
        visibility, query, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET query = excluded.query`,
      query.id, query.debateSessionId, query.researchSessionId, query.searchSessionId ?? null,
      query.ownerParticipantId, query.visibility, query.query, query.createdAt
    ))
  }

  listQueries(debateSessionId: string): PersistenceResult<SearchQuery[]> {
    return this.mapAll('SELECT * FROM search_queries WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      searchSessionId: this.optional(row, 'search_session_id'), query: this.text(row, 'query')
    }), debateSessionId)
  }

  saveSource(source: ResearchSource): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_sources
       (id, debate_session_id, research_session_id, search_session_id, owner_participant_id,
        visibility, title, url, domain, summary, published_at, fetched_at, source_type, evaluation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url,
        domain = excluded.domain, summary = excluded.summary, published_at = excluded.published_at,
        fetched_at = excluded.fetched_at, evaluation = excluded.evaluation`,
      source.id, source.debateSessionId, source.researchSessionId ?? null, source.searchSessionId ?? null,
      source.ownerParticipantId, source.visibility, source.title, source.url ?? null, source.domain ?? null,
      source.summary ?? null, source.publishedAt ?? null, source.fetchedAt ?? null,
      source.sourceType, source.evaluation ?? null, source.createdAt
    ))
  }

  findSourceById(id: string): PersistenceResult<ResearchSource | undefined> {
    const result = this.database.get<Row>('SELECT * FROM research_sources WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value ? this.mapSource(result.value) : undefined } : result
  }

  listSources(debateSessionId: string): PersistenceResult<ResearchSource[]> {
    return this.mapAll('SELECT * FROM research_sources WHERE debate_session_id = ? ORDER BY created_at, id',
      (row) => this.mapSource(row), debateSessionId)
  }

  saveAsset(asset: ResearchAsset): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_assets
       (id, debate_session_id, research_session_id, owner_participant_id, visibility, kind,
        title, text_content, url, summary, local_path, mime_type, source_name, source_date,
        created_by, is_original, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, text_content = excluded.text_content,
        url = excluded.url, summary = excluded.summary, local_path = excluded.local_path,
        mime_type = excluded.mime_type, source_name = excluded.source_name, source_date = excluded.source_date`,
      asset.id, asset.debateSessionId, asset.researchSessionId ?? null, asset.ownerParticipantId,
      asset.visibility, asset.kind, asset.title, asset.textContent ?? null, asset.url ?? null,
      asset.summary ?? null, asset.localPath ?? null, asset.mimeType ?? null, asset.sourceName ?? null,
      asset.sourceDate ?? null, asset.createdBy, asset.isOriginal ? 1 : 0, asset.createdAt
    ))
  }

  findAssetById(id: string): PersistenceResult<ResearchAsset | undefined> {
    const result = this.database.get<Row>('SELECT * FROM research_assets WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value ? this.mapAsset(result.value) : undefined } : result
  }

  listAssets(debateSessionId: string): PersistenceResult<ResearchAsset[]> {
    return this.mapAll('SELECT * FROM research_assets WHERE debate_session_id = ? ORDER BY created_at, id',
      (row) => this.mapAsset(row), debateSessionId)
  }

  saveNote(note: ResearchNote): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_notes
       (id, debate_session_id, research_session_id, owner_participant_id, visibility,
        source_id, asset_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id,
        asset_id = excluded.asset_id, content = excluded.content`,
      note.id, note.debateSessionId, note.researchSessionId, note.ownerParticipantId,
      note.visibility, note.sourceId ?? null, note.assetId ?? null, note.content, note.createdAt
    ))
  }

  listNotes(debateSessionId: string): PersistenceResult<ResearchNote[]> {
    return this.mapAll('SELECT * FROM research_notes WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      sourceId: this.optional(row, 'source_id'), assetId: this.optional(row, 'asset_id'),
      content: this.text(row, 'content')
    }), debateSessionId)
  }

  saveClaim(claim: ProvisionalClaim): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO provisional_claims
       (id, debate_session_id, research_session_id, owner_participant_id, visibility,
        claim, supporting_source_ids_json, unresolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET claim = excluded.claim,
        supporting_source_ids_json = excluded.supporting_source_ids_json, unresolved = excluded.unresolved`,
      claim.id, claim.debateSessionId, claim.researchSessionId, claim.ownerParticipantId,
      claim.visibility, claim.claim, JSON.stringify(claim.supportingSourceIds), claim.unresolved ? 1 : 0, claim.createdAt
    ))
  }

  listClaims(debateSessionId: string): PersistenceResult<ProvisionalClaim[]> {
    return this.mapAll('SELECT * FROM provisional_claims WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      claim: this.text(row, 'claim'), supportingSourceIds: this.jsonArray(row, 'supporting_source_ids_json'),
      unresolved: Number(row.unresolved) === 1
    }), debateSessionId)
  }

  savePublicPool(pool: PublicResourcePool): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO public_resource_pools
       (id, debate_session_id, owner_participant_id, visibility, topic_definition,
        temporal_scope, geographic_scope, key_concepts_json, controversy_directions_json,
        user_submitted_source_ids_json, fact_boundaries_json, moderator_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(debate_session_id) DO UPDATE SET topic_definition = excluded.topic_definition,
        temporal_scope = excluded.temporal_scope, geographic_scope = excluded.geographic_scope,
        key_concepts_json = excluded.key_concepts_json,
        controversy_directions_json = excluded.controversy_directions_json,
        user_submitted_source_ids_json = excluded.user_submitted_source_ids_json,
        fact_boundaries_json = excluded.fact_boundaries_json,
        moderator_notes = excluded.moderator_notes, updated_at = excluded.updated_at`,
      pool.id, pool.debateSessionId, pool.ownerParticipantId, pool.visibility, pool.topicDefinition,
      pool.temporalScope ?? null, pool.geographicScope ?? null, JSON.stringify(pool.keyConcepts),
      JSON.stringify(pool.controversyDirections), JSON.stringify(pool.userSubmittedSourceIds),
      JSON.stringify(pool.factBoundaries), pool.moderatorNotes ?? null, pool.createdAt, pool.updatedAt
    ))
  }

  getPublicPool(debateSessionId: string): PersistenceResult<PublicResourcePool | undefined> {
    const result = this.database.get<Row>('SELECT * FROM public_resource_pools WHERE debate_session_id = ?', debateSessionId)
    return result.ok ? { ok: true, value: result.value ? this.mapPublicPool(result.value) : undefined } : result
  }

  createEvidence(evidence: PublishedEvidence, initialHistory: EvidenceStatusHistory): PersistenceResult<void> {
    const result = this.database.transaction(() => {
      this.unwrap(this.database.run(
        `INSERT INTO published_evidence
         (id, debate_session_id, public_code, submitted_by_participant_id, submitter_role,
          source_id, asset_id, title, summary, source_url, current_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        evidence.id, evidence.debateSessionId, evidence.publicCode, evidence.submittedByParticipantId,
        evidence.submitterRole, evidence.sourceId ?? null, evidence.assetId ?? null, evidence.title,
        evidence.summary ?? null, evidence.sourceUrl ?? null, evidence.currentStatus, evidence.createdAt
      ))
      this.insertHistory({ ...initialHistory, evidenceId: evidence.id, debateSessionId: evidence.debateSessionId })
    })
    return result.ok ? { ok: true, value: undefined } : result
  }

  findEvidenceById(id: string): PersistenceResult<PublishedEvidence | undefined> {
    const result = this.database.get<Row>('SELECT * FROM published_evidence WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value ? this.mapEvidence(result.value) : undefined } : result
  }

  listEvidence(debateSessionId: string): PersistenceResult<PublishedEvidence[]> {
    return this.mapAll('SELECT * FROM published_evidence WHERE debate_session_id = ? ORDER BY created_at, id',
      (row) => this.mapEvidence(row), debateSessionId)
  }

  countEvidenceByRole(debateSessionId: string, role: ResearchOwnerRole): PersistenceResult<number> {
    const result = this.database.get<Row>(
      'SELECT COUNT(*) AS count FROM published_evidence WHERE debate_session_id = ? AND submitter_role = ?',
      debateSessionId, role
    )
    return result.ok ? { ok: true, value: Number(result.value?.count ?? 0) } : result
  }

  changeEvidenceStatus(evidenceId: string, status: EvidenceStatus, history: EvidenceStatusHistory): PersistenceResult<boolean> {
    const result = this.database.transaction(() => {
      const update = this.unwrap(this.database.run(
        'UPDATE published_evidence SET current_status = ? WHERE id = ? AND debate_session_id = ?',
        status, evidenceId, history.debateSessionId
      ))
      if (Number(update.changes) === 0) return false
      this.insertHistory({ ...history, evidenceId, toStatus: status })
      return true
    })
    return result
  }

  listEvidenceHistory(debateSessionId: string): PersistenceResult<EvidenceStatusHistory[]> {
    return this.mapAll('SELECT * FROM evidence_status_history WHERE debate_session_id = ? ORDER BY created_at, rowid', (row) => ({
      id: this.text(row, 'id'), debateSessionId: this.text(row, 'debate_session_id'),
      evidenceId: this.text(row, 'evidence_id'),
      fromStatus: this.optional(row, 'from_status') as EvidenceStatus | undefined,
      toStatus: this.text(row, 'to_status') as EvidenceStatus, changedBy: this.text(row, 'changed_by'),
      note: this.text(row, 'note'), createdAt: this.text(row, 'created_at')
    }), debateSessionId)
  }

  createReferenceIssue(issue: EvidenceReferenceIssue): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO evidence_reference_issues
       (id, debate_session_id, turn_id, participant_id, reference_code, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(turn_id, reference_code) DO NOTHING`,
      issue.id, issue.debateSessionId, issue.turnId, issue.participantId,
      issue.referenceCode, issue.reason, issue.createdAt
    ))
  }

  listReferenceIssues(debateSessionId: string): PersistenceResult<EvidenceReferenceIssue[]> {
    return this.mapAll('SELECT * FROM evidence_reference_issues WHERE debate_session_id = ? ORDER BY created_at, rowid', (row) => ({
      id: this.text(row, 'id'), debateSessionId: this.text(row, 'debate_session_id'),
      turnId: this.text(row, 'turn_id'), participantId: this.text(row, 'participant_id'),
      referenceCode: this.text(row, 'reference_code'), reason: 'EVIDENCE_NOT_FOUND',
      createdAt: this.text(row, 'created_at')
    }), debateSessionId)
  }

  private mapSession(row: Row): ResearchSession {
    return {
      ...this.owned(row), ownerRole: this.text(row, 'owner_role') as ResearchOwnerRole,
      status: this.text(row, 'status') as ResearchSession['status'], updatedAt: this.text(row, 'updated_at')
    }
  }

  private mapSource(row: Row): ResearchSource {
    return {
      ...this.owned(row), researchSessionId: this.optional(row, 'research_session_id'),
      searchSessionId: this.optional(row, 'search_session_id'), title: this.text(row, 'title'),
      url: this.optional(row, 'url'), domain: this.optional(row, 'domain'), summary: this.optional(row, 'summary'),
      publishedAt: this.optional(row, 'published_at'), fetchedAt: this.optional(row, 'fetched_at'),
      sourceType: this.text(row, 'source_type') as ResearchSource['sourceType'],
      evaluation: this.optional(row, 'evaluation')
    }
  }

  private mapAsset(row: Row): ResearchAsset {
    return {
      ...this.owned(row), researchSessionId: this.optional(row, 'research_session_id'),
      kind: this.text(row, 'kind') as ResearchAsset['kind'], title: this.text(row, 'title'),
      textContent: this.optional(row, 'text_content'), url: this.optional(row, 'url'),
      summary: this.optional(row, 'summary'), localPath: this.optional(row, 'local_path'),
      mimeType: this.optional(row, 'mime_type'), sourceName: this.optional(row, 'source_name'),
      sourceDate: this.optional(row, 'source_date'), createdBy: this.text(row, 'created_by'),
      isOriginal: Number(row.is_original) === 1
    }
  }

  private mapPublicPool(row: Row): PublicResourcePool {
    return {
      ...this.owned(row), topicDefinition: this.text(row, 'topic_definition'),
      temporalScope: this.optional(row, 'temporal_scope'), geographicScope: this.optional(row, 'geographic_scope'),
      keyConcepts: this.jsonArray(row, 'key_concepts_json'),
      controversyDirections: this.jsonArray(row, 'controversy_directions_json'),
      userSubmittedSourceIds: this.jsonArray(row, 'user_submitted_source_ids_json'),
      factBoundaries: this.jsonArray(row, 'fact_boundaries_json'),
      moderatorNotes: this.optional(row, 'moderator_notes'), updatedAt: this.text(row, 'updated_at')
    }
  }

  private mapEvidence(row: Row): PublishedEvidence {
    return {
      id: this.text(row, 'id'), debateSessionId: this.text(row, 'debate_session_id'),
      publicCode: this.text(row, 'public_code'),
      submittedByParticipantId: this.text(row, 'submitted_by_participant_id'),
      submitterRole: this.text(row, 'submitter_role') as ResearchOwnerRole,
      sourceId: this.optional(row, 'source_id'), assetId: this.optional(row, 'asset_id'),
      title: this.text(row, 'title'), summary: this.optional(row, 'summary'),
      sourceUrl: this.optional(row, 'source_url'), currentStatus: this.text(row, 'current_status') as EvidenceStatus,
      createdAt: this.text(row, 'created_at')
    }
  }

  private insertHistory(history: EvidenceStatusHistory): void {
    this.unwrap(this.database.run(
      `INSERT INTO evidence_status_history
       (id, debate_session_id, evidence_id, from_status, to_status, changed_by, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      history.id, history.debateSessionId, history.evidenceId, history.fromStatus ?? null,
      history.toStatus, history.changedBy, history.note, history.createdAt
    ))
  }

  private owned(row: Row) {
    return {
      id: this.text(row, 'id'), debateSessionId: this.text(row, 'debate_session_id'),
      ownerParticipantId: this.text(row, 'owner_participant_id'),
      visibility: this.text(row, 'visibility') as ResearchSession['visibility'],
      createdAt: this.text(row, 'created_at')
    }
  }

  private mapAll<T>(sql: string, mapper: (row: Row) => T, ...parameters: string[]): PersistenceResult<T[]> {
    const result = this.database.all<Row>(sql, ...parameters)
    return result.ok ? { ok: true, value: result.value.map(mapper) } : result
  }

  private voidResult<T>(result: PersistenceResult<T>): PersistenceResult<void> {
    return result.ok ? { ok: true, value: undefined } : result
  }

  private unwrap<T>(result: PersistenceResult<T>): T {
    if (!result.ok) throw result.error
    return result.value
  }

  private text(row: Row, key: string): string {
    return String(row[key] ?? '')
  }

  private optional(row: Row, key: string): string | undefined {
    const value = row[key]
    return value === null || value === undefined ? undefined : String(value)
  }

  private jsonArray(row: Row, key: string): string[] {
    const value = JSON.parse(this.text(row, key)) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }
}
