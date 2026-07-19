import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LanApp } from '../src/lan-renderer/src/LanApp'
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage'

describe('LAN Web Console UI contracts', () => {
  it('adds a discoverable desktop settings tab without exposing a credential field globally', () => {
    const html = renderToStaticMarkup(<SettingsPage activeTab="providers" onTabChange={() => undefined} onOpenOnboarding={() => undefined} />)
    expect(html).toContain('局域网访问')
    expect(html).not.toContain('credentialRef')
    expect(html).not.toContain('apiKey')
  })

  it('renders a safe connection state before authentication is known', () => {
    const html = renderToStaticMarkup(<LanApp />)
    expect(html).toContain('正在连接 Debate Studio')
    expect(html).not.toContain('访问密码')
  })

  it('inherits the desktop workbench and only adds phone navigation below 768px', () => {
    const css = readFileSync(join(process.cwd(), 'src/lan-renderer/src/styles.css'), 'utf8')
    const source = readFileSync(join(process.cwd(), 'src/lan-renderer/src/LanApp.tsx'), 'utf8')
    expect(css).toContain('min-width: 0 !important')
    expect(css).toContain('@media (max-width: 768px)')
    expect(css).toContain('.workbench-bottom-nav')
    expect(css).toContain('.creation-mode-grid, .planner-options, .assisted-positions, .model-binding-grid, .lan-upload-form, .lan-plan-editor { grid-template-columns: 1fr; }')
    expect(css).toContain('min-height: 44px')
    expect(css).not.toContain('min-width: 680px')
    expect(css).not.toContain('.lan-nav')
    expect(source).toContain('WorkbenchShell')
    expect(source).toContain('CreationModeSelector')
    expect(source).toContain('RunControlBar')
  })
})
