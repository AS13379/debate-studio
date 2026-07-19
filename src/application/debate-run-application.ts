import type { DebateConfig, DebateStage, DebateStatus, DebateTurn } from '../domain'
import { DEBATE_STAGES } from '../domain'
import {
  SessionRunner,
  type SessionRunResult,
  type SessionRunnerEvent
} from '../execution'
import {
  initializePersistence,
  persistenceFailure,
  type DebateRecord,
  type PersistenceContext,
  type PersistenceError,
  type PersistenceResult,
  type SessionRecord,
  type TurnRecord
} from '../persistence'
import type { DebateRuntimePreparationResult, DebateRuntimeConfig } from '../runtime'
import type { ResearchRunCoordinator } from '../research'
import {
  composeDebateSetupApplication,
  type DebateSetupApplication,
  type DebateSetupApplicationOptions
} from './debate-setup-application'
import { DebateRunPersistence } from './debate-run-persistence'
import type { DebateQualityApplication } from './debate-quality-application'

export type DebateRunStatus =
  | 'draft'
  | 'running'
  | 'streaming'
  | 'paused'
  | 'failed'
  | 'interrupted'
  | 'stopped'
  | 'completed'

export interface DebateRunState {
  sessionId: string
  status: DebateRunStatus | string
  currentStage: string
  active: boolean
  lastTurn?: TurnRecord
}

export type DebateRunErrorCode =
  | 'APPLICATION_CLOSED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_RUNNING'
  | 'INVALID_RUN_STATE'
  | 'RUNTIME_PREPARATION_FAILED'
  | 'DEBATE_NOT_FOUND'
  | 'NO_RETRYABLE_TURN'
  | 'COMMAND_REJECTED'
  | 'PERSISTENCE_FAILED'
  | 'RUNNER_FAILED'

export interface DebateRunError {
  code: DebateRunErrorCode
  titleZh: string
  descriptionZh: string
  retryable: boolean
  preparation?: Extract<DebateRuntimePreparationResult, { ok: false }>
  persistence?: Pick<PersistenceError, 'code' | 'operation' | 'message'>
}

export type DebateRunCommandResult =
  | { ok: true; state: DebateRunState }
  | { ok: false; error: DebateRunError }

export type DebateRunStateResult = DebateRunCommandResult

type PublicRunEventType =
  | 'stateChanged'
  | 'turnStarted'
  | 'turnUpdated'
  | 'turnReasoningUpdated'
  | 'turnCompleted'
  | 'turnFailed'
  | 'sessionPaused'
  | 'sessionStopped'
  | 'sessionCompleted'

export type DebateRunEvent = Extract<SessionRunnerEvent, { type: PublicRunEventType }>
export type DebateRunEventListener = (event: DebateRunEvent) => void

export interface DebateRunApplicationOptions extends DebateSetupApplicationOptions {
  streamWriteThrottleMs?: number
  now?: () => Date
}

interface RunHandle {
  runner: SessionRunner
  drivePromise?: Promise<SessionRunResult>
}

type HandleResult =
  | { ok: true; handle: RunHandle }
  | { ok: false; error: DebateRunError }

export class DebateRunApplication {
  private readonly handles = new Map<string, RunHandle>()
  private readonly listeners = new Set<DebateRunEventListener>()
  private readonly persistenceErrors = new Map<string, PersistenceError>()
  private closed = false
  private closing = false

  constructor(
    private readonly persistence: PersistenceContext,
    private readonly setupApplication: DebateSetupApplication,
    private readonly runPersistence: DebateRunPersistence,
    private readonly researchCoordinator?: ResearchRunCoordinator,
    private readonly qualityApplication?: DebateQualityApplication
  ) {}

  async start(sessionId: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    if (this.handles.get(sessionId)?.drivePromise) return this.alreadyRunning()

    const sessionResult = this.persistence.repositories.sessions.get(sessionId)
    if (!sessionResult.ok) return this.persistenceFailure(sessionResult.error)
    if (!sessionResult.value) return this.sessionNotFound(sessionId)
    if (sessionResult.value.status !== 'draft') {
      return this.invalidState('启动辩论失败', `当前 Session 状态为 ${sessionResult.value.status}，只有 draft 可以启动。`)
    }

    const prepared = this.prepareHandle(sessionResult.value)
    if (!prepared.ok) return prepared
    this.handles.set(sessionId, prepared.handle)
    return this.launch(sessionId, prepared.handle, () => prepared.handle.runner.run())
  }

  async pause(sessionId: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    const handle = this.handles.get(sessionId)
    if (!handle || !handle.drivePromise || !handle.runner.pause()) {
      return this.invalidState('暂停辩论失败', '该 Session 当前没有可暂停的运行任务。')
    }
    await handle.drivePromise
    return this.stateAfterFlush(sessionId)
  }

  async resume(sessionId: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    let handle = this.handles.get(sessionId)
    if (handle?.drivePromise) return this.alreadyRunning()

    if (!handle) {
      const restored = this.restoreHandle(sessionId, 'paused')
      if (!restored.ok) return restored
      handle = restored.handle
      this.handles.set(sessionId, handle)
    }
    if (handle.runner.engine.getState().status !== 'paused') {
      return this.invalidState('继续辩论失败', '该 Session 当前不处于 paused 状态。')
    }
    return this.launch(sessionId, handle, () => handle.runner.resume())
  }

  async stop(sessionId: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    let handle = this.handles.get(sessionId)
    if (!handle) {
      const state = this.getRunState(sessionId)
      if (!state.ok) return state
      if (!['paused', 'failed', 'interrupted', 'running', 'streaming'].includes(state.state.status)) {
        return this.invalidState('停止辩论失败', `当前 Session 状态为 ${state.state.status}，不能停止。`)
      }
      const restored = this.restoreHandle(sessionId, state.state.status === 'paused' ? 'paused' : 'running')
      if (!restored.ok) return restored
      handle = restored.handle
      this.handles.set(sessionId, handle)
    }

    const pending = handle.drivePromise
    if (!handle.runner.stop()) {
      return this.invalidState('停止辩论失败', 'SessionRunner 拒绝了当前 stop 命令。')
    }
    if (pending) await pending
    return this.stateAfterFlush(sessionId)
  }

  async retryFailedTurn(sessionId: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    let handle = this.handles.get(sessionId)
    if (handle?.drivePromise) return this.alreadyRunning()

    const retryable = this.persistence.repositories.turns.findLatestRetryable(sessionId)
    if (!retryable.ok) return this.persistenceFailure(retryable.error)
    if (!retryable.value) {
      return this.failure('NO_RETRYABLE_TURN', '没有可重试的 Turn', '没有找到失败、取消或中断的 Turn。', false)
    }

    if (!handle) {
      const restored = this.restoreHandle(sessionId, 'running')
      if (!restored.ok) return restored
      handle = restored.handle
      this.handles.set(sessionId, handle)
    }
    const previousTurn = this.toDebateTurn(retryable.value)
    if (!previousTurn) {
      return this.invalidState('无法恢复失败 Turn', '持久化 Turn 的阶段或状态无法用于重试。')
    }
    return this.launch(sessionId, handle, () => handle.runner.retryFailedTurn(previousTurn))
  }

  async skip(sessionId: string, reason?: string): Promise<DebateRunCommandResult> {
    const available = this.ensureAvailable()
    if (available) return available
    let handle = this.handles.get(sessionId)
    if (!handle) {
      const restored = this.restoreHandle(sessionId, 'running')
      if (!restored.ok) return restored
      handle = restored.handle
      this.handles.set(sessionId, handle)
    }
    const pending = handle.drivePromise
    if (!handle.runner.skip(reason)) {
      return this.invalidState('跳过当前阶段失败', 'SessionRunner 拒绝了当前 skip 命令。')
    }
    // Do not make the command wait for the rest of the debate. The active
    // drive owns continuation after AbortSignal settles; the UI should receive
    // the new stage immediately so this action remains a real escape hatch.
    if (pending) {
      const settled = await handle.runner.waitForSkipSettlement()
      if (settled === false) return this.invalidState('跳过当前阶段失败', '在途请求结束后无法推进状态机。')
      return this.stateAfterFlush(sessionId)
    }
    return this.launch(sessionId, handle, () => handle.runner.run())
  }

  getRunState(sessionId: string): DebateRunStateResult {
    const available = this.ensureAvailable()
    if (available) return available
    const session = this.persistence.repositories.sessions.get(sessionId)
    if (!session.ok) return this.persistenceFailure(session.error)
    if (!session.value) return this.sessionNotFound(sessionId)
    const lastTurn = this.persistence.repositories.turns.findLatest(sessionId)
    if (!lastTurn.ok) return this.persistenceFailure(lastTurn.error)
    return {
      ok: true,
      state: {
        sessionId,
        status: session.value.status,
        currentStage: session.value.currentStage,
        active: Boolean(this.handles.get(sessionId)?.drivePromise),
        lastTurn: lastTurn.value
      }
    }
  }

  subscribe(listener: DebateRunEventListener): () => void {
    if (this.closed || this.closing) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<PersistenceResult<void>> {
    if (this.closed) return { ok: true, value: undefined }
    if (this.closing) {
      return persistenceFailure('DATABASE_CLOSED', 'closeDebateRunApplication', undefined, 'Application close is already in progress.')
    }
    this.closing = true

    for (const handle of this.handles.values()) {
      if (handle.drivePromise) handle.runner.pause()
    }
    await Promise.allSettled(
      [...this.handles.values()].map((handle) => handle.drivePromise).filter((promise): promise is Promise<SessionRunResult> => Boolean(promise))
    )
    const flushed = this.runPersistence.flushAll()
    const closed = flushed.ok ? this.setupApplication.close() : flushed
    this.closed = closed.ok
    this.closing = false
    if (closed.ok) this.listeners.clear()
    return closed
  }

  private prepareHandle(
    session: SessionRecord,
    initialStatus?: DebateStatus
  ): HandleResult {
    const preparation = this.setupApplication.prepareDebateRuntime(session.id)
    if (!preparation.ok) {
      return {
        ok: false,
        error: {
          code: 'RUNTIME_PREPARATION_FAILED',
          titleZh: '运行配置准备失败',
          descriptionZh: '辩论配置尚未满足运行条件，未创建 SessionRunner。',
          retryable: preparation.loadErrors.some((error) => error.retryable),
          preparation
        }
      }
    }
    const debate = this.persistence.repositories.debates.findById(session.debateId)
    if (!debate.ok) return { ok: false, error: this.persistenceError(debate.error) }
    if (!debate.value) {
      return {
        ok: false,
        error: this.error('DEBATE_NOT_FOUND', '辩论配置不存在', 'Session 引用的 Debate 已不存在。', false)
      }
    }

    const config = this.debateConfig(preparation.runtimeConfig, debate.value)
    const initialStage = this.activeStage(session.currentStage)
    const previousTurns = this.persistence.repositories.turns.listBySession(session.id)
    if (!previousTurns.ok) return { ok: false, error: this.persistenceError(previousTurns.error) }
    const initialStageTurnCount = initialStage
      ? previousTurns.value.filter((turn) => turn.stage === initialStage && ['completed', 'skipped', 'forced'].includes(turn.status)).length
      : 0
    const runner = new SessionRunner(config, preparation.turnRunner, {
      engine: initialStatus && initialStage
        ? { initialState: { stage: initialStage, status: initialStatus }, initialStageTurnCount }
        : undefined,
      onEvent: (event) => this.handleRunnerEvent(event)
    })
    return { ok: true, handle: { runner } }
  }

  private restoreHandle(sessionId: string, status: Extract<DebateStatus, 'running' | 'paused'>): HandleResult {
    const session = this.persistence.repositories.sessions.get(sessionId)
    if (!session.ok) return { ok: false, error: this.persistenceError(session.error) }
    if (!session.value) return { ok: false, error: this.sessionNotFound(sessionId).error }
    if (!this.activeStage(session.value.currentStage)) {
      return {
        ok: false,
        error: this.error('INVALID_RUN_STATE', '无法恢复 SessionRunner', '持久化的当前阶段不可运行。', false)
      }
    }
    return this.prepareHandle(session.value, status)
  }

  private async launch(
    sessionId: string,
    handle: RunHandle,
    operation: () => Promise<SessionRunResult>
  ): Promise<DebateRunCommandResult> {
    if (handle.drivePromise) return this.alreadyRunning()
    this.persistenceErrors.delete(sessionId)
    let drivePromise: Promise<SessionRunResult>
    try {
      drivePromise = (async () => {
        const result = await operation()
        if (result.status === 'completed') await this.qualityApplication?.generateForCompletedSession(sessionId)
        return result
      })()
      handle.drivePromise = drivePromise
      await drivePromise
    } catch (cause) {
      return this.failure(
        'RUNNER_FAILED',
        '辩论运行失败',
        cause instanceof Error ? cause.message : 'SessionRunner 运行时发生未知错误。',
        true
      )
    } finally {
      handle.drivePromise = undefined
    }
    return this.stateAfterFlush(sessionId)
  }

  private stateAfterFlush(sessionId: string): DebateRunCommandResult {
    const flushed = this.runPersistence.flushAll()
    if (!flushed.ok) return this.persistenceFailure(flushed.error)
    const asynchronous = this.persistenceErrors.get(sessionId)
    if (asynchronous) return this.persistenceFailure(asynchronous)
    return this.getRunState(sessionId)
  }

  private handleRunnerEvent(event: SessionRunnerEvent): void {
    const persisted = this.runPersistence.handle(event)
    if (!persisted.ok) this.persistenceErrors.set(event.sessionId, persisted.error)
    if (event.type === 'turnCompleted' && this.researchCoordinator) {
      const projected = this.researchCoordinator.handleCompletedTurn(event.turn)
      if (!projected.ok) this.persistenceErrors.set(event.sessionId, projected.error)
    }
    if (!this.isPublicEvent(event)) return
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A future UI subscriber must never be able to interrupt the debate run.
      }
    }
  }

  private isPublicEvent(event: SessionRunnerEvent): event is DebateRunEvent {
    return event.type !== 'sessionFailed'
  }

  private debateConfig(runtime: DebateRuntimeConfig, debate: DebateRecord): DebateConfig {
    const participants = [runtime.affirmative, runtime.negative, runtime.moderator, runtime.judge]
      .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant))
      .map((participant) => ({
        id: participant.participant.id,
        role: participant.role,
        name: participant.participant.displayName
      }))
    return {
      id: runtime.session.id,
      topic: debate.topic,
      background: debate.background,
      affirmativePosition: debate.affirmativePosition,
      negativePosition: debate.negativePosition,
      freeDebateRounds: debate.freeDebateRounds,
      participants
    }
  }

  private toDebateTurn(record: TurnRecord): DebateTurn | undefined {
    const stage = this.activeStage(record.stage)
    if (!stage || !['failed', 'cancelled', 'interrupted'].includes(record.status)) return undefined
    return {
      id: record.id,
      sessionId: record.sessionId,
      participantId: record.participantId,
      stage,
      status: record.status as DebateTurn['status'],
      content: record.content,
      retryOfTurnId: record.retryOfTurnId,
      error: record.error,
      failure: record.failure,
      createdAt: record.createdAt
    }
  }

  private activeStage(stage: string): Exclude<DebateStage, 'draft' | 'completed'> | undefined {
    if (stage === 'draft' || stage === 'completed') return undefined
    return (DEBATE_STAGES as readonly string[]).includes(stage)
      ? stage as Exclude<DebateStage, 'draft' | 'completed'>
      : undefined
  }

  private ensureAvailable(): { ok: false; error: DebateRunError } | undefined {
    return this.closed || this.closing
      ? {
          ok: false,
          error: this.error('APPLICATION_CLOSED', '运行服务已关闭', '应用正在关闭或数据库资源已经释放。', false)
        }
      : undefined
  }

  private alreadyRunning(): { ok: false; error: DebateRunError } {
    return {
      ok: false,
      error: this.error('SESSION_ALREADY_RUNNING', 'Session 已在运行', '同一 Session 不允许重复并发启动。', false)
    }
  }

  private sessionNotFound(sessionId: string): { ok: false; error: DebateRunError } {
    return {
      ok: false,
      error: this.error('SESSION_NOT_FOUND', 'Session 不存在', `没有找到 Session：${sessionId}。`, false)
    }
  }

  private invalidState(titleZh: string, descriptionZh: string): { ok: false; error: DebateRunError } {
    return { ok: false, error: this.error('INVALID_RUN_STATE', titleZh, descriptionZh, false) }
  }

  private persistenceFailure(error: PersistenceError): { ok: false; error: DebateRunError } {
    return { ok: false, error: this.persistenceError(error) }
  }

  private persistenceError(error: PersistenceError): DebateRunError {
    return {
      code: 'PERSISTENCE_FAILED',
      titleZh: '运行数据保存失败',
      descriptionZh: 'SQLite 读写失败，运行状态可能未完整保存。',
      retryable: error.code !== 'DATABASE_CLOSED',
      persistence: { code: error.code, operation: error.operation, message: error.message }
    }
  }

  private failure(
    code: DebateRunErrorCode,
    titleZh: string,
    descriptionZh: string,
    retryable: boolean
  ): { ok: false; error: DebateRunError } {
    return { ok: false, error: this.error(code, titleZh, descriptionZh, retryable) }
  }

  private error(
    code: DebateRunErrorCode,
    titleZh: string,
    descriptionZh: string,
    retryable: boolean
  ): DebateRunError {
    return { code, titleZh, descriptionZh, retryable }
  }
}

export function initializeDebateRunApplication(
  options: DebateRunApplicationOptions
): PersistenceResult<DebateRunApplication> {
  const persistenceResult = initializePersistence(options)
  if (!persistenceResult.ok) return persistenceResult
  const persistence = persistenceResult.value
  const recoveredAt = (options.now ?? (() => new Date()))().toISOString()

  const turnsRecovered = persistence.repositories.turns.markInProgressInterrupted(recoveredAt)
  if (!turnsRecovered.ok) {
    persistence.database.close()
    return turnsRecovered
  }
  const sessionsRecovered = persistence.repositories.sessions.markInProgressInterrupted(recoveredAt)
  if (!sessionsRecovered.ok) {
    persistence.database.close()
    return sessionsRecovered
  }

  try {
    const setupApplication = composeDebateSetupApplication(persistence, options)
    const runPersistence = new DebateRunPersistence({
      repositories: persistence.repositories,
      streamWriteThrottleMs: options.streamWriteThrottleMs
    })
    return {
      ok: true,
      value: new DebateRunApplication(persistence, setupApplication, runPersistence)
    }
  } catch (cause) {
    persistence.database.close()
    return persistenceFailure('QUERY_FAILED', 'composeDebateRunApplication', cause)
  }
}
