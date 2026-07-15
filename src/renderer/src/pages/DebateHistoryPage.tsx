import { useEffect, useState } from 'react'

import type { DebateHistoryDetailDto, DebateHistoryResultDto } from '../../../shared/ipc-contract'
import { MarkdownContent } from '../components/MarkdownContent'
import { stageLabel, statusLabel } from './HomePage'

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

export function DeleteDebateConfirmation({ detail, busy, onCancel, onConfirm }: {
  detail: DebateHistoryDetailDto
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  return <div className="modal-backdrop" role="presentation"><section className="delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="delete-confirmation-title">
    <p className="eyebrow">软删除确认</p>
    <h2 id="delete-confirmation-title">确定删除“{detail.displayTitle}”吗？</h2>
    <p>该记录会从当前列表移入回收站。以下关联内容将一起从日常视图隐藏，但不会被物理删除：</p>
    <ul>
      <li>辩论记录：{detail.deleteImpact.debateRecords}</li>
      <li>运行事件：{detail.deleteImpact.eventRecords}</li>
      <li>研究索引：{detail.deleteImpact.researchIndexes}</li>
      <li>证据关联：{detail.deleteImpact.evidenceLinks}</li>
      <li>Turn：{detail.deleteImpact.turnRecords}</li>
    </ul>
    <div className="notice">Provider、ModelProfile 和系统加密凭据均不会受到影响，并可随时恢复此辩论。</div>
    <div className="form-actions">
      <button className="button secondary" disabled={busy} onClick={onCancel}>取消</button>
      <button className="button danger" disabled={busy} onClick={onConfirm}>确认软删除</button>
    </div>
  </section></div>
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
