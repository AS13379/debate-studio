import {
  initializePersistence,
  type DatabaseOptions,
  type PersistenceContext,
  type PersistenceResult
} from '../persistence'
import type { ModelProfile, ProviderConnection } from '../provider-config'
import {
  AdapterRegistry,
  AuthenticatedHttpTransport,
  ConnectionTestService,
  FetchHttpTransport,
  MockAdapter,
  OpenAIChatAdapter,
  type ConnectionTestResult,
  type HttpTransport,
  type ModelAdapter
} from '../providers'
import {
  MacOSKeychainCredentialStore,
  type CredentialStore
} from '../security'
import { DebateSetupLoader, type DebateSetupLoadResult } from '../setup-loading'
import { DebateSetupValidator, type DebateCapabilityRequirements } from '../setup-validation'
import {
  DebateRuntimePreparationService,
  DebateRuntimeResolver,
  TurnRunnerFactory,
  type DebateRuntimePreparationResult
} from '../runtime'
import { DebatePromptBuilder, ResearchContextReader } from '../research'

export interface DebateSetupApplicationOptions extends DatabaseOptions {
  getCapabilityRequirements?: (sessionId: string) => DebateCapabilityRequirements | undefined
  credentialStore?: CredentialStore
  openAITransport?: HttpTransport
  mockAdapter?: ModelAdapter
  fetchTimeoutMs?: number
}

export class DebateSetupApplication {
  private readonly validator: DebateSetupValidator
  private readonly loader: DebateSetupLoader
  private readonly preparationService: DebateRuntimePreparationService
  private closed = false

  constructor(
    private readonly persistence: PersistenceContext,
    options: Omit<DebateSetupApplicationOptions, keyof DatabaseOptions>,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly connectionTestService: ConnectionTestService
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
    this.preparationService = new DebateRuntimePreparationService({
      loader: { load: (sessionId) => this.loadDebateSetup(sessionId) },
      resolver: new DebateRuntimeResolver(),
      turnRunnerFactory: new TurnRunnerFactory(new DebatePromptBuilder(new ResearchContextReader(
        persistence.repositories.debates,
        persistence.repositories.research
      ))),
      adapterRegistry
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

  prepareDebateRuntime(sessionId: string): DebateRuntimePreparationResult {
    return this.preparationService.prepare(sessionId)
  }

  testProviderConnection(
    connection: ProviderConnection,
    modelProfile?: ModelProfile,
    signal?: AbortSignal
  ): Promise<ConnectionTestResult> {
    return this.connectionTestService.test(connection, modelProfile, signal)
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

  return { ok: true, value: composeDebateSetupApplication(persistenceResult.value, options) }
}

export function composeDebateSetupApplication(
  persistence: PersistenceContext,
  options: DebateSetupApplicationOptions
): DebateSetupApplication {
  const credentialStore = options.credentialStore ?? new MacOSKeychainCredentialStore()
  const openAITransport = options.openAITransport ?? new FetchHttpTransport({ timeoutMs: options.fetchTimeoutMs })
  const authenticatedTransport = new AuthenticatedHttpTransport(
    openAITransport,
    credentialStore,
    (connectionId) => {
      const connectionResult = persistence.repositories.providerConnections.findById(connectionId)
      if (!connectionResult.ok) throw new Error('ProviderConnection repository lookup failed.')
      return connectionResult.value?.credentialRef
    }
  )
  const adapterRegistry = new AdapterRegistry()
  const registrations = [
    adapterRegistry.register('mock', options.mockAdapter ?? new MockAdapter()),
    adapterRegistry.register('openai-chat', new OpenAIChatAdapter(authenticatedTransport))
  ]
  const registrationFailure = registrations.find((registration) => !registration.ok)
  if (registrationFailure && !registrationFailure.ok) {
    persistence.database.close()
    throw new Error(`${registrationFailure.error.code}: ${registrationFailure.error.message}`)
  }

  return new DebateSetupApplication(persistence, {
    getCapabilityRequirements: options.getCapabilityRequirements,
    credentialStore,
    openAITransport,
    mockAdapter: options.mockAdapter,
    fetchTimeoutMs: options.fetchTimeoutMs
  }, adapterRegistry, new ConnectionTestService({
    transport: openAITransport,
    credentialStore
  }))
}
