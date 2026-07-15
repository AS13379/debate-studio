import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  Database,
  DEFAULT_MIGRATIONS,
  initializePersistence,
  MigrationManager,
  type Migration
} from '../src/persistence'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-studio-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('SQLite persistence foundation', () => {
  it('creates and initializes a database on first startup', () => {
    const appDataDirectory = temporaryDirectory()
    const result = initializePersistence({ appDataDirectory })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.database.path.startsWith(appDataDirectory)).toBe(true)
    expect(existsSync(result.value.database.path)).toBe(true)
    expect(result.value.migrations.currentVersion()).toEqual({ ok: true, value: 10 })

    const tables = result.value.database.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    expect(tables.ok && tables.value.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'debates',
        'participants',
        'turns',
        'sessions',
        'events',
        'settings',
        'usage_records',
        'provider_connections',
        'model_profiles',
        'research_sessions',
        'public_resource_pools',
        'published_evidence',
        'evidence_status_history',
        'search_provider_connections',
        'fetched_web_pages',
        'research_tool_calls',
        'research_loop_states'
        , 'debate_metadata'
        , 'debate_tags'
      ])
    )
    expect(result.value.database.close().ok).toBe(true)
  })

  it('applies new migration versions once', () => {
    const databaseResult = Database.open({ appDataDirectory: temporaryDirectory() })
    expect(databaseResult.ok).toBe(true)
    if (!databaseResult.ok) return

    const migration: Migration = {
      version: 11,
      name: 'test_upgrade',
      sql: 'CREATE TABLE migration_probe (id TEXT PRIMARY KEY);'
    }
    const manager = new MigrationManager(databaseResult.value, [...DEFAULT_MIGRATIONS, migration])

    expect(manager.migrate()).toMatchObject({
      ok: true,
      value: { fromVersion: 0, toVersion: 11, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
    })
    expect(manager.migrate()).toMatchObject({
      ok: true,
      value: { fromVersion: 11, toVersion: 11, appliedVersions: [] }
    })
    databaseResult.value.close()
  })

  it('backfills history metadata when upgrading an existing version 9 database', () => {
    const databaseResult = Database.open({ appDataDirectory: temporaryDirectory() })
    expect(databaseResult.ok).toBe(true)
    if (!databaseResult.ok) return
    const database = databaseResult.value
    const legacyMigrations = DEFAULT_MIGRATIONS.filter((migration) => migration.version <= 9)
    expect(new MigrationManager(database, legacyMigrations).migrate()).toMatchObject({ ok: true, value: { toVersion: 9 } })
    expect(database.run(
      `INSERT INTO debates (id, topic, status, created_at, updated_at, free_debate_rounds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'legacy-debate', '旧数据库辩题', 'draft', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 1
    ).ok).toBe(true)

    expect(new MigrationManager(database).migrate()).toMatchObject({
      ok: true, value: { fromVersion: 9, toVersion: 10, appliedVersions: [10] }
    })
    expect(database.get<{ status: string; favorite: number }>(
      'SELECT status, favorite FROM debate_metadata WHERE debate_id = ?', 'legacy-debate'
    )).toEqual({ ok: true, value: { status: 'active', favorite: 0 } })
    database.close()
  })

  it('reads and writes through the settings repository', () => {
    const result = initializePersistence({ appDataDirectory: temporaryDirectory() })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const repository = result.value.repositories.settings
    expect(repository.set('appearance', { theme: 'dark', compact: true }).ok).toBe(true)
    expect(repository.get<{ theme: string; compact: boolean }>('appearance')).toEqual({
      ok: true,
      value: { theme: 'dark', compact: true }
    })
    expect(repository.delete('appearance')).toEqual({ ok: true, value: true })
    expect(repository.get('appearance')).toEqual({ ok: true, value: undefined })
    result.value.database.close()
  })

  it('returns a structured error when the database cannot be opened', () => {
    const parent = temporaryDirectory()
    const invalidDirectory = join(parent, 'not-a-directory')
    writeFileSync(invalidDirectory, 'file blocks directory creation')

    const result = Database.open({ appDataDirectory: invalidDirectory })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'OPEN_FAILED', operation: 'open' }
    })
  })
})
