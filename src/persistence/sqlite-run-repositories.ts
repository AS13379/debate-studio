import { Database } from './database'
import type { PersistenceResult } from './errors'
import type {
  DebateRecord,
  DebateRepository,
  EventRecord,
  EventRepository,
  TurnRecord,
  TurnPage,
  TurnPageCursor,
  TurnRepository,
  UsageRecord,
  UsageRepository
} from './repositories'

interface DebateRow {
  id: string
  topic: string
  background: string | null
  affirmative_position: string | null
  negative_position: string | null
  free_debate_rounds: number
  status: string
  created_at: string
  updated_at: string
}

interface TurnRow {
  id: string
  session_id: string
  participant_id: string
  stage: string
  status: string
  content: string | null
  retry_of_turn_id: string | null
  error: string | null
  error_code: string | null
  error_title_zh: string | null
  error_description_zh: string | null
  error_retryable: number | null
  error_suggested_action_zh: string | null
  error_technical_details: string | null
  created_at: string
  completed_at: string | null
}

interface EventRow {
  id: string
  session_id: string
  turn_id: string | null
  type: string
  payload_json: string
  created_at: string
}

interface UsageRow {
  id: string
  session_id: string
  turn_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  estimated_cost: number | null
  cost_is_estimated: number
  duration_ms: number | null
  created_at: string
}

export class SQLiteDebateRepository implements DebateRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): PersistenceResult<DebateRecord | undefined> {
    const result = this.database.get<DebateRow>(
      `SELECT id, topic, background, affirmative_position, negative_position,
        free_debate_rounds, status, created_at, updated_at
       FROM debates WHERE id = ?`,
      id
    )
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  save(record: DebateRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO debates
       (id, topic, background, affirmative_position, negative_position, free_debate_rounds,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         topic = excluded.topic,
         background = excluded.background,
         affirmative_position = excluded.affirmative_position,
         negative_position = excluded.negative_position,
         free_debate_rounds = excluded.free_debate_rounds,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      record.id,
      record.topic,
      record.background ?? null,
      record.affirmativePosition ?? null,
      record.negativePosition ?? null,
      record.freeDebateRounds ?? 1,
      record.status,
      record.createdAt,
      record.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  list(): PersistenceResult<DebateRecord[]> {
    const result = this.database.all<DebateRow>(
      `SELECT id, topic, background, affirmative_position, negative_position,
        free_debate_rounds, status, created_at, updated_at
       FROM debates ORDER BY created_at DESC, id DESC`
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM debates WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private mapRow(row: DebateRow): DebateRecord {
    return {
      id: row.id,
      topic: row.topic,
      background: row.background ?? undefined,
      affirmativePosition: row.affirmative_position ?? undefined,
      negativePosition: row.negative_position ?? undefined,
      freeDebateRounds: row.free_debate_rounds,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class SQLiteTurnRepository implements TurnRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): PersistenceResult<TurnRecord | undefined> {
    const result = this.database.get<TurnRow>(`${this.selectSql()} WHERE id = ?`, id)
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  create(record: TurnRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO turns
       (id, session_id, participant_id, stage, status, content, retry_of_turn_id, error,
        error_code, error_title_zh, error_description_zh, error_retryable,
        error_suggested_action_zh, error_technical_details, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.sessionId,
      record.participantId,
      record.stage,
      record.status,
      record.content ?? null,
      record.retryOfTurnId ?? null,
      record.error ?? null,
      record.failure?.code ?? null,
      record.failure?.titleZh ?? null,
      record.failure?.descriptionZh ?? null,
      record.failure ? (record.failure.retryable ? 1 : 0) : null,
      record.failure?.suggestedActionZh ?? null,
      record.failure?.technicalDetails ?? null,
      record.createdAt,
      record.completedAt ?? null
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  update(record: TurnRecord): PersistenceResult<boolean> {
    const result = this.database.run(
      `UPDATE turns SET status = ?, content = ?, error = ?, error_code = ?, error_title_zh = ?,
       error_description_zh = ?, error_retryable = ?, error_suggested_action_zh = ?,
       error_technical_details = ?, completed_at = ?
       WHERE id = ? AND session_id = ?`,
      record.status,
      record.content ?? null,
      record.error ?? null,
      record.failure?.code ?? null,
      record.failure?.titleZh ?? null,
      record.failure?.descriptionZh ?? null,
      record.failure ? (record.failure.retryable ? 1 : 0) : null,
      record.failure?.suggestedActionZh ?? null,
      record.failure?.technicalDetails ?? null,
      record.completedAt ?? null,
      record.id,
      record.sessionId
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  listBySession(sessionId: string): PersistenceResult<TurnRecord[]> {
    const result = this.database.all<TurnRow>(
      `${this.selectSql()} WHERE session_id = ? ORDER BY created_at, rowid`,
      sessionId
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  listPage(sessionId: string, limit: number, before?: TurnPageCursor): PersistenceResult<TurnPage> {
    const pageSize = Math.max(1, Math.min(100, Math.trunc(limit)))
    const cursorSql = before ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''
    const parameters = before
      ? [sessionId, before.createdAt, before.createdAt, before.id, pageSize + 1]
      : [sessionId, pageSize + 1]
    const result = this.database.all<TurnRow>(
      `${this.selectSql()} WHERE session_id = ?${cursorSql}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...parameters
    )
    if (!result.ok) return result
    const hasMore = result.value.length > pageSize
    const rows = result.value.slice(0, pageSize)
    const oldest = rows.at(-1)
    return {
      ok: true,
      value: {
        records: rows.map((row) => this.mapRow(row)).reverse(),
        nextCursor: hasMore && oldest ? { createdAt: oldest.created_at, id: oldest.id } : undefined
      }
    }
  }

  findLatest(sessionId: string): PersistenceResult<TurnRecord | undefined> {
    const result = this.database.get<TurnRow>(
      `${this.selectSql()} WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      sessionId
    )
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  findLatestRetryable(sessionId: string): PersistenceResult<TurnRecord | undefined> {
    const result = this.database.get<TurnRow>(
      `${this.selectSql()}
       WHERE session_id = ? AND status IN ('failed', 'cancelled', 'interrupted')
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      sessionId
    )
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  markInProgressInterrupted(completedAt: string): PersistenceResult<number> {
    const result = this.database.run(
      `UPDATE turns SET status = 'interrupted', completed_at = COALESCE(completed_at, ?)
       WHERE status IN ('running', 'streaming')`,
      completedAt
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) } : result
  }

  private selectSql(): string {
    return `SELECT id, session_id, participant_id, stage, status, content,
      retry_of_turn_id, error, error_code, error_title_zh, error_description_zh,
      error_retryable, error_suggested_action_zh, error_technical_details,
      created_at, completed_at FROM turns`
  }

  private mapRow(row: TurnRow): TurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      participantId: row.participant_id,
      stage: row.stage,
      status: row.status,
      content: row.content ?? undefined,
      retryOfTurnId: row.retry_of_turn_id ?? undefined,
      error: row.error ?? undefined,
      failure: row.error_code && row.error_title_zh && row.error_description_zh && row.error_suggested_action_zh
        ? {
            code: row.error_code,
            titleZh: row.error_title_zh,
            descriptionZh: row.error_description_zh,
            retryable: row.error_retryable === 1,
            suggestedActionZh: row.error_suggested_action_zh,
            technicalDetails: row.error_technical_details ?? undefined
          }
        : undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined
    }
  }
}

export class SQLiteEventRepository implements EventRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): PersistenceResult<EventRecord | undefined> {
    const result = this.database.get<EventRow>(`${this.selectSql()} WHERE id = ?`, id)
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  create(record: EventRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO events (id, session_id, turn_id, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.id,
      record.sessionId,
      record.turnId ?? null,
      record.type,
      record.payloadJson,
      record.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  listBySession(sessionId: string): PersistenceResult<EventRecord[]> {
    const result = this.database.all<EventRow>(
      `${this.selectSql()} WHERE session_id = ? ORDER BY created_at, rowid`,
      sessionId
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  private selectSql(): string {
    return 'SELECT id, session_id, turn_id, type, payload_json, created_at FROM events'
  }

  private mapRow(row: EventRow): EventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id ?? undefined,
      type: row.type,
      payloadJson: row.payload_json,
      createdAt: row.created_at
    }
  }
}

export class SQLiteUsageRepository implements UsageRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): PersistenceResult<UsageRecord | undefined> {
    const result = this.database.get<UsageRow>(`${this.selectSql()} WHERE id = ?`, id)
    return result.ok
      ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined }
      : result
  }

  create(record: UsageRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO usage_records
       (id, session_id, turn_id, input_tokens, output_tokens, total_tokens,
        estimated_cost, cost_is_estimated, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.sessionId,
      record.turnId ?? null,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.totalTokens ?? null,
      record.estimatedCost ?? null,
      record.costIsEstimated ? 1 : 0,
      record.durationMs ?? null,
      record.createdAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  listBySession(sessionId: string): PersistenceResult<UsageRecord[]> {
    const result = this.database.all<UsageRow>(
      `${this.selectSql()} WHERE session_id = ? ORDER BY created_at, rowid`,
      sessionId
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  private selectSql(): string {
    return `SELECT id, session_id, turn_id, input_tokens, output_tokens, total_tokens,
      estimated_cost, cost_is_estimated, duration_ms, created_at FROM usage_records`
  }

  private mapRow(row: UsageRow): UsageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      estimatedCost: row.estimated_cost ?? undefined,
      costIsEstimated: row.cost_is_estimated === 1,
      durationMs: row.duration_ms ?? undefined,
      createdAt: row.created_at
    }
  }
}
