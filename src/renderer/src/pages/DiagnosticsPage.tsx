import { useEffect, useMemo, useState } from 'react'

import type {
  DataManagementStateDto,
  ErrorRecordDto,
  LogEntryDto,
  PerformanceSnapshotDto
} from '../../../shared/ipc-contract'

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
  const [performance, setPerformance] = useState<PerformanceSnapshotDto>()
  const [dataState, setDataState] = useState<DataManagementStateDto>()
  const [selectedId, setSelectedId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [loading, setLoading] = useState(true)
  const selected = useMemo(() => errors.find((item) => item.id === selectedId), [errors, selectedId])

  const reload = async (): Promise<void> => {
    setLoading(true)
    const [errorResult, logResult, performanceResult, dataResult] = await Promise.all([
      window.debateStudio.listRecentErrors(), window.debateStudio.getRecentLogs(),
      window.debateStudio.getPerformanceSnapshot(), window.debateStudio.getDataManagementState()
    ])
    if (errorResult.ok) {
      setErrors(errorResult.value)
      setSelectedId((current) => current && errorResult.value.some((item) => item.id === current) ? current : errorResult.value[0]?.id)
    } else setMessage(errorResult.error.descriptionZh)
    if (logResult.ok) setLogs(logResult.value)
    else setMessage(logResult.error.descriptionZh)
    if (performanceResult.ok) setPerformance(performanceResult.value)
    else setMessage(performanceResult.error.descriptionZh)
    if (dataResult.ok) setDataState(dataResult.value)
    else setMessage(dataResult.error.descriptionZh)
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

  const createBackup = async (): Promise<void> => {
    setMessage('正在创建一致性数据库备份…')
    const result = await window.debateStudio.createDatabaseBackup()
    setMessage(result.ok ? `数据库备份已创建：${formatDate(result.value.createdAt)}` : result.error.descriptionZh)
    if (result.ok) void reload()
  }

  const restoreBackup = async (backupId: string): Promise<void> => {
    if (!window.confirm('恢复会替换当前数据库，并停止正在运行的辩论。是否继续？')) return
    if (!window.confirm('请再次确认：当前数据库会先自动备份，恢复完成后应用将重新启动。')) return
    setMessage('正在安全停止运行并恢复数据库，请勿关闭应用…')
    const result = await window.debateStudio.restoreDatabaseBackup({ backupId, confirmed: true })
    setMessage(result.ok ? '数据库已恢复，应用即将重新启动。' : result.error.descriptionZh)
  }

  return (
    <section className="page-stack diagnostics-page">
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
      <section className="panel diagnostics-section data-management-panel">
        <div className="section-heading">
          <div><h2>数据管理</h2><span>备份保存在应用数据目录；系统加密凭据独立存放，不写入 SQLite</span></div>
          <button className="button primary" onClick={() => void createBackup()}>创建备份</button>
        </div>
        {!dataState ? <p className="muted">正在读取数据库信息…</p> : <>
          <div className="data-management-facts">
            <div><span>数据库位置</span><code>{dataState.databasePath}</code></div>
            <div><span>Schema 版本</span><strong>v{dataState.schemaVersion}</strong></div>
            <div><span>最近备份</span><strong>{dataState.latestBackup ? formatDate(dataState.latestBackup.createdAt) : '尚无备份'}</strong></div>
          </div>
          {!dataState.backups.length ? <p className="muted">尚无数据库备份。发布前建议先创建一次手动备份。</p> : (
            <div className="backup-list">
              {dataState.backups.map((backup) => <div className="backup-row" key={backup.id}>
                <div><strong>{backupReasonLabel(backup.reason)}</strong><span>{formatDate(backup.createdAt)} · v{backup.schemaVersion} · {formatBytes(backup.fileSize)}</span></div>
                <button className="button ghost danger-text" onClick={() => void restoreBackup(backup.id)}>恢复此备份</button>
              </div>)}
            </div>
          )}
          <p className="data-management-note">恢复前会再次创建安全备份，并取消所有在途请求。Provider、模型配置随数据库版本恢复；系统加密凭据文件不会被覆盖。</p>
        </>}
      </section>
      <section className="panel diagnostics-section performance-panel">
        <div className="section-heading"><div><h2>本次运行性能</h2><span>仅统计耗时、数量、字符数和进程内存，不记录任何正文</span></div></div>
        {!performance ? <p className="muted">正在收集性能数据…</p> : (
          <div className="performance-grid">
            <PerformanceFact label="SQLite 平均查询" value={`${formatMs(performance.sqlite.averageMs)} / P95 ${formatMs(performance.sqlite.p95Ms)}`} />
            <PerformanceFact label="Renderer 平均渲染" value={`${formatMs(performance.renderer.averageMs)} / 最大 ${formatMs(performance.renderer.maxMs)}`} />
            <PerformanceFact label="导出平均耗时" value={`${formatMs(performance.exports.averageMs)} / ${performance.exports.completed} 次完成`} />
            <PerformanceFact label="进程内存峰值" value={performance.memoryPeakBytes ? formatBytes(performance.memoryPeakBytes) : '当前环境不可用'} />
            <PerformanceFact label="最近 Session" value={performance.sessions[0] ? `${performance.sessions[0].turnCount} Turns / ${formatMs(performance.sessions[0].totalDurationMs)}` : '尚无运行记录'} />
            <PerformanceFact label="最长单次生成" value={performance.sessions[0] ? `${performance.sessions[0].maxGenerationCharacters.toLocaleString('zh-CN')} 字符` : '尚无运行记录'} />
          </div>
        )}
      </section>
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

function PerformanceFact({ label, value }: { label: string; value: string }) {
  return <div className="performance-fact"><span>{label}</span><strong>{value}</strong></div>
}

function formatMs(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} 秒`
  return `${value.toFixed(1)} ms`
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function backupReasonLabel(reason: 'manual' | 'pre-migration' | 'pre-restore'): string {
  return { manual: '手动备份', 'pre-migration': '升级前自动备份', 'pre-restore': '恢复前安全备份' }[reason]
}
