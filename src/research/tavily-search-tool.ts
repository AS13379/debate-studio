import { redactSensitiveText } from '../security'
import type { SearchCredentialStore } from './search-credential-store'
import type { SearchProviderConnection, SearchRequest, SearchResult, SearchTool } from './types'

export type SearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface TavilySearchToolOptions {
  connection: SearchProviderConnection
  credentialStore: SearchCredentialStore
  fetchImplementation?: SearchFetch
  timeoutMs?: number
}

export type SearchToolErrorCode =
  | 'SEARCH_CONNECTION_DISABLED'
  | 'SEARCH_CREDENTIAL_MISSING'
  | 'SEARCH_CANCELLED'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_UNAUTHORIZED'
  | 'SEARCH_RATE_LIMITED'
  | 'SEARCH_HTTP_ERROR'
  | 'SEARCH_INVALID_RESPONSE'

export class SearchToolError extends Error {
  constructor(
    readonly code: SearchToolErrorCode,
    readonly titleZh: string,
    readonly descriptionZh: string,
    readonly retryable: boolean,
    readonly statusCode?: number
  ) {
    super(redactSensitiveText(descriptionZh))
    this.name = 'SearchToolError'
  }
}

export class TavilySearchTool implements SearchTool {
  readonly name = 'tavily'
  private readonly fetchImplementation: SearchFetch
  private readonly timeoutMs: number

  constructor(private readonly options: TavilySearchToolOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (!this.options.connection.enabled) {
      throw new SearchToolError('SEARCH_CONNECTION_DISABLED', '搜索连接已禁用', '当前 Tavily 搜索连接未启用。', false)
    }
    const credential = await this.options.credentialStore.getCredential(this.options.connection.credentialRef)
    if (!credential.ok) {
      throw new SearchToolError('SEARCH_CREDENTIAL_MISSING', '搜索凭据读取失败', credential.error.message, credential.error.retryable)
    }
    if (!credential.value) {
      throw new SearchToolError('SEARCH_CREDENTIAL_MISSING', '未配置搜索 API Key', '请先在“模型与平台”中为 Tavily 保存凭据。', false)
    }

    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout.signal])
    try {
      const response = await this.fetchImplementation(
        `${this.options.connection.baseUrl.replace(/\/+$/, '')}/search`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credential.value}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            query: request.query,
            max_results: Math.max(1, Math.min(request.maxResults ?? 5, 20)),
            search_depth: request.searchDepth ?? 'basic',
            ...(request.timeRange ? { time_range: request.timeRange } : {}),
            ...(request.includeDomains?.length ? { include_domains: request.includeDomains.slice(0, 20) } : {}),
            ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains.slice(0, 20) } : {})
          }),
          signal
        }
      )
      const data = await this.readJson(response)
      if (!response.ok) throw this.httpError(response.status, data, credential.value)
      if (!this.isRecord(data) || !Array.isArray(data.results)) {
        throw new SearchToolError('SEARCH_INVALID_RESPONSE', '搜索响应无法解析', 'Tavily 未返回预期的 results 数组。', true)
      }
      const fetchedAt = new Date().toISOString()
      return data.results.flatMap((item): SearchResult[] => {
        if (!this.isRecord(item) || typeof item.title !== 'string' || typeof item.url !== 'string' || typeof item.content !== 'string') return []
        let domain: string
        try { domain = new URL(item.url).hostname } catch { return [] }
        return [{
          title: item.title,
          url: item.url,
          summary: item.content,
          domain,
          publishedAt: typeof item.published_date === 'string' ? item.published_date : undefined,
          fetchedAt,
          score: typeof item.score === 'number' ? item.score : undefined
        }]
      })
    } catch (cause) {
      if (cause instanceof SearchToolError) throw cause
      if (request.signal.aborted) throw new SearchToolError('SEARCH_CANCELLED', '搜索已取消', '当前搜索请求已被用户取消。', true)
      if (timeout.signal.aborted) throw new SearchToolError('SEARCH_TIMEOUT', '搜索请求超时', 'Tavily 在限定时间内没有返回结果。', true)
      const description = cause instanceof Error ? cause.message : '未知网络错误。'
      throw new SearchToolError('SEARCH_HTTP_ERROR', '搜索网络请求失败', description, true)
    } finally {
      clearTimeout(timer)
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text.trim()) return undefined
    try { return JSON.parse(text) as unknown } catch {
      throw new SearchToolError('SEARCH_INVALID_RESPONSE', '搜索响应格式错误', 'Tavily 返回的内容不是有效 JSON。', true, response.status)
    }
  }

  private httpError(status: number, body: unknown, credential: string): SearchToolError {
    const rawDetail = this.isRecord(body) && typeof body.detail === 'string' ? body.detail : `HTTP ${status}`
    const detail = redactSensitiveText(rawDetail, [credential])
    if (status === 401) return new SearchToolError('SEARCH_UNAUTHORIZED', '搜索 API Key 无效', detail, false, status)
    if (status === 429 || status === 432) return new SearchToolError('SEARCH_RATE_LIMITED', '搜索频率或额度受限', detail, true, status)
    return new SearchToolError('SEARCH_HTTP_ERROR', '搜索服务返回错误', detail, status >= 500, status)
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}

export interface SearchConnectionTestResult {
  success: boolean
  latencyMs: number
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export class SearchConnectionTestService {
  async test(tool: SearchTool, signal = new AbortController().signal): Promise<SearchConnectionTestResult> {
    const startedAt = Date.now()
    try {
      await tool.search({
        debateSessionId: 'connection-test', researchSessionId: 'connection-test',
        ownerParticipantId: 'connection-test', visibility: 'moderator-private',
        query: 'Tavily', maxResults: 1, searchDepth: 'basic', signal
      })
      return { success: true, latencyMs: Date.now() - startedAt, titleZh: '搜索连接正常', descriptionZh: '已成功返回最小搜索结果。', retryable: false }
    } catch (cause) {
      const error = cause instanceof SearchToolError ? cause : new SearchToolError('SEARCH_HTTP_ERROR', '搜索连接失败', cause instanceof Error ? cause.message : '未知错误。', true)
      return { success: false, latencyMs: Date.now() - startedAt, titleZh: error.titleZh, descriptionZh: error.descriptionZh, retryable: error.retryable }
    }
  }
}
