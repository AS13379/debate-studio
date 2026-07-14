import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { WebContentExtractor, type ExtractedWebContent } from './web-content-extractor'

export type WebFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type HostResolver = (hostname: string) => Promise<string[]>

export interface WebPageFetcherOptions {
  fetchImplementation?: WebFetch
  resolveHost?: HostResolver
  extractor?: WebContentExtractor
  timeoutMs?: number
  maxDownloadBytes?: number
  maxRedirects?: number
}

export type WebPageFetchErrorCode =
  | 'UNSUPPORTED_PROTOCOL' | 'LOCAL_ADDRESS_BLOCKED' | 'WEB_TIMEOUT' | 'WEB_CANCELLED'
  | 'TOO_MANY_REDIRECTS' | 'INVALID_CONTENT_TYPE' | 'CONTENT_TOO_LARGE'
  | 'WEB_HTTP_ERROR' | 'WEB_INVALID_HTML'

export class WebPageFetchError extends Error {
  constructor(readonly code: WebPageFetchErrorCode, readonly titleZh: string, readonly descriptionZh: string, readonly retryable: boolean) {
    super(descriptionZh)
    this.name = 'WebPageFetchError'
  }
}

export interface FetchedWebPageContent extends ExtractedWebContent {
  url: string
  finalUrl: string
  contentType: string
  downloadedBytes: number
  fetchedAt: string
}

export class WebPageFetcher {
  private readonly fetchImplementation: WebFetch
  private readonly resolveHost: HostResolver
  private readonly extractor: WebContentExtractor
  private readonly timeoutMs: number
  private readonly maxDownloadBytes: number
  private readonly maxRedirects: number

  constructor(options: WebPageFetcherOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.resolveHost = options.resolveHost ?? (async (hostname) => (await lookup(hostname, { all: true })).map((item) => item.address))
    this.extractor = options.extractor ?? new WebContentExtractor()
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxDownloadBytes = options.maxDownloadBytes ?? 2 * 1024 * 1024
    this.maxRedirects = options.maxRedirects ?? 5
  }

  async fetch(url: string, signal: AbortSignal): Promise<FetchedWebPageContent> {
    const original = url
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
    const combined = AbortSignal.any([signal, timeout.signal])
    try {
      let current = await this.validate(url)
      for (let redirects = 0; ; redirects += 1) {
        if (combined.aborted) throw combined.reason ?? new DOMException('Aborted', 'AbortError')
        const response = await this.fetchImplementation(current, { method: 'GET', redirect: 'manual', signal: combined, headers: { accept: 'text/html,application/xhtml+xml' } })
        if (response.status >= 300 && response.status < 400) {
          if (redirects >= this.maxRedirects) throw new WebPageFetchError('TOO_MANY_REDIRECTS', '网页重定向过多', '网页重定向次数超过安全限制。', false)
          const location = response.headers.get('location')
          if (!location) throw new WebPageFetchError('WEB_HTTP_ERROR', '网页重定向无效', '服务器没有返回 Location。', true)
          current = await this.validate(new URL(location, current).toString())
          continue
        }
        if (!response.ok) throw new WebPageFetchError('WEB_HTTP_ERROR', '网页读取失败', `服务器返回 HTTP ${response.status}。`, response.status >= 500)
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
        if (!['text/html', 'application/xhtml+xml'].includes(contentType)) {
          throw new WebPageFetchError('INVALID_CONTENT_TYPE', '不支持的网页类型', `仅能读取 HTML，当前 Content-Type 为 ${contentType || '空'}。`, false)
        }
        const declared = Number(response.headers.get('content-length') ?? 0)
        if (declared > this.maxDownloadBytes) throw this.tooLarge()
        const bytes = await this.readLimited(response)
        let html: string
        try { html = new TextDecoder(this.charset(response.headers.get('content-type'))).decode(bytes) }
        catch { html = new TextDecoder('utf-8').decode(bytes) }
        try {
          return {
            ...this.extractor.extract(html, new URL(current).hostname), url: original, finalUrl: current,
            contentType, downloadedBytes: bytes.byteLength, fetchedAt: new Date().toISOString()
          }
        } catch (cause) {
          throw new WebPageFetchError('WEB_INVALID_HTML', '网页正文无法提取', cause instanceof Error ? cause.message : '无法解析 HTML。', false)
        }
      }
    } catch (cause) {
      if (cause instanceof WebPageFetchError) throw cause
      if (signal.aborted) throw new WebPageFetchError('WEB_CANCELLED', '网页读取已取消', '当前网页请求已取消。', true)
      if (timeout.signal.aborted) throw new WebPageFetchError('WEB_TIMEOUT', '网页读取超时', '页面在限定时间内没有完成下载。', true)
      throw new WebPageFetchError('WEB_HTTP_ERROR', '网页网络请求失败', cause instanceof Error ? cause.message : '未知网络错误。', true)
    } finally {
      clearTimeout(timer)
    }
  }

  private async validate(value: string): Promise<string> {
    let url: URL
    try { url = new URL(value) } catch { throw new WebPageFetchError('UNSUPPORTED_PROTOCOL', '网页 URL 无效', '请提供完整的 HTTP 或 HTTPS URL。', false) }
    if (!['http:', 'https:'].includes(url.protocol)) throw new WebPageFetchError('UNSUPPORTED_PROTOCOL', '不支持的 URL 协议', '仅允许 HTTP 和 HTTPS 网页。', false)
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw this.localBlocked()
    const addresses = isIP(hostname) ? [hostname] : await this.resolveHost(hostname)
    if (!addresses.length || addresses.some((address) => this.isPrivateAddress(address))) throw this.localBlocked()
    url.username = ''
    url.password = ''
    return url.toString()
  }

  private isPrivateAddress(address: string): boolean {
    if (address.includes(':')) {
      const normalized = address.toLowerCase()
      return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
    }
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some(Number.isNaN)) return true
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  }

  private async readLimited(response: Response): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array(await response.arrayBuffer())
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > this.maxDownloadBytes) { await reader.cancel(); throw this.tooLarge() }
      chunks.push(value)
    }
    const all = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength }
    return all
  }

  private charset(contentType: string | null): string {
    const charset = /charset=([^;\s]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase()
    if (!charset) return 'utf-8'
    if (charset === 'gbk' || charset === 'gb2312') return 'gb18030'
    return charset.replace(/["']/g, '')
  }

  private localBlocked(): WebPageFetchError {
    return new WebPageFetchError('LOCAL_ADDRESS_BLOCKED', '本地或局域网地址已拒绝', '为防止访问本机和内网资源，该地址不允许读取。', false)
  }

  private tooLarge(): WebPageFetchError {
    return new WebPageFetchError('CONTENT_TOO_LARGE', '网页下载过大', `页面大小超过 ${this.maxDownloadBytes} 字节的限制。`, false)
  }
}
