import type {
  LanAuthSessionDto,
  LanCreateDebateInputDto,
  LanDebateDetailDto,
  LanDebateInsightsDto,
  LanDebateListDto,
  LanEventEnvelopeDto,
  LanExportRecordDto,
  LanModelProfileDto,
  LanPlanDebateInputDto,
  LanResearchAssetDto,
  LanResearchWorkspaceDto,
  LanResultDto,
  LanRunCommand,
  LanSessionSnapshotDto
} from '../../shared/lan-dtos'

export class LanApiClient {
  private csrfToken = ''

  publicStatus(): Promise<LanResultDto<import('../../shared/lan-dtos').LanPublicStatusDto>> {
    return this.request('/api/v1/public/status')
  }

  async session(): Promise<LanResultDto<LanAuthSessionDto>> {
    const result = await this.request<LanAuthSessionDto>('/api/v1/auth/session')
    if (result.ok) this.csrfToken = result.value.csrfToken
    return result
  }

  async logout(): Promise<LanResultDto<boolean>> {
    const result = await this.write<boolean>('/api/v1/auth/logout', {})
    if (result.ok) this.csrfToken = ''
    return result
  }

  listDebates(search = '', offset = 0, limit = 20): Promise<LanResultDto<LanDebateListDto>> {
    const query = new URLSearchParams({ search, offset: String(offset), limit: String(limit), status: 'active', sort: 'updated-desc' })
    return this.request(`/api/v1/debates?${query}`)
  }

  getDebate(id: string): Promise<LanResultDto<LanDebateDetailDto>> {
    return this.request(`/api/v1/debates/${encodeURIComponent(id)}`)
  }

  listModelProfiles(): Promise<LanResultDto<LanModelProfileDto[]>> {
    return this.request('/api/v1/model-profiles')
  }

  planDebate(input: LanPlanDebateInputDto): Promise<LanResultDto<import('../../shared/debate-dtos').PlannedDebateDto>> {
    return this.write('/api/v1/planner', input)
  }

  createDebate(input: LanCreateDebateInputDto): Promise<LanResultDto<LanDebateDetailDto>> {
    return this.write('/api/v1/debates', input)
  }

  createMockDebate(): Promise<LanResultDto<LanDebateDetailDto>> {
    return this.write('/api/v1/debates/mock', {})
  }

  getResearch(sessionId: string): Promise<LanResultDto<LanResearchWorkspaceDto>> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/research`)
  }

  getInsights(debateId: string): Promise<LanResultDto<LanDebateInsightsDto>> {
    return this.request(`/api/v1/debates/${encodeURIComponent(debateId)}/insights`)
  }

  uploadAsset(input: {
    sessionId: string
    ownerParticipantId: string
    visibility: 'public' | 'affirmative-private' | 'negative-private' | 'moderator-private'
    title: string
    summary?: string
    file: File
  }): Promise<LanResultDto<LanResearchAssetDto>> {
    const query = new URLSearchParams({
      sessionId: input.sessionId,
      ownerParticipantId: input.ownerParticipantId,
      visibility: input.visibility,
      title: input.title,
      fileName: input.file.name
    })
    if (input.summary) query.set('summary', input.summary)
    return this.writeRaw(`/api/v1/assets?${query}`, input.file, input.file.type)
  }

  createExport(debateId: string, type: 'markdown' | 'html', includePrivateResearch = false): Promise<LanResultDto<LanExportRecordDto>> {
    return this.write(`/api/v1/debates/${encodeURIComponent(debateId)}/exports`, { type, includePrivateResearch })
  }

  listExports(debateId: string): Promise<LanResultDto<LanExportRecordDto[]>> {
    return this.request(`/api/v1/exports?debateId=${encodeURIComponent(debateId)}`)
  }

  exportDownloadUrl(exportId: string): string {
    return `/api/v1/exports/${encodeURIComponent(exportId)}/download`
  }

  getSnapshot(sessionId: string, limit = 40, before?: { createdAt: string; id: string }): Promise<LanResultDto<LanSessionSnapshotDto>> {
    const query = new URLSearchParams({ limit: String(limit) })
    if (before) {
      query.set('beforeCreatedAt', before.createdAt)
      query.set('beforeId', before.id)
    }
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshot?${query}`)
  }

  command(sessionId: string, command: LanRunCommand) {
    return this.write(`/api/v1/sessions/${encodeURIComponent(sessionId)}/commands`, { command })
  }

  connectEvents(sessionId: string, handlers: { onEvent(event: LanEventEnvelopeDto): void; onOnline(): void; onOffline(): void }): () => void {
    let stopped = false
    let socket: WebSocket | undefined
    let retry = 500
    let timer: number | undefined
    const connect = () => {
      if (stopped) return
      void this.session().then((session) => {
        if (stopped) return
        if (!session.ok) {
          handlers.onOffline()
          timer = window.setTimeout(connect, retry)
          retry = Math.min(retry * 2, 10_000)
          return
        }
        openSocket()
      })
    }
    const openSocket = () => {
      const url = new URL(`/api/v1/sessions/${encodeURIComponent(sessionId)}/events`, window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(url)
      socket.onopen = () => { retry = 500; handlers.onOnline() }
      socket.onmessage = (message) => {
        try {
          const value = JSON.parse(String(message.data)) as LanEventEnvelopeDto | { type: 'ready' }
          if ('event' in value) handlers.onEvent(value)
        } catch { /* malformed server messages are ignored */ }
      }
      socket.onclose = () => {
        handlers.onOffline()
        if (!stopped) { timer = window.setTimeout(connect, retry); retry = Math.min(retry * 2, 10_000) }
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => { stopped = true; if (timer) window.clearTimeout(timer); socket?.close() }
  }

  private write<T>(path: string, body: unknown): Promise<LanResultDto<T>> {
    const send = () => this.request<T>(path, { method: 'POST', headers: { 'X-CSRF-Token': this.csrfToken }, body: JSON.stringify(body) })
    return send().then(async (result) => {
      if (result.ok || result.error.code !== 'LAN_SESSION_REQUIRED') return result
      const session = await this.session()
      return session.ok ? send() : result
    })
  }

  private writeRaw<T>(path: string, body: BodyInit, contentType: string): Promise<LanResultDto<T>> {
    const send = () => this.request<T>(path, { method: 'POST', headers: { 'X-CSRF-Token': this.csrfToken, 'Content-Type': contentType }, body })
    return send().then(async (result) => {
      if (result.ok || result.error.code !== 'LAN_SESSION_REQUIRED') return result
      const session = await this.session()
      return session.ok ? send() : result
    })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<LanResultDto<T>> {
    try {
      const response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...init.headers }
      })
      return await response.json() as LanResultDto<T>
    } catch {
      return { ok: false, error: { code: 'LAN_OFFLINE', titleZh: '主机已离线', descriptionZh: '无法连接 Debate Studio，请确认 Mac 上的应用仍在运行。', retryable: true } }
    }
  }
}
