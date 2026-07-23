import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownContent } from '../src/renderer/src/components/MarkdownContent'

const adjudication = `评分如下：

| 维度 | 分数 | 正方 | 分数 | 反方 |
| --- | ---: | --- | ---: | --- |
| 逻辑 | 7 | 论证连贯，但边界仍可更明确。 | 8 | **结构清晰**，回应了核心争点。 |
| 证据 | 7 | 有效引用公开资料。 | 8 | 引用了多项核心事实并说明局限。 |

综合评判：反方在结构与证据回应上略占优势。`

function elementCount(html: string, tagName: string): number {
  return html.match(new RegExp(`<${tagName}(?:\\s|>)`, 'g'))?.length ?? 0
}

describe('shared GFM Markdown renderer', () => {
  it('renders a standard five-column adjudication table with semantic sections', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={adjudication} />)

    expect(html).toContain('class="markdown-table-scroll"')
    expect(elementCount(html, 'table')).toBe(1)
    expect(elementCount(html, 'thead')).toBe(1)
    expect(elementCount(html, 'tbody')).toBe(1)
    expect(elementCount(html, 'tr')).toBe(3)
    expect(elementCount(html, 'th')).toBe(5)
    expect(elementCount(html, 'td')).toBe(10)
  })

  it('renders bold text inside a table cell without losing long Chinese content', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={adjudication} />)

    expect(html).toContain('<strong>结构清晰</strong>')
    expect(html).toContain('引用了多项核心事实并说明局限。')
  })

  it('keeps paragraphs before and after the table in their original order', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={adjudication} />)

    expect(html.indexOf('评分如下')).toBeLessThan(html.indexOf('<table>'))
    expect(html.indexOf('</table>')).toBeLessThan(html.indexOf('综合评判'))
  })

  it('does not mistake pipes inside a fenced code block for a table', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'```text\n| 维度 | 分数 |\n| --- | ---: |\n```'} />
    )

    expect(html).toContain('<pre>')
    expect(html).toContain('| 维度 | 分数 |')
    expect(html).not.toContain('<table>')
    expect(html).not.toContain('markdown-table-scroll')
  })

  it('keeps unsafe raw HTML inert while GFM is enabled', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'正常内容<script>alert("unsafe")</script>\n\n| 项目 | 结果 |\n| --- | --- |\n| 安全 | 是 |'} />
    )

    expect(html).toContain('<table>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror=')
  })

  it('supports GFM strikethrough, task lists and automatic links', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'~~旧结论~~\n\n- [x] 已核验\n- [ ] 待核验\n\nhttps://example.com/evidence'} />
    )

    expect(html).toContain('<del>旧结论</del>')
    expect(elementCount(html, 'input')).toBe(2)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('class="markdown-link"')
    expect(html).not.toContain('href=')
  })

  it('uses the same Markdown renderer for Electron history, live turns and LAN Web', () => {
    const markdownSource = readFileSync(join(process.cwd(), 'src/renderer/src/components/MarkdownContent.tsx'), 'utf8')
    const historySource = readFileSync(join(process.cwd(), 'src/renderer/src/pages/DebateHistoryPage.tsx'), 'utf8')
    const workbenchSource = readFileSync(join(process.cwd(), 'src/renderer/src/components/UnifiedWorkbench.tsx'), 'utf8')
    const lanSource = readFileSync(join(process.cwd(), 'src/lan-renderer/src/LanApp.tsx'), 'utf8')
    const lanEntry = readFileSync(join(process.cwd(), 'src/lan-renderer/src/main.tsx'), 'utf8')

    expect(markdownSource).toContain('remarkPlugins={[remarkGfm]}')
    expect(historySource).toContain('<MarkdownContent')
    expect(workbenchSource).toContain('<MarkdownContent')
    expect(lanSource).toContain('DebateTurnCard')
    expect(lanSource).toContain("from '../../renderer/src/components/UnifiedWorkbench'")
    expect(lanEntry).toContain("import '../../renderer/src/styles.css'")
  })

  it('contains an internal table scroller instead of allowing mobile page overflow', () => {
    const styles = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const scrollRule = styles.slice(styles.indexOf('.markdown-table-scroll {'), styles.indexOf('.markdown-table-scroll table {'))
    const tableRule = styles.slice(styles.indexOf('.markdown-table-scroll table {'), styles.indexOf('.markdown-table-scroll th,'))

    expect(scrollRule).toContain('width: 100%')
    expect(scrollRule).toContain('max-width: 100%')
    expect(scrollRule).toContain('overflow-x: auto')
    expect(tableRule).toContain('min-width: 640px')
  })
})
