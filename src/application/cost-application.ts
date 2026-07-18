import { randomUUID } from 'node:crypto'

import {
  CostCalculator,
  findOfficialProviderPricing,
  type OfficialProviderPricing,
  type ProviderPricing
} from '../cost'
import type { PersistenceContext, UsageRecord } from '../persistence'
import type { CostSummaryDto, ProviderPricingDto, SaveProviderPricingInputDto, WorkbenchResultDto } from '../shared/workbench-dtos'

interface OfficialProfilePricing {
  providerId: string
  modelId: string
  defaultPricing: OfficialProviderPricing
}

interface CostBucket {
  calls: number
  tokens: number
  knownTokens: number
  costs: Map<string, number>
  pricingConfigured: boolean
}

interface DebateCostBucket extends CostBucket {
  topic: string
}

export class CostApplication {
  private readonly calculator = new CostCalculator()
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly persistence: PersistenceContext, options: { now?: () => Date; createId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  listPricing(): WorkbenchResultDto<ProviderPricingDto[]> {
    const synchronized = this.synchronizeOfficialPricing()
    if (!synchronized.ok) return synchronized
    const result = this.persistence.repositories.providerPricing.list()
    if (!result.ok) return this.failure('PRICING_READ_FAILED', '定价读取失败')
    return {
      ok: true,
      value: result.value.map((pricing) => this.pricingDto(pricing, synchronized.value.get(pricing.modelProfileId)?.defaultPricing))
    }
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
    const synchronized = this.synchronizeOfficialPricing()
    if (!synchronized.ok) return synchronized
    const usages = this.persistence.repositories.usage.listAll()
    const pricing = this.persistence.repositories.providerPricing.list()
    const sessions = this.persistence.repositories.debates.list()
    if (!usages.ok || !pricing.ok || !sessions.ok) return this.failure('COST_SUMMARY_FAILED', '成本统计读取失败')
    const pricingByProfile = new Map(pricing.value.map((item) => [item.modelProfileId, item]))
    const modelBuckets = new Map<string, CostBucket>()
    const debateBuckets = new Map<string, DebateCostBucket>()
    const sessionToDebate = new Map<string, string>()
    for (const debate of sessions.value) {
      const debateSessions = this.persistence.repositories.sessions.listByDebate(debate.id)
      if (debateSessions.ok) debateSessions.value.forEach((session) => sessionToDebate.set(session.id, debate.id))
    }
    let knownTokenCalls = 0
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    const totalCosts = new Map<string, number>()
    let knownCostCalls = 0
    for (const usage of usages.value) {
      const knownTokens = usage.inputTokens !== undefined && usage.outputTokens !== undefined
      if (knownTokens) {
        knownTokenCalls += 1
        inputTokens += usage.inputTokens ?? 0
        outputTokens += usage.outputTokens ?? 0
        totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      }
      const storedPrice = usage.modelProfileId ? pricingByProfile.get(usage.modelProfileId) : undefined
      const officialProfile = usage.modelProfileId ? synchronized.value.get(usage.modelProfileId) : undefined
      const officialPrice = officialProfile
        ? findOfficialProviderPricing(officialProfile.providerId, officialProfile.modelId, usage.inputTokens)
        : undefined
      const price = officialPrice
        ? this.providerPricingFromOfficial(usage.modelProfileId!, usage.modelId ?? officialProfile!.modelId, storedPrice, officialPrice)
        : storedPrice
      const calculated = this.calculator.calculate(usage, price)
      if (calculated.known) {
        this.addCurrencyCost(totalCosts, calculated.currency ?? price?.currency ?? 'USD', calculated.totalCost ?? 0)
        knownCostCalls += 1
      }
      this.addModel(modelBuckets, usage, knownTokens, calculated.totalCost, calculated.currency, Boolean(price))
      const debateId = sessionToDebate.get(usage.sessionId)
      if (debateId) {
        const topic = sessions.value.find((item) => item.id === debateId)?.topic ?? debateId
        this.addDebate(debateBuckets, debateId, topic, usage, knownTokens, calculated.totalCost, calculated.currency, Boolean(price))
      }
    }
    const totalCurrencyRows = this.currencyRows(totalCosts)
    const singleTotal = totalCurrencyRows.length === 1 ? totalCurrencyRows[0] : undefined
    return {
      ok: true,
      value: {
        totalCalls: usages.value.length,
        knownTokenCalls,
        unknownTokenCalls: usages.value.length - knownTokenCalls,
        inputTokens: knownTokenCalls ? inputTokens : undefined,
        outputTokens: knownTokenCalls ? outputTokens : undefined,
        totalTokens: knownTokenCalls ? totalTokens : undefined,
        totalCost: knownCostCalls && singleTotal ? singleTotal.totalCost : undefined,
        currency: singleTotal?.currency ?? (totalCurrencyRows.length > 1 ? 'MIXED' : 'USD'),
        totalsByCurrency: totalCurrencyRows,
        byModel: [...modelBuckets.entries()].map(([modelId, value]) => ({
          modelId, calls: value.calls, totalTokens: value.knownTokens ? value.tokens : undefined,
          ...this.costFields(value.costs), pricingConfigured: value.pricingConfigured
        })),
        byDebate: [...debateBuckets.entries()].map(([debateId, value]) => ({
          debateId, topic: value.topic, calls: value.calls,
          totalTokens: value.knownTokens ? value.tokens : undefined,
          ...this.costFields(value.costs)
        }))
      }
    }
  }

  private synchronizeOfficialPricing(): WorkbenchResultDto<Map<string, OfficialProfilePricing>> {
    const repositories = this.persistence.repositories
    const profiles = repositories.modelProfiles.list()
    const connections = repositories.providerConnections.list()
    if (!profiles.ok || !connections.ok) {
      return this.failure('PRICING_CATALOG_SYNC_FAILED', '官方定价同步失败')
    }
    const connectionById = new Map(connections.value.map((connection) => [connection.id, connection]))
    const matches = new Map<string, OfficialProfilePricing>()
    for (const profile of profiles.value) {
      const connection = connectionById.get(profile.connectionId)
      if (!connection) continue
      const official = findOfficialProviderPricing(connection.providerId, profile.modelId)
      if (!official) continue
      matches.set(profile.id, { providerId: connection.providerId, modelId: profile.modelId, defaultPricing: official })
      const existing = repositories.providerPricing.findByModelProfile(profile.id)
      if (!existing.ok) return this.failure('PRICING_READ_FAILED', '定价读取失败')
      const unchanged = existing.value
        && existing.value.modelId === profile.modelId
        && existing.value.inputPricePerMillion === official.inputPricePerMillion
        && existing.value.outputPricePerMillion === official.outputPricePerMillion
        && existing.value.currency === official.currency
      if (unchanged) continue
      const saved = repositories.providerPricing.save({
        id: existing.value?.id ?? this.createId(),
        modelProfileId: profile.id,
        modelId: profile.modelId,
        inputPricePerMillion: official.inputPricePerMillion,
        outputPricePerMillion: official.outputPricePerMillion,
        currency: official.currency,
        updatedAt: this.now().toISOString()
      })
      if (!saved.ok) return this.failure('PRICING_SAVE_FAILED', '官方定价保存失败')
    }
    return { ok: true, value: matches }
  }

  private pricingDto(pricing: ProviderPricing, official?: OfficialProviderPricing): ProviderPricingDto {
    return {
      ...pricing,
      sourceLabel: official?.sourceLabel,
      sourceUrl: official?.sourceUrl,
      sourceVerifiedAt: official?.verifiedAt,
      inputPricingBasis: official?.inputPricingBasis,
      cacheHitInputPricePerMillion: official?.cacheHitInputPricePerMillion,
      pricingNoteZh: official?.pricingNoteZh
    }
  }

  private providerPricingFromOfficial(
    modelProfileId: string,
    modelId: string,
    stored: ProviderPricing | undefined,
    official: OfficialProviderPricing
  ): ProviderPricing {
    return {
      id: stored?.id ?? `official:${modelProfileId}`,
      modelProfileId,
      modelId,
      inputPricePerMillion: official.inputPricePerMillion,
      outputPricePerMillion: official.outputPricePerMillion,
      currency: official.currency,
      updatedAt: stored?.updatedAt ?? official.verifiedAt
    }
  }

  private addModel(map: Map<string, CostBucket>, usage: UsageRecord, knownTokens: boolean, cost: number | undefined, currency: string | undefined, pricingConfigured: boolean): void {
    const key = usage.modelId ?? '未知模型'
    const bucket = map.get(key) ?? { calls: 0, tokens: 0, knownTokens: 0, costs: new Map(), pricingConfigured }
    bucket.calls += 1
    if (knownTokens) { bucket.knownTokens += 1; bucket.tokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
    if (cost !== undefined) this.addCurrencyCost(bucket.costs, currency ?? 'USD', cost)
    bucket.pricingConfigured ||= pricingConfigured
    map.set(key, bucket)
  }

  private addDebate(map: Map<string, DebateCostBucket>, debateId: string, topic: string, usage: UsageRecord, knownTokens: boolean, cost: number | undefined, currency: string | undefined, pricingConfigured: boolean): void {
    const bucket = map.get(debateId) ?? { topic, calls: 0, tokens: 0, knownTokens: 0, costs: new Map(), pricingConfigured }
    bucket.calls += 1
    if (knownTokens) { bucket.knownTokens += 1; bucket.tokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
    if (cost !== undefined) this.addCurrencyCost(bucket.costs, currency ?? 'USD', cost)
    bucket.pricingConfigured ||= pricingConfigured
    map.set(debateId, bucket)
  }

  private addCurrencyCost(map: Map<string, number>, currency: string, amount: number): void {
    map.set(currency, (map.get(currency) ?? 0) + amount)
  }

  private currencyRows(map: Map<string, number>): Array<{ currency: string; totalCost: number }> {
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, totalCost]) => ({ currency, totalCost }))
  }

  private costFields(costs: Map<string, number>): {
    totalCost?: number
    currency?: string
    costsByCurrency: Array<{ currency: string; totalCost: number }>
  } {
    const rows = this.currencyRows(costs)
    const single = rows.length === 1 ? rows[0] : undefined
    return { totalCost: single?.totalCost, currency: single?.currency, costsByCurrency: rows }
  }

  private failure<T>(code: string, titleZh: string): WorkbenchResultDto<T> {
    return { ok: false, error: { code, titleZh, descriptionZh: '本地数据读取或保存失败，请稍后重试。', retryable: true } }
  }
}
