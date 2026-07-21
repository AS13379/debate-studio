import type { LoggerLike } from '../observability'
import type { SettingsRepository } from '../persistence'
import type {
  ApplicationUpdateErrorDto,
  ApplicationUpdateResultDto,
  ApplicationUpdateStateDto,
  CommunityUpdateInfo
} from '../shared/update-dtos'

const UPDATE_PREFERENCES_KEY = 'application.update.preferences'

export interface ApplicationUpdatePreferences {
  automaticCheckEnabled: boolean
  automaticDownloadEnabled: boolean
}

export interface CommunityUpdatePlatform {
  check(): Promise<CommunityUpdateInfo | undefined>
  download(info: CommunityUpdateInfo, signal: AbortSignal, onProgress: (progress: { transferredBytes: number; totalBytes: number; bytesPerSecond: number }) => void): Promise<void>
  prepareInstall(): Promise<void>
  launchInstaller(): Promise<void>
  showDownloadedUpdateInFinder(): Promise<void>
  openLatestRelease(): Promise<void>
  clearCache(): Promise<void>
  cacheSize(): Promise<number>
  readStartupResult(): Promise<{ type: 'updated' | 'rolled-back' | 'interrupted'; version?: string; messageZh: string } | undefined>
}

export interface ApplicationUpdateServiceOptions {
  currentVersion: string
  supported: boolean
  settings: SettingsRepository
  platform?: CommunityUpdatePlatform
  logger: LoggerLike
  now?: () => Date
  beforeInstall?: () => Promise<void>
}

export type ApplicationUpdateListener = (state: ApplicationUpdateStateDto) => void

export class ApplicationUpdateService {
  private state: ApplicationUpdateStateDto
  private readonly listeners = new Set<ApplicationUpdateListener>()
  private readonly now: () => Date
  private downloadAbort?: AbortController
  private checkedInfo?: CommunityUpdateInfo
  private closed = false

  constructor(private readonly options: ApplicationUpdateServiceOptions) {
    this.now = options.now ?? (() => new Date())
    const stored = options.settings.get<Partial<ApplicationUpdatePreferences>>(UPDATE_PREFERENCES_KEY)
    this.state = {
      currentVersion: options.currentVersion,
      supported: options.supported && Boolean(options.platform),
      automaticCheckEnabled: stored.ok ? stored.value?.automaticCheckEnabled !== false : true,
      automaticDownloadEnabled: stored.ok ? stored.value?.automaticDownloadEnabled === true : false,
      status: 'idle',
      messageZh: '尚未检查更新。',
      verificationStatus: 'not-verified',
      manualInstallAvailable: true,
      cacheSizeBytes: 0
    }
  }

  async initialize(): Promise<void> {
    if (!this.options.platform) return
    try {
      const [result, cacheSizeBytes] = await Promise.all([this.options.platform.readStartupResult(), this.options.platform.cacheSize()])
      if (result?.type === 'updated') this.updateState({ status: 'up-to-date', messageZh: result.messageZh, cacheSizeBytes })
      else if (result?.type === 'rolled-back') this.updateState({ status: 'rolled-back', messageZh: result.messageZh, cacheSizeBytes, error: updateError('UPDATE_ROLLED_BACK', '更新已回滚', result.messageZh, true) })
      else if (result?.type === 'interrupted') this.updateState({ status: 'install-failed', messageZh: result.messageZh, cacheSizeBytes, error: updateError('UPDATE_INSTALL_INTERRUPTED', '上次安装未完成', result.messageZh, true) })
      else this.updateState({ cacheSizeBytes })
    } catch {
      this.options.logger.warn('读取社区更新恢复状态失败', { source: 'application-update' })
    }
  }

  getState(): ApplicationUpdateStateDto { return cloneState(this.state) }
  subscribe(listener: ApplicationUpdateListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async checkForUpdates(input: { automatic?: boolean } = {}): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (this.closed) return this.failure('UPDATE_SERVICE_CLOSED', '更新服务已关闭', '应用正在退出，无法继续检查更新。', false)
    if (input.automatic && !this.state.automaticCheckEnabled) return { ok: true, value: this.getState() }
    if (!this.state.supported || !this.options.platform) {
      if (input.automatic) return { ok: true, value: this.getState() }
      return this.setFailure('UPDATE_UNAVAILABLE_IN_DEVELOPMENT', '当前环境无法检查更新', '请在已安装的 macOS arm64 应用中使用社区更新。', false)
    }
    this.updateState({ status: 'checking', messageZh: '正在检查 GitHub Releases…', error: undefined, progress: undefined })
    try {
      const info = await this.options.platform.check()
      this.checkedInfo = info
      if (!info) {
        this.updateState({ status: 'up-to-date', messageZh: '当前已是最新版本。', lastCheckedAt: this.now().toISOString(), availableVersion: undefined, error: undefined })
      } else {
        this.updateState({ status: 'available', messageZh: `发现新版本 v${info.version}。`, availableVersion: info.version, releaseName: info.releaseName, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate, updatePackageSizeBytes: info.size, lastCheckedAt: this.now().toISOString(), error: undefined })
        if (this.state.automaticDownloadEnabled) return this.downloadUpdate()
      }
      return { ok: true, value: this.getState() }
    } catch (cause) {
      return this.failFrom('UPDATE_CHECK_FAILED', '检查更新失败', cause, true)
    }
  }

  setPreferences(input: ApplicationUpdatePreferences): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const saved = this.options.settings.set(UPDATE_PREFERENCES_KEY, input)
    if (!saved.ok) return this.setFailure('UPDATE_PREFERENCES_SAVE_FAILED', '保存更新设置失败', '无法保存自动检查更新偏好，请稍后重试。', true)
    this.updateState({ automaticCheckEnabled: input.automaticCheckEnabled, automaticDownloadEnabled: input.automaticDownloadEnabled })
    return { ok: true, value: this.getState() }
  }

  async downloadUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform || !this.checkedInfo || (this.state.status !== 'available' && this.state.status !== 'error')) return this.failure('UPDATE_NOT_AVAILABLE', '没有可下载的更新', '请先检查更新。', false)
    const controller = new AbortController()
    this.downloadAbort = controller
    const startedAt = Date.now()
    this.updateState({ status: 'downloading', messageZh: '正在下载项目签名更新包…', verificationStatus: 'not-verified', progress: { percent: 0, transferredBytes: 0, totalBytes: this.checkedInfo.size, bytesPerSecond: 0 }, error: undefined })
    try {
      await this.options.platform.download(this.checkedInfo, controller.signal, ({ transferredBytes, totalBytes, bytesPerSecond }) => {
        const percent = totalBytes > 0 ? Math.min(100, transferredBytes / totalBytes * 100) : 0
        this.updateState({ progress: { percent, transferredBytes, totalBytes, bytesPerSecond: bytesPerSecond || transferredBytes / Math.max(1, (Date.now() - startedAt) / 1000) }, messageZh: `正在下载项目签名更新包（${percent.toFixed(1)}%）…` })
      })
      this.updateState({ status: 'downloaded', messageZh: '更新包已完成签名、哈希和应用身份校验。', verificationStatus: 'verified', progress: undefined, cacheSizeBytes: await this.options.platform.cacheSize() })
      return { ok: true, value: this.getState() }
    } catch (cause) {
      if (controller.signal.aborted) {
        this.updateState({ status: 'available', messageZh: '已取消下载，可以稍后重新开始。', progress: undefined })
        return { ok: true, value: this.getState() }
      }
      const cacheSizeBytes = await this.options.platform.cacheSize().catch(() => this.state.cacheSizeBytes)
      return this.failFrom('UPDATE_DOWNLOAD_FAILED', '下载或校验更新失败', cause, true, 'error', { cacheSizeBytes, verificationStatus: 'failed' })
    } finally { this.downloadAbort = undefined }
  }

  cancelDownload(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> { this.downloadAbort?.abort(); return { ok: true, value: this.getState() } }
  deferUpdate(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> { if (this.state.status === 'available') this.updateState({ messageZh: '已稍后提醒；下次启动仍会检查更新。' }); return { ok: true, value: this.getState() } }

  async installUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform || (this.state.status !== 'downloaded' && this.state.status !== 'install-failed' && this.state.status !== 'rolled-back')) return this.failure('UPDATE_NOT_READY', '更新尚未准备完成', '请等待下载和安全校验完成。', false)
    this.updateState({ status: 'preparing-install', messageZh: '正在验证更新并准备退出…', error: undefined })
    try {
      await this.options.platform.prepareInstall()
      this.updateState({ status: 'waiting-for-restart', messageZh: '校验完成，即将退出并安装新版本。' })
      await Promise.race([
        (async () => { await this.options.beforeInstall?.(); await this.options.platform!.launchInstaller() })(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('INSTALL_START_TIMEOUT')), 5_000))
      ])
      return { ok: true, value: this.getState() }
    } catch (cause) {
      return this.failFrom('UPDATE_INSTALL_PREPARE_FAILED', '无法开始安装', cause, true, 'install-failed')
    }
  }

  retryUpdateInstall(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> { return this.installUpdate() }
  async showDownloadedUpdateInFinder(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> { return this.platformAction(() => this.options.platform!.showDownloadedUpdateInFinder(), 'UPDATE_REVEAL_FAILED', '无法在 Finder 中显示更新包') }
  async openLatestRelease(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> { return this.platformAction(() => this.options.platform!.openLatestRelease(), 'UPDATE_RELEASE_OPEN_FAILED', '无法打开 GitHub Release') }
  async clearCache(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    const result = await this.platformAction(() => this.options.platform!.clearCache(), 'UPDATE_CACHE_CLEAR_FAILED', '清理更新缓存失败')
    if (result.ok) this.updateState({ cacheSizeBytes: 0, verificationStatus: 'not-verified', status: 'idle', messageZh: '更新缓存已清理。' })
    return result.ok ? { ok: true, value: this.getState() } : result
  }

  close(): void { this.closed = true; this.downloadAbort?.abort(); this.listeners.clear() }

  private async platformAction(action: () => Promise<void>, code: string, title: string): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform) return this.failure(code, title, '当前环境不支持此操作。', false)
    try { await action(); return { ok: true, value: this.getState() } } catch (cause) { return this.failFrom(code, title, cause, true) }
  }
  private updateState(patch: Partial<ApplicationUpdateStateDto>): void { this.state = { ...this.state, ...patch }; const snapshot = this.getState(); for (const listener of this.listeners) listener(snapshot) }
  private failFrom(code: string, title: string, cause: unknown, retryable: boolean, status: ApplicationUpdateStateDto['status'] = 'error', patch: Partial<ApplicationUpdateStateDto> = {}): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const detailCode = safeUpdateFailureCode(cause)
    this.options.logger.warn(title, { source: 'application-update', metadata: { code, detailCode } })
    const description = friendlyUpdateError(cause)
    const error = updateError(code, title, description, retryable, detailCode)
    this.updateState({ status, messageZh: description, error, progress: undefined, ...patch })
    return { ok: false, error }
  }
  private setFailure(code: string, title: string, description: string, retryable: boolean): ApplicationUpdateResultDto<ApplicationUpdateStateDto> { const error = updateError(code, title, description, retryable); this.updateState({ status: 'error', messageZh: description, error, progress: undefined }); return { ok: false, error } }
  private failure(code: string, title: string, description: string, retryable: boolean): ApplicationUpdateResultDto<ApplicationUpdateStateDto> { return { ok: false, error: updateError(code, title, description, retryable) } }
}

function updateError(code: string, titleZh: string, descriptionZh: string, retryable: boolean, detailCode?: string): ApplicationUpdateErrorDto { return { code, titleZh, descriptionZh, retryable, detailCode } }
function safeUpdateFailureCode(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  return message.match(/[A-Z][A-Z0-9_]{2,80}/)?.[0] ?? 'UNKNOWN_UPDATE_ERROR'
}
function friendlyUpdateError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  if (/ENOTFOUND|fetch|network/i.test(message)) return '无法连接 GitHub Releases，请检查网络后重试。'
  if (/SIGNATURE/i.test(message)) return '更新包签名无效，已停止安装；可以改用 GitHub Release 中的 DMG。'
  if (/HASH|SIZE/i.test(message)) return '更新包大小或 SHA256 不一致，已停止安装；请重新下载。'
  if (/ARCHIVE_PATH|ARCHIVE_SYMLINK/i.test(message)) return '更新包包含不安全路径，已停止安装；现有应用没有被修改。'
  if (/ARCHIVE_LIST|ARCHIVE_EXTRACT|ARCHIVE_TREE/i.test(message)) return '更新包已下载，但无法完整解压或校验目录；可以在 Finder 中查看缓存包或重新下载。'
  if (/APP_BUNDLE|BUNDLE_ID|BUNDLE_VERSION|PLIST/i.test(message)) return '更新包已下载，但应用身份或版本校验未通过；可以在 Finder 中查看缓存包或改用 DMG。'
  if (/READ_ONLY|NOT_WRITABLE|DMG/i.test(message)) return '当前应用位置不可写，请打开最新版 DMG 手动覆盖安装。'
  if (/TIMEOUT/i.test(message)) return '安装准备超时，应用没有退出，已恢复按钮供重试。'
  return `更新包处理在 ${safeUpdateFailureCode(cause)} 步骤失败；现有应用和本地数据没有被修改。`
}
function cloneState(state: ApplicationUpdateStateDto): ApplicationUpdateStateDto { return { ...state, progress: state.progress ? { ...state.progress } : undefined, error: state.error ? { ...state.error } : undefined } }

export function normalizeReleaseNotes(notes: string | Array<{ version?: string; note?: string }> | undefined): string | undefined {
  const text = typeof notes === 'string' ? notes : notes?.map((item) => [item.version, item.note].filter(Boolean).join('\n')).join('\n\n')
  const normalized = text?.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, 12_000) : undefined
}
