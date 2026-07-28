import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

describe('formal Sparkle mainline', () => {
  it('packages the pinned runtime, bridge and formal Sparkle plist values', () => {
    const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    expect(builder).toContain('native/sparkle/vendor/Sparkle.framework')
    expect(builder).toContain('native/sparkle/build/Release/sparkle_bridge.node')
    expect(builder).toContain('SUPublicEDKey: n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug=')
    expect(builder).toContain('SUFeedURL: https://github.com/AS13379/debate-studio/releases/latest/download/appcast.xml')
    expect(builder).toContain('afterPack: scripts/after-pack-sparkle.cjs')
  })

  it('uses the formal pinned Sparkle runtime for release signing', () => {
    const workflow = readFileSync(
      join(root, '.github/workflows/macos-arm64-release.yml'),
      'utf8'
    )
    const appcast = readFileSync(
      join(root, 'scripts/create-sparkle-appcast.mjs'),
      'utf8'
    )
    expect(workflow).toContain('zsh scripts/fetch-sparkle-runtime.sh')
    expect(workflow).not.toContain(
      'experiments/sparkle-update-test/scripts/fetch-sparkle.sh'
    )
    expect(appcast).toContain(
      'native/sparkle/vendor/bin/sign_update'
    )
  })

  it('uses Sparkle in the formal main process while retaining but not instantiating the DMG platform', () => {
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
    expect(main).toContain('new MacSparkleUpdatePlatform')
    expect(main).not.toContain('new MacDmgUpdatePlatform')
    expect(readFileSync(join(root, 'src/main/dmg-update-platform.ts'), 'utf8')).toContain('MacDmgUpdatePlatform')
  })

  it('allows ad-hoc Electron frameworks under the hardened runtime', () => {
    const mainEntitlements = readFileSync(
      join(root, 'build/entitlements.mac.plist'),
      'utf8'
    )
    const inheritedEntitlements = readFileSync(
      join(root, 'build/entitlements.mac.inherit.plist'),
      'utf8'
    )
    expect(mainEntitlements).toContain(
      'com.apple.security.cs.disable-library-validation'
    )
    expect(inheritedEntitlements).toContain(
      'com.apple.security.cs.disable-library-validation'
    )
  })

  it('hands the ready-to-install callback back to Sparkle', () => {
    const bridge = readFileSync(
      join(root, 'native/sparkle/src/sparkle_bridge.mm'),
      'utf8'
    )
    expect(bridge).toContain('readyToInstallReply')
    expect(bridge).toContain('reply(SPUUserUpdateChoiceInstall)')
    expect(bridge).not.toContain('self.status = @"cycle-finished"')
    expect(bridge).toContain('[self.status isEqualToString:@"not-found"]')
    expect(bridge).toContain('SUNoUpdateError')
    expect(bridge).toContain('SUInstallationCanceledError')
  })

  it('allows isolated formal upgrades to use a fresh non-skipped test version', () => {
    const smoke = readFileSync(
      join(root, 'scripts/prepare-formal-sparkle-smoke.mjs'),
      'utf8'
    )
    expect(smoke).toContain('DST_SPARKLE_SMOKE_VERSION')
    expect(smoke).toContain('smokeShortVersion')
  })
})
