import { describe, expect, it, vi } from 'vitest'
import { ApplicationUpdateService, normalizeReleaseNotes, type CommunityUpdatePlatform } from '../src/application'
import type { LoggerLike } from '../src/observability'
import type { SettingsRepository } from '../src/persistence'
import type { CommunityUpdateInfo, CommunityUpdateManifest } from '../src/shared/update-dtos'

class MemorySettings implements SettingsRepository {
  private readonly values = new Map<string, unknown>()
  get<T>(key: string) { return { ok: true as const, value: this.values.get(key) as T | undefined } }
  set<T>(key: string, value: T) { this.values.set(key, value); return { ok: true as const, value: undefined } }
  delete(key: string) { return { ok: true as const, value: this.values.delete(key) } }
}
const manifest: CommunityUpdateManifest = { schemaVersion: 1, channel: 'stable', version: '0.5.0', platform: 'darwin', arch: 'arm64', tag: 'v0.5.0', assetName: 'Debate-Studio-0.5.0-arm64.update.tar.gz', size: 100, sha256: 'a'.repeat(64), releaseDate: '2026-07-21T00:00:00.000Z', notesSha256: 'b'.repeat(64), bundleId: 'com.leander.debatestudio', keyId: 'ds-update-2026-01', signature: 'test' }
const info: CommunityUpdateInfo = { version: '0.5.0', size: 100, releaseNotes: '改进', manifest }
class FakePlatform implements CommunityUpdatePlatform {
  next: CommunityUpdateInfo | undefined = info
  check = vi.fn(async () => this.next)
  download = vi.fn(async (_info: CommunityUpdateInfo, signal: AbortSignal, progress: (value: { transferredBytes: number; totalBytes: number; bytesPerSecond: number }) => void) => { if (!signal.aborted) progress({ transferredBytes: 100, totalBytes: 100, bytesPerSecond: 10 }) })
  prepareInstall = vi.fn(async () => undefined)
  launchInstaller = vi.fn(async () => undefined)
  showDownloadedUpdateInFinder = vi.fn(async () => undefined)
  openLatestRelease = vi.fn(async () => undefined)
  clearCache = vi.fn(async () => undefined)
  cacheSize = vi.fn(async () => 123)
  readStartupResult = vi.fn<CommunityUpdatePlatform['readStartupResult']>(async () => undefined)
}
const logger: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
function service(platform = new FakePlatform()) { return { platform, value: new ApplicationUpdateService({ currentVersion: '0.4.9', supported: true, platform, settings: new MemorySettings(), logger }) } }

describe('ApplicationUpdateService', () => {
  it('reports current version and keeps automatic downloads disabled by default', () => expect(service().value.getState()).toMatchObject({ currentVersion: '0.4.9', automaticCheckEnabled: true, automaticDownloadEnabled: false, status: 'idle' }))
  it('checks, downloads, verifies and prepares the community update', async () => { const { platform, value } = service(); await value.checkForUpdates(); expect(value.getState()).toMatchObject({ status: 'available', availableVersion: '0.5.0' }); await value.downloadUpdate(); expect(value.getState()).toMatchObject({ status: 'downloaded', verificationStatus: 'verified' }); await value.installUpdate(); expect(platform.prepareInstall).toHaveBeenCalledOnce(); expect(platform.launchInstaller).toHaveBeenCalledOnce() })
  it('shows up-to-date when no newer manifest exists', async () => { const { platform, value } = service(); platform.next = undefined; await value.checkForUpdates(); expect(value.getState().status).toBe('up-to-date') })
  it('normalizes network failures without leaking raw authorization data', async () => { const { platform, value } = service(); platform.check.mockRejectedValue(new Error('Authorization Bearer secret ENOTFOUND')); const result = await value.checkForUpdates(); expect(result).toMatchObject({ ok: false, error: { code: 'UPDATE_CHECK_FAILED' } }); expect(JSON.stringify(value.getState())).not.toContain('secret') })
  it('persists disabled automatic checks', async () => { const { platform, value } = service(); value.setPreferences({ automaticCheckEnabled: false, automaticDownloadEnabled: false }); await value.checkForUpdates({ automatic: true }); expect(platform.check).not.toHaveBeenCalled() })
  it('downloads automatically only when the user enables it', async () => { const { platform, value } = service(); value.setPreferences({ automaticCheckEnabled: true, automaticDownloadEnabled: true }); const result = await value.checkForUpdates(); expect(result).toMatchObject({ ok: true, value: { status: 'downloaded', automaticDownloadEnabled: true } }); expect(platform.download).toHaveBeenCalledOnce() })
  it('keeps the verified archive visible and exposes a safe validation step after failure', async () => { const { platform, value } = service(); platform.download.mockRejectedValue(new Error('ARCHIVE_EXTRACT_FAILED_TAR_ENTRY_ERROR')); platform.cacheSize.mockResolvedValue(456); await value.checkForUpdates(); const result = await value.downloadUpdate(); expect(result).toMatchObject({ ok: false, error: { detailCode: 'ARCHIVE_EXTRACT_FAILED_TAR_ENTRY_ERROR' } }); expect(value.getState()).toMatchObject({ status: 'error', verificationStatus: 'failed', cacheSizeBytes: 456 }) })
  it('reads rolled-back install state at startup', async () => { const { platform, value } = service(); platform.readStartupResult.mockResolvedValue({ type: 'rolled-back', version: '0.5.0', messageZh: '已恢复旧版本' }); await value.initialize(); expect(value.getState()).toMatchObject({ status: 'rolled-back', messageZh: '已恢复旧版本' }) })
})
describe('release notes normalization', () => { it('strips HTML from notes', () => expect(normalizeReleaseNotes([{ version: '0.5.0', note: '<b>新功能</b>' }])).toBe('0.5.0\n新功能')) })
