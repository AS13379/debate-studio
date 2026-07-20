import { describe, expect, it, vi } from 'vitest'

import {
  ApplicationUpdateService,
  normalizeReleaseNotes,
  type ApplicationUpdateCancellationToken,
  type ApplicationUpdaterEvent,
  type ApplicationUpdaterPort
} from '../src/application'
import type { LoggerLike } from '../src/observability'
import type { SettingsRepository } from '../src/persistence'

class MemorySettings implements SettingsRepository {
  private readonly values = new Map<string, unknown>()
  get<T>(key: string) { return { ok: true as const, value: this.values.get(key) as T | undefined } }
  set<T>(key: string, value: T) { this.values.set(key, value); return { ok: true as const, value: undefined } }
  delete(key: string) { return { ok: true as const, value: this.values.delete(key) } }
}

class FakeToken implements ApplicationUpdateCancellationToken {
  cancelled = false
  cancel(): void { this.cancelled = true }
}

class FakeUpdater implements ApplicationUpdaterPort {
  listener?: (event: ApplicationUpdaterEvent) => void
  token = new FakeToken()
  configured?: { autoDownload: false; autoInstallOnAppQuit: false }
  check = vi.fn(async () => undefined)
  download = vi.fn(async (_token: ApplicationUpdateCancellationToken) => undefined)
  installed = false
  configure(options: { autoDownload: false; autoInstallOnAppQuit: false }): void { this.configured = options }
  subscribe(listener: (event: ApplicationUpdaterEvent) => void): () => void { this.listener = listener; return () => { this.listener = undefined } }
  checkForUpdates(): Promise<unknown> { return this.check() }
  createCancellationToken(): ApplicationUpdateCancellationToken { this.token = new FakeToken(); return this.token }
  downloadUpdate(token: ApplicationUpdateCancellationToken): Promise<unknown> { return this.download(token) }
  quitAndInstall(): void { this.installed = true }
  emit(event: ApplicationUpdaterEvent): void { this.listener?.(event) }
}

const logger: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function service(updater = new FakeUpdater(), settings = new MemorySettings()) {
  return { updater, settings, value: new ApplicationUpdateService({ currentVersion: '0.4.5', supported: true, updater, settings, logger }) }
}

describe('ApplicationUpdateService', () => {
  it('reports the current version and keeps automatic downloads disabled', () => {
    const { updater, value } = service()
    expect(value.getState()).toMatchObject({ currentVersion: '0.4.5', automaticCheckEnabled: true, automaticDownloadEnabled: false, status: 'idle' })
    expect(updater.configured).toEqual({ autoDownload: false, autoInstallOnAppQuit: false })
  })

  it('moves through checking, available and downloaded states with normalized metadata', async () => {
    const { updater, value } = service()
    updater.check.mockImplementation(async () => {
      updater.emit({ type: 'available', info: { version: '0.5.0', releaseName: 'Next', releaseNotes: [{ version: '0.5.0', note: '<b>改进</b>' }] } })
    })
    await expect(value.checkForUpdates()).resolves.toMatchObject({ ok: true })
    expect(value.getState()).toMatchObject({ status: 'available', availableVersion: '0.5.0', releaseNotes: '0.5.0\n改进' })
    updater.download.mockImplementation(async () => {
      updater.emit({ type: 'progress', progress: { percent: 42, transferred: 42, total: 100, bytesPerSecond: 10 } })
      updater.emit({ type: 'downloaded', info: { version: '0.5.0' } })
    })
    await value.downloadUpdate()
    expect(value.getState()).toMatchObject({ status: 'downloaded', availableVersion: '0.5.0' })
  })

  it('handles update failures without exposing raw technical details', async () => {
    const { updater, value } = service()
    updater.check.mockRejectedValue(new Error('Authorization: Bearer very-secret ENOTFOUND'))
    await expect(value.checkForUpdates()).resolves.toMatchObject({ ok: false, error: { code: 'UPDATE_CHECK_FAILED' } })
    expect(JSON.stringify(value.getState())).not.toContain('very-secret')
    expect(value.getState().messageZh).toContain('GitHub Releases')
  })

  it('cancels an in-progress user download and keeps the update available', async () => {
    const { updater, value } = service()
    updater.emit({ type: 'available', info: { version: '0.5.0' } })
    updater.download.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1)))
    const download = value.downloadUpdate()
    expect(value.cancelDownload()).toMatchObject({ ok: true, value: { status: 'available' } })
    expect(updater.token.cancelled).toBe(true)
    await download
  })

  it('persists the automatic-check preference and skips an automatic check when disabled', async () => {
    const { updater, value } = service()
    expect(value.setPreferences({ automaticCheckEnabled: false })).toMatchObject({ ok: true })
    await value.checkForUpdates({ automatic: true })
    expect(updater.check).not.toHaveBeenCalled()
  })

  it('installs only after download completion and runs the shutdown preparation hook', async () => {
    const updater = new FakeUpdater()
    const beforeInstall = vi.fn(async () => undefined)
    const value = new ApplicationUpdateService({ currentVersion: '0.4.5', supported: true, updater, settings: new MemorySettings(), logger, beforeInstall })
    updater.emit({ type: 'downloaded', info: { version: '0.5.0' } })
    await expect(value.installUpdate()).resolves.toMatchObject({ ok: true })
    expect(beforeInstall).toHaveBeenCalledOnce()
    expect(updater.installed).toBe(true)
  })
})

describe('release metadata parsing', () => {
  it('flattens array notes and strips embedded HTML', () => {
    expect(normalizeReleaseNotes([{ version: '0.5.0', note: '<script>bad()</script><b>新功能</b>' }])).toBe('0.5.0\nbad()新功能')
  })
})
