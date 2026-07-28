import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { validateSparklePrivateKeyFile } from './sparkle-private-key.mjs'
import { validateFormalSparkleBundle } from './validate-formal-sparkle-bundle.mjs'

const root = process.cwd()
const sourceApp = join(root, 'release', 'mac-arm64', 'Debate Studio.app')
const generatedRoot = resolve(
  process.env.DST_FORMAL_SPARKLE_SMOKE_ROOT
    ?? join(tmpdir(), 'debate-studio-formal-sparkle-smoke')
)
const installRoot = join(generatedRoot, 'installed')
const feedRoot = join(generatedRoot, 'feed')
const stagingRoot = join(generatedRoot, 'staging')
const installedApp = join(installRoot, 'Debate Studio.app')
const updateApp = join(stagingRoot, 'Debate Studio.app')
const smokeBundleVersion = process.env.DST_SPARKLE_SMOKE_VERSION ?? '0.6.4'
if (!/^\d+\.\d+\.\d+$/.test(smokeBundleVersion)) {
  throw new Error('DST_SPARKLE_SMOKE_VERSION must be a numeric three-part version')
}
const smokeShortVersion = `${smokeBundleVersion}-test`
const archive = join(
  feedRoot,
  `Debate-Studio-${smokeShortVersion}-arm64.zip`
)
const feedUrl = 'http://127.0.0.1:27892/appcast.xml'
const expectedPublicKey = 'n4G+b8A6touR/ytKrzrjEWXbaqhWcZpJMSt70eFa+ug='
const require = createRequire(import.meta.url)
const { signAsync } = require('@electron/osx-sign')
const privateKey = validateSparklePrivateKeyFile()

rmSync(generatedRoot, { recursive: true, force: true })
mkdirSync(installRoot, { recursive: true })
mkdirSync(feedRoot, { recursive: true })
mkdirSync(stagingRoot, { recursive: true })

copyBundle(sourceApp, installedApp)
copyBundle(sourceApp, updateApp)
await configureAndSign(installedApp, {
  shortVersion: '0.6.3',
  bundleVersion: '0.6.3'
})
await configureAndSign(updateApp, {
  shortVersion: smokeShortVersion,
  bundleVersion: smokeBundleVersion
})

execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', updateApp, archive], {
  stdio: 'inherit'
})

const signUpdate = join(root, 'native', 'sparkle', 'vendor', 'bin', 'sign_update')
const signatureOutput = execFileSync(
  signUpdate,
  ['--ed-key-file', privateKey.path, archive],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
)
const signature = signatureOutput.match(/sparkle:edSignature="([^"]+)"/)?.[1]
const signedLength = Number(signatureOutput.match(/length="([0-9]+)"/)?.[1])
const archiveSize = statSync(archive).size
if (!signature || signedLength !== archiveSize) {
  throw new Error('SPARKLE_SMOKE_SIGNATURE_FAILED')
}

const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Debate Studio formal Sparkle smoke feed</title>
    <link>${feedUrl}</link>
    <description>Isolated formal-brand Sparkle validation.</description>
    <language>zh-CN</language>
    <item>
      <title>Debate Studio ${smokeShortVersion}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[
        <h2>正式主线隔离升级演练</h2>
        <p>此更新仅使用临时数据目录，不读取正式 Debate Studio 用户数据。</p>
      ]]></description>
      <sparkle:version>${smokeBundleVersion}</sparkle:version>
      <sparkle:shortVersionString>${smokeShortVersion}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure
        url="http://127.0.0.1:27892/${basename(archive)}"
        length="${archiveSize}"
        type="application/octet-stream"
        sparkle:edSignature="${signature}" />
    </item>
  </channel>
</rss>
`
writeFileSync(join(feedRoot, 'appcast.xml'), appcast)

const output = {
  generatedRoot,
  installedApp,
  updateApp,
  archive,
  feedUrl,
  userData: join(generatedRoot, 'user-data'),
  installed: summarize(installedApp),
  update: summarize(updateApp),
  archiveSize,
  archiveSha256: sha256(archive)
}
writeFileSync(
  join(generatedRoot, 'smoke-result.json'),
  `${JSON.stringify(output, null, 2)}\n`
)
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)

function copyBundle(source, destination) {
  execFileSync(
    'ditto',
    ['--norsrc', '--noextattr', '--noqtn', source, destination],
    { stdio: 'inherit' }
  )
}

async function configureAndSign(appPath, versions) {
  const infoPlist = join(appPath, 'Contents', 'Info.plist')
  setPlist(infoPlist, 'CFBundleIdentifier', 'string', 'com.leander.debatestudio')
  setPlist(infoPlist, 'CFBundleName', 'string', 'Debate Studio')
  setPlist(infoPlist, 'CFBundleDisplayName', 'string', 'Debate Studio')
  setPlist(
    infoPlist,
    'CFBundleShortVersionString',
    'string',
    versions.shortVersion
  )
  setPlist(infoPlist, 'CFBundleVersion', 'string', versions.bundleVersion)
  setPlist(infoPlist, 'SUFeedURL', 'string', feedUrl)
  setPlist(infoPlist, 'SUPublicEDKey', 'string', expectedPublicKey)
  setPlist(infoPlist, 'SUEnableAutomaticChecks', 'bool', 'true')
  setPlist(infoPlist, 'SUEnableInstallerLauncherService', 'bool', 'false')
  setPlist(infoPlist, 'NSAppTransportSecurity', 'dict', '')
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true',
    infoPlist
  ])

  execFileSync('xattr', ['-cr', appPath])
  await signAsync({
    app: appPath,
    identity: '-',
    identityValidation: false,
    hardenedRuntime: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    timestamp: 'none',
    optionsForFile: () => ({
      entitlements: join(root, 'build', 'entitlements.mac.plist'),
      hardenedRuntime: true,
      timestamp: 'none'
    }),
    ignore: (file) => file.includes(`${sep}Sparkle.framework${sep}`)
  })
  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=4', appPath],
    { stdio: 'inherit' }
  )
}

function setPlist(plist, key, type, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], {
      stdio: 'ignore'
    })
  } catch {
    // A key may not exist in an Electron base bundle.
  }
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Add :${key} ${type} ${value}`, plist]
  )
}

function summarize(appPath) {
  const plist = join(appPath, 'Contents', 'Info.plist')
  const shortVersion = plistValue(plist, 'CFBundleShortVersionString')
  const bundleVersion = plistValue(plist, 'CFBundleVersion')
  const appAsar = join(appPath, 'Contents', 'Resources', 'app.asar')
  const validation = validateFormalSparkleBundle(
    appPath,
    shortVersion,
    true,
    {
      expectedBundleVersion: bundleVersion,
      expectedFeedUrl: feedUrl
    }
  )
  return {
    ...validation,
    appAsarSha256: sha256(appAsar)
  }
}

function plistValue(plist, key) {
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print :${key}`, plist],
    { encoding: 'utf8' }
  ).trim()
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
