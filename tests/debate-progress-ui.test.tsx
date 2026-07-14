import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DebateProgress, progressSegmentIndex } from '../src/renderer/src/components/DebateProgress'

describe('debate progress UI', () => {
  it('groups detailed stages into a compact segmented progress bar', () => {
    const html = renderToStaticMarkup(<DebateProgress stage="negative_research" />)

    expect(html).toContain('准备')
    expect(html).toContain('研究')
    expect(html).toContain('开篇')
    expect(html).toContain('交锋')
    expect(html).toContain('总结')
    expect(html).toContain('裁决')
    expect(html).toContain('当前：反方私有研究')
    expect(html).toContain('aria-current="step"')
    expect(progressSegmentIndex('negative_research')).toBe(1)
    expect(progressSegmentIndex('free_debate')).toBe(3)
  })

  it('marks every segment complete when the debate is completed', () => {
    const html = renderToStaticMarkup(<DebateProgress stage="completed" />)
    expect(html.match(/debate-progress-segment completed/g)).toHaveLength(6)
  })
})
