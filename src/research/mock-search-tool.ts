import type { SearchRequest, SearchResult, SearchTool } from './types'

export interface MockSearchToolOptions {
  results?: SearchResult[]
  now?: () => Date
}

export class MockSearchTool implements SearchTool {
  readonly name = 'mock-search'
  readonly requests: Omit<SearchRequest, 'signal'>[] = []
  readonly networkRequestCount = 0

  private readonly results?: SearchResult[]
  private readonly now: () => Date

  constructor(options: MockSearchToolOptions = {}) {
    this.results = options.results
    this.now = options.now ?? (() => new Date())
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (request.signal.aborted) throw new DOMException('Mock search cancelled.', 'AbortError')
    this.requests.push({
      debateSessionId: request.debateSessionId,
      researchSessionId: request.researchSessionId,
      ownerParticipantId: request.ownerParticipantId,
      visibility: request.visibility,
      query: request.query
    })
    return (this.results ?? [{
      title: `Mock 资料：${request.query}`,
      url: `https://mock.search.local/result/${encodeURIComponent(request.query)}`,
      summary: '这是本地 MockSearchTool 返回的模拟摘要，不代表真实检索结果。',
      domain: 'mock.search.local',
      fetchedAt: this.now().toISOString()
    }]).map((result) => ({ ...result }))
  }
}
