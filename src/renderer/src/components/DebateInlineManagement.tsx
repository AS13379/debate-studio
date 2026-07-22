import { useEffect, useState } from 'react'

import type { DebateHistoryDetailDto, DebateHistoryResultDto } from '../../../shared/ipc-contract'
import { DeleteDebateConfirmation } from './DeleteDebateConfirmation'

export function DebateInlineManagement({ debateId, onChanged, onExit }: {
  debateId: string
  onChanged(): void | Promise<void>
  onExit(): void
}) {
  const [detail, setDetail] = useState<DebateHistoryDetailDto>()
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [includePrivateResearch, setIncludePrivateResearch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [activeExportId, setActiveExportId] = useState<string>()

  const load = async (): Promise<void> => {
    const result = await window.debateStudio.getDebateDetail({ id: debateId })
    if (!result.ok) setError(result.error.descriptionZh)
    else {
      setDetail(result.value)
      setTitle(result.value.customTitle ?? result.value.topic)
      setError(undefined)
    }
  }

  useEffect(() => { void load() }, [debateId])
  useEffect(() => {
    if (!activeExportId) return
    let disposed = false
    const refresh = async (): Promise<void> => {
      const result = await window.debateStudio.listExports()
      if (!result.ok || disposed) return
      const record = result.value.find((item) => item.exportId === activeExportId)
      if (!record || record.status === 'generating') return
      if (record.status === 'completed') setMessage(`导出成功：${record.filePath}`)
      else setError(record.error?.descriptionZh ?? '导出没有完成，请重新选择保存位置后重试。')
      setActiveExportId(undefined)
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 500)
    return () => { disposed = true; window.clearInterval(interval) }
  }, [activeExportId])

  const update = async (
    operation: Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>,
    successMessage: string,
    exitAfter = false
  ): Promise<void> => {
    setBusy(true); setError(undefined); setMessage(undefined)
    const result = await operation
    if (!result.ok) setError(result.error.descriptionZh)
    else {
      setDetail(result.value)
      setTitle(result.value.customTitle ?? result.value.topic)
      setMessage(successMessage)
      await onChanged()
      if (exitAfter) onExit()
    }
    setBusy(false)
  }

  const runExport = async (type: 'markdown' | 'html'): Promise<void> => {
    setBusy(true); setError(undefined); setMessage(undefined)
    const input = { debateId, exportOptions: { includePrivateResearch } }
    const result = type === 'markdown'
      ? await window.debateStudio.exportMarkdown(input)
      : await window.debateStudio.exportHtml(input)
    if (result.ok) {
      setActiveExportId(result.value.exportId)
      setMessage('已选择保存位置并创建导出任务；完成后会再次提示。')
    } else if (result.error.code !== 'EXPORT_DESTINATION_CANCELLED') setError(result.error.descriptionZh)
    setBusy(false)
  }

  const inFlight = detail ? ['running', 'streaming'].includes(detail.status) : false

  return <>
    <details className="panel collapsible-section live-management-panel">
      <summary><div><strong>管理与导出</strong><span>{detail ? `${detail.favorite ? '已收藏 · ' : ''}${detail.tags.length} 个标签 · 点击展开` : '正在读取历史信息…'}</span></div></summary>
      <div className="collapsible-body live-management-body">
        {error && <div className="notice error dismissible-notice" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError(undefined)}>×</button></div>}
        {message && <div className="notice success dismissible-notice" role="status"><span>{message}</span><button aria-label="关闭导出提示" onClick={() => setMessage(undefined)}>×</button></div>}
        {detail && <>
          <div className="live-management-grid">
            <section>
              <div className="section-heading"><div><strong>整理记录</strong><span>名称、收藏和标签不影响辩论内容</span></div></div>
              <form className="history-rename-row" onSubmit={(event) => {
                event.preventDefault()
                void update(window.debateStudio.renameDebate({ id: debateId, customTitle: title }), '名称已保存。')
              }}>
                <label className="field"><span>自定义名称</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
                <button className="button secondary" disabled={busy || !title.trim()} type="submit">保存</button>
              </form>
              <div className="tag-list live-management-tags">
                {detail.tags.length === 0 && <span className="muted">尚无标签</span>}
                {detail.tags.map((item) => <span className="tag-pill removable" key={item}>{item}<button aria-label={`移除标签 ${item}`} onClick={() => void update(window.debateStudio.removeTag({ id: debateId, tag: item }), '标签已移除。')}>×</button></span>)}
              </div>
              <form className="live-management-tag-form" onSubmit={(event) => {
                event.preventDefault()
                if (!tag.trim()) return
                void update(window.debateStudio.addTag({ id: debateId, tag }), '标签已添加。').then(() => setTag(''))
              }}><input aria-label="新标签" value={tag} maxLength={50} placeholder="添加标签" onChange={(event) => setTag(event.target.value)} /><button className="button ghost" disabled={busy || !tag.trim()} type="submit">添加</button></form>
            </section>
            <section>
              <div className="section-heading"><div><strong>快速操作</strong><span>导出由主进程生成，默认只含公开内容</span></div></div>
              <div className="compact-actions live-management-actions">
                <button className="button secondary" disabled={busy} onClick={() => void update(window.debateStudio.toggleFavorite({ id: debateId, favorite: !detail.favorite }), detail.favorite ? '已取消收藏。' : '已收藏。')}>{detail.favorite ? '★ 取消收藏' : '☆ 收藏'}</button>
                <button className="button secondary" disabled={busy || detail.status !== 'completed'} onClick={() => void runExport('markdown')}>导出 Markdown</button>
                <button className="button primary" disabled={busy || detail.status !== 'completed'} onClick={() => void runExport('html')}>导出 HTML</button>
              </div>
              {detail.status !== 'completed' && <p className="muted live-management-hint">辩论完成后可导出完整归档。</p>}
              <label className="checkbox-field export-private-option"><input type="checkbox" checked={includePrivateResearch} onChange={(event) => setIncludePrivateResearch(event.target.checked)} />包含私有研究</label>
              {includePrivateResearch && <div className="notice warning">导出文件将包含双方和主持人的私有研究，请谨慎分享。</div>}
            </section>
          </div>
          <div className="live-management-danger">
            <p>{inFlight ? '辩论正在运行，请先停止再归档或删除。' : '归档或软删除后将返回历史列表。'}</p>
            <div className="compact-actions">
              {detail.historyStatus === 'active' && <button className="button secondary" disabled={busy || inFlight} onClick={() => void update(window.debateStudio.archiveDebate({ id: debateId }), '已归档。', true)}>归档</button>}
              {detail.historyStatus !== 'active' && <button className="button secondary" disabled={busy} onClick={() => void update(window.debateStudio.restoreDebate({ id: debateId }), '已恢复。')}>恢复</button>}
              {detail.historyStatus !== 'deleted' && <button className="button danger" disabled={busy || inFlight} onClick={() => setConfirmDelete(true)}>软删除…</button>}
            </div>
          </div>
        </>}
      </div>
    </details>
    {confirmDelete && detail && <DeleteDebateConfirmation detail={detail} busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => {
      setConfirmDelete(false)
      void update(window.debateStudio.deleteDebate({ id: debateId, confirmed: true }), '已移入回收站。', true)
    }} />}
  </>
}
