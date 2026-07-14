import type { SearchProviderConnection } from '../research'
import { Database } from './database'
import type { DatabaseValue, RunResult } from './database'
import type { PersistenceResult } from './errors'
import type { SearchProviderConnectionRepository } from './repositories'

interface SearchConnectionRow {
  id: string
  display_name: string
  provider_type: 'tavily'
  base_url: string
  credential_ref: string
  enabled: number
  is_default: number
  created_at: string
  updated_at: string
}

export class SQLiteSearchProviderConnectionRepository implements SearchProviderConnectionRepository {
  constructor(private readonly database: Database) {}

  create(connection: SearchProviderConnection): PersistenceResult<void> {
    return this.asVoid(this.database.run(
      `INSERT INTO search_provider_connections
       (id, display_name, provider_type, base_url, credential_ref, enabled, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...this.parameters(connection)
    ))
  }

  findById(id: string): PersistenceResult<SearchProviderConnection | undefined> {
    const result = this.database.get<SearchConnectionRow>('SELECT * FROM search_provider_connections WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value ? this.map(result.value) : undefined } : result
  }

  list(): PersistenceResult<SearchProviderConnection[]> {
    const result = this.database.all<SearchConnectionRow>('SELECT * FROM search_provider_connections ORDER BY is_default DESC, created_at, id')
    return result.ok ? { ok: true, value: result.value.map((row) => this.map(row)) } : result
  }

  update(connection: SearchProviderConnection): PersistenceResult<boolean> {
    const result = this.database.run(
      `UPDATE search_provider_connections SET display_name = ?, provider_type = ?, base_url = ?, credential_ref = ?,
       enabled = ?, is_default = ?, updated_at = ? WHERE id = ?`,
      connection.displayName, connection.providerType, connection.baseUrl, connection.credentialRef,
      connection.enabled ? 1 : 0, connection.isDefault ? 1 : 0, connection.updatedAt, connection.id
    )
    return result.ok ? { ok: true, value: result.value.changes > 0 } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM search_provider_connections WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value.changes > 0 } : result
  }

  setDefault(id: string, updatedAt: string): PersistenceResult<boolean> {
    return this.database.transaction(() => {
      const cleared = this.database.run('UPDATE search_provider_connections SET is_default = 0, updated_at = ? WHERE is_default = 1', updatedAt)
      if (!cleared.ok) throw cleared.error
      const updated = this.database.run('UPDATE search_provider_connections SET is_default = 1, updated_at = ? WHERE id = ?', updatedAt, id)
      if (!updated.ok) throw updated.error
      return updated.value.changes > 0
    })
  }

  private parameters(connection: SearchProviderConnection): DatabaseValue[] {
    return [
      connection.id, connection.displayName, connection.providerType, connection.baseUrl,
      connection.credentialRef, connection.enabled ? 1 : 0, connection.isDefault ? 1 : 0,
      connection.createdAt, connection.updatedAt
    ]
  }

  private map(row: SearchConnectionRow): SearchProviderConnection {
    return {
      id: row.id,
      displayName: row.display_name,
      providerType: row.provider_type,
      baseUrl: row.base_url,
      credentialRef: row.credential_ref,
      enabled: row.enabled === 1,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private asVoid(result: PersistenceResult<RunResult>): PersistenceResult<void> {
    return result.ok ? { ok: true, value: undefined } : result
  }
}
