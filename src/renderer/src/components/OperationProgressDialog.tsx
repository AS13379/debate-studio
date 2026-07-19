import { useEffect, useState } from 'react'

export interface OperationLogItem {
  id: string
  label: string
  detail?: string
  tone?: 'normal' | 'success' | 'error'
}

export function OperationProgressDialog({
  open,
  title,
  description,
  progress,
  running,
  logs,
  rawInput,
  rawOutput,
  reasoningOutput,
  onCancel,
  cancelLabel = '停止当前操作',
  onClose
}: {
  open: boolean
  title: string
  description: string
  progress: number
  running: boolean
  logs: OperationLogItem[]
  rawInput?: string
  rawOutput?: string
  reasoningOutput?: string
  onCancel?(): void
  cancelLabel?: string
  onClose(): void
}) {
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open || !running) return undefined
    const nextStartedAt = Date.now()
    setStartedAt(nextStartedAt)
    setNow(nextStartedAt)
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [open, running])
  if (!open) return null
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
  return <div className="modal-backdrop operation-backdrop" role="presentation">
    <section className="operation-dialog" role="dialog" aria-modal="true" aria-labelledby="operation-dialog-title">
      <header>
        <div><p className="eyebrow">正在处理</p><h2 id="operation-dialog-title">{title}</h2><p>{description}</p>{running && <small className="operation-elapsed" role="status">已运行 {elapsedSeconds} 秒，没有新内容时仍会持续计时</small>}</div>
        <div className="compact-actions">
          {running && onCancel && <button className="button danger" onClick={onCancel}>{cancelLabel}</button>}
          {!running && <button className="button ghost" onClick={onClose}>关闭</button>}
        </div>
      </header>
      <div className="operation-progress" aria-label={`进度 ${Math.round(progress)}%`}>
        <span style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
      </div>
      <div className="operation-log" aria-live="polite">
        {logs.map((item) => <div key={item.id} className={`operation-log-row ${item.tone ?? 'normal'}`}>
          <span className="operation-log-dot" />
          <div><strong>{item.label}</strong>{item.detail && <p>{item.detail}</p>}</div>
        </div>)}
      </div>
      {(rawInput || rawOutput || reasoningOutput) && <div className="operation-raw">
        {rawInput && <details><summary>查看发送给 AI 的原文</summary><pre>{rawInput}</pre></details>}
        {reasoningOutput && <details open={running}><summary>{running ? '查看服务商返回的思考内容 / 摘要（实时）' : '查看服务商返回的思考内容 / 摘要'}</summary><pre>{reasoningOutput}</pre></details>}
        {rawOutput && <details open={!running}><summary>查看 AI 返回的原文</summary><pre>{rawOutput}</pre></details>}
      </div>}
    </section>
  </div>
}
