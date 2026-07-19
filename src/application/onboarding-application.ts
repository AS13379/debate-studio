import type { PersistenceContext } from '../persistence'
import type { ModelCapabilities } from '../provider-config'
import type {
  OnboardingProviderInputDto,
  OnboardingProviderRecommendationDto,
  OnboardingProviderResultDto,
  OnboardingStateDto,
  WorkbenchResultDto
} from '../shared/workbench-dtos'
import type { DebateConfigurationApplication } from './debate-configuration-application'
import type { ModelRoutingService } from '../model-routing'
import { getFallbackProviderModels, getProviderPreset } from '../provider-config'

const STATE_KEY = 'onboarding.state.v1'
const DEFAULTS_KEY = 'onboarding.default-models.v1'

interface StoredState {
  status: OnboardingStateDto['status']
  currentStep: number
  updatedAt: string
}

interface DefaultModels {
  affirmative: string
  negative: string
  moderator: string
}

const baseCapabilities: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: true,
  webSearch: false,
  structuredOutput: true
}

const RECOMMENDATIONS: OnboardingProviderRecommendationDto[] = [
  recommendation('deepseek', 'DeepSeek', 'https://api.deepseek.com', 'deepseek-v4-flash', 1_000_000, 800, '按量计费；首次使用前请在服务商控制台确认余额。'),
  recommendation('openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4.1-mini', 1_047_576, 800, '官方价：输入 $0.40、缓存 $0.10、输出 $1.60 / 百万 Token。', { imageInput: true }),
  recommendation('moonshot', 'Moonshot / Kimi', 'https://api.moonshot.cn/v1', 'kimi-k3', 1_000_000, 131_072, '同一平台同时支持 Kimi 与 Moonshot 系列；Kimi K3：输入 ¥20、缓存 ¥2、输出 ¥100 / 百万 Token。', { imageInput: true, videoInput: true }),
  recommendation('zhipu', '智谱 BigModel', 'https://open.bigmodel.cn/api/paas/v4', 'glm-5.1', 200_000, 800, 'GLM-5.1 按上下文阶梯计费，应用会按实际输入 Token 选择价格。'),
  recommendation('alibaba-dashscope', '阿里云百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.7-plus', 1_000_000, 800, '千问 Plus 按上下文阶梯计费，限时折扣不计入长期估算。', { imageInput: true }),
  recommendation('gemini', 'Gemini OpenAI Compatible', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.5-flash', 1_048_576, 800, '付费标准价：输入 $1.50、缓存 $0.15、输出 $9.00 / 百万 Token。', { imageInput: true, documentInput: true }),
  recommendation('xiaomi-mimo', '小米 MiMo', 'https://api.xiaomimimo.com/v1', 'mimo-v2-flash', 128_000, 800, '国内价：输入 ¥0.70、缓存 ¥0.07、输出 ¥2.10 / 百万 Token。')
]

export interface OnboardingApplicationDependencies {
  persistence: PersistenceContext
  configuration: DebateConfigurationApplication
  modelRouting: ModelRoutingService
  now?: () => Date
}

export class OnboardingApplication {
  private readonly now: () => Date

  constructor(private readonly dependencies: OnboardingApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  async getState(): Promise<WorkbenchResultDto<OnboardingStateDto>> {
    const stored = this.dependencies.persistence.repositories.settings.get<StoredState>(STATE_KEY)
    const defaults = this.dependencies.persistence.repositories.settings.get<DefaultModels>(DEFAULTS_KEY)
    const connections = this.dependencies.persistence.repositories.providerConnections.list()
    const profiles = this.dependencies.persistence.repositories.modelProfiles.list()
    if (!stored.ok || !defaults.ok || !connections.ok || !profiles.ok) return this.failure('ONBOARDING_READ_FAILED', '引导状态读取失败', '无法读取本地首次启动设置。')
    const usableConnectionIds = new Set(connections.value.filter((item) => item.enabled && item.providerId !== 'mock').map((item) => item.id))
    const needsModelSetup = !profiles.value.some((profile) => usableConnectionIds.has(profile.connectionId))
    return {
      ok: true,
      value: {
        status: stored.value?.status ?? 'pending',
        currentStep: stored.value?.currentStep ?? 1,
        needsModelSetup,
        defaultModels: defaults.value,
        recommendations: RECOMMENDATIONS.map((item) => ({ ...item, capabilities: { ...item.capabilities } }))
      }
    }
  }

  async saveProvider(input: OnboardingProviderInputDto): Promise<WorkbenchResultDto<OnboardingProviderResultDto>> {
    const connections = this.dependencies.persistence.repositories.providerConnections.list()
    if (!connections.ok) return this.failure('ONBOARDING_SAVE_FAILED', '模型服务保存失败', '无法读取已有模型连接。')
    const existing = connections.value.find((item) => item.providerId === input.providerId)
    const connection = await this.dependencies.configuration.saveProviderConnection({
      id: existing?.id,
      providerId: input.providerId,
      displayName: input.displayName,
      protocolType: 'openai-chat',
      baseUrl: input.baseUrl,
      enabled: true
    })
    if (!connection.ok) return connection
    const credential = await this.dependencies.configuration.saveCredential(connection.value.id, input.apiKey)
    if (!credential.ok) {
      if (!existing) await this.dependencies.configuration.deleteProviderConnection(connection.value.id, true)
      return credential
    }
    const existingProfiles = this.dependencies.persistence.repositories.modelProfiles.listByConnection(connection.value.id)
    const sameModel = existingProfiles.ok ? existingProfiles.value.find((profile) => profile.modelId === input.modelId) : undefined
    const profile = this.dependencies.configuration.saveModelProfile({
      id: sameModel?.id,
      connectionId: connection.value.id,
      modelId: input.modelId,
      displayName: input.modelDisplayName,
      capabilities: input.capabilities,
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens
    })
    if (!profile.ok) {
      if (!existing) await this.dependencies.configuration.deleteProviderConnection(connection.value.id, true)
      return profile
    }
    const state = this.setState('pending', 3)
    if (!state.ok) return state
    return { ok: true, value: { connectionId: connection.value.id, modelProfileId: profile.value.id, credentialConfigured: true } }
  }

  async testConnection(connectionId: string, modelProfileId?: string) {
    return this.dependencies.configuration.testConnection(connectionId, modelProfileId)
  }

  async saveDefaultModels(defaults: DefaultModels): Promise<WorkbenchResultDto<boolean>> {
    for (const modelProfileId of Object.values(defaults)) {
      const profile = this.dependencies.persistence.repositories.modelProfiles.findById(modelProfileId)
      if (!profile.ok || !profile.value) return this.failure('MODEL_PROFILE_NOT_FOUND', '默认模型不存在', '请选择已保存的 ModelProfile。')
    }
    const saved = this.dependencies.persistence.repositories.settings.set(DEFAULTS_KEY, defaults)
    if (!saved.ok) return this.failure('ONBOARDING_SAVE_FAILED', '默认配置保存失败', '无法保存默认角色模型。')
    for (const task of ['debate_planning', 'research', 'search_summary', 'argument_generation', 'rebuttal', 'judge'] as const) {
      const modelProfileId = task === 'judge' ? defaults.moderator : defaults.affirmative
      const routed = this.dependencies.modelRouting.save(task, modelProfileId)
      if (!routed.ok) return this.failure('ONBOARDING_SAVE_FAILED', '模型策略保存失败', routed.error.descriptionZh)
    }
    const visionProfile = this.dependencies.persistence.repositories.modelProfiles.findById(defaults.affirmative)
    if (visionProfile.ok && visionProfile.value?.capabilities.imageInput) {
      const routed = this.dependencies.modelRouting.save('vision_analysis', defaults.affirmative)
      if (!routed.ok) return this.failure('ONBOARDING_SAVE_FAILED', '视觉模型策略保存失败', routed.error.descriptionZh)
    }
    const state = this.setState('pending', 5)
    if (!state.ok) return state
    return { ok: true, value: true }
  }

  async createDemo(): Promise<WorkbenchResultDto<{ debateId: string; sessionId: string }>> {
    const demo = await this.dependencies.configuration.createMockDemoDebate()
    if (!demo.ok) return demo
    const state = this.setState('completed', 5)
    if (!state.ok) return state
    return { ok: true, value: { debateId: demo.value.id, sessionId: demo.value.sessionId } }
  }

  async skip(): Promise<WorkbenchResultDto<boolean>> {
    return this.setState('skipped', 1)
  }

  async reopen(): Promise<WorkbenchResultDto<boolean>> {
    return this.setState('pending', 1)
  }

  private setState(status: StoredState['status'], currentStep: number): WorkbenchResultDto<boolean> {
    const saved = this.dependencies.persistence.repositories.settings.set(STATE_KEY, { status, currentStep, updatedAt: this.now().toISOString() })
    return saved.ok
      ? { ok: true, value: true }
      : this.failure('ONBOARDING_SAVE_FAILED', '引导状态保存失败', '无法保存本地首次启动状态。')
  }

  private failure<T>(code: string, titleZh: string, descriptionZh: string): WorkbenchResultDto<T> {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable: true } }
  }
}

function recommendation(
  providerId: string,
  displayName: string,
  defaultBaseUrl: string,
  recommendedModelId: string,
  recommendedContextWindow: number,
  recommendedMaxOutputTokens: number,
  costNoticeZh: string,
  capabilities: Partial<ModelCapabilities> = {}
): OnboardingProviderRecommendationDto {
  const preset = getProviderPreset(providerId)
  if (!preset) throw new Error(`Missing provider preset: ${providerId}`)
  return {
    providerId, displayName, defaultBaseUrl,
    platformUrl: preset.platformUrl,
    documentationUrl: preset.documentationUrl,
    pricingUrl: preset.pricingUrl,
    recommendedModelId,
    modelOptions: getFallbackProviderModels(providerId).map((model) => ({ id: model.id, displayName: model.displayName })),
    recommendedContextWindow,
    recommendedMaxOutputTokens, costNoticeZh, capabilities: { ...baseCapabilities, ...capabilities }
  }
}
