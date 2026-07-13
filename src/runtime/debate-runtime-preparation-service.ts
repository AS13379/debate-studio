import type { TurnRunner } from '../execution'
import type { AdapterRegistry } from '../providers'
import type { DebateSetupLoader, DebateSetupLoadError } from '../setup-loading'
import type { DebateSetupIssue } from '../setup-validation'
import type { DebateRuntimeResolver } from './debate-runtime-resolver'
import type { RuntimeTurnExecutor } from './runtime-turn-executor'
import type { TurnRunnerFactory } from './turn-runner-factory'
import type { DebateRuntimeConfig, RuntimeResolveError } from './types'

export interface DebateRuntimePreparationDependencies {
  loader: Pick<DebateSetupLoader, 'load'>
  resolver: Pick<DebateRuntimeResolver, 'resolve'>
  turnRunnerFactory: Pick<TurnRunnerFactory, 'create'>
  adapterRegistry: AdapterRegistry
}

export type DebateRuntimePreparationResult =
  | {
      ok: true
      runtimeConfig: DebateRuntimeConfig
      turnRunner: TurnRunner
      executor: RuntimeTurnExecutor
      warnings: DebateSetupIssue[]
    }
  | {
      ok: false
      loadErrors: DebateSetupLoadError[]
      validationErrors: DebateSetupIssue[]
      runtimeErrors: RuntimeResolveError[]
      warnings: DebateSetupIssue[]
    }

export class DebateRuntimePreparationService {
  constructor(private readonly dependencies: DebateRuntimePreparationDependencies) {}

  prepare(sessionId: string): DebateRuntimePreparationResult {
    const loaded = this.dependencies.loader.load(sessionId)
    if (loaded.loadErrors.length > 0 || !loaded.setup || !loaded.validation.valid) {
      return {
        ok: false,
        loadErrors: loaded.loadErrors,
        validationErrors: loaded.validation.errors,
        runtimeErrors: [],
        warnings: loaded.validation.warnings
      }
    }

    const resolved = this.dependencies.resolver.resolve(loaded.setup, this.dependencies.adapterRegistry)
    if (!resolved.ok) {
      return {
        ok: false,
        loadErrors: [],
        validationErrors: [],
        runtimeErrors: resolved.errors,
        warnings: loaded.validation.warnings
      }
    }

    const bundle = this.dependencies.turnRunnerFactory.create(resolved.config)
    return {
      ok: true,
      runtimeConfig: resolved.config,
      turnRunner: bundle.turnRunner,
      executor: bundle.executor,
      warnings: loaded.validation.warnings
    }
  }
}
