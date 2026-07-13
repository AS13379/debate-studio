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
  ParticipantRole,
  TurnCompletion
} from './debate-types'

const FLOW: readonly DebateStage[] = [
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
  'adjudication',
  'completed'
]

const STAGE_ROLE: Record<Exclude<DebateStage, 'draft' | 'completed'>, ParticipantRole[]> = {
  validating: ['moderator'],
  moderating: ['moderator'],
  public_pool: ['moderator'],
  affirmative_planning: ['affirmative'],
  negative_planning: ['negative'],
  affirmative_research: ['affirmative'],
  negative_research: ['negative'],
  argument_drafting: ['affirmative', 'negative'],
  affirmative_opening: ['affirmative'],
  negative_opening: ['negative'],
  cross_examination: ['affirmative', 'negative'],
  rebuttal: ['affirmative', 'negative'],
  free_debate: ['affirmative', 'negative'],
  negative_closing: ['negative'],
  affirmative_closing: ['affirmative'],
  closing: ['affirmative'],
  adjudication: ['judge', 'moderator']
}

export interface DebateEngineDependencies {
  createId?: () => string
  now?: () => Date
  initialState?: Pick<DebateState, 'stage' | 'status'>
  initialStageTurnCount?: number
}

export class DebateEngine {
  readonly session: DebateSession

  private state: DebateState
  private readonly turns: DebateTurn[] = []
  private readonly eventLog: DebateEvent[] = []
  private readonly createId: () => string
  private readonly now: () => Date
  private stageTurnCount: number

  constructor(config: DebateConfig, dependencies: DebateEngineDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.stageTurnCount = dependencies.initialStageTurnCount ?? 0
    this.session = { ...config, participants: [...config.participants], createdAt: this.timestamp() }
    this.state = {
      sessionId: config.id,
      stage: dependencies.initialState?.stage ?? 'draft',
      status: dependencies.initialState?.status ?? 'draft'
    }
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

  getCurrentParticipant(): DebateParticipant | undefined {
    if (!this.isActiveStage(this.state.stage)) return undefined
    const participant = this.participantFor(this.state.stage)
    return participant ? { ...participant } : undefined
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

  /** Records an externally produced turn and enters the next stage. */
  advance(completion: TurnCompletion = {}): EngineResult {
    if (this.state.status !== 'running' || !this.isActiveStage(this.state.stage)) {
      return this.reject('advance')
    }

    const participant = this.participantFor(this.state.stage)
    if (!participant) return this.missingParticipant(this.state.stage)

    const turn = this.createTurn(
      this.state.stage,
      participant,
      'completed',
      completion.content,
      completion.turnId,
      completion.retryOfTurnId
    )
    const speechEvent: DebateEvent = {
      id: this.createId(),
      type: 'turnCompleted',
      sessionId: this.session.id,
      createdAt: this.timestamp(),
      turn
    }
    this.turns.push(turn)
    this.eventLog.push(speechEvent)

    this.stageTurnCount += 1

    if (this.stageTurnCount < this.participantsFor(this.state.stage).length) {
      const sameStage = this.transition({ currentTurnId: undefined }, 'advance')
      if (!sameStage.ok) return sameStage
      return { ok: true, state: sameStage.state, events: [speechEvent, ...sameStage.events] }
    }

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
    const nextStage = this.state.stage === 'closing' ? 'adjudication' : FLOW[currentIndex + 1]
    if (!nextStage) return this.reject(cause)

    this.stageTurnCount = 0

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
    content?: string,
    turnId?: string,
    retryOfTurnId?: string
  ): DebateTurn {
    return {
      id: turnId ?? this.createId(),
      sessionId: this.session.id,
      stage,
      participantId: participant.id,
      status,
      content,
      retryOfTurnId,
      createdAt: this.timestamp()
    }
  }

  private participantFor(stage: Exclude<DebateStage, 'draft' | 'completed'>): DebateParticipant | undefined {
    return this.participantsFor(stage)[this.stageTurnCount]
  }

  private participantsFor(stage: Exclude<DebateStage, 'draft' | 'completed'>): DebateParticipant[] {
    if (stage === 'adjudication') {
      const judge = this.session.participants.find((participant) => participant.role === 'judge')
      const moderator = this.session.participants.find((participant) => participant.role === 'moderator')
      return judge ? [judge] : moderator ? [moderator] : []
    }

    const roles = STAGE_ROLE[stage]
    const participants = roles.flatMap((role) => {
      const participant = this.session.participants.find((candidate) => candidate.role === role)
      return participant ? [participant] : []
    })
    if (stage !== 'free_debate') return participants

    const rounds = Math.max(1, Math.floor(this.session.freeDebateRounds ?? 1))
    return Array.from({ length: rounds }, () => participants).flat()
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
