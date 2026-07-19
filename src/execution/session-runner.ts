import { randomUUID } from 'node:crypto'

import {
  DebateEngine,
  type DebateConfig,
  type DebateEngineDependencies,
  type DebateEvent,
  type DebateState,
  type DebateTurn
} from '../domain'
import { TurnRunner, type TurnRunObserver } from './turn-runner'

type StateChangedEvent = Extract<DebateEvent, { type: 'stateChanged' }>

export type SessionRunnerEvent =
  | { id: string; type: 'stateChanged'; sessionId: string; createdAt: string; event: StateChangedEvent }
  | { id: string; type: 'turnStarted'; sessionId: string; createdAt: string; turn: DebateTurn }
  | { id: string; type: 'turnUpdated'; sessionId: string; createdAt: string; turnId: string; stage: DebateTurn['stage']; participantId: string; delta: string; content: string }
  | { id: string; type: 'turnReasoningUpdated'; sessionId: string; createdAt: string; turnId: string; stage: DebateTurn['stage']; participantId: string; delta: string }
  | { id: string; type: 'turnCompleted'; sessionId: string; createdAt: string; turn: DebateTurn }
  | { id: string; type: 'turnFailed'; sessionId: string; createdAt: string; turn: DebateTurn }
  | { id: string; type: 'sessionPaused'; sessionId: string; createdAt: string }
  | { id: string; type: 'sessionStopped'; sessionId: string; createdAt: string }
  | { id: string; type: 'sessionCompleted'; sessionId: string; createdAt: string }
  | { id: string; type: 'sessionFailed'; sessionId: string; createdAt: string; error: string; turn?: DebateTurn }

type SessionRunnerEventInput<T = SessionRunnerEvent> = T extends SessionRunnerEvent
  ? Omit<T, 'id' | 'sessionId' | 'createdAt'>
  : never

export type SessionRunStatus = 'completed' | 'paused' | 'stopped' | 'failed'

export interface SessionRunResult {
  status: SessionRunStatus
  state: DebateState
  lastTurn?: DebateTurn
}

export type SessionStepResult =
  | { outcome: 'started'; state: DebateState }
  | { outcome: 'turnCompleted'; state: DebateState; turn: DebateTurn }
  | { outcome: SessionRunStatus; state: DebateState; turn?: DebateTurn }

type ActiveTurnStepResult = Exclude<SessionStepResult, { outcome: 'started' }>

export interface SessionRunnerDependencies {
  engine?: DebateEngineDependencies
  createId?: () => string
  now?: () => Date
  onEvent?: (event: SessionRunnerEvent) => void
}

export class SessionRunner {
  readonly engine: DebateEngine

  private readonly eventLog: SessionRunnerEvent[] = []
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly onEvent?: (event: SessionRunnerEvent) => void
  private runPromise?: Promise<SessionRunResult>
  private stepInProgress = false
  private skipRequest?: { reason?: string; resolve(result: boolean): void }
  private skipSettlement?: Promise<boolean>

  constructor(config: DebateConfig, private readonly turnRunner: TurnRunner, dependencies: SessionRunnerDependencies = {}) {
    this.engine = new DebateEngine(config, dependencies.engine)
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.onEvent = dependencies.onEvent
  }

  getEvents(): SessionRunnerEvent[] {
    return [...this.eventLog]
  }

  async run(): Promise<SessionRunResult> {
    if (this.runPromise) return this.runPromise
    this.runPromise = this.drive()
    try {
      return await this.runPromise
    } finally {
      this.runPromise = undefined
    }
  }

  pause(): boolean {
    const result = this.engine.dispatch({ type: 'pause' })
    if (!result.ok) return false
    this.recordStateChanges(result.events)
    this.turnRunner.cancelTurn()
    this.emit({ type: 'sessionPaused' })
    return true
  }

  async resume(): Promise<SessionRunResult> {
    if (this.runPromise) await this.runPromise
    const result = this.engine.dispatch({ type: 'resume' })
    if (!result.ok) return { status: this.statusFromState(), state: this.engine.getState() }
    this.recordStateChanges(result.events)
    return this.run()
  }

  stop(): boolean {
    const result = this.engine.dispatch({ type: 'stop' })
    if (!result.ok) return false
    this.recordStateChanges(result.events)
    this.turnRunner.cancelTurn()
    this.emit({ type: 'sessionStopped' })
    return true
  }

  skip(reason?: string): boolean {
    if (this.skipRequest) return false
    let resolveSettlement: (result: boolean) => void = () => undefined
    const settlement = new Promise<boolean>((resolve) => { resolveSettlement = resolve })
    this.skipRequest = { reason, resolve: resolveSettlement }
    this.skipSettlement = settlement
    if (this.turnRunner.cancelTurn()) return true

    this.clearSkipRequest(false)
    return this.applySkip(reason)
  }

  waitForSkipSettlement(): Promise<boolean> | undefined {
    return this.skipSettlement
  }

  private applySkip(reason?: string): boolean {
    const result = this.engine.dispatch({ type: 'skip', reason })
    if (!result.ok) return false
    const skippedTurn = result.events.find((event) => event.type === 'stageSkipped')?.turn
    if (skippedTurn) this.emit({ type: 'turnCompleted', turn: skippedTurn })
    this.recordStateChanges(result.events)
    return true
  }

  async retryFailedTurn(previousTurn: DebateTurn): Promise<SessionRunResult> {
    if (this.runPromise) return this.runPromise
    this.runPromise = this.drive(previousTurn)
    try {
      return await this.runPromise
    } finally {
      this.runPromise = undefined
    }
  }

  async step(): Promise<SessionStepResult> {
    if (this.stepInProgress) throw new Error('A session step is already running.')
    this.stepInProgress = true

    try {
      const state = this.engine.getState()
      if (state.status === 'draft') {
        const result = this.engine.dispatch({ type: 'start' })
        if (!result.ok) return this.failSession(result.error.message)
        this.recordStateChanges(result.events)
        return { outcome: 'started', state: this.engine.getState() }
      }
      if (state.status !== 'running') {
        return { outcome: this.statusFromState(), state }
      }

      return this.executeTurn()
    } catch (error) {
      return this.failSession(error instanceof Error ? error.message : 'Unknown session error.')
    } finally {
      this.stepInProgress = false
    }
  }

  private async drive(retryTurn?: DebateTurn): Promise<SessionRunResult> {
    let lastTurn: DebateTurn | undefined

    if (retryTurn) {
      const retried = await this.executeTurn(retryTurn)
      if ('turn' in retried) lastTurn = retried.turn
      if (retried.outcome !== 'turnCompleted') {
        return { status: retried.outcome, state: retried.state, lastTurn }
      }
    }

    while (true) {
      const state = this.engine.getState()
      if (state.status === 'completed' || state.status === 'paused' || state.status === 'stopped') {
        return { status: this.statusFromState(), state, lastTurn }
      }

      const result = await this.step()
      if ('turn' in result) lastTurn = result.turn
      if (result.outcome === 'failed' || result.outcome === 'paused' || result.outcome === 'stopped' || result.outcome === 'completed') {
        return { status: result.outcome, state: result.state, lastTurn }
      }
    }
  }

  private async executeTurn(previousTurn?: DebateTurn): Promise<ActiveTurnStepResult> {
    const state = this.engine.getState()
    const participant = this.engine.getCurrentParticipant()
    if (state.status !== 'running' || !participant || state.stage === 'draft' || state.stage === 'completed') {
      return this.failSession(`No runnable participant at stage ${state.stage}.`)
    }

    const engineEventOffset = this.engine.getEvents().length
    const observer: TurnRunObserver = {
      onStarted: (turn) => this.emit({ type: 'turnStarted', turn }),
      onUpdated: (turn, delta) => this.emit({
        type: 'turnUpdated',
        turnId: turn.id,
        stage: turn.stage,
        participantId: turn.participantId,
        delta,
        content: turn.content ?? ''
      }),
      onReasoningUpdated: (turn, delta) => this.emit({
        type: 'turnReasoningUpdated',
        turnId: turn.id,
        stage: turn.stage,
        participantId: turn.participantId,
        delta
      })
    }
    const result = previousTurn
      ? await this.turnRunner.retryTurn(this.engine, previousTurn, undefined, observer)
      : await this.turnRunner.startTurn(this.engine, undefined, undefined, observer)

    if (result.turn.status === 'completed') this.emit({ type: 'turnCompleted', turn: result.turn })
    else this.emit({ type: 'turnFailed', turn: result.turn })
    this.recordStateChanges(this.engine.getEvents().slice(engineEventOffset))

    if (this.skipRequest) {
      // The old request has now settled, so advancing the engine cannot race
      // with stale output being recorded against the next stage. If it happened
      // to complete just before AbortSignal won, it already advanced normally
      // and we must not skip the newly entered stage as well.
      const skipped = result.turn.status === 'completed'
        ? true
        : this.applySkip(this.skipRequest.reason)
      this.clearSkipRequest(skipped)
      const current = this.engine.getState()
      if (!skipped) return this.failSession('Skip request could not advance the current stage.', result.turn)
      if (current.status === 'completed') {
        this.emit({ type: 'sessionCompleted' })
        return { outcome: 'completed', state: current, turn: result.turn }
      }
      return { outcome: 'turnCompleted', state: current, turn: result.turn }
    }

    if (result.turn.status === 'failed') {
      return this.failSession(result.turn.error ?? 'Turn failed.', result.turn)
    }
    if (result.turn.status === 'cancelled') {
      const current = this.engine.getState()
      if (current.status === 'paused' || current.status === 'stopped') {
        return { outcome: current.status, state: current, turn: result.turn }
      }
      return this.failSession(result.turn.error ?? 'Turn was cancelled.', result.turn)
    }

    const current = this.engine.getState()
    if (current.status === 'completed') {
      this.emit({ type: 'sessionCompleted' })
      return { outcome: 'completed', state: current, turn: result.turn }
    }
    return { outcome: 'turnCompleted', state: current, turn: result.turn }
  }

  private recordStateChanges(events: DebateEvent[]): void {
    for (const event of events) {
      if (event.type === 'stateChanged') this.emit({ type: 'stateChanged', event })
    }
  }

  private clearSkipRequest(result: boolean): void {
    const request = this.skipRequest
    this.skipRequest = undefined
    request?.resolve(result)
  }

  private failSession(error: string, turn?: DebateTurn): { outcome: 'failed'; state: DebateState; turn?: DebateTurn } {
    this.emit({ type: 'sessionFailed', error, turn })
    return { outcome: 'failed', state: this.engine.getState(), turn }
  }

  private statusFromState(): Exclude<SessionRunStatus, 'failed'> {
    const status = this.engine.getState().status
    if (status === 'paused' || status === 'stopped' || status === 'completed') return status
    throw new Error(`Session is not terminal: ${status}.`)
  }

  private emit(event: SessionRunnerEventInput): void {
    const completeEvent = {
      ...event,
      id: this.createId(),
      sessionId: this.engine.session.id,
      createdAt: this.now().toISOString()
    } as SessionRunnerEvent
    // Raw reasoning can be large and may contain provider-only intermediate
    // output. It is forwarded live but intentionally omitted from retained
    // SessionRunner history.
    if (completeEvent.type !== 'turnReasoningUpdated') this.eventLog.push(completeEvent)
    this.onEvent?.(completeEvent)
  }
}
