import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export const FORMAL_SPARKLE = Object.freeze({
  bundleId: 'com.leander.debatestudio',
  feedUrl: 'https://github.com/AS13379/debate-studio/releases/latest/download/appcast.xml',
  publicKey: 'n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug='
})

function plist(info, key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, info], {
    encoding: 'utf8'
  }).trim()
}

function checkSymlinks(root) {
  const canonicalRoot = realpathSync(root)
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const location = path.join(current, entry.name)
      if (lstatSync(location).isSymbolicLink()) {
        const target = realpathSync(location)
        if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${path.sep}`)) {
          throw new Error(`SPARKLE_SYMLINK_ESCAPE: ${location}`)
        }
      } else if (entry.isDirectory()) {
        pending.push(location)
      }
    }
  }
}

export function validateFormalSparkleBundle(
  appPath,
  expectedVersion,
  verifyCodeSignature = true,
  overrides = {}
) {
  const info = path.join(appPath, 'Contents', 'Info.plist')
  const asar = path.join(appPath, 'Contents', 'Resources', 'app.asar')
  const framework = path.join(appPath, 'Contents', 'Frameworks', 'Sparkle.framework')
  const bridge = path.join(appPath, 'Contents', 'Resources', 'sparkle_bridge.node')
  for (const required of [appPath, info, asar, framework, bridge]) {
    if (!existsSync(required)) throw new Error(`SPARKLE_BUNDLE_FILE_MISSING: ${required}`)
  }
  if (statSync(asar).size <= 0) throw new Error('SPARKLE_APP_ASAR_EMPTY')
  const actual = {
    bundleId: plist(info, 'CFBundleIdentifier'),
    shortVersion: plist(info, 'CFBundleShortVersionString'),
    bundleVersion: plist(info, 'CFBundleVersion'),
    publicKey: plist(info, 'SUPublicEDKey'),
    feedUrl: plist(info, 'SUFeedURL')
  }
  if (actual.bundleId !== FORMAL_SPARKLE.bundleId) throw new Error(`SPARKLE_BUNDLE_ID_MISMATCH: ${actual.bundleId}`)
  const expectedBundleVersion = overrides.expectedBundleVersion ?? expectedVersion
  if (actual.shortVersion !== expectedVersion || actual.bundleVersion !== expectedBundleVersion) {
    throw new Error(`SPARKLE_VERSION_MISMATCH: ${actual.shortVersion}/${actual.bundleVersion}`)
  }
  if (actual.publicKey !== FORMAL_SPARKLE.publicKey) throw new Error('SPARKLE_PUBLIC_KEY_MISMATCH')
  if (actual.feedUrl !== (overrides.expectedFeedUrl ?? FORMAL_SPARKLE.feedUrl)) {
    throw new Error('SPARKLE_FEED_URL_MISMATCH')
  }
  checkSymlinks(appPath)
  if (verifyCodeSignature) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    })
  }
  return { ...actual, appAsarSize: statSync(asar).size }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , appPath, version] = process.argv
  if (!appPath || !version) throw new Error('Usage: validate-formal-sparkle-bundle.mjs <app> <version>')
  console.log(JSON.stringify(validateFormalSparkleBundle(appPath, version), null, 2))
}
