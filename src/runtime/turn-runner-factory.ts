import { TurnRunner, type TurnRunnerDependencies } from '../execution/turn-runner'
import { RuntimeTurnExecutor } from './runtime-turn-executor'
import type { DebateRuntimeConfig, RuntimePromptBuilder, RuntimeResearchExecutor } from './types'
import type { PromptRuntime } from '../prompt-studio'

export interface RuntimeTurnRunnerBundle {
  turnRunner: TurnRunner
  executor: RuntimeTurnExecutor
}

export class TurnRunnerFactory {
  constructor(
    private readonly promptBuilder?: RuntimePromptBuilder,
    private readonly researchExecutor?: RuntimeResearchExecutor,
    private readonly promptRuntime?: PromptRuntime
  ) {}

  create(
    runtimeConfig: DebateRuntimeConfig,
    dependencies: TurnRunnerDependencies = {}
  ): RuntimeTurnRunnerBundle {
    const executor = new RuntimeTurnExecutor(runtimeConfig, this.promptBuilder, this.researchExecutor, this.promptRuntime)
    return {
      executor,
      turnRunner: new TurnRunner(executor, dependencies)
    }
  }
}
