import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPage } from '../src/renderer/src/pages/SettingsPage'

describe('settings page navigation', () => {
  it('groups management tools into accessible tabs', () => {
    const html = renderToStaticMarkup(<SettingsPage activeTab="onboarding" onTabChange={vi.fn()} onOpenOnboarding={vi.fn()} />)

    expect(html).toContain('>设置<')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('模型与平台')
    expect(html).toContain('模型策略')
    expect(html).toContain('成本统计')
    expect(html).toContain('诊断与日志')
    expect(html).toContain('首次引导')
    expect(html).toContain('aria-selected="true"')
  })
})
