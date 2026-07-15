import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DebateExportPanel } from '../src/renderer/src/pages/DebateHistoryPage'
import type { DebateExportRecordDto } from '../src/shared/ipc-contract'

const callbacks = {
  onIncludePrivateResearchChange: () => undefined,
  onExport: () => undefined,
  onRequestDelete: () => undefined,
  onCancelDelete: () => undefined,
  onConfirmDelete: () => undefined
}

describe('debate export UI', () => {
  it('defaults private research off and presents both safe export formats', () => {
    const html = renderToStaticMarkup(<DebateExportPanel
      completed
      includePrivateResearch={false}
      records={[]}
      {...callbacks}
    />)
    expect(html).toContain('导出 Markdown')
    expect(html).toContain('导出 HTML')
    expect(html).toContain('包含私有研究')
    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('本文件会包含正反方')
  })

  it('shows an explicit warning and persisted export result when private research is selected', () => {
    const record: DebateExportRecordDto = {
      exportId: 'export-1', debateId: 'debate-1', debateTitle: '历史辩论', type: 'html',
      includePrivateResearch: true, filePath: '/safe/app-data/exports/history.html',
      createdAt: '2026-07-15T00:00:00.000Z', fileSize: 2_048, status: 'completed'
    }
    const html = renderToStaticMarkup(<DebateExportPanel
      completed
      includePrivateResearch
      records={[record]}
      message="导出完成"
      {...callbacks}
    />)
    expect(html).toContain('隐私提醒')
    expect(html).toContain('请确认接收者与分享范围')
    expect(html).toContain('包含私有研究')
    expect(html).toContain('/safe/app-data/exports/history.html')
    expect(html).toContain('2.0 KB')
  })

  it('keeps filesystem access out of Renderer source', () => {
    const pageSource = readFileSync('src/renderer/src/pages/DebateHistoryPage.tsx', 'utf8')
    const appSource = readFileSync('src/renderer/src/App.tsx', 'utf8')
    expect(`${pageSource}\n${appSource}`).not.toMatch(/node:fs|writeFileSync|readFileSync|unlinkSync|require\(['"]fs['"]\)/)
  })
})
