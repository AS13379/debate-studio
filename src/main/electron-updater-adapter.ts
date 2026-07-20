import { CancellationToken, type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

import type {
  ApplicationUpdateCancellationToken,
  ApplicationUpdaterEvent,
  ApplicationUpdaterPort
} from '../application'

class ElectronCancellationToken implements ApplicationUpdateCancellationToken {
  constructor(readonly nativeToken: CancellationToken) {}
  cancel(): void { this.nativeToken.cancel() }
}

export class ElectronApplicationUpdaterAdapter implements ApplicationUpdaterPort {
  constructor(private readonly updater: AppUpdater) {}

  configure(options: { autoDownload: false; autoInstallOnAppQuit: false }): void {
    this.updater.autoDownload = options.autoDownload
    this.updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit
  }

  subscribe(listener: (event: ApplicationUpdaterEvent) => void): () => void {
    const checking = (): void => listener({ type: 'checking' })
    const available = (info: UpdateInfo): void => listener({ type: 'available', info: mapInfo(info) })
    const notAvailable = (info: UpdateInfo): void => listener({ type: 'not-available', info: mapInfo(info) })
    const progress = (value: ProgressInfo): void => listener({ type: 'progress', progress: value })
    const downloaded = (info: UpdateInfo): void => listener({ type: 'downloaded', info: mapInfo(info) })
    const cancelled = (): void => listener({ type: 'cancelled' })
    const error = (cause: Error): void => listener({ type: 'error', error: cause })
    this.updater.on('checking-for-update', checking)
    this.updater.on('update-available', available)
    this.updater.on('update-not-available', notAvailable)
    this.updater.on('download-progress', progress)
    this.updater.on('update-downloaded', downloaded)
    this.updater.on('update-cancelled', cancelled)
    this.updater.on('error', error)
    return () => {
      this.updater.removeListener('checking-for-update', checking)
      this.updater.removeListener('update-available', available)
      this.updater.removeListener('update-not-available', notAvailable)
      this.updater.removeListener('download-progress', progress)
      this.updater.removeListener('update-downloaded', downloaded)
      this.updater.removeListener('update-cancelled', cancelled)
      this.updater.removeListener('error', error)
    }
  }

  checkForUpdates(): Promise<unknown> {
    return this.updater.checkForUpdates()
  }

  createCancellationToken(): ApplicationUpdateCancellationToken {
    return new ElectronCancellationToken(new CancellationToken())
  }

  downloadUpdate(token: ApplicationUpdateCancellationToken): Promise<unknown> {
    if (!(token instanceof ElectronCancellationToken)) throw new Error('Invalid update cancellation token')
    return this.updater.downloadUpdate(token.nativeToken)
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall(false, true)
  }
}

function mapInfo(info: UpdateInfo) {
  return {
    version: info.version,
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
    releaseNotes: typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : info.releaseNotes?.map((item) => ({ version: item.version, note: item.note ?? undefined })),
    releaseDate: info.releaseDate
  }
}
