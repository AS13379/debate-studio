import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('renderer theme styles', () => {
  it('switches the sidebar together with the rest of the light and dark interface', () => {
    const styles = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const baseSidebar = styles.slice(styles.indexOf('.sidebar {'), styles.indexOf('.brand-mark'))

    expect(baseSidebar).toContain('background: linear-gradient(180deg, #fff, #f0f1f4)')
    expect(baseSidebar).toContain('border-right: 1px solid #dfe1e6')
    expect(styles).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.sidebar-nav-settings \{[^}]*border-left: 1px solid #dfe1e6/)
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?\.sidebar \{[^}]*linear-gradient\(180deg, #25272c, #18191d\)/)
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?\.sidebar nav button:hover, \.sidebar nav button\.active \{[^}]*color: #fff/)
    expect(styles).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?\.sidebar-nav-settings \{[^}]*border-left-color: rgba\(255,255,255,\.08\)/)
  })
})
