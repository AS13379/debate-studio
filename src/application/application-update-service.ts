import type { LoggerLike } from '../observability'
import type { SettingsRepository } from '../persistence'
import type {
  ApplicationUpdateInfo,
  ApplicationUpdateResultDto,
  ApplicationUpdateStateDto
} from '../shared/update-dtos'

const UPDATE_PREFERENCES_KEY = 'application.update.preferences'
const MAX_RELEASE_NOTES_LENGTH = 12_000

export interface ApplicationUpdatePreferences {
  automaticCheckEnabled: boolean
}

export interface ApplicationUpdateCancellationToken {
  cancel(): void
}

export type ApplicationUpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; info: ApplicationUpdateInfo }
  | { type: 'not-available'; info?: ApplicationUpdateInfo }
  | { type: 'progress'; progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } }
  | { type: 'downloaded'; info: ApplicationUpdateInfo }
  | { type: 'cancelled' }
  | { type: 'error'; error: unknown }

export interface ApplicationUpdaterPort {
  configure(options: { autoDownload: false; autoInstallOnAppQuit: false }): void
  subscribe(listener: (event: ApplicationUpdaterEvent) => void): () => void
  checkForUpdates(): Promise<unknown>
  createCancellationToken(): ApplicationUpdateCancellationToken
  downloadUpdate(token: ApplicationUpdateCancellationToken): Promise<unknown>
  quitAndInstall(): void
}

export interface ApplicationUpdateServiceOptions {
  currentVersion: string
  supported: boolean
  settings: SettingsRepository
  updater?: ApplicationUpdaterPort
  logger: LoggerLike
  now?: () => Date
  beforeInstall?: () => Promise<void>
}

export type ApplicationUpdateListener = (state: ApplicationUpdateStateDto) => void

export class ApplicationUpdateService {
  private state: ApplicationUpdateStateDto
  private readonly listeners = new Set<ApplicationUpdateListener>()
  private readonly now: () => Date
  private unsubscribeUpdater: () => void = () => undefined
  private downloadToken?: ApplicationUpdateCancellationToken
  private closed = false

  constructor(private readonly options: ApplicationUpdateServiceOptions) {
    this.now = options.now ?? (() => new Date())
    const stored = options.settings.get<Partial<ApplicationUpdatePreferences>>(UPDATE_PREFERENCES_KEY)
    const automaticCheckEnabled = stored.ok ? stored.value?.automaticCheckEnabled !== false : true
    this.state = {
      currentVersion: options.currentVersion,
      supported: options.supported && Boolean(options.updater),
      automaticCheckEnabled,
      automaticDownloadEnabled: false,
      status: 'idle',
      messageZh: '尚未检查更新。'
    }
    options.updater?.configure({ autoDownload: false, autoInstallOnAppQuit: false })
    if (options.updater) this.unsubscribeUpdater = options.updater.subscribe((event) => this.handleUpdaterEvent(event))
  }

  getState(): ApplicationUpdateStateDto {
    return cloneState(this.state)
  }

  subscribe(listener: ApplicationUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async checkForUpdates(options: { automatic?: boolean } = {}): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (this.closed) return this.failure('UPDATE_SERVICE_CLOSED', '更新服务已关闭', '应用正在退出，无法继续检查更新。', false)
    if (this.state.status === 'checking') return { ok: true, value: this.getState() }
    if (options.automatic && !this.state.automaticCheckEnabled) return { ok: true, value: this.getState() }
    if (!this.state.supported || !this.options.updater) {
      if (options.automatic) return { ok: true, value: this.getState() }
      return this.setFailure('UPDATE_UNAVAILABLE_IN_DEVELOPMENT', '当前环境无法检查更新', '请在已安装的 macOS 应用中使用自动更新。', false)
    }
    this.updateState({ status: 'checking', messageZh: '正在检查 GitHub Releases…', error: undefined, progress: undefined })
    try {
      await this.options.updater.checkForUpdates()
      return { ok: true, value: this.getState() }
    } catch (cause) {
      this.options.logger.warn('应用更新检查失败', { source: 'application-update', metadata: { code: 'UPDATE_CHECK_FAILED' } })
      return this.setFailure('UPDATE_CHECK_FAILED', '检查更新失败', friendlyUpdateError(cause), true)
    }
  }

  setPreferences(input: ApplicationUpdatePreferences): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const saved = this.options.settings.set(UPDATE_PREFERENCES_KEY, input)
    if (!saved.ok) return this.setFailure('UPDATE_PREFERENCES_SAVE_FAILED', '保存更新设置失败', '无法保存自动检查更新偏好，请稍后重试。', true)
    this.updateState({ automaticCheckEnabled: input.automaticCheckEnabled })
    return { ok: true, value: this.getState() }
  }

  async downloadUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.updater || !this.state.supported || !this.state.availableVersion) {
      return this.failure('UPDATE_NOT_AVAILABLE', '没有可下载的更新', '请先检查更新，确认存在新版本后再下载。', false)
    }
    if (this.state.status === 'downloading') return { ok: true, value: this.getState() }
    this.downloadToken = this.options.updater.createCancellationToken()
    this.updateState({ status: 'downloading', messageZh: '正在下载更新…', progress: { percent: 0, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 }, error: undefined })
    try {
      await this.options.updater.downloadUpdate(this.downloadToken)
      return { ok: true, value: this.getState() }
    } catch (cause) {
      if (this.state.status === 'available' && this.state.messageZh === '已取消下载，可以稍后重新开始。') {
        return { ok: true, value: this.getState() }
      }
      this.options.logger.warn('应用更新下载失败', { source: 'application-update', metadata: { code: 'UPDATE_DOWNLOAD_FAILED' } })
      return this.setFailure('UPDATE_DOWNLOAD_FAILED', '下载更新失败', friendlyUpdateError(cause), true)
    } finally {
      this.downloadToken = undefined
    }
  }

  cancelDownload(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    if (!this.downloadToken || this.state.status !== 'downloading') return { ok: true, value: this.getState() }
    this.downloadToken.cancel()
    this.updateState({ status: 'available', messageZh: '已取消下载，可以稍后重新开始。', progress: undefined })
    return { ok: true, value: this.getState() }
  }

  deferUpdate(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    if (this.state.status === 'available') this.updateState({ messageZh: '已稍后提醒；下次启动仍会检查更新。' })
    return { ok: true, value: this.getState() }
  }

  async installUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.updater || this.state.status !== 'downloaded') {
      return this.failure('UPDATE_NOT_READY', '更新尚未准备完成', '请等待下载完成后再重启安装。', false)
    }
    try {
      await this.options.beforeInstall?.()
      this.options.updater.quitAndInstall()
      return { ok: true, value: this.getState() }
    } catch {
      return this.setFailure('UPDATE_INSTALL_PREPARE_FAILED', '无法开始安装', '关闭运行任务或保存本地数据时发生错误，请稍后重试。', true)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.downloadToken?.cancel()
    this.unsubscribeUpdater()
    this.listeners.clear()
  }

  private handleUpdaterEvent(event: ApplicationUpdaterEvent): void {
    if (this.closed) return
    if (event.type === 'checking') {
      this.updateState({ status: 'checking', messageZh: '正在检查 GitHub Releases…', error: undefined })
      return
    }
    if (event.type === 'available') {
      const info = normalizeUpdateInfo(event.info)
      this.updateState({
        ...info,
        status: 'available',
        messageZh: `发现新版本 ${info.availableVersion}。`,
        lastCheckedAt: this.now().toISOString(),
        progress: undefined,
        error: undefined
      })
      return
    }
    if (event.type === 'not-available') {
      this.updateState({ status: 'up-to-date', messageZh: '当前已是最新版本。', lastCheckedAt: this.now().toISOString(), progress: undefined, error: undefined })
      return
    }
    if (event.type === 'progress') {
      this.updateState({
        status: 'downloading',
        messageZh: `正在下载更新（${Math.max(0, Math.min(100, event.progress.percent)).toFixed(1)}%）…`,
        progress: {
          percent: Math.max(0, Math.min(100, event.progress.percent)),
          transferredBytes: Math.max(0, event.progress.transferred),
          totalBytes: Math.max(0, event.progress.total),
          bytesPerSecond: Math.max(0, event.progress.bytesPerSecond)
        }
      })
      return
    }
    if (event.type === 'downloaded') {
      const info = normalizeUpdateInfo(event.info)
      this.updateState({ ...info, status: 'downloaded', messageZh: '更新已准备完成，重启应用安装。', progress: undefined, error: undefined })
      return
    }
    if (event.type === 'cancelled') {
      this.updateState({ status: 'available', messageZh: '已取消下载，可以稍后重新开始。', progress: undefined })
      return
    }
    this.setFailure('UPDATE_OPERATION_FAILED', '更新操作失败', friendlyUpdateError(event.error), true)
  }

  private updateState(patch: Partial<ApplicationUpdateStateDto>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }

  private setFailure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const error = { code, titleZh, descriptionZh, retryable }
    this.updateState({ status: 'error', messageZh: descriptionZh, error, progress: undefined })
    return { ok: false, error }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}

export function normalizeReleaseNotes(notes: ApplicationUpdateInfo['releaseNotes']): string | undefined {
  const text = typeof notes === 'string'
    ? notes
    : notes?.map((item) => [item.version, item.note].filter(Boolean).join('\n')).join('\n\n')
  const normalized = text?.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, MAX_RELEASE_NOTES_LENGTH) : undefined
}

function normalizeUpdateInfo(info: ApplicationUpdateInfo): Pick<ApplicationUpdateStateDto, 'availableVersion' | 'releaseName' | 'releaseNotes' | 'releaseDate'> {
  return {
    availableVersion: info.version,
    releaseName: info.releaseName?.slice(0, 500),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate
  }
}

function friendlyUpdateError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ''
  if (message.includes('network') || message.includes('fetch') || message.includes('enotfound')) return '无法连接 GitHub Releases，请检查网络后重试。'
  if (message.includes('404')) return '暂未找到适用于当前版本的更新文件。'
  return '更新服务暂时不可用，请稍后重试。'
}

function cloneState(state: ApplicationUpdateStateDto): ApplicationUpdateStateDto {
  return {
    ...state,
    progress: state.progress ? { ...state.progress } : undefined,
    error: state.error ? { ...state.error } : undefined
  }
}
