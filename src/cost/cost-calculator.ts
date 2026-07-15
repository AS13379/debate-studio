import type { UsageRecord } from '../persistence'
import type { CostCalculation, ProviderPricing } from './types'

export class CostCalculator {
  calculate(usage: Pick<UsageRecord, 'inputTokens' | 'outputTokens'>, pricing?: ProviderPricing): CostCalculation {
    if (usage.inputTokens === undefined || usage.outputTokens === undefined) {
      return { known: false, reason: 'TOKEN_USAGE_UNKNOWN' }
    }
    if (!pricing) return { known: false, reason: 'PRICING_NOT_CONFIGURED' }
    const inputCost = usage.inputTokens / 1_000_000 * pricing.inputPricePerMillion
    const outputCost = usage.outputTokens / 1_000_000 * pricing.outputPricePerMillion
    return {
      known: true,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: pricing.currency
    }
  }
}
