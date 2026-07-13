import { Database } from './database'
import type { PersistenceResult } from './errors'
import type { SessionRecord, SessionRepository } from './repositories'

interface SessionRow {
  id: string
  debate_id: string
  status: string
  current_stage: string
  created_at: string
  updated_at: string
}

interface SessionExistsRow {
  found: number
}

export class SQLiteSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  get(id: string): PersistenceResult<SessionRecord | undefined> {
    const result = this.database.get<SessionRow>(
      `SELECT id, debate_id, status, current_stage, created_at, updated_at
       FROM sessions WHERE id = ?`,
      id
    )
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  exists(id: string): PersistenceResult<boolean> {
    const result = this.database.get<SessionExistsRow>(
      'SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?) AS found',
      id
    )
    return result.ok ? { ok: true, value: result.value?.found === 1 } : result
  }

  updateRuntimeState(
    id: string,
    status: string,
    currentStage: string,
    updatedAt: string
  ): PersistenceResult<boolean> {
    const result = this.database.run(
      'UPDATE sessions SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?',
      status,
      currentStage,
      updatedAt,
      id
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  markInProgressInterrupted(updatedAt: string): PersistenceResult<number> {
    const result = this.database.run(
      `UPDATE sessions SET status = 'interrupted', updated_at = ?
       WHERE status IN ('running', 'streaming')`,
      updatedAt
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) } : result
  }

  private mapRow(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      debateId: row.debate_id,
      status: row.status,
      currentStage: row.current_stage,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
