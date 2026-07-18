export type PricingCurrency = 'USD' | 'CNY'

export interface OfficialProviderPricing {
  providerIds: readonly string[]
  modelIds: readonly string[]
  inputPricePerMillion: number
  cacheHitInputPricePerMillion?: number
  outputPricePerMillion: number
  currency: PricingCurrency
  inputPricingBasis: 'cache-miss'
  minimumInputTokens?: number
  maximumInputTokensExclusive?: number
  pricingNoteZh?: string
  sourceLabel: string
  sourceUrl: string
  verifiedAt: string
}

const VERIFIED_AT = '2026-07-18'
const DEEPSEEK_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing'
const KIMI_SOURCE = 'https://platform.kimi.com/docs/pricing/chat'
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-4.1-mini'
const ZHIPU_SOURCE = 'https://bigmodel.cn/pricing'
const DASHSCOPE_SOURCE = 'https://help.aliyun.com/zh/model-studio/model-pricing'
const GEMINI_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing'
const MIMO_SOURCE = 'https://mimo.mi.com/docs/en-US/news/previous-news/billing'

export const OFFICIAL_PROVIDER_PRICING: readonly OfficialProviderPricing[] = [
  pricing(['openai'], ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'], 0.4, 1.6, 'USD', OPENAI_SOURCE, 'OpenAI 官方模型页', {
    cacheHitInputPricePerMillion: 0.1
  }),
  pricing(['deepseek'], ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'], 0.14, 0.28, 'USD', DEEPSEEK_SOURCE, 'DeepSeek 官方 Models & Pricing', {
    cacheHitInputPricePerMillion: 0.0028
  }),
  pricing(['deepseek'], ['deepseek-v4-pro'], 0.435, 0.87, 'USD', DEEPSEEK_SOURCE, 'DeepSeek 官方 Models & Pricing', {
    cacheHitInputPricePerMillion: 0.003625
  }),
  pricing(['moonshot', 'kimi'], ['kimi-k3'], 20, 100, 'CNY', KIMI_SOURCE, 'Kimi Platform 官方定价', {
    cacheHitInputPricePerMillion: 2
  }),
  pricing(['moonshot', 'kimi'], ['kimi-k2.7-code'], 6.5, 27, 'CNY', KIMI_SOURCE, 'Kimi Platform 官方定价', {
    cacheHitInputPricePerMillion: 1.3
  }),
  pricing(['moonshot', 'kimi'], ['kimi-k2.6'], 6.5, 27, 'CNY', KIMI_SOURCE, 'Kimi Platform 官方定价', {
    cacheHitInputPricePerMillion: 1.1
  }),
  pricing(['zhipu'], ['glm-5.1'], 6, 24, 'CNY', ZHIPU_SOURCE, '智谱开放平台官方价格', {
    cacheHitInputPricePerMillion: 1.3,
    maximumInputTokensExclusive: 32_000,
    pricingNoteZh: '输入少于 32K Token 的官方阶梯价；达到 32K 后自动使用下一阶梯。'
  }),
  pricing(['zhipu'], ['glm-5.1'], 8, 28, 'CNY', ZHIPU_SOURCE, '智谱开放平台官方价格', {
    cacheHitInputPricePerMillion: 2,
    minimumInputTokens: 32_000,
    pricingNoteZh: '输入达到 32K Token 的官方阶梯价。'
  }),
  pricing(['alibaba-dashscope'], ['qwen3.7-plus', 'qwen3.7-plus-2026-05-26'], 2, 8, 'CNY', DASHSCOPE_SOURCE, '阿里云百炼官方模型价格', {
    maximumInputTokensExclusive: 256_000,
    pricingNoteZh: '中国内地、输入不超过 256K Token 的目录价；不计限时折扣。'
  }),
  pricing(['alibaba-dashscope'], ['qwen3.7-plus', 'qwen3.7-plus-2026-05-26'], 6, 24, 'CNY', DASHSCOPE_SOURCE, '阿里云百炼官方模型价格', {
    minimumInputTokens: 256_000,
    pricingNoteZh: '中国内地、输入超过 256K Token 的目录价；不计限时折扣。'
  }),
  pricing(['gemini'], ['gemini-3.5-flash'], 1.5, 9, 'USD', GEMINI_SOURCE, 'Google Gemini Developer API 官方价格', {
    cacheHitInputPricePerMillion: 0.15,
    pricingNoteZh: '付费标准层价格；免费层调用费用为 0。'
  }),
  pricing(['xiaomi-mimo'], ['mimo-v2-flash'], 0.7, 2.1, 'CNY', MIMO_SOURCE, '小米 MiMo 官方计费公告', {
    cacheHitInputPricePerMillion: 0.07,
    pricingNoteZh: '中国区 API 价格。'
  })
]

export function findOfficialProviderPricing(
  providerId: string,
  modelId: string,
  inputTokens?: number
): OfficialProviderPricing | undefined {
  const candidates = listOfficialProviderPricing(providerId, modelId)
  if (inputTokens === undefined) return candidates[0]
  return candidates.find((pricing) =>
    inputTokens >= (pricing.minimumInputTokens ?? 0)
      && inputTokens < (pricing.maximumInputTokensExclusive ?? Number.POSITIVE_INFINITY)
  ) ?? candidates.at(-1)
}

export function listOfficialProviderPricing(
  providerId: string,
  modelId: string
): OfficialProviderPricing[] {
  const normalizedProvider = providerId.trim().toLowerCase()
  const normalizedModel = modelId.trim().toLowerCase()
  return OFFICIAL_PROVIDER_PRICING.filter((pricing) =>
    pricing.providerIds.includes(normalizedProvider) && pricing.modelIds.includes(normalizedModel)
  )
}

function pricing(
  providerIds: readonly string[],
  modelIds: readonly string[],
  inputPricePerMillion: number,
  outputPricePerMillion: number,
  currency: PricingCurrency,
  sourceUrl: string,
  sourceLabel: string,
  options: Partial<Omit<OfficialProviderPricing,
    'providerIds' | 'modelIds' | 'inputPricePerMillion' | 'outputPricePerMillion' |
    'currency' | 'inputPricingBasis' | 'sourceUrl' | 'sourceLabel' | 'verifiedAt'>> = {}
): OfficialProviderPricing {
  return {
    providerIds,
    modelIds,
    inputPricePerMillion,
    outputPricePerMillion,
    currency,
    inputPricingBasis: 'cache-miss',
    sourceUrl,
    sourceLabel,
    verifiedAt: VERIFIED_AT,
    ...options
  }
}
