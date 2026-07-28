import type { LoggerLike } from '../observability'
import type { SettingsRepository } from '../persistence'
import type {
  ApplicationUpdateErrorDto,
  ApplicationUpdateResultDto,
  ApplicationUpdateStateDto
} from '../shared/update-dtos'
import type {
  ApplicationUpdateController,
  ApplicationUpdateListener,
  ApplicationUpdatePreferences
} from './application-update-service'

const UPDATE_PREFERENCES_KEY = 'application.update.preferences'
const LAST_RUN_VERSION_KEY = 'application.update.last-run-version'

export interface SparkleNativeState {
  status: string
  error: string
  updateVersion: string
  expectedDownloadBytes: number
  receivedDownloadBytes: number
  downloadProgress: number
  sessionInProgress: boolean
}

export interface SparkleUpdatePlatform {
  initialize(): boolean
  getState(): SparkleNativeState
  subscribe(listener: (state: SparkleNativeState) => void): () => void
  checkForUpdates(automatic: boolean): void
  installUpdateNow(): void
  cancelUpdate(): void
  setAutomaticChecks(enabled: boolean): void
  setAutomaticDownloads(enabled: boolean): void
  openLatestRelease(): Promise<void>
  close(): void
}

export interface SparkleApplicationUpdateServiceOptions {
  currentVersion: string
  supported: boolean
  settings: SettingsRepository
  platform?: SparkleUpdatePlatform
  logger: LoggerLike
}

export class SparkleApplicationUpdateService implements ApplicationUpdateController {
  private state: ApplicationUpdateStateDto
  private readonly listeners = new Set<ApplicationUpdateListener>()
  private disposePlatform?: () => void
  private closed = false

  constructor(private readonly options: SparkleApplicationUpdateServiceOptions) {
    const stored = options.settings.get<Partial<ApplicationUpdatePreferences>>(UPDATE_PREFERENCES_KEY)
    this.state = {
      currentVersion: options.currentVersion,
      supported: options.supported && Boolean(options.platform),
      automaticCheckEnabled: stored.ok ? stored.value?.automaticCheckEnabled !== false : true,
      automaticDownloadEnabled: stored.ok ? stored.value?.automaticDownloadEnabled === true : false,
      status: 'idle',
      messageZh: '尚未检查更新。',
      verificationStatus: 'not-verified',
      manualInstallAvailable: false,
      installationMode: 'sparkle',
      cacheSizeBytes: 0
    }
  }

  async initialize(): Promise<void> {
    if (!this.options.platform || !this.state.supported) return
    try {
      if (!this.options.platform.initialize()) throw new Error('SPARKLE_INITIALIZATION_FAILED')
      this.options.platform.setAutomaticChecks(this.state.automaticCheckEnabled)
      this.options.platform.setAutomaticDownloads(this.state.automaticDownloadEnabled)
      this.disposePlatform = this.options.platform.subscribe((state) => this.applyNativeState(state))
      const previous = this.options.settings.get<string>(LAST_RUN_VERSION_KEY)
      const upgraded = previous.ok && typeof previous.value === 'string' && previous.value !== this.options.currentVersion
      this.options.settings.set(LAST_RUN_VERSION_KEY, this.options.currentVersion)
      if (upgraded) this.update({ status: 'up-to-date', messageZh: `Debate Studio 已更新至 v${this.options.currentVersion}。` })
    } catch (cause) {
      this.fail('SPARKLE_INITIALIZATION_FAILED', 'Sparkle 初始化失败', cause)
    }
  }

  getState(): ApplicationUpdateStateDto {
    return {
      ...this.state,
      progress: this.state.progress ? { ...this.state.progress } : undefined,
      error: this.state.error ? { ...this.state.error } : undefined
    }
  }

  subscribe(listener: ApplicationUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async checkForUpdates(input: { automatic?: boolean } = {}): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (this.closed) return failure('UPDATE_SERVICE_CLOSED', '更新服务已关闭', '应用正在退出。', false)
    if (input.automatic && !this.state.automaticCheckEnabled) return { ok: true, value: this.getState() }
    if (!this.options.platform || !this.state.supported) {
      if (input.automatic) return { ok: true, value: this.getState() }
      return this.fail('SPARKLE_UNAVAILABLE', '当前环境无法检查更新', 'Sparkle 仅在正式 macOS 安装包中启用。')
    }
    this.update({ status: 'checking', messageZh: '正在通过 Sparkle 检查更新…', error: undefined })
    this.options.platform.checkForUpdates(Boolean(input.automatic))
    return { ok: true, value: this.getState() }
  }

  setPreferences(input: ApplicationUpdatePreferences): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const saved = this.options.settings.set(UPDATE_PREFERENCES_KEY, input)
    if (!saved.ok) return this.fail('UPDATE_PREFERENCES_SAVE_FAILED', '保存更新设置失败', '无法保存更新偏好。')
    this.options.platform?.setAutomaticChecks(input.automaticCheckEnabled)
    this.options.platform?.setAutomaticDownloads(input.automaticDownloadEnabled)
    this.update(input)
    return { ok: true, value: this.getState() }
  }

  async downloadUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform) return failure('SPARKLE_UNAVAILABLE', 'Sparkle 不可用', '当前环境无法下载更新。', false)
    this.options.platform.checkForUpdates(false)
    this.update({ messageZh: 'Sparkle 已打开更新流程；确认后将安全下载并验证更新。' })
    return { ok: true, value: this.getState() }
  }

  cancelDownload(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    this.options.platform?.cancelUpdate()
    this.update({ status: 'available', messageZh: '已取消本次更新，可以稍后重新检查。', progress: undefined })
    return { ok: true, value: this.getState() }
  }

  deferUpdate(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    this.update({ messageZh: '已稍后提醒；Sparkle 不会在本次运行中强制安装。' })
    return { ok: true, value: this.getState() }
  }

  async openDownloadedUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform) return failure('SPARKLE_UNAVAILABLE', 'Sparkle 不可用', '当前环境无法安装更新。', false)
    this.options.platform.installUpdateNow()
    this.update({ status: 'installing', messageZh: 'Sparkle 正在准备退出、替换应用并自动重新启动。' })
    return { ok: true, value: this.getState() }
  }

  async showDownloadedUpdateInFinder(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    return failure('SPARKLE_MANAGES_DOWNLOAD', '下载由 Sparkle 管理', 'Sparkle 会管理并验证临时更新文件。', false)
  }

  async deleteDownloadedUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    this.options.platform?.cancelUpdate()
    return { ok: true, value: this.getState() }
  }

  async openLatestRelease(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform) return failure('SPARKLE_UNAVAILABLE', '无法打开 Release', '当前环境不支持此操作。', false)
    try {
      await this.options.platform.openLatestRelease()
      return { ok: true, value: this.getState() }
    } catch (cause) {
      return this.fail('UPDATE_RELEASE_OPEN_FAILED', '无法打开 GitHub Release', cause)
    }
  }

  async clearCache(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    return { ok: true, value: this.getState() }
  }

  close(): void {
    this.closed = true
    this.disposePlatform?.()
    this.options.platform?.close()
    this.listeners.clear()
  }

  private applyNativeState(native: SparkleNativeState): void {
    const total = native.expectedDownloadBytes
    const received = native.receivedDownloadBytes
    const availableVersion = native.updateVersion || this.state.availableVersion
    if (native.status === 'checking') this.update({ status: 'checking', messageZh: '正在通过 Sparkle 检查更新…' })
    else if (native.status === 'update-found') this.update({ status: 'available', availableVersion, messageZh: `发现新版本${availableVersion ? ` v${availableVersion}` : ''}，请在 Sparkle 窗口中确认。`, error: undefined })
    else if (native.status === 'downloading') this.update({
      status: 'downloading',
      availableVersion,
      messageZh: `Sparkle 正在下载并验证更新（${(native.downloadProgress * 100).toFixed(1)}%）…`,
      progress: { percent: native.downloadProgress * 100, transferredBytes: received, totalBytes: total, bytesPerSecond: 0 }
    })
    else if (native.status === 'downloaded' || native.status === 'extracting') this.update({ status: 'downloaded', availableVersion, messageZh: '更新已下载，Sparkle 正在校验并准备安装。', verificationStatus: 'verifying', progress: undefined })
    else if (native.status === 'ready-to-install') this.update({ status: 'ready-to-install', availableVersion, messageZh: '更新已通过验证，可以安装并重新启动。', verificationStatus: 'verified', progress: undefined })
    else if (native.status === 'installing') this.update({ status: 'installing', messageZh: 'Sparkle 正在替换应用并准备重新启动。', verificationStatus: 'verified' })
    else if (native.status === 'not-found') this.update({ status: 'up-to-date', messageZh: '当前已是最新版本。', progress: undefined })
    else if (native.status === 'cancelled' || native.status === 'aborted') this.update({ status: 'idle', messageZh: '更新已取消。', progress: undefined })
    else if (['error', 'download-error', 'start-error', 'exception'].includes(native.status)) this.fail('SPARKLE_UPDATE_FAILED', 'Sparkle 更新失败', native.error || native.status)
  }

  private update(patch: Partial<ApplicationUpdateStateDto>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }

  private fail(code: string, title: string, cause: unknown): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const detail = cause instanceof Error ? cause.message : String(cause)
    const error = updateError(code, title, `Sparkle 未能完成当前操作：${detail.slice(0, 400)}`, true)
    this.options.logger.warn(title, { source: 'application-update', metadata: { code } })
    this.update({ status: 'error', messageZh: error.descriptionZh, error, progress: undefined })
    return { ok: false, error }
  }
}

function updateError(code: string, titleZh: string, descriptionZh: string, retryable: boolean): ApplicationUpdateErrorDto {
  return { code, titleZh, descriptionZh, retryable }
}

function failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
  return { ok: false, error: updateError(code, titleZh, descriptionZh, retryable) }
}
