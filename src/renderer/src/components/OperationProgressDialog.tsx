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
  onCancel?(): void
  cancelLabel?: string
  onClose(): void
}) {
  if (!open) return null
  return <div className="modal-backdrop operation-backdrop" role="presentation">
    <section className="operation-dialog" role="dialog" aria-modal="true" aria-labelledby="operation-dialog-title">
      <header>
        <div><p className="eyebrow">正在处理</p><h2 id="operation-dialog-title">{title}</h2><p>{description}</p></div>
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
      {(rawInput || rawOutput) && <div className="operation-raw">
        {rawInput && <details><summary>查看发送给 AI 的原文</summary><pre>{rawInput}</pre></details>}
        {rawOutput && <details open={!running}><summary>查看 AI 返回的原文</summary><pre>{rawOutput}</pre></details>}
      </div>}
    </section>
  </div>
}
