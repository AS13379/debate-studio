export const DEBATE_STAGES = [
  'draft',
  'validating',
  'moderating',
  'affirmative_opening',
  'negative_opening',
  'rebuttal',
  'free_debate',
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

export type DebateTurnStatus = 'completed' | 'skipped' | 'forced'

export interface DebateTurn {
  id: string
  sessionId: string
  stage: Exclude<DebateStage, 'draft' | 'completed'>
  participantId: string
  status: DebateTurnStatus
  content?: string
  createdAt: string
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
      type: 'mockSpeech'
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

