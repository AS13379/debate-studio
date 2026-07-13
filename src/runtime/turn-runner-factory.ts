import { TurnRunner, type TurnRunnerDependencies } from '../execution/turn-runner'
import { RuntimeTurnExecutor } from './runtime-turn-executor'
import type { DebateRuntimeConfig } from './types'

export interface RuntimeTurnRunnerBundle {
  turnRunner: TurnRunner
  executor: RuntimeTurnExecutor
}

export class TurnRunnerFactory {
  create(
    runtimeConfig: DebateRuntimeConfig,
    dependencies: TurnRunnerDependencies = {}
  ): RuntimeTurnRunnerBundle {
    const executor = new RuntimeTurnExecutor(runtimeConfig)
    return {
      executor,
      turnRunner: new TurnRunner(executor, dependencies)
    }
  }
}
