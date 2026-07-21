import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializePersistence, type PersistenceContext } from '../src/persistence'
import { ModelAdapterError, type ModelAdapter, type UnifiedRequest, type UnifiedResponse, type UnifiedStreamEvent } from '../src/providers'
import {
  ResearchApprovalController,
  ResearchToolLoop,
  WebPageFetcher,
  type ResearchSession,
  type SearchRequest,
  type SearchResult,
  type SearchTool
} from '../src/research'

const timestamp = '2026-07-14T00:00:00.000Z'
const directories: string[] = []

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe('ResearchToolLoop', () => {
  it('searches, reads once, evaluates a source, saves a claim and publishes stable evidence', async () => {
    const seeded = seed()
    const search = new RecordingSearchTool()
    const adapter = new ScriptedAdapter((index) => {
      const sourceId = seeded.persistence.repositories.research.listSources('session-1').ok
        ? (seeded.persistence.repositories.research.listSources('session-1') as { ok: true; value: Array<{ id: string }> }).value[0]?.id
        : undefined
      return [
        tool('searchWeb', { query: '公共交通收益', maxResults: 2 }),
        tool('readWebPage', { sourceId }),
        tool('saveResearchNote', { sourceId, content: '官方数据支持长期收益。', evaluation: {
          purpose: '核实社会收益', relevance: '直接关联辩题', stance: '支持正方', sourceType: '官方机构',
          credibility: '数据口径清楚', limitations: '仅覆盖一个城市', recommendPublication: true
        } }),
        tool('saveProvisionalClaim', { claim: '公交投入可产生社会收益', supportingSourceIds: [sourceId], unresolved: false }),
        tool('publishEvidence', { sourceId }),
        tool('finishResearch', { summary: '已形成可核验主张并发布证据。' })
      ][index]!
    })
    const result = await loop(seeded, adapter, search).run(request(), context(seeded.researchSession, 'automatic'))
    expect(result.content).toContain('已形成')
    expect(search.calls).toBe(1)
    const repository = seeded.persistence.repositories.research
    expect(repository.listFetchedPages('session-1')).toMatchObject({ ok: true, value: [expect.objectContaining({ status: 'completed' })] })
    expect(repository.listSourceEvaluations('session-1')).toMatchObject({ ok: true, value: [expect.objectContaining({ basedOn: 'full-text', sourceType: '官方机构' })] })
    expect(repository.listClaims('session-1')).toMatchObject({ ok: true, value: [expect.objectContaining({ unresolved: false })] })
    expect(repository.listEvidence('session-1')).toMatchObject({ ok: true, value: [expect.objectContaining({ publicCode: 'A-S1' })] })
    seeded.persistence.database.close()
  })

  it('keeps role contexts isolated and lets the model continue after a tool failure', async () => {
    const seeded = seed()
    const negativeSession = researchSession('negative-research', 'negative-1', 'negative')
    expect(seeded.persistence.repositories.research.saveSession(negativeSession).ok).toBe(true)
    expect(seeded.persistence.repositories.research.saveSource({
      id: 'negative-secret', debateSessionId: 'session-1', researchSessionId: negativeSession.id,
      ownerParticipantId: 'negative-1', visibility: 'negative-private', title: '反方私有来源',
      url: 'https://example.test/negative', domain: 'example.test', summary: 'NEGATIVE_ONLY',
      sourceType: 'mock-search', verificationLevel: 'summary-only', createdAt: timestamp
    }).ok).toBe(true)
    const adapter = new ScriptedAdapter((index, currentRequest) => {
      if (index === 1) expect(currentRequest.messages.at(-1)?.content).toContain('无权读取')
      return index === 0
        ? tool('readWebPage', { sourceId: 'negative-secret' })
        : tool('finishResearch', { summary: '私有来源不可读，已结束。' })
    })
    const result = await loop(seeded, adapter, new RecordingSearchTool()).run(request(), context(seeded.researchSession, 'automatic'))
    expect(result.content).toContain('不可读')
    expect(seeded.persistence.repositories.research.listFetchedPages('session-1')).toMatchObject({ ok: true, value: [] })
    seeded.persistence.database.close()
  })

  it('marks the loop failed when a provider request fails after a successful search', async () => {
    const seeded = seed()
    const adapter = new ScriptedAdapter((index) => {
      if (index === 0) return tool('searchWeb', { query: '先完成搜索' })
      throw new ModelAdapterError({
        code: 'REQUEST_FAILED',
        message: 'The reasoning_content in the thinking mode must be passed back to the API.',
        retryable: false
      })
    })

    await expect(loop(seeded, adapter, new RecordingSearchTool()).run(
      request(),
      context(seeded.researchSession, 'automatic')
    )).rejects.toBeInstanceOf(ModelAdapterError)
    expect(seeded.persistence.repositories.research.listLoopStates('session-1')).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ status: 'failed', searchCount: 1 })]
    })
    seeded.persistence.database.close()
  })

  it('keeps reasoning content only in the in-memory assistant tool chain', async () => {
    const seeded = seed()
    const reasoningMarker = 'PRIVATE_REASONING_NOT_FOR_STORAGE'
    const liveReasoning: string[] = []
    const adapter = new ScriptedAdapter((index, currentRequest) => {
      if (index === 0) {
        return {
          ...tool('searchWeb', { query: '思考模式工具链' }),
          reasoningContent: reasoningMarker
        }
      }

      const assistantIndex = currentRequest.messages.findIndex((message) => message.role === 'assistant')
      expect(assistantIndex).toBeGreaterThan(-1)
      expect(currentRequest.messages[assistantIndex]).toMatchObject({
        role: 'assistant',
        content: '',
        reasoningContent: reasoningMarker,
        toolCalls: [expect.objectContaining({ name: 'searchWeb' })]
      })
      expect(currentRequest.messages[assistantIndex + 1]).toMatchObject({
        role: 'tool',
        name: 'searchWeb',
        toolCallId: expect.any(String)
      })
      return tool('finishResearch', { summary: '工具链已正常继续。' })
    })

    const result = await loop(seeded, adapter, new RecordingSearchTool(), undefined, (delta) => liveReasoning.push(delta)).run(
      request(),
      context(seeded.researchSession, 'automatic')
    )

    expect(result.content).toBe('工具链已正常继续。')
    expect(liveReasoning.join('')).toContain(reasoningMarker)
    expect(JSON.stringify(result)).not.toContain(reasoningMarker)
    expect(JSON.stringify(seeded.persistence.repositories.research.listToolCalls('session-1'))).not.toContain(reasoningMarker)
    expect(JSON.stringify(seeded.persistence.repositories.research.listLoopStates('session-1'))).not.toContain(reasoningMarker)
    seeded.persistence.database.close()
  })

  it('enforces limits and reuses successful operations after restart', async () => {
    const seeded = seed()
    const search = new RecordingSearchTool()
    const makeAdapter = () => new ScriptedAdapter((index) => index === 0
      ? tool('searchWeb', { query: '同一搜索' })
      : tool('finishResearch', { summary: '完成' }))
    await loop(seeded, makeAdapter(), search).run(request(), { ...context(seeded.researchSession, 'automatic'), limits: { maxToolCalls: 3, maxSearches: 1 } })
    await loop(seeded, makeAdapter(), search).run({ ...request(), requestId: 'request-2', turnId: 'turn-2' }, { ...context(seeded.researchSession, 'automatic'), limits: { maxToolCalls: 3, maxSearches: 1 } })
    expect(search.calls).toBe(1)
    expect(seeded.persistence.repositories.research.listSources('session-1')).toMatchObject({ ok: true, value: [expect.any(Object)] })
    seeded.persistence.database.close()
  })

  it('executes two independent searches concurrently when the model requests them together', async () => {
    const seeded = seed()
    const search = new ConcurrentSearchTool()
    const adapter = new ScriptedAdapter((index, currentRequest) => {
      if (index === 0) return {
        requestId: 'response', content: '', finishReason: 'tool_calls',
        toolCalls: [
          { id: 'search-a', name: 'searchWeb', arguments: { query: '正面资料' } },
          { id: 'search-b', name: 'searchWeb', arguments: { query: '反面资料' } }
        ]
      }
      expect(currentRequest.messages.filter((message) => message.role === 'tool')).toHaveLength(2)
      return tool('finishResearch', { summary: '并行搜索完成' })
    })

    const result = await loop(seeded, adapter, search).run(request(), {
      ...context(seeded.researchSession, 'automatic'),
      limits: { maxToolCalls: 4, maxSearches: 2 }
    })

    expect(result.content).toBe('并行搜索完成')
    expect(search.calls).toBe(2)
    expect(search.maxConcurrent).toBe(2)
    seeded.persistence.database.close()
  })

  it('reads two independent pages concurrently with a divided body budget', async () => {
    const seeded = seed()
    let activeFetches = 0
    let maxConcurrentFetches = 0
    const adapter = new ScriptedAdapter((index) => {
      const sources = seeded.persistence.repositories.research.listSources('session-1')
      const sourceIds = sources.ok ? sources.value.map((source) => source.id) : []
      if (index === 0) return tool('searchWeb', { query: '两个来源' })
      if (index === 1) return {
        requestId: 'response', content: '', finishReason: 'tool_calls',
        toolCalls: sourceIds.slice(0, 2).map((sourceId, sourceIndex) => ({
          id: `read-${sourceIndex}`, name: 'readWebPage', arguments: { sourceId }
        }))
      }
      return tool('finishResearch', { summary: '并行读页完成' })
    })
    const custom = new ResearchToolLoop({
      adapter,
      repository: seeded.persistence.repositories.research,
      searchTool: new TwoResultSearchTool(),
      webPageFetcher: new WebPageFetcher({
        resolveHost: async () => ['203.0.113.10'],
        fetchImplementation: async () => {
          activeFetches += 1
          maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches)
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          activeFetches -= 1
          return new Response('<html><body><article><p>用于并行读取的网页正文。</p></article></body></html>', {
            headers: { 'content-type': 'text/html' }
          })
        }
      })
    })

    const result = await custom.run(request(), {
      ...context(seeded.researchSession, 'automatic'),
      limits: { maxToolCalls: 5, maxSearches: 1, maxPageReads: 2, maxBodyCharacters: 10_000 }
    })

    expect(result.content).toBe('并行读页完成')
    expect(maxConcurrentFetches).toBe(2)
    expect(seeded.persistence.repositories.research.listFetchedPages('session-1')).toMatchObject({
      ok: true,
      value: [expect.any(Object), expect.any(Object)]
    })
    seeded.persistence.database.close()
  })

  it('runs search automatically in step mode and only asks before publishing evidence', async () => {
    const seeded = seed()
    const approval = new ResearchApprovalController()
    const search = new RecordingSearchTool()
    const adapter = new ScriptedAdapter((index) => {
      const sources = seeded.persistence.repositories.research.listSources('session-1')
      const sourceId = sources.ok ? sources.value[0]?.id : undefined
      return [
        tool('searchWeb', { query: '自动搜索' }),
        tool('publishEvidence', { sourceId }),
        tool('finishResearch', { summary: '用户拒绝发布后结束。' })
      ][index]!
    })
    const running = loop(seeded, adapter, search, approval).run(request(), context(seeded.researchSession, 'step-confirmation'))
    const pending = await waitForPending(seeded.persistence)
    expect(search.calls).toBe(1)
    expect(pending.toolName).toBe('publishEvidence')
    expect(pending.status).toBe('pending-approval')
    expect(approval.decide(pending.id, false)).toBe(true)
    const result = await running
    expect(result.content).toContain('拒绝发布')
    expect(seeded.persistence.repositories.research.listSources('session-1')).toMatchObject({ ok: true, value: [expect.any(Object)] })
    expect(seeded.persistence.repositories.research.listEvidence('session-1')).toMatchObject({ ok: true, value: [] })
    seeded.persistence.database.close()
  })

  it('explains that anti-loop guards do not block saving, publishing or finishing', async () => {
    const seeded = seed()
    let observedInstruction: string | undefined
    const adapter = new ScriptedAdapter((_index, currentRequest) => {
      observedInstruction = currentRequest.messages.at(-1)?.content
      return tool('finishResearch', { summary: '已按限制结束。' })
    })

    await loop(seeded, adapter, new RecordingSearchTool()).run(request(), context(seeded.researchSession, 'automatic'))

    expect(observedInstruction).toContain('防止重复调用和长时间空转')
    expect(observedInstruction).toContain('不限制保存笔记、保存主张、发布证据或正常结束研究')
    seeded.persistence.database.close()
  })

  it('enters finalization at the discovery decision guard and auto-publishes a recommended full-text source', async () => {
    const seeded = seed()
    const adapter = new ScriptedAdapter((index, currentRequest) => {
      const sources = seeded.persistence.repositories.research.listSources('session-1')
      const sourceId = sources.ok ? sources.value[0]?.id : undefined
      if (index === 3) {
        const toolNames = currentRequest.tools?.map((item) => item.name) ?? []
        expect(toolNames).not.toContain('searchWeb')
        expect(toolNames).not.toContain('readWebPage')
        expect(toolNames).toContain('publishEvidence')
        expect(toolNames).toContain('finishResearch')
      }
      return [
        tool('searchWeb', { query: '可靠资料' }),
        tool('readWebPage', { sourceId }),
        tool('saveResearchNote', { sourceId, content: '正文已核验。', evaluation: {
          purpose: '核验主张', relevance: '直接相关', stance: '支持正方', sourceType: '官方机构',
          credibility: '来源可靠', limitations: '范围有限', recommendPublication: true
        } }),
        tool('finishResearch', { summary: '已整理并发布可用证据。' })
      ][index]!
    })

    const result = await loop(seeded, adapter, new RecordingSearchTool()).run(request(), {
      ...context(seeded.researchSession, 'automatic'),
      limits: {
        maxToolCalls: 2, maxSearches: 1, maxPageReads: 1, maxBodyCharacters: 10_000,
        maxDecisionRounds: 3, maxNoProgressRounds: 2, maxFinalizationRounds: 4, targetEvidenceCount: 1
      }
    })

    expect(result.content).toContain('已整理')
    expect(result.state.toolCallCount).toBeGreaterThan(2)
    expect(seeded.persistence.repositories.research.listEvidence('session-1')).toMatchObject({
      ok: true, value: [expect.objectContaining({ publicCode: 'A-S1' })]
    })
    seeded.persistence.database.close()
  })

  it('cancels a pending approval and restores active tool state as interrupted', async () => {
    const seeded = seed()
    const approval = new ResearchApprovalController()
    const adapter = new ScriptedAdapter(() => tool('publishEvidence', { sourceId: 'pending-source' }))
    const controller = new AbortController()
    const running = loop(seeded, adapter, new RecordingSearchTool(), approval).run(
      { ...request(), signal: controller.signal }, context(seeded.researchSession, 'step-confirmation')
    )
    await waitForPending(seeded.persistence)
    controller.abort()
    await expect(running).rejects.toBeTruthy()
    expect(seeded.persistence.repositories.research.listToolCalls('session-1')).toMatchObject({
      ok: true, value: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(seeded.persistence.repositories.research.listLoopStates('session-1')).toMatchObject({
      ok: true, value: [expect.objectContaining({ status: 'interrupted' })]
    })
    seeded.persistence.database.close()
  })

  it('marks active persisted calls interrupted during application recovery without deleting completed work', () => {
    const seeded = seed()
    const repository = seeded.persistence.repositories.research
    const base = {
      debateSessionId: 'session-1', researchSessionId: seeded.researchSession.id,
      ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private' as const,
      role: 'affirmative' as const, toolName: 'searchWeb' as const, argumentsJson: '{"query":"x"}', createdAt: timestamp
    }
    repository.saveToolCall({ ...base, id: 'running-call', operationKey: 'running-op', status: 'running' })
    repository.saveToolCall({ ...base, id: 'completed-call', operationKey: 'completed-op', status: 'completed', resultSummary: '已完成', completedAt: timestamp })
    repository.saveLoopState({
      debateSessionId: 'session-1', researchSessionId: seeded.researchSession.id, ownerParticipantId: 'affirmative-1',
      role: 'affirmative', mode: 'automatic', status: 'running', toolCallCount: 2, searchCount: 1,
      pageReadCount: 0, bodyCharacters: 0, limits: { maxToolCalls: 12, maxSearches: 3, maxPageReads: 3, maxBodyCharacters: 45000 }, updatedAt: timestamp
    })
    expect(repository.markActiveToolCallsInterrupted('2026-07-14T01:00:00.000Z')).toMatchObject({ ok: true, value: 2 })
    expect(repository.listToolCalls('session-1')).toMatchObject({ ok: true, value: [
      expect.objectContaining({ id: 'running-call', status: 'interrupted' }),
      expect.objectContaining({ id: 'completed-call', status: 'completed' })
    ] })
    seeded.persistence.database.close()
  })

  it('uses strict JSON fallback and reports parse failures instead of simulating success', async () => {
    const seeded = seed()
    const good = new TextAdapter(['{"tool":"finishResearch","arguments":{"summary":"JSON 回退完成"}}'])
    const result = await loop(seeded, good, new RecordingSearchTool()).run(request(), { ...context(seeded.researchSession, 'automatic'), supportsToolCalling: false })
    expect(result.content).toBe('JSON 回退完成')
    const bad = new TextAdapter(['not-json'])
    await expect(loop(seeded, bad, new RecordingSearchTool()).run({ ...request(), requestId: 'bad' }, { ...context(seeded.researchSession, 'automatic'), supportsToolCalling: false }))
      .rejects.toBeInstanceOf(ModelAdapterError)
    seeded.persistence.database.close()
  })

  it('stores a long page once but injects only summary and a bounded excerpt into later prompts', async () => {
    const seeded = seed()
    const search = new RecordingSearchTool()
    const adapter = new ScriptedAdapter((index, currentRequest) => {
      const sources = seeded.persistence.repositories.research.listSources('session-1')
      const sourceId = sources.ok ? sources.value[0]?.id : undefined
      if (index === 2) {
        const toolResult = currentRequest.messages.at(-1)?.content ?? ''
        expect(toolResult.length).toBeLessThan(5_000)
        expect(toolResult).not.toContain('TAIL_MARKER')
      }
      return [tool('searchWeb', { query: '长网页' }), tool('readWebPage', { sourceId }), tool('finishResearch', { summary: '长网页已压缩注入' })][index]!
    })
    const custom = new ResearchToolLoop({
      adapter, repository: seeded.persistence.repositories.research, searchTool: search,
      webPageFetcher: new WebPageFetcher({ resolveHost: async () => ['203.0.113.10'], fetchImplementation: async () => new Response(
        `<html><body><article><p>${'A'.repeat(20_000)}TAIL_MARKER</p></article></body></html>`, { headers: { 'content-type': 'text/html' } }
      ) })
    })
    await custom.run(request(), context(seeded.researchSession, 'automatic'))
    const pages = seeded.persistence.repositories.research.listFetchedPages('session-1')
    expect(pages.ok && pages.value[0]?.bodyText).toContain('TAIL_MARKER')
    seeded.persistence.database.close()
  })
})

function seed(): { persistence: PersistenceContext; researchSession: ResearchSession } {
  const directory = mkdtempSync(join(tmpdir(), 'research-loop-'))
  directories.push(directory)
  const initialized = initializePersistence({ appDataDirectory: directory })
  if (!initialized.ok) throw initialized.error
  const persistence = initialized.value
  const repositories = persistence.repositories
  repositories.providerConnections.create({ id: 'c', providerId: 'x', displayName: 'X', protocolType: 'openai-chat', baseUrl: 'https://example.test/v1', credentialRef: 'c', enabled: true, createdAt: timestamp, updatedAt: timestamp })
  repositories.modelProfiles.create({ id: 'm', connectionId: 'c', modelId: 'model', displayName: 'Model', capabilities: { textInput: true, imageInput: false, documentInput: false, audioInput: false, videoInput: false, streaming: true, reasoning: false, toolCalling: true, webSearch: false, structuredOutput: true }, createdAt: timestamp, updatedAt: timestamp })
  repositories.debates.save({ id: 'debate-1', topic: '公交投入', status: 'draft', createdAt: timestamp, updatedAt: timestamp })
  repositories.sessions.create({ id: 'session-1', debateId: 'debate-1', status: 'running', currentStage: 'affirmative_research', createdAt: timestamp, updatedAt: timestamp })
  for (const [id, role] of [['affirmative-1', 'affirmative'], ['negative-1', 'negative'], ['moderator-1', 'moderator']] as const) {
    repositories.participants.create({ id, sessionId: 'session-1', role, modelProfileId: 'm', displayName: id, createdAt: timestamp, updatedAt: timestamp })
  }
  const session = researchSession('affirmative-research', 'affirmative-1', 'affirmative')
  if (!repositories.research.saveSession(session).ok) throw new Error('seed failed')
  return { persistence, researchSession: session }
}

function researchSession(id: string, participantId: string, role: 'affirmative' | 'negative'): ResearchSession {
  return { id, debateSessionId: 'session-1', ownerParticipantId: participantId, ownerRole: role, visibility: `${role}-private`, status: 'researching', createdAt: timestamp, updatedAt: timestamp }
}

function request(): UnifiedRequest {
  return {
    requestId: 'request-1', turnId: 'turn-1', sessionId: 'session-1', stage: 'affirmative_research', topic: '公交投入',
    participant: { id: 'affirmative-1', role: 'affirmative', name: '正方' }, prompt: '独立研究',
    signal: new AbortController().signal, modelId: 'model', messages: [{ role: 'system', content: '只看正方资料' }],
    stream: false, maxTokens: 300, runtimeMetadata: { sessionId: 'session-1', role: 'affirmative', turnId: 'turn-1', stage: 'affirmative_research' }
  }
}

function context(session: ResearchSession, mode: 'automatic' | 'step-confirmation') {
  return { debateSessionId: 'session-1', researchSession: session, role: 'affirmative' as const, topic: '公交投入', mode, supportsToolCalling: true }
}

function loop(
  seeded: ReturnType<typeof seed>,
  adapter: ModelAdapter,
  searchTool: SearchTool,
  approvalController?: ResearchApprovalController,
  onReasoning?: (delta: string) => void
): ResearchToolLoop {
  return new ResearchToolLoop({
    adapter, repository: seeded.persistence.repositories.research, searchTool,
    webPageFetcher: new WebPageFetcher({ resolveHost: async () => ['203.0.113.10'], fetchImplementation: async () => new Response(
      '<html><head><title>官方报告</title></head><body><article><p>这是用于研究的官方报告正文，包含充足的可读取内容和数据说明。</p></article></body></html>',
      { headers: { 'content-type': 'text/html' } }
    ) }), approvalController, onReasoning
  })
}

function tool(name: string, args: Record<string, unknown>): UnifiedResponse {
  return { requestId: 'response', content: '', finishReason: 'tool_calls', toolCalls: [{ id: `${name}-${Math.random()}`, name, arguments: args }] }
}

class ScriptedAdapter implements ModelAdapter {
  private index = 0
  constructor(private readonly next: (index: number, request: UnifiedRequest) => UnifiedResponse) {}
  async complete(request: UnifiedRequest): Promise<UnifiedResponse> { return this.next(this.index++, request) }
  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    const response = await this.complete(request)
    yield { type: 'started', requestId: request.requestId }
    if (response.reasoningContent) {
      yield { type: 'reasoningDelta', requestId: request.requestId, delta: response.reasoningContent }
    }
    if (response.content) yield { type: 'textDelta', requestId: request.requestId, delta: response.content }
    yield { type: 'completed', response }
  }
}

class TextAdapter implements ModelAdapter {
  private index = 0
  constructor(private readonly values: string[]) {}
  async complete(request: UnifiedRequest): Promise<UnifiedResponse> { return { requestId: request.requestId, content: this.values[this.index++] ?? '', finishReason: 'stop' } }
  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    const response = await this.complete(request)
    yield { type: 'started', requestId: request.requestId }
    if (response.content) yield { type: 'textDelta', requestId: request.requestId, delta: response.content }
    yield { type: 'completed', response }
  }
}

class RecordingSearchTool implements SearchTool {
  readonly name = 'mock-search'
  calls = 0
  async search(request: SearchRequest): Promise<SearchResult[]> {
    this.calls += 1
    return [{ title: '官方报告', url: 'https://example.test/report', summary: `${request.query}摘要`, domain: 'example.test', fetchedAt: timestamp }]
  }
}

class ConcurrentSearchTool implements SearchTool {
  readonly name = 'mock-search'
  calls = 0
  active = 0
  maxConcurrent = 0

  async search(request: SearchRequest): Promise<SearchResult[]> {
    this.calls += 1
    this.active += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    this.active -= 1
    return [{
      title: request.query, url: `https://example.test/${this.calls}`,
      summary: `${request.query}摘要`, domain: 'example.test', fetchedAt: timestamp
    }]
  }
}

class TwoResultSearchTool implements SearchTool {
  readonly name = 'mock-search'
  async search(request: SearchRequest): Promise<SearchResult[]> {
    return [1, 2].map((index) => ({
      title: `来源 ${index}`, url: `https://example.test/page-${index}`,
      summary: `${request.query}摘要 ${index}`, domain: 'example.test', fetchedAt: timestamp
    }))
  }
}

async function waitForPending(persistence: PersistenceContext) {
  for (let index = 0; index < 50; index += 1) {
    const result = persistence.repositories.research.listToolCalls('session-1')
    if (result.ok) {
      const pending = result.value.find((item) => item.status === 'pending-approval')
      if (pending) return pending
    }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('pending tool call not found')
}
