import { useEffect, useMemo, useState } from 'react'
import { encode } from 'uqr'

import type { LanServerStatusDto } from '../../../shared/ipc-contract'

export function LanAccessPage() {
  const [status, setStatus] = useState<LanServerStatusDto>()
  const [port, setPort] = useState('27180')
  const [timeout, setTimeoutMinutes] = useState('1440')
  const [autoPort, setAutoPort] = useState(false)
  const [accessMode, setAccessMode] = useState<'localhost' | 'lan'>('localhost')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const result = await window.debateStudio.getLanServerStatus()
    if (!result.ok) return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setStatus(result.value)
    setPort(String(result.value.config.port))
    setTimeoutMinutes(String(result.value.config.sessionTimeoutMinutes))
    setAutoPort(result.value.config.autoPort)
    setAccessMode(result.value.config.accessMode)
  }

  useEffect(() => {
    void load()
    return window.debateStudio.onLanStatusChanged((next) => setStatus(next))
  }, [])

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setMessage('')
    try { await operation(); await load() } finally { setBusy(false) }
  }

  const primaryUrl = status?.accessUrls[0]

  return (
    <section className="page-stack lan-access-page" aria-labelledby="lan-title">
      <header className="page-header compact">
        <div><span className="eyebrow">本机与可信网络</span><h2 id="lan-title">Web 控制台</h2><p className="page-description">无需密码。可选择只允许这台 Mac 访问，或向同一可信 Wi-Fi 开放。</p></div>
      </header>

      <section className="panel lan-overview">
        <div>
          <span className={`status-pill status-${status?.lifecycle ?? 'stopped'}`}>{lifecycleLabel(status?.lifecycle)}</span>
          <h3>{status?.lifecycle === 'running' ? '局域网控制台正在运行' : '局域网控制台已关闭'}</h3>
          <p>{primaryUrl ?? '开启后会显示可访问地址。关闭状态不会监听任何端口。'}</p>
          {status?.startedAt && <small className="muted">启动：{formatTime(status.startedAt)}{status.lastAccessAt ? ` · 最近访问：${formatTime(status.lastAccessAt)}` : ''}</small>}
        </div>
        <div className="inline-actions">
          {status?.lifecycle === 'running'
            ? <button className="button danger" disabled={busy} onClick={() => void run(async () => showResult(await window.debateStudio.stopLanServer(), setMessage))}>关闭服务</button>
            : <button className="button primary" disabled={busy} onClick={() => void run(async () => showResult(await window.debateStudio.startLanServer(), setMessage))}>开启服务</button>}
          <button className="button ghost" disabled={status?.lifecycle !== 'running'} onClick={() => void window.debateStudio.openLanPreview()}>浏览器预览</button>
        </div>
      </section>

      {status?.lifecycle === 'running' && primaryUrl && (
        <section className="panel lan-share-panel">
          {status.config.accessMode === 'lan' && <div className="lan-qr"><QrMatrix value={primaryUrl} /></div>}
          <div className="lan-share-copy">
            <span className="eyebrow">访问地址</span><h3>{primaryUrl}</h3>
            <p>{status.config.accessMode === 'lan' ? '手机与这台 Mac 连接同一可信 Wi-Fi 后，扫码或在浏览器输入地址。' : '这个地址只能在本 Mac 上打开，局域网其他设备无法访问。'}</p>
            <button className="button ghost" onClick={() => void navigator.clipboard.writeText(primaryUrl).then(() => setMessage('访问地址已复制。'))}>复制地址</button>
          </div>
        </section>
      )}
      {status?.error && <p className="error-banner" role="alert">{status.error.titleZh}：{status.error.descriptionZh}</p>}

      <div className="lan-settings-grid">
        <section className="panel">
          <h3>网络与会话</h3>
          <div className="form-grid lan-form-grid">
            <label>访问范围<select value={accessMode} onChange={(event) => setAccessMode(event.target.value as 'localhost' | 'lan')}><option value="localhost">仅本机（localhost）</option><option value="lan">开放局域网（无密码）</option></select></label>
            <label>端口<input type="number" min="1024" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></label>
            <label>会话有效期（分钟）<input type="number" min="15" max="10080" value={timeout} onChange={(event) => setTimeoutMinutes(event.target.value)} /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={autoPort} onChange={(event) => setAutoPort(event.target.checked)} />端口占用时自动尝试后续端口</label>
          <button className="button primary" disabled={busy} onClick={() => void run(async () => showResult(await window.debateStudio.updateLanServerConfig({ accessMode, port: Number(port), sessionTimeoutMinutes: Number(timeout), autoPort }), setMessage))}>保存设置</button>
        </section>

        <section className="panel">
          <h3>访问说明</h3>
          <p className="muted">仅本机模式只监听 localhost，适合在 Mac 浏览器中使用。</p>
          <p className="muted">开放局域网后，同一网络内的设备无需密码即可查看并控制辩论。请勿在公共 Wi-Fi 使用。</p>
          <span className={`status-pill ${accessMode === 'lan' ? 'status-warning' : 'status-completed'}`}>{accessMode === 'lan' ? '同网络设备均可访问' : '只有本 Mac 可访问'}</span>
        </section>
      </div>

      <section className="panel">
        <div className="section-heading-row"><div><h3>当前 Web 设备</h3><p className="muted">打开页面时会自动建立本地会话；服务重启或关闭后全部失效。</p></div><button className="button ghost" disabled={!status?.devices.length} onClick={() => void run(async () => showResult(await window.debateStudio.logoutAllLanDevices(), setMessage, '所有设备已断开。'))}>断开全部</button></div>
        <div className="lan-device-list">
          {status?.devices.length ? status.devices.map((device) => (
            <article key={device.id} className="lan-device-row"><div><strong>{device.label}</strong><small>{device.address} · 最近访问 {formatTime(device.lastAccessAt)}</small></div><button className="button ghost" onClick={() => void run(async () => showResult(await window.debateStudio.kickLanDevice({ deviceId: device.id }), setMessage, '设备已断开。'))}>断开</button></article>
          )) : <p className="empty-inline">暂无 Web 设备。</p>}
        </div>
      </section>

      {message && <p className="inline-message" role="status">{message}</p>}
    </section>
  )
}

function QrMatrix({ value }: { value: string }) {
  const qr = useMemo(() => encode(value, { ecc: 'M', border: 2 }), [value])
  return <svg role="img" aria-label="局域网访问二维码" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges">{qr.data.flatMap((row, y) => row.map((filled, x) => filled ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null))}</svg>
}

function lifecycleLabel(value?: LanServerStatusDto['lifecycle']) {
  return ({ running: '运行中', starting: '启动中', stopping: '关闭中', suspended: '已休眠', error: '启动失败', stopped: '已关闭' } as const)[value ?? 'stopped']
}

function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN') }

function showResult(result: { ok: boolean; error?: { titleZh: string; descriptionZh: string } }, setMessage: (value: string) => void, success = '操作已完成。') {
  setMessage(result.ok ? success : `${result.error?.titleZh ?? '操作失败'}：${result.error?.descriptionZh ?? '请稍后重试。'}`)
}
