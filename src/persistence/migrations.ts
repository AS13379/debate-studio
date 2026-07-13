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
  },
  {
    version: 3,
    name: 'participant_model_bindings',
    sql: `
      ALTER TABLE participants ADD COLUMN system_prompt_template TEXT;
      ALTER TABLE participants ADD COLUMN updated_at TEXT;
      UPDATE participants SET updated_at = created_at WHERE updated_at IS NULL;

      CREATE UNIQUE INDEX idx_participants_session_role ON participants(session_id, role);

      CREATE TRIGGER participants_validate_role_insert
      BEFORE INSERT ON participants
      WHEN NEW.role NOT IN ('affirmative', 'negative', 'moderator', 'judge')
      BEGIN
        SELECT RAISE(ABORT, 'invalid participant role');
      END;

      CREATE TRIGGER participants_validate_role_update
      BEFORE UPDATE OF role ON participants
      WHEN NEW.role NOT IN ('affirmative', 'negative', 'moderator', 'judge')
      BEGIN
        SELECT RAISE(ABORT, 'invalid participant role');
      END;

      CREATE TRIGGER participants_require_model_profile_insert
      BEFORE INSERT ON participants
      WHEN NEW.model_profile_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM model_profiles WHERE id = NEW.model_profile_id)
      BEGIN
        SELECT RAISE(ABORT, 'participant model profile does not exist');
      END;

      CREATE TRIGGER participants_require_model_profile_update
      BEFORE UPDATE OF model_profile_id ON participants
      WHEN NEW.model_profile_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM model_profiles WHERE id = NEW.model_profile_id)
      BEGIN
        SELECT RAISE(ABORT, 'participant model profile does not exist');
      END;

      CREATE TRIGGER model_profiles_restrict_participant_delete
      BEFORE DELETE ON model_profiles
      WHEN EXISTS (SELECT 1 FROM participants WHERE model_profile_id = OLD.id)
      BEGIN
        SELECT RAISE(ABORT, 'model profile is assigned to a participant');
      END;
    `
  },
  {
    version: 4,
    name: 'debate_run_recovery_indexes',
    sql: `
      CREATE INDEX idx_sessions_status ON sessions(status);
      CREATE INDEX idx_turns_session_status ON turns(session_id, status);
      CREATE INDEX idx_turns_retry_of_turn_id ON turns(retry_of_turn_id);
    `
  },
  {
    version: 5,
    name: 'debate_configuration_fields',
    sql: `
      ALTER TABLE debates ADD COLUMN affirmative_position TEXT;
      ALTER TABLE debates ADD COLUMN negative_position TEXT;
      ALTER TABLE debates ADD COLUMN free_debate_rounds INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    version: 6,
    name: 'turn_failure_details',
    sql: `
      ALTER TABLE turns ADD COLUMN error_code TEXT;
      ALTER TABLE turns ADD COLUMN error_title_zh TEXT;
      ALTER TABLE turns ADD COLUMN error_description_zh TEXT;
      ALTER TABLE turns ADD COLUMN error_retryable INTEGER;
      ALTER TABLE turns ADD COLUMN error_suggested_action_zh TEXT;
      ALTER TABLE turns ADD COLUMN error_technical_details TEXT;
    `
  },
  {
    version: 7,
    name: 'allow_model_profile_variants',
    sql: `
      DROP INDEX idx_model_profiles_connection_model;
      CREATE INDEX idx_model_profiles_connection_model ON model_profiles(connection_id, model_id);
    `
  },
  {
    version: 8,
    name: 'research_and_evidence_mvp',
    sql: `
      CREATE TABLE research_sessions (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        owner_role TEXT NOT NULL CHECK (owner_role IN ('affirmative', 'negative', 'moderator')),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        status TEXT NOT NULL CHECK (status IN ('planning', 'researching', 'drafting', 'completed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (debate_session_id, owner_role)
      );

      CREATE TABLE research_goals (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE search_sessions (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE search_queries (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        search_session_id TEXT REFERENCES search_sessions(id) ON DELETE SET NULL,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        query TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE research_sources (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
        search_session_id TEXT REFERENCES search_sessions(id) ON DELETE SET NULL,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        title TEXT NOT NULL,
        url TEXT,
        domain TEXT,
        summary TEXT,
        published_at TEXT,
        fetched_at TEXT,
        source_type TEXT NOT NULL,
        evaluation TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE research_assets (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        kind TEXT NOT NULL CHECK (kind IN ('text', 'url', 'image')),
        title TEXT NOT NULL,
        text_content TEXT,
        url TEXT,
        summary TEXT,
        local_path TEXT,
        mime_type TEXT,
        source_name TEXT,
        source_date TEXT,
        created_by TEXT NOT NULL,
        is_original INTEGER NOT NULL CHECK (is_original IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE research_notes (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        source_id TEXT REFERENCES research_sources(id) ON DELETE SET NULL,
        asset_id TEXT REFERENCES research_assets(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE provisional_claims (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        research_session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'affirmative-private', 'negative-private', 'moderator-private')),
        claim TEXT NOT NULL,
        supporting_source_ids_json TEXT NOT NULL,
        unresolved INTEGER NOT NULL CHECK (unresolved IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE public_resource_pools (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
        owner_participant_id TEXT NOT NULL REFERENCES participants(id),
        visibility TEXT NOT NULL CHECK (visibility = 'public'),
        topic_definition TEXT NOT NULL,
        temporal_scope TEXT,
        geographic_scope TEXT,
        key_concepts_json TEXT NOT NULL,
        controversy_directions_json TEXT NOT NULL,
        user_submitted_source_ids_json TEXT NOT NULL,
        fact_boundaries_json TEXT NOT NULL,
        moderator_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE published_evidence (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        public_code TEXT NOT NULL,
        submitted_by_participant_id TEXT NOT NULL REFERENCES participants(id),
        submitter_role TEXT NOT NULL CHECK (submitter_role IN ('affirmative', 'negative', 'moderator')),
        source_id TEXT REFERENCES research_sources(id) ON DELETE SET NULL,
        asset_id TEXT REFERENCES research_assets(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        summary TEXT,
        source_url TEXT,
        current_status TEXT NOT NULL CHECK (current_status IN ('unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected')),
        created_at TEXT NOT NULL,
        UNIQUE (debate_session_id, public_code)
      );

      CREATE TABLE evidence_status_history (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES published_evidence(id) ON DELETE CASCADE,
        from_status TEXT CHECK (from_status IS NULL OR from_status IN ('unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected')),
        to_status TEXT NOT NULL CHECK (to_status IN ('unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected')),
        changed_by TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE evidence_reference_issues (
        id TEXT PRIMARY KEY,
        debate_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id),
        reference_code TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (turn_id, reference_code)
      );

      CREATE INDEX idx_research_sessions_debate ON research_sessions(debate_session_id);
      CREATE INDEX idx_research_goals_debate ON research_goals(debate_session_id);
      CREATE INDEX idx_search_sessions_debate ON search_sessions(debate_session_id);
      CREATE INDEX idx_search_queries_debate ON search_queries(debate_session_id);
      CREATE INDEX idx_research_sources_debate ON research_sources(debate_session_id);
      CREATE INDEX idx_research_assets_debate ON research_assets(debate_session_id);
      CREATE INDEX idx_research_notes_debate ON research_notes(debate_session_id);
      CREATE INDEX idx_provisional_claims_debate ON provisional_claims(debate_session_id);
      CREATE INDEX idx_published_evidence_debate ON published_evidence(debate_session_id);
      CREATE INDEX idx_evidence_history_debate ON evidence_status_history(debate_session_id);
      CREATE INDEX idx_evidence_reference_issues_debate ON evidence_reference_issues(debate_session_id);
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
