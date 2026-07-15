import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { NewDebatePage, PlanReview } from '../src/renderer/src/pages/NewDebatePage'

describe('Debate Planner creation UI', () => {
  it('uses AI automatic planning as the recommended default and keeps other modes visible', () => {
    const html = renderToStaticMarkup(<NewDebatePage onBack={vi.fn()} onCreated={vi.fn()} onOpenModels={vi.fn()} />)
    expect(html).toContain('AI 自动规划')
    expect(html).toContain('AI 辅助完善')
    expect(html).toContain('完全手动')
    expect(html).toContain('生成辩论方案')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('正方初始立场')
  })

  it('renders every generated result as an explicitly editable field', () => {
    const noop = vi.fn()
    const html = renderToStaticMarkup(<PlanReview
      planned={{ mode: 'auto', plan: { topic: '辩题', background: '背景', affirmativePosition: '正方', negativePosition: '反方', keyQuestions: ['问题'], researchDirections: ['方向'], evidenceSuggestions: ['证据'] }, provenance: { promptVersion: 'v1', modelProfileId: 'p1', modelId: 'mock-planner', createdAt: '2026-07-16T00:00:00.000Z' } }}
      onEditingField={noop} background="背景" onBackground={noop} affirmative="正方" onAffirmative={noop}
      negative="反方" onNegative={noop} questions={['问题']} onQuestions={noop}
      research={['方向']} onResearch={noop} evidence={['证据']} onEvidence={noop}
    />)
    expect((html.match(/>编辑<\/button>/g) ?? [])).toHaveLength(6)
    expect(html).toContain('核心争议与潜在漏洞')
    expect(html).toContain('建议证据类型')
    expect(html).toContain('readOnly=""')
  })
})
