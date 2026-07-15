import type { ConfigurationErrorDto, ConfigurationResultDto, ModelCapabilitiesDto, ModelProfileDto, ProviderConnectionDto } from './debate-dtos'

export type ModelRoutingTaskDto = 'research' | 'search_summary' | 'argument_generation' | 'rebuttal' | 'judge' | 'vision_analysis'

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
  recommendedModelId: string
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
  byModel: Array<{
    modelId: string
    calls: number
    totalTokens?: number
    totalCost?: number
    pricingConfigured: boolean
  }>
  byDebate: Array<{
    debateId: string
    topic: string
    calls: number
    totalTokens?: number
    totalCost?: number
  }>
}

export type WorkbenchResultDto<T> = ConfigurationResultDto<T>
export type WorkbenchErrorDto = ConfigurationErrorDto
