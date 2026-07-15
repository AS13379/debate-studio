import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { ModelAdapter } from '../providers'

export const MODEL_ROUTING_TASKS = [
  'research',
  'search_summary',
  'argument_generation',
  'rebuttal',
  'judge',
  'vision_analysis'
] as const

export type ModelRoutingTask = typeof MODEL_ROUTING_TASKS[number]

export interface ModelRoutingPolicy {
  task: ModelRoutingTask
  modelProfileId: string
  createdAt: string
  updatedAt: string
}

export interface ResolvedModelRoute {
  task: ModelRoutingTask
  modelProfile: ModelProfile
  providerConnection: ProviderConnection
  adapter: ModelAdapter
}

export interface ModelRoutingError {
  code: 'ROUTING_POLICY_MISSING' | 'MODEL_PROFILE_MISSING' | 'PROVIDER_CONNECTION_MISSING' | 'PROVIDER_DISABLED' | 'ADAPTER_UNAVAILABLE' | 'VISION_UNSUPPORTED'
  titleZh: string
  descriptionZh: string
  task: ModelRoutingTask
  retryable: false
  suggestedActionZh: string
}

export type ModelRoutingResult =
  | { ok: true; route: ResolvedModelRoute }
  | { ok: false; error: ModelRoutingError }

export const MODEL_ROUTING_TASK_LABELS: Record<ModelRoutingTask, string> = {
  research: '研究',
  search_summary: '搜索摘要',
  argument_generation: '正式论证',
  rebuttal: '反驳',
  judge: '裁判',
  vision_analysis: '图片分析'
}
