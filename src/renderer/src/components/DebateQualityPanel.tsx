import { useEffect, useState } from 'react'

import type { DebateQualitySnapshotDto, DebateScoreDimensionDto } from '../../../shared/ipc-contract'

const dimensions: DebateScoreDimensionDto[] = [
  'logicalCompleteness', 'evidenceQuality', 'rebuttalEffectiveness',
  'factualAccuracy', 'argumentDepth', 'clarity'
]

export function DebateQualityPanel({ debateId, completed, refreshKey = 0 }: { debateId: string; completed: boolean; refreshKey?: number }) {
  const [quality, setQuality] = useState<DebateQualitySnapshotDto>()
  const [loading, setLoading] = useState(completed)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>()

  const load = async (): Promise<void> => {
    if (!completed) return
    setLoading(true)
    const result = await window.debateStudio.getDebateQuality({ id: debateId })
    if (result.ok) { setQuality(result.value); setError(undefined) }
    else setError(result.error.descriptionZh)
    setLoading(false)
  }

  useEffect(() => { void load() }, [debateId, completed, refreshKey])

  const regenerate = async (): Promise<void> => {
    setGenerating(true); setError(undefined)
    const result = await window.debateStudio.regenerateDebateQuality({ id: debateId })
    if (result.ok) setQuality(result.value)
    else setError(result.error.descriptionZh)
    setGenerating(false)
  }

  if (!completed) return null
  if (loading) return <section className="panel quality-panel muted" role="status">正在读取赛后评分…</section>
  if (!quality?.evaluation) return <section className="panel quality-panel">
    <div className="section-heading"><div><strong>赛后分析</strong><span>尚未生成结构化评分</span></div><button className="button primary" disabled={generating} onClick={() => void regenerate()}>{generating ? '生成中…' : '生成评分与复盘'}</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
  </section>

  const evaluation = quality.evaluation.evaluation
  return <section className="panel quality-panel" aria-labelledby="quality-panel-title">
    <div className="section-heading">
      <div><span className="eyebrow">赛后分析</span><strong id="quality-panel-title">{winnerLabel(evaluation.winner)}</strong><span>{quality.evidenceCount} 条证据 · {quality.turnCount} 个 Turn · Prompt v{quality.evaluation.promptVersion}</span></div>
      <button className="button secondary" disabled={generating} onClick={() => void regenerate()}>{generating ? '重新评分中…' : '用当前 Prompt 重新评分'}</button>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="quality-score-grid">
      {(['affirmative', 'negative'] as const).map((side) => <article key={side} className={`quality-side role-${side}`}>
        <h3>{side === 'affirmative' ? '正方' : '反方'}</h3>
        {dimensions.map((dimension) => <div className="quality-score-row" key={dimension}>
          <span>{dimensionLabel(dimension)}</span><b>{evaluation.scores[side][dimension].score.toFixed(1)}</b>
          <small>{evaluation.scores[side][dimension].reason}</small>
        </div>)}
        <details><summary>亮点与不足</summary><div className="quality-list-columns"><div><strong>亮点</strong><ul>{evaluation.strengths[side].map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>不足</strong><ul>{evaluation.weaknesses[side].map((item) => <li key={item}>{item}</li>)}</ul></div></div></details>
      </article>)}
    </div>
    <details className="quality-review">
      <summary><div><strong>赛后复盘</strong><span>{quality.review ? '公开复盘已生成' : '复盘尚未生成'}</span></div></summary>
      {quality.review && <div className="quality-review-body">
        <p>{quality.review.review.summary}</p>
        <ReviewList title="最佳论证" values={quality.review.review.bestArguments} />
        <ReviewList title="最佳反驳" values={quality.review.review.bestRebuttals} />
        <ReviewList title="错失机会" values={quality.review.review.missedOpportunities} />
        <ReviewList title="证据分析" values={quality.review.review.evidenceAnalysis} />
        <ReviewList title="改进建议" values={quality.review.review.improvementSuggestions} />
      </div>}
    </details>
    <details className="quality-review">
      <summary><div><strong>裁判公开分析</strong><span>转折点、证据使用与论证质量</span></div></summary>
      <div className="quality-review-body">
        <ReviewList title="关键转折" values={evaluation.keyTurningPoints} />
        <div className="quality-list-columns">
          <div><strong>正方证据与论证</strong><p>{evaluation.evidenceUsage.affirmative}</p><p>{evaluation.reasoningQuality.affirmative}</p></div>
          <div><strong>反方证据与论证</strong><p>{evaluation.evidenceUsage.negative}</p><p>{evaluation.reasoningQuality.negative}</p></div>
        </div>
      </div>
    </details>
  </section>
}

function ReviewList({ title, values }: { title: string; values: string[] }) {
  return <div><strong>{title}</strong><ul>{values.map((item) => <li key={item}>{item}</li>)}</ul></div>
}
function winnerLabel(winner: string): string { return { affirmative: '正方获胜', negative: '反方获胜', draw: '本场平局' }[winner] ?? winner }
function dimensionLabel(dimension: DebateScoreDimensionDto): string {
  return {
    logicalCompleteness: '逻辑完整性', evidenceQuality: '证据质量', rebuttalEffectiveness: '反驳有效性',
    factualAccuracy: '事实准确性', argumentDepth: '论证深度', clarity: '表达清晰度'
  }[dimension]
}
