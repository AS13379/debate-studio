import type { DebateSummaryDto } from '../../../shared/ipc-contract'

export interface HomePageProps {
  debates: DebateSummaryDto[]
  loading: boolean
  error?: string
  onCreate(): void
  onCreateDemo(): void
  onOpen(debate: DebateSummaryDto): void
}

export function HomePage({ debates, loading, error, onCreate, onCreateDemo, onOpen }: HomePageProps) {
  return (
    <section className="page-stack" aria-labelledby="home-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">本地辩论工作台</p>
          <h1 id="home-title">辩论列表</h1>
          <p className="page-description">配置角色模型，运行辩论，并在本机保留完整过程。</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={onCreate}>新建辩论</button>
          <button className="button primary" onClick={onCreateDemo}>创建 Mock 示例辩论</button>
        </div>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {loading && <div className="panel muted">正在读取本地辩论…</div>}
      {!loading && debates.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">辩</div>
          <h2>还没有辩论</h2>
          <p>先创建一个不访问网络的 Mock 示例，立即体验完整流程。</p>
          <button className="button primary" onClick={onCreateDemo}>创建 Mock 示例辩论</button>
        </div>
      )}
      {debates.length > 0 && (
        <div className="debate-grid">
          {debates.map((debate) => (
            <article className="debate-card" key={debate.id}>
              <div className="card-topline">
                <span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span>
                <time>{new Date(debate.createdAt).toLocaleString('zh-CN')}</time>
              </div>
              <h2>{debate.topic}</h2>
              <p>当前阶段：{stageLabel(debate.currentStage)}</p>
              <button className="button secondary" onClick={() => onOpen(debate)}>继续查看或运行</button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function statusLabel(status: string): string {
  return {
    draft: '草稿', running: '运行中', streaming: '生成中', paused: '已暂停', failed: '失败',
    interrupted: '已中断', stopped: '已停止', completed: '已完成', cancelled: '已取消'
  }[status] ?? status
}

export function stageLabel(stage: string): string {
  return {
    draft: '草稿', validating: '配置检查', moderating: '主持开场', affirmative_opening: '正方开篇',
    negative_opening: '反方开篇', rebuttal: '反驳', free_debate: '自由辩论', closing: '总结陈词',
    adjudication: '裁决', completed: '完成'
  }[stage] ?? stage
}
