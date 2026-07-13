import { buildDebateSessionParticipantBindings, type DebateParticipantConfig } from '../participant-config'
import type { ModelProfile, ProtocolType, ProviderConnection } from '../provider-config'
import type { PersistenceResult, SessionRecord } from '../persistence'
import type { DebateCapabilityRequirements } from '../setup-validation'
import type {
  DebateSetupLoadError,
  DebateSetupLoaderDependencies,
  DebateSetupLoadResult,
  LoadedDebateSetup,
  LoadedParticipantSetup
} from './types'

interface ReadResult<T> {
  succeeded: boolean
  value?: T
}

export class DebateSetupLoader {
  constructor(private readonly dependencies: DebateSetupLoaderDependencies) {}

  load(sessionId: string): DebateSetupLoadResult {
    const loadErrors: DebateSetupLoadError[] = []
    const normalizedSessionId = sessionId.trim()

    if (!normalizedSessionId) {
      loadErrors.push(this.error(
        'INVALID_SESSION_ID',
        'Session ID 无效',
        '无法加载空的 Session ID。',
        sessionId,
        false
      ))
      return this.finish(sessionId, undefined, [], [], [], undefined, loadErrors)
    }

    const sessionRead = this.readRepository(
      () => this.dependencies.repositories.sessions.get(normalizedSessionId),
      '读取 Session 失败',
      normalizedSessionId,
      loadErrors
    )
    const session = sessionRead.value
    if (sessionRead.succeeded && !session) {
      loadErrors.push(this.error(
        'SESSION_NOT_FOUND',
        '辩论 Session 不存在',
        '没有找到指定的辩论 Session。',
        normalizedSessionId,
        false
      ))
    }

    let participants: DebateParticipantConfig[] = []
    if (session) {
      const participantRead = this.readRepository(
        () => this.dependencies.repositories.participants.listBySession(normalizedSessionId),
        '读取 Participant 配置失败',
        normalizedSessionId,
        loadErrors
      )
      if (participantRead.succeeded) {
        participants = participantRead.value ?? []
        if (participants.length === 0) {
          loadErrors.push(this.error(
            'PARTICIPANTS_EMPTY',
            '没有 Participant 配置',
            '该 Session 尚未保存任何辩论角色配置。',
            normalizedSessionId,
            false
          ))
        }
      }
    }

    const modelProfiles = this.loadModelProfiles(participants, loadErrors)
    const providerConnections = this.loadProviderConnections(modelProfiles, loadErrors)
    const environment = this.loadEnvironment(normalizedSessionId, loadErrors)
    return this.finish(
      normalizedSessionId,
      session,
      participants,
      modelProfiles,
      providerConnections,
      environment,
      loadErrors
    )
  }

  private loadModelProfiles(
    participants: readonly DebateParticipantConfig[],
    loadErrors: DebateSetupLoadError[]
  ): ModelProfile[] {
    const profiles: ModelProfile[] = []
    const loadedIds = new Set<string>()

    for (const participant of participants) {
      if (loadedIds.has(participant.modelProfileId)) continue
      loadedIds.add(participant.modelProfileId)
      const read = this.readRepository(
        () => this.dependencies.repositories.modelProfiles.findById(participant.modelProfileId),
        '读取 ModelProfile 失败',
        participant.modelProfileId,
        loadErrors
      )
      if (!read.succeeded) continue
      if (!read.value) {
        loadErrors.push(this.error(
          'MODEL_PROFILE_NOT_FOUND',
          'ModelProfile 不存在',
          'Participant 引用的 ModelProfile 已不存在。',
          participant.modelProfileId,
          false
        ))
        continue
      }
      profiles.push(read.value)
    }
    return profiles
  }

  private loadProviderConnections(
    modelProfiles: readonly ModelProfile[],
    loadErrors: DebateSetupLoadError[]
  ): ProviderConnection[] {
    const connections: ProviderConnection[] = []
    const loadedIds = new Set<string>()

    for (const profile of modelProfiles) {
      if (loadedIds.has(profile.connectionId)) continue
      loadedIds.add(profile.connectionId)
      const read = this.readRepository(
        () => this.dependencies.repositories.providerConnections.findById(profile.connectionId),
        '读取 ProviderConnection 失败',
        profile.connectionId,
        loadErrors
      )
      if (!read.succeeded) continue
      if (!read.value) {
        loadErrors.push(this.error(
          'PROVIDER_CONNECTION_NOT_FOUND',
          'ProviderConnection 不存在',
          'ModelProfile 引用的 ProviderConnection 已不存在。',
          profile.connectionId,
          false
        ))
        continue
      }
      connections.push(read.value)
    }
    return connections
  }

  private loadEnvironment(
    sessionId: string,
    loadErrors: DebateSetupLoadError[]
  ): { protocols: ProtocolType[]; requirements?: DebateCapabilityRequirements } {
    let protocols: ProtocolType[] = []
    let requirements: DebateCapabilityRequirements | undefined

    try {
      protocols = [...this.dependencies.environment.getAvailableProtocolTypes()]
    } catch {
      loadErrors.push(this.error(
        'ENVIRONMENT_READ_FAILED',
        '读取可用协议失败',
        '无法获取当前可用的 Adapter 协议类型。',
        sessionId,
        true
      ))
    }
    try {
      requirements = this.dependencies.environment.getCapabilityRequirements(sessionId)
    } catch {
      loadErrors.push(this.error(
        'ENVIRONMENT_READ_FAILED',
        '读取能力要求失败',
        '无法获取当前辩论的模型能力要求。',
        sessionId,
        true
      ))
    }
    return { protocols, requirements }
  }

  private finish(
    sessionId: string,
    session: SessionRecord | undefined,
    participants: DebateParticipantConfig[],
    modelProfiles: ModelProfile[],
    providerConnections: ProviderConnection[],
    environment: { protocols: ProtocolType[]; requirements?: DebateCapabilityRequirements } | undefined,
    loadErrors: DebateSetupLoadError[]
  ): DebateSetupLoadResult {
    const protocols = environment?.protocols ?? []
    const requirements = environment?.requirements
    const validation = this.dependencies.validator.validate({
      sessionId,
      participants,
      modelProfiles,
      providerConnections,
      requirements
    })

    if (!session) return { setup: undefined, validation, loadErrors }
    const bindings = buildDebateSessionParticipantBindings(sessionId, participants)
    const profileById = new Map(modelProfiles.map((profile) => [profile.id, profile]))
    const connectionById = new Map(providerConnections.map((connection) => [connection.id, connection]))
    const roleSetup = (participant: DebateParticipantConfig | undefined): LoadedParticipantSetup | undefined => {
      if (!participant) return undefined
      const modelProfile = profileById.get(participant.modelProfileId)
      return {
        participant,
        modelProfile,
        providerConnection: modelProfile ? connectionById.get(modelProfile.connectionId) : undefined
      }
    }
    const setup: LoadedDebateSetup = {
      session,
      affirmative: roleSetup(bindings.affirmative),
      negative: roleSetup(bindings.negative),
      moderator: roleSetup(bindings.moderator),
      judge: roleSetup(bindings.judge),
      modelProfiles: [...modelProfiles],
      providerConnections: [...providerConnections],
      availableProtocolTypes: protocols,
      requirements
    }
    return { setup, validation, loadErrors }
  }

  private readRepository<T>(
    read: () => PersistenceResult<T>,
    titleZh: string,
    relatedId: string,
    loadErrors: DebateSetupLoadError[]
  ): ReadResult<T> {
    try {
      const result = read()
      if (result.ok) return { succeeded: true, value: result.value }
      loadErrors.push(this.error(
        'REPOSITORY_READ_FAILED',
        titleZh,
        '仓储读取失败，请稍后重试或检查本地数据库。',
        relatedId,
        true
      ))
    } catch {
      loadErrors.push(this.error(
        'REPOSITORY_READ_FAILED',
        titleZh,
        '仓储读取时发生异常，请稍后重试或检查本地数据库。',
        relatedId,
        true
      ))
    }
    return { succeeded: false }
  }

  private error(
    code: DebateSetupLoadError['code'],
    titleZh: string,
    descriptionZh: string,
    relatedId: string | undefined,
    retryable: boolean
  ): DebateSetupLoadError {
    return { code, titleZh, descriptionZh, relatedId, retryable }
  }
}
