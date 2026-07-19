import { randomUUID } from 'node:crypto'

import type { DebateConfigurationApplication } from '../application/debate-configuration-application'
import type { CostApplication } from '../application/cost-application'
import type { DebateQualityApplication } from '../application/debate-quality-application'
import type { ExportApplication } from '../application/export-application'
import type { DebateHistoryApplication } from '../application/debate-history-application'
import type { ResearchApplication } from '../application/research-application'
import type { DebateRunApplication, DebateRunEvent } from '../application/debate-run-application'
import type { DebatePlanner } from '../debate-planner'
import type { DebateTurn } from '../domain'
import type { LoggerLike } from '../observability'
import type { PersistenceContext } from '../persistence'
import type { DebateTurnDto, ModelProfileDto, PlanDebateInputDto, PlannedDebateDto } from '../shared/debate-dtos'
import type { DebateHistoryListQueryDto } from '../shared/history-dtos'
import type { AddResearchAssetInput, ResearchAssetDto, ResearchWorkspaceDto } from '../shared/research-dtos'
import type {
  LanDebateDetailDto,
  LanDebateInsightsDto,
  LanDebateListDto,
  LanCreateDebateInputDto,
  LanEventEnvelopeDto,
  LanExportRecordDto,
  LanResultDto,
  LanRunCommand,
  LanServerConfigDto,
  LanSessionSnapshotDto
} from '../shared/lan-dtos'
import type { RunCommandResultDto, RunEventDto, RunStateDto } from '../shared/ipc-contract'
import { LanAuthService } from './lan-auth-service'

export const LAN_SETTINGS_KEY = 'lan-server-config.v1'
export const DEFAULT_LAN_SERVER_CONFIG: LanServerConfigDto = {
  enabled: false,
  accessMode: 'localhost',
  host: '127.0.0.1',
  port: 27180,
  authenticationMode: 'none',
  sessionTimeoutMinutes: 1440,
  allowFileUpload: true,
  autoPort: false
}

export interface LanWebApplicationDependencies {
  persistence: PersistenceContext
  configuration: DebateConfigurationApplication
  history: DebateHistoryApplication
  run: DebateRunApplication
  planner: DebatePlanner
  research: ResearchApplication
  quality: DebateQualityApplication
  costs: CostApplication
  exports: ExportApplication
  logger?: LoggerLike
  now?: () => Date
}

type LanEventListener = (event: LanEventEnvelopeDto) => void

export class LanWebApplication {
  readonly auth: LanAuthService
  readonly streamEpoch = randomUUID()
  private readonly now: () => Date
  private readonly sequenceBySession = new Map<string, number>()
  private readonly listeners = new Map<string, Set<LanEventListener>>()
  private readonly pendingEvents = new Map<string, { event: RunEventDto; timer: ReturnType<typeof setTimeout> }>()
  private readonly commandQueues = new Map<string, Promise<unknown>>()
  private readonly unsubscribeRun: () => void

  constructor(private readonly dependencies: LanWebApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.auth = new LanAuthService(
      () => this.getConfig().sessionTimeoutMinutes,
      dependencies.logger,
      this.now
    )
    this.unsubscribeRun = dependencies.run.subscribe((event) => this.observeRunEvent(event))
  }

  getConfig(): LanServerConfigDto {
    const result = this.dependencies.persistence.repositories.settings.get<Partial<LanServerConfigDto>>(LAN_SETTINGS_KEY)
    return result.ok ? normalizeConfig(result.value) : { ...DEFAULT_LAN_SERVER_CONFIG }
  }

  saveConfig(config: LanServerConfigDto): LanResultDto<LanServerConfigDto> {
    const normalized = normalizeConfig(config)
    const saved = this.dependencies.persistence.repositories.settings.set(LAN_SETTINGS_KEY, normalized)
    if (!saved.ok) return lanFailure('LAN_CONFIG_SAVE_FAILED', '局域网设置保存失败', '无法保存局域网访问设置，请稍后重试。', true)
    return { ok: true, value: normalized }
  }

  listDebates(query: DebateHistoryListQueryDto): LanResultDto<LanDebateListDto> {
    const limit = Math.min(query.limit ?? 50, 50)
    const result = this.dependencies.history.listDebates({ ...query, limit: limit + 1 })
    if (!result.ok) return { ok: false, error: { ...result.error } }
    return { ok: true, value: { debates: result.value.slice(0, limit), hasMore: result.value.length > limit } }
  }

  getDebate(debateId: string): LanResultDto<LanDebateDetailDto> {
    const detail = this.dependencies.configuration.getDebate(debateId)
    if (!detail.ok) return { ok: false, error: { ...detail.error } }
    const history = this.dependencies.history.getDebateDetail(debateId)
    return {
      ok: true,
      value: {
        ...detail.value,
        participants: detail.value.participants.map((participant) => ({ ...participant })),
        displayTitle: history.ok ? history.value.displayTitle : detail.value.topic
      }
    }
  }

  listModelProfiles(): LanResultDto<ModelProfileDto[]> {
    const result = this.dependencies.configuration.listModelProfiles()
    return result.ok
      ? { ok: true, value: result.value.map((profile) => ({ ...profile, capabilities: { ...profile.capabilities } })) }
      : { ok: false, error: { ...result.error } }
  }

  async planDebate(input: PlanDebateInputDto): Promise<LanResultDto<PlannedDebateDto>> {
    const result = await this.dependencies.planner.plan(input)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: {
          code: result.error.code,
          titleZh: result.error.titleZh,
          descriptionZh: result.error.descriptionZh,
          retryable: result.error.retryable
        } }
  }

  createDebate(input: LanCreateDebateInputDto): LanResultDto<LanDebateDetailDto> {
    const profiles = this.dependencies.configuration.listModelProfiles()
    if (!profiles.ok) return { ok: false, error: { ...profiles.error } }
    const findProfile = (id: string) => profiles.value.find((profile) => profile.id === id)
    const affirmative = findProfile(input.bindings.affirmativeModelProfileId)
    const negative = findProfile(input.bindings.negativeModelProfileId)
    const moderator = findProfile(input.bindings.moderatorModelProfileId)
    const judge = input.bindings.judgeModelProfileId ? findProfile(input.bindings.judgeModelProfileId) : undefined
    if (!affirmative || !negative || !moderator || (input.bindings.judgeModelProfileId && !judge)) {
      return lanFailure('LAN_MODEL_PROFILE_NOT_FOUND', '模型配置不存在', '所选模型可能已在 Mac 客户端中被删除，请刷新后重选。', false)
    }
    const created = this.dependencies.configuration.createDebate(input.debate)
    if (!created.ok) return { ok: false, error: { ...created.error } }
    const bound = this.dependencies.configuration.saveParticipantBindings({
      sessionId: created.value.sessionId,
      affirmative: bindingFor(affirmative),
      negative: bindingFor(negative),
      moderator: bindingFor(moderator),
      judge: judge ? bindingFor(judge) : undefined
    })
    if (!bound.ok) return { ok: false, error: { ...bound.error } }
    return this.getDebate(bound.value.id)
  }

  createMockDebate(): LanResultDto<LanDebateDetailDto> {
    const result = this.dependencies.configuration.createMockDemoDebate()
    return result.ok ? this.getDebate(result.value.id) : { ok: false, error: { ...result.error } }
  }

  loadResearch(sessionId: string): LanResultDto<ResearchWorkspaceDto> {
    const result = this.dependencies.research.loadWorkspace(sessionId)
    return result.ok ? result : { ok: false, error: { ...result.error } }
  }

  addResearchAsset(input: AddResearchAssetInput): LanResultDto<ResearchAssetDto> {
    const result = this.dependencies.research.addAsset(input)
    return result.ok ? result : { ok: false, error: { ...result.error } }
  }

  getInsights(debateId: string): LanResultDto<LanDebateInsightsDto> {
    const quality = this.dependencies.quality.getByDebate(debateId)
    const costs = this.dependencies.costs.getSummary()
    if (!costs.ok) return { ok: false, error: { ...costs.error } }
    return {
      ok: true,
      value: {
        quality: quality.ok ? quality.value : undefined,
        cost: costs.value.byDebate.find((entry) => entry.debateId === debateId)
      }
    }
  }

  createExport(debateId: string, type: 'markdown' | 'html', includePrivateResearch: boolean): LanResultDto<LanExportRecordDto> {
    const result = type === 'html'
      ? this.dependencies.exports.exportDebateHtml(debateId, { includePrivateResearch })
      : this.dependencies.exports.exportDebateMarkdown(debateId, { includePrivateResearch })
    return result.ok ? { ok: true, value: safeExportRecord(result.value) } : { ok: false, error: { ...result.error } }
  }

  listExports(debateId?: string): LanResultDto<LanExportRecordDto[]> {
    const result = this.dependencies.exports.getExportHistory()
    if (!result.ok) return { ok: false, error: { ...result.error } }
    return { ok: true, value: result.value.filter((record) => !debateId || record.debateId === debateId).map(safeExportRecord) }
  }

  readExport(exportId: string) {
    const result = this.dependencies.exports.readCompletedExport(exportId)
    return result.ok ? result : { ok: false as const, error: { ...result.error } }
  }

  getSnapshot(
    sessionId: string,
    page: { limit?: number; before?: { createdAt: string; id: string } } = {}
  ): LanResultDto<LanSessionSnapshotDto> {
    const detail = this.dependencies.configuration.getDebateBySession(sessionId)
    if (!detail.ok) return { ok: false, error: { ...detail.error } }
    const state = this.dependencies.run.getRunState(sessionId)
    if (!state.ok) return { ok: false, error: mapRunError(state.error) }
    const turns = this.dependencies.configuration.listDebateTurnsPage(sessionId, page.limit ?? 40, page.before)
    if (!turns.ok) return { ok: false, error: { ...turns.error } }
    const history = this.dependencies.history.getDebateDetail(detail.value.id)
    return {
      ok: true,
      value: {
        streamEpoch: this.streamEpoch,
        latestSequence: this.getLatestSequence(sessionId),
        debate: {
          ...detail.value,
          displayTitle: history.ok ? history.value.displayTitle : detail.value.topic,
          participants: detail.value.participants.map((participant) => ({ ...participant }))
        },
        state: { ...state.state, lastTurn: state.state.lastTurn ? safeTurn(state.state.lastTurn) : undefined },
        turnPage: {
          turns: turns.value.turns.map(safeTurn),
          nextCursor: turns.value.nextCursor ? { ...turns.value.nextCursor } : undefined
        }
      }
    }
  }

  executeCommand(sessionId: string, command: LanRunCommand): Promise<LanResultDto<RunStateDto>> {
    const previous = this.commandQueues.get(sessionId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      const result = await this.runCommand(sessionId, command)
      if (!result.ok) return { ok: false as const, error: mapRunError(result.error) }
      return { ok: true as const, value: result.state }
    })
    const queued = operation.finally(() => {
      if (this.commandQueues.get(sessionId) === queued) this.commandQueues.delete(sessionId)
    })
    this.commandQueues.set(sessionId, queued)
    return operation
  }

  subscribe(sessionId: string, listener: LanEventListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<LanEventListener>()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(sessionId)
    }
  }

  getLatestSequence(sessionId: string): number {
    return this.sequenceBySession.get(sessionId) ?? 0
  }

  close(): void {
    this.unsubscribeRun()
    for (const pending of this.pendingEvents.values()) clearTimeout(pending.timer)
    this.pendingEvents.clear()
    this.listeners.clear()
    this.auth.logoutAll()
  }

  private async runCommand(sessionId: string, command: LanRunCommand): Promise<RunCommandResultDto> {
    this.dependencies.logger?.info('局域网运行命令', {
      source: 'lan-command', sessionId, metadata: { command }
    })
    if (command === 'start') return this.launchWithoutBlocking(sessionId, () => this.dependencies.run.start(sessionId))
    if (command === 'pause') return this.dependencies.run.pause(sessionId).then(mapRunResult)
    if (command === 'resume') return this.launchWithoutBlocking(sessionId, () => this.dependencies.run.resume(sessionId))
    return this.dependencies.run.stop(sessionId).then(mapRunResult)
  }

  private async launchWithoutBlocking(
    sessionId: string,
    launch: () => Promise<Awaited<ReturnType<DebateRunApplication['start']>>>
  ): Promise<RunCommandResultDto> {
    const pending = launch()
    const immediate = await Promise.race([
      pending.then((result) => ({ result })),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 0))
    ])
    if (immediate) return mapRunResult(immediate.result)
    void pending.then((result) => {
      if (!result.ok) this.dependencies.logger?.warn('局域网启动的运行任务结束于错误', {
        source: 'lan-command', sessionId, metadata: { code: result.error.code }
      })
    }).catch(() => undefined)
    return mapRunResult(this.dependencies.run.getRunState(sessionId))
  }

  private observeRunEvent(event: DebateRunEvent): void {
    const mapped = safeRunEvent(mapApplicationRunEvent(event))
    if (mapped.type === 'turnUpdated' || mapped.type === 'turnReasoningUpdated') {
      const key = `${mapped.sessionId}:${mapped.type}:${mapped.turnId}`
      const existing = this.pendingEvents.get(key)
      if (existing) {
        existing.event = mapped.type === 'turnReasoningUpdated' && existing.event.type === 'turnReasoningUpdated'
          ? { ...mapped, delta: `${existing.event.delta}${mapped.delta}` }
          : mapped
        return
      }
      const timer = setTimeout(() => this.flushPendingKey(key), 100)
      this.pendingEvents.set(key, { event: mapped, timer })
      return
    }
    this.flushPendingSession(mapped.sessionId)
    this.emit(mapped)
  }

  private flushPendingSession(sessionId: string): void {
    for (const key of [...this.pendingEvents.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.flushPendingKey(key)
    }
  }

  private flushPendingKey(key: string): void {
    const pending = this.pendingEvents.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingEvents.delete(key)
    this.emit(pending.event)
  }

  private emit(event: RunEventDto): void {
    const sequence = this.getLatestSequence(event.sessionId) + 1
    this.sequenceBySession.set(event.sessionId, sequence)
    const envelope: LanEventEnvelopeDto = {
      protocolVersion: 1,
      streamEpoch: this.streamEpoch,
      sequence,
      eventId: event.id,
      sessionId: event.sessionId,
      createdAt: event.createdAt,
      event
    }
    for (const listener of this.listeners.get(event.sessionId) ?? []) listener(envelope)
  }
}

function normalizeConfig(value?: Partial<LanServerConfigDto>): LanServerConfigDto {
  const port = Number.isInteger(value?.port) && (value?.port ?? 0) >= 1024 && (value?.port ?? 0) <= 65535
    ? value!.port!
    : DEFAULT_LAN_SERVER_CONFIG.port
  const timeout = Number.isInteger(value?.sessionTimeoutMinutes)
    ? Math.max(15, Math.min(10_080, value!.sessionTimeoutMinutes!))
    : DEFAULT_LAN_SERVER_CONFIG.sessionTimeoutMinutes
  const accessMode = value?.accessMode === 'lan' || (!value?.accessMode && (value?.host === '0.0.0.0' || value?.host === '::'))
    ? 'lan'
    : 'localhost'
  return {
    ...DEFAULT_LAN_SERVER_CONFIG,
    ...value,
    port,
    sessionTimeoutMinutes: timeout,
    accessMode,
    host: accessMode === 'lan' ? '0.0.0.0' : '127.0.0.1',
    authenticationMode: 'none',
    allowFileUpload: true
  }
}

function bindingFor(profile: ModelProfileDto) {
  return {
    modelProfileId: profile.id,
    displayName: profile.alias?.trim() || profile.displayName
  }
}

function safeExportRecord(record: import('../shared/export-dtos').DebateExportRecordDto): LanExportRecordDto {
  const { filePath: _filePath, ...safe } = record
  return {
    ...safe,
    error: safe.error ? {
      titleZh: safe.error.titleZh,
      descriptionZh: safe.error.descriptionZh
    } : undefined
  }
}

function mapRunResult(result: Awaited<ReturnType<DebateRunApplication['start']>>): RunCommandResultDto {
  return result.ok
    ? { ok: true, state: { ...result.state, lastTurn: result.state.lastTurn ? safeTurn(result.state.lastTurn) : undefined } }
    : { ok: false, error: mapRunError(result.error) }
}

function mapRunError(error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean }): {
  code: string; titleZh: string; descriptionZh: string; retryable: boolean
} {
  return { code: error.code, titleZh: error.titleZh, descriptionZh: error.descriptionZh, retryable: error.retryable }
}

function safeTurn(turn: DebateTurnDto): DebateTurnDto {
  const { error: _rawError, ...safe } = turn
  return {
    ...safe,
    failure: turn.failure ? {
      code: turn.failure.code,
      titleZh: turn.failure.titleZh,
      descriptionZh: turn.failure.descriptionZh,
      retryable: turn.failure.retryable,
      suggestedActionZh: turn.failure.suggestedActionZh
    } : undefined
  }
}

function safeRunEvent(event: RunEventDto): RunEventDto {
  if (event.type === 'turnStarted' || event.type === 'turnCompleted' || event.type === 'turnFailed') {
    return { ...event, turn: safeTurn(event.turn) }
  }
  return { ...event }
}

function mapApplicationRunEvent(event: DebateRunEvent): RunEventDto {
  const base = { id: event.id, sessionId: event.sessionId, createdAt: event.createdAt }
  switch (event.type) {
    case 'stateChanged':
      return { ...base, type: event.type, state: { status: event.event.to.status, currentStage: event.event.to.stage } }
    case 'turnStarted':
    case 'turnCompleted':
    case 'turnFailed':
      return { ...base, type: event.type, turn: applicationTurn(event.turn) }
    case 'turnUpdated':
      return { ...base, type: event.type, turnId: event.turnId, stage: event.stage, participantId: event.participantId, delta: event.delta, content: event.content }
    case 'turnReasoningUpdated':
      return { ...base, type: event.type, turnId: event.turnId, stage: event.stage, participantId: event.participantId, delta: event.delta }
    case 'sessionPaused':
    case 'sessionStopped':
    case 'sessionCompleted':
      return { ...base, type: event.type }
  }
}

function applicationTurn(turn: DebateTurn): DebateTurnDto {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    participantId: turn.participantId,
    stage: turn.stage,
    status: turn.status,
    content: turn.content,
    retryOfTurnId: turn.retryOfTurnId,
    error: turn.error,
    failure: turn.failure ? { ...turn.failure } : undefined,
    createdAt: turn.createdAt
  }
}

function lanFailure<T>(code: string, titleZh: string, descriptionZh: string, retryable: boolean): LanResultDto<T> {
  return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
}
