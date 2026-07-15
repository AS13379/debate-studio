import type { DebateHistoryListQueryDto, DebateHistorySummaryDto } from '../../../shared/ipc-contract'

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
  onExport?(debate: DebateHistorySummaryDto): void
  needsModelSetup?: boolean
  onOpenOnboarding?(): void
}

export function HomePage({
  debates, query = {}, loading, error, onQueryChange = () => undefined, onCreate, onCreateDemo, onOpen,
  onOpenHistory = onOpen, onExport = onOpenHistory, onOpenModels = () => undefined,
  hasMore = false, onLoadMore = () => undefined, needsModelSetup = false, onOpenOnboarding = onOpenModels
}: HomePageProps) {
  const availableTags = [...new Set([
    ...debates.flatMap((debate) => debate.tags),
    ...(query.tag ? [query.tag] : [])
  ])].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const status = query.status ?? 'active'

  return (
    <section className="page-stack" aria-labelledby="home-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">本地辩论工作台</p>
          <h1 id="home-title">辩论历史</h1>
          <p className="page-description">长期保存、整理和查找辩论；删除记录也可以恢复。</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={onCreate}>新建辩论</button>
          <button className="button primary" onClick={onCreateDemo}>创建 Mock 示例辩论</button>
        </div>
      </header>

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
            <article className={`debate-card history-${debate.historyStatus}`} key={debate.id}>
              <div className="card-topline">
                <span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span>
                <span className="history-favorite" aria-label={debate.favorite ? '已收藏' : '未收藏'}>{debate.favorite ? '★' : '☆'}</span>
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
                <button className="button ghost" onClick={() => onExport(debate)}>导出</button>
                <button className="button ghost" onClick={() => onOpenHistory(debate)}>详情与管理</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {hasMore && <button className="button secondary history-load-more" disabled={loading} onClick={onLoadMore}>{loading ? '正在加载…' : '加载更多历史记录'}</button>}
    </section>
  )
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
