export type DebatePlanningMode = 'auto' | 'assist'
export type DebatePlanningDepth = 'light' | 'standard' | 'deep'

export interface DebatePlan {
  topic: string
  background: string
  affirmativePosition: string
  negativePosition: string
  keyQuestions: string[]
  researchDirections: string[]
  evidenceSuggestions: string[]
}

export interface DebatePlanningInput {
  operationId?: string
  mode: DebatePlanningMode
  topic: string
  background?: string
  domain?: string
  depth?: DebatePlanningDepth
  affirmativePosition?: string
  negativePosition?: string
}

export type DebatePlannerProgressStage = 'preparing' | 'routing' | 'requesting' | 'streaming' | 'parsing' | 'completed' | 'failed'

export interface DebatePlannerProgressEvent {
  stage: DebatePlannerProgressStage
  progress: number
  labelZh: string
  detailZh?: string
  rawInput?: string
  rawOutput?: string
}

export interface DebatePlanProvenance {
  promptVersion: string
  modelProfileId: string
  modelId: string
  createdAt: string
}

export interface PlannedDebate {
  mode: DebatePlanningMode
  plan: DebatePlan
  provenance: DebatePlanProvenance
}

export type DebatePlannerErrorCode =
  | 'INVALID_INPUT'
  | 'MODEL_ROUTE_UNAVAILABLE'
  | 'MODEL_REQUEST_FAILED'
  | 'INVALID_JSON'
  | 'INVALID_PLAN'

export interface DebatePlannerError {
  code: DebatePlannerErrorCode
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh: string
  technicalDetails?: string
}

export type DebatePlannerResult =
  | { ok: true; value: PlannedDebate }
  | { ok: false; error: DebatePlannerError }
