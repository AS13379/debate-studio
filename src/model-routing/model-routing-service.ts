import type { AdapterRegistry } from '../providers'
import type {
  ModelProfileRepository,
  ModelRoutingPolicyRepository,
  ProviderConnectionRepository
} from '../persistence'
import {
  MODEL_ROUTING_TASKS,
  type ModelRoutingError,
  type ModelRoutingPolicy,
  type ModelRoutingResult,
  type ModelRoutingTask
} from './types'

export interface ModelRoutingServiceOptions {
  policies: ModelRoutingPolicyRepository
  modelProfiles: ModelProfileRepository
  providerConnections: ProviderConnectionRepository
  adapterRegistry: AdapterRegistry
  now?: () => Date
}

export class ModelRoutingService {
  private readonly now: () => Date

  constructor(private readonly options: ModelRoutingServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  list(): ModelRoutingPolicy[] {
    const result = this.options.policies.list()
    return result.ok ? result.value : []
  }

  save(task: ModelRoutingTask, modelProfileId: string): ModelRoutingResult {
    const profile = this.options.modelProfiles.findById(modelProfileId)
    if (!profile.ok || !profile.value) return { ok: false, error: this.error('MODEL_PROFILE_MISSING', task) }
    if (task === 'vision_analysis' && !profile.value.capabilities.imageInput) {
      return { ok: false, error: this.error('VISION_UNSUPPORTED', task) }
    }
    const existing = this.options.policies.findByTask(task)
    const timestamp = this.now().toISOString()
    const saved = this.options.policies.save({
      task,
      modelProfileId,
      createdAt: existing.ok && existing.value ? existing.value.createdAt : timestamp,
      updatedAt: timestamp
    })
    if (!saved.ok) return { ok: false, error: this.error('ROUTING_POLICY_MISSING', task) }
    return this.resolve(task)
  }

  delete(task: ModelRoutingTask): boolean {
    const result = this.options.policies.delete(task)
    return result.ok && result.value
  }

  resolve(task: ModelRoutingTask): ModelRoutingResult {
    const policy = this.options.policies.findByTask(task)
    if (!policy.ok || !policy.value) return { ok: false, error: this.error('ROUTING_POLICY_MISSING', task) }
    const profile = this.options.modelProfiles.findById(policy.value.modelProfileId)
    if (!profile.ok || !profile.value) return { ok: false, error: this.error('MODEL_PROFILE_MISSING', task) }
    if (task === 'vision_analysis' && !profile.value.capabilities.imageInput) {
      return { ok: false, error: this.error('VISION_UNSUPPORTED', task) }
    }
    const connection = this.options.providerConnections.findById(profile.value.connectionId)
    if (!connection.ok || !connection.value) return { ok: false, error: this.error('PROVIDER_CONNECTION_MISSING', task) }
    if (!connection.value.enabled) return { ok: false, error: this.error('PROVIDER_DISABLED', task) }
    const adapter = this.options.adapterRegistry.getAdapter(connection.value.protocolType)
    if (!adapter.ok) return { ok: false, error: this.error('ADAPTER_UNAVAILABLE', task) }
    return {
      ok: true,
      route: {
        task,
        modelProfile: profile.value,
        providerConnection: connection.value,
        adapter: adapter.value
      }
    }
  }

  createDefaults(): ModelRoutingPolicy[] {
    const profiles = this.options.modelProfiles.list()
    if (!profiles.ok || profiles.value.length === 0) return []
    const textProfiles = profiles.value.filter((profile) => profile.capabilities.textInput)
    const capable = textProfiles.find((profile) => profile.capabilities.reasoning)
      ?? textProfiles.find((profile) => profile.capabilities.structuredOutput)
      ?? textProfiles[0]
    const economical = textProfiles.find((profile) => profile.modelId.toLowerCase().includes('mini'))
      ?? textProfiles.find((profile) => profile.modelId.toLowerCase().includes('flash'))
      ?? textProfiles[0]
    const vision = profiles.value.find((profile) => profile.capabilities.imageInput)
    const existing = new Set(this.list().map((policy) => policy.task))
    for (const task of MODEL_ROUTING_TASKS) {
      if (existing.has(task)) continue
      const selected = task === 'vision_analysis'
        ? vision
        : task === 'research' || task === 'search_summary'
          ? economical
          : capable
      if (selected) this.save(task, selected.id)
    }
    return this.list()
  }

  private error(code: ModelRoutingError['code'], task: ModelRoutingTask): ModelRoutingError {
    const messages: Record<ModelRoutingError['code'], [string, string, string]> = {
      ROUTING_POLICY_MISSING: ['尚未配置模型策略', '当前任务没有绑定可用模型。', '打开“模型策略”并为该任务选择模型。'],
      MODEL_PROFILE_MISSING: ['模型配置不存在', '策略引用的 ModelProfile 已不存在。', '重新选择一个模型配置。'],
      PROVIDER_CONNECTION_MISSING: ['模型连接不存在', '策略模型所引用的服务商连接已不存在。', '修复模型配置或重新创建连接。'],
      PROVIDER_DISABLED: ['模型连接已停用', '当前任务对应的服务商连接未启用。', '在“模型与平台”中启用连接。'],
      ADAPTER_UNAVAILABLE: ['模型协议不可用', '当前连接协议没有已注册的 Adapter。', '更换兼容协议或模型连接。'],
      VISION_UNSUPPORTED: ['模型不支持图片', '当前图片分析策略选择的是纯文本模型，图片未被发送。', '选择启用了图片能力的 ModelProfile。']
    }
    const [titleZh, descriptionZh, suggestedActionZh] = messages[code]
    return { code, titleZh, descriptionZh, task, retryable: false, suggestedActionZh }
  }
}
