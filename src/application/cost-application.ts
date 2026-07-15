import { randomUUID } from 'node:crypto'

import { CostCalculator, type ProviderPricing } from '../cost'
import type { PersistenceContext, UsageRecord } from '../persistence'
import type { CostSummaryDto, ProviderPricingDto, SaveProviderPricingInputDto, WorkbenchResultDto } from '../shared/workbench-dtos'

export class CostApplication {
  private readonly calculator = new CostCalculator()
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly persistence: PersistenceContext, options: { now?: () => Date; createId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  listPricing(): WorkbenchResultDto<ProviderPricingDto[]> {
    const result = this.persistence.repositories.providerPricing.list()
    return result.ok ? { ok: true, value: result.value } : this.failure('PRICING_READ_FAILED', '定价读取失败')
  }

  savePricing(input: SaveProviderPricingInputDto): WorkbenchResultDto<ProviderPricingDto> {
    if (input.inputPricePerMillion < 0 || input.outputPricePerMillion < 0 || !input.currency.trim()) {
      return this.failure('PRICING_INVALID', '定价配置无效')
    }
    const profile = this.persistence.repositories.modelProfiles.findById(input.modelProfileId)
    if (!profile.ok || !profile.value) return this.failure('MODEL_PROFILE_NOT_FOUND', '模型配置不存在')
    const existing = this.persistence.repositories.providerPricing.findByModelProfile(input.modelProfileId)
    const pricing: ProviderPricing = {
      id: existing.ok && existing.value ? existing.value.id : this.createId(),
      modelProfileId: input.modelProfileId,
      modelId: profile.value.modelId,
      inputPricePerMillion: input.inputPricePerMillion,
      outputPricePerMillion: input.outputPricePerMillion,
      currency: input.currency.trim().toUpperCase(),
      updatedAt: this.now().toISOString()
    }
    const saved = this.persistence.repositories.providerPricing.save(pricing)
    return saved.ok ? { ok: true, value: pricing } : this.failure('PRICING_SAVE_FAILED', '定价保存失败')
  }

  getSummary(): WorkbenchResultDto<CostSummaryDto> {
    const usages = this.persistence.repositories.usage.listAll()
    const pricing = this.persistence.repositories.providerPricing.list()
    const sessions = this.persistence.repositories.debates.list()
    if (!usages.ok || !pricing.ok || !sessions.ok) return this.failure('COST_SUMMARY_FAILED', '成本统计读取失败')
    const pricingByProfile = new Map(pricing.value.map((item) => [item.modelProfileId, item]))
    const modelBuckets = new Map<string, { calls: number; tokens: number; knownTokens: number; cost: number; knownCost: number; pricingConfigured: boolean }>()
    const debateBuckets = new Map<string, { topic: string; calls: number; tokens: number; knownTokens: number; cost: number; knownCost: number }>()
    const sessionToDebate = new Map<string, string>()
    for (const debate of sessions.value) {
      const debateSessions = this.persistence.repositories.sessions.listByDebate(debate.id)
      if (debateSessions.ok) debateSessions.value.forEach((session) => sessionToDebate.set(session.id, debate.id))
    }
    let knownTokenCalls = 0
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let totalCost = 0
    let knownCostCalls = 0
    for (const usage of usages.value) {
      const knownTokens = usage.inputTokens !== undefined && usage.outputTokens !== undefined
      if (knownTokens) {
        knownTokenCalls += 1
        inputTokens += usage.inputTokens ?? 0
        outputTokens += usage.outputTokens ?? 0
        totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      }
      const price = usage.modelProfileId ? pricingByProfile.get(usage.modelProfileId) : undefined
      const calculated = this.calculator.calculate(usage, price)
      if (calculated.known) {
        totalCost += calculated.totalCost ?? 0
        knownCostCalls += 1
      }
      this.addModel(modelBuckets, usage, knownTokens, calculated.totalCost, Boolean(price))
      const debateId = sessionToDebate.get(usage.sessionId)
      if (debateId) {
        const topic = sessions.value.find((item) => item.id === debateId)?.topic ?? debateId
        this.addDebate(debateBuckets, debateId, topic, usage, knownTokens, calculated.totalCost)
      }
    }
    return {
      ok: true,
      value: {
        totalCalls: usages.value.length,
        knownTokenCalls,
        unknownTokenCalls: usages.value.length - knownTokenCalls,
        inputTokens: knownTokenCalls ? inputTokens : undefined,
        outputTokens: knownTokenCalls ? outputTokens : undefined,
        totalTokens: knownTokenCalls ? totalTokens : undefined,
        totalCost: knownCostCalls ? totalCost : undefined,
        currency: pricing.value[0]?.currency ?? 'USD',
        byModel: [...modelBuckets.entries()].map(([modelId, value]) => ({
          modelId, calls: value.calls, totalTokens: value.knownTokens ? value.tokens : undefined,
          totalCost: value.knownCost ? value.cost : undefined, pricingConfigured: value.pricingConfigured
        })),
        byDebate: [...debateBuckets.entries()].map(([debateId, value]) => ({
          debateId, topic: value.topic, calls: value.calls,
          totalTokens: value.knownTokens ? value.tokens : undefined,
          totalCost: value.knownCost ? value.cost : undefined
        }))
      }
    }
  }

  private addModel(map: Map<string, { calls: number; tokens: number; knownTokens: number; cost: number; knownCost: number; pricingConfigured: boolean }>, usage: UsageRecord, knownTokens: boolean, cost: number | undefined, pricingConfigured: boolean): void {
    const key = usage.modelId ?? '未知模型'
    const bucket = map.get(key) ?? { calls: 0, tokens: 0, knownTokens: 0, cost: 0, knownCost: 0, pricingConfigured }
    bucket.calls += 1
    if (knownTokens) { bucket.knownTokens += 1; bucket.tokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
    if (cost !== undefined) { bucket.knownCost += 1; bucket.cost += cost }
    bucket.pricingConfigured ||= pricingConfigured
    map.set(key, bucket)
  }

  private addDebate(map: Map<string, { topic: string; calls: number; tokens: number; knownTokens: number; cost: number; knownCost: number }>, debateId: string, topic: string, usage: UsageRecord, knownTokens: boolean, cost?: number): void {
    const bucket = map.get(debateId) ?? { topic, calls: 0, tokens: 0, knownTokens: 0, cost: 0, knownCost: 0 }
    bucket.calls += 1
    if (knownTokens) { bucket.knownTokens += 1; bucket.tokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
    if (cost !== undefined) { bucket.knownCost += 1; bucket.cost += cost }
    map.set(debateId, bucket)
  }

  private failure<T>(code: string, titleZh: string): WorkbenchResultDto<T> {
    return { ok: false, error: { code, titleZh, descriptionZh: '本地数据读取或保存失败，请稍后重试。', retryable: true } }
  }
}
