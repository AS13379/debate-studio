import { Database, type DatabaseValue } from './database'
import type { PersistenceResult } from './errors'
import type {
  DebateHistoryDetailRecord,
  DebateHistoryListQuery,
  DebateHistoryListRecord,
  DebateHistoryModelRecord,
  DebateHistoryRepository,
  DebateHistoryStatus,
  DebateMetadataRecord,
  DebateTagRecord
} from './repositories'

interface HistoryRow {
  debate_id: string
  session_id: string
  topic: string
  custom_title: string | null
  favorite: number
  history_status: DebateHistoryStatus
  run_status: string
  current_stage: string
  created_at: string
  updated_at: string
}

interface MetadataRow {
  debate_id: string
  custom_title: string | null
  favorite: number
  status: DebateHistoryStatus
  created_at: string
  updated_at: string
}

interface TagRow { debate_id: string; tag: string }
interface CountRow { count: number }
interface ResearchSummaryRow { status: string | null; total: number; completed: number }
interface DebateDetailRow extends HistoryRow {
  background: string | null
  affirmative_position: string | null
  negative_position: string | null
  free_debate_rounds: number
}
interface ModelRow {
  role: string
  participant_display_name: string
  model_profile_id: string
  model_id: string
  model_display_name: string
  provider_display_name: string
}
interface AdjudicationRow { turn_id: string; content: string | null; completed_at: string | null }

const HISTORY_SELECT = `
  SELECT d.id AS debate_id, s.id AS session_id, d.topic, m.custom_title,
    m.favorite, m.status AS history_status, s.status AS run_status,
    s.current_stage, d.created_at,
    MAX(d.updated_at, s.updated_at, m.updated_at) AS updated_at
  FROM debates d
  JOIN debate_metadata m ON m.debate_id = d.id
  JOIN sessions s ON s.id = (
    SELECT candidate.id FROM sessions candidate
    WHERE candidate.debate_id = d.id
    ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
  )
`

export class SQLiteDebateHistoryRepository implements DebateHistoryRepository {
  constructor(private readonly database: Database) {}

  list(query: DebateHistoryListQuery): PersistenceResult<DebateHistoryListRecord[]> {
    const where: string[] = []
    const parameters: DatabaseValue[] = []
    if (query.status !== 'all') {
      where.push('m.status = ?')
      parameters.push(query.status)
    }
    if (query.favoriteOnly) where.push('m.favorite = 1')
    if (query.search?.trim()) {
      where.push("(d.topic LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(m.custom_title, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)")
      const pattern = `%${escapeLike(query.search.trim())}%`
      parameters.push(pattern, pattern)
    }
    if (query.tag?.trim()) {
      where.push('EXISTS (SELECT 1 FROM debate_tags filter_tag WHERE filter_tag.debate_id = d.id AND filter_tag.tag = ? COLLATE NOCASE)')
      parameters.push(query.tag.trim())
    }
    const orderBy = {
      'created-desc': 'd.created_at DESC, d.id DESC',
      'created-asc': 'd.created_at ASC, d.id ASC',
      'updated-desc': 'updated_at DESC, d.id DESC',
      'updated-asc': 'updated_at ASC, d.id ASC'
    }[query.sort]
    const result = this.database.all<HistoryRow>(
      `${HISTORY_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`,
      ...parameters
    )
    if (!result.ok) return result
    const tags = this.listAllTags()
    if (!tags.ok) return tags
    return {
      ok: true,
      value: result.value.map((row) => this.mapHistoryRow(row, tags.value.get(row.debate_id) ?? []))
    }
  }

  getDetail(debateId: string): PersistenceResult<DebateHistoryDetailRecord | undefined> {
    const detail = this.database.get<DebateDetailRow>(
      `${HISTORY_SELECT.replace(
        'SELECT d.id AS debate_id',
        'SELECT d.background, d.affirmative_position, d.negative_position, d.free_debate_rounds, d.id AS debate_id'
      )} WHERE d.id = ?`,
      debateId
    )
    if (!detail.ok || !detail.value) return detail.ok ? { ok: true, value: undefined } : detail

    const tags = this.database.all<TagRow>('SELECT debate_id, tag FROM debate_tags WHERE debate_id = ? ORDER BY tag COLLATE NOCASE', debateId)
    if (!tags.ok) return tags
    const models = this.database.all<ModelRow>(
      `SELECT p.role, p.name AS participant_display_name, mp.id AS model_profile_id,
        mp.model_id, mp.display_name AS model_display_name, pc.display_name AS provider_display_name
       FROM participants p
       JOIN model_profiles mp ON mp.id = p.model_profile_id
       JOIN provider_connections pc ON pc.id = mp.connection_id
       WHERE p.session_id = ? ORDER BY CASE p.role
         WHEN 'affirmative' THEN 1 WHEN 'negative' THEN 2 WHEN 'moderator' THEN 3 ELSE 4 END`,
      detail.value.session_id
    )
    if (!models.ok) return models
    const research = this.database.get<ResearchSummaryRow>(
      `SELECT
        (SELECT status FROM research_sessions WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)
          ORDER BY CASE status WHEN 'researching' THEN 1 WHEN 'planning' THEN 2 WHEN 'drafting' THEN 3 ELSE 4 END LIMIT 1) AS status,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
       FROM research_sessions WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)`,
      debateId,
      debateId
    )
    if (!research.ok) return research
    const researchIndex = this.database.get<CountRow>(
      `SELECT
        (SELECT COUNT(*) FROM research_goals WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)) +
        (SELECT COUNT(*) FROM research_sources WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)) +
        (SELECT COUNT(*) FROM research_assets WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)) +
        (SELECT COUNT(*) FROM research_notes WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)) +
        (SELECT COUNT(*) FROM provisional_claims WHERE debate_session_id IN (SELECT id FROM sessions WHERE debate_id = ?)) AS count`,
      ...Array(5).fill(debateId)
    )
    if (!researchIndex.ok) return researchIndex
    const evidence = this.countForDebate('published_evidence', debateId, 'debate_session_id')
    if (!evidence.ok) return evidence
    const turns = this.countForDebate('turns', debateId, 'session_id')
    if (!turns.ok) return turns
    const events = this.countForDebate('events', debateId, 'session_id')
    if (!events.ok) return events
    const adjudication = this.database.get<AdjudicationRow>(
      `SELECT id AS turn_id, content, completed_at FROM turns
       WHERE session_id IN (SELECT id FROM sessions WHERE debate_id = ?)
         AND stage = 'adjudication' AND status = 'completed'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      debateId
    )
    if (!adjudication.ok) return adjudication

    const base = this.mapHistoryRow(detail.value, tags.value.map((row) => row.tag))
    return {
      ok: true,
      value: {
        ...base,
        background: detail.value.background ?? undefined,
        affirmativePosition: detail.value.affirmative_position ?? undefined,
        negativePosition: detail.value.negative_position ?? undefined,
        freeDebateRounds: detail.value.free_debate_rounds,
        models: models.value.map(mapModel),
        researchStatus: research.value?.status ?? 'not-started',
        researchSessionCount: research.value?.total ?? 0,
        completedResearchSessionCount: research.value?.completed ?? 0,
        researchIndexCount: researchIndex.value?.count ?? 0,
        evidenceCount: evidence.value?.count ?? 0,
        turnCount: turns.value?.count ?? 0,
        eventCount: events.value?.count ?? 0,
        finalAdjudication: adjudication.value?.content ? {
          turnId: adjudication.value.turn_id,
          content: adjudication.value.content,
          completedAt: adjudication.value.completed_at ?? undefined
        } : undefined
      }
    }
  }

  getMetadata(debateId: string): PersistenceResult<DebateMetadataRecord | undefined> {
    const result = this.database.get<MetadataRow>(
      'SELECT debate_id, custom_title, favorite, status, created_at, updated_at FROM debate_metadata WHERE debate_id = ?',
      debateId
    )
    return result.ok ? { ok: true, value: result.value ? mapMetadata(result.value) : undefined } : result
  }

  rename(debateId: string, customTitle: string, updatedAt: string): PersistenceResult<boolean> {
    return this.updateMetadata('custom_title = ?', [customTitle, updatedAt, debateId])
  }

  setFavorite(debateId: string, favorite: boolean, updatedAt: string): PersistenceResult<boolean> {
    return this.updateMetadata('favorite = ?', [favorite ? 1 : 0, updatedAt, debateId])
  }

  addTag(record: DebateTagRecord, updatedAt: string): PersistenceResult<void> {
    const result = this.database.transaction(() => {
      const inserted = unwrap(this.database.run('INSERT OR IGNORE INTO debate_tags (id, debate_id, tag) VALUES (?, ?, ?)', record.id, record.debateId, record.tag))
      if (Number(inserted.changes) > 0) unwrap(this.database.run('UPDATE debate_metadata SET updated_at = ? WHERE debate_id = ?', updatedAt, record.debateId))
    })
    return result.ok ? { ok: true, value: undefined } : result
  }

  removeTag(debateId: string, tag: string, updatedAt: string): PersistenceResult<boolean> {
    const result = this.database.transaction(() => {
      const deleted = unwrap(this.database.run('DELETE FROM debate_tags WHERE debate_id = ? AND tag = ? COLLATE NOCASE', debateId, tag))
      if (Number(deleted.changes) > 0) unwrap(this.database.run('UPDATE debate_metadata SET updated_at = ? WHERE debate_id = ?', updatedAt, debateId))
      return Number(deleted.changes) > 0
    })
    return result
  }

  setStatus(debateId: string, status: DebateHistoryStatus, updatedAt: string): PersistenceResult<boolean> {
    return this.updateMetadata('status = ?', [status, updatedAt, debateId])
  }

  private updateMetadata(setClause: string, parameters: DatabaseValue[]): PersistenceResult<boolean> {
    const result = this.database.run(`UPDATE debate_metadata SET ${setClause}, updated_at = ? WHERE debate_id = ?`, ...parameters)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private countForDebate(
    table: 'published_evidence' | 'turns' | 'events',
    debateId: string,
    column: 'debate_session_id' | 'session_id'
  ): PersistenceResult<CountRow | undefined> {
    return this.database.get<CountRow>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (SELECT id FROM sessions WHERE debate_id = ?)`,
      debateId
    )
  }

  private listAllTags(): PersistenceResult<Map<string, string[]>> {
    const result = this.database.all<TagRow>('SELECT debate_id, tag FROM debate_tags ORDER BY tag COLLATE NOCASE')
    if (!result.ok) return result
    const tags = new Map<string, string[]>()
    for (const row of result.value) tags.set(row.debate_id, [...(tags.get(row.debate_id) ?? []), row.tag])
    return { ok: true, value: tags }
  }

  private mapHistoryRow(row: HistoryRow, tags: string[]): DebateHistoryListRecord {
    return {
      debateId: row.debate_id,
      sessionId: row.session_id,
      topic: row.topic,
      customTitle: row.custom_title ?? undefined,
      favorite: row.favorite === 1,
      historyStatus: row.history_status,
      runStatus: row.run_status,
      currentStage: row.current_stage,
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function mapMetadata(row: MetadataRow): DebateMetadataRecord {
  return {
    debateId: row.debate_id,
    customTitle: row.custom_title ?? undefined,
    favorite: row.favorite === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapModel(row: ModelRow): DebateHistoryModelRecord {
  return {
    role: row.role,
    participantDisplayName: row.participant_display_name,
    modelProfileId: row.model_profile_id,
    modelId: row.model_id,
    modelDisplayName: row.model_display_name,
    providerDisplayName: row.provider_display_name
  }
}

function unwrap<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}
