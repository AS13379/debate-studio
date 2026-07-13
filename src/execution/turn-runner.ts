import { randomUUID } from 'node:crypto'

import { DebateEngine, type DebateTurn } from '../domain'
import type { ModelAdapter, UnifiedRequest, UnifiedStreamEvent } from '../providers'

export interface TurnRunnerDependencies {
  createId?: () => string
  now?: () => Date
  onStreamEvent?: (event: UnifiedStreamEvent) => void
}

export interface TurnRunResult {
  turn: DebateTurn
  streamEvents: UnifiedStreamEvent[]
}

export interface TurnRunObserver {
  onStarted?(turn: DebateTurn): void
  onUpdated?(turn: DebateTurn, delta: string): void
}

interface ActiveRun {
  turnId: string
  controller: AbortController
}

export class TurnRunner {
  private activeRun?: ActiveRun
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly onStreamEvent?: (event: UnifiedStreamEvent) => void

  constructor(private readonly adapter: ModelAdapter, dependencies: TurnRunnerDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.onStreamEvent = dependencies.onStreamEvent
  }

  async startTurn(
    engine: DebateEngine,
    prompt?: string,
    retryOfTurnId?: string,
    observer?: TurnRunObserver
  ): Promise<TurnRunResult> {
    if (this.activeRun) throw new Error('A turn is already running.')

    const state = engine.getState()
    const participant = engine.getCurrentParticipant()
    if (state.status !== 'running' || state.stage === 'draft' || state.stage === 'completed' || !participant) {
      throw new Error(`Cannot start a turn while debate is ${state.status} at ${state.stage}.`)
    }
    const stage = state.stage

    const turnId = this.createId()
    const controller = new AbortController()
    this.activeRun = { turnId, controller }
    const streamEvents: UnifiedStreamEvent[] = []
    const startedAt = this.timestamp()
    let content = ''
    const runningTurn = (): DebateTurn => ({
      id: turnId,
      sessionId: engine.session.id,
      stage,
      participantId: participant.id,
      status: 'running',
      content,
      retryOfTurnId,
      createdAt: startedAt
    })

    const resolvedPrompt = prompt ?? `请完成辩论阶段：${state.stage}`
    const request: UnifiedRequest = {
      requestId: this.createId(),
      turnId,
      sessionId: engine.session.id,
      stage,
      topic: engine.session.topic,
      participant,
      prompt: resolvedPrompt,
      signal: controller.signal,
      modelId: '',
      messages: [{ role: 'user', content: resolvedPrompt }],
      stream: true,
      maxTokens: undefined,
      runtimeMetadata: {
        sessionId: engine.session.id,
        role: participant.role,
        turnId,
        stage
      }
    }

    try {
      observer?.onStarted?.({ ...runningTurn() })
      for await (const event of this.adapter.stream(request)) {
        streamEvents.push(event)
        this.onStreamEvent?.(event)

        if (event.type === 'textDelta') {
          content += event.delta
          observer?.onUpdated?.({ ...runningTurn() }, event.delta)
        }
        if (event.type === 'completed') {
          const changed = content !== event.response.content
          content = event.response.content
          if (changed) observer?.onUpdated?.({ ...runningTurn() }, '')
        }
        if (event.type === 'error') {
          return {
            turn: {
              id: turnId,
              sessionId: engine.session.id,
              stage: state.stage,
              participantId: participant.id,
              status: event.error.code === 'CANCELLED' ? 'cancelled' : 'failed',
              content,
              retryOfTurnId,
              error: event.error.message,
              createdAt: startedAt
            },
            streamEvents
          }
        }
      }

      const completedEvent = streamEvents.find((event) => event.type === 'completed')
      if (!completedEvent || completedEvent.type !== 'completed') {
        return {
          turn: this.failedTurn(engine, turnId, participant.id, state.stage, startedAt, content, retryOfTurnId, 'Adapter stream ended without completion.'),
          streamEvents
        }
      }

      const engineResult = engine.advance({ turnId, content, retryOfTurnId })
      if (!engineResult.ok) {
        return {
          turn: this.failedTurn(engine, turnId, participant.id, state.stage, startedAt, content, retryOfTurnId, engineResult.error.message),
          streamEvents
        }
      }

      const turn = engineResult.events.find((event) => event.type === 'turnCompleted')?.turn
      if (!turn) throw new Error('DebateEngine did not return a completed turn.')
      return { turn, streamEvents }
    } finally {
      if (this.activeRun?.turnId === turnId) this.activeRun = undefined
    }
  }

  cancelTurn(turnId?: string): boolean {
    if (!this.activeRun || (turnId && this.activeRun.turnId !== turnId)) return false
    this.activeRun.controller.abort()
    return true
  }

  retryTurn(
    engine: DebateEngine,
    previousTurn: DebateTurn,
    prompt?: string,
    observer?: TurnRunObserver
  ): Promise<TurnRunResult> {
    if (
      previousTurn.status !== 'failed'
      && previousTurn.status !== 'cancelled'
      && previousTurn.status !== 'interrupted'
    ) {
      throw new Error('Only failed, cancelled or interrupted turns can be retried.')
    }
    return this.startTurn(engine, prompt, previousTurn.id, observer)
  }

  private failedTurn(
    engine: DebateEngine,
    id: string,
    participantId: string,
    stage: Exclude<ReturnType<DebateEngine['getState']>['stage'], 'draft' | 'completed'>,
    createdAt: string,
    content: string,
    retryOfTurnId: string | undefined,
    error: string
  ): DebateTurn {
    return { id, sessionId: engine.session.id, stage, participantId, status: 'failed', content, retryOfTurnId, error, createdAt }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}
