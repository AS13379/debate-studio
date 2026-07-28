import { createRequire } from 'node:module'

import type { SparkleNativeState, SparkleUpdatePlatform } from '../application/sparkle-application-update-service'

interface SparkleBridge {
  init(): boolean
  checkForUpdates(): void
  checkForUpdatesInBackground(): void
  installUpdateNow(): void
  setAutomaticChecks(enabled: boolean): void
  setAutomaticDownloads(enabled: boolean): void
  cancelUpdate(): void
  getState(): SparkleNativeState
}

const loadNative = createRequire(import.meta.url)

export class MacSparkleUpdatePlatform implements SparkleUpdatePlatform {
  private bridge?: SparkleBridge
  private timer?: ReturnType<typeof setInterval>
  private readonly listeners = new Set<(state: SparkleNativeState) => void>()
  private lastSerialized = ''

  constructor(
    private readonly bridgePath: string,
    private readonly openRelease: () => Promise<void>
  ) {}

  initialize(): boolean {
    this.bridge ??= loadNative(this.bridgePath) as SparkleBridge
    const initialized = this.bridge.init()
    if (initialized && !this.timer) {
      this.timer = setInterval(() => this.poll(), 200)
      this.poll()
    }
    return initialized
  }

  getState(): SparkleNativeState {
    if (!this.bridge) throw new Error('SPARKLE_NOT_INITIALIZED')
    return this.bridge.getState()
  }

  subscribe(listener: (state: SparkleNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  checkForUpdates(automatic: boolean): void {
    if (!this.bridge) throw new Error('SPARKLE_NOT_INITIALIZED')
    if (automatic) this.bridge.checkForUpdatesInBackground()
    else this.bridge.checkForUpdates()
  }

  installUpdateNow(): void { this.bridge?.installUpdateNow() }
  cancelUpdate(): void { this.bridge?.cancelUpdate() }
  setAutomaticChecks(enabled: boolean): void { this.bridge?.setAutomaticChecks(enabled) }
  setAutomaticDownloads(enabled: boolean): void { this.bridge?.setAutomaticDownloads(enabled) }
  openLatestRelease(): Promise<void> { return this.openRelease() }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.listeners.clear()
  }

  private poll(): void {
    if (!this.bridge) return
    const state = this.bridge.getState()
    const serialized = JSON.stringify(state)
    if (serialized === this.lastSerialized) return
    this.lastSerialized = serialized
    for (const listener of this.listeners) listener({ ...state })
  }
}
