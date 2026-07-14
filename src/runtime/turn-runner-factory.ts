import { TurnRunner, type TurnRunnerDependencies } from '../execution/turn-runner'
import { RuntimeTurnExecutor } from './runtime-turn-executor'
import type { DebateRuntimeConfig, RuntimePromptBuilder, RuntimeResearchExecutor } from './types'

export interface RuntimeTurnRunnerBundle {
  turnRunner: TurnRunner
  executor: RuntimeTurnExecutor
}

export class TurnRunnerFactory {
  constructor(
    private readonly promptBuilder?: RuntimePromptBuilder,
    private readonly researchExecutor?: RuntimeResearchExecutor
  ) {}

  create(
    runtimeConfig: DebateRuntimeConfig,
    dependencies: TurnRunnerDependencies = {}
  ): RuntimeTurnRunnerBundle {
    const executor = new RuntimeTurnExecutor(runtimeConfig, this.promptBuilder, this.researchExecutor)
    return {
      executor,
      turnRunner: new TurnRunner(executor, dependencies)
    }
  }
}
