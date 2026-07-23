import type { LoggerLike } from '../observability'
import type { SettingsRepository } from '../persistence'
import type {
  ApplicationUpdateErrorDto,
  ApplicationUpdateResultDto,
  ApplicationUpdateStateDto,
  DmgUpdateInfo
} from '../shared/update-dtos'

const UPDATE_PREFERENCES_KEY = 'application.update.preferences'
const LAST_RUN_VERSION_KEY = 'application.update.last-run-version'

export interface ApplicationUpdatePreferences {
  automaticCheckEnabled: boolean
  automaticDownloadEnabled: boolean
}

export interface DmgUpdatePlatform {
  check(): Promise<DmgUpdateInfo | undefined>
  download(
    info: DmgUpdateInfo,
    signal: AbortSignal,
    onProgress: (progress: {
      transferredBytes: number
      totalBytes: number
      bytesPerSecond: number
    }) => void
  ): Promise<void>
  openDownloadedUpdate(): Promise<void>
  showDownloadedUpdateInFinder(): Promise<void>
  deleteDownloadedUpdate(): Promise<void>
  openLatestRelease(): Promise<void>
  clearCache(): Promise<void>
  cacheSize(): Promise<number>
}

export interface ApplicationUpdateServiceOptions {
  currentVersion: string
  supported: boolean
  settings: SettingsRepository
  platform?: DmgUpdatePlatform
  logger: LoggerLike
  now?: () => Date
}

export type ApplicationUpdateListener = (state: ApplicationUpdateStateDto) => void

export class ApplicationUpdateService {
  private state: ApplicationUpdateStateDto
  private readonly listeners = new Set<ApplicationUpdateListener>()
  private readonly now: () => Date
  private downloadAbort?: AbortController
  private checkedInfo?: DmgUpdateInfo
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
      manualInstallAvailable: false,
      cacheSizeBytes: 0
    }
  }

  async initialize(): Promise<void> {
    if (!this.options.platform) return
    try {
      const [cacheSizeBytes, previousVersion] = await Promise.all([
        this.options.platform.cacheSize(),
        Promise.resolve(this.options.settings.get<string>(LAST_RUN_VERSION_KEY))
      ])
      const upgraded = previousVersion.ok
        && typeof previousVersion.value === 'string'
        && isSemver(previousVersion.value)
        && compareSemver(this.options.currentVersion, previousVersion.value) > 0
      const saved = this.options.settings.set(LAST_RUN_VERSION_KEY, this.options.currentVersion)
      if (!saved.ok) {
        this.options.logger.warn('记录当前应用版本失败', { source: 'application-update' })
      }
      this.updateState(upgraded
        ? {
            status: 'up-to-date',
            messageZh: `Debate Studio 已更新至 v${this.options.currentVersion}。`,
            cacheSizeBytes
          }
        : { cacheSizeBytes })
    } catch {
      this.options.logger.warn('读取更新缓存状态失败', { source: 'application-update' })
    }
  }

  getState(): ApplicationUpdateStateDto { return cloneState(this.state) }

  subscribe(listener: ApplicationUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async checkForUpdates(input: { automatic?: boolean } = {}): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (this.closed) return this.failure('UPDATE_SERVICE_CLOSED', '更新服务已关闭', '应用正在退出，无法继续检查更新。', false)
    if (input.automatic && !this.state.automaticCheckEnabled) return { ok: true, value: this.getState() }
    if (!this.state.supported || !this.options.platform) {
      if (input.automatic) return { ok: true, value: this.getState() }
      return this.setFailure(
        'UPDATE_UNAVAILABLE_IN_DEVELOPMENT',
        '当前环境无法检查更新',
        '请在已安装的 macOS arm64 应用中使用更新检查。',
        false
      )
    }
    this.updateState({
      status: 'checking',
      messageZh: '正在检查 GitHub Releases…',
      error: undefined,
      progress: undefined
    })
    try {
      const info = await this.options.platform.check()
      this.checkedInfo = info
      if (!info) {
        this.updateState({
          status: 'up-to-date',
          messageZh: '当前已是最新版本。',
          lastCheckedAt: this.now().toISOString(),
          availableVersion: undefined,
          releaseName: undefined,
          releaseNotes: undefined,
          releaseDate: undefined,
          updatePackageSizeBytes: undefined,
          sha256Available: undefined,
          manualInstallAvailable: false,
          error: undefined
        })
      } else {
        this.updateState({
          status: 'available',
          messageZh: `发现新版本 v${info.version}。`,
          availableVersion: info.version,
          releaseName: info.releaseName,
          releaseNotes: normalizeReleaseNotes(info.releaseNotes),
          releaseDate: info.releaseDate,
          updatePackageSizeBytes: info.size,
          sha256Available: Boolean(info.sha256),
          lastCheckedAt: this.now().toISOString(),
          verificationStatus: 'not-verified',
          manualInstallAvailable: false,
          error: undefined
        })
        if (this.state.automaticDownloadEnabled) return this.downloadUpdate()
      }
      return { ok: true, value: this.getState() }
    } catch (cause) {
      return this.failFrom('UPDATE_CHECK_FAILED', '检查更新失败', cause, true)
    }
  }

  setPreferences(input: ApplicationUpdatePreferences): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const saved = this.options.settings.set(UPDATE_PREFERENCES_KEY, input)
    if (!saved.ok) {
      return this.setFailure(
        'UPDATE_PREFERENCES_SAVE_FAILED',
        '保存更新设置失败',
        '无法保存自动检查更新偏好，请稍后重试。',
        true
      )
    }
    this.updateState({
      automaticCheckEnabled: input.automaticCheckEnabled,
      automaticDownloadEnabled: input.automaticDownloadEnabled
    })
    return { ok: true, value: this.getState() }
  }

  async downloadUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform || !this.checkedInfo || (this.state.status !== 'available' && this.state.status !== 'error')) {
      return this.failure('UPDATE_NOT_AVAILABLE', '没有可下载的更新', '请先检查更新。', false)
    }
    const controller = new AbortController()
    this.downloadAbort = controller
    const startedAt = Date.now()
    this.updateState({
      status: 'downloading',
      messageZh: '正在下载 macOS DMG 安装包…',
      verificationStatus: 'not-verified',
      manualInstallAvailable: false,
      progress: {
        percent: 0,
        transferredBytes: 0,
        totalBytes: this.checkedInfo.size,
        bytesPerSecond: 0
      },
      error: undefined
    })
    try {
      await this.options.platform.download(
        this.checkedInfo,
        controller.signal,
        ({ transferredBytes, totalBytes, bytesPerSecond }) => {
          const percent = totalBytes > 0 ? Math.min(100, transferredBytes / totalBytes * 100) : 0
          this.updateState({
            progress: {
              percent,
              transferredBytes,
              totalBytes,
              bytesPerSecond: bytesPerSecond || transferredBytes / Math.max(1, (Date.now() - startedAt) / 1000)
            },
            messageZh: `正在下载 macOS DMG 安装包（${percent.toFixed(1)}%）…`
          })
        }
      )
      this.updateState({
        status: 'downloaded',
        messageZh: '新版 DMG 已下载并通过文件大小与 SHA-256 校验，请手动覆盖安装。',
        verificationStatus: 'verified',
        manualInstallAvailable: true,
        progress: undefined,
        cacheSizeBytes: await this.options.platform.cacheSize()
      })
      return { ok: true, value: this.getState() }
    } catch (cause) {
      if (controller.signal.aborted) {
        this.updateState({
          status: 'available',
          messageZh: '已取消下载，可以稍后重新开始。',
          progress: undefined,
          manualInstallAvailable: false
        })
        return { ok: true, value: this.getState() }
      }
      const cacheSizeBytes = await this.options.platform.cacheSize().catch(() => this.state.cacheSizeBytes)
      return this.failFrom(
        'UPDATE_DOWNLOAD_FAILED',
        '下载或校验更新失败',
        cause,
        true,
        { cacheSizeBytes, verificationStatus: 'failed', manualInstallAvailable: false }
      )
    } finally {
      this.downloadAbort = undefined
    }
  }

  cancelDownload(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    this.downloadAbort?.abort()
    return { ok: true, value: this.getState() }
  }

  deferUpdate(): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    if (this.state.status === 'available') {
      this.updateState({ messageZh: '已稍后提醒；下次启动仍会检查更新。' })
    } else if (this.state.status === 'downloaded') {
      this.updateState({ messageZh: '安装包会保留在更新缓存中，可以稍后手动安装。' })
    }
    return { ok: true, value: this.getState() }
  }

  async openDownloadedUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform || this.state.status !== 'downloaded') {
      return this.failure('UPDATE_NOT_DOWNLOADED', '安装包尚未下载', '请先下载并校验 DMG。', false)
    }
    const result = await this.platformAction(
      () => this.options.platform!.openDownloadedUpdate(),
      'UPDATE_DMG_OPEN_FAILED',
      '无法打开安装包'
    )
    if (result.ok) {
      this.updateState({
        messageZh: '已交给 macOS 打开 DMG。请将 Debate Studio 拖入 Applications，并选择替换。'
      })
      return { ok: true, value: this.getState() }
    }
    return result
  }

  async showDownloadedUpdateInFinder(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    return this.platformAction(
      () => this.options.platform!.showDownloadedUpdateInFinder(),
      'UPDATE_REVEAL_FAILED',
      '无法在 Finder 中显示安装包'
    )
  }

  async deleteDownloadedUpdate(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    const result = await this.platformAction(
      () => this.options.platform!.deleteDownloadedUpdate(),
      'UPDATE_DELETE_FAILED',
      '删除安装包失败'
    )
    if (!result.ok) return result
    this.updateState({
      status: this.checkedInfo ? 'available' : 'idle',
      messageZh: this.checkedInfo ? `已删除 v${this.checkedInfo.version} 安装包，可以重新下载。` : '已删除安装包。',
      verificationStatus: 'not-verified',
      manualInstallAvailable: false,
      cacheSizeBytes: await this.options.platform!.cacheSize().catch(() => 0)
    })
    return { ok: true, value: this.getState() }
  }

  async openLatestRelease(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    return this.platformAction(
      () => this.options.platform!.openLatestRelease(),
      'UPDATE_RELEASE_OPEN_FAILED',
      '无法打开 GitHub Release'
    )
  }

  async clearCache(): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    const result = await this.platformAction(
      () => this.options.platform!.clearCache(),
      'UPDATE_CACHE_CLEAR_FAILED',
      '清理更新缓存失败'
    )
    if (result.ok) {
      this.updateState({
        cacheSizeBytes: 0,
        verificationStatus: 'not-verified',
        manualInstallAvailable: false,
        status: this.checkedInfo ? 'available' : 'idle',
        messageZh: this.checkedInfo ? `更新缓存已清理，可以重新下载 v${this.checkedInfo.version}。` : '更新缓存已清理。'
      })
    }
    return result.ok ? { ok: true, value: this.getState() } : result
  }

  close(): void {
    this.closed = true
    this.downloadAbort?.abort()
    this.listeners.clear()
  }

  private async platformAction(
    action: () => Promise<void>,
    code: string,
    title: string
  ): Promise<ApplicationUpdateResultDto<ApplicationUpdateStateDto>> {
    if (!this.options.platform) return this.failure(code, title, '当前环境不支持此操作。', false)
    try {
      await action()
      return { ok: true, value: this.getState() }
    } catch (cause) {
      return this.failFrom(code, title, cause, true)
    }
  }

  private updateState(patch: Partial<ApplicationUpdateStateDto>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }

  private failFrom(
    code: string,
    title: string,
    cause: unknown,
    retryable: boolean,
    patch: Partial<ApplicationUpdateStateDto> = {}
  ): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const detailCode = safeUpdateFailureCode(cause)
    this.options.logger.warn(title, { source: 'application-update', metadata: { code, detailCode } })
    const description = friendlyUpdateError(cause)
    const error = updateError(code, title, description, retryable, detailCode)
    this.updateState({ status: 'error', messageZh: description, error, progress: undefined, ...patch })
    return { ok: false, error }
  }

  private setFailure(
    code: string,
    title: string,
    description: string,
    retryable: boolean
  ): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    const error = updateError(code, title, description, retryable)
    this.updateState({ status: 'error', messageZh: description, error, progress: undefined })
    return { ok: false, error }
  }

  private failure(
    code: string,
    title: string,
    description: string,
    retryable: boolean
  ): ApplicationUpdateResultDto<ApplicationUpdateStateDto> {
    return { ok: false, error: updateError(code, title, description, retryable) }
  }
}

function updateError(
  code: string,
  titleZh: string,
  descriptionZh: string,
  retryable: boolean,
  detailCode?: string
): ApplicationUpdateErrorDto {
  return { code, titleZh, descriptionZh, retryable, detailCode }
}

function safeUpdateFailureCode(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  return message.match(/[A-Z][A-Z0-9_]{2,80}/)?.[0] ?? 'UNKNOWN_UPDATE_ERROR'
}

function friendlyUpdateError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  if (/ENOTFOUND|fetch|network/i.test(message)) return '无法连接 GitHub Releases，请检查网络后重试。'
  if (/SHA256_UNAVAILABLE/i.test(message)) return 'GitHub Release 未提供可验证的 SHA-256 摘要，已拒绝继续下载。'
  if (/HASH|SHA256|SIZE/i.test(message)) return 'DMG 文件大小或 SHA-256 不一致，已删除不完整文件，请重新下载。'
  if (/ASSET|RELEASE|VERSION|PLATFORM/i.test(message)) return 'GitHub Release 的 macOS arm64 安装包信息无效，请稍后重试或打开 Release 页面。'
  if (/DMG_OPEN/i.test(message)) return 'macOS 无法打开已下载的 DMG，可以在 Finder 中定位后手动打开。'
  return `更新处理在 ${safeUpdateFailureCode(cause)} 步骤失败；现有应用和本地数据没有被修改。`
}

function cloneState(state: ApplicationUpdateStateDto): ApplicationUpdateStateDto {
  return {
    ...state,
    progress: state.progress ? { ...state.progress } : undefined,
    error: state.error ? { ...state.error } : undefined
  }
}

export function normalizeReleaseNotes(
  notes: string | Array<{ version?: string; note?: string }> | undefined
): string | undefined {
  const text = typeof notes === 'string'
    ? notes
    : notes?.map((item) => [item.version, item.note].filter(Boolean).join('\n')).join('\n\n')
  const normalized = text?.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, 12_000) : undefined
}

export function compareSemver(a: string, b: string): number {
  const aa = a.split('.').map(Number)
  const bb = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] !== bb[index]) return aa[index] - bb[index]
  }
  return 0
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}
