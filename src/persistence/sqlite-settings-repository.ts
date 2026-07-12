import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'
import type { SettingsRepository } from './repositories'

interface SettingRow {
  value_json: string
}

export class SQLiteSettingsRepository implements SettingsRepository {
  constructor(private readonly database: Database) {}

  get<T>(key: string): PersistenceResult<T | undefined> {
    const result = this.database.get<SettingRow>('SELECT value_json FROM settings WHERE key = ?', key)
    if (!result.ok) return result
    if (!result.value) return { ok: true, value: undefined }

    try {
      return { ok: true, value: JSON.parse(result.value.value_json) as T }
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'settings.get', cause)
    }
  }

  set<T>(key: string, value: T): PersistenceResult<void> {
    let valueJson: string
    try {
      valueJson = JSON.stringify(value)
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'settings.set', cause)
    }

    const result = this.database.run(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      key,
      valueJson,
      new Date().toISOString()
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  delete(key: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM settings WHERE key = ?', key)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }
}

