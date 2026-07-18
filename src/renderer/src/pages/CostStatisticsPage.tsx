import { useEffect, useState } from 'react'

import type { CostSummaryDto, ProviderPricingDto } from '../../../shared/ipc-contract'

export function CostStatisticsPage() {
  const [summary, setSummary] = useState<CostSummaryDto>()
  const [pricing, setPricing] = useState<ProviderPricingDto[]>([])

  useEffect(() => {
    void Promise.all([
      window.debateStudio.getCostSummary(),
      window.debateStudio.listProviderPricing()
    ]).then(([summaryResult, pricingResult]) => {
      if (summaryResult.ok) setSummary(summaryResult.value)
      if (pricingResult.ok) setPricing(pricingResult.value)
    })
  }, [])

  return <section className="page-stack">
    <header className="page-header"><div>
      <p className="eyebrow">UsageRecord</p>
      <h1>成本统计</h1>
      <p className="page-description">只计算服务商实际返回的 Token；模型价格来自服务商官方定价，应用自动匹配，无需手动配置。</p>
    </div></header>

    <div className="cost-kpis">
      <article><span>调用</span><b>{summary?.totalCalls ?? 0}</b></article>
      <article><span>总 Token</span><b>{formatUnknown(summary?.totalTokens)}</b></article>
      <article><span>估算费用</span><b>{formatCurrencyTotals(summary?.totalsByCurrency)}</b></article>
      <article><span>Token 未知调用</span><b>{summary?.unknownTokenCalls ?? 0}</b></article>
    </div>

    <div className="panel">
      <div className="section-heading"><div>
        <strong>模型定价</strong>
        <span>单位：每百万 Token；输入费用按缓存未命中价估算，阶梯价按实际输入 Token 自动选择</span>
      </div></div>
      <div className="pricing-list">
        {pricing.length === 0
          ? <div className="empty-state compact"><strong>暂无可匹配的官方定价</strong><span>应用不会为自定义或未确认的模型猜测价格。</span></div>
          : pricing.map((value) => <PricingRow key={value.modelProfileId} value={value} />)}
      </div>
    </div>

    <div className="panel"><strong>按模型</strong><div className="cost-ranking">
      {summary?.byModel.map((item) => <div key={item.modelId}>
        <span>{item.modelId}</span>
        <span>{item.calls} 次 · {formatUnknown(item.totalTokens)} Token · {item.costsByCurrency.length
          ? formatCurrencyTotals(item.costsByCurrency)
          : item.pricingConfigured ? 'Token 未知' : '暂无官方定价'}</span>
      </div>)}
    </div></div>
  </section>
}

function PricingRow({ value }: { value: ProviderPricingDto }) {
  return <div className="pricing-row">
    <div><strong>{value.modelId}</strong><span>{value.sourceLabel ?? '本地定价记录'}</span></div>
    <div className="pricing-values">
      <strong>输入 {formatUnitPrice(value.inputPricePerMillion, value.currency)}</strong>
      <span>{value.cacheHitInputPricePerMillion === undefined ? '缓存价未知' : `缓存命中 ${formatUnitPrice(value.cacheHitInputPricePerMillion, value.currency)}`}</span>
    </div>
    <div className="pricing-values"><strong>输出 {formatUnitPrice(value.outputPricePerMillion, value.currency)}</strong><span>每百万 Token</span></div>
    {value.sourceUrl
      ? <button className="button ghost official-link" onClick={() => void window.debateStudio.openExternalUrl({ url: value.sourceUrl! })}>官方来源 · {value.sourceVerifiedAt}</button>
      : <span className="pricing-source">来源未记录</span>}
    {value.pricingNoteZh && <small className="pricing-note">{value.pricingNoteZh}</small>}
  </div>
}

function formatUnitPrice(value: number, currency: string): string {
  return `${currency === 'CNY' ? '¥' : '$'}${value}`
}

function formatCurrencyTotals(rows?: Array<{ currency: string; totalCost: number }>): string {
  if (!rows?.length) return '未知'
  return rows.map((row) => `${row.currency === 'CNY' ? '¥' : '$'}${row.totalCost.toFixed(4)}`).join(' · ')
}

function formatUnknown(value?: number): string {
  return value === undefined ? '未知' : value.toLocaleString()
}
