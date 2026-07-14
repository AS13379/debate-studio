export interface ExtractedWebContent {
  title: string
  author?: string
  publishedAt?: string
  bodyText: string
  summary: string
  excerpt: string
}

export class WebContentExtractionError extends Error {
  constructor(readonly code: 'INVALID_HTML' | 'EMPTY_CONTENT', readonly titleZh: string, message: string) {
    super(message)
    this.name = 'WebContentExtractionError'
  }
}

export class WebContentExtractor {
  constructor(private readonly maxBodyCharacters = 120_000) {}

  extract(html: string, fallbackTitle = '未命名网页'): ExtractedWebContent {
    if (!/<(?:html|body|article|main)[\s>]/i.test(html)) {
      throw new WebContentExtractionError('INVALID_HTML', '网页 HTML 无法解析', '响应不包含可识别的 HTML 文档结构。')
    }
    const title = this.meta(html, 'property', 'og:title') ?? this.tag(html, 'title') ?? fallbackTitle
    const author = this.meta(html, 'name', 'author')
    const publishedAt = this.meta(html, 'property', 'article:published_time')
      ?? this.meta(html, 'name', 'date')
      ?? this.time(html)
    const section = this.firstSection(html, 'article') ?? this.firstSection(html, 'main') ?? this.firstSection(html, 'body') ?? html
    const cleaned = section
      .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|p|div|li|h[1-6]|section|blockquote|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
    const bodyText = this.decode(cleaned).replace(/[\t\r ]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (bodyText.length < 20) {
      throw new WebContentExtractionError('EMPTY_CONTENT', '网页正文为空', '页面中没有提取到足够的可读文本。')
    }
    const limited = bodyText.slice(0, this.maxBodyCharacters)
    return {
      title: this.decode(title).trim(), author: author ? this.decode(author).trim() : undefined,
      publishedAt, bodyText: limited, summary: this.summarize(limited, 1_200), excerpt: limited.slice(0, 3_000)
    }
  }

  private summarize(text: string, limit: number): string {
    if (text.length <= limit) return text
    const slice = text.slice(0, limit)
    const boundary = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
    return `${slice.slice(0, boundary > limit * 0.6 ? boundary + 1 : limit)}…`
  }

  private meta(html: string, key: 'name' | 'property', value: string): string | undefined {
    const pattern = new RegExp(`<meta[^>]*${key}=["']${this.escape(value)}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i')
    const reverse = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${key}=["']${this.escape(value)}["'][^>]*>`, 'i')
    return pattern.exec(html)?.[1] ?? reverse.exec(html)?.[1]
  }

  private tag(html: string, name: string): string | undefined {
    return new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(html)?.[1]?.replace(/<[^>]+>/g, ' ')
  }

  private time(html: string): string | undefined {
    return /<time[^>]*datetime=["']([^"']+)["']/i.exec(html)?.[1]
  }

  private firstSection(html: string, name: string): string | undefined {
    return new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(html)?.[1]
  }

  private decode(value: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_match, entity: string) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
      return named[entity.toLowerCase()] ?? `&${entity};`
    })
  }

  private escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
