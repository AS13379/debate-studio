import { Database } from './database'
import type { PersistenceResult } from './errors'
import type { ExportRecord, ExportRepository, ExportStatus, ExportType } from './repositories'

interface ExportRow {
  id: string
  debate_id: string
  type: ExportType
  include_private_research: number
  file_path: string
  created_at: string
  updated_at: string
  file_size: number
  status: ExportStatus
  progress: number
  error_title: string | null
  error_message: string | null
}

const SELECT_EXPORT = `SELECT id, debate_id, type, include_private_research, file_path,
  created_at, updated_at, file_size, status, progress, error_title, error_message FROM export_records`

export class SQLiteExportRepository implements ExportRepository {
  constructor(private readonly database: Database) {}

  create(record: ExportRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO export_records
       (id, debate_id, type, include_private_research, file_path, created_at,
        updated_at, file_size, status, progress, error_title, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.debateId,
      record.type,
      record.includePrivateResearch ? 1 : 0,
      record.filePath,
      record.createdAt,
      record.updatedAt,
      record.fileSize,
      record.status,
      record.progress,
      record.errorTitle ?? null,
      record.errorMessage ?? null
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  update(record: ExportRecord): PersistenceResult<boolean> {
    const result = this.database.run(
      `UPDATE export_records SET file_path = ?, file_size = ?, status = ?, progress = ?,
        updated_at = ?, error_title = ?, error_message = ? WHERE id = ?`,
      record.filePath,
      record.fileSize,
      record.status,
      record.progress,
      record.updatedAt,
      record.errorTitle ?? null,
      record.errorMessage ?? null,
      record.id
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  findById(id: string): PersistenceResult<ExportRecord | undefined> {
    const result = this.database.get<ExportRow>(`${SELECT_EXPORT} WHERE id = ?`, id)
    return result.ok
      ? { ok: true, value: result.value ? mapRow(result.value) : undefined }
      : result
  }

  list(): PersistenceResult<ExportRecord[]> {
    const result = this.database.all<ExportRow>(`${SELECT_EXPORT} ORDER BY created_at DESC, id DESC`)
    return result.ok ? { ok: true, value: result.value.map(mapRow) } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM export_records WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  markGeneratingInterrupted(updatedAt: string): PersistenceResult<number> {
    const result = this.database.run(
      `UPDATE export_records SET status = 'failed', updated_at = ?,
       error_title = '导出因应用关闭而中断',
       error_message = '文件生成未完成，可以重新发起导出。'
       WHERE status = 'generating'`,
      updatedAt
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) } : result
  }
}

function mapRow(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    debateId: row.debate_id,
    type: row.type,
    includePrivateResearch: row.include_private_research === 1,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileSize: row.file_size,
    status: row.status,
    progress: row.progress,
    errorTitle: row.error_title ?? undefined,
    errorMessage: row.error_message ?? undefined
  }
}
