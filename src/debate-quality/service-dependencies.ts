import type { ModelRoutingService } from '../model-routing'
import type { PersistenceContext } from '../persistence'
import type { PromptRuntime } from '../prompt-studio'

export interface DebateQualityServiceDependencies {
  persistence: PersistenceContext
  routing: ModelRoutingService
  prompts: PromptRuntime
  createId?: () => string
  now?: () => Date
}

