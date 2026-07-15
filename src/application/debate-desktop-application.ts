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
import { ErrorCenter, ObservedCredentialStore, StructuredLogger } from '../observability'
import { DebateConfigurationApplication } from './debate-configuration-application'
import { ResearchApprovalController, ResearchRunCoordinator } from '../research'
import { AutonomousResearchExecutor } from '../runtime'
import { ResearchApplication } from './research-application'
import {
  DebateRunApplication,
  type DebateRunApplicationOptions
} from './debate-run-application'
import { DebateRunPersistence } from './debate-run-persistence'
import { composeDebateSetupApplication } from './debate-setup-application'
import { DiagnosticsApplication } from './diagnostics-application'
import { DebateHistoryApplication } from './debate-history-application'
import { ExportApplication } from './export-application'

export interface DebateDesktopApplicationOptions extends DebateRunApplicationOptions {
  credentialStore?: CredentialStore
  openAITransport?: HttpTransport
  logger?: StructuredLogger
  errorCenter?: ErrorCenter
  appVersion?: string
  systemInfo?: Record<string, string>
}

export class DebateDesktopApplication {
  constructor(
    readonly configuration: DebateConfigurationApplication,
    readonly run: DebateRunApplication,
    readonly research: ResearchApplication,
    readonly diagnostics: DiagnosticsApplication,
    readonly history: DebateHistoryApplication,
    readonly exports: ExportApplication,
    readonly logger: StructuredLogger,
    readonly errorCenter: ErrorCenter
  ) {}

  close(): Promise<PersistenceResult<void>> {
    return this.run.close()
  }
}

export function initializeDebateDesktopApplication(
  options: DebateDesktopApplicationOptions
): PersistenceResult<DebateDesktopApplication> {
  const logger = options.logger ?? new StructuredLogger({
    directory: `${options.appDataDirectory}/logs`,
    now: options.now
  })
  const errorCenter = options.errorCenter ?? new ErrorCenter({
    filePath: `${options.appDataDirectory}/diagnostics/errors.jsonl`,
    appVersion: options.appVersion ?? '0.1.0',
    systemInfo: options.systemInfo ?? { platform: process.platform, arch: process.arch, node: process.versions.node },
    now: options.now
  })
  const persistenceResult = initializePersistence({ ...options, logger })
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
  const researchRecovered = persistence.repositories.research.markActiveToolCallsInterrupted(recoveredAt)
  if (!researchRecovered.ok) {
    persistence.database.close()
    return researchRecovered
  }

  const baseCredentialStore = options.credentialStore ?? new MacOSKeychainCredentialStore()
  const credentialStore = new ObservedCredentialStore(baseCredentialStore, logger, errorCenter)
  const openAITransport = options.openAITransport ?? new FetchHttpTransport({ timeoutMs: options.fetchTimeoutMs, logger })
  const mockAdapter = options.mockAdapter ?? new MockAdapter({
    chunks: ['[Mock] ', '这是模拟模型的', '流式发言，', '不会访问网络。'],
    delayMs: 120
  })
  const approvalController = new ResearchApprovalController()
  const researchExecutor = new AutonomousResearchExecutor({
    persistence,
    credentialStore,
    approvalController,
    now: options.now,
    logger
  })
  try {
    const setupApplication = composeDebateSetupApplication(persistence, {
      ...options,
      credentialStore,
      openAITransport,
      mockAdapter,
      researchExecutor
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
    const researchCoordinator = new ResearchRunCoordinator({
      research: persistence.repositories.research,
      participants: persistence.repositories.participants,
      now: options.now
    })
    const run = new DebateRunApplication(persistence, setupApplication, runPersistence, researchCoordinator)
    const research = new ResearchApplication({
      persistence,
      appDataDirectory: options.appDataDirectory,
      credentialStore,
      approvalController,
      now: options.now,
      logger
    })
    const diagnostics = new DiagnosticsApplication({
      appDataDirectory: options.appDataDirectory,
      errorCenter,
      logger,
      now: options.now
    })
    const history = new DebateHistoryApplication({ persistence, logger, now: options.now })
    const exports = new ExportApplication({
      persistence,
      history,
      appDataDirectory: options.appDataDirectory,
      logger,
      now: options.now
    })
    logger.info('Debate Studio 应用组合完成', { source: 'application' })
    return { ok: true, value: new DebateDesktopApplication(configuration, run, research, diagnostics, history, exports, logger, errorCenter) }
  } catch (cause) {
    logger.error('Debate Studio 应用组合失败', { source: 'application' })
    errorCenter.capture(cause, { source: 'application', severity: 'critical' })
    persistence.database.close()
    return persistenceFailure('QUERY_FAILED', 'composeDebateDesktopApplication', cause)
  }
}
