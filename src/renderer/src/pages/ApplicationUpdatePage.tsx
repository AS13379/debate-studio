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
    if (action === 'open-downloaded') void run(() => window.debateStudio.openDownloadedApplicationUpdate())
    if (action === 'delete-downloaded') void run(() => window.debateStudio.deleteDownloadedApplicationUpdate())
    if (action === 'show-in-finder') void run(() => window.debateStudio.showDownloadedUpdateInFinder())
    if (action === 'open-release') void run(() => window.debateStudio.openLatestRelease())
    if (action === 'clear-cache') void run(() => window.debateStudio.clearApplicationUpdateCache())
  }} onPreferencesChange={(preferences) => {
    void run(async () => window.debateStudio.setApplicationUpdatePreferences(preferences))
  }} />
}

interface ApplicationUpdatePanelProps {
  state: ApplicationUpdateStateDto
  busy?: boolean
  onAction(action: 'check' | 'download' | 'cancel' | 'defer' | 'open-downloaded' | 'delete-downloaded' | 'show-in-finder' | 'open-release' | 'clear-cache'): void
  onPreferencesChange(preferences: { automaticCheckEnabled: boolean; automaticDownloadEnabled: boolean }): void
}

export function ApplicationUpdatePanel({ state, busy = false, onAction, onPreferencesChange }: ApplicationUpdatePanelProps) {
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
        <div><h3>更新偏好</h3><p>后台检查不会阻塞窗口；是否自动下载由你决定，安装始终通过 macOS DMG 手动完成。</p></div>
        <div className="update-toggle-group">
          <label className="update-toggle"><input type="checkbox" checked={state.automaticCheckEnabled} onChange={(event) => onPreferencesChange({ automaticCheckEnabled: event.target.checked, automaticDownloadEnabled: state.automaticDownloadEnabled })} /><span>自动检查更新</span></label>
          <label className="update-toggle"><input type="checkbox" checked={state.automaticDownloadEnabled} onChange={(event) => onPreferencesChange({ automaticCheckEnabled: state.automaticCheckEnabled, automaticDownloadEnabled: event.target.checked })} /><span>发现新版后自动下载</span></label>
        </div>
        <div className="update-policy-note"><strong>自动下载：{state.automaticDownloadEnabled ? '开启' : '关闭'}</strong><span>{state.automaticDownloadEnabled ? '发现新版本后自动下载并校验 DMG，完成后由你手动覆盖安装。' : '发现新版本后由你决定何时下载 DMG。'}</span></div>
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
        <section className="panel update-ready-card">
          <div>
            <h3>新版安装包已下载</h3>
            <p>由于当前社区构建未经过 Apple Developer ID 签名和公证，需要手动覆盖安装。您的数据库、API Key 和辩论记录不会受到影响。</p>
            <ol className="update-manual-steps">
              <li>打开 DMG。</li>
              <li>将 Debate Studio 拖入 Applications。</li>
              <li>选择“替换”。</li>
              <li>重新打开 Debate Studio。</li>
            </ol>
          </div>
          <div className="button-row">
            <button className="button primary" disabled={busy} onClick={() => onAction('open-downloaded')}>打开安装包</button>
            <button className="button secondary" disabled={busy} onClick={() => onAction('show-in-finder')}>在 Finder 中显示</button>
            <button className="button secondary" disabled={busy} onClick={() => onAction('defer')}>稍后安装</button>
            <button className="button danger" disabled={busy} onClick={() => onAction('delete-downloaded')}>删除已下载文件</button>
          </div>
        </section>
      )}
      {state.status === 'error' && (
        <section className="panel update-error-card"><div><h3>{state.error?.titleZh ?? '更新失败'}</h3><p>{state.error?.descriptionZh ?? state.messageZh}</p>{state.error?.detailCode && <small>校验步骤：{state.error.detailCode}</small>}</div><div className="button-row">{state.availableVersion && <button className="button secondary" disabled={busy} onClick={() => onAction('download')}>重新下载并校验</button>}{state.cacheSizeBytes > 0 && <button className="button secondary" disabled={busy} onClick={() => onAction('show-in-finder')}>在 Finder 中显示</button>}<button className="button secondary" disabled={busy} onClick={() => onAction('open-release')}>打开 GitHub Release</button></div></section>
      )}
      <section className="panel update-cache-card"><div><h3>更新缓存</h3><p>{formatBytes(state.cacheSizeBytes)} · 已下载的 DMG 只会在你点击删除或清理缓存后移除。</p></div><button className="button secondary" disabled={busy || state.cacheSizeBytes === 0} onClick={() => onAction('clear-cache')}>清理更新缓存</button></section>
      <p className="update-build-notice">{state.supported ? '未签名的 macOS 社区构建暂不支持可靠的自动覆盖安装。应用只负责检查、下载和校验 DMG，不会移动或删除 /Applications 中的程序。' : '更新检查只在安装后的 macOS arm64 应用中启用。'}</p>
    </section>
  )
}

function statusLabel(status: ApplicationUpdateStateDto['status']): string {
  return ({ idle: '等待检查', checking: '检查中', 'up-to-date': '已是最新', available: '有新版本', downloading: '下载中', downloaded: 'DMG 已下载', error: '更新失败' })[status]
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}
