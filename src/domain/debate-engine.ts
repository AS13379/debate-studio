import { randomUUID } from 'node:crypto'

import type {
  DebateCommand,
  DebateConfig,
  DebateError,
  DebateEvent,
  DebateParticipant,
  DebateSession,
  DebateStage,
  DebateState,
  DebateTurn,
  DebateTurnStatus,
  EngineResult,
  ParticipantRole
} from './debate-types'

const FLOW: readonly DebateStage[] = [
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
]

const STAGE_ROLE: Record<Exclude<DebateStage, 'draft' | 'completed'>, ParticipantRole[]> = {
  validating: ['moderator'],
  moderating: ['moderator'],
  affirmative_opening: ['affirmative'],
  negative_opening: ['negative'],
  rebuttal: ['negative'],
  free_debate: ['affirmative', 'negative'],
  closing: ['affirmative'],
  adjudication: ['judge', 'moderator']
}

export interface DebateEngineDependencies {
  createId?: () => string
  now?: () => Date
}

export class DebateEngine {
  readonly session: DebateSession

  private state: DebateState
  private readonly turns: DebateTurn[] = []
  private readonly eventLog: DebateEvent[] = []
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(config: DebateConfig, dependencies: DebateEngineDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.session = { ...config, participants: [...config.participants], createdAt: this.timestamp() }
    this.state = { sessionId: config.id, stage: 'draft', status: 'draft' }
  }

  getState(): DebateState {
    return { ...this.state }
  }

  getTurns(): DebateTurn[] {
    return this.turns.map((turn) => ({ ...turn }))
  }

  getEvents(): DebateEvent[] {
    return [...this.eventLog]
  }

  dispatch(command: DebateCommand): EngineResult {
    switch (command.type) {
      case 'start':
        if (this.state.status !== 'draft') return this.reject('start')
        return this.transition({ stage: 'validating', status: 'running' }, 'start')

      case 'pause':
        if (this.state.status !== 'running') return this.reject('pause')
        return this.transition({ status: 'paused' }, 'pause')

      case 'resume':
        if (this.state.status !== 'paused') return this.reject('resume')
        return this.transition({ status: 'running' }, 'resume')

      case 'stop':
        if (this.state.status !== 'running' && this.state.status !== 'paused') {
          return this.reject('stop')
        }
        return this.transition({ status: 'stopped' }, 'stop')

      case 'skip':
        return this.skipStage('skipped', 'skip', command.reason)

      case 'forceNext':
        return this.skipStage('forced', 'forceNext', command.reason)
    }
  }

  /** Completes the current stage with deterministic Mock output and enters the next stage. */
  advance(): EngineResult {
    if (this.state.status !== 'running' || !this.isActiveStage(this.state.stage)) {
      return this.reject('advance')
    }

    const participant = this.participantFor(this.state.stage)
    if (!participant) return this.missingParticipant(this.state.stage)

    const turn = this.createTurn(this.state.stage, participant, 'completed', this.mockSpeech(this.state.stage, participant))
    const speechEvent: DebateEvent = {
      id: this.createId(),
      type: 'mockSpeech',
      sessionId: this.session.id,
      createdAt: this.timestamp(),
      turn
    }
    this.turns.push(turn)
    this.eventLog.push(speechEvent)

    const transitionResult = this.transitionToNext('advance')
    if (!transitionResult.ok) return transitionResult
    return { ok: true, state: transitionResult.state, events: [speechEvent, ...transitionResult.events] }
  }

  private skipStage(status: Extract<DebateTurnStatus, 'skipped' | 'forced'>, cause: 'skip' | 'forceNext', reason?: string): EngineResult {
    if (this.state.status !== 'running' || !this.isActiveStage(this.state.stage)) {
      return this.reject(cause)
    }

    const participant = this.participantFor(this.state.stage)
    if (!participant) return this.missingParticipant(this.state.stage)

    const turn = this.createTurn(this.state.stage, participant, status)
    const skippedEvent: DebateEvent = {
      id: this.createId(),
      type: 'stageSkipped',
      sessionId: this.session.id,
      createdAt: this.timestamp(),
      turn,
      reason
    }
    this.turns.push(turn)
    this.eventLog.push(skippedEvent)

    const transitionResult = this.transitionToNext(cause)
    if (!transitionResult.ok) return transitionResult
    return { ok: true, state: transitionResult.state, events: [skippedEvent, ...transitionResult.events] }
  }

  private transitionToNext(cause: 'advance' | 'skip' | 'forceNext'): EngineResult {
    const currentIndex = FLOW.indexOf(this.state.stage)
    const nextStage = FLOW[currentIndex + 1]
    if (!nextStage) return this.reject(cause)

    return this.transition(
      {
        stage: nextStage,
        status: nextStage === 'completed' ? 'completed' : 'running',
        currentTurnId: undefined
      },
      cause
    )
  }

  private transition(update: Partial<DebateState>, cause: DebateCommand['type'] | 'advance'): EngineResult {
    const from = this.getState()
    this.state = { ...this.state, ...update }
    const event: DebateEvent = {
      id: this.createId(),
      type: 'stateChanged',
      sessionId: this.session.id,
      createdAt: this.timestamp(),
      from,
      to: this.getState(),
      cause
    }
    this.eventLog.push(event)
    return { ok: true, state: this.getState(), events: [event] }
  }

  private createTurn(
    stage: Exclude<DebateStage, 'draft' | 'completed'>,
    participant: DebateParticipant,
    status: DebateTurnStatus,
    content?: string
  ): DebateTurn {
    return {
      id: this.createId(),
      sessionId: this.session.id,
      stage,
      participantId: participant.id,
      status,
      content,
      createdAt: this.timestamp()
    }
  }

  private participantFor(stage: Exclude<DebateStage, 'draft' | 'completed'>): DebateParticipant | undefined {
    const acceptedRoles = STAGE_ROLE[stage]
    return this.session.participants.find((participant) => acceptedRoles.includes(participant.role))
  }

  private mockSpeech(stage: Exclude<DebateStage, 'draft' | 'completed'>, participant: DebateParticipant): string {
    return `[Mock] ${participant.name} 完成阶段：${stage}`
  }

  private isActiveStage(stage: DebateStage): stage is Exclude<DebateStage, 'draft' | 'completed'> {
    return stage !== 'draft' && stage !== 'completed'
  }

  private reject(command: DebateCommand['type'] | 'advance'): EngineResult {
    return this.failure({
      code: 'INVALID_TRANSITION',
      message: `Cannot ${command} while debate is ${this.state.status} at ${this.state.stage}.`,
      stage: this.state.stage,
      status: this.state.status
    })
  }

  private missingParticipant(stage: DebateStage): EngineResult {
    return this.failure({
      code: 'MISSING_PARTICIPANT',
      message: `No participant is configured for stage ${stage}.`,
      stage,
      status: this.state.status
    })
  }

  private failure(error: DebateError): EngineResult {
    return { ok: false, state: this.getState(), events: [], error }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}
