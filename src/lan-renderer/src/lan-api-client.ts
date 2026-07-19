import type {
  LanAuthSessionDto,
  LanDebateDetailDto,
  LanDebateListDto,
  LanEventEnvelopeDto,
  LanResultDto,
  LanRunCommand,
  LanSessionSnapshotDto
} from '../../shared/lan-dtos'

export class LanApiClient {
  private csrfToken = ''

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

  getSnapshot(sessionId: string, limit = 40): Promise<LanResultDto<LanSessionSnapshotDto>> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshot?limit=${limit}`)
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
