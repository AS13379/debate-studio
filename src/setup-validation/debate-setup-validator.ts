import { buildDebateSessionParticipantBindings, type DebateParticipantConfig, type DebateParticipantRole } from '../participant-config'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../provider-config'
import type {
  DebateCapabilityRequirements,
  DebateSetupIssue,
  DebateSetupIssueCode,
  DebateSetupValidationInput,
  DebateSetupValidationResult,
  DebateSetupValidatorOptions
} from './types'

const CAPABILITY_LABELS: Record<keyof ModelCapabilities, string> = {
  textInput: '文本输入',
  imageInput: '图片输入',
  documentInput: '文档输入',
  audioInput: '音频输入',
  videoInput: '视频输入',
  streaming: '流式输出',
  reasoning: '深度思考',
  toolCalling: '工具调用',
  webSearch: '联网搜索',
  structuredOutput: '结构化输出'
}

export class DebateSetupValidator {
  private readonly availableProtocolTypes: Set<string>

  constructor(options: DebateSetupValidatorOptions) {
    this.availableProtocolTypes = new Set(options.availableProtocolTypes)
  }

  validate(input: DebateSetupValidationInput): DebateSetupValidationResult {
    const errors: DebateSetupIssue[] = []
    const warnings: DebateSetupIssue[] = []
    const participants = input.participants.filter((participant) => participant.sessionId === input.sessionId)
    const bindings = buildDebateSessionParticipantBindings(input.sessionId, participants)

    this.requireRole(bindings.affirmative, 'affirmative', 'MISSING_AFFIRMATIVE', '正方模型未配置', errors)
    this.requireRole(bindings.negative, 'negative', 'MISSING_NEGATIVE', '反方模型未配置', errors)
    this.requireRole(bindings.moderator, 'moderator', 'MISSING_MODERATOR', '主持人模型未配置', errors)
    if (!bindings.judge) {
      warnings.push(this.issue(
        'JUDGE_NOT_CONFIGURED',
        '未配置独立裁判',
        '本场辩论没有独立裁判配置，可由主持人承担总结职责。',
        '如需独立裁决，请为裁判角色选择模型。',
        'judge'
      ))
    }

    const profileById = new Map(input.modelProfiles.map((profile) => [profile.id, profile]))
    const connectionById = new Map(input.providerConnections.map((connection) => [connection.id, connection]))
    const validatedProfiles = new Set<string>()

    for (const participant of participants) {
      const profile = profileById.get(participant.modelProfileId)
      if (!profile) {
        errors.push(this.issue(
          'MODEL_PROFILE_NOT_FOUND',
          '模型配置不存在',
          `角色“${participant.displayName}”引用的 ModelProfile 已不存在。`,
          '请重新为该角色选择一个已保存的模型配置。',
          participant.role,
          participant.modelProfileId
        ))
        continue
      }
      if (validatedProfiles.has(profile.id)) continue
      validatedProfiles.add(profile.id)
      this.validateProfile(profile, participant, connectionById, input.requirements, errors, warnings)
    }

    this.addSharedModelWarnings(participants, warnings)
    return { valid: errors.length === 0, errors, warnings }
  }

  private validateProfile(
    profile: ModelProfile,
    participant: DebateParticipantConfig,
    connectionById: ReadonlyMap<string, ProviderConnection>,
    requirements: DebateCapabilityRequirements | undefined,
    errors: DebateSetupIssue[],
    warnings: DebateSetupIssue[]
  ): void {
    if (!profile.modelId.trim()) {
      errors.push(this.issue(
        'MODEL_ID_MISSING',
        'Model ID 为空',
        `模型配置“${profile.displayName}”没有 Model ID。`,
        '请填写平台提供的 Model ID。',
        participant.role,
        profile.id
      ))
    }

    const connection = connectionById.get(profile.connectionId)
    if (!connection) {
      errors.push(this.issue(
        'PROVIDER_CONNECTION_NOT_FOUND',
        '平台连接不存在',
        `模型配置“${profile.displayName}”引用的平台连接已不存在。`,
        '请重新选择或创建平台连接。',
        participant.role,
        profile.connectionId
      ))
    } else {
      this.validateConnection(connection, participant.role, errors)
    }

    const requiredCapabilities: Partial<ModelCapabilities> = {
      textInput: true,
      streaming: true,
      ...requirements?.requiredCapabilities
    }
    for (const [capability, required] of Object.entries(requiredCapabilities) as Array<[keyof ModelCapabilities, boolean | undefined]>) {
      if (required && !profile.capabilities[capability]) {
        errors.push(this.issue(
          'MODEL_CAPABILITY_UNSUPPORTED',
          '模型能力不满足要求',
          `模型“${profile.displayName}”不支持当前辩论要求的${CAPABILITY_LABELS[capability]}。`,
          '请选择支持该能力的模型，或调整本场辩论的能力要求。',
          participant.role,
          profile.id
        ))
      }
    }

    if (requirements?.minimumContextWindow !== undefined) {
      if (profile.contextWindow === undefined || profile.contextWindow < requirements.minimumContextWindow) {
        errors.push(this.issue(
          'CONTEXT_WINDOW_INSUFFICIENT',
          '上下文长度不足',
          `模型“${profile.displayName}”的上下文长度不能满足至少 ${requirements.minimumContextWindow} Token 的要求。`,
          '请选择上下文更长的模型，或降低本场辩论的上下文要求。',
          participant.role,
          profile.id
        ))
      }
    } else if (profile.contextWindow === undefined) {
      warnings.push(this.issue(
        'CONTEXT_WINDOW_UNKNOWN',
        '未设置上下文长度',
        `模型“${profile.displayName}”没有上下文长度信息，运行时可能遇到上下文过长错误。`,
        '建议补充该模型的上下文长度。',
        participant.role,
        profile.id
      ))
    }

    if (
      requirements?.minimumMaxOutputTokens !== undefined
      && (profile.maxOutputTokens === undefined || profile.maxOutputTokens < requirements.minimumMaxOutputTokens)
    ) {
      errors.push(this.issue(
        'OUTPUT_LIMIT_INSUFFICIENT',
        '最大输出长度不足',
        `模型“${profile.displayName}”不能满足至少 ${requirements.minimumMaxOutputTokens} Token 的输出要求。`,
        '请选择输出上限更高的模型，或降低本场辩论的输出要求。',
        participant.role,
        profile.id
      ))
    }
  }

  private validateConnection(
    connection: ProviderConnection,
    role: DebateParticipantRole,
    errors: DebateSetupIssue[]
  ): void {
    if (!connection.enabled) {
      errors.push(this.issue(
        'PROVIDER_CONNECTION_DISABLED',
        '平台连接已禁用',
        `平台连接“${connection.displayName}”当前处于禁用状态。`,
        '请启用该连接，或选择其他连接。',
        role,
        connection.id
      ))
    }
    if (!this.isValidBaseUrl(connection.baseUrl)) {
      errors.push(this.issue(
        'INVALID_BASE_URL',
        'Base URL 无效',
        `平台连接“${connection.displayName}”的 Base URL 为空或格式无效。`,
        '请填写完整的 HTTP 或 HTTPS Base URL。',
        role,
        connection.id
      ))
    }
    if (!this.availableProtocolTypes.has(connection.protocolType)) {
      errors.push(this.issue(
        'ADAPTER_UNAVAILABLE',
        '当前协议没有可用 Adapter',
        `协议“${connection.protocolType}”目前没有可用的 Adapter 类型。`,
        '请选择已支持的协议，或等待相应 Adapter 实现。',
        role,
        connection.id
      ))
    }
    if (!connection.credentialRef.trim()) {
      errors.push(this.issue(
        'CREDENTIAL_REFERENCE_MISSING',
        '凭据引用为空',
        `平台连接“${connection.displayName}”没有 credentialRef。`,
        '请为连接选择一个 Keychain 凭据引用。',
        role,
        connection.id
      ))
    }
  }

  private addSharedModelWarnings(participants: readonly DebateParticipantConfig[], warnings: DebateSetupIssue[]): void {
    const rolesByProfile = new Map<string, DebateParticipantRole[]>()
    for (const participant of participants) {
      const roles = rolesByProfile.get(participant.modelProfileId) ?? []
      roles.push(participant.role)
      rolesByProfile.set(participant.modelProfileId, roles)
    }

    for (const [profileId, roles] of rolesByProfile) {
      if (roles.length > 1) {
        warnings.push(this.issue(
          'DUPLICATE_MODEL_PROFILE',
          '多个角色使用相同模型配置',
          `角色 ${roles.join('、')} 使用了同一个 ModelProfile，可能降低模型对比价值。`,
          '如需比较不同模型，请为这些角色选择不同的 ModelProfile。',
          undefined,
          profileId
        ))
      }
      if (roles.includes('moderator') && (roles.includes('affirmative') || roles.includes('negative'))) {
        warnings.push(this.issue(
          'MODERATOR_MODEL_SHARED',
          '主持人与辩手使用相同模型',
          '主持人与至少一名辩手使用相同 ModelProfile，可能影响主持的独立性。',
          '建议为主持人选择不同的模型配置。',
          'moderator',
          profileId
        ))
      }
    }
  }

  private requireRole(
    participant: DebateParticipantConfig | undefined,
    role: DebateParticipantRole,
    code: Extract<DebateSetupIssueCode, 'MISSING_AFFIRMATIVE' | 'MISSING_NEGATIVE' | 'MISSING_MODERATOR'>,
    title: string,
    errors: DebateSetupIssue[]
  ): void {
    if (!participant) {
      const roleLabel = role === 'affirmative' ? '正方' : role === 'negative' ? '反方' : '主持人'
      errors.push(this.issue(code, title, `辩论 Session 尚未配置${roleLabel}角色。`, '请为该角色选择 ModelProfile。', role))
    }
  }

  private isValidBaseUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
    } catch {
      return false
    }
  }

  private issue(
    code: DebateSetupIssueCode,
    titleZh: string,
    descriptionZh: string,
    suggestedActionZh: string,
    role?: DebateParticipantRole,
    configId?: string
  ): DebateSetupIssue {
    return { code, titleZh, descriptionZh, role, configId, suggestedActionZh }
  }
}
