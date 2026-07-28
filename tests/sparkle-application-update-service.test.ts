import { describe, expect, it, vi } from 'vitest'

import {
  SparkleApplicationUpdateService,
  type SparkleNativeState,
  type SparkleUpdatePlatform
} from '../src/application'
import type { LoggerLike } from '../src/observability'
import type { SettingsRepository } from '../src/persistence'

class MemorySettings implements SettingsRepository {
  private readonly values = new Map<string, unknown>()
  get<T>(key: string) { return { ok: true as const, value: this.values.get(key) as T | undefined } }
  set<T>(key: string, value: T) { this.values.set(key, value); return { ok: true as const, value: undefined } }
  delete(key: string) { return { ok: true as const, value: this.values.delete(key) } }
}

const initial: SparkleNativeState = {
  status: 'idle',
  error: '',
  updateVersion: '',
  expectedDownloadBytes: 0,
  receivedDownloadBytes: 0,
  downloadProgress: 0,
  sessionInProgress: false
}

class FakeSparkle implements SparkleUpdatePlatform {
  state = { ...initial }
  listener?: (state: SparkleNativeState) => void
  initialize = vi.fn(() => true)
  getState = vi.fn(() => ({ ...this.state }))
  subscribe = vi.fn((listener: (state: SparkleNativeState) => void) => { this.listener = listener; return () => { this.listener = undefined } })
  checkForUpdates = vi.fn()
  installUpdateNow = vi.fn()
  cancelUpdate = vi.fn()
  setAutomaticChecks = vi.fn()
  setAutomaticDownloads = vi.fn()
  openLatestRelease = vi.fn(async () => undefined)
  close = vi.fn()
  emit(patch: Partial<SparkleNativeState>) { this.state = { ...this.state, ...patch }; this.listener?.({ ...this.state }) }
}

const logger: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('SparkleApplicationUpdateService', () => {
  it('initializes Sparkle and routes manual/background checks through the native platform', async () => {
    const platform = new FakeSparkle()
    const service = new SparkleApplicationUpdateService({
      currentVersion: '0.6.3', supported: true, settings: new MemorySettings(), platform, logger
    })
    await service.initialize()
    await service.checkForUpdates()
    await service.checkForUpdates({ automatic: true })
    expect(platform.initialize).toHaveBeenCalledOnce()
    expect(platform.checkForUpdates).toHaveBeenNthCalledWith(1, false)
    expect(platform.checkForUpdates).toHaveBeenNthCalledWith(2, true)
    expect(service.getState().installationMode).toBe('sparkle')
  })

  it('maps native download progress and ready-to-install state without exposing paths', async () => {
    const platform = new FakeSparkle()
    const service = new SparkleApplicationUpdateService({
      currentVersion: '0.6.3', supported: true, settings: new MemorySettings(), platform, logger
    })
    await service.initialize()
    platform.emit({ status: 'update-found', updateVersion: '0.6.4' })
    platform.emit({ status: 'downloading', expectedDownloadBytes: 100, receivedDownloadBytes: 40, downloadProgress: 0.4 })
    expect(service.getState()).toMatchObject({ status: 'downloading', availableVersion: '0.6.4', progress: { percent: 40 } })
    platform.emit({ status: 'ready-to-install' })
    expect(service.getState()).toMatchObject({ status: 'ready-to-install', verificationStatus: 'verified' })
    expect(JSON.stringify(service.getState())).not.toContain('/Applications')
  })

  it('asks Sparkle to install and restart instead of invoking a file replacement path', async () => {
    const platform = new FakeSparkle()
    const service = new SparkleApplicationUpdateService({
      currentVersion: '0.6.3', supported: true, settings: new MemorySettings(), platform, logger
    })
    await service.initialize()
    await service.openDownloadedUpdate()
    expect(platform.installUpdateNow).toHaveBeenCalledOnce()
    expect(service.getState().status).toBe('installing')
  })

  it('persists automatic preferences and reports native errors as structured Chinese errors', async () => {
    const platform = new FakeSparkle()
    const service = new SparkleApplicationUpdateService({
      currentVersion: '0.6.3', supported: true, settings: new MemorySettings(), platform, logger
    })
    await service.initialize()
    service.setPreferences({ automaticCheckEnabled: false, automaticDownloadEnabled: true })
    expect(platform.setAutomaticChecks).toHaveBeenLastCalledWith(false)
    expect(platform.setAutomaticDownloads).toHaveBeenLastCalledWith(true)
    platform.emit({ status: 'error', error: 'invalid update signature' })
    expect(service.getState()).toMatchObject({ status: 'error', error: { code: 'SPARKLE_UPDATE_FAILED', retryable: true } })
  })
})
