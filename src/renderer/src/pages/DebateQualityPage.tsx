import { useEffect, useMemo, useState } from 'react'

import type { CostSummaryDto, DebateQualityOverviewItemDto } from '../../../shared/ipc-contract'

export function DebateQualityPage({ onOpenDebate }: { onOpenDebate(debateId: string): void }) {
  const [items, setItems] = useState<DebateQualityOverviewItemDto[]>([])
  const [costs, setCosts] = useState<CostSummaryDto>()
  const [error, setError] = useState<string>()
  useEffect(() => { void Promise.all([window.debateStudio.listDebateQuality(), window.debateStudio.getCostSummary()]).then(([quality, cost]) => {
    if (quality.ok) setItems(quality.value); else setError(quality.error.descriptionZh)
    if (cost.ok) setCosts(cost.value)
  }) }, [])
  const average = items.length ? items.reduce((sum, item) => sum + item.averageScore, 0) / items.length : 0
  const promptPerformance = useMemo(() => Object.entries(items.reduce<Record<string, number[]>>((map, item) => {
    const key = `v${item.promptVersion}`; (map[key] ??= []).push(item.averageScore); return map
  }, {})).map(([version, values]) => ({ version, average: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length })), [items])
  const commonIssues = useMemo(() => Object.entries(items.flatMap((item) => item.weaknesses).reduce<Record<string, number>>((map, issue) => {
    map[issue] = (map[issue] ?? 0) + 1
    return map
  }, {})).sort((left, right) => right[1] - left[1]).slice(0, 6), [items])
  const trend = useMemo(() => [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(-12), [items])
  return <section className="page-stack quality-page" aria-labelledby="quality-title">
    <header className="page-header compact"><div><span className="eyebrow">DEBATE QUALITY</span><h1 id="quality-title">质量分析</h1><p className="page-description">跟踪已完成辩论的公开评分、证据和 Prompt 版本表现。</p></div></header>
    {error && <div className="notice error">{error}</div>}
    <div className="quality-kpis"><article><span>已评分辩论</span><b>{items.length}</b></article><article><span>平均评分</span><b>{average.toFixed(1)}</b></article><article><span>总证据</span><b>{items.reduce((sum, item) => sum + item.evidenceCount, 0)}</b></article><article><span>已知总费用</span><b>{formatCost(costs?.totalCost)}</b></article></div>
    <section className="panel"><div className="section-heading"><div><strong>Prompt 版本表现</strong><span>仅展示已有结构化评分的样本</span></div></div><div className="quality-prompt-performance">{promptPerformance.map((item) => <div key={item.version}><strong>{item.version}</strong><span>平均评分 {item.average.toFixed(1)}</span><span>{item.count} 场</span></div>)}</div></section>
    <div className="quality-insight-grid">
      <section className="panel"><div className="section-heading"><div><strong>评分趋势</strong><span>最近 {trend.length} 场</span></div></div><div className="quality-trend">{trend.length === 0 ? <span className="muted">暂无趋势数据</span> : trend.map((item) => <div key={item.debateId} title={`${item.title}：${item.averageScore.toFixed(1)}`}><span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span><i><b style={{ width: `${item.averageScore * 10}%` }} /></i><strong>{item.averageScore.toFixed(1)}</strong></div>)}</div></section>
      <section className="panel"><div className="section-heading"><div><strong>常见不足</strong><span>来自裁判的公开简短理由</span></div></div>{commonIssues.length === 0 ? <span className="muted">暂无可汇总项</span> : <ol className="quality-common-issues">{commonIssues.map(([issue, count]) => <li key={issue}><span>{issue}</span><b>{count} 次</b></li>)}</ol>}</section>
    </div>
    <section className="panel"><div className="section-heading"><div><strong>单场质量</strong><span>点击查看完整复盘</span></div></div>{items.length === 0 ? <div className="empty-state compact"><h2>暂无评分</h2><p>完成一场 Mock 辩论后会自动出现在这里。</p></div> : <div className="quality-history-list">{items.map((item) => <button key={item.debateId} onClick={() => onOpenDebate(item.debateId)}><div className="quality-history-copy"><strong>{item.title}</strong><span>{winnerLabel(item.winner)} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></div><div className="quality-history-score"><b>{item.averageScore.toFixed(1)}</b><span>/ 10</span></div><small>{item.evidenceCount} 证据 · {item.turnCount} Turn · Prompt v{item.promptVersion} · {item.models.join(' / ') || '模型未知'} · 费用 {formatCost(costs?.byDebate.find((cost) => cost.debateId === item.debateId)?.totalCost)}</small></button>)}</div>}</section>
  </section>
}
function winnerLabel(value: string): string { return { affirmative: '正方胜', negative: '反方胜', draw: '平局' }[value] ?? value }
function formatCost(value?: number): string { return value === undefined ? '未知' : `$${value.toFixed(4)}` }
