import { randomUUID } from 'node:crypto'

import type { PersistenceContext } from '../persistence'
import type { LoggerLike } from '../observability'
import type { UnifiedRequest, UnifiedResponse, UnifiedStreamEvent } from '../providers'
import {
  ResearchApprovalController,
  RESEARCH_BUDGET_PRESETS,
  ResearchToolLoop,
  TavilySearchTool,
  WebPageFetcher,
  type ResearchMode,
  type ResearchOwnerRole,
  type ResearchSession,
  type ResearchToolLimits,
  type SearchCredentialStore
} from '../research'
import type { RuntimeParticipant, RuntimeResearchExecutor } from './types'

interface ResearchRuntimeSettings {
  mode?: ResearchMode
  limits?: Partial<ResearchToolLimits>
}

export interface AutonomousResearchExecutorOptions {
  persistence: PersistenceContext
  credentialStore: SearchCredentialStore
  approvalController: ResearchApprovalController
  webPageFetcher?: WebPageFetcher
  createId?: () => string
  now?: () => Date
  logger?: LoggerLike
}

export class AutonomousResearchExecutor implements RuntimeResearchExecutor {
  private readonly webPageFetcher: WebPageFetcher
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly options: AutonomousResearchExecutorOptions) {
    this.webPageFetcher = options.webPageFetcher ?? new WebPageFetcher()
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  shouldHandle(request: UnifiedRequest, participant: RuntimeParticipant): boolean {
    if (participant.providerConnection.protocolType === 'mock') return false
    if (!['public_pool', 'affirmative_research', 'negative_research'].includes(request.stage)) return false
    const connections = this.options.persistence.repositories.searchProviderConnections.list()
    return connections.ok && connections.value.some((connection) => connection.enabled && connection.isDefault)
  }

  async complete(request: UnifiedRequest, participant: RuntimeParticipant): Promise<UnifiedResponse> {
    const result = await this.execute(request, participant)
    return { requestId: request.requestId, content: result, finishReason: 'stop' }
  }

  async *stream(request: UnifiedRequest, participant: RuntimeParticipant): AsyncIterable<UnifiedStreamEvent> {
    yield { type: 'started', requestId: request.requestId }
    const queue = new ProgressQueue()
    void queue.result.catch(() => undefined)
    const running = this.execute(
      request,
      participant,
      (message) => queue.push({ type: 'text', delta: `\n[研究工具] ${message}\n` }),
      (delta) => queue.push({ type: 'reasoning', delta })
    )
      .then((content) => queue.complete(content), (cause) => queue.fail(cause))
    let collected = ''
    try {
      for await (const item of queue) {
        if (item.type === 'reasoning') {
          yield { type: 'reasoningDelta', requestId: request.requestId, delta: item.delta }
          continue
        }
        collected += item.delta
        yield { type: 'textDelta', requestId: request.requestId, delta: item.delta }
      }
      const content = await queue.result
      if (content && !collected.includes(content)) {
        collected += content
        yield { type: 'textDelta', requestId: request.requestId, delta: content }
      }
      await running
      yield { type: 'completed', response: { requestId: request.requestId, content: collected, finishReason: 'stop' } }
    } catch (cause) {
      const detail = cause instanceof Error && 'detail' in cause
        ? (cause as { detail: Extract<UnifiedStreamEvent, { type: 'error' }>['error'] }).detail
        : { code: request.signal.aborted ? 'CANCELLED' as const : 'REQUEST_FAILED' as const, message: cause instanceof Error ? cause.message : 'Research tool loop failed.', retryable: true }
      yield { type: 'error', requestId: request.requestId, error: detail }
    }
  }

  private async execute(
    request: UnifiedRequest,
    participant: RuntimeParticipant,
    onProgress?: (message: string) => void,
    onReasoning?: (delta: string) => void
  ): Promise<string> {
    const role = participant.role as ResearchOwnerRole
    const searchConnection = this.defaultSearchConnection()
    const researchSession = this.ensureResearchSession(request.sessionId, participant.participant.id, role)
    const settingsResult = this.options.persistence.repositories.settings.get<ResearchRuntimeSettings>('research.runtime.defaults')
    const settings = settingsResult.ok ? settingsResult.value : undefined
    const configuredLimits = this.normalizedLimits(settings?.limits)
    const limits = request.stage === 'public_pool'
      ? {
          maxToolCalls: Math.min(configuredLimits.maxToolCalls ?? 16, 16),
          maxSearches: Math.min(configuredLimits.maxSearches ?? 1, 1),
          maxPageReads: Math.min(configuredLimits.maxPageReads ?? 1, 1),
          maxBodyCharacters: Math.min(configuredLimits.maxBodyCharacters ?? 12_000, 12_000),
          maxDecisionRounds: Math.min(configuredLimits.maxDecisionRounds ?? 8, 8),
          maxNoProgressRounds: Math.min(configuredLimits.maxNoProgressRounds ?? 2, 2),
          maxFinalizationRounds: Math.min(configuredLimits.maxFinalizationRounds ?? 4, 4),
          targetEvidenceCount: 1
        }
      : configuredLimits
    const loop = new ResearchToolLoop({
      adapter: participant.adapter,
      repository: this.options.persistence.repositories.research,
      searchTool: new TavilySearchTool({
        connection: searchConnection,
        credentialStore: this.options.credentialStore,
        logger: this.options.logger
      }),
      webPageFetcher: this.webPageFetcher,
      approvalController: this.options.approvalController,
      createId: this.createId,
      now: this.now,
      onProgress: (message) => onProgress?.(message),
      onReasoning
    })
    const result = await loop.run(request, {
      debateSessionId: request.sessionId,
      researchSession,
      role,
      topic: request.topic,
      goal: request.prompt,
      mode: settings?.mode ?? 'automatic',
      limits,
      supportsToolCalling: participant.modelProfile.capabilities.toolCalling
    })
    return result.content
  }

  private normalizedLimits(limits?: Partial<ResearchToolLimits>): Partial<ResearchToolLimits> {
    if (!limits) return RESEARCH_BUDGET_PRESETS.balanced
    if (limits.maxDecisionRounds) return limits
    const legacy = `${limits.maxToolCalls}/${limits.maxSearches}/${limits.maxPageReads}/${limits.maxBodyCharacters}`
    if (['5/1/1/15000', '8/2/2/25000'].includes(legacy)) return RESEARCH_BUDGET_PRESETS.quick
    if (['7/2/2/30000', '12/3/3/45000'].includes(legacy)) return RESEARCH_BUDGET_PRESETS.balanced
    if (['12/4/4/60000', '20/5/5/80000'].includes(legacy)) return RESEARCH_BUDGET_PRESETS.deep
    return { ...RESEARCH_BUDGET_PRESETS.balanced, ...limits }
  }

  private defaultSearchConnection() {
    const result = this.options.persistence.repositories.searchProviderConnections.list()
    if (!result.ok) throw result.error
    const connection = result.value.find((item) => item.enabled && item.isDefault)
    if (!connection) throw new Error('No enabled default search provider connection.')
    return connection
  }

  private ensureResearchSession(debateSessionId: string, ownerParticipantId: string, role: ResearchOwnerRole): ResearchSession {
    const existing = this.options.persistence.repositories.research.findSessionByOwner(debateSessionId, role)
    if (!existing.ok) throw existing.error
    const timestamp = this.now().toISOString()
    const session: ResearchSession = existing.value ?? {
      id: this.createId(), debateSessionId, ownerParticipantId, ownerRole: role,
      visibility: `${role}-private`, status: 'researching', createdAt: timestamp, updatedAt: timestamp
    }
    const updated = { ...session, status: 'researching' as const, updatedAt: timestamp }
    const saved = this.options.persistence.repositories.research.saveSession(updated)
    if (!saved.ok) throw saved.error
    return updated
  }
}

type ProgressQueueItem =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }

class ProgressQueue implements AsyncIterable<ProgressQueueItem> {
  private readonly values: ProgressQueueItem[] = []
  private waiter?: () => void
  private finished = false
  private failure?: unknown
  private resolveResult!: (value: string) => void
  private rejectResult!: (cause: unknown) => void
  readonly result = new Promise<string>((resolve, reject) => { this.resolveResult = resolve; this.rejectResult = reject })

  push(value: ProgressQueueItem): void { this.values.push(value); this.waiter?.(); this.waiter = undefined }
  complete(content: string): void { this.finished = true; this.resolveResult(content); this.waiter?.(); this.waiter = undefined }
  fail(cause: unknown): void { this.failure = cause; this.finished = true; this.rejectResult(cause); this.waiter?.(); this.waiter = undefined }

  async *[Symbol.asyncIterator](): AsyncIterator<ProgressQueueItem> {
    while (!this.finished || this.values.length) {
      if (this.values.length) { yield this.values.shift()!; continue }
      await new Promise<void>((resolve) => { this.waiter = resolve })
    }
    if (this.failure) throw this.failure
  }
}
