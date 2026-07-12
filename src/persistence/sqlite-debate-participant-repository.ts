import type { DebateParticipantConfig, DebateParticipantRole } from '../participant-config'
import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'
import type { DebateParticipantRepository } from './repositories'

interface DebateParticipantRow {
  id: string
  session_id: string
  role: string
  model_profile_id: string
  name: string
  system_prompt_template: string | null
  created_at: string
  updated_at: string
}

export class SQLiteDebateParticipantRepository implements DebateParticipantRepository {
  constructor(private readonly database: Database) {}

  create(participant: DebateParticipantConfig): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO participants
       (id, debate_id, session_id, role, name, model_profile_id, system_prompt_template, created_at, updated_at)
       SELECT ?, debate_id, ?, ?, ?, ?, ?, ?, ? FROM sessions WHERE id = ?`,
      participant.id,
      participant.sessionId,
      participant.role,
      participant.displayName,
      participant.modelProfileId,
      participant.systemPromptTemplate ?? null,
      participant.createdAt,
      participant.updatedAt,
      participant.sessionId
    )
    if (!result.ok) return result
    return Number(result.value.changes) === 1
      ? { ok: true, value: undefined }
      : persistenceFailure('QUERY_FAILED', 'participants.create', undefined, 'Debate session does not exist.')
  }

  get(id: string): PersistenceResult<DebateParticipantConfig | undefined> {
    const result = this.database.get<DebateParticipantRow>(
      `SELECT id, session_id, role, model_profile_id, name, system_prompt_template, created_at, updated_at
       FROM participants WHERE id = ?`,
      id
    )
    return result.ok ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined } : result
  }

  listBySession(sessionId: string): PersistenceResult<DebateParticipantConfig[]> {
    const result = this.database.all<DebateParticipantRow>(
      `SELECT id, session_id, role, model_profile_id, name, system_prompt_template, created_at, updated_at
       FROM participants WHERE session_id = ?
       ORDER BY CASE role WHEN 'affirmative' THEN 1 WHEN 'negative' THEN 2 WHEN 'moderator' THEN 3 ELSE 4 END`,
      sessionId
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  update(participant: DebateParticipantConfig): PersistenceResult<boolean> {
    const result = this.database.run(
      `UPDATE participants SET
       debate_id = (SELECT debate_id FROM sessions WHERE id = ?),
       session_id = ?, role = ?, name = ?, model_profile_id = ?, system_prompt_template = ?, updated_at = ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM sessions WHERE id = ?)`,
      participant.sessionId,
      participant.sessionId,
      participant.role,
      participant.displayName,
      participant.modelProfileId,
      participant.systemPromptTemplate ?? null,
      participant.updatedAt,
      participant.id,
      participant.sessionId
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM participants WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private mapRow(row: DebateParticipantRow): DebateParticipantConfig {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as DebateParticipantRole,
      modelProfileId: row.model_profile_id,
      displayName: row.name,
      systemPromptTemplate: row.system_prompt_template ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

