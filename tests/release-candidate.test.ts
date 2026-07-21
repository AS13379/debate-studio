import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveAppDataDirectory } from '../src/main/app-paths'
import { initializeDebateDesktopApplication } from '../src/application'
import {
  Database,
  DatabaseBackupService,
  DEFAULT_MIGRATIONS,
  initializePersistence,
  MigrationManager,
  type Migration
} from '../src/persistence'
import { EncryptedFileCredentialStore } from '../src/security'
import { MemoryCredentialStore } from '../src/security'
import { MockHttpTransport } from '../src/providers'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Release Candidate database lifecycle', () => {
  it('supports a clean install with settings and secure paths', async () => {
    const directory = temporaryDirectory()
    const initialized = initializePersistence({ appDataDirectory: directory })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    expect(initialized.value.migrations.currentVersion()).toEqual({ ok: true, value: 16 })
    expect(initialized.value.repositories.settings.set('release-probe', { ready: true })).toMatchObject({ ok: true })
    expect(initialized.value.repositories.settings.get('release-probe')).toEqual({ ok: true, value: { ready: true } })
    expect(initialized.value.backups.listBackups()).toEqual({ ok: true, value: [] })
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(statSync(initialized.value.database.path).mode & 0o777).toBe(0o600)
    expect(initialized.value.database.close().ok).toBe(true)
  })

  for (const legacyVersion of [1, 5, 10, 12]) {
    it(`upgrades schema v${legacyVersion} to the current version without losing supported records`, () => {
      const directory = temporaryDirectory()
      seedLegacyDatabase(directory, legacyVersion)

      const upgraded = initializePersistence({ appDataDirectory: directory })
      expect(upgraded.ok).toBe(true)
      if (!upgraded.ok) return
      expect(upgraded.value.migrations.currentVersion()).toEqual({ ok: true, value: 16 })
      expect(upgraded.value.database.get<{ topic: string }>('SELECT topic FROM debates WHERE id = ?', 'legacy-debate')).toEqual({
        ok: true, value: { topic: `v${legacyVersion} 保留辩题` }
      })

      if (legacyVersion >= 10) {
        expect(upgraded.value.database.get<{ title: string }>('SELECT title FROM research_assets WHERE id = ?', 'legacy-asset')).toEqual({
          ok: true, value: { title: '保留研究资料' }
        })
        expect(upgraded.value.database.get<{ public_code: string }>('SELECT public_code FROM published_evidence WHERE id = ?', 'legacy-evidence')).toEqual({
          ok: true, value: { public_code: 'A-S1' }
        })
      }
      if (legacyVersion >= 12) {
        expect(upgraded.value.database.get<{ status: string }>('SELECT status FROM export_records WHERE id = ?', 'legacy-export')).toEqual({
          ok: true, value: { status: 'completed' }
        })
      }

      const backups = upgraded.value.backups.listBackups()
      expect(backups.ok).toBe(true)
      if (backups.ok) expect(backups.value.filter((item) => item.reason === 'pre-migration')).toHaveLength(legacyVersion < 14 ? 1 : 0)
      upgraded.value.database.close()
    })
  }

  it('restores the pre-upgrade snapshot after a migration failure', () => {
    const directory = temporaryDirectory()
    seedLegacyDatabase(directory, 5)
    const failingMigration: Migration = {
      version: 16,
      name: 'intentional_release_probe_failure',
      sql: 'CREATE TABLE should_rollback (id TEXT); INVALID SQL;'
    }

    const failed = initializePersistence({
      appDataDirectory: directory,
      migrations: [...DEFAULT_MIGRATIONS, failingMigration]
    })
    expect(failed).toMatchObject({ ok: false, error: { code: 'MIGRATION_FAILED' } })

    const reopened = Database.open({ appDataDirectory: directory })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(new MigrationManager(reopened.value, DEFAULT_MIGRATIONS.filter((item) => item.version <= 5)).currentVersion()).toEqual({ ok: true, value: 5 })
    expect(reopened.value.get<{ topic: string }>('SELECT topic FROM debates WHERE id = ?', 'legacy-debate')).toEqual({
      ok: true, value: { topic: 'v5 保留辩题' }
    })
    expect(reopened.value.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")).toEqual({ ok: true, value: undefined })
    reopened.value.close()
  })

  it('creates, lists and restores a secure manual database backup', () => {
    const directory = temporaryDirectory()
    const initialized = initializePersistence({ appDataDirectory: directory })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return
    expect(initialized.value.repositories.settings.set('restore-probe', { value: 'before' }).ok).toBe(true)
    const backup = initialized.value.backups.createBackup('manual', 14)
    expect(backup.ok).toBe(true)
    if (!backup.ok) return
    expect(statSync(backup.value.filePath).mode & 0o777).toBe(0o600)
    expect(statSync(initialized.value.backups.backupDirectory).mode & 0o777).toBe(0o700)
    expect(initialized.value.repositories.settings.set('restore-probe', { value: 'after' }).ok).toBe(true)
    initialized.value.database.close()

    const closedService = new DatabaseBackupService({
      appDataDirectory: directory,
      databasePath: join(directory, 'debate-studio.sqlite')
    })
    expect(closedService.restoreBackup(backup.value.id)).toMatchObject({ ok: true })
    const reopened = initializePersistence({ appDataDirectory: directory })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.repositories.settings.get('restore-probe')).toEqual({ ok: true, value: { value: 'before' } })
    reopened.value.database.close()
  })

  it('restores through the application boundary and leaves the credential vault untouched', async () => {
    const directory = temporaryDirectory()
    const securityDirectory = join(directory, 'security')
    const credentialVault = join(securityDirectory, 'credentials.bin')
    mkdirSync(securityDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(credentialVault, 'encrypted-vault-probe', { mode: 0o600 })
    const first = initializeDebateDesktopApplication({
      appDataDirectory: directory,
      credentialStore: new MemoryCredentialStore(),
      openAITransport: new MockHttpTransport()
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const demo = await first.value.configuration.createMockDemoDebate()
    expect(demo.ok).toBe(true)
    if (!demo.ok) return
    const backup = first.value.dataManagement.createBackup()
    expect(backup.ok).toBe(true)
    if (!backup.ok) return
    expect(first.value.history.renameDebate(demo.value.id, '恢复后不应存在的名称')).toMatchObject({ ok: true })
    expect(await first.value.dataManagement.restoreBackup(backup.value.id, false)).toMatchObject({
      ok: false, error: { code: 'RESTORE_CONFIRMATION_REQUIRED' }
    })
    expect(await first.value.dataManagement.restoreBackup(backup.value.id, true)).toMatchObject({
      ok: true, value: { restartScheduled: true }
    })

    const reopened = initializeDebateDesktopApplication({
      appDataDirectory: directory,
      credentialStore: new MemoryCredentialStore(),
      openAITransport: new MockHttpTransport()
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.history.getDebateDetail(demo.value.id)).toMatchObject({ ok: true, value: { customTitle: undefined } })
    expect(readFileSync(credentialVault, 'utf8')).toBe('encrypted-vault-probe')
    await reopened.value.close()
  })

  it('uses a stable macOS data directory and accepts only an absolute test override', () => {
    expect(resolveAppDataDirectory('/Users/test/Library/Application Support', {})).toBe(
      '/Users/test/Library/Application Support/debate-studio'
    )
    expect(resolveAppDataDirectory('/Users/test/Library/Application Support', {
      DEBATE_STUDIO_USER_DATA_DIR: '/tmp/debate-studio-clean-install'
    })).toBe('/tmp/debate-studio-clean-install')
    expect(resolveAppDataDirectory('/Users/test/Library/Application Support', {
      DEBATE_STUDIO_USER_DATA_DIR: 'relative/path'
    })).toBe('/Users/test/Library/Application Support/debate-studio')
  })

  it('returns a structured error when safeStorage is unavailable', async () => {
    const directory = temporaryDirectory()
    const store = new EncryptedFileCredentialStore({
      filePath: join(directory, 'security', 'credentials.bin'),
      cipher: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => ''
      }
    })
    await expect(store.setCredential('provider:primary', 'never-written')).resolves.toMatchObject({
      ok: false, error: { code: 'KEYCHAIN_UNAVAILABLE' }
    })
    expect(existsSync(join(directory, 'security', 'credentials.bin'))).toBe(false)
  })
})

describe('Release Candidate packaging configuration', () => {
  it('declares an arm64 DMG, stable bundle id, hardened runtime and entitlements', () => {
    const root = join(import.meta.dirname, '..')
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; scripts: Record<string, string> }
    const configuration = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    const entitlements = readFileSync(join(root, 'build', 'entitlements.mac.plist'), 'utf8')
    const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'macos-arm64-release.yml'), 'utf8')

    expect(packageJson.version).toBe('0.5.1')
    expect(packageJson.scripts['release:mac:arm64']).toContain('electron-builder --mac --arm64')
    expect(configuration).toContain('appId: com.leander.debatestudio')
    expect(configuration).toContain('from: build/icon.png')
    expect(configuration).toContain('hardenedRuntime: true')
    expect(configuration).toContain('identity: null')
    expect(configuration).toContain('- arm64')
    expect(configuration).toContain('target: zip')
    expect(configuration).toContain('provider: github')
    expect(configuration).toContain('repo: debate-studio')
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).not.toContain('com.apple.security.app-sandbox')
    expect(readFileSync(join(root, 'scripts', 'build-macos-signed.mjs'), 'utf8')).toContain('CSC_NAME')
    expect(readFileSync(join(root, 'scripts', 'notarize-macos.mjs'), 'utf8')).toContain('APPLE_NOTARY_KEYCHAIN_PROFILE')
    const mainSource = readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf8')
    expect(mainSource).toContain('requestSingleInstanceLock')
    expect(mainSource).toContain('app.dock.setIcon(icon)')
    expect(mainSource.indexOf("app.setPath('userData'")).toBeLessThan(mainSource.indexOf('requestSingleInstanceLock'))
    expect(releaseWorkflow).toContain('runs-on: macos-14')
    expect(releaseWorkflow).toContain('uses: actions/setup-node@v7')
    expect(releaseWorkflow).toContain('npm run release:mac:arm64')
    expect(releaseWorkflow).toContain('npm run release:community-update')
    expect(releaseWorkflow).toContain('debate-studio-mac-arm64.json')
    expect(releaseWorkflow).toContain('uses: actions/upload-artifact@v6')
    expect(releaseWorkflow).toContain('release/latest-mac.yml')
    expect(releaseWorkflow).toContain('release/Debate-Studio-*-arm64.dmg.blockmap')
    expect(releaseWorkflow).toContain('release/Debate-Studio-*-arm64.zip.blockmap')
    expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toContain('MIT License')
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('Debate Studio')
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'debate-studio-rc-'))
  temporaryDirectories.push(directory)
  return directory
}

function seedLegacyDatabase(directory: string, version: number): void {
  const opened = Database.open({ appDataDirectory: directory })
  if (!opened.ok) throw opened.error
  const database = opened.value
  const migrated = new MigrationManager(database, DEFAULT_MIGRATIONS.filter((item) => item.version <= version)).migrate()
  if (!migrated.ok) throw migrated.error
  const timestamp = '2026-01-01T00:00:00.000Z'
  const debateInsert = version >= 5
    ? database.run(
      `INSERT INTO debates (id, topic, status, created_at, updated_at, affirmative_position, negative_position, free_debate_rounds)
       VALUES (?, ?, 'draft', ?, ?, '支持', '反对', 1)`,
      'legacy-debate', `v${version} 保留辩题`, timestamp, timestamp
    )
    : database.run(
      'INSERT INTO debates (id, topic, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      'legacy-debate', `v${version} 保留辩题`, 'draft', timestamp, timestamp
    )
  if (!debateInsert.ok) throw debateInsert.error

  if (version >= 10) {
    unwrap(database.run(
      `INSERT INTO provider_connections (id, provider_id, display_name, protocol_type, base_url, credential_ref, enabled, created_at, updated_at)
       VALUES ('legacy-connection', 'mock', 'Mock', 'mock', 'mock://local', 'mock-ref', 1, ?, ?)`, timestamp, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO model_profiles (id, connection_id, model_id, display_name, capabilities_json, created_at, updated_at)
       VALUES ('legacy-model', 'legacy-connection', 'mock-model', 'Mock', '{}', ?, ?)`, timestamp, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
       VALUES ('legacy-session', 'legacy-debate', 'completed', 'completed', ?, ?)`, timestamp, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO participants (id, debate_id, session_id, role, name, model_profile_id, created_at, updated_at)
       VALUES ('legacy-participant', 'legacy-debate', 'legacy-session', 'affirmative', '正方', 'legacy-model', ?, ?)`, timestamp, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO research_sessions
       (id, debate_session_id, owner_participant_id, owner_role, visibility, status, created_at, updated_at)
       VALUES ('legacy-research', 'legacy-session', 'legacy-participant', 'affirmative', 'affirmative-private', 'completed', ?, ?)`, timestamp, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO research_assets
       (id, debate_session_id, research_session_id, owner_participant_id, visibility, kind, title, text_content, created_by, is_original, created_at)
       VALUES ('legacy-asset', 'legacy-session', 'legacy-research', 'legacy-participant', 'affirmative-private', 'text', '保留研究资料', '摘要', 'user', 1, ?)`, timestamp
    ))
    unwrap(database.run(
      `INSERT INTO published_evidence
       (id, debate_session_id, public_code, submitted_by_participant_id, submitter_role, asset_id, title, summary, current_status, created_at)
       VALUES ('legacy-evidence', 'legacy-session', 'A-S1', 'legacy-participant', 'affirmative', 'legacy-asset', '保留证据', '摘要', 'supported', ?)`, timestamp
    ))
  }
  if (version >= 12) {
    unwrap(database.run(
      `INSERT INTO export_records
       (id, debate_id, type, include_private_research, file_path, created_at, updated_at, file_size, status, progress)
       VALUES ('legacy-export', 'legacy-debate', 'markdown', 0, '/tmp/legacy.md', ?, ?, 12, 'completed', 100)`, timestamp, timestamp
    ))
  }
  database.close()
}

function unwrap(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw result.error
}
