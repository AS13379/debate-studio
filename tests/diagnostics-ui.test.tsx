import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ErrorRecoveryPanel } from '../src/renderer/src/components/ErrorRecoveryPanel'
import { DiagnosticsPage } from '../src/renderer/src/pages/DiagnosticsPage'

describe('diagnostics UI', () => {
  it('renders a useful empty state and diagnostic controls', () => {
    const html = renderToStaticMarkup(<DiagnosticsPage />)
    expect(html).toContain('class="page-stack diagnostics-page"')
    expect(html).toContain('诊断与日志')
    expect(html).toContain('导出诊断报告')
    expect(html).toContain('清理错误')
    expect(html).toContain('清理日志')
  })

  it('shows a friendly model failure while keeping technical details collapsed', () => {
    const html = renderToStaticMarkup(<ErrorRecoveryPanel failure={{
      code: 'RATE_LIMITED', titleZh: '请求频率受限', descriptionZh: '请稍后重试。',
      retryable: true, technicalDetails: 'HTTP 429'
    }} />)
    expect(html).toContain('请求频率受限')
    expect(html).toContain('可重试')
    expect(html).toContain('查看详情')
    expect(html).toContain('<details>')
    expect(html).not.toContain('<details open="">')
  })
})
