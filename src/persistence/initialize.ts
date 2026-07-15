import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Database, type DatabaseOptions } from './database'
import { DatabaseBackupService } from './database-backup-service'
import { type PersistenceResult } from './errors'
import { DEFAULT_MIGRATIONS, MigrationManager, type Migration } from './migrations'
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
import { SQLiteExportRepository } from './sqlite-export-repository'

export interface PersistenceContext {
  database: Database
  backups: DatabaseBackupService
  migrations: MigrationManager
  repositories: RepositoryCollection
}

export interface PersistenceOptions extends DatabaseOptions {
  migrations?: readonly Migration[]
  now?: () => Date
}

export function initializePersistence(options: PersistenceOptions): PersistenceResult<PersistenceContext> {
  const fileName = options.fileName ?? 'debate-studio.sqlite'
  const databasePath = join(options.appDataDirectory, fileName)
  const databaseExisted = existsSync(databasePath)
  const databaseResult = Database.open(options)
  if (!databaseResult.ok) return databaseResult

  const database = databaseResult.value
  const migrationSet = options.migrations ?? DEFAULT_MIGRATIONS
  const migrations = new MigrationManager(database, migrationSet)
  const backups = new DatabaseBackupService({
    appDataDirectory: options.appDataDirectory,
    databasePath,
    database,
    now: options.now,
    logger: options.logger
  })
  const currentVersion = migrations.currentVersion()
  if (!currentVersion.ok) {
    database.close()
    return currentVersion
  }
  const targetVersion = migrationSet.reduce((maximum, migration) => Math.max(maximum, migration.version), 0)
  const upgradeBackup = databaseExisted && currentVersion.value < targetVersion
    ? backups.createBackup('pre-migration', currentVersion.value)
    : undefined
  if (upgradeBackup && !upgradeBackup.ok) {
    database.close()
    return upgradeBackup
  }
  const migrationResult = migrations.migrate()
  if (!migrationResult.ok) {
    database.close()
    if (upgradeBackup?.ok) {
      const restored = backups.restoreBackup(upgradeBackup.value.id)
      if (!restored.ok) return restored
    }
    return migrationResult
  }

  return {
    ok: true,
    value: {
      database,
      backups,
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
        exports: new SQLiteExportRepository(database),
        research: new SQLiteResearchRepository(database),
        searchProviderConnections: new SQLiteSearchProviderConnectionRepository(database)
      }
    }
  }
}
