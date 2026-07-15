import { randomUUID } from 'node:crypto'

import type { DebateTurn } from '../domain'
import type { SessionRunnerEvent } from '../execution'
import {
  persistenceFailure,
  type EventRepository,
  type PersistenceError,
  type PersistenceResult,
  type SessionRepository,
  type TurnRecord,
  type TurnRepository,
  type UsageRepository
} from '../persistence'
import { redactForExport, redactSensitiveText } from '../security'

export interface DebateRunPersistenceRepositories {
  sessions: SessionRepository
  turns: TurnRepository
  events: EventRepository
  usage: UsageRepository
}

export interface DebateRunPersistenceOptions {
  repositories: DebateRunPersistenceRepositories
  streamWriteThrottleMs?: number
  createId?: () => string
}

export class DebateRunPersistence {
  private readonly activeTurns = new Map<string, TurnRecord>()
  private readonly pendingUpdates = new Map<string, TurnRecord>()
  private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly startedAt = new Map<string, number>()
  private readonly throttleMs: number
  private readonly createId: () => string
  private asynchronousError?: PersistenceError

  constructor(private readonly options: DebateRunPersistenceOptions) {
    this.throttleMs = Math.max(0, options.streamWriteThrottleMs ?? 100)
    this.createId = options.createId ?? randomUUID
  }

  handle(event: SessionRunnerEvent): PersistenceResult<void> {
    if (this.asynchronousError) return { ok: false, error: this.asynchronousError }

    const businessResult = this.persistBusinessState(event)
    if (!businessResult.ok) return businessResult

    let payloadJson: string
    try {
      payloadJson = JSON.stringify(redactForExport(event))
    } catch (cause) {
      return persistenceFailure('SERIALIZATION_FAILED', 'serializeRunEvent', cause)
    }

    return this.options.repositories.events.create({
      id: event.id,
      sessionId: event.sessionId,
      turnId: this.turnIdFor(event),
      type: event.type,
      payloadJson,
      createdAt: event.createdAt
    })
  }

  flushAll(): PersistenceResult<void> {
    for (const turnId of [...this.pendingUpdates.keys()]) {
      const result = this.flushTurn(turnId)
      if (!result.ok) return result
    }
    if (this.asynchronousError) return { ok: false, error: this.asynchronousError }
    return { ok: true, value: undefined }
  }

  private persistBusinessState(event: SessionRunnerEvent): PersistenceResult<void> {
    switch (event.type) {
      case 'stateChanged':
        return this.asVoid(this.options.repositories.sessions.updateRuntimeState(
          event.sessionId,
          event.event.to.status,
          event.event.to.stage,
          event.createdAt
        ))

      case 'turnStarted': {
        const record = this.turnRecord(event.turn, 'streaming')
        const created = this.options.repositories.turns.create(record)
        if (!created.ok) return created
        this.activeTurns.set(record.id, record)
        this.startedAt.set(record.id, Date.parse(record.createdAt))
        return this.asVoid(this.options.repositories.sessions.updateRuntimeState(
          event.sessionId,
          'streaming',
          event.turn.stage,
          event.createdAt
        ))
      }

      case 'turnUpdated': {
        const current = this.activeTurns.get(event.turnId)
        if (!current) {
          return persistenceFailure(
            'QUERY_FAILED',
            'updateStreamingTurn',
            undefined,
            `Streaming Turn ${event.turnId} was not created before its update.`
          )
        }
        const updated: TurnRecord = { ...current, status: 'streaming', content: event.content }
        this.activeTurns.set(event.turnId, updated)
        this.pendingUpdates.set(event.turnId, updated)
        return this.scheduleFlush(event.turnId)
      }

      case 'turnCompleted':
      case 'turnFailed':
        return this.persistTerminalTurn(event.turn, event.createdAt)

      case 'sessionPaused':
        return this.updateSessionStatus(event.sessionId, 'paused', event.createdAt)

      case 'sessionStopped':
        return this.updateSessionStatus(event.sessionId, 'stopped', event.createdAt)

      case 'sessionCompleted':
        return this.updateSessionStatus(event.sessionId, 'completed', event.createdAt)

      case 'sessionFailed':
        return this.updateSessionStatus(event.sessionId, 'failed', event.createdAt, event.turn?.stage)
    }
  }

  private persistTerminalTurn(
    turn: Extract<SessionRunnerEvent, { type: 'turnCompleted' | 'turnFailed' }>['turn'],
    completedAt: string
  ): PersistenceResult<void> {
    const flushed = this.flushTurn(turn.id)
    if (!flushed.ok) return flushed
    this.cancelTimer(turn.id)

    const record = this.turnRecord(turn, turn.status, completedAt)
    const existing = this.options.repositories.turns.findById(turn.id)
    if (!existing.ok) return existing
    const saved = existing.value
      ? this.options.repositories.turns.update(record)
      : this.options.repositories.turns.create(record)
    if (!saved.ok) return saved
    if ('value' in saved && typeof saved.value === 'boolean' && !saved.value) {
      return persistenceFailure('QUERY_FAILED', 'completeTurn', undefined, `Turn ${turn.id} no longer exists.`)
    }

    this.activeTurns.delete(turn.id)
    this.pendingUpdates.delete(turn.id)
    const startedAt = this.startedAt.get(turn.id) ?? Date.parse(turn.createdAt)
    this.startedAt.delete(turn.id)
    const durationMs = Math.max(0, Date.parse(completedAt) - startedAt)
    return this.options.repositories.usage.create({
      id: this.createId(),
      sessionId: turn.sessionId,
      turnId: turn.id,
      inputTokens: turn.usage?.inputTokens,
      outputTokens: turn.usage?.outputTokens,
      totalTokens: turn.usage?.totalTokens,
      modelProfileId: turn.runtimeModel?.modelProfileId,
      providerConnectionId: turn.runtimeModel?.providerConnectionId,
      modelId: turn.runtimeModel?.modelId,
      costIsEstimated: true,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      createdAt: completedAt
    })
  }

  private scheduleFlush(turnId: string): PersistenceResult<void> {
    if (this.throttleMs === 0) return this.flushTurn(turnId)
    if (this.updateTimers.has(turnId)) return { ok: true, value: undefined }

    const timer = setTimeout(() => {
      this.updateTimers.delete(turnId)
      const result = this.flushTurn(turnId)
      if (!result.ok) this.asynchronousError = result.error
    }, this.throttleMs)
    this.updateTimers.set(turnId, timer)
    return { ok: true, value: undefined }
  }

  private flushTurn(turnId: string): PersistenceResult<void> {
    const record = this.pendingUpdates.get(turnId)
    if (!record) return { ok: true, value: undefined }
    const result = this.options.repositories.turns.update(record)
    if (!result.ok) return result
    if (!result.value) {
      return persistenceFailure('QUERY_FAILED', 'flushStreamingTurn', undefined, `Turn ${turnId} no longer exists.`)
    }
    this.pendingUpdates.delete(turnId)
    return { ok: true, value: undefined }
  }

  private updateSessionStatus(
    sessionId: string,
    status: string,
    updatedAt: string,
    stage?: string
  ): PersistenceResult<void> {
    const current = this.options.repositories.sessions.get(sessionId)
    if (!current.ok) return current
    if (!current.value) {
      return persistenceFailure('QUERY_FAILED', 'updateRunSession', undefined, `Session ${sessionId} does not exist.`)
    }
    return this.asVoid(this.options.repositories.sessions.updateRuntimeState(
      sessionId,
      status,
      stage ?? current.value.currentStage,
      updatedAt
    ))
  }

  private turnRecord(turn: DebateTurn, status: string, completedAt?: string): TurnRecord {
    return {
      id: turn.id,
      sessionId: turn.sessionId,
      participantId: turn.participantId,
      stage: turn.stage,
      status,
      content: turn.content,
      retryOfTurnId: turn.retryOfTurnId,
      error: turn.error ? redactSensitiveText(turn.error) : undefined,
      failure: turn.failure ? redactForExport(turn.failure) : undefined,
      createdAt: turn.createdAt,
      completedAt
    }
  }

  private turnIdFor(event: SessionRunnerEvent): string | undefined {
    if (event.type === 'turnUpdated') return event.turnId
    if (event.type === 'turnStarted' || event.type === 'turnCompleted' || event.type === 'turnFailed') {
      return event.turn.id
    }
    if (event.type === 'sessionFailed') return event.turn?.id
    return undefined
  }

  private cancelTimer(turnId: string): void {
    const timer = this.updateTimers.get(turnId)
    if (timer) clearTimeout(timer)
    this.updateTimers.delete(turnId)
  }

  private asVoid(result: PersistenceResult<boolean>): PersistenceResult<void> {
    if (!result.ok) return result
    return result.value
      ? { ok: true, value: undefined }
      : persistenceFailure('QUERY_FAILED', 'updateRuntimeState', undefined, 'Session was not found.')
  }
}
