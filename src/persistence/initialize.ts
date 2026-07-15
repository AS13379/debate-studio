import { Database, type DatabaseOptions } from './database'
import { type PersistenceResult } from './errors'
import { MigrationManager } from './migrations'
import type { RepositoryCollection } from './repositories'
import { SQLiteDebateParticipantRepository } from './sqlite-debate-participant-repository'
import { SQLiteModelProfileRepository, SQLiteProviderConnectionRepository } from './sqlite-provider-repositories'
import {
  SQLiteDebateRepository,
  SQLiteEventRepository,
  SQLiteTurnRepository,
  SQLiteUsageRepository
} from './sqlite-run-repositories'
import { SQLiteSessionRepository } from './sqlite-session-repository'
import { SQLiteSettingsRepository } from './sqlite-settings-repository'
import { SQLiteResearchRepository } from './sqlite-research-repository'
import { SQLiteSearchProviderConnectionRepository } from './sqlite-search-provider-connection-repository'
import { SQLiteDebateHistoryRepository } from './sqlite-debate-history-repository'

export interface PersistenceContext {
  database: Database
  migrations: MigrationManager
  repositories: RepositoryCollection
}

export function initializePersistence(options: DatabaseOptions): PersistenceResult<PersistenceContext> {
  const databaseResult = Database.open(options)
  if (!databaseResult.ok) return databaseResult

  const database = databaseResult.value
  const migrations = new MigrationManager(database)
  const migrationResult = migrations.migrate()
  if (!migrationResult.ok) {
    database.close()
    return migrationResult
  }

  return {
    ok: true,
    value: {
      database,
      migrations,
      repositories: {
        settings: new SQLiteSettingsRepository(database),
        providerConnections: new SQLiteProviderConnectionRepository(database),
        modelProfiles: new SQLiteModelProfileRepository(database),
        participants: new SQLiteDebateParticipantRepository(database),
        sessions: new SQLiteSessionRepository(database),
        debates: new SQLiteDebateRepository(database),
        debateHistory: new SQLiteDebateHistoryRepository(database),
        turns: new SQLiteTurnRepository(database),
        events: new SQLiteEventRepository(database),
        usage: new SQLiteUsageRepository(database),
        research: new SQLiteResearchRepository(database),
        searchProviderConnections: new SQLiteSearchProviderConnectionRepository(database)
      }
    }
  }
}
