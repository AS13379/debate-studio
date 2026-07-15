import { chmodSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { LoggerLike, PerformanceMetricsCollector } from '../observability'
import { persistenceFailure, type PersistenceResult } from './errors'

export type DatabaseValue = null | number | bigint | string | NodeJS.ArrayBufferView

export interface DatabaseOptions {
  appDataDirectory: string
  fileName?: string
  logger?: LoggerLike
  performanceMetrics?: Pick<PerformanceMetricsCollector, 'recordSQLite'>
}

export interface RunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export class Database {
  readonly path: string

  private constructor(
    private readonly connection: DatabaseSync,
    path: string,
    private readonly logger?: LoggerLike,
    private readonly performanceMetrics?: Pick<PerformanceMetricsCollector, 'recordSQLite'>
  ) {
    this.path = path
  }

  static open(options: DatabaseOptions): PersistenceResult<Database> {
    const fileName = options.fileName ?? 'debate-studio.sqlite'
    if (!options.appDataDirectory || basename(fileName) !== fileName) {
      return persistenceFailure('INVALID_PATH', 'open', undefined, 'A valid application data directory and plain database file name are required.')
    }

    const path = join(options.appDataDirectory, fileName)
    try {
      mkdirSync(options.appDataDirectory, { recursive: true, mode: 0o700 })
      chmodSync(options.appDataDirectory, 0o700)
      const connection = new DatabaseSync(path, {
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        timeout: 5_000
      })
      connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
      chmodSync(path, 0o600)
      options.logger?.info('SQLite 数据库已打开', { source: 'sqlite', metadata: { operation: 'open' } })
      return { ok: true, value: new Database(connection, path, options.logger, options.performanceMetrics) }
    } catch (cause) {
      options.logger?.error('SQLite 数据库打开失败', { source: 'sqlite', metadata: { operation: 'open' } })
      return persistenceFailure('OPEN_FAILED', 'open', cause, `Unable to open SQLite database at ${path}.`)
    }
  }

  execute(sql: string): PersistenceResult<void> {
    const startedAt = performance.now()
    try {
      this.connection.exec(sql)
      return { ok: true, value: undefined }
    } catch (cause) {
      this.logFailure('execute', cause)
      return persistenceFailure(this.errorCode(cause), 'execute', cause)
    } finally {
      this.performanceMetrics?.recordSQLite(performance.now() - startedAt)
    }
  }

  run(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<RunResult> {
    const startedAt = performance.now()
    try {
      return { ok: true, value: this.connection.prepare(sql).run(...parameters) }
    } catch (cause) {
      this.logFailure('run', cause)
      return persistenceFailure(this.errorCode(cause), 'run', cause)
    } finally {
      this.performanceMetrics?.recordSQLite(performance.now() - startedAt)
    }
  }

  get<T extends object>(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<T | undefined> {
    const startedAt = performance.now()
    try {
      return { ok: true, value: this.connection.prepare(sql).get(...parameters) as T | undefined }
    } catch (cause) {
      this.logFailure('get', cause)
      return persistenceFailure(this.errorCode(cause), 'get', cause)
    } finally {
      this.performanceMetrics?.recordSQLite(performance.now() - startedAt)
    }
  }

  all<T extends object>(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<T[]> {
    const startedAt = performance.now()
    try {
      return { ok: true, value: this.connection.prepare(sql).all(...parameters) as T[] }
    } catch (cause) {
      this.logFailure('all', cause)
      return persistenceFailure(this.errorCode(cause), 'all', cause)
    } finally {
      this.performanceMetrics?.recordSQLite(performance.now() - startedAt)
    }
  }

  transaction<T>(work: () => T): PersistenceResult<T> {
    const begin = this.execute('BEGIN IMMEDIATE')
    if (!begin.ok) return begin

    try {
      const value = work()
      const commit = this.execute('COMMIT')
      if (!commit.ok) throw commit.error
      return { ok: true, value }
    } catch (cause) {
      this.logFailure('transaction', cause)
      this.execute('ROLLBACK')
      return persistenceFailure(this.errorCode(cause), 'transaction', cause)
    }
  }

  backupTo(destinationPath: string): PersistenceResult<void> {
    try {
      this.connection.exec('PRAGMA wal_checkpoint(FULL)')
      this.connection.prepare('VACUUM INTO ?').run(destinationPath)
      chmodSync(destinationPath, 0o600)
      this.logger?.info('SQLite 备份已创建', { source: 'sqlite', metadata: { operation: 'backup' } })
      return { ok: true, value: undefined }
    } catch (cause) {
      this.logFailure('backup', cause)
      return persistenceFailure('BACKUP_FAILED', 'backup', cause)
    }
  }

  close(): PersistenceResult<void> {
    try {
      this.connection.close()
      this.logger?.info('SQLite 数据库已关闭', { source: 'sqlite', metadata: { operation: 'close' } })
      return { ok: true, value: undefined }
    } catch (cause) {
      this.logFailure('close', cause)
      return persistenceFailure(this.errorCode(cause), 'close', cause)
    }
  }

  private errorCode(cause: unknown): 'DATABASE_CLOSED' | 'QUERY_FAILED' {
    return cause instanceof Error && /(closed|not open)/i.test(cause.message) ? 'DATABASE_CLOSED' : 'QUERY_FAILED'
  }

  private logFailure(operation: string, cause: unknown): void {
    this.logger?.error(`SQLite ${operation} 失败`, {
      source: 'sqlite', metadata: { operation, errorType: cause instanceof Error ? cause.name : 'unknown' }
    })
  }
}
