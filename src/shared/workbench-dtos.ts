import type { ConfigurationErrorDto, ConfigurationResultDto, ModelCapabilitiesDto, ModelProfileDto, ProviderConnectionDto } from './debate-dtos'

export type ModelRoutingTaskDto = 'debate_planning' | 'research' | 'search_summary' | 'argument_generation' | 'rebuttal' | 'judge' | 'vision_analysis'

export interface ModelRoutingPolicyDto {
  task: ModelRoutingTaskDto
  modelProfileId: string
  modelProfile?: ModelProfileDto
  providerConnection?: ProviderConnectionDto
  ready: boolean
  issueZh?: string
  updatedAt: string
}

export interface OnboardingProviderRecommendationDto {
  providerId: string
  displayName: string
  defaultBaseUrl: string
  platformUrl: string
  documentationUrl: string
  pricingUrl: string
  recommendedModelId: string
  modelOptions: Array<{ id: string; displayName: string }>
  recommendedContextWindow: number
  recommendedMaxOutputTokens: number
  costNoticeZh: string
  capabilities: ModelCapabilitiesDto
}

export interface OnboardingStateDto {
  status: 'pending' | 'skipped' | 'completed'
  currentStep: number
  needsModelSetup: boolean
  defaultModels?: {
    affirmative: string
    negative: string
    moderator: string
  }
  recommendations: OnboardingProviderRecommendationDto[]
}

export interface OnboardingProviderInputDto {
  providerId: string
  displayName: string
  baseUrl: string
  modelId: string
  modelDisplayName: string
  apiKey: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities: ModelCapabilitiesDto
}

export interface OnboardingProviderResultDto {
  connectionId: string
  modelProfileId: string
  credentialConfigured: boolean
}

export interface ProviderPricingDto {
  id: string
  modelProfileId: string
  modelId: string
  inputPricePerMillion: number
  outputPricePerMillion: number
  currency: string
  updatedAt: string
  sourceLabel?: string
  sourceUrl?: string
  sourceVerifiedAt?: string
  inputPricingBasis?: 'cache-miss'
  cacheHitInputPricePerMillion?: number
  pricingNoteZh?: string
}

export interface SaveProviderPricingInputDto {
  modelProfileId: string
  inputPricePerMillion: number
  outputPricePerMillion: number
  currency: string
}

export interface CostSummaryDto {
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

export type WorkbenchResultDto<T> = ConfigurationResultDto<T>
export type WorkbenchErrorDto = ConfigurationErrorDto
