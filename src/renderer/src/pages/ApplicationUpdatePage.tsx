import { useEffect, useState } from 'react'

import type { ApplicationUpdateStateDto } from '../../../shared/ipc-contract'

const fallbackState: ApplicationUpdateStateDto = {
  currentVersion: '—',
  supported: false,
  automaticCheckEnabled: true,
  automaticDownloadEnabled: false,
  status: 'idle',
  messageZh: '正在读取更新状态…',
  verificationStatus: 'not-verified',
  manualInstallAvailable: true,
  cacheSizeBytes: 0
}

export function ApplicationUpdatePage() {
  const [state, setState] = useState<ApplicationUpdateStateDto>(fallbackState)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.debateStudio.getApplicationUpdateState().then((next) => { if (mounted) setState(next) })
    const unsubscribe = window.debateStudio.onApplicationUpdateStateChanged((next) => { if (mounted) setState(next) })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const run = async (operation: () => Promise<{ ok: boolean; value?: ApplicationUpdateStateDto; error?: { descriptionZh: string } }>) => {
    setBusy(true)
    try {
      const result = await operation()
      if (result.ok && result.value) setState(result.value)
      else if (!result.ok && result.error) setState((current) => ({ ...current, status: 'error', messageZh: result.error!.descriptionZh }))
    } finally {
      setBusy(false)
    }
  }

  return <ApplicationUpdatePanel state={state} busy={busy} onAction={(action) => {
    if (action === 'check') void run(() => window.debateStudio.checkApplicationUpdates())
    if (action === 'download') void run(() => window.debateStudio.downloadApplicationUpdate())
    if (action === 'cancel') void run(async () => window.debateStudio.cancelApplicationUpdateDownload())
    if (action === 'defer') void run(async () => window.debateStudio.deferApplicationUpdate())
    if (action === 'install') void run(() => window.debateStudio.installApplicationUpdate())
    if (action === 'retry-install') void run(() => window.debateStudio.retryApplicationUpdateInstall())
    if (action === 'show-in-finder') void run(() => window.debateStudio.showDownloadedUpdateInFinder())
    if (action === 'open-release') void run(() => window.debateStudio.openLatestRelease())
    if (action === 'clear-cache') void run(() => window.debateStudio.clearApplicationUpdateCache())
  }} onAutomaticCheckChange={(automaticCheckEnabled) => {
    void run(async () => window.debateStudio.setApplicationUpdatePreferences({ automaticCheckEnabled }))
  }} />
}

interface ApplicationUpdatePanelProps {
  state: ApplicationUpdateStateDto
  busy?: boolean
  onAction(action: 'check' | 'download' | 'cancel' | 'defer' | 'install' | 'retry-install' | 'show-in-finder' | 'open-release' | 'clear-cache'): void
  onAutomaticCheckChange(enabled: boolean): void
}

export function ApplicationUpdatePanel({ state, busy = false, onAction, onAutomaticCheckChange }: ApplicationUpdatePanelProps) {
  const checking = state.status === 'checking'
  const downloading = state.status === 'downloading'
  return (
    <section className="page-stack application-update-page">
      <header className="page-header compact-page-header">
        <div><span className="eyebrow">GitHub Releases</span><h2>应用更新</h2><p>只更新 Debate Studio 程序文件，不会读取或覆盖模型凭据、数据库和本地辩论记录。</p></div>
      </header>
      <section className="panel update-summary-card">
        <div className="update-version-block"><span>当前版本</span><strong>v{state.currentVersion}</strong></div>
        <div className={`update-status update-status-${state.status}`} role="status" aria-live="polite">
          <span>{statusLabel(state.status)}</span><p>{state.messageZh}</p>
        </div>
        <button className="button secondary" disabled={busy || checking || downloading} onClick={() => onAction('check')}>
          {checking ? '检查中…' : '检查更新'}
        </button>
      </section>
      <section className="panel update-preferences-card">
        <div><h3>更新偏好</h3><p>启动后在后台检查，不会阻塞窗口，也不会自动下载安装包。</p></div>
        <label className="update-toggle"><input type="checkbox" checked={state.automaticCheckEnabled} onChange={(event) => onAutomaticCheckChange(event.target.checked)} /><span>自动检查更新</span></label>
        <div className="update-policy-note"><strong>自动下载：关闭</strong><span>发现新版本后由你决定何时下载和安装。</span></div>
      </section>
      {state.status === 'available' && (
        <section className="panel update-release-card">
          <div className="section-heading"><div><h3>发现 v{state.availableVersion}</h3><p>当前版本 v{state.currentVersion}{state.releaseDate ? ` · 发布于 ${formatDate(state.releaseDate)}` : ''}</p></div></div>
          {state.releaseName && <strong className="update-release-name">{state.releaseName}</strong>}
          {state.releaseNotes && <pre className="update-release-notes">{state.releaseNotes}</pre>}
          <div className="button-row"><button className="button primary" disabled={busy} onClick={() => onAction('download')}>下载更新</button><button className="button secondary" disabled={busy} onClick={() => onAction('defer')}>稍后提醒</button></div>
        </section>
      )}
      {downloading && (
        <section className="panel update-download-card">
          <div className="section-heading"><div><h3>正在下载 v{state.availableVersion}</h3><p>{formatBytes(state.progress?.transferredBytes ?? 0)} / {formatBytes(state.progress?.totalBytes ?? 0)}</p></div><strong>{(state.progress?.percent ?? 0).toFixed(1)}%</strong></div>
          <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress?.percent ?? 0}><span style={{ width: `${state.progress?.percent ?? 0}%` }} /></div>
          <div className="button-row"><button className="button secondary" onClick={() => onAction('cancel')}>取消下载</button></div>
        </section>
      )}
      {state.status === 'downloaded' && (
        <section className="panel update-ready-card"><div><h3>更新已准备完成</h3><p>项目签名、SHA256 与应用身份均已验证；重启后只替换程序文件。</p></div><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => onAction('show-in-finder')}>在 Finder 中显示</button><button className="button primary" disabled={busy} onClick={() => onAction('install')}>重启并安装</button></div></section>
      )}
      {(state.status === 'preparing-install' || state.status === 'waiting-for-restart') && (
        <section className="panel update-ready-card"><div><h3>{state.status === 'preparing-install' ? '正在验证更新' : '即将重启安装'}</h3><p>{state.messageZh}</p></div><span className="thinking-shimmer">请稍候…</span></section>
      )}
      {(state.status === 'error' || state.status === 'install-failed' || state.status === 'rolled-back') && (
        <section className="panel update-error-card"><div><h3>{state.error?.titleZh ?? '更新失败'}</h3><p>{state.error?.descriptionZh ?? state.messageZh}</p></div><div className="button-row">{(state.status === 'install-failed' || state.status === 'rolled-back') && <button className="button secondary" disabled={busy} onClick={() => onAction('retry-install')}>重试安装</button>}<button className="button secondary" disabled={busy} onClick={() => onAction('open-release')}>手动下载 DMG</button></div></section>
      )}
      <section className="panel update-cache-card"><div><h3>更新缓存</h3><p>{formatBytes(state.cacheSizeBytes)} · 自动安装成功后清理；手动下载的 DMG 不会由应用删除。</p></div><button className="button secondary" disabled={busy || state.cacheSizeBytes === 0} onClick={() => onAction('clear-cache')}>清理更新缓存</button></section>
      <p className="update-build-notice">{state.supported ? 'v0.5.0 起使用 Debate Studio 项目签名校验更新来源与完整性；旧版本升级到 v0.5.0 仍需最后一次手动覆盖安装。' : '社区更新只在安装后的 macOS arm64 应用中启用。'}</p>
    </section>
  )
}

function statusLabel(status: ApplicationUpdateStateDto['status']): string {
  return ({ idle: '等待检查', checking: '检查中', 'up-to-date': '已是最新', available: '有新版本', downloading: '下载中', downloaded: '等待安装', 'preparing-install': '正在验证', 'waiting-for-restart': '即将重启', 'install-failed': '安装失败', 'rolled-back': '已回滚', error: '更新失败' })[status]
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}
