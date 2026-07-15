export const DEBATE_STAGES = [
  'draft',
  'validating',
  'moderating',
  'public_pool',
  'affirmative_planning',
  'negative_planning',
  'affirmative_research',
  'negative_research',
  'argument_drafting',
  'affirmative_opening',
  'negative_opening',
  'cross_examination',
  'rebuttal',
  'free_debate',
  'negative_closing',
  'affirmative_closing',
  // Kept as a legacy-restoration stage for databases created before the split closing stages.
  'closing',
  'adjudication',
  'completed'
] as const

export type DebateStage = (typeof DEBATE_STAGES)[number]

export type DebateStatus = 'draft' | 'running' | 'paused' | 'stopped' | 'completed'

export type ParticipantRole = 'affirmative' | 'negative' | 'moderator' | 'judge'

export interface DebateParticipant {
  id: string
  role: ParticipantRole
  name: string
}

export interface DebateConfig {
  id: string
  topic: string
  background?: string
  affirmativePosition?: string
  negativePosition?: string
  freeDebateRounds?: number
  participants: DebateParticipant[]
}

export interface DebateSession extends DebateConfig {
  createdAt: string
}

export interface DebateState {
  sessionId: string
  stage: DebateStage
  status: DebateStatus
  currentTurnId?: string
}

export type DebateTurnStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'skipped'
  | 'forced'

export interface DebateTurnFailure {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh: string
  technicalDetails?: string
}

export interface DebateTurn {
  id: string
  sessionId: string
  stage: Exclude<DebateStage, 'draft' | 'completed'>
  participantId: string
  status: DebateTurnStatus
  content?: string
  retryOfTurnId?: string
  error?: string
  failure?: DebateTurnFailure
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  runtimeModel?: {
    modelProfileId?: string
    providerConnectionId?: string
    modelId?: string
  }
  createdAt: string
}

export interface TurnCompletion {
  turnId?: string
  content?: string
  retryOfTurnId?: string
}

export type DebateCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'skip'; reason?: string }
  | { type: 'forceNext'; reason: string }

export type DebateEvent =
  | {
      id: string
      type: 'stateChanged'
      sessionId: string
      createdAt: string
      from: DebateState
      to: DebateState
      cause: DebateCommand['type'] | 'advance'
    }
  | {
      id: string
      type: 'turnCompleted'
      sessionId: string
      createdAt: string
      turn: DebateTurn
    }
  | {
      id: string
      type: 'stageSkipped'
      sessionId: string
      createdAt: string
      turn: DebateTurn
      reason?: string
    }

export interface DebateError {
  code: 'INVALID_TRANSITION' | 'MISSING_PARTICIPANT'
  message: string
  stage: DebateStage
  status: DebateStatus
}

export type EngineResult =
  | { ok: true; state: DebateState; events: DebateEvent[] }
  | { ok: false; state: DebateState; events: []; error: DebateError }
