import type { ProtocolType } from '../provider-config'
import {
  initializePersistence,
  type DatabaseOptions,
  type PersistenceContext,
  type PersistenceResult
} from '../persistence'
import { DebateSetupLoader, type DebateSetupLoadResult } from '../setup-loading'
import { DebateSetupValidator, type DebateCapabilityRequirements } from '../setup-validation'

export interface DebateSetupApplicationOptions extends DatabaseOptions {
  availableProtocolTypes: readonly ProtocolType[]
  getCapabilityRequirements?: (sessionId: string) => DebateCapabilityRequirements | undefined
}

export class DebateSetupApplication {
  private readonly validator: DebateSetupValidator
  private readonly loader: DebateSetupLoader
  private closed = false

  constructor(
    private readonly persistence: PersistenceContext,
    options: Omit<DebateSetupApplicationOptions, keyof DatabaseOptions>
  ) {
    const availableProtocolTypes = [...options.availableProtocolTypes]
    this.validator = new DebateSetupValidator({ availableProtocolTypes })
    this.loader = new DebateSetupLoader({
      repositories: {
        sessions: persistence.repositories.sessions,
        participants: persistence.repositories.participants,
        modelProfiles: persistence.repositories.modelProfiles,
        providerConnections: persistence.repositories.providerConnections
      },
      environment: {
        getAvailableProtocolTypes: () => availableProtocolTypes,
        getCapabilityRequirements: (sessionId) => options.getCapabilityRequirements?.(sessionId)
      },
      validator: this.validator
    })
  }

  loadDebateSetup(sessionId: string): DebateSetupLoadResult {
    if (!this.closed) return this.loader.load(sessionId)

    return {
      setup: undefined,
      validation: this.validator.validate({
        sessionId,
        participants: [],
        modelProfiles: [],
        providerConnections: []
      }),
      loadErrors: [{
        code: 'APPLICATION_CLOSED',
        titleZh: '应用数据服务已关闭',
        descriptionZh: 'SQLite 资源已经释放，无法继续读取辩论配置。',
        relatedId: sessionId,
        retryable: false
      }]
    }
  }

  close(): PersistenceResult<void> {
    if (this.closed) return { ok: true, value: undefined }
    const result = this.persistence.database.close()
    if (result.ok) this.closed = true
    return result
  }
}

export function initializeDebateSetupApplication(
  options: DebateSetupApplicationOptions
): PersistenceResult<DebateSetupApplication> {
  const persistenceResult = initializePersistence(options)
  if (!persistenceResult.ok) return persistenceResult

  return {
    ok: true,
    value: new DebateSetupApplication(persistenceResult.value, {
      availableProtocolTypes: options.availableProtocolTypes,
      getCapabilityRequirements: options.getCapabilityRequirements
    })
  }
}
