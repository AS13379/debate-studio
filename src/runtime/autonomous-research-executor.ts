import { randomUUID } from 'node:crypto'

import type { PersistenceContext } from '../persistence'
import type { LoggerLike } from '../observability'
import type { UnifiedRequest, UnifiedResponse, UnifiedStreamEvent } from '../providers'
import {
  ResearchApprovalController,
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
    const running = this.execute(request, participant, (message) => queue.push(`\n[研究工具] ${message}\n`))
      .then((content) => queue.complete(content), (cause) => queue.fail(cause))
    let collected = ''
    try {
      for await (const item of queue) {
        collected += item
        yield { type: 'textDelta', requestId: request.requestId, delta: item }
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

  private async execute(request: UnifiedRequest, participant: RuntimeParticipant, onProgress?: (message: string) => void): Promise<string> {
    const role = participant.role as ResearchOwnerRole
    const searchConnection = this.defaultSearchConnection()
    const researchSession = this.ensureResearchSession(request.sessionId, participant.participant.id, role)
    const settingsResult = this.options.persistence.repositories.settings.get<ResearchRuntimeSettings>('research.runtime.defaults')
    const settings = settingsResult.ok ? settingsResult.value : undefined
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
      onProgress: (message) => onProgress?.(message)
    })
    const result = await loop.run(request, {
      debateSessionId: request.sessionId,
      researchSession,
      role,
      topic: request.topic,
      goal: request.prompt,
      mode: settings?.mode ?? 'automatic',
      limits: settings?.limits,
      supportsToolCalling: participant.modelProfile.capabilities.toolCalling
    })
    return result.content
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

class ProgressQueue implements AsyncIterable<string> {
  private readonly values: string[] = []
  private waiter?: () => void
  private finished = false
  private failure?: unknown
  private resolveResult!: (value: string) => void
  private rejectResult!: (cause: unknown) => void
  readonly result = new Promise<string>((resolve, reject) => { this.resolveResult = resolve; this.rejectResult = reject })

  push(value: string): void { this.values.push(value); this.waiter?.(); this.waiter = undefined }
  complete(content: string): void { this.finished = true; this.resolveResult(content); this.waiter?.(); this.waiter = undefined }
  fail(cause: unknown): void { this.failure = cause; this.finished = true; this.rejectResult(cause); this.waiter?.(); this.waiter = undefined }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    while (!this.finished || this.values.length) {
      if (this.values.length) { yield this.values.shift()!; continue }
      await new Promise<void>((resolve) => { this.waiter = resolve })
    }
    if (this.failure) throw this.failure
  }
}
