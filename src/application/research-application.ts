import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { DebateParticipantRole } from '../participant-config'
import type { PersistenceContext, PersistenceError } from '../persistence'
import type { LoggerLike } from '../observability'
import {
  EVIDENCE_STATUSES,
  MockSearchTool,
  ResearchApprovalController,
  ResearchVisibilityPolicy,
  SearchConnectionTestService,
  TavilySearchTool,
  type EvidenceStatus,
  type PrivateResearchVisibility,
  type ResearchAsset,
  type ResearchOwnerRole,
  type ResearchSession,
  type SearchCredentialStore,
  type SearchFetch,
  type SearchProviderConnection,
  type SearchTool
} from '../research'
import type {
  AddResearchAssetInput,
  ChallengeEvidenceInput,
  PublishEvidenceInput,
  ResearchAssetDto,
  ResearchResultDto,
  ResearchWorkspaceDto,
  ResearchRuntimeSettingsInput,
  RoleResearchWorkspaceDto,
  RunMockSearchInput,
  SaveSearchProviderConnectionInput,
  SearchProviderConnectionDto,
  UpdateEvidenceStatusInput
} from '../shared/research-dtos'

export interface ResearchApplicationDependencies {
  persistence: PersistenceContext
  appDataDirectory: string
  searchTool?: SearchTool
  credentialStore?: SearchCredentialStore
  approvalController?: ResearchApprovalController
  searchFetch?: SearchFetch
  createId?: () => string
  now?: () => Date
  logger?: LoggerLike
}

export class ResearchApplication {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly searchTool: SearchTool
  private readonly visibilityPolicy = new ResearchVisibilityPolicy()
  private readonly approvalController: ResearchApprovalController

  constructor(private readonly dependencies: ResearchApplicationDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
    this.searchTool = dependencies.searchTool ?? new MockSearchTool()
    this.approvalController = dependencies.approvalController ?? new ResearchApprovalController()
  }

  loadWorkspace(sessionId: string): ResearchResultDto<ResearchWorkspaceDto> {
    const repository = this.dependencies.persistence.repositories.research
    const participants = this.dependencies.persistence.repositories.participants.listBySession(sessionId)
    if (!participants.ok) return this.persistenceError(participants.error)
    const sessions = repository.listSessions(sessionId)
    if (!sessions.ok) return this.persistenceError(sessions.error)
    const goals = repository.listGoals(sessionId)
    if (!goals.ok) return this.persistenceError(goals.error)
    const queries = repository.listQueries(sessionId)
    if (!queries.ok) return this.persistenceError(queries.error)
    const sources = repository.listSources(sessionId)
    if (!sources.ok) return this.persistenceError(sources.error)
    const assets = repository.listAssets(sessionId)
    if (!assets.ok) return this.persistenceError(assets.error)
    const notes = repository.listNotes(sessionId)
    if (!notes.ok) return this.persistenceError(notes.error)
    const claims = repository.listClaims(sessionId)
    if (!claims.ok) return this.persistenceError(claims.error)
    const pool = repository.getPublicPool(sessionId)
    if (!pool.ok) return this.persistenceError(pool.error)
    const evidence = repository.listEvidence(sessionId)
    if (!evidence.ok) return this.persistenceError(evidence.error)
    const history = repository.listEvidenceHistory(sessionId)
    if (!history.ok) return this.persistenceError(history.error)
    const issues = repository.listReferenceIssues(sessionId)
    if (!issues.ok) return this.persistenceError(issues.error)
    const searchSessions = repository.listSearchSessions(sessionId)
    if (!searchSessions.ok) return this.persistenceError(searchSessions.error)
    const fetchedPages = repository.listFetchedPageSummaries(sessionId)
    if (!fetchedPages.ok) return this.persistenceError(fetchedPages.error)
    const sourceEvaluations = repository.listSourceEvaluations(sessionId)
    if (!sourceEvaluations.ok) return this.persistenceError(sourceEvaluations.error)
    const toolCalls = repository.listToolCalls(sessionId)
    if (!toolCalls.ok) return this.persistenceError(toolCalls.error)
    const loopStates = repository.listLoopStates(sessionId)
    if (!loopStates.ok) return this.persistenceError(loopStates.error)
    const runtimeSettingsResult = this.dependencies.persistence.repositories.settings.get<ResearchRuntimeSettingsInput>('research.runtime.defaults')
    if (!runtimeSettingsResult.ok) return this.persistenceError(runtimeSettingsResult.error)
    const runtimeSettings = runtimeSettingsResult.value ?? {
      mode: 'automatic' as const,
      limits: { maxToolCalls: 12, maxSearches: 3, maxPageReads: 3, maxBodyCharacters: 45_000 }
    }

    const ownerFor = (role: DebateParticipantRole) => participants.value.find((item) => item.role === role)?.id
    const workspaceFor = (role: ResearchOwnerRole): RoleResearchWorkspaceDto => {
      const ownerId = ownerFor(role)
      return {
        goals: goals.value.filter((item) => item.ownerParticipantId === ownerId),
        queries: queries.value.filter((item) => item.ownerParticipantId === ownerId),
        sources: sources.value.filter((item) => item.ownerParticipantId === ownerId && item.visibility !== 'public'),
        assets: assets.value.filter((item) => item.ownerParticipantId === ownerId && item.visibility !== 'public').map((item) => this.assetDto(item)),
        notes: notes.value.filter((item) => item.ownerParticipantId === ownerId),
        claims: claims.value.filter((item) => item.ownerParticipantId === ownerId),
        searchSessions: searchSessions.value.filter((item) => item.ownerParticipantId === ownerId),
        fetchedPages: fetchedPages.value.filter((item) => item.ownerParticipantId === ownerId).map(({ bodyText: _bodyText, ...page }) => ({ ...page, hasFullText: page.bodyCharacters > 0 })),
        sourceEvaluations: sourceEvaluations.value.filter((item) => item.ownerParticipantId === ownerId),
        toolCalls: toolCalls.value.filter((item) => item.ownerParticipantId === ownerId),
        loopState: loopStates.value.find((item) => item.ownerParticipantId === ownerId)
      }
    }
    return {
      ok: true,
      value: {
        debateSessionId: sessionId,
        runtimeSettings,
        publicPool: pool.value,
        publicAssets: assets.value.filter((item) => item.visibility === 'public').map((item) => this.assetDto(item)),
        affirmative: workspaceFor('affirmative'), negative: workspaceFor('negative'), moderator: workspaceFor('moderator'),
        evidence: evidence.value, evidenceHistory: history.value, invalidEvidenceReferences: issues.value
      }
    }
  }

  async listSearchProviderConnections(): Promise<ResearchResultDto<SearchProviderConnectionDto[]>> {
    const listed = this.dependencies.persistence.repositories.searchProviderConnections.list()
    if (!listed.ok) return this.persistenceError(listed.error)
    const values: SearchProviderConnectionDto[] = []
    for (const connection of listed.value) {
      const configured = this.dependencies.credentialStore
        ? await this.dependencies.credentialStore.hasCredential(connection.credentialRef)
        : { ok: true as const, value: false }
      if (!configured.ok) return this.credentialError(configured.error.message, configured.error.retryable)
      const { credentialRef: _credentialRef, ...safe } = connection
      values.push({ ...safe, credentialConfigured: configured.value })
    }
    return { ok: true, value: values }
  }

  saveSearchProviderConnection(input: SaveSearchProviderConnectionInput): ResearchResultDto<SearchProviderConnectionDto> {
    let parsed: URL
    try { parsed = new URL(input.baseUrl) } catch { return this.invalid('搜索 Base URL 无效', '请输入完整的 HTTPS URL。') }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return this.invalid('搜索 Base URL 不安全', '真实搜索连接必须使用 HTTPS。')
    const repository = this.dependencies.persistence.repositories.searchProviderConnections
    const now = this.timestamp()
    const existing = input.id ? repository.findById(input.id) : { ok: true as const, value: undefined }
    if (!existing.ok) return this.persistenceError(existing.error)
    const id = existing.value?.id ?? input.id ?? this.createId()
    const connection: SearchProviderConnection = {
      id, displayName: input.displayName.trim(), providerType: 'tavily', baseUrl: parsed.toString().replace(/\/$/, ''),
      credentialRef: existing.value?.credentialRef ?? `search:tavily:${id}`, enabled: input.enabled,
      isDefault: false, createdAt: existing.value?.createdAt ?? now, updatedAt: now
    }
    const saved = existing.value ? repository.update(connection) : repository.create(connection)
    if (!saved.ok) return this.persistenceError(saved.error)
    if (input.isDefault) {
      const defaulted = repository.setDefault(id, now)
      if (!defaulted.ok) return this.persistenceError(defaulted.error)
    }
    const { credentialRef: _credentialRef, ...safe } = { ...connection, isDefault: input.isDefault }
    return { ok: true, value: { ...safe, credentialConfigured: false } }
  }

  async saveSearchCredential(connectionId: string, credential: string): Promise<ResearchResultDto<boolean>> {
    if (!this.dependencies.credentialStore) return this.invalid('凭据存储不可用', '主进程未配置 CredentialStore。')
    const connection = this.dependencies.persistence.repositories.searchProviderConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('搜索连接不存在')
    const result = await this.dependencies.credentialStore.setCredential(connection.value.credentialRef, credential)
    return result.ok ? { ok: true, value: true } : this.credentialError(result.error.message, result.error.retryable)
  }

  async deleteSearchCredential(connectionId: string): Promise<ResearchResultDto<boolean>> {
    if (!this.dependencies.credentialStore) return this.invalid('凭据存储不可用', '主进程未配置 CredentialStore。')
    const connection = this.dependencies.persistence.repositories.searchProviderConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('搜索连接不存在')
    const result = await this.dependencies.credentialStore.deleteCredential(connection.value.credentialRef)
    return result.ok ? { ok: true, value: result.value } : this.credentialError(result.error.message, result.error.retryable)
  }

  async testSearchConnection(connectionId: string, signal?: AbortSignal): Promise<ResearchResultDto<Awaited<ReturnType<SearchConnectionTestService['test']>>>> {
    if (!this.dependencies.credentialStore) return this.invalid('凭据存储不可用', '主进程未配置 CredentialStore。')
    const connection = this.dependencies.persistence.repositories.searchProviderConnections.findById(connectionId)
    if (!connection.ok) return this.persistenceError(connection.error)
    if (!connection.value) return this.notFound('搜索连接不存在')
    const result = await new SearchConnectionTestService().test(
      new TavilySearchTool({
        connection: connection.value,
        credentialStore: this.dependencies.credentialStore,
        fetchImplementation: this.dependencies.searchFetch,
        logger: this.dependencies.logger
      }), signal
    )
    return { ok: true, value: result }
  }

  deleteSearchProviderConnection(id: string): ResearchResultDto<boolean> {
    const deleted = this.dependencies.persistence.repositories.searchProviderConnections.delete(id)
    return deleted.ok ? { ok: true, value: deleted.value } : this.persistenceError(deleted.error)
  }

  saveRuntimeSettings(input: ResearchRuntimeSettingsInput): ResearchResultDto<boolean> {
    const saved = this.dependencies.persistence.repositories.settings.set('research.runtime.defaults', input)
    return saved.ok ? { ok: true, value: true } : this.persistenceError(saved.error)
  }

  decideToolCall(callId: string, approved: boolean): ResearchResultDto<boolean> {
    const accepted = this.approvalController.decide(callId, approved)
    return accepted ? { ok: true, value: true } : this.invalid('待确认工具调用不存在', '该工具调用已经结束、被取消或不属于当前进程。')
  }

  addAsset(input: AddResearchAssetInput): ResearchResultDto<ResearchAssetDto> {
    const checked = this.validateAssetInput(input)
    if (!checked.ok) return checked
    const role = checked.value.role
    const researchSession = this.ensureResearchSession(input.sessionId, input.ownerParticipantId, role)
    if (!researchSession.ok) return researchSession

    let localPath: string | undefined
    if (input.kind === 'image') {
      try {
        const directory = join(this.dependencies.appDataDirectory, 'assets', 'research', input.sessionId)
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        chmodSync(directory, 0o700)
        const extension = extname(input.fileName || '') || this.extensionForMime(input.mimeType || '')
        localPath = join(directory, `${this.createId()}${extension}`)
        writeFileSync(localPath, Uint8Array.from(input.bytes || []), { flag: 'wx', mode: 0o600 })
      } catch (cause) {
        return this.invalid('图片保存失败', cause instanceof Error ? cause.message : '无法写入应用资产目录。', true)
      }
    }

    const asset: ResearchAsset = {
      id: this.createId(), debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
      ownerParticipantId: input.ownerParticipantId, visibility: input.visibility, kind: input.kind,
      title: input.title.trim(), textContent: input.textContent?.trim() || undefined,
      url: input.url?.trim() || undefined, summary: input.summary?.trim() || undefined,
      localPath, mimeType: input.mimeType, sourceName: input.fileName ? basename(input.fileName) : undefined,
      createdBy: input.ownerParticipantId, isOriginal: true, createdAt: this.timestamp()
    }
    const saved = this.dependencies.persistence.repositories.research.saveAsset(asset)
    if (!saved.ok) {
      if (localPath) {
        try { unlinkSync(localPath) } catch { /* Failed database writes must not hide their primary error. */ }
      }
      return this.persistenceError(saved.error)
    }

    if (input.kind === 'url') {
      const url = new URL(input.url!)
      const source = this.dependencies.persistence.repositories.research.saveSource({
        id: this.createId(), debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId: input.ownerParticipantId, visibility: input.visibility, title: input.title.trim(),
        url: url.toString(), domain: url.hostname, summary: input.summary?.trim() || undefined,
        sourceType: 'manual-url', createdAt: this.timestamp()
      })
      if (!source.ok) return this.persistenceError(source.error)
    }

    const dto = this.assetDto(asset)
    if (input.kind === 'image' && !this.ownerSupportsImages(input.ownerParticipantId)) {
      dto.capabilityWarningZh = '当前角色所选模型未声明图片输入能力；图片已保存，但不会作为模型输入发送。'
    }
    return { ok: true, value: dto }
  }

  publishEvidence(input: PublishEvidenceInput): ResearchResultDto<{ evidenceId: string; publicCode: string }> {
    const repository = this.dependencies.persistence.repositories.research
    const asset = repository.findAssetById(input.assetId)
    if (!asset.ok) return this.persistenceError(asset.error)
    if (!asset.value || asset.value.debateSessionId !== input.sessionId) return this.notFound('研究资产不存在')
    const existing = repository.listEvidence(input.sessionId)
    if (!existing.ok) return this.persistenceError(existing.error)
    const already = existing.value.find((item) => item.assetId === input.assetId)
    if (already) return { ok: true, value: { evidenceId: already.id, publicCode: already.publicCode } }
    const participant = this.dependencies.persistence.repositories.participants.get(asset.value.ownerParticipantId)
    if (!participant.ok) return this.persistenceError(participant.error)
    if (!participant.value || participant.value.role === 'judge') return this.invalid('发布方无效', '只有正方、反方或主持人可以发布证据。')
    const role = participant.value.role
    const count = repository.countEvidenceByRole(input.sessionId, role)
    if (!count.ok) return this.persistenceError(count.error)
    const prefix = { affirmative: 'A', negative: 'B', moderator: 'M' }[role]
    const publicCode = `${prefix}-S${count.value + 1}`
    const id = this.createId()
    const createdAt = this.timestamp()
    const created = repository.createEvidence({
      id, debateSessionId: input.sessionId, publicCode,
      submittedByParticipantId: asset.value.ownerParticipantId, submitterRole: role,
      assetId: asset.value.id, title: asset.value.title, summary: asset.value.summary || asset.value.textContent,
      sourceUrl: asset.value.url, currentStatus: 'unverified', createdAt
    }, {
      id: this.createId(), debateSessionId: input.sessionId, evidenceId: id,
      toStatus: 'unverified', changedBy: input.changedBy, note: '证据首次发布。', createdAt
    })
    return created.ok ? { ok: true, value: { evidenceId: id, publicCode } } : this.persistenceError(created.error)
  }

  updateEvidenceStatus(input: UpdateEvidenceStatusInput): ResearchResultDto<boolean> {
    if (!(EVIDENCE_STATUSES as readonly string[]).includes(input.status)) return this.invalid('证据状态无效', '请选择受支持的证据状态。')
    const participant = this.dependencies.persistence.repositories.participants.get(input.changedBy)
    if (!participant.ok) return this.persistenceError(participant.error)
    if (!participant.value || participant.value.role !== 'moderator') {
      return this.invalid('只有主持人可以更新状态', '普通质疑请使用“提出质疑”，最终证据状态由主持人更新。')
    }
    return this.changeStatus(input.sessionId, input.evidenceId, input.status, input.changedBy, input.note)
  }

  challengeEvidence(input: ChallengeEvidenceInput): ResearchResultDto<boolean> {
    return this.changeStatus(input.sessionId, input.evidenceId, 'disputed', input.changedBy, input.note || '对该证据提出质疑。')
  }

  async runMockSearch(input: RunMockSearchInput): Promise<ResearchResultDto<number>> {
    const participant = this.dependencies.persistence.repositories.participants.get(input.ownerParticipantId)
    if (!participant.ok) return this.persistenceError(participant.error)
    if (!participant.value || participant.value.role === 'judge') return this.invalid('研究角色无效', '只有正方、反方或主持人可以执行研究搜索。')
    const role = participant.value.role
    const researchSession = this.ensureResearchSession(input.sessionId, input.ownerParticipantId, role)
    if (!researchSession.ok) return researchSession
    const visibility = this.privateVisibility(role)
    const searchSessionId = this.createId()
    const createdAt = this.timestamp()
    const repository = this.dependencies.persistence.repositories.research
    const started = repository.saveSearchSession({
      id: searchSessionId, debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
      ownerParticipantId: input.ownerParticipantId, visibility, toolName: this.searchTool.name,
      status: 'running', createdAt
    })
    if (!started.ok) return this.persistenceError(started.error)
    const query = repository.saveQuery({
      id: this.createId(), debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
      searchSessionId, ownerParticipantId: input.ownerParticipantId, visibility,
      query: input.query.trim(), createdAt
    })
    if (!query.ok) return this.persistenceError(query.error)
    try {
      const results = await this.searchTool.search({
        debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId: input.ownerParticipantId, visibility, query: input.query.trim(),
        signal: new AbortController().signal
      })
      for (const result of results) {
        const saved = repository.saveSource({
          id: this.createId(), debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
          searchSessionId, ownerParticipantId: input.ownerParticipantId, visibility,
          title: result.title, url: result.url, domain: result.domain, summary: result.summary,
          publishedAt: result.publishedAt, fetchedAt: result.fetchedAt, sourceType: 'mock-search', createdAt: this.timestamp()
        })
        if (!saved.ok) return this.persistenceError(saved.error)
      }
      repository.saveSearchSession({
        id: searchSessionId, debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId: input.ownerParticipantId, visibility, toolName: this.searchTool.name,
        status: 'completed', createdAt, completedAt: this.timestamp()
      })
      return { ok: true, value: results.length }
    } catch (cause) {
      repository.saveSearchSession({
        id: searchSessionId, debateSessionId: input.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId: input.ownerParticipantId, visibility, toolName: this.searchTool.name,
        status: 'failed', createdAt, completedAt: this.timestamp()
      })
      return this.invalid('Mock 搜索失败', cause instanceof Error ? cause.message : '未知搜索错误', true)
    }
  }

  private validateAssetInput(input: AddResearchAssetInput): ResearchResultDto<{ role: ResearchOwnerRole }> {
    if (!input.title.trim()) return this.invalid('资料标题不能为空', '请填写资料标题。')
    const session = this.dependencies.persistence.repositories.sessions.get(input.sessionId)
    if (!session.ok) return this.persistenceError(session.error)
    if (!session.value) return this.notFound('Session 不存在')
    const participant = this.dependencies.persistence.repositories.participants.get(input.ownerParticipantId)
    if (!participant.ok) return this.persistenceError(participant.error)
    if (!participant.value || participant.value.sessionId !== input.sessionId || participant.value.role === 'judge') {
      return this.invalid('资料所有者无效', '资料所有者必须是当前 Session 的正方、反方或主持人。')
    }
    const role = participant.value.role
    if (input.visibility !== 'public') {
      try {
        this.visibilityPolicy.assertOwnedPrivateRecord(input.visibility, input.ownerParticipantId)
        if (input.visibility !== this.visibilityPolicy.privateVisibilityFor(role)) {
          throw new Error('私有可见性必须与资料所有者角色一致。')
        }
      } catch (cause) {
        return this.invalid('私有资料可见性无效', cause instanceof Error ? cause.message : '所有者与可见性不匹配。')
      }
    }
    if (input.kind === 'text' && !input.textContent?.trim()) return this.invalid('文本内容不能为空', '请粘贴资料文本。')
    if (input.kind === 'url') {
      try { new URL(input.url || '') } catch { return this.invalid('URL 格式无效', '请填写完整的 http 或 https URL。') }
      if (!/^https?:/i.test(input.url || '')) return this.invalid('URL 格式无效', '只保存 http 或 https URL 元数据。')
    }
    if (input.kind === 'image') {
      if (!input.mimeType?.startsWith('image/') || !input.bytes?.length) return this.invalid('图片文件无效', '请选择有效图片文件。')
      if (input.bytes.length > 10 * 1024 * 1024) return this.invalid('图片过大', '图片大小不能超过 10 MB。')
    }
    return { ok: true, value: { role } }
  }

  private ensureResearchSession(
    debateSessionId: string,
    ownerParticipantId: string,
    role: ResearchOwnerRole
  ): ResearchResultDto<ResearchSession> {
    const repository = this.dependencies.persistence.repositories.research
    const existing = repository.findSessionByOwner(debateSessionId, role)
    if (!existing.ok) return this.persistenceError(existing.error)
    if (existing.value) return { ok: true, value: existing.value }
    const now = this.timestamp()
    const session: ResearchSession = {
      id: this.createId(), debateSessionId, ownerParticipantId, ownerRole: role,
      visibility: this.privateVisibility(role), status: 'researching', createdAt: now, updatedAt: now
    }
    const saved = repository.saveSession(session)
    return saved.ok ? { ok: true, value: session } : this.persistenceError(saved.error)
  }

  private changeStatus(
    sessionId: string,
    evidenceId: string,
    status: EvidenceStatus,
    changedBy: string,
    note: string
  ): ResearchResultDto<boolean> {
    const repository = this.dependencies.persistence.repositories.research
    const evidence = repository.findEvidenceById(evidenceId)
    if (!evidence.ok) return this.persistenceError(evidence.error)
    if (!evidence.value || evidence.value.debateSessionId !== sessionId) return this.notFound('公开证据不存在')
    const changed = repository.changeEvidenceStatus(evidenceId, status, {
      id: this.createId(), debateSessionId: sessionId, evidenceId,
      fromStatus: evidence.value.currentStatus, toStatus: status, changedBy,
      note: note.trim() || '未填写说明。', createdAt: this.timestamp()
    })
    return changed.ok ? { ok: true, value: changed.value } : this.persistenceError(changed.error)
  }

  private ownerSupportsImages(participantId: string): boolean {
    const participant = this.dependencies.persistence.repositories.participants.get(participantId)
    if (!participant.ok || !participant.value) return false
    const profile = this.dependencies.persistence.repositories.modelProfiles.findById(participant.value.modelProfileId)
    return profile.ok && Boolean(profile.value?.capabilities.imageInput)
  }

  private assetDto(asset: ResearchAsset): ResearchAssetDto {
    const { localPath, ...safe } = asset
    return { ...safe, hasLocalFile: Boolean(localPath) }
  }

  private privateVisibility(role: ResearchOwnerRole): PrivateResearchVisibility {
    return `${role}-private` as PrivateResearchVisibility
  }

  private extensionForMime(mimeType: string): string {
    return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' } as Record<string, string>)[mimeType] || '.img'
  }

  private persistenceError(error: PersistenceError): ResearchResultDto<never> {
    return { ok: false, error: { code: error.code, titleZh: '研究数据读写失败', descriptionZh: error.message, retryable: true } }
  }

  private invalid(titleZh: string, descriptionZh: string, retryable = false): ResearchResultDto<never> {
    return { ok: false, error: { code: 'INVALID_RESEARCH_INPUT', titleZh, descriptionZh, retryable } }
  }

  private notFound(titleZh: string): ResearchResultDto<never> {
    return { ok: false, error: { code: 'RESEARCH_NOT_FOUND', titleZh, descriptionZh: '目标研究记录不存在或不属于当前 Session。', retryable: false } }
  }

  private credentialError(descriptionZh: string, retryable: boolean): ResearchResultDto<never> {
    return { ok: false, error: { code: 'SEARCH_CREDENTIAL_ERROR', titleZh: '搜索凭据操作失败', descriptionZh, retryable } }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}
