import type { DebateEvaluationRecord, DebateReviewRecord } from '../debate-quality'
import type {
  PromptTask,
  PromptTemplateRecord,
  PromptUsageRecord,
  PromptVersionRecord
} from '../prompt-studio'
import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'
import type { DebateQualityRepository, PromptStudioRepository } from './repositories'

interface EvaluationRow {
  id: string
  debate_id: string
  session_id: string
  evaluation_json: string
  evaluator_model_profile_id: string | null
  evaluator_model_id: string
  prompt_template_id: string
  prompt_version: number
  created_at: string
}

interface ReviewRow {
  id: string
  debate_id: string
  session_id: string
  review_json: string
  reviewer_model_profile_id: string | null
  reviewer_model_id: string
  prompt_template_id: string
  prompt_version: number
  created_at: string
}

export class SQLiteDebateQualityRepository implements DebateQualityRepository {
  constructor(private readonly database: Database) {}

  saveEvaluation(record: DebateEvaluationRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO debate_evaluations
       (id, debate_id, session_id, evaluation_json, evaluator_model_profile_id, evaluator_model_id,
        prompt_template_id, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(debate_id) DO UPDATE SET
         id = excluded.id, session_id = excluded.session_id, evaluation_json = excluded.evaluation_json,
         evaluator_model_profile_id = excluded.evaluator_model_profile_id,
         evaluator_model_id = excluded.evaluator_model_id, prompt_template_id = excluded.prompt_template_id,
         prompt_version = excluded.prompt_version, created_at = excluded.created_at`,
      record.id, record.debateId, record.sessionId, JSON.stringify(record.evaluation),
      record.evaluatorModelProfileId ?? null, record.evaluatorModelId, record.promptTemplateId,
      record.promptVersion, record.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  findEvaluationByDebate(debateId: string): PersistenceResult<DebateEvaluationRecord | undefined> {
    return this.oneEvaluation('debate_id', debateId)
  }

  findEvaluationBySession(sessionId: string): PersistenceResult<DebateEvaluationRecord | undefined> {
    return this.oneEvaluation('session_id', sessionId)
  }

  listEvaluations(): PersistenceResult<DebateEvaluationRecord[]> {
    const rows = this.database.all<EvaluationRow>(`${EVALUATION_SELECT} ORDER BY created_at DESC`)
    if (!rows.ok) return rows
    try { return { ok: true, value: rows.value.map(mapEvaluation) } }
    catch (cause) { return persistenceFailure('SERIALIZATION_FAILED', 'debateQuality.listEvaluations', cause) }
  }

  saveReview(record: DebateReviewRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO debate_reviews
       (id, debate_id, session_id, review_json, reviewer_model_profile_id, reviewer_model_id,
        prompt_template_id, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(debate_id) DO UPDATE SET
         id = excluded.id, session_id = excluded.session_id, review_json = excluded.review_json,
         reviewer_model_profile_id = excluded.reviewer_model_profile_id,
         reviewer_model_id = excluded.reviewer_model_id, prompt_template_id = excluded.prompt_template_id,
         prompt_version = excluded.prompt_version, created_at = excluded.created_at`,
      record.id, record.debateId, record.sessionId, JSON.stringify(record.review),
      record.reviewerModelProfileId ?? null, record.reviewerModelId, record.promptTemplateId,
      record.promptVersion, record.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  findReviewByDebate(debateId: string): PersistenceResult<DebateReviewRecord | undefined> {
    return this.oneReview('debate_id', debateId)
  }

  findReviewBySession(sessionId: string): PersistenceResult<DebateReviewRecord | undefined> {
    return this.oneReview('session_id', sessionId)
  }

  private oneEvaluation(column: 'debate_id' | 'session_id', value: string): PersistenceResult<DebateEvaluationRecord | undefined> {
    const row = this.database.get<EvaluationRow>(`${EVALUATION_SELECT} WHERE ${column} = ?`, value)
    if (!row.ok || !row.value) return row.ok ? { ok: true, value: undefined } : row
    try { return { ok: true, value: mapEvaluation(row.value) } }
    catch (cause) { return persistenceFailure('SERIALIZATION_FAILED', 'debateQuality.findEvaluation', cause) }
  }

  private oneReview(column: 'debate_id' | 'session_id', value: string): PersistenceResult<DebateReviewRecord | undefined> {
    const row = this.database.get<ReviewRow>(`${REVIEW_SELECT} WHERE ${column} = ?`, value)
    if (!row.ok || !row.value) return row.ok ? { ok: true, value: undefined } : row
    try { return { ok: true, value: mapReview(row.value) } }
    catch (cause) { return persistenceFailure('SERIALIZATION_FAILED', 'debateQuality.findReview', cause) }
  }
}

interface TemplateRow {
  id: string
  task: PromptTask
  display_name: string
  active_version: number
  created_at: string
  updated_at: string
}

interface VersionRow {
  id: string
  template_id: string
  version: number
  content: string
  change_note: string | null
  created_at: string
}

interface UsageRow {
  id: string
  prompt_template_id: string
  prompt_version_id: string
  task: PromptTask
  version: number
  model_profile_id: string | null
  model_id: string
  session_id: string | null
  turn_id: string | null
  created_at: string
}

export class SQLitePromptStudioRepository implements PromptStudioRepository {
  constructor(private readonly database: Database) {}

  listTemplates(): PersistenceResult<PromptTemplateRecord[]> {
    const rows = this.database.all<TemplateRow>(`${TEMPLATE_SELECT} ORDER BY task`)
    return rows.ok ? { ok: true, value: rows.value.map(mapTemplate) } : rows
  }

  findTemplateByTask(task: PromptTask): PersistenceResult<PromptTemplateRecord | undefined> {
    const row = this.database.get<TemplateRow>(`${TEMPLATE_SELECT} WHERE task = ?`, task)
    return row.ok ? { ok: true, value: row.value ? mapTemplate(row.value) : undefined } : row
  }

  listVersions(templateId: string): PersistenceResult<PromptVersionRecord[]> {
    const rows = this.database.all<VersionRow>(`${VERSION_SELECT} WHERE template_id = ? ORDER BY version DESC`, templateId)
    return rows.ok ? { ok: true, value: rows.value.map(mapVersion) } : rows
  }

  findVersion(templateId: string, version: number): PersistenceResult<PromptVersionRecord | undefined> {
    const row = this.database.get<VersionRow>(`${VERSION_SELECT} WHERE template_id = ? AND version = ?`, templateId, version)
    return row.ok ? { ok: true, value: row.value ? mapVersion(row.value) : undefined } : row
  }

  createVersion(version: PromptVersionRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO prompt_versions (id, template_id, version, content, change_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      version.id, version.templateId, version.version, version.content, version.changeNote ?? null, version.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  setActiveVersion(templateId: string, version: number, updatedAt: string): PersistenceResult<boolean> {
    const result = this.database.run(
      'UPDATE prompt_templates SET active_version = ?, updated_at = ? WHERE id = ?',
      version, updatedAt, templateId
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  createUsage(record: PromptUsageRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO prompt_usage_records
       (id, prompt_template_id, prompt_version_id, task, version, model_profile_id, model_id,
        session_id, turn_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id, record.promptTemplateId, record.promptVersionId, record.task, record.version,
      record.modelProfileId ?? null, record.modelId, record.sessionId ?? null, record.turnId ?? null,
      record.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  listUsage(templateId?: string): PersistenceResult<PromptUsageRecord[]> {
    const rows = templateId
      ? this.database.all<UsageRow>(`${USAGE_SELECT} WHERE prompt_template_id = ? ORDER BY created_at DESC`, templateId)
      : this.database.all<UsageRow>(`${USAGE_SELECT} ORDER BY created_at DESC`)
    return rows.ok ? { ok: true, value: rows.value.map(mapUsage) } : rows
  }
}

const EVALUATION_SELECT = `SELECT id, debate_id, session_id, evaluation_json,
  evaluator_model_profile_id, evaluator_model_id, prompt_template_id, prompt_version, created_at
  FROM debate_evaluations`
const REVIEW_SELECT = `SELECT id, debate_id, session_id, review_json, reviewer_model_profile_id,
  reviewer_model_id, prompt_template_id, prompt_version, created_at FROM debate_reviews`
const TEMPLATE_SELECT = 'SELECT id, task, display_name, active_version, created_at, updated_at FROM prompt_templates'
const VERSION_SELECT = 'SELECT id, template_id, version, content, change_note, created_at FROM prompt_versions'
const USAGE_SELECT = `SELECT id, prompt_template_id, prompt_version_id, task, version,
  model_profile_id, model_id, session_id, turn_id, created_at FROM prompt_usage_records`

function mapEvaluation(row: EvaluationRow): DebateEvaluationRecord {
  return {
    id: row.id, debateId: row.debate_id, sessionId: row.session_id,
    evaluation: JSON.parse(row.evaluation_json) as DebateEvaluationRecord['evaluation'],
    evaluatorModelProfileId: row.evaluator_model_profile_id ?? undefined,
    evaluatorModelId: row.evaluator_model_id, promptTemplateId: row.prompt_template_id,
    promptVersion: row.prompt_version, createdAt: row.created_at
  }
}

function mapReview(row: ReviewRow): DebateReviewRecord {
  return {
    id: row.id, debateId: row.debate_id, sessionId: row.session_id,
    review: JSON.parse(row.review_json) as DebateReviewRecord['review'],
    reviewerModelProfileId: row.reviewer_model_profile_id ?? undefined,
    reviewerModelId: row.reviewer_model_id, promptTemplateId: row.prompt_template_id,
    promptVersion: row.prompt_version, createdAt: row.created_at
  }
}

function mapTemplate(row: TemplateRow): PromptTemplateRecord {
  return { id: row.id, task: row.task, displayName: row.display_name, activeVersion: row.active_version, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapVersion(row: VersionRow): PromptVersionRecord {
  return { id: row.id, templateId: row.template_id, version: row.version, content: row.content, changeNote: row.change_note ?? undefined, createdAt: row.created_at }
}

function mapUsage(row: UsageRow): PromptUsageRecord {
  return {
    id: row.id, promptTemplateId: row.prompt_template_id, promptVersionId: row.prompt_version_id,
    task: row.task, version: row.version, modelProfileId: row.model_profile_id ?? undefined,
    modelId: row.model_id, sessionId: row.session_id ?? undefined, turnId: row.turn_id ?? undefined,
    createdAt: row.created_at
  }
}
