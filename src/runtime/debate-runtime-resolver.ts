import type { DebateParticipantRole } from '../participant-config'
import { AdapterRegistry } from '../providers'
import type { LoadedDebateSetup, LoadedParticipantSetup } from '../setup-loading'
import type { DebateRuntimeConfig, RuntimeParticipant, RuntimeResolveError, RuntimeResolveResult } from './types'

export class DebateRuntimeResolver {
  resolve(setup: LoadedDebateSetup, adapterRegistry: AdapterRegistry): RuntimeResolveResult {
    const errors: RuntimeResolveError[] = []
    const affirmative = this.resolveParticipant('affirmative', setup.affirmative, adapterRegistry, errors, true)
    const negative = this.resolveParticipant('negative', setup.negative, adapterRegistry, errors, true)
    const moderator = this.resolveParticipant('moderator', setup.moderator, adapterRegistry, errors, true)
    const judge = this.resolveParticipant('judge', setup.judge, adapterRegistry, errors, false)

    if (errors.length > 0 || !affirmative || !negative || !moderator) {
      return { ok: false, errors }
    }

    const config: DebateRuntimeConfig = {
      session: setup.session,
      affirmative,
      negative,
      moderator,
      judge
    }
    return { ok: true, config }
  }

  private resolveParticipant(
    role: DebateParticipantRole,
    setup: LoadedParticipantSetup | undefined,
    adapterRegistry: AdapterRegistry,
    errors: RuntimeResolveError[],
    required: boolean
  ): RuntimeParticipant | undefined {
    if (!setup) {
      if (required) {
        errors.push(this.error(
          'REQUIRED_PARTICIPANT_MISSING',
          '缺少必需的运行角色',
          `无法为${this.roleLabel(role)}创建运行时配置，因为该角色尚未配置。`,
          role,
          false
        ))
      }
      return undefined
    }

    if (!setup.modelProfile) {
      errors.push(this.error(
        'MODEL_PROFILE_MISSING',
        '模型配置缺失',
        `${this.roleLabel(role)}引用的 ModelProfile 无法用于运行时解析。`,
        role,
        false
      ))
      return undefined
    }

    if (!setup.providerConnection) {
      errors.push(this.error(
        'PROVIDER_CONNECTION_MISSING',
        '平台连接缺失',
        `${this.roleLabel(role)}的 ModelProfile 没有可用的 ProviderConnection。`,
        role,
        false
      ))
      return undefined
    }

    if (!setup.providerConnection.enabled) {
      errors.push(this.error(
        'PROVIDER_CONNECTION_DISABLED',
        '平台连接已禁用',
        `${this.roleLabel(role)}使用的平台连接“${setup.providerConnection.displayName}”已被禁用。`,
        role,
        false
      ))
      return undefined
    }

    const adapterResult = adapterRegistry.getAdapter(setup.providerConnection.protocolType)
    if (!adapterResult.ok) {
      errors.push(this.error(
        'ADAPTER_UNAVAILABLE',
        '协议适配器不可用',
        `${this.roleLabel(role)}所需的协议“${setup.providerConnection.protocolType}”没有已注册的 Adapter。`,
        role,
        false
      ))
      return undefined
    }

    return {
      role,
      modelProfile: setup.modelProfile,
      providerConnection: setup.providerConnection,
      adapter: adapterResult.value
    }
  }

  private error(
    code: RuntimeResolveError['code'],
    titleZh: string,
    descriptionZh: string,
    role: DebateParticipantRole,
    retryable: boolean
  ): RuntimeResolveError {
    return { code, titleZh, descriptionZh, role, retryable }
  }

  private roleLabel(role: DebateParticipantRole): string {
    return {
      affirmative: '正方',
      negative: '反方',
      moderator: '主持人',
      judge: '裁判'
    }[role]
  }
}
