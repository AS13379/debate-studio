import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'

export interface Migration {
  version: number
  name: string
  sql: string
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  appliedVersions: number[]
}

export const DEFAULT_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE debates (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        background TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        model_profile_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id),
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        content TEXT,
        retry_of_turn_id TEXT REFERENCES turns(id),
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE usage_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost REAL,
        cost_is_estimated INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_sessions_debate_id ON sessions(debate_id);
      CREATE INDEX idx_participants_session_id ON participants(session_id);
      CREATE INDEX idx_turns_session_id ON turns(session_id);
      CREATE INDEX idx_events_session_id ON events(session_id);
      CREATE INDEX idx_usage_records_session_id ON usage_records(session_id);
    `
  },
  {
    version: 2,
    name: 'provider_configuration',
    sql: `
      CREATE TABLE provider_connections (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        protocol_type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE model_profiles (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        alias TEXT,
        capabilities_json TEXT NOT NULL,
        context_window INTEGER,
        max_output_tokens INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_provider_connections_provider_id ON provider_connections(provider_id);
      CREATE INDEX idx_model_profiles_connection_id ON model_profiles(connection_id);
      CREATE UNIQUE INDEX idx_model_profiles_connection_model ON model_profiles(connection_id, model_id);
    `
  }
]

interface VersionRow {
  version: number
}

export class MigrationManager {
  constructor(private readonly database: Database, private readonly migrations: readonly Migration[] = DEFAULT_MIGRATIONS) {}

  migrate(): PersistenceResult<MigrationResult> {
    const metadata = this.database.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    if (!metadata.ok) return persistenceFailure('MIGRATION_FAILED', 'createMigrationTable', metadata.error)

    const currentResult = this.currentVersion()
    if (!currentResult.ok) return currentResult
    const fromVersion = currentResult.value
    const pending = [...this.migrations]
      .sort((left, right) => left.version - right.version)
      .filter((migration) => migration.version > fromVersion)
    const appliedVersions: number[] = []

    for (const migration of pending) {
      const result = this.database.transaction(() => {
        this.unwrap(this.database.execute(migration.sql))
        this.unwrap(
          this.database.run(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
            migration.version,
            migration.name,
            new Date().toISOString()
          )
        )
      })
      if (!result.ok) {
        return persistenceFailure('MIGRATION_FAILED', `migration:${migration.version}`, result.error)
      }
      appliedVersions.push(migration.version)
    }

    const toVersionResult = this.currentVersion()
    if (!toVersionResult.ok) return toVersionResult
    return { ok: true, value: { fromVersion, toVersion: toVersionResult.value, appliedVersions } }
  }

  currentVersion(): PersistenceResult<number> {
    const result = this.database.get<VersionRow>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    if (!result.ok) return persistenceFailure('MIGRATION_FAILED', 'currentVersion', result.error)
    return { ok: true, value: result.value?.version ?? 0 }
  }

  private unwrap<T>(result: PersistenceResult<T>): T {
    if (!result.ok) throw result.error
    return result.value
  }
}
