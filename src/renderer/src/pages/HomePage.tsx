import { useEffect, useMemo, useState } from 'react'

import type { DebateHistoryListQueryDto, DebateHistorySummaryDto } from '../../../shared/ipc-contract'
import {
  executeHistoryBatchAction,
  summarizeHistoryBatchResult,
  type HistoryBatchAction,
  type HistoryBatchResult
} from '../history-batch-actions'
import { PageHeader } from '../components/UnifiedWorkbench'

export interface HomePageProps {
  debates: DebateHistorySummaryDto[]
  query?: DebateHistoryListQueryDto
  loading: boolean
  error?: string
  hasMore?: boolean
  onQueryChange?(query: DebateHistoryListQueryDto): void
  onCreate(): void
  onLoadMore?(): void
  onCreateDemo(): void
  onOpenModels?(): void
  onOpen(debate: DebateHistorySummaryDto): void
  onOpenHistory?(debate: DebateHistorySummaryDto): void
  onChanged?(): void | Promise<void>
  needsModelSetup?: boolean
  onOpenOnboarding?(): void
}

export function HomePage({
  debates, query = {}, loading, error, onQueryChange = () => undefined, onCreate, onCreateDemo, onOpen,
  onOpenHistory = onOpen, onChanged = () => undefined, onOpenModels = () => undefined,
  hasMore = false, onLoadMore = () => undefined, needsModelSetup = false, onOpenOnboarding = onOpenModels
}: HomePageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [batchAction, setBatchAction] = useState<HistoryBatchAction>()
  const [batchProgress, setBatchProgress] = useState('')
  const [operationMessage, setOperationMessage] = useState<string>()
  const [operationIssues, setOperationIssues] = useState<HistoryBatchResult>()
  const [includePrivateResearch, setIncludePrivateResearch] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DebateHistorySummaryDto[]>([])
  const availableTags = [...new Set([
    ...debates.flatMap((debate) => debate.tags),
    ...(query.tag ? [query.tag] : [])
  ])].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const status = query.status ?? 'active'
  const selectedDebates = useMemo(() => debates.filter((debate) => selectedIds.has(debate.id)), [debates, selectedIds])
  const allVisibleSelected = debates.length > 0 && debates.every((debate) => selectedIds.has(debate.id))

  useEffect(() => {
    const visible = new Set(debates.map((debate) => debate.id))
    setSelectedIds((current) => new Set([...current].filter((id) => visible.has(id))))
  }, [debates])

  const toggleSelection = (id: string): void => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const runBatchAction = async (action: HistoryBatchAction, targets = selectedDebates): Promise<void> => {
    if (!targets.length) return
    const operatesOnCurrentSelection = targets === selectedDebates
    setBatchAction(action)
    setBatchProgress(`0 / ${targets.length}`)
    setOperationMessage(undefined)
    setOperationIssues(undefined)
    const result = await executeHistoryBatchAction(
      window.debateStudio,
      targets,
      action,
      includePrivateResearch,
      (completed, total) => setBatchProgress(`${completed} / ${total}`)
    )
    setOperationMessage(summarizeHistoryBatchResult(result))
    setOperationIssues(result.failed.length || result.skipped.length ? result : undefined)
    setBatchAction(undefined)
    setBatchProgress('')
    if (operatesOnCurrentSelection) setSelectedIds(new Set())
    await onChanged()
  }

  const requestDelete = (targets: DebateHistorySummaryDto[]): void => {
    if (targets.length) setPendingDelete(targets)
  }

  return (
    <section className="page-stack" aria-labelledby="home-title">
      <PageHeader
        id="home-title"
        eyebrow="本地辩论工作台"
        title="辩论历史"
        description="长期保存、整理和查找辩论；删除记录也可以恢复。"
        actions={<>
          <button className="button secondary" onClick={onCreate}>新建辩论</button>
          <button className="button primary" onClick={onCreateDemo}>创建 Mock 示例辩论</button>
        </>}
      />

      {needsModelSetup && <div className="panel model-setup-prompt"><div><strong>还没有配置真实 AI 服务</strong><span>Mock 辩论仍可使用；准备好后可用引导安全保存 API Key。</span></div><button className="button primary" onClick={onOpenOnboarding}>开始配置 AI 服务</button></div>}

      <div className="panel history-toolbar" aria-label="历史筛选">
        <label className="field history-search">
          搜索
          <input
            type="search"
            placeholder="搜索自定义名称或辩题"
            value={query.search ?? ''}
            onChange={(event) => onQueryChange({ ...query, search: event.target.value })}
          />
        </label>
        <label className="field">
          时间排序
          <select value={query.sort ?? 'updated-desc'} onChange={(event) => onQueryChange({
            ...query, sort: event.target.value as NonNullable<DebateHistoryListQueryDto['sort']>
          })}>
            <option value="updated-desc">最近更新</option>
            <option value="updated-asc">最早更新</option>
            <option value="created-desc">最新创建</option>
            <option value="created-asc">最早创建</option>
          </select>
        </label>
        <label className="field">
          标签
          <select value={query.tag ?? ''} onChange={(event) => onQueryChange({ ...query, tag: event.target.value || undefined })}>
            <option value="">全部标签</option>
            {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        <label className="checkbox-field history-favorite-filter">
          <input
            type="checkbox"
            checked={query.favoriteOnly ?? false}
            onChange={(event) => onQueryChange({ ...query, favoriteOnly: event.target.checked })}
          />
          只看收藏
        </label>
      </div>

      <div className="history-status-tabs" role="tablist" aria-label="历史状态">
        {([
          ['active', '当前记录'], ['archived', '已归档'], ['deleted', '回收站']
        ] as const).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={status === value}
            className={status === value ? 'active' : ''}
            onClick={() => onQueryChange({ ...query, status: value, tag: undefined })}
          >{label}</button>
        ))}
      </div>

      {debates.length > 0 && <section className="panel history-batch-toolbar" aria-label="批量管理">
        <div className="history-selection-summary">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => setSelectedIds(event.target.checked ? new Set(debates.map((debate) => debate.id)) : new Set())}
            />
            全选当前 {debates.length} 场
          </label>
          <strong>{selectedDebates.length ? `已选 ${selectedDebates.length} 场` : '勾选后可批量管理'}</strong>
          {batchAction && <span className="muted">正在处理 {batchProgress}</span>}
        </div>
        <div className="history-batch-actions">
          <button className="button ghost" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('favorite')}>批量收藏</button>
          <button className="button ghost" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('unfavorite')}>取消收藏</button>
          {status === 'active'
            ? <button className="button secondary" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('archive')}>归档</button>
            : <button className="button secondary" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('restore')}>恢复</button>}
          <button className="button secondary" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('export-markdown')}>导出 MD</button>
          <button className="button secondary" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => void runBatchAction('export-html')}>导出 HTML</button>
          {status !== 'deleted' && <button className="button danger" disabled={!selectedDebates.length || Boolean(batchAction)} onClick={() => requestDelete(selectedDebates)}>软删除</button>}
        </div>
        <label className="checkbox-field history-batch-private">
          <input type="checkbox" checked={includePrivateResearch} onChange={(event) => setIncludePrivateResearch(event.target.checked)} />
          导出时包含私有研究
        </label>
        {includePrivateResearch && <p className="history-batch-warning">批量导出将包含各方私有研究，请确认分享范围。</p>}
      </section>}

      {operationMessage && <div className="notice success" role="status">{operationMessage}</div>}
      {operationIssues && <details className="notice warning history-operation-issues">
        <summary>查看跳过或失败的记录</summary>
        <ul>{[...operationIssues.skipped, ...operationIssues.failed].map((item) => <li key={`${item.debateId}-${item.reason}`}><strong>{item.title}</strong>：{item.reason}</li>)}</ul>
      </details>}

      {error && <div className="notice error" role="alert">{error}</div>}
      {loading && <div className="panel muted">正在读取本地辩论…</div>}
      {!loading && debates.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">辩</div>
          {status === 'active' && !query.search && !query.favoriteOnly && !query.tag && <p className="eyebrow">欢迎使用 Debate Studio</p>}
          <h2>{emptyTitle(status, query)}</h2>
          <p>{emptyDescription(status, query)}</p>
          {status === 'active' && !query.search && !query.favoriteOnly && !query.tag && (
            <div className="compact-actions empty-actions">
              <button className="button primary" onClick={onCreateDemo}>创建 Mock 示例辩论</button>
              <button className="button secondary" onClick={onOpenModels}>配置真实模型</button>
            </div>
          )}
        </div>
      )}
      {debates.length > 0 && (
        <div className="debate-grid">
          {debates.map((debate) => (
            <article className={`debate-card history-${debate.historyStatus}${selectedIds.has(debate.id) ? ' selected' : ''}`} key={debate.id}>
              <div className="card-topline">
                <label className="history-card-select">
                  <input type="checkbox" checked={selectedIds.has(debate.id)} onChange={() => toggleSelection(debate.id)} />
                  <span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span>
                </label>
                <button
                  className="history-favorite"
                  aria-label={debate.favorite ? '取消收藏' : '收藏辩论'}
                  disabled={Boolean(batchAction)}
                  onClick={() => void runBatchAction(debate.favorite ? 'unfavorite' : 'favorite', [debate])}
                >{debate.favorite ? '★' : '☆'}</button>
              </div>
              <h2>{debate.displayTitle}</h2>
              {debate.customTitle && <p className="history-topic">原辩题：{debate.topic}</p>}
              <div className="history-card-facts">
                <span>当前阶段：{stageLabel(debate.currentStage)}</span>
                <span>创建：{formatDate(debate.createdAt)}</span>
                <span>更新：{formatDate(debate.updatedAt)}</span>
              </div>
              {debate.tags.length > 0 && <div className="tag-list">{debate.tags.map((tag) => <span className="tag-pill" key={tag}>{tag}</span>)}</div>}
              <div className="compact-actions history-card-actions">
                {debate.historyStatus === 'active' && <button className="button secondary" onClick={() => onOpen(debate)}>继续查看或运行</button>}
                {debate.status === 'completed' && <button className="button ghost" disabled={Boolean(batchAction)} onClick={() => void runBatchAction('export-html', [debate])}>导出 HTML</button>}
                <details className="history-card-menu">
                  <summary className="button ghost">管理</summary>
                  <div className="history-card-menu-popover">
                    <button onClick={() => onOpenHistory(debate)}>详情、重命名与标签</button>
                    <button onClick={() => void runBatchAction(debate.favorite ? 'unfavorite' : 'favorite', [debate])}>{debate.favorite ? '取消收藏' : '收藏'}</button>
                    {debate.status === 'completed' && <button onClick={() => void runBatchAction('export-markdown', [debate])}>导出 Markdown</button>}
                    {debate.historyStatus === 'active' && <button onClick={() => void runBatchAction('archive', [debate])}>归档</button>}
                    {debate.historyStatus !== 'active' && <button onClick={() => void runBatchAction('restore', [debate])}>恢复到当前记录</button>}
                    {debate.historyStatus !== 'deleted' && <button className="danger" onClick={() => requestDelete([debate])}>软删除…</button>}
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
      {hasMore && <button className="button secondary history-load-more" disabled={loading} onClick={onLoadMore}>{loading ? '正在加载…' : '加载更多历史记录'}</button>}
      {pendingDelete.length > 0 && <BatchDeleteConfirmation debates={pendingDelete} busy={Boolean(batchAction)} onCancel={() => setPendingDelete([])} onConfirm={() => {
        const targets = pendingDelete
        setPendingDelete([])
        void runBatchAction('delete', targets)
      }} />}
    </section>
  )
}

export function BatchDeleteConfirmation({ debates, busy, onCancel, onConfirm }: {
  debates: DebateHistorySummaryDto[]
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  return <div className="modal-backdrop" role="presentation"><section className="delete-confirmation batch-delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="batch-delete-title">
    <p className="eyebrow">批量软删除</p>
    <h2 id="batch-delete-title">将 {debates.length} 场辩论移入回收站？</h2>
    <p>辩论、Turn、运行事件、研究索引和证据关联会从日常视图隐藏，但不会被物理删除。</p>
    <ul className="batch-delete-list">{debates.slice(0, 6).map((debate) => <li key={debate.id}>{debate.displayTitle}</li>)}{debates.length > 6 && <li>另有 {debates.length - 6} 场…</li>}</ul>
    <div className="notice">Provider、ModelProfile、API Key 和已导出文件不受影响；所有记录可在回收站恢复。</div>
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button className="button danger" disabled={busy} onClick={onConfirm}>确认软删除</button></div>
  </section></div>
}

function emptyTitle(status: string, query: DebateHistoryListQueryDto): string {
  if (query.search || query.favoriteOnly || query.tag) return '没有符合筛选条件的辩论'
  if (status === 'archived') return '还没有归档记录'
  if (status === 'deleted') return '回收站是空的'
  return '欢迎，这里还没有辩论'
}

function emptyDescription(status: string, query: DebateHistoryListQueryDto): string {
  if (query.search || query.favoriteOnly || query.tag) return '换一个关键词或调整筛选条件试试。'
  if (status === 'archived') return '归档的辩论会显示在这里，并且可以随时恢复。'
  if (status === 'deleted') return '软删除的辩论会显示在这里，关联数据不会立即丢失。'
  return '无需配置 API。Mock 示例完全在本地运行；需要时也可以稍后配置真实模型。'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

export function statusLabel(status: string): string {
  return {
    draft: '草稿', running: '运行中', streaming: '生成中', paused: '已暂停', failed: '失败',
    interrupted: '已中断', stopped: '已停止', completed: '已完成', cancelled: '已取消'
  }[status] ?? status
}

export function stageLabel(stage: string): string {
  return {
    draft: '草稿', validating: '配置检查', moderating: '主持开场', public_pool: '公共资源池',
    affirmative_planning: '正方研究计划', negative_planning: '反方研究计划',
    affirmative_research: '正方私有研究', negative_research: '反方私有研究', argument_drafting: '论证草拟',
    affirmative_opening: '正方开篇', negative_opening: '反方开篇', cross_examination: '交叉质询',
    rebuttal: '反驳', free_debate: '自由辩论', negative_closing: '反方总结', affirmative_closing: '正方总结', closing: '总结陈词',
    adjudication: '裁决', completed: '完成'
  }[stage] ?? stage
}
