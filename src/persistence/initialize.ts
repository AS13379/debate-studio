import { Database, type DatabaseOptions } from './database'
import { type PersistenceResult } from './errors'
import { MigrationManager } from './migrations'
import type { RepositoryCollection } from './repositories'
import { SQLiteModelProfileRepository, SQLiteProviderConnectionRepository } from './sqlite-provider-repositories'
import { SQLiteSettingsRepository } from './sqlite-settings-repository'

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
        modelProfiles: new SQLiteModelProfileRepository(database)
      }
    }
  }
}
