import {
  initializePersistence,
  type DatabaseOptions,
  type PersistenceContext,
  type PersistenceResult
} from '../persistence'
import { AdapterRegistry, MockAdapter, MockHttpTransport, OpenAIChatAdapter } from '../providers'
import { DebateSetupLoader, type DebateSetupLoadResult } from '../setup-loading'
import { DebateSetupValidator, type DebateCapabilityRequirements } from '../setup-validation'

export interface DebateSetupApplicationOptions extends DatabaseOptions {
  getCapabilityRequirements?: (sessionId: string) => DebateCapabilityRequirements | undefined
}

export class DebateSetupApplication {
  private readonly validator: DebateSetupValidator
  private readonly loader: DebateSetupLoader
  private closed = false

  constructor(
    private readonly persistence: PersistenceContext,
    options: Omit<DebateSetupApplicationOptions, keyof DatabaseOptions>,
    private readonly adapterRegistry: AdapterRegistry
  ) {
    const availableProtocolTypes = adapterRegistry.getAvailableProtocolTypes()
    this.validator = new DebateSetupValidator({ availableProtocolTypes })
    this.loader = new DebateSetupLoader({
      repositories: {
        sessions: persistence.repositories.sessions,
        participants: persistence.repositories.participants,
        modelProfiles: persistence.repositories.modelProfiles,
        providerConnections: persistence.repositories.providerConnections
      },
      environment: {
        getAvailableProtocolTypes: () => adapterRegistry.getAvailableProtocolTypes(),
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
  const adapterRegistry = new AdapterRegistry()
  const registrations = [
    adapterRegistry.register('mock', new MockAdapter()),
    adapterRegistry.register('openai-chat', new OpenAIChatAdapter(new MockHttpTransport()))
  ]
  const registrationFailure = registrations.find((registration) => !registration.ok)
  if (registrationFailure && !registrationFailure.ok) {
    persistenceResult.value.database.close()
    throw new Error(`${registrationFailure.error.code}: ${registrationFailure.error.message}`)
  }

  return {
    ok: true,
    value: new DebateSetupApplication(persistenceResult.value, {
      getCapabilityRequirements: options.getCapabilityRequirements
    }, adapterRegistry)
  }
}
