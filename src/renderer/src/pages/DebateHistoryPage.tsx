import { useEffect, useState } from 'react'

import type {
  DebateExportRecordDto,
  DebateHistoryDetailDto,
  DebateHistoryResultDto
} from '../../../shared/ipc-contract'
import { MarkdownContent } from '../components/MarkdownContent'
import { DeleteDebateConfirmation } from '../components/DeleteDebateConfirmation'
import { stageLabel, statusLabel } from './HomePage'
import { DebateQualityPanel } from '../components/DebateQualityPanel'

export interface DebateHistoryPageProps {
  debateId: string
  onBack(): void
  onOpenDebate(debateId: string): void
  onChanged(): void
}

export function DebateHistoryPage({ debateId, onBack, onOpenDebate, onChanged }: DebateHistoryPageProps) {
  const [detail, setDetail] = useState<DebateHistoryDetailDto>()
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [includePrivateResearch, setIncludePrivateResearch] = useState(false)
  const [exporting, setExporting] = useState<'markdown' | 'html'>()
  const [exports, setExports] = useState<DebateExportRecordDto[]>([])
  const [exportMessage, setExportMessage] = useState<string>()
  const [exportError, setExportError] = useState<string>()
  const [confirmExportDeleteId, setConfirmExportDeleteId] = useState<string>()

  const load = async (): Promise<void> => {
    const result = await window.debateStudio.getDebateDetail({ id: debateId })
    if (!result.ok) setError(result.error.descriptionZh)
    else {
      setDetail(result.value)
      setTitle(result.value.customTitle ?? result.value.topic)
      setError(undefined)
    }
  }

  const loadExports = async (): Promise<void> => {
    const result = await window.debateStudio.listExports()
    if (result.ok) setExports(result.value.filter((record) => record.debateId === debateId))
    else setExportError(result.error.descriptionZh)
  }

  useEffect(() => { void load(); void loadExports() }, [debateId])
  const hasGeneratingExport = exports.some((record) => record.status === 'generating')
  useEffect(() => {
    if (!hasGeneratingExport) return
    const interval = window.setInterval(() => void loadExports(), 500)
    return () => window.clearInterval(interval)
  }, [debateId, hasGeneratingExport])

  const runExport = async (type: 'markdown' | 'html'): Promise<void> => {
    setExporting(type)
    setExportMessage(undefined)
    setExportError(undefined)
    const input = { debateId, exportOptions: { includePrivateResearch } }
    const result = type === 'markdown'
      ? await window.debateStudio.exportMarkdown(input)
      : await window.debateStudio.exportHtml(input)
    if (result.ok) {
      setExportMessage('导出任务已开始，可继续使用应用；进度会自动更新。')
      await loadExports()
    } else setExportError(result.error.descriptionZh)
    setExporting(undefined)
  }

  const cancelExport = async (exportId: string): Promise<void> => {
    const result = await window.debateStudio.cancelExport({ exportId })
    if (!result.ok) setExportError(result.error.descriptionZh)
    else {
      setExportMessage(result.value.cancelled ? '导出已取消，未完成文件不会保留。' : '该任务已经结束。')
      await loadExports()
    }
  }

  const deleteExport = async (exportId: string): Promise<void> => {
    const result = await window.debateStudio.deleteExport({ exportId })
    if (!result.ok) setExportError(result.error.descriptionZh)
    else {
      setExportMessage(result.value.deleted ? '导出文件和历史记录已删除。' : '导出记录已经不存在。')
      setConfirmExportDeleteId(undefined)
      await loadExports()
    }
  }

  const update = async (operation: Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>): Promise<void> => {
    setBusy(true)
    const result = await operation
    if (!result.ok) setError(result.error.descriptionZh)
    else {
      setDetail(result.value)
      setTitle(result.value.customTitle ?? result.value.topic)
      setError(undefined)
      onChanged()
    }
    setBusy(false)
  }

  if (!detail) return <section className="page-stack"><button className="button ghost" onClick={onBack}>返回历史列表</button>{error ? <div className="notice error">{error}</div> : <div className="panel muted">正在按需加载历史详情…</div>}</section>

  return (
    <section className="page-stack history-detail-page" aria-labelledby="history-detail-title">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">历史详情</p>
          <h1 id="history-detail-title">{detail.displayTitle}</h1>
          <p className="page-description">这里只加载摘要、数量和最终裁决，不默认加载全部发言正文。</p>
        </div>
        <div className="header-actions">
          <button className="button ghost" onClick={onBack}>返回列表</button>
          {detail.historyStatus === 'active' && <button className="button primary" onClick={() => onOpenDebate(detail.id)}>查看辩论</button>}
        </div>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}

      <div className="history-detail-grid">
        <section className="panel history-summary-panel">
          <div className="section-heading"><div><strong>基本信息</strong><span>运行与整理状态</span></div><button
            className="button ghost"
            disabled={busy}
            onClick={() => void update(window.debateStudio.toggleFavorite({ id: detail.id, favorite: !detail.favorite }))}
          >{detail.favorite ? '★ 取消收藏' : '☆ 收藏'}</button></div>
          <dl className="history-fact-grid">
            <div><dt>原辩题</dt><dd>{detail.topic}</dd></div>
            <div><dt>运行状态</dt><dd>{statusLabel(detail.status)}</dd></div>
            <div><dt>当前阶段</dt><dd>{stageLabel(detail.currentStage)}</dd></div>
            <div><dt>历史状态</dt><dd>{historyStatusLabel(detail.historyStatus)}</dd></div>
            <div><dt>创建时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd></div>
            <div><dt>最近更新</dt><dd>{new Date(detail.updatedAt).toLocaleString('zh-CN')}</dd></div>
          </dl>
        </section>

        <section className="panel history-count-panel">
          <strong>内容概览</strong>
          <div className="history-count-grid">
            <div><b>{detail.turnCount}</b><span>发言轮次</span></div>
            <div><b>{detail.eventCount}</b><span>运行事件</span></div>
            <div><b>{detail.research.indexCount}</b><span>研究索引</span></div>
            <div><b>{detail.evidenceCount}</b><span>公开证据</span></div>
          </div>
        </section>
      </div>

      <section className="panel history-editor-panel">
        <div className="section-heading"><div><strong>整理这场辩论</strong><span>名称、收藏和标签只影响历史管理</span></div></div>
        <form className="history-rename-row" onSubmit={(event) => {
          event.preventDefault()
          void update(window.debateStudio.renameDebate({ id: detail.id, customTitle: title }))
        }}>
          <label className="field"><span>自定义名称</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
          <button className="button secondary" disabled={busy || !title.trim()} type="submit">保存名称</button>
        </form>
        <div className="history-tag-editor">
          <div className="tag-list">
            {detail.tags.length === 0 && <span className="muted">尚未添加标签</span>}
            {detail.tags.map((item) => <span className="tag-pill removable" key={item}>{item}<button
              aria-label={`移除标签 ${item}`}
              onClick={() => void update(window.debateStudio.removeTag({ id: detail.id, tag: item }))}
            >×</button></span>)}
          </div>
          <form onSubmit={(event) => {
            event.preventDefault()
            if (!tag.trim()) return
            void update(window.debateStudio.addTag({ id: detail.id, tag })).then(() => setTag(''))
          }}>
            <input aria-label="新标签" placeholder="例如：政策、收藏案例" value={tag} maxLength={50} onChange={(event) => setTag(event.target.value)} />
            <button className="button secondary" disabled={busy || !tag.trim()} type="submit">添加标签</button>
          </form>
        </div>
      </section>

      <details className="panel collapsible-section history-models">
        <summary><div><strong>模型配置摘要</strong><span>{detail.models.length} 个角色</span></div></summary>
        <div className="collapsible-body history-model-grid">
          {detail.models.map((model) => <article key={`${model.role}-${model.modelProfileId}`}>
            <strong>{roleLabel(model.role)}</strong><span>{model.participantDisplayName}</span>
            <b>{model.modelDisplayName}</b><code>{model.modelId}</code><small>{model.providerDisplayName}</small>
          </article>)}
        </div>
      </details>

      <section className="panel history-research-summary">
        <div className="section-heading"><div><strong>研究状态</strong><span>只显示聚合信息</span></div></div>
        <p>{researchStatusLabel(detail.research.status)} · {detail.research.completedSessionCount}/{detail.research.sessionCount} 个研究空间完成</p>
      </section>

      <DebateQualityPanel debateId={debateId} completed={detail.status === 'completed'} />

      <DebateExportPanel
        completed={detail.status === 'completed'}
        includePrivateResearch={includePrivateResearch}
        exporting={exporting}
        records={exports}
        message={exportMessage}
        error={exportError}
        confirmDeleteId={confirmExportDeleteId}
        onIncludePrivateResearchChange={setIncludePrivateResearch}
        onExport={(type) => void runExport(type)}
        onRequestDelete={setConfirmExportDeleteId}
        onCancelDelete={() => setConfirmExportDeleteId(undefined)}
        onConfirmDelete={(exportId) => void deleteExport(exportId)}
        onCancelExport={(exportId) => void cancelExport(exportId)}
        onRetryExport={(record) => {
          setIncludePrivateResearch(record.includePrivateResearch)
          void runExport(record.type)
        }}
      />

      <details className="panel collapsible-section history-adjudication">
        <summary><div><strong>最终裁决</strong><span>{detail.finalAdjudication ? '点击按需展开' : '尚无裁决'}</span></div></summary>
        <div className="collapsible-body">
          {detail.finalAdjudication ? <MarkdownContent content={detail.finalAdjudication.content} /> : <p className="muted">这场辩论尚未生成最终裁决。</p>}
        </div>
      </details>

      <section className="panel history-danger-zone">
        <div><strong>记录状态</strong><p>归档可整理当前列表；软删除会移入回收站，所有关联数据仍然保留。</p></div>
        <div className="compact-actions">
          {detail.historyStatus === 'active' && <button className="button secondary" disabled={busy} onClick={() => void update(window.debateStudio.archiveDebate({ id: detail.id }))}>归档</button>}
          {detail.historyStatus !== 'active' && <button className="button secondary" disabled={busy} onClick={() => void update(window.debateStudio.restoreDebate({ id: detail.id }))}>恢复到当前记录</button>}
          {detail.historyStatus !== 'deleted' && <button className="button danger" disabled={busy} onClick={() => setConfirmDelete(true)}>删除</button>}
        </div>
      </section>

      {confirmDelete && <DeleteDebateConfirmation
        detail={detail}
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void update(window.debateStudio.deleteDebate({ id: detail.id, confirmed: true })).then(() => setConfirmDelete(false))}
      />}
    </section>
  )
}

export function DebateExportPanel({
  completed,
  includePrivateResearch,
  exporting,
  records,
  message,
  error,
  confirmDeleteId,
  onIncludePrivateResearchChange,
  onExport,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onCancelExport = () => undefined,
  onRetryExport = () => undefined
}: {
  completed: boolean
  includePrivateResearch: boolean
  exporting?: 'markdown' | 'html'
  records: DebateExportRecordDto[]
  message?: string
  error?: string
  confirmDeleteId?: string
  onIncludePrivateResearchChange(value: boolean): void
  onExport(type: 'markdown' | 'html'): void
  onRequestDelete(exportId: string): void
  onCancelDelete(): void
  onConfirmDelete(exportId: string): void
  onCancelExport?(exportId: string): void
  onRetryExport?(record: DebateExportRecordDto): void
}) {
  return <section className="panel debate-export-panel" aria-labelledby="debate-export-title">
    <div className="section-heading">
      <div><strong id="debate-export-title">导出与归档</strong><span>文件由主进程安全生成，默认只包含公开资料</span></div>
      <div className="compact-actions">
        <button className="button secondary" disabled={!completed || Boolean(exporting)} onClick={() => onExport('markdown')}>{exporting === 'markdown' ? '正在导出…' : '导出 Markdown'}</button>
        <button className="button primary" disabled={!completed || Boolean(exporting)} onClick={() => onExport('html')}>{exporting === 'html' ? '正在导出…' : '导出 HTML'}</button>
      </div>
    </div>
    {!completed && <div className="notice">辩论完成后即可导出，当前记录不会生成不完整归档。</div>}
    <label className="checkbox-field export-private-option">
      <input type="checkbox" checked={includePrivateResearch} onChange={(event) => onIncludePrivateResearchChange(event.target.checked)} />
      包含私有研究
    </label>
    {includePrivateResearch && <div className="notice warning" role="alert"><strong>隐私提醒：</strong>导出的文件会包含正反方和主持人的私有研究内容。请确认接收者与分享范围。</div>}
    {message && <div className="notice success export-path" role="status">{message}</div>}
    {error && <div className="notice error" role="alert">导出失败：{error}</div>}
    <details className="export-history" open={records.length > 0}>
      <summary>导出历史（{records.length}）</summary>
      {records.length === 0 ? <p className="muted">尚未生成导出文件。</p> : <div className="export-record-list">
        {records.map((record) => <article className={`export-record status-${record.status}`} key={record.exportId}>
          <div><strong>{record.type === 'markdown' ? 'Markdown' : 'HTML'}</strong><span>{new Date(record.createdAt).toLocaleString('zh-CN')} · {formatFileSize(record.fileSize)}</span></div>
          <p className="export-record-path">{record.filePath}</p>
          <div className="export-record-meta">
            <span>{exportStatusLabel(record.status)}</span>
            {record.status === 'generating' && <span>{record.progress}%</span>}
            {record.includePrivateResearch && <span className="private-badge">包含私有研究</span>}
          </div>
          {record.status === 'generating' && <div className="export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={record.progress}><span style={{ width: `${record.progress}%` }} /></div>}
          {record.error && <div className="notice error"><strong>{record.error.titleZh}</strong>：{record.error.descriptionZh}</div>}
          {record.status === 'generating' ? <button className="button secondary export-delete" onClick={() => onCancelExport(record.exportId)}>取消导出</button> : confirmDeleteId === record.exportId ? <div className="compact-actions export-delete-confirm">
            <span>同时删除本地文件？</span>
            <button className="button ghost" onClick={onCancelDelete}>取消</button>
            <button className="button danger" onClick={() => onConfirmDelete(record.exportId)}>确认删除</button>
          </div> : <div className="compact-actions export-record-actions">
            {(record.status === 'failed' || record.status === 'cancelled') && <button className="button secondary" onClick={() => onRetryExport(record)}>重新导出</button>}
            <button className="button ghost export-delete" onClick={() => onRequestDelete(record.exportId)}>删除导出</button>
          </div>}
        </article>)}
      </div>}
    </details>
  </section>
}

function roleLabel(role: string): string {
  return { affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' }[role] ?? role
}
function historyStatusLabel(status: string): string {
  return { active: '当前记录', archived: '已归档', deleted: '回收站' }[status] ?? status
}
function researchStatusLabel(status: string): string {
  return { 'not-started': '尚未开始研究', planning: '研究规划中', researching: '研究进行中', drafting: '论证草拟中', completed: '研究已完成' }[status] ?? status
}
function exportStatusLabel(status: string): string {
  return { generating: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' }[status] ?? status
}
function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
