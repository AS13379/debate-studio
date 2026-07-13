import type { ModelCapabilities, ModelProfile, ProtocolType, ProviderConnection } from '../provider-config'
import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'
import type { ModelProfileRepository, ProviderConnectionRepository } from './repositories'

interface ProviderConnectionRow {
  id: string
  provider_id: string
  display_name: string
  protocol_type: string
  base_url: string
  credential_ref: string
  enabled: number
  created_at: string
  updated_at: string
}

interface ModelProfileRow {
  id: string
  connection_id: string
  model_id: string
  display_name: string
  alias: string | null
  capabilities_json: string
  context_window: number | null
  max_output_tokens: number | null
  created_at: string
  updated_at: string
}

export class SQLiteProviderConnectionRepository implements ProviderConnectionRepository {
  constructor(private readonly database: Database) {}

  create(connection: ProviderConnection): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO provider_connections
       (id, provider_id, display_name, protocol_type, base_url, credential_ref, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      connection.id,
      connection.providerId,
      connection.displayName,
      connection.protocolType,
      connection.baseUrl,
      connection.credentialRef,
      connection.enabled ? 1 : 0,
      connection.createdAt,
      connection.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  findById(id: string): PersistenceResult<ProviderConnection | undefined> {
    const result = this.database.get<ProviderConnectionRow>('SELECT * FROM provider_connections WHERE id = ?', id)
    return result.ok ? { ok: true, value: result.value ? this.mapRow(result.value) : undefined } : result
  }

  list(): PersistenceResult<ProviderConnection[]> {
    const result = this.database.all<ProviderConnectionRow>('SELECT * FROM provider_connections ORDER BY created_at, id')
    return result.ok ? { ok: true, value: result.value.map((row) => this.mapRow(row)) } : result
  }

  update(connection: ProviderConnection): PersistenceResult<boolean> {
    const result = this.database.run(
      `UPDATE provider_connections SET
       provider_id = ?, display_name = ?, protocol_type = ?, base_url = ?, credential_ref = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
      connection.providerId,
      connection.displayName,
      connection.protocolType,
      connection.baseUrl,
      connection.credentialRef,
      connection.enabled ? 1 : 0,
      connection.updatedAt,
      connection.id
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM provider_connections WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private mapRow(row: ProviderConnectionRow): ProviderConnection {
    return {
      id: row.id,
      providerId: row.provider_id,
      displayName: row.display_name,
      protocolType: row.protocol_type as ProtocolType,
      baseUrl: row.base_url,
      credentialRef: row.credential_ref,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export class SQLiteModelProfileRepository implements ModelProfileRepository {
  constructor(private readonly database: Database) {}

  create(profile: ModelProfile): PersistenceResult<void> {
    const serialized = this.serializeCapabilities(profile.capabilities)
    if (!serialized.ok) return serialized
    const result = this.database.run(
      `INSERT INTO model_profiles
       (id, connection_id, model_id, display_name, alias, capabilities_json, context_window, max_output_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      profile.id,
      profile.connectionId,
      profile.modelId,
      profile.displayName,
      profile.alias ?? null,
      serialized.value,
      profile.contextWindow ?? null,
      profile.maxOutputTokens ?? null,
      profile.createdAt,
      profile.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  findById(id: string): PersistenceResult<ModelProfile | undefined> {
    const result = this.database.get<ModelProfileRow>('SELECT * FROM model_profiles WHERE id = ?', id)
    if (!result.ok) return result
    if (!result.value) return { ok: true, value: undefined }
    return this.mapRow(result.value)
  }

  list(): PersistenceResult<ModelProfile[]> {
    const result = this.database.all<ModelProfileRow>('SELECT * FROM model_profiles ORDER BY created_at, id')
    if (!result.ok) return result
    const profiles: ModelProfile[] = []
    for (const row of result.value) {
      const mapped = this.mapRow(row)
      if (!mapped.ok) return mapped
      profiles.push(mapped.value)
    }
    return { ok: true, value: profiles }
  }

  listByConnection(connectionId: string): PersistenceResult<ModelProfile[]> {
    const result = this.database.all<ModelProfileRow>(
      'SELECT * FROM model_profiles WHERE connection_id = ? ORDER BY created_at, id',
      connectionId
    )
    if (!result.ok) return result
    const profiles: ModelProfile[] = []
    for (const row of result.value) {
      const mapped = this.mapRow(row)
      if (!mapped.ok) return mapped
      if (mapped.value) profiles.push(mapped.value)
    }
    return { ok: true, value: profiles }
  }

  update(profile: ModelProfile): PersistenceResult<boolean> {
    const serialized = this.serializeCapabilities(profile.capabilities)
    if (!serialized.ok) return serialized
    const result = this.database.run(
      `UPDATE model_profiles SET
       connection_id = ?, model_id = ?, display_name = ?, alias = ?, capabilities_json = ?,
       context_window = ?, max_output_tokens = ?, updated_at = ? WHERE id = ?`,
      profile.connectionId,
      profile.modelId,
      profile.displayName,
      profile.alias ?? null,
      serialized.value,
      profile.contextWindow ?? null,
      profile.maxOutputTokens ?? null,
      profile.updatedAt,
      profile.id
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM model_profiles WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private serializeCapabilities(capabilities: ModelCapabilities): PersistenceResult<string> {
    try {
      return { ok: true, value: JSON.stringify(capabilities) }
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'modelProfiles.serializeCapabilities', cause)
    }
  }

  private mapRow(row: ModelProfileRow): PersistenceResult<ModelProfile> {
    try {
      return {
        ok: true,
        value: {
          id: row.id,
          connectionId: row.connection_id,
          modelId: row.model_id,
          displayName: row.display_name,
          alias: row.alias ?? undefined,
          capabilities: JSON.parse(row.capabilities_json) as ModelCapabilities,
          contextWindow: row.context_window ?? undefined,
          maxOutputTokens: row.max_output_tokens ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      }
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'modelProfiles.mapRow', cause)
    }
  }
}
