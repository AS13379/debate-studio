import { useEffect, useMemo, useState } from 'react'

import type { ErrorRecordDto, LogEntryDto } from '../../../shared/ipc-contract'

const categoryLabel: Record<ErrorRecordDto['category'], string> = {
  provider: '模型服务', network: '网络', authentication: '凭据', validation: '校验',
  persistence: '本地数据', runtime: '运行时', renderer: '界面', unknown: '未知'
}

const levelLabel: Record<LogEntryDto['level'], string> = {
  debug: '调试', info: '信息', warn: '警告', error: '错误'
}

export function DiagnosticsPage() {
  const [errors, setErrors] = useState<ErrorRecordDto[]>([])
  const [logs, setLogs] = useState<LogEntryDto[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [loading, setLoading] = useState(true)
  const selected = useMemo(() => errors.find((item) => item.id === selectedId), [errors, selectedId])

  const reload = async (): Promise<void> => {
    setLoading(true)
    const [errorResult, logResult] = await Promise.all([
      window.debateStudio.listRecentErrors(), window.debateStudio.getRecentLogs()
    ])
    if (errorResult.ok) {
      setErrors(errorResult.value)
      setSelectedId((current) => current && errorResult.value.some((item) => item.id === current) ? current : errorResult.value[0]?.id)
    } else setMessage(errorResult.error.descriptionZh)
    if (logResult.ok) setLogs(logResult.value)
    else setMessage(logResult.error.descriptionZh)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [])

  const exportReport = async (): Promise<void> => {
    const result = await window.debateStudio.exportDiagnosticReport()
    setMessage(result.ok ? `脱敏诊断报告已保存：${result.value.filePath}` : result.error.descriptionZh)
    if (result.ok) void reload()
  }

  const clearErrors = async (): Promise<void> => {
    const result = await window.debateStudio.clearErrors()
    if (result.ok) { setErrors([]); setSelectedId(undefined); setMessage('最近错误已清理。') }
    else setMessage(result.error.descriptionZh)
  }

  const clearLogs = async (): Promise<void> => {
    const result = await window.debateStudio.clearLogs()
    if (result.ok) { setLogs([]); setMessage('日志文件已清理。') }
    else setMessage(result.error.descriptionZh)
  }

  const copySelected = async (): Promise<void> => {
    if (!selected) return
    const safeSummary = {
      id: selected.id, timestamp: selected.timestamp, category: selected.category,
      severity: selected.severity, title: selected.title, userMessage: selected.userMessage,
      technicalMessage: selected.technicalMessage, source: selected.source,
      retryable: selected.retryable, metadata: selected.metadata
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(safeSummary, null, 2))
      setMessage('脱敏错误详情已复制。')
    } catch { setMessage('复制失败，可改用“导出诊断报告”。') }
  }

  return (
    <section className="page diagnostics-page">
      <header className="page-header">
        <div><span className="eyebrow">设置</span><h1>诊断与日志</h1><p className="page-description">查看最近问题，导出不含辩论正文和凭据的脱敏诊断信息。</p></div>
        <div className="compact-actions"><button className="button secondary" onClick={() => void reload()}>刷新</button><button className="button primary" onClick={() => void exportReport()}>导出诊断报告</button></div>
      </header>
      {message && <div className="panel diagnostics-message">{message}</div>}
      <div className="diagnostics-summary">
        <div className="panel"><strong>{errors.length}</strong><span>最近错误</span></div>
        <div className="panel"><strong>{logs.length}</strong><span>最近日志</span></div>
        <div className="panel"><strong>{errors.filter((item) => item.retryable).length}</strong><span>可重试问题</span></div>
      </div>
      <div className="diagnostics-grid">
        <section className="panel diagnostics-section">
          <div className="section-heading"><div><h2>最近错误</h2><span>默认不展示技术细节</span></div><button className="button ghost danger-text" disabled={!errors.length} onClick={() => void clearErrors()}>清理错误</button></div>
          {loading ? <p className="muted">正在读取…</p> : !errors.length ? <div className="diagnostics-empty"><strong>暂无错误</strong><span>最近没有收集到需要处理的异常。</span></div> : (
            <div className="error-record-list">{errors.map((item) => (
              <button key={item.id} className={`error-record-row ${selectedId === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
                <span className={`severity-dot severity-${item.severity}`} /><span><strong>{item.title}</strong><small>{categoryLabel[item.category]} · {new Date(item.timestamp).toLocaleString('zh-CN')}</small></span><em>{item.retryable ? '可重试' : '不可直接重试'}</em>
              </button>
            ))}</div>
          )}
        </section>
        <section className="panel diagnostics-section error-detail-panel">
          <div className="section-heading"><div><h2>错误详情</h2><span>技术信息仅在手动展开时显示</span></div></div>
          {!selected ? <p className="muted">选择一条错误查看详情。</p> : (
            <div className="error-detail-body">
              <div><span className="eyebrow">{categoryLabel[selected.category]}</span><h3>{selected.title}</h3></div><p>{selected.userMessage}</p>
              <div className="error-detail-facts"><span>来源：{selected.source}</span><span>{selected.retryable ? '可重试' : '需要先修正配置或状态'}</span></div>
              <button className="button secondary" onClick={() => void copySelected()}>复制脱敏详情</button>
              <details><summary>查看技术详情</summary><pre>{selected.technicalMessage}</pre>{Object.keys(selected.metadata).length > 0 && <pre>{JSON.stringify(selected.metadata, null, 2)}</pre>}</details>
            </div>
          )}
        </section>
      </div>
      <section className="panel diagnostics-section log-section">
        <div className="section-heading"><div><h2>最近日志</h2><span>仅记录操作、阶段、状态与错误代码</span></div><button className="button ghost danger-text" disabled={!logs.length} onClick={() => void clearLogs()}>清理日志</button></div>
        {!logs.length ? <p className="muted">暂无日志。</p> : <div className="log-list">{logs.slice(-80).reverse().map((entry) => (
          <div className="log-row" key={entry.id}><span className={`log-level log-${entry.level}`}>{levelLabel[entry.level]}</span><time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN')}</time><strong>{entry.source}</strong><span>{entry.message}</span></div>
        ))}</div>}
      </section>
    </section>
  )
}
