import {
  initializePersistence,
  persistenceFailure,
  type PersistenceResult
} from '../persistence'
import {
  ConnectionTestService,
  FetchHttpTransport,
  MockAdapter,
  type HttpTransport
} from '../providers'
import {
  MacOSKeychainCredentialStore,
  type CredentialStore
} from '../security'
import { DebateConfigurationApplication } from './debate-configuration-application'
import {
  DebateRunApplication,
  type DebateRunApplicationOptions
} from './debate-run-application'
import { DebateRunPersistence } from './debate-run-persistence'
import { composeDebateSetupApplication } from './debate-setup-application'

export interface DebateDesktopApplicationOptions extends DebateRunApplicationOptions {
  credentialStore?: CredentialStore
  openAITransport?: HttpTransport
}

export class DebateDesktopApplication {
  constructor(
    readonly configuration: DebateConfigurationApplication,
    readonly run: DebateRunApplication
  ) {}

  close(): Promise<PersistenceResult<void>> {
    return this.run.close()
  }
}

export function initializeDebateDesktopApplication(
  options: DebateDesktopApplicationOptions
): PersistenceResult<DebateDesktopApplication> {
  const persistenceResult = initializePersistence(options)
  if (!persistenceResult.ok) return persistenceResult
  const persistence = persistenceResult.value
  const recoveredAt = (options.now ?? (() => new Date()))().toISOString()

  const turnsRecovered = persistence.repositories.turns.markInProgressInterrupted(recoveredAt)
  if (!turnsRecovered.ok) {
    persistence.database.close()
    return turnsRecovered
  }
  const sessionsRecovered = persistence.repositories.sessions.markInProgressInterrupted(recoveredAt)
  if (!sessionsRecovered.ok) {
    persistence.database.close()
    return sessionsRecovered
  }

  const credentialStore = options.credentialStore ?? new MacOSKeychainCredentialStore()
  const openAITransport = options.openAITransport ?? new FetchHttpTransport({ timeoutMs: options.fetchTimeoutMs })
  const mockAdapter = options.mockAdapter ?? new MockAdapter({
    chunks: ['[Mock] ', '这是模拟模型的', '流式发言，', '不会访问网络。'],
    delayMs: 120
  })
  try {
    const setupApplication = composeDebateSetupApplication(persistence, {
      ...options,
      credentialStore,
      openAITransport,
      mockAdapter
    })
    const configuration = new DebateConfigurationApplication({
      persistence,
      credentialStore,
      connectionTestService: new ConnectionTestService({ transport: openAITransport, credentialStore }),
      setupApplication,
      now: options.now
    })
    const runPersistence = new DebateRunPersistence({
      repositories: persistence.repositories,
      streamWriteThrottleMs: options.streamWriteThrottleMs
    })
    const run = new DebateRunApplication(persistence, setupApplication, runPersistence)
    return { ok: true, value: new DebateDesktopApplication(configuration, run) }
  } catch (cause) {
    persistence.database.close()
    return persistenceFailure('QUERY_FAILED', 'composeDebateDesktopApplication', cause)
  }
}
