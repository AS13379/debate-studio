import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { persistenceFailure, type PersistenceResult } from './errors'

export type DatabaseValue = null | number | bigint | string | NodeJS.ArrayBufferView

export interface DatabaseOptions {
  appDataDirectory: string
  fileName?: string
}

export interface RunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export class Database {
  readonly path: string

  private constructor(private readonly connection: DatabaseSync, path: string) {
    this.path = path
  }

  static open(options: DatabaseOptions): PersistenceResult<Database> {
    const fileName = options.fileName ?? 'debate-studio.sqlite'
    if (!options.appDataDirectory || basename(fileName) !== fileName) {
      return persistenceFailure('INVALID_PATH', 'open', undefined, 'A valid application data directory and plain database file name are required.')
    }

    const path = join(options.appDataDirectory, fileName)
    try {
      mkdirSync(options.appDataDirectory, { recursive: true })
      const connection = new DatabaseSync(path, {
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        timeout: 5_000
      })
      connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
      return { ok: true, value: new Database(connection, path) }
    } catch (cause) {
      return persistenceFailure('OPEN_FAILED', 'open', cause, `Unable to open SQLite database at ${path}.`)
    }
  }

  execute(sql: string): PersistenceResult<void> {
    try {
      this.connection.exec(sql)
      return { ok: true, value: undefined }
    } catch (cause) {
      return persistenceFailure(this.errorCode(cause), 'execute', cause)
    }
  }

  run(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<RunResult> {
    try {
      return { ok: true, value: this.connection.prepare(sql).run(...parameters) }
    } catch (cause) {
      return persistenceFailure(this.errorCode(cause), 'run', cause)
    }
  }

  get<T extends object>(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<T | undefined> {
    try {
      return { ok: true, value: this.connection.prepare(sql).get(...parameters) as T | undefined }
    } catch (cause) {
      return persistenceFailure(this.errorCode(cause), 'get', cause)
    }
  }

  all<T extends object>(sql: string, ...parameters: DatabaseValue[]): PersistenceResult<T[]> {
    try {
      return { ok: true, value: this.connection.prepare(sql).all(...parameters) as T[] }
    } catch (cause) {
      return persistenceFailure(this.errorCode(cause), 'all', cause)
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
      this.execute('ROLLBACK')
      return persistenceFailure(this.errorCode(cause), 'transaction', cause)
    }
  }

  close(): PersistenceResult<void> {
    try {
      this.connection.close()
      return { ok: true, value: undefined }
    } catch (cause) {
      return persistenceFailure(this.errorCode(cause), 'close', cause)
    }
  }

  private errorCode(cause: unknown): 'DATABASE_CLOSED' | 'QUERY_FAILED' {
    return cause instanceof Error && /(closed|not open)/i.test(cause.message) ? 'DATABASE_CLOSED' : 'QUERY_FAILED'
  }
}
