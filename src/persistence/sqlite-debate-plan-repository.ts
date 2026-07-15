import type { DebatePlanRecord, DebatePlanRepository } from './repositories'
import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'

interface DebatePlanRow {
  id: string
  debate_id: string
  session_id: string
  mode: DebatePlanRecord['mode']
  topic: string
  background: string
  affirmative_position: string
  negative_position: string
  key_questions_json: string
  research_directions_json: string
  evidence_suggestions_json: string
  prompt_version: string
  model_profile_id: string | null
  model_id: string
  created_at: string
  confirmed_at: string
}

export class SQLiteDebatePlanRepository implements DebatePlanRepository {
  constructor(private readonly database: Database) {}

  create(record: DebatePlanRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO debate_plans
       (id, debate_id, session_id, mode, topic, background, affirmative_position, negative_position,
        key_questions_json, research_directions_json, evidence_suggestions_json, prompt_version,
        model_profile_id, model_id, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id, record.debateId, record.sessionId, record.mode, record.topic, record.background,
      record.affirmativePosition, record.negativePosition, JSON.stringify(record.keyQuestions),
      JSON.stringify(record.researchDirections), JSON.stringify(record.evidenceSuggestions),
      record.promptVersion, record.modelProfileId ?? null, record.modelId, record.createdAt, record.confirmedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  findByDebate(debateId: string): PersistenceResult<DebatePlanRecord | undefined> {
    const result = this.database.get<DebatePlanRow>(`${this.selectSql()} WHERE debate_id = ?`, debateId)
    if (!result.ok || !result.value) return result.ok ? { ok: true, value: undefined } : result
    try {
      return { ok: true, value: this.map(result.value) }
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'debatePlans.findByDebate', cause)
    }
  }

  private selectSql(): string {
    return `SELECT id, debate_id, session_id, mode, topic, background, affirmative_position,
      negative_position, key_questions_json, research_directions_json, evidence_suggestions_json,
      prompt_version, model_profile_id, model_id, created_at, confirmed_at FROM debate_plans`
  }

  private map(row: DebatePlanRow): DebatePlanRecord {
    return {
      id: row.id, debateId: row.debate_id, sessionId: row.session_id, mode: row.mode,
      topic: row.topic, background: row.background, affirmativePosition: row.affirmative_position,
      negativePosition: row.negative_position,
      keyQuestions: JSON.parse(row.key_questions_json) as string[],
      researchDirections: JSON.parse(row.research_directions_json) as string[],
      evidenceSuggestions: JSON.parse(row.evidence_suggestions_json) as string[],
      promptVersion: row.prompt_version, modelProfileId: row.model_profile_id ?? undefined, modelId: row.model_id,
      createdAt: row.created_at, confirmedAt: row.confirmed_at
    }
  }
}
