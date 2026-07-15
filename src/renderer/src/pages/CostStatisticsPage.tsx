import { useEffect, useState } from 'react'

import type { CostSummaryDto, ModelProfileDto, ProviderPricingDto } from '../../../shared/ipc-contract'

export function CostStatisticsPage() {
  const [summary, setSummary] = useState<CostSummaryDto>()
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [pricing, setPricing] = useState<ProviderPricingDto[]>([])
  const [editing, setEditing] = useState<string>()
  const [inputPrice, setInputPrice] = useState('')
  const [outputPrice, setOutputPrice] = useState('')
  const load = async () => {
    const [summaryResult, profileResult, pricingResult] = await Promise.all([window.debateStudio.getCostSummary(), window.debateStudio.listModelProfiles(), window.debateStudio.listProviderPricing()])
    if (summaryResult.ok) setSummary(summaryResult.value)
    if (profileResult.ok) setProfiles(profileResult.value)
    if (pricingResult.ok) setPricing(pricingResult.value)
  }
  useEffect(() => { void load() }, [])
  const begin = (profile: ModelProfileDto) => {
    const value = pricing.find((item) => item.modelProfileId === profile.id)
    setEditing(profile.id); setInputPrice(value?.inputPricePerMillion.toString() ?? ''); setOutputPrice(value?.outputPricePerMillion.toString() ?? '')
  }
  const save = async (profileId: string) => {
    await window.debateStudio.saveProviderPricing({ modelProfileId: profileId, inputPricePerMillion: Number(inputPrice), outputPricePerMillion: Number(outputPrice), currency: 'USD' })
    setEditing(undefined); await load()
  }
  return <section className="page-stack"><header className="page-header"><div><p className="eyebrow">UsageRecord</p><h1>成本统计</h1><p className="page-description">只计算服务商实际返回的 Token；价格只使用你明确配置的定价，不自动猜测。</p></div></header>
    <div className="cost-kpis"><article><span>调用</span><b>{summary?.totalCalls ?? 0}</b></article><article><span>总 Token</span><b>{formatUnknown(summary?.totalTokens)}</b></article><article><span>估算费用</span><b>{summary?.totalCost === undefined ? '未知' : `$${summary.totalCost.toFixed(4)}`}</b></article><article><span>Token 未知调用</span><b>{summary?.unknownTokenCalls ?? 0}</b></article></div>
    <div className="panel"><div className="section-heading"><div><strong>模型定价</strong><span>单位：每百万 Token / USD</span></div></div><div className="pricing-list">{profiles.map((profile) => { const value = pricing.find((item) => item.modelProfileId === profile.id); return <div className="pricing-row" key={profile.id}><div><strong>{profile.displayName}</strong><span>{profile.modelId}</span></div>{editing === profile.id ? <><input type="number" min="0" step="0.01" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} placeholder="输入价格" /><input type="number" min="0" step="0.01" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} placeholder="输出价格" /><button className="button primary" onClick={() => void save(profile.id)}>保存</button></> : <><span>{value ? `输入 $${value.inputPricePerMillion} · 输出 $${value.outputPricePerMillion}` : '未配置价格'}</span><button className="button secondary" onClick={() => begin(profile)}>配置</button></>}</div>})}</div></div>
    <div className="panel"><strong>按模型</strong><div className="cost-ranking">{summary?.byModel.map((item) => <div key={item.modelId}><span>{item.modelId}</span><span>{item.calls} 次 · {formatUnknown(item.totalTokens)} Token · {item.totalCost === undefined ? item.pricingConfigured ? 'Token 未知' : '未配置价格' : `$${item.totalCost.toFixed(4)}`}</span></div>)}</div></div>
  </section>
}

function formatUnknown(value?: number): string { return value === undefined ? '未知' : value.toLocaleString() }
