import { createHash, randomUUID } from 'node:crypto'

import type { ParticipantRole } from '../domain'
import { ModelAdapterError, type ModelAdapter, type UnifiedMessage, type UnifiedRequest, type UnifiedToolCall, type UnifiedToolDefinition } from '../providers'
import type { ResearchRepository } from '../persistence'
import type {
  EvidenceStatusHistory,
  FetchedWebPage,
  ProvisionalClaim,
  PublishedEvidence,
  ResearchLoopState,
  ResearchNote,
  ResearchOwnerRole,
  ResearchSession,
  ResearchSource,
  ResearchSourceCategory,
  ResearchToolCall,
  ResearchToolLimits,
  ResearchToolName,
  ResearchVisibility,
  SearchSession,
  SearchTool,
  SourceEvaluation
} from './types'
import { SearchToolError } from './tavily-search-tool'
import { WebPageFetcher, WebPageFetchError } from './web-page-fetcher'
import { ResearchApprovalController } from './research-approval-controller'

export const DEFAULT_RESEARCH_TOOL_LIMITS: ResearchToolLimits = {
  maxToolCalls: 12,
  maxSearches: 3,
  maxPageReads: 3,
  maxBodyCharacters: 45_000
}

export interface ResearchToolLoopContext {
  debateSessionId: string
  researchSession: ResearchSession
  role: ResearchOwnerRole
  topic: string
  goal?: string
  mode: 'automatic' | 'step-confirmation'
  limits?: Partial<ResearchToolLimits>
  supportsToolCalling: boolean
}

export interface ResearchToolLoopDependencies {
  adapter: ModelAdapter
  repository: ResearchRepository
  searchTool: SearchTool
  webPageFetcher: WebPageFetcher
  approvalController?: ResearchApprovalController
  createId?: () => string
  now?: () => Date
  onProgress?: (message: string, state: ResearchLoopState) => void
}

export interface ResearchToolLoopResult {
  content: string
  state: ResearchLoopState
}

interface ToolExecutionResult {
  content: string
  finished?: boolean
}

export class ResearchToolLoop {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly dependencies: ResearchToolLoopDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  async run(baseRequest: UnifiedRequest, context: ResearchToolLoopContext): Promise<ResearchToolLoopResult> {
    const limits = { ...DEFAULT_RESEARCH_TOOL_LIMITS, ...context.limits }
    let state: ResearchLoopState = {
      debateSessionId: context.debateSessionId,
      researchSessionId: context.researchSession.id,
      ownerParticipantId: context.researchSession.ownerParticipantId,
      role: context.role,
      mode: context.mode,
      status: 'running',
      goal: context.goal,
      toolCallCount: 0,
      searchCount: 0,
      pageReadCount: 0,
      bodyCharacters: 0,
      limits,
      updatedAt: this.timestamp()
    }
    this.persistState(state)
    const messages: UnifiedMessage[] = [
      ...baseRequest.messages,
      { role: 'user', content: this.loopInstructions(context, limits) }
    ]
    let finalContent = ''

    while (!baseRequest.signal.aborted && state.toolCallCount < limits.maxToolCalls) {
      const response = await this.dependencies.adapter.complete({
        ...baseRequest,
        stream: false,
        messages,
        tools: context.supportsToolCalling ? [...RESEARCH_TOOLS] : undefined,
        toolChoice: context.supportsToolCalling ? 'auto' : undefined
      })
      const toolCalls = context.supportsToolCalling
        ? response.toolCalls ?? []
        : [this.parseFallback(response.content)]
      if (!toolCalls.length) {
        finalContent = response.content
        break
      }

      const selectedToolCalls = toolCalls.slice(0, 1)
      messages.push({ role: 'assistant', content: response.content, toolCalls: context.supportsToolCalling ? selectedToolCalls : undefined })
      for (const toolCall of selectedToolCalls) {
        state = { ...state, toolCallCount: state.toolCallCount + 1, updatedAt: this.timestamp() }
        const executed = await this.execute(toolCall, context, state, baseRequest.signal)
        state = executed.state
        messages.push(context.supportsToolCalling
          ? { role: 'tool', name: toolCall.name, toolCallId: toolCall.id, content: executed.result.content }
          : { role: 'user', content: `工具 ${toolCall.name} 返回：${executed.result.content}\n请继续输出下一个 JSON 工具调用，或调用 finishResearch。` })
        if (executed.result.finished) {
          finalContent = executed.result.content
          break
        }
      }
      if (finalContent) break
    }

    if (baseRequest.signal.aborted) {
      state = { ...state, status: 'interrupted', updatedAt: this.timestamp() }
      this.persistState(state)
      throw new ModelAdapterError({ code: 'CANCELLED', message: 'Research tool loop was cancelled.', titleZh: '研究已取消', descriptionZh: '已保留完成的搜索、网页和研究记录。', retryable: true })
    }
    if (!finalContent) {
      state = { ...state, status: 'summarizing', updatedAt: this.timestamp() }
      this.persistState(state)
      const summary = await this.dependencies.adapter.complete({
        ...baseRequest,
        stream: false,
        tools: undefined,
        toolChoice: undefined,
        messages: [...messages, {
          role: 'user',
          content: '工具调用已达上限。请基于已有工具结果总结：已选资料、来源评价、暂定主张和未解决问题。不要声称执行了新工具。'
        }]
      })
      finalContent = summary.content
    }
    state = { ...state, status: 'completed', updatedAt: this.timestamp() }
    this.persistState(state)
    return { content: finalContent, state }
  }

  private async execute(
    toolCall: UnifiedToolCall,
    context: ResearchToolLoopContext,
    state: ResearchLoopState,
    signal: AbortSignal
  ): Promise<{ result: ToolExecutionResult; state: ResearchLoopState }> {
    const toolName = this.toolName(toolCall.name)
    const operationKey = this.operationKey(context, toolName, toolCall.arguments)
    const cached = this.dependencies.repository.findCompletedToolCall(operationKey)
    if (!cached.ok) throw cached.error
    if (cached.value) {
      const message = `已复用先前完成的 ${toolName}：${cached.value.resultSummary ?? '已完成'}。`
      this.progress(message, state)
      return { result: { content: message, finished: toolName === 'finishResearch' }, state }
    }

    const call: ResearchToolCall = {
      id: toolCall.id || this.createId(), debateSessionId: context.debateSessionId,
      researchSessionId: context.researchSession.id, ownerParticipantId: context.researchSession.ownerParticipantId,
      visibility: context.researchSession.visibility, role: context.role, toolName, operationKey,
      argumentsJson: JSON.stringify(toolCall.arguments), status: context.mode === 'step-confirmation' && this.requiresApproval(toolName) ? 'pending-approval' : 'running',
      createdAt: this.timestamp()
    }
    this.saveCall(call)

    if (call.status === 'pending-approval') {
      state = { ...state, status: 'waiting-approval', updatedAt: this.timestamp() }
      this.persistState(state)
      this.progress(`等待确认：${toolName}`, state)
      let approved: boolean | undefined
      try {
        approved = await this.dependencies.approvalController?.wait(call.id, signal)
      } catch (cause) {
        this.saveCall({ ...call, status: 'interrupted', errorCode: 'RESEARCH_CANCELLED', errorDescriptionZh: '研究已取消，已保留之前结果。', completedAt: this.timestamp() })
        state = { ...state, status: 'interrupted', updatedAt: this.timestamp() }
        this.persistState(state)
        throw cause
      }
      if (!approved) {
        const denied = { ...call, status: 'denied' as const, resultSummary: '用户拒绝了本次工具调用。', completedAt: this.timestamp() }
        this.saveCall(denied)
        state = { ...state, status: 'running', updatedAt: this.timestamp() }
        this.persistState(state)
        return { result: { content: denied.resultSummary }, state }
      }
      call.status = 'running'
      this.saveCall(call)
      state = { ...state, status: 'running', updatedAt: this.timestamp() }
    }

    try {
      const outcome = await this.invokeTool(toolName, toolCall.arguments, context, state, signal)
      state = outcome.state
      this.saveCall({ ...call, status: 'completed', resultSummary: outcome.result.content.slice(0, 4_000), completedAt: this.timestamp() })
      this.persistState(state)
      this.progress(`${toolName}：${outcome.result.content.slice(0, 180)}`, state)
      return outcome
    } catch (cause) {
      if (signal.aborted) {
        this.saveCall({ ...call, status: 'interrupted', errorCode: 'RESEARCH_CANCELLED', errorDescriptionZh: '研究已取消，已保留完成的搜索和网页。', completedAt: this.timestamp() })
        state = { ...state, status: 'interrupted', updatedAt: this.timestamp() }
        this.persistState(state)
        throw cause
      }
      const normalized = this.normalizeToolError(cause)
      this.saveCall({ ...call, status: 'failed', errorCode: normalized.code, errorDescriptionZh: normalized.descriptionZh, completedAt: this.timestamp() })
      state = { ...state, status: 'running', updatedAt: this.timestamp() }
      this.persistState(state)
      return { result: { content: `工具失败（${normalized.code}）：${normalized.descriptionZh}。可以调整搜索词、改读其他来源或结束研究。` }, state }
    }
  }

  private async invokeTool(
    name: ResearchToolName,
    args: Record<string, unknown>,
    context: ResearchToolLoopContext,
    state: ResearchLoopState,
    signal: AbortSignal
  ): Promise<{ result: ToolExecutionResult; state: ResearchLoopState }> {
    switch (name) {
      case 'searchWeb': return this.searchWeb(args, context, state, signal)
      case 'readWebPage': return this.readWebPage(args, context, state, signal)
      case 'saveResearchNote': return this.saveResearchNote(args, context, state)
      case 'saveProvisionalClaim': return this.saveClaim(args, context, state)
      case 'publishEvidence': return this.publishEvidence(args, context, state)
      case 'finishResearch': return { result: { content: this.string(args.summary, '研究已完成。'), finished: true }, state }
    }
  }

  private async searchWeb(args: Record<string, unknown>, context: ResearchToolLoopContext, state: ResearchLoopState, signal: AbortSignal) {
    if (state.searchCount >= state.limits.maxSearches) throw this.limitError('搜索次数')
    const query = this.requiredString(args.query, '搜索词')
    const searchSessionId = this.createId()
    const startedAt = this.timestamp()
    const searchSession: SearchSession = {
      id: searchSessionId, debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
      ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
      toolName: this.dependencies.searchTool.name, status: 'running', createdAt: startedAt
    }
    this.unwrap(this.dependencies.repository.saveSearchSession(searchSession))
    this.unwrap(this.dependencies.repository.saveQuery({
      id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
      searchSessionId, ownerParticipantId: context.researchSession.ownerParticipantId,
      visibility: context.researchSession.visibility, query, createdAt: startedAt
    }))
    try {
      const results = await this.dependencies.searchTool.search({
        debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
        ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
        query, maxResults: this.number(args.maxResults, 5),
        searchDepth: this.string(args.searchDepth, 'basic') as 'basic' | 'advanced' | 'fast' | 'ultra-fast',
        timeRange: typeof args.timeRange === 'string' ? args.timeRange as 'day' | 'week' | 'month' | 'year' : undefined,
        includeDomains: this.stringArray(args.includeDomains), excludeDomains: this.stringArray(args.excludeDomains), signal
      })
      const labels: string[] = []
      for (const result of results) {
        const id = this.createId()
        this.unwrap(this.dependencies.repository.saveSource({
          id, debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
          searchSessionId, ownerParticipantId: context.researchSession.ownerParticipantId,
          visibility: context.researchSession.visibility, title: result.title, url: result.url,
          domain: result.domain, summary: result.summary.slice(0, 4_000), publishedAt: result.publishedAt,
          fetchedAt: result.fetchedAt, sourceType: this.dependencies.searchTool.name === 'tavily' ? 'tavily-search' : 'mock-search',
          score: result.score, verificationLevel: 'summary-only', createdAt: this.timestamp()
        }))
        labels.push(`${id}: ${result.title} (${result.domain}) - 仅搜索摘要，未核验正文`)
      }
      this.unwrap(this.dependencies.repository.saveSearchSession({ ...searchSession, status: 'completed', completedAt: this.timestamp() }))
      return {
        result: { content: labels.length ? labels.join('\n') : '未找到结果。' },
        state: { ...state, searchCount: state.searchCount + 1, updatedAt: this.timestamp() }
      }
    } catch (cause) {
      this.dependencies.repository.saveSearchSession({ ...searchSession, status: signal.aborted ? 'cancelled' : 'failed', completedAt: this.timestamp() })
      throw cause
    }
  }

  private async readWebPage(args: Record<string, unknown>, context: ResearchToolLoopContext, state: ResearchLoopState, signal: AbortSignal) {
    if (state.pageReadCount >= state.limits.maxPageReads) throw this.limitError('网页读取次数')
    const sourceId = this.requiredString(args.sourceId, '来源 ID')
    const source = this.unwrap(this.dependencies.repository.findSourceById(sourceId))
    if (!source || source.debateSessionId !== context.debateSessionId || !this.visibleTo(source.visibility, context.role)) {
      throw { code: 'SOURCE_NOT_VISIBLE', descriptionZh: '该来源不存在或当前研究角色无权读取。' }
    }
    if (!source.url) throw { code: 'SOURCE_URL_MISSING', descriptionZh: '该来源没有可读取的 URL。' }
    const existing = this.unwrap(this.dependencies.repository.findFetchedPageBySource(sourceId))
    if (existing?.status === 'completed') {
      return { result: { content: this.pagePrompt(existing) }, state }
    }
    const remaining = state.limits.maxBodyCharacters - state.bodyCharacters
    if (remaining <= 0) throw this.limitError('正文总字符数')
    try {
      const fetched = await this.dependencies.webPageFetcher.fetch(source.url, signal)
      const bodyText = fetched.bodyText.slice(0, remaining)
      const page: FetchedWebPage = {
        id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
        sourceId, ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
        url: source.url, finalUrl: fetched.finalUrl, title: fetched.title, author: fetched.author,
        publishedAt: fetched.publishedAt, contentType: fetched.contentType, bodyText,
        summary: fetched.summary, excerpt: fetched.excerpt.slice(0, Math.min(3_000, remaining)),
        bodyCharacters: bodyText.length, status: 'completed', fetchedAt: fetched.fetchedAt, createdAt: this.timestamp()
      }
      this.unwrap(this.dependencies.repository.saveFetchedPage(page))
      this.unwrap(this.dependencies.repository.saveSource({ ...source, title: fetched.title || source.title, publishedAt: fetched.publishedAt ?? source.publishedAt, fetchedAt: fetched.fetchedAt, verificationLevel: 'full-text-read' }))
      return {
        result: { content: this.pagePrompt(page) },
        state: { ...state, pageReadCount: state.pageReadCount + 1, bodyCharacters: state.bodyCharacters + bodyText.length, updatedAt: this.timestamp() }
      }
    } catch (cause) {
      const error = this.normalizeToolError(cause)
      const inaccessible: FetchedWebPage = {
        id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
        sourceId, ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
        url: source.url, finalUrl: source.url, title: source.title, contentType: '', bodyText: '',
        summary: source.summary ?? '', excerpt: '', bodyCharacters: 0, status: 'inaccessible', errorCode: error.code,
        fetchedAt: this.timestamp(), createdAt: this.timestamp()
      }
      this.dependencies.repository.saveFetchedPage(inaccessible)
      throw cause
    }
  }

  private saveResearchNote(args: Record<string, unknown>, context: ResearchToolLoopContext, state: ResearchLoopState) {
    const content = this.requiredString(args.content, '研究笔记')
    const sourceId = typeof args.sourceId === 'string' ? args.sourceId : undefined
    if (sourceId) this.assertVisibleSource(sourceId, context)
    const note: ResearchNote = {
      id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
      ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
      sourceId, content, createdAt: this.timestamp()
    }
    this.unwrap(this.dependencies.repository.saveNote(note))
    if (sourceId && this.isRecord(args.evaluation)) this.saveEvaluation(sourceId, args.evaluation, context)
    return { result: { content: `已保存研究笔记 ${note.id}。` }, state }
  }

  private saveClaim(args: Record<string, unknown>, context: ResearchToolLoopContext, state: ResearchLoopState) {
    const supportingSourceIds = this.stringArray(args.supportingSourceIds)
    supportingSourceIds.forEach((sourceId) => this.assertVisibleSource(sourceId, context))
    const claim: ProvisionalClaim = {
      id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
      ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
      claim: this.requiredString(args.claim, '暂定主张'), supportingSourceIds,
      unresolved: args.unresolved !== false, createdAt: this.timestamp()
    }
    this.unwrap(this.dependencies.repository.saveClaim(claim))
    return { result: { content: `已保存暂定主张 ${claim.id}。` }, state }
  }

  private publishEvidence(args: Record<string, unknown>, context: ResearchToolLoopContext, state: ResearchLoopState) {
    const sourceId = this.requiredString(args.sourceId, '来源 ID')
    const source = this.assertVisibleSource(sourceId, context)
    const existing = this.unwrap(this.dependencies.repository.listEvidence(context.debateSessionId)).find((item) => item.sourceId === sourceId)
    if (existing) return { result: { content: `该来源已发布为 ${existing.publicCode}。` }, state }
    const page = this.unwrap(this.dependencies.repository.findFetchedPageBySource(sourceId))
    const verified = page?.status === 'completed'
    const count = this.unwrap(this.dependencies.repository.countEvidenceByRole(context.debateSessionId, context.role))
    const prefix = { affirmative: 'A', negative: 'B', moderator: 'M' }[context.role]
    const id = this.createId()
    const createdAt = this.timestamp()
    const evidence: PublishedEvidence = {
      id, debateSessionId: context.debateSessionId, publicCode: `${prefix}-S${count + 1}`,
      submittedByParticipantId: context.researchSession.ownerParticipantId, submitterRole: context.role,
      sourceId, title: source.title,
      summary: verified ? source.summary : `[仅基于搜索摘要，尚未核验] ${source.summary ?? ''}`,
      sourceUrl: source.url, currentStatus: 'unverified', createdAt
    }
    const history: EvidenceStatusHistory = {
      id: this.createId(), debateSessionId: context.debateSessionId, evidenceId: id,
      toStatus: 'unverified', changedBy: context.researchSession.ownerParticipantId,
      note: verified ? '已读取正文后发布。' : '仅基于搜索摘要，尚未核验正文。', createdAt
    }
    this.unwrap(this.dependencies.repository.createEvidence(evidence, history))
    return { result: { content: `已发布证据 ${evidence.publicCode}${verified ? '' : '（摘要未核验）'}。` }, state }
  }

  private saveEvaluation(sourceId: string, value: Record<string, unknown>, context: ResearchToolLoopContext): void {
    const page = this.unwrap(this.dependencies.repository.findFetchedPageBySource(sourceId))
    const evaluation: SourceEvaluation = {
      id: this.createId(), debateSessionId: context.debateSessionId, researchSessionId: context.researchSession.id,
      sourceId, ownerParticipantId: context.researchSession.ownerParticipantId, visibility: context.researchSession.visibility,
      purpose: this.requiredString(value.purpose, '来源用途'), relevance: this.requiredString(value.relevance, '与辩题的关系'),
      stance: this.requiredString(value.stance, '支持或反对的主张'), sourceType: this.sourceCategory(value.sourceType),
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : page?.publishedAt,
      credibility: this.requiredString(value.credibility, '可信度评价'), limitations: this.requiredString(value.limitations, '可能局限'),
      recommendPublication: value.recommendPublication === true, basedOn: page?.status === 'completed' ? 'full-text' : 'summary-only',
      createdAt: this.timestamp()
    }
    this.unwrap(this.dependencies.repository.saveSourceEvaluation(evaluation))
  }

  private pagePrompt(page: FetchedWebPage): string {
    return [
      `标题：${page.title}`,
      page.author ? `作者：${page.author}` : '',
      page.publishedAt ? `发布时间：${page.publishedAt}` : '',
      `结构化摘要：${page.summary}`,
      `必要摘录（最多 3000 字符）：${page.excerpt}`,
      '下一步请用 saveResearchNote 保存显式来源评价，不要输出隐藏思维链。'
    ].filter(Boolean).join('\n')
  }

  private assertVisibleSource(sourceId: string, context: ResearchToolLoopContext): ResearchSource {
    const source = this.unwrap(this.dependencies.repository.findSourceById(sourceId))
    if (!source || source.debateSessionId !== context.debateSessionId || !this.visibleTo(source.visibility, context.role)) {
      throw { code: 'SOURCE_NOT_VISIBLE', descriptionZh: '来源不存在或当前角色无权读取。' }
    }
    return source
  }

  private visibleTo(visibility: ResearchVisibility, role: ResearchOwnerRole): boolean {
    return visibility === 'public' || visibility === `${role}-private`
  }

  private loopInstructions(context: ResearchToolLoopContext, limits: ResearchToolLimits): string {
    const completionPriority = context.role === 'moderator'
      ? '主持人只整理公共方向和事实边界，不要代替任一方形成完整论证。'
      : '在总工具次数用完前预留至少 2 次：有可靠来源时必须先用 publishEvidence 发布至少一条本方证据，再用 finishResearch 结束；不要把所有次数用在重复搜索或重复读页上。'
    return [
      '你正在执行受控的自主研究。只输出下一个工具调用，不要输出隐藏思维链。',
      `当前角色：${context.role}；研究目标：${context.goal ?? context.topic}。`,
      `上限：总工具 ${limits.maxToolCalls}，搜索 ${limits.maxSearches}，读页 ${limits.maxPageReads}，正文总字符 ${limits.maxBodyCharacters}。`,
      '搜索摘要不等于已核验正文。发布前应先 readWebPage；如未读取仍发布，系统会明确标记“仅基于摘要”。',
      completionPriority,
      context.supportsToolCalling ? '使用提供的结构化工具。' : `模型不支持原生工具调用。每次必须只返回 JSON：{"tool":"searchWeb","arguments":{"query":"..."}}。最后返回 {"tool":"finishResearch","arguments":{"summary":"..."}}。`
    ].join('\n')
  }

  private parseFallback(content: string): UnifiedToolCall {
    try {
      const parsed: unknown = JSON.parse(content.trim())
      if (!this.isRecord(parsed) || typeof parsed.tool !== 'string' || !this.isRecord(parsed.arguments)) throw new Error('shape')
      return { id: this.createId(), name: parsed.tool, arguments: parsed.arguments }
    } catch {
      throw new ModelAdapterError({
        code: 'REQUEST_FAILED', message: 'Research JSON fallback could not be parsed.',
        titleZh: '研究工具 JSON 无法解析',
        descriptionZh: '当前模型不支持原生工具调用，且未按要求返回唯一的结构化 JSON。未模拟工具成功。',
        retryable: true, suggestedActionZh: '重试，或更换支持工具调用/结构化输出的模型。'
      })
    }
  }

  private toolName(value: string): ResearchToolName {
    if ((RESEARCH_TOOLS as readonly UnifiedToolDefinition[]).some((tool) => tool.name === value)) return value as ResearchToolName
    throw { code: 'UNKNOWN_RESEARCH_TOOL', descriptionZh: `不支持的研究工具：${value}。` }
  }

  private requiresApproval(name: ResearchToolName): boolean {
    return name === 'searchWeb' || name === 'readWebPage'
  }

  private operationKey(context: ResearchToolLoopContext, name: ResearchToolName, args: Record<string, unknown>): string {
    return createHash('sha256').update(`${context.debateSessionId}:${context.role}:${name}:${this.stableJson(args)}`).digest('hex')
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`
    if (this.isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${this.stableJson(value[key])}`).join(',')}}`
    return JSON.stringify(value)
  }

  private persistState(state: ResearchLoopState): void {
    this.unwrap(this.dependencies.repository.saveLoopState(state))
  }

  private saveCall(call: ResearchToolCall): void {
    this.unwrap(this.dependencies.repository.saveToolCall(call))
  }

  private progress(message: string, state: ResearchLoopState): void {
    this.dependencies.onProgress?.(message, state)
  }

  private normalizeToolError(cause: unknown): { code: string; descriptionZh: string } {
    if (cause instanceof SearchToolError || cause instanceof WebPageFetchError) return { code: cause.code, descriptionZh: cause.descriptionZh }
    if (this.isRecord(cause) && typeof cause.code === 'string' && typeof cause.descriptionZh === 'string') return { code: cause.code, descriptionZh: cause.descriptionZh }
    return { code: 'RESEARCH_TOOL_FAILED', descriptionZh: cause instanceof Error ? cause.message : '研究工具执行失败。' }
  }

  private limitError(label: string) { return { code: 'RESEARCH_LIMIT_REACHED', descriptionZh: `${label}已达运行上限。` } }
  private requiredString(value: unknown, label: string): string { const result = this.string(value, ''); if (!result.trim()) throw { code: 'INVALID_TOOL_ARGUMENTS', descriptionZh: `${label}不能为空。` }; return result.trim() }
  private string(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback }
  private number(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
  private stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
  private sourceCategory(value: unknown): ResearchSourceCategory { const allowed: ResearchSourceCategory[] = ['官方机构', '学术研究', '新闻媒体', '企业资料', '评论或博客', '论坛或社交内容', '未知']; return typeof value === 'string' && allowed.includes(value as ResearchSourceCategory) ? value as ResearchSourceCategory : '未知' }
  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T { if (!result.ok) throw result.error; return result.value }
  private isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
  private timestamp(): string { return this.now().toISOString() }
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object', properties, required, additionalProperties: false
})

export const RESEARCH_TOOLS: readonly UnifiedToolDefinition[] = [
  { name: 'searchWeb', description: '搜索互联网，返回来源 ID 和摘要；摘要尚未核验正文。', parameters: objectSchema({ query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 20 }, searchDepth: { enum: ['basic', 'advanced', 'fast', 'ultra-fast'] }, timeRange: { enum: ['day', 'week', 'month', 'year'] }, includeDomains: { type: 'array', items: { type: 'string' } }, excludeDomains: { type: 'array', items: { type: 'string' } } }, ['query']) },
  { name: 'readWebPage', description: '按来源 ID 读取 HTML 正文，返回结构化摘要和必要摘录。', parameters: objectSchema({ sourceId: { type: 'string' } }, ['sourceId']) },
  { name: 'saveResearchNote', description: '保存研究笔记；关联来源时应附带显式来源评价。', parameters: objectSchema({ sourceId: { type: 'string' }, content: { type: 'string' }, evaluation: objectSchema({ purpose: { type: 'string' }, relevance: { type: 'string' }, stance: { type: 'string' }, sourceType: { enum: ['官方机构', '学术研究', '新闻媒体', '企业资料', '评论或博客', '论坛或社交内容', '未知'] }, publishedAt: { type: 'string' }, credibility: { type: 'string' }, limitations: { type: 'string' }, recommendPublication: { type: 'boolean' } }, ['purpose', 'relevance', 'stance', 'sourceType', 'credibility', 'limitations', 'recommendPublication']) }, ['content']) },
  { name: 'saveProvisionalClaim', description: '保存暂定主张和关联来源。', parameters: objectSchema({ claim: { type: 'string' }, supportingSourceIds: { type: 'array', items: { type: 'string' } }, unresolved: { type: 'boolean' } }, ['claim', 'supportingSourceIds']) },
  { name: 'publishEvidence', description: '选择性将本角色可见来源发布到公开证据桌。', parameters: objectSchema({ sourceId: { type: 'string' } }, ['sourceId']) },
  { name: 'finishResearch', description: '结束当前角色研究并返回可观察总结。', parameters: objectSchema({ summary: { type: 'string' } }, ['summary']) }
]
