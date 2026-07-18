export interface ProviderPricing {
  id: string
  modelProfileId: string
  modelId: string
  inputPricePerMillion: number
  outputPricePerMillion: number
  currency: string
  updatedAt: string
}

export interface CostCalculation {
  known: boolean
  inputCost?: number
  outputCost?: number
  totalCost?: number
  currency?: string
  reason?: 'TOKEN_USAGE_UNKNOWN' | 'PRICING_NOT_CONFIGURED'
}

export interface CostSummary {
  totalCalls: number
  knownTokenCalls: number
  unknownTokenCalls: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalCost?: number
  currency: string
  totalsByCurrency: Array<{ currency: string; totalCost: number }>
  byModel: Array<{
    modelId: string
    calls: number
    totalTokens?: number
    totalCost?: number
    currency?: string
    costsByCurrency: Array<{ currency: string; totalCost: number }>
    pricingConfigured: boolean
  }>
  byDebate: Array<{
    debateId: string
    topic: string
    calls: number
    totalTokens?: number
    totalCost?: number
    currency?: string
    costsByCurrency: Array<{ currency: string; totalCost: number }>
  }>
}
