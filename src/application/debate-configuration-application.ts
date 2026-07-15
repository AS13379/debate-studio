import { randomUUID } from 'node:crypto'

import type { DebateParticipantConfig, DebateParticipantRole } from '../participant-config'
import {
  type DebateRecord,
  type PersistenceContext,
  type PersistenceError,
  type PersistenceResult,
  type SessionRecord,
  type TurnRecord
} from '../persistence'
import {
  getProviderPresets,
  type ModelCapabilities,
  type ModelProfile,
  type ProviderConnection
} from '../provider-config'
import type { ConnectionTestService } from '../providers'
import { redactForExport, type CredentialError, type CredentialStore } from '../security'
import type {
  ConfigurationErrorDto,
  ConfigurationResultDto,
  ConnectionTestDto,
  CreateDebateInput,
  DebateDetailDto,
  DebateSetupDto,
  DebateSummaryDto,
  DebateTurnDto,
  ModelProfileDto,
  ParticipantBindingDto,
  ParticipantBindingInput,
  ProviderConnectionDto,
  ProviderPresetDto,
  SaveModelProfileInput,
  SaveParticipantBindingsInput,
  SaveProviderConnectionInput
} from '../shared/debate-dtos'
import type { DebateSetupApplication } from './debate-setup-application'

const DEMO_IDS = {
  provider: 'mock-demo-provider',
  profile: 'mock-demo-profile',
  debate: 'mock-demo-debate',
  session: 'mock-demo-session'
} as const

const MOCK_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: false,
  webSearch: false,
  structuredOutput: true
}

export interface DebateConfigurationApplicationDependencies {
  persistence: PersistenceContext
  credentialStore: CredentialStore
  connectionTestService: ConnectionTestService
  setupApplication: Pick<DebateSetupApplication, 'loadDebateSetup'>
  createId?: () => string
  now?: () => Date
}

export class DebateConfigurationApplication {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: DebateConfigurationApplicationDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  async listProviderConnections(): Promise<ConfigurationResultDto<ProviderConnectionDto[]>> {
    const result = this.dependencies.persistence.repositories.providerConnections.list()
    if (!result.ok) return this.persistenceError(result.error)
    const views: ProviderConnectionDto[] = []
    for (const connection of result.value) {
      const view = await this.connectionDto(connection)
      if (!view.ok) return view
      views.push(view.value)
    }
    return { ok: true, value: views }
  }

  listProviderPresets(): ConfigurationResultDto<ProviderPresetDto[]> {
    return {
      ok: true,
      value: getProviderPresets().map((preset) => ({
        ...preset,
        supportedProtocols: [...preset.supportedProtocols],
        capabilityHints: { ...preset.capabilityHints }
      }))
    }
  }

  async saveProviderConnection(
    input: SaveProviderConnectionInput
  ): Promise<ConfigurationResultDto<ProviderConnectionDto>> {
    const validation = this.validateConnectionInput(input)
    if (validation) return validation
    const repositories = this.dependencies.persistence.repositories
    const existingResult = input.id
      ? repositories.providerConnections.findById(input.id)
      : { ok: true as const, value: undefined }
    if (!existingResult.ok) return this.persistenceError(existingResult.error)
    const timestamp = this.timestamp()
    const id = existingResult.value?.id ?? input.id ?? this.createId()
    const connection: ProviderConnection = {
      id,
      providerId: input.providerId.trim(),
      displayName: input.displayName.trim(),
      protocolType: input.protocolType,
      baseUrl: input.baseUrl.trim(),
      credentialRef: existingResult.value?.credentialRef ?? `${input.providerId.trim()}:${id}`,
      enabled: input.enabled,
      createdAt: existingResult.value?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const saved = existingResult.value
      ? repositories.providerConnections.update(connection)
      : repositories.providerConnections.create(connection)
    if (!saved.ok) return this.persistenceError(saved.error)
    if (typeof saved.value === 'boolean' && !saved.value) return this.notFound('ProviderConnection', id)
    return this.connectionDto(connection)
  }

  async deleteProviderConnection(
    id: string,
    deleteCredential: boolean
  ): Promise<ConfigurationResultDto<boolean>> {
    const repository = this.dependencies.persistence.repositories.providerConnections
    const existing = repository.findById(id)
    if (!existing.ok) return this.persistenceError(existing.error)
    if (!existing.value) return this.notFound('ProviderConnection', id)
    const deleted = repository.delete(id)
    if (!deleted.ok) return this.persistenceError(deleted.error)
    if (!deleted.value) return this.notFound('ProviderConnection', id)
    if (deleteCredential) {
      const credentialDeleted = await this.dependencies.credentialStore.deleteCredential(existing.value.credentialRef)
      if (!credentialDeleted.ok) return this.credentialError(credentialDeleted.error)
    }
    return { ok: true, value: true }
  }

  listModelProfiles(): ConfigurationResultDto<ModelProfileDto[]> {
    const result = this.dependencies.persistence.repositories.modelProfiles.list()
    return result.ok
      ? { ok: true, value: result.value.map((profile) => this.modelProfileDto(profile)) }
      : this.persistenceError(result.error)
  }

  saveModelProfile(input: SaveModelProfileInput): ConfigurationResultDto<ModelProfileDto> {
    if (!input.connectionId.trim() || !input.modelId.trim() || !input.displayName.trim()) {
      return this.invalid('模型配置不完整', 'Connection、Model ID 和显示名称不能为空。')
    }
    const repositories = this.dependencies.persistence.repositories
    const connection = repositories.providerConnections.findById(input.connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('ProviderConnection', input.connectionId)
    const existing = input.id
      ? repositories.modelProfiles.findById(input.id)
      : { ok: true as const, value: undefined }
    if (!existing.ok) return this.persistenceError(existing.error)
    const timestamp = this.timestamp()
    const profile: ModelProfile = {
      id: existing.value?.id ?? input.id ?? this.createId(),
      connectionId: input.connectionId,
      modelId: input.modelId.trim(),
      displayName: input.displayName.trim(),
      alias: input.alias?.trim() || undefined,
      capabilities: { ...input.capabilities },
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      createdAt: existing.value?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const saved = existing.value
      ? repositories.modelProfiles.update(profile)
      : repositories.modelProfiles.create(profile)
    if (!saved.ok) return this.persistenceError(saved.error)
    if (typeof saved.value === 'boolean' && !saved.value) return this.notFound('ModelProfile', profile.id)
    return { ok: true, value: this.modelProfileDto(profile) }
  }

  deleteModelProfile(id: string): ConfigurationResultDto<boolean> {
    const result = this.dependencies.persistence.repositories.modelProfiles.delete(id)
    if (!result.ok) return this.persistenceError(result.error)
    return result.value ? { ok: true, value: true } : this.notFound('ModelProfile', id)
  }

  copyModelProfile(id: string): ConfigurationResultDto<ModelProfileDto> {
    const repository = this.dependencies.persistence.repositories.modelProfiles
    const existing = repository.findById(id)
    if (!existing.ok) return this.persistenceError(existing.error)
    if (!existing.value) return this.notFound('ModelProfile', id)
    const timestamp = this.timestamp()
    const copy: ModelProfile = {
      ...existing.value,
      id: this.createId(),
      displayName: `${existing.value.displayName} 副本`,
      alias: existing.value.alias ? `${existing.value.alias} 副本` : undefined,
      capabilities: { ...existing.value.capabilities },
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const saved = repository.create(copy)
    return saved.ok ? { ok: true, value: this.modelProfileDto(copy) } : this.persistenceError(saved.error)
  }

  async saveCredential(connectionId: string, credential: string): Promise<ConfigurationResultDto<boolean>> {
    const connection = this.dependencies.persistence.repositories.providerConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('ProviderConnection', connectionId)
    const saved = await this.dependencies.credentialStore.setCredential(connection.value.credentialRef, credential)
    return saved.ok ? { ok: true, value: true } : this.credentialError(saved.error)
  }

  async deleteCredential(connectionId: string): Promise<ConfigurationResultDto<boolean>> {
    const connection = this.dependencies.persistence.repositories.providerConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('ProviderConnection', connectionId)
    const deleted = await this.dependencies.credentialStore.deleteCredential(connection.value.credentialRef)
    return deleted.ok ? { ok: true, value: deleted.value } : this.credentialError(deleted.error)
  }

  async testConnection(connectionId: string, modelProfileId?: string): Promise<ConfigurationResultDto<ConnectionTestDto>> {
    const repositories = this.dependencies.persistence.repositories
    const connection = repositories.providerConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('ProviderConnection', connectionId)
    const profile = modelProfileId ? repositories.modelProfiles.findById(modelProfileId) : undefined
    if (profile && !profile.ok) return this.persistenceError(profile.error)
    if (modelProfileId && !profile?.value) return this.notFound('ModelProfile', modelProfileId)
    const tested = await this.dependencies.connectionTestService.test(connection.value, profile?.value)
    return {
      ok: true,
      value: tested.success
        ? tested
        : {
            success: false,
            latencyMs: tested.latencyMs,
            providerStatus: tested.providerStatus,
            error: tested.error
          }
    }
  }

  createDebate(input: CreateDebateInput): ConfigurationResultDto<DebateDetailDto> {
    if (!input.topic.trim() || !input.affirmativePosition.trim() || !input.negativePosition.trim()) {
      return this.invalid('辩论信息不完整', '辩题、正方立场和反方立场不能为空。')
    }
    if (!Number.isInteger(input.freeDebateRounds) || input.freeDebateRounds < 1 || input.freeDebateRounds > 20) {
      return this.invalid('自由辩论轮数无效', '自由辩论轮数必须是 1 到 20 之间的整数。')
    }
    const timestamp = this.timestamp()
    const debate: DebateRecord = {
      id: this.createId(),
      topic: input.topic.trim(),
      background: input.background?.trim() || undefined,
      affirmativePosition: input.affirmativePosition.trim(),
      negativePosition: input.negativePosition.trim(),
      freeDebateRounds: input.freeDebateRounds,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const session: SessionRecord = {
      id: this.createId(),
      debateId: debate.id,
      status: 'draft',
      currentStage: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const saved = this.dependencies.persistence.database.transaction(() => {
      this.unwrap(this.dependencies.persistence.repositories.debates.save(debate))
      this.unwrap(this.dependencies.persistence.repositories.sessions.create(session))
    })
    if (!saved.ok) return this.persistenceError(saved.error)
    return { ok: true, value: this.detailDto(debate, session, []) }
  }

  saveParticipantBindings(input: SaveParticipantBindingsInput): ConfigurationResultDto<DebateDetailDto> {
    const repositories = this.dependencies.persistence.repositories
    const session = repositories.sessions.get(input.sessionId)
    if (!session.ok) return this.persistenceError(session.error)
    if (!session.value) return this.notFound('Session', input.sessionId)
    const bindings: Array<[DebateParticipantRole, ParticipantBindingInput | undefined]> = [
      ['affirmative', input.affirmative],
      ['negative', input.negative],
      ['moderator', input.moderator],
      ['judge', input.judge]
    ]
    for (const [, binding] of bindings) {
      if (!binding) continue
      const profile = repositories.modelProfiles.findById(binding.modelProfileId)
      if (!profile.ok) return this.persistenceError(profile.error)
      if (!profile.value) return this.notFound('ModelProfile', binding.modelProfileId)
    }

    const timestamp = this.timestamp()
    const transaction = this.dependencies.persistence.database.transaction(() => {
      const existing = this.unwrap(repositories.participants.listBySession(input.sessionId))
      for (const [role, binding] of bindings) {
        const current = existing.find((participant) => participant.role === role)
        if (!binding) {
          if (current) this.unwrap(repositories.participants.delete(current.id))
          continue
        }
        const participant: DebateParticipantConfig = {
          id: current?.id ?? this.createId(),
          sessionId: input.sessionId,
          role,
          modelProfileId: binding.modelProfileId,
          displayName: binding.displayName.trim() || this.roleLabel(role),
          systemPromptTemplate: binding.systemPromptTemplate?.trim() || undefined,
          createdAt: current?.createdAt ?? timestamp,
          updatedAt: timestamp
        }
        if (current) this.unwrap(repositories.participants.update(participant))
        else this.unwrap(repositories.participants.create(participant))
      }
    })
    if (!transaction.ok) return this.persistenceError(transaction.error)
    return this.getDebate(session.value.debateId)
  }

  createMockDemoDebate(): ConfigurationResultDto<DebateDetailDto> {
    const repositories = this.dependencies.persistence.repositories
    const timestamp = this.timestamp()
    const existingProvider = repositories.providerConnections.findById(DEMO_IDS.provider)
    const existingProfile = repositories.modelProfiles.findById(DEMO_IDS.profile)
    const existingDebate = repositories.debates.findById(DEMO_IDS.debate)
    const existingSession = repositories.sessions.get(DEMO_IDS.session)
    if (!existingProvider.ok) return this.persistenceError(existingProvider.error)
    if (!existingProfile.ok) return this.persistenceError(existingProfile.error)
    if (!existingDebate.ok) return this.persistenceError(existingDebate.error)
    if (!existingSession.ok) return this.persistenceError(existingSession.error)

    const provider: ProviderConnection = {
      id: DEMO_IDS.provider,
      providerId: 'mock',
      displayName: 'Mock 示例连接',
      protocolType: 'mock',
      baseUrl: 'https://mock.local',
      credentialRef: 'mock:demo',
      enabled: true,
      createdAt: existingProvider.value?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const profile: ModelProfile = {
      id: DEMO_IDS.profile,
      connectionId: provider.id,
      modelId: 'mock-debate-model',
      displayName: 'Mock 辩论模型',
      capabilities: MOCK_CAPABILITIES,
      contextWindow: 32_000,
      maxOutputTokens: 1_024,
      createdAt: existingProfile.value?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const debate: DebateRecord = {
      id: DEMO_IDS.debate,
      topic: '人工智能是否会提升人类的整体创造力？',
      background: '这是一个完全使用 MockAdapter 的本地示例，不会发起网络请求。',
      affirmativePosition: '人工智能能够扩展工具边界，提升整体创造力。',
      negativePosition: '人工智能可能造成能力依赖，削弱原创思考。',
      freeDebateRounds: 1,
      status: existingDebate.value?.status ?? 'draft',
      createdAt: existingDebate.value?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const session: SessionRecord = existingSession.value ?? {
      id: DEMO_IDS.session,
      debateId: debate.id,
      status: 'draft',
      currentStage: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    }

    const transaction = this.dependencies.persistence.database.transaction(() => {
      if (existingProvider.value) this.unwrap(repositories.providerConnections.update(provider))
      else this.unwrap(repositories.providerConnections.create(provider))
      if (existingProfile.value) this.unwrap(repositories.modelProfiles.update(profile))
      else this.unwrap(repositories.modelProfiles.create(profile))
      this.unwrap(repositories.debates.save(debate))
      if (!existingSession.value) this.unwrap(repositories.sessions.create(session))

      const currentParticipants = this.unwrap(repositories.participants.listBySession(session.id))
      for (const role of ['affirmative', 'negative', 'moderator'] as const) {
        const current = currentParticipants.find((participant) => participant.role === role)
        const participant: DebateParticipantConfig = {
          id: current?.id ?? `mock-demo-${role}`,
          sessionId: session.id,
          role,
          modelProfileId: profile.id,
          displayName: this.roleLabel(role),
          createdAt: current?.createdAt ?? timestamp,
          updatedAt: timestamp
        }
        if (current) this.unwrap(repositories.participants.update(participant))
        else this.unwrap(repositories.participants.create(participant))
      }
    })
    if (!transaction.ok) return this.persistenceError(transaction.error)
    return this.getDebate(debate.id)
  }

  listDebates(): ConfigurationResultDto<DebateSummaryDto[]> {
    const debates = this.dependencies.persistence.repositories.debates.list()
    if (!debates.ok) return this.persistenceError(debates.error)
    const summaries: DebateSummaryDto[] = []
    for (const debate of debates.value) {
      const sessions = this.dependencies.persistence.repositories.sessions.listByDebate(debate.id)
      if (!sessions.ok) return this.persistenceError(sessions.error)
      const session = sessions.value[0]
      if (session) summaries.push(this.summaryDto(debate, session))
    }
    return { ok: true, value: summaries }
  }

  getDebate(id: string): ConfigurationResultDto<DebateDetailDto> {
    const repositories = this.dependencies.persistence.repositories
    const debate = repositories.debates.findById(id)
    if (!debate.ok) return this.persistenceError(debate.error)
    if (!debate.value) return this.notFound('Debate', id)
    const sessions = repositories.sessions.listByDebate(id)
    if (!sessions.ok) return this.persistenceError(sessions.error)
    const session = sessions.value[0]
    if (!session) return this.notFound('Session', id)
    const participants = repositories.participants.listBySession(session.id)
    if (!participants.ok) return this.persistenceError(participants.error)
    return { ok: true, value: this.detailDto(debate.value, session, participants.value) }
  }

  listDebateTurns(sessionId: string): ConfigurationResultDto<DebateTurnDto[]> {
    const turns = this.dependencies.persistence.repositories.turns.listBySession(sessionId)
    return turns.ok
      ? { ok: true, value: turns.value.map((turn) => this.turnDto(turn)) }
      : this.persistenceError(turns.error)
  }

  listDebateTurnsPage(
    sessionId: string,
    limit = 40,
    before?: { createdAt: string; id: string }
  ): ConfigurationResultDto<import('../shared/debate-dtos').DebateTurnPageDto> {
    const page = this.dependencies.persistence.repositories.turns.listPage(sessionId, limit, before)
    return page.ok
      ? {
          ok: true,
          value: {
            turns: page.value.records.map((turn) => this.turnDto(turn)),
            nextCursor: page.value.nextCursor
          }
        }
      : this.persistenceError(page.error)
  }

  async loadDebateSetup(sessionId: string): Promise<ConfigurationResultDto<DebateSetupDto>> {
    const loaded = this.dependencies.setupApplication.loadDebateSetup(sessionId)
    if (!loaded.setup) {
      return this.failure('SETUP_LOAD_FAILED', '辩论配置读取失败', loaded.loadErrors[0]?.descriptionZh ?? '无法读取辩论配置。', true)
    }
    const connections: ProviderConnectionDto[] = []
    for (const connection of loaded.setup.providerConnections) {
      const view = await this.connectionDto(connection)
      if (!view.ok) return view
      connections.push(view.value)
    }
    const participants = [loaded.setup.affirmative, loaded.setup.negative, loaded.setup.moderator, loaded.setup.judge]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => this.participantDto(item.participant))
    return {
      ok: true,
      value: {
        sessionId,
        validation: {
          valid: loaded.validation.valid,
          errors: loaded.validation.errors.map((issue) => ({
            code: issue.code,
            titleZh: issue.titleZh,
            descriptionZh: issue.descriptionZh,
            role: issue.role,
            configId: issue.configId,
            suggestedActionZh: issue.suggestedActionZh
          })),
          warnings: loaded.validation.warnings.map((issue) => ({
            code: issue.code,
            titleZh: issue.titleZh,
            descriptionZh: issue.descriptionZh,
            role: issue.role,
            configId: issue.configId,
            suggestedActionZh: issue.suggestedActionZh
          }))
        },
        participants,
        modelProfiles: loaded.setup.modelProfiles.map((profile) => this.modelProfileDto(profile)),
        providerConnections: connections
      }
    }
  }

  private async connectionDto(connection: ProviderConnection): Promise<ConfigurationResultDto<ProviderConnectionDto>> {
    const hasCredential = connection.protocolType === 'mock'
      ? { ok: true as const, value: false }
      : await this.dependencies.credentialStore.hasCredential(connection.credentialRef)
    if (!hasCredential.ok) return this.credentialError(hasCredential.error)
    return {
      ok: true,
      value: {
        id: connection.id,
        providerId: connection.providerId,
        displayName: connection.displayName,
        protocolType: connection.protocolType,
        baseUrl: connection.baseUrl,
        enabled: connection.enabled,
        credentialConfigured: hasCredential.value,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt
      }
    }
  }

  private modelProfileDto(profile: ModelProfile): ModelProfileDto {
    return { ...profile, capabilities: { ...profile.capabilities } }
  }

  private summaryDto(debate: DebateRecord, session: SessionRecord): DebateSummaryDto {
    return {
      id: debate.id,
      sessionId: session.id,
      topic: debate.topic,
      status: session.status,
      currentStage: session.currentStage,
      createdAt: debate.createdAt,
      updatedAt: session.updatedAt
    }
  }

  private detailDto(
    debate: DebateRecord,
    session: SessionRecord,
    participants: DebateParticipantConfig[]
  ): DebateDetailDto {
    return {
      ...this.summaryDto(debate, session),
      background: debate.background,
      affirmativePosition: debate.affirmativePosition,
      negativePosition: debate.negativePosition,
      freeDebateRounds: debate.freeDebateRounds ?? 1,
      participants: participants.map((participant) => this.participantDto(participant))
    }
  }

  private participantDto(participant: DebateParticipantConfig): ParticipantBindingDto {
    return {
      id: participant.id,
      sessionId: participant.sessionId,
      role: participant.role,
      modelProfileId: participant.modelProfileId,
      displayName: participant.displayName,
      systemPromptTemplate: participant.systemPromptTemplate
    }
  }

  private turnDto(turn: TurnRecord): DebateTurnDto {
    return redactForExport({ ...turn })
  }

  private validateConnectionInput(
    input: SaveProviderConnectionInput
  ): ConfigurationResultDto<never> | undefined {
    if (!input.providerId.trim() || !input.displayName.trim() || !input.baseUrl.trim()) {
      return this.invalid('平台连接信息不完整', 'Provider ID、显示名称和 Base URL 不能为空。')
    }
    try {
      const url = new URL(input.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
    } catch {
      return this.invalid('Base URL 无效', '请输入有效的 HTTP 或 HTTPS 地址。')
    }
    return undefined
  }

  private roleLabel(role: DebateParticipantRole): string {
    return { affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' }[role]
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private unwrap<T>(result: PersistenceResult<T>): T {
    if (!result.ok) throw result.error
    if (typeof result.value === 'boolean' && !result.value) {
      throw new Error('Expected configuration row was not updated.')
    }
    return result.value
  }

  private invalid(titleZh: string, descriptionZh: string): ConfigurationResultDto<never> {
    return this.failure('INVALID_INPUT', titleZh, descriptionZh, false)
  }

  private notFound(entity: string, id: string): ConfigurationResultDto<never> {
    return this.failure('NOT_FOUND', `${entity} 不存在`, `没有找到 ${entity}：${id}。`, false)
  }

  private persistenceError(error: PersistenceError): ConfigurationResultDto<never> {
    return this.failure('PERSISTENCE_FAILED', '配置保存失败', 'SQLite 写入或读取失败，请检查关联配置后重试。', error.code !== 'DATABASE_CLOSED')
  }

  private credentialError(error: CredentialError): ConfigurationResultDto<never> {
    return this.failure('CREDENTIAL_STORE_FAILED', '安全凭据操作失败', '无法完成系统加密凭据操作，请检查系统权限。', error.retryable)
  }

  private failure(
    code: string,
    titleZh: string,
    descriptionZh: string,
    retryable: boolean
  ): { ok: false; error: ConfigurationErrorDto } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
