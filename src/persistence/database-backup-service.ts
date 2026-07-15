import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { LoggerLike } from '../observability'
import { Database } from './database'
import { persistenceFailure, type PersistenceResult } from './errors'

export type DatabaseBackupReason = 'manual' | 'pre-migration' | 'pre-restore'

export interface DatabaseBackupRecord {
  id: string
  createdAt: string
  reason: DatabaseBackupReason
  schemaVersion: number
  filePath: string
  fileSize: number
}

interface BackupManifest extends Omit<DatabaseBackupRecord, 'filePath' | 'fileSize'> {
  fileName: string
  fileSize: number
}

export interface DatabaseBackupServiceOptions {
  appDataDirectory: string
  databasePath: string
  database?: Database
  now?: () => Date
  logger?: LoggerLike
}

export class DatabaseBackupService {
  readonly backupDirectory: string

  private readonly now: () => Date

  constructor(private readonly options: DatabaseBackupServiceOptions) {
    this.backupDirectory = join(options.appDataDirectory, 'backups')
    this.now = options.now ?? (() => new Date())
  }

  createBackup(reason: DatabaseBackupReason, schemaVersion: number): PersistenceResult<DatabaseBackupRecord> {
    try {
      this.ensureDirectory()
      const id = `${this.now().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
      const fileName = `debate-studio-${id}.sqlite`
      const filePath = join(this.backupDirectory, fileName)
      const backupResult = this.options.database
        ? this.options.database.backupTo(filePath)
        : this.copyClosedDatabase(filePath)
      if (!backupResult.ok) return backupResult

      const fileSize = statSync(filePath).size
      const record: DatabaseBackupRecord = {
        id,
        createdAt: this.now().toISOString(),
        reason,
        schemaVersion,
        filePath,
        fileSize
      }
      const manifestPath = this.manifestPath(id)
      const manifest: BackupManifest = {
        id: record.id,
        createdAt: record.createdAt,
        reason: record.reason,
        schemaVersion: record.schemaVersion,
        fileName,
        fileSize
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      chmodSync(manifestPath, 0o600)
      this.options.logger?.info('数据库备份完成', {
        source: 'database-backup', metadata: { reason, schemaVersion, fileSize }
      })
      return { ok: true, value: record }
    } catch (cause) {
      this.options.logger?.error('数据库备份失败', { source: 'database-backup', metadata: { reason } })
      return persistenceFailure('BACKUP_FAILED', 'createBackup', cause)
    }
  }

  listBackups(): PersistenceResult<DatabaseBackupRecord[]> {
    try {
      this.ensureDirectory()
      const backups = readdirSync(this.backupDirectory)
        .filter((name) => name.endsWith('.json'))
        .flatMap((name): DatabaseBackupRecord[] => {
          try {
            const manifest = JSON.parse(readFileSync(join(this.backupDirectory, name), 'utf8')) as BackupManifest
            if (!this.isSafeFileName(manifest.fileName)) return []
            const filePath = join(this.backupDirectory, manifest.fileName)
            if (!existsSync(filePath)) return []
            return [{
              id: manifest.id,
              createdAt: manifest.createdAt,
              reason: manifest.reason,
              schemaVersion: manifest.schemaVersion,
              filePath,
              fileSize: statSync(filePath).size
            }]
          } catch {
            return []
          }
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      return { ok: true, value: backups }
    } catch (cause) {
      return persistenceFailure('BACKUP_FAILED', 'listBackups', cause)
    }
  }

  validateBackup(id: string): PersistenceResult<DatabaseBackupRecord> {
    const recordResult = this.getBackup(id)
    if (!recordResult.ok) return recordResult
    const record = recordResult.value
    let connection: DatabaseSync | undefined
    try {
      connection = new DatabaseSync(record.filePath, { readOnly: true })
      const integrity = connection.prepare('PRAGMA integrity_check').get() as { integrity_check?: string }
      if (integrity.integrity_check !== 'ok') {
        throw new Error(`SQLite integrity check failed: ${integrity.integrity_check ?? 'unknown'}`)
      }
      return { ok: true, value: record }
    } catch (cause) {
      return persistenceFailure('RESTORE_FAILED', 'validateBackup', cause, 'The selected database backup is invalid.')
    } finally {
      connection?.close()
    }
  }

  restoreBackup(id: string): PersistenceResult<DatabaseBackupRecord> {
    const validated = this.validateBackup(id)
    if (!validated.ok) return validated
    const record = validated.value
    const temporaryPath = `${this.options.databasePath}.restore-${randomUUID()}`
    const previousPath = `${this.options.databasePath}.previous-${randomUUID()}`
    try {
      copyFileSync(record.filePath, temporaryPath)
      chmodSync(temporaryPath, 0o600)
      this.removeSidecars()
      const hadDatabase = existsSync(this.options.databasePath)
      if (hadDatabase) renameSync(this.options.databasePath, previousPath)
      try {
        renameSync(temporaryPath, this.options.databasePath)
        chmodSync(this.options.databasePath, 0o600)
        if (hadDatabase) rmSync(previousPath, { force: true })
      } catch (cause) {
        rmSync(this.options.databasePath, { force: true })
        if (hadDatabase && existsSync(previousPath)) renameSync(previousPath, this.options.databasePath)
        throw cause
      }
      this.options.logger?.warn('数据库已从备份恢复', {
        source: 'database-backup', metadata: { schemaVersion: record.schemaVersion }
      })
      return { ok: true, value: record }
    } catch (cause) {
      rmSync(temporaryPath, { force: true })
      return persistenceFailure('RESTORE_FAILED', 'restoreBackup', cause)
    }
  }

  private getBackup(id: string): PersistenceResult<DatabaseBackupRecord> {
    if (!id || basename(id) !== id) {
      return persistenceFailure('RESTORE_FAILED', 'getBackup', undefined, 'A valid backup id is required.')
    }
    const listed = this.listBackups()
    if (!listed.ok) return listed
    const record = listed.value.find((item) => item.id === id)
    return record
      ? { ok: true, value: record }
      : persistenceFailure('RESTORE_FAILED', 'getBackup', undefined, 'The selected database backup does not exist.')
  }

  private copyClosedDatabase(destinationPath: string): PersistenceResult<void> {
    try {
      if (!existsSync(this.options.databasePath)) {
        throw new Error('Database file does not exist.')
      }
      copyFileSync(this.options.databasePath, destinationPath)
      chmodSync(destinationPath, 0o600)
      return { ok: true, value: undefined }
    } catch (cause) {
      return persistenceFailure('BACKUP_FAILED', 'copyClosedDatabase', cause)
    }
  }

  private ensureDirectory(): void {
    mkdirSync(this.backupDirectory, { recursive: true, mode: 0o700 })
    chmodSync(this.backupDirectory, 0o700)
  }

  private isSafeFileName(fileName: string): boolean {
    return Boolean(fileName) && basename(fileName) === fileName && fileName.endsWith('.sqlite')
  }

  private manifestPath(id: string): string {
    return join(this.backupDirectory, `${id}.json`)
  }

  private removeSidecars(): void {
    rmSync(`${this.options.databasePath}-wal`, { force: true })
    rmSync(`${this.options.databasePath}-shm`, { force: true })
  }
}
