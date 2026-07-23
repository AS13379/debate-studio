import { describe, expect, it, vi } from 'vitest'
import { ApplicationUpdateService, normalizeReleaseNotes, type DmgUpdatePlatform } from '../src/application'
import type { LoggerLike } from '../src/observability'
import type { SettingsRepository } from '../src/persistence'
import type { DmgUpdateInfo } from '../src/shared/update-dtos'

class MemorySettings implements SettingsRepository {
  private readonly values = new Map<string, unknown>()

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value)
  }

  get<T>(key: string) {
    return { ok: true as const, value: this.values.get(key) as T | undefined }
  }

  set<T>(key: string, value: T) {
    this.values.set(key, value)
    return { ok: true as const, value: undefined }
  }

  delete(key: string) {
    return { ok: true as const, value: this.values.delete(key) }
  }
}

const info: DmgUpdateInfo = {
  version: '0.6.1',
  size: 100,
  sha256: 'a'.repeat(64),
  assetName: 'Debate-Studio-0.6.1-arm64.dmg',
  downloadUrl: 'https://github.com/AS13379/debate-studio/releases/download/v0.6.1/Debate-Studio-0.6.1-arm64.dmg',
  releaseNotes: '改进'
}

class FakePlatform implements DmgUpdatePlatform {
  next: DmgUpdateInfo | undefined = info
  check = vi.fn(async () => this.next)
  download = vi.fn(async (
    _info: DmgUpdateInfo,
    signal: AbortSignal,
    progress: (value: { transferredBytes: number; totalBytes: number; bytesPerSecond: number }) => void
  ) => {
    if (!signal.aborted) progress({ transferredBytes: 100, totalBytes: 100, bytesPerSecond: 10 })
  })
  openDownloadedUpdate = vi.fn(async () => undefined)
  showDownloadedUpdateInFinder = vi.fn(async () => undefined)
  deleteDownloadedUpdate = vi.fn(async () => undefined)
  openLatestRelease = vi.fn(async () => undefined)
  clearCache = vi.fn(async () => undefined)
  cacheSize = vi.fn(async () => 123)
}

const logger: LoggerLike = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

function service(platform = new FakePlatform(), settings = new MemorySettings()) {
  return {
    platform,
    value: new ApplicationUpdateService({
      currentVersion: '0.6.0',
      supported: true,
      platform,
      settings,
      logger
    })
  }
}

describe('ApplicationUpdateService', () => {
  it('reports current version and keeps automatic downloads disabled by default', () => {
    expect(service().value.getState()).toMatchObject({
      currentVersion: '0.6.0',
      automaticCheckEnabled: true,
      automaticDownloadEnabled: false,
      status: 'idle'
    })
  })

  it('checks, downloads and opens a verified DMG without installing the app', async () => {
    const { platform, value } = service()
    await value.checkForUpdates()
    expect(value.getState()).toMatchObject({ status: 'available', availableVersion: '0.6.1' })
    await value.downloadUpdate()
    expect(value.getState()).toMatchObject({
      status: 'downloaded',
      verificationStatus: 'verified',
      manualInstallAvailable: true
    })
    await value.openDownloadedUpdate()
    expect(platform.openDownloadedUpdate).toHaveBeenCalledOnce()
    expect(value.getState().messageZh).toContain('拖入 Applications')
  })

  it('shows up-to-date when no newer release exists', async () => {
    const { platform, value } = service()
    platform.next = undefined
    await value.checkForUpdates()
    expect(value.getState().status).toBe('up-to-date')
  })

  it('normalizes network failures without leaking raw authorization data', async () => {
    const { platform, value } = service()
    platform.check.mockRejectedValue(new Error('Authorization Bearer secret ENOTFOUND'))
    const result = await value.checkForUpdates()
    expect(result).toMatchObject({ ok: false, error: { code: 'UPDATE_CHECK_FAILED' } })
    expect(JSON.stringify(value.getState())).not.toContain('secret')
  })

  it('persists disabled automatic checks', async () => {
    const { platform, value } = service()
    value.setPreferences({ automaticCheckEnabled: false, automaticDownloadEnabled: false })
    await value.checkForUpdates({ automatic: true })
    expect(platform.check).not.toHaveBeenCalled()
  })

  it('downloads automatically only when the user enables it', async () => {
    const { platform, value } = service()
    value.setPreferences({ automaticCheckEnabled: true, automaticDownloadEnabled: true })
    const result = await value.checkForUpdates()
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'downloaded', automaticDownloadEnabled: true }
    })
    expect(platform.download).toHaveBeenCalledOnce()
  })

  it('keeps the current app untouched when DMG validation fails', async () => {
    const { platform, value } = service()
    platform.download.mockRejectedValue(new Error('ASSET_SHA256_MISMATCH'))
    platform.cacheSize.mockResolvedValue(0)
    await value.checkForUpdates()
    const result = await value.downloadUpdate()
    expect(result).toMatchObject({
      ok: false,
      error: { detailCode: 'ASSET_SHA256_MISMATCH' }
    })
    expect(value.getState()).toMatchObject({
      status: 'error',
      verificationStatus: 'failed',
      manualInstallAvailable: false
    })
  })

  it('deletes only the downloaded DMG and returns to the available state', async () => {
    const { platform, value } = service()
    await value.checkForUpdates()
    await value.downloadUpdate()
    await value.deleteDownloadedUpdate()
    expect(platform.deleteDownloadedUpdate).toHaveBeenCalledOnce()
    expect(value.getState()).toMatchObject({
      status: 'available',
      verificationStatus: 'not-verified',
      manualInstallAvailable: false
    })
  })

  it('shows a one-time success message after the application version increases', async () => {
    const settings = new MemorySettings({ 'application.update.last-run-version': '0.5.9' })
    const { value } = service(new FakePlatform(), settings)
    await value.initialize()
    expect(value.getState()).toMatchObject({
      status: 'up-to-date',
      messageZh: 'Debate Studio 已更新至 v0.6.0。'
    })
  })
})

describe('release notes normalization', () => {
  it('strips HTML from notes', () => {
    expect(normalizeReleaseNotes([{ version: '0.6.1', note: '<b>新功能</b>' }])).toBe('0.6.1\n新功能')
  })
})
