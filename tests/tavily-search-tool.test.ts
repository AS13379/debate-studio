import { describe, expect, it } from 'vitest'

import { MemoryCredentialStore } from '../src/security'
import { SearchToolError, TavilySearchTool, type SearchProviderConnection } from '../src/research'

const connection: SearchProviderConnection = {
  id: 'search-1', displayName: 'Tavily', providerType: 'tavily', baseUrl: 'https://api.tavily.test',
  credentialRef: 'search:tavily:search-1', enabled: true, isDefault: true,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z'
}

describe('TavilySearchTool', () => {
  it('maps the official search request and response without putting the credential in the body', async () => {
    const credentials = new MemoryCredentialStore()
    await credentials.setCredential(connection.credentialRef, 'tvly-secret-value')
    let captured: RequestInit | undefined
    const tool = new TavilySearchTool({
      connection,
      credentialStore: credentials,
      fetchImplementation: async (_url, init) => {
        captured = init
        return new Response(JSON.stringify({ results: [{
          title: '官方报告', url: 'https://example.test/report', content: '搜索摘要',
          score: 0.91, published_date: '2026-07-01'
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    const results = await tool.search({
      debateSessionId: 's', researchSessionId: 'r', ownerParticipantId: 'a', visibility: 'affirmative-private',
      query: '公共交通投入', maxResults: 3, searchDepth: 'advanced', timeRange: 'month',
      includeDomains: ['gov.example'], excludeDomains: ['spam.example'], signal: new AbortController().signal
    })
    expect(JSON.parse(String(captured?.body))).toEqual({
      query: '公共交通投入', max_results: 3, search_depth: 'advanced', time_range: 'month',
      include_domains: ['gov.example'], exclude_domains: ['spam.example']
    })
    expect(String(captured?.body)).not.toContain('tvly-secret-value')
    expect((captured?.headers as Record<string, string>).authorization).toBe('Bearer tvly-secret-value')
    expect(results).toEqual([expect.objectContaining({ title: '官方报告', domain: 'example.test', score: 0.91, publishedAt: '2026-07-01' })])
  })

  it('returns structured credential and HTTP errors with redacted text', async () => {
    const credentials = new MemoryCredentialStore()
    await expect(new TavilySearchTool({ connection, credentialStore: credentials }).search({
      debateSessionId: 's', researchSessionId: 'r', ownerParticipantId: 'a', visibility: 'affirmative-private',
      query: 'x', signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'SEARCH_CREDENTIAL_MISSING' })

    await credentials.setCredential(connection.credentialRef, 'tvly-secret-value')
    const failing = new TavilySearchTool({ connection, credentialStore: credentials, fetchImplementation: async () => new Response(
      JSON.stringify({ detail: 'invalid tvly-secret-value' }), { status: 401 }
    ) })
    const promise = failing.search({ debateSessionId: 's', researchSessionId: 'r', ownerParticipantId: 'a', visibility: 'affirmative-private', query: 'x', signal: new AbortController().signal })
    await expect(promise).rejects.toBeInstanceOf(SearchToolError)
    await expect(promise).rejects.toMatchObject({ code: 'SEARCH_UNAUTHORIZED', retryable: false })
    await expect(promise).rejects.not.toHaveProperty('message', expect.stringContaining('tvly-secret-value'))
  })
})
