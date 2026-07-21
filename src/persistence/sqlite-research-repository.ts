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
  SourceEvaluation,
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
        visibility, title, url, domain, summary, published_at, fetched_at, source_type, evaluation,
        score, verification_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url,
        domain = excluded.domain, summary = excluded.summary, published_at = excluded.published_at,
        fetched_at = excluded.fetched_at, evaluation = excluded.evaluation,
        score = excluded.score, verification_level = excluded.verification_level`,
      source.id, source.debateSessionId, source.researchSessionId ?? null, source.searchSessionId ?? null,
      source.ownerParticipantId, source.visibility, source.title, source.url ?? null, source.domain ?? null,
      source.summary ?? null, source.publishedAt ?? null, source.fetchedAt ?? null,
      source.sourceType, source.evaluation ?? null, source.score ?? null,
      source.verificationLevel ?? null, source.createdAt
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
      asset.visibility, asset.kind === 'pdf' ? 'image' : asset.kind, asset.title, asset.textContent ?? null, asset.url ?? null,
      asset.summary ?? null, asset.localPath ?? null, asset.mimeType ?? null, asset.sourceName ?? null,
      asset.sourceDate ?? null, asset.createdBy, asset.isOriginal ? 1 : 0, asset.createdAt
    ))
  }

  deleteAsset(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM research_assets WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
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

  saveFetchedPage(page: FetchedWebPage): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO fetched_web_pages
       (id, debate_session_id, research_session_id, source_id, owner_participant_id, visibility,
        url, final_url, title, author, published_at, content_type, body_text, summary, excerpt,
        body_characters, status, error_code, fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET final_url = excluded.final_url, title = excluded.title,
        author = excluded.author, published_at = excluded.published_at, content_type = excluded.content_type,
        body_text = excluded.body_text, summary = excluded.summary, excerpt = excluded.excerpt,
        body_characters = excluded.body_characters, status = excluded.status,
        error_code = excluded.error_code, fetched_at = excluded.fetched_at`,
      page.id, page.debateSessionId, page.researchSessionId, page.sourceId, page.ownerParticipantId,
      page.visibility, page.url, page.finalUrl, page.title, page.author ?? null, page.publishedAt ?? null,
      page.contentType, page.bodyText, page.summary, page.excerpt, page.bodyCharacters, page.status,
      page.errorCode ?? null, page.fetchedAt, page.createdAt
    ))
  }

  findFetchedPageBySource(sourceId: string): PersistenceResult<FetchedWebPage | undefined> {
    const result = this.database.get<Row>('SELECT * FROM fetched_web_pages WHERE source_id = ?', sourceId)
    return result.ok ? { ok: true, value: result.value ? this.mapFetchedPage(result.value) : undefined } : result
  }

  listFetchedPages(debateSessionId: string): PersistenceResult<FetchedWebPage[]> {
    return this.mapAll('SELECT * FROM fetched_web_pages WHERE debate_session_id = ? ORDER BY fetched_at, id',
      (row) => this.mapFetchedPage(row), debateSessionId)
  }

  listFetchedPageSummaries(debateSessionId: string): PersistenceResult<FetchedWebPage[]> {
    return this.mapAll(
      `SELECT id, debate_session_id, research_session_id, source_id, owner_participant_id,
        visibility, url, final_url, title, author, published_at, content_type,
        '' AS body_text, summary, excerpt, body_characters, status, error_code, fetched_at, created_at
       FROM fetched_web_pages WHERE debate_session_id = ? ORDER BY fetched_at, id`,
      (row) => this.mapFetchedPage(row),
      debateSessionId
    )
  }

  saveSourceEvaluation(evaluation: SourceEvaluation): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO source_evaluations
       (id, debate_session_id, research_session_id, source_id, owner_participant_id, visibility,
        purpose, relevance, stance, source_type, published_at, credibility, limitations,
        recommend_publication, based_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evaluation.id, evaluation.debateSessionId, evaluation.researchSessionId, evaluation.sourceId,
      evaluation.ownerParticipantId, evaluation.visibility, evaluation.purpose, evaluation.relevance,
      evaluation.stance, evaluation.sourceType, evaluation.publishedAt ?? null, evaluation.credibility,
      evaluation.limitations, evaluation.recommendPublication ? 1 : 0, evaluation.basedOn, evaluation.createdAt
    ))
  }

  listSourceEvaluations(debateSessionId: string): PersistenceResult<SourceEvaluation[]> {
    return this.mapAll('SELECT * FROM source_evaluations WHERE debate_session_id = ? ORDER BY created_at, id', (row) => ({
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      sourceId: this.text(row, 'source_id'), purpose: this.text(row, 'purpose'),
      relevance: this.text(row, 'relevance'), stance: this.text(row, 'stance'),
      sourceType: this.text(row, 'source_type') as SourceEvaluation['sourceType'],
      publishedAt: this.optional(row, 'published_at'), credibility: this.text(row, 'credibility'),
      limitations: this.text(row, 'limitations'), recommendPublication: Number(row.recommend_publication) === 1,
      basedOn: this.text(row, 'based_on') as SourceEvaluation['basedOn']
    }), debateSessionId)
  }

  saveToolCall(call: ResearchToolCall): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_tool_calls
       (id, debate_session_id, research_session_id, owner_participant_id, visibility, role,
        tool_name, operation_key, arguments_json, status, result_summary, error_code,
        error_description_zh, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, result_summary = excluded.result_summary,
        error_code = excluded.error_code, error_description_zh = excluded.error_description_zh,
        completed_at = excluded.completed_at`,
      call.id, call.debateSessionId, call.researchSessionId, call.ownerParticipantId, call.visibility,
      call.role, call.toolName, call.operationKey, call.argumentsJson, call.status,
      call.resultSummary ?? null, call.errorCode ?? null, call.errorDescriptionZh ?? null,
      call.createdAt, call.completedAt ?? null
    ))
  }

  findCompletedToolCall(operationKey: string): PersistenceResult<ResearchToolCall | undefined> {
    const result = this.database.get<Row>(
      "SELECT * FROM research_tool_calls WHERE operation_key = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1",
      operationKey
    )
    return result.ok ? { ok: true, value: result.value ? this.mapToolCall(result.value) : undefined } : result
  }

  listToolCalls(debateSessionId: string): PersistenceResult<ResearchToolCall[]> {
    return this.mapAll('SELECT * FROM research_tool_calls WHERE debate_session_id = ? ORDER BY created_at, rowid',
      (row) => this.mapToolCall(row), debateSessionId)
  }

  saveLoopState(state: ResearchLoopState): PersistenceResult<void> {
    return this.voidResult(this.database.run(
      `INSERT INTO research_loop_states
       (debate_session_id, research_session_id, owner_participant_id, role, mode, status, goal,
        phase, decision_round_count, no_progress_round_count, finalization_round_count, completion_reason,
        tool_call_count, search_count, page_read_count, body_characters, limits_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(debate_session_id, role) DO UPDATE SET research_session_id = excluded.research_session_id,
        owner_participant_id = excluded.owner_participant_id, mode = excluded.mode, status = excluded.status,
        goal = excluded.goal, phase = excluded.phase, decision_round_count = excluded.decision_round_count,
        no_progress_round_count = excluded.no_progress_round_count,
        finalization_round_count = excluded.finalization_round_count, completion_reason = excluded.completion_reason,
        tool_call_count = excluded.tool_call_count, search_count = excluded.search_count,
        page_read_count = excluded.page_read_count, body_characters = excluded.body_characters,
        limits_json = excluded.limits_json, updated_at = excluded.updated_at`,
      state.debateSessionId, state.researchSessionId, state.ownerParticipantId, state.role,
      state.mode, state.status, state.goal ?? null, state.phase ?? 'discovery',
      state.decisionRoundCount ?? 0, state.noProgressRoundCount ?? 0, state.finalizationRoundCount ?? 0,
      state.completionReason ?? null, state.toolCallCount, state.searchCount,
      state.pageReadCount, state.bodyCharacters, JSON.stringify(state.limits), state.updatedAt
    ))
  }

  listLoopStates(debateSessionId: string): PersistenceResult<ResearchLoopState[]> {
    return this.mapAll('SELECT * FROM research_loop_states WHERE debate_session_id = ? ORDER BY role', (row) => ({
      debateSessionId: this.text(row, 'debate_session_id'), researchSessionId: this.text(row, 'research_session_id'),
      ownerParticipantId: this.text(row, 'owner_participant_id'), role: this.text(row, 'role') as ResearchOwnerRole,
      mode: this.text(row, 'mode') as ResearchLoopState['mode'], status: this.text(row, 'status') as ResearchLoopState['status'],
      goal: this.optional(row, 'goal'), phase: this.text(row, 'phase') as ResearchLoopState['phase'],
      decisionRoundCount: Number(row.decision_round_count), noProgressRoundCount: Number(row.no_progress_round_count),
      finalizationRoundCount: Number(row.finalization_round_count),
      completionReason: this.optional(row, 'completion_reason') as ResearchLoopState['completionReason'],
      toolCallCount: Number(row.tool_call_count), searchCount: Number(row.search_count),
      pageReadCount: Number(row.page_read_count), bodyCharacters: Number(row.body_characters),
      limits: this.jsonObject(row, 'limits_json') as unknown as ResearchLoopState['limits'],
      updatedAt: this.text(row, 'updated_at')
    }), debateSessionId)
  }

  markActiveToolCallsInterrupted(updatedAt: string): PersistenceResult<number> {
    const result = this.database.run(
      `UPDATE research_tool_calls SET status = 'interrupted', completed_at = ?
       WHERE status IN ('running', 'pending-approval')`, updatedAt
    )
    if (!result.ok) return result
    const loops = this.database.run(
      `UPDATE research_loop_states SET status = 'interrupted', updated_at = ?
       WHERE status IN ('running', 'waiting-approval', 'finalizing', 'summarizing')`, updatedAt
    )
    return loops.ok ? { ok: true, value: Number(result.value.changes) + Number(loops.value.changes) } : loops
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
      evaluation: this.optional(row, 'evaluation'), score: this.optionalNumber(row, 'score'),
      verificationLevel: this.optional(row, 'verification_level') as ResearchSource['verificationLevel']
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

  private mapFetchedPage(row: Row): FetchedWebPage {
    return {
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      sourceId: this.text(row, 'source_id'), url: this.text(row, 'url'), finalUrl: this.text(row, 'final_url'),
      title: this.text(row, 'title'), author: this.optional(row, 'author'), publishedAt: this.optional(row, 'published_at'),
      contentType: this.text(row, 'content_type'), bodyText: this.text(row, 'body_text'),
      summary: this.text(row, 'summary'), excerpt: this.text(row, 'excerpt'), bodyCharacters: Number(row.body_characters),
      status: this.text(row, 'status') as FetchedWebPage['status'], errorCode: this.optional(row, 'error_code'),
      fetchedAt: this.text(row, 'fetched_at')
    }
  }

  private mapToolCall(row: Row): ResearchToolCall {
    return {
      ...this.owned(row), researchSessionId: this.text(row, 'research_session_id'),
      role: this.text(row, 'role') as ResearchOwnerRole, toolName: this.text(row, 'tool_name') as ResearchToolCall['toolName'],
      operationKey: this.text(row, 'operation_key'), argumentsJson: this.text(row, 'arguments_json'),
      status: this.text(row, 'status') as ResearchToolCall['status'], resultSummary: this.optional(row, 'result_summary'),
      errorCode: this.optional(row, 'error_code'), errorDescriptionZh: this.optional(row, 'error_description_zh'),
      completedAt: this.optional(row, 'completed_at')
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

  private optionalNumber(row: Row, key: string): number | undefined {
    const value = row[key]
    return value === null || value === undefined ? undefined : Number(value)
  }

  private jsonObject(row: Row, key: string): Record<string, unknown> {
    const value = JSON.parse(this.text(row, key)) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  private jsonArray(row: Row, key: string): string[] {
    const value = JSON.parse(this.text(row, key)) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }
}
