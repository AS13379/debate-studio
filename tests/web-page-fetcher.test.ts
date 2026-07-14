import { describe, expect, it } from 'vitest'

import { WebContentExtractor, WebPageFetcher } from '../src/research'

const publicResolver = async (): Promise<string[]> => ['203.0.113.10']

describe('WebPageFetcher and WebContentExtractor', () => {
  it('extracts title, author, date and article text while removing scripts and navigation', async () => {
    const html = `<!doctype html><html><head><title>测试报告</title><meta name="author" content="作者甲"><meta property="article:published_time" content="2026-07-01"></head><body><nav>导航噪声</nav><article><h1>主标题</h1><p>这是可读取的正文，用于测试网页提取能力。</p><script>SECRET</script></article></body></html>`
    const result = await new WebPageFetcher({
      resolveHost: publicResolver,
      fetchImplementation: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }).fetch('https://example.test/article', new AbortController().signal)
    expect(result).toMatchObject({ title: '测试报告', author: '作者甲', publishedAt: '2026-07-01' })
    expect(result.bodyText).toContain('可读取的正文')
    expect(result.bodyText).not.toContain('SECRET')
    expect(result.bodyText).not.toContain('导航噪声')
  })

  it.each(['file:///tmp/a', 'ftp://example.test/a', 'http://127.0.0.1/a', 'http://192.168.1.8/a', 'http://localhost/a'])(
    'rejects unsupported or local URL %s', async (url) => {
      const fetcher = new WebPageFetcher({ fetchImplementation: async () => { throw new Error('must not fetch') } })
      await expect(fetcher.fetch(url, new AbortController().signal)).rejects.toMatchObject({
        code: expect.stringMatching(/UNSUPPORTED_PROTOCOL|LOCAL_ADDRESS_BLOCKED/)
      })
    }
  )

  it('validates redirect targets and rejects too many redirects', async () => {
    const fetcher = new WebPageFetcher({
      resolveHost: publicResolver,
      maxRedirects: 1,
      fetchImplementation: async () => new Response(null, { status: 302, headers: { location: '/again' } })
    })
    await expect(fetcher.fetch('https://example.test/start', new AbortController().signal)).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
  })

  it('rejects oversized, non-HTML and invalid HTML content', async () => {
    const make = (response: Response) => new WebPageFetcher({ resolveHost: publicResolver, maxDownloadBytes: 20, fetchImplementation: async () => response })
    await expect(make(new Response('pdf', { headers: { 'content-type': 'application/pdf' } })).fetch('https://example.test/a', new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_CONTENT_TYPE' })
    await expect(make(new Response('x'.repeat(100), { headers: { 'content-type': 'text/html', 'content-length': '100' } })).fetch('https://example.test/a', new AbortController().signal)).rejects.toMatchObject({ code: 'CONTENT_TOO_LARGE' })
    expect(() => new WebContentExtractor().extract('<div>not a complete document</div>')).toThrowError(expect.objectContaining({ code: 'INVALID_HTML' }))
  })

  it('supports timeout and cancellation', async () => {
    const never = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    const fetcher = new WebPageFetcher({ resolveHost: publicResolver, timeoutMs: 5, fetchImplementation: never })
    await expect(fetcher.fetch('https://example.test/a', new AbortController().signal)).rejects.toMatchObject({ code: 'WEB_TIMEOUT' })
    const controller = new AbortController()
    const cancelled = new WebPageFetcher({ resolveHost: publicResolver, fetchImplementation: never }).fetch('https://example.test/a', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'WEB_CANCELLED' })
  })
})
