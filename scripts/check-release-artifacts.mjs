import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateFormalSparkleBundle } from './validate-formal-sparkle-bundle.mjs'

const releaseDirectory = join(process.cwd(), 'release')
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const dmg = `Debate-Studio-${version}-arm64.dmg`
const blockmap = `${dmg}.blockmap`
const zip = `Debate-Studio-${version}-arm64.zip`
const zipBlockmap = `${zip}.blockmap`
const updateMetadata = 'latest-mac.yml'
const appPath = join(releaseDirectory, 'mac-arm64', 'Debate Studio.app')

if (!existsSync(join(releaseDirectory, dmg)) || !existsSync(join(releaseDirectory, blockmap)) || !existsSync(join(releaseDirectory, zip)) || !existsSync(join(releaseDirectory, zipBlockmap)) || !existsSync(join(releaseDirectory, updateMetadata)) || !existsSync(appPath)) {
  console.error('未找到 arm64 DMG、更新 ZIP、对应 blockmap、latest-mac.yml 或未打包的 .app 产物。')
  process.exit(1)
}
const bytes = statSync(join(releaseDirectory, dmg)).size
if (bytes < 1_000_000) {
  console.error('DMG 体积异常。')
  process.exit(1)
}
const metadata = readFileSync(join(releaseDirectory, updateMetadata), 'utf8')
if (!metadata.includes(`version: ${version}`) || !metadata.includes(dmg) || !metadata.includes(zip)) {
  console.error('latest-mac.yml 与当前版本、DMG 或更新 ZIP 文件名不匹配。')
  process.exit(1)
}
// afterPack already validates the signed bundle in a non-FileProvider staging
// directory. The ZIP extraction below is the release artifact's authoritative
// post-archive deep-signature gate.
const packaged = validateFormalSparkleBundle(appPath, version, false)
const packagedManifest = bundleManifest(appPath)
const extractedRoot = mkdtempSync(join(tmpdir(), 'debate-studio-sparkle-gate-'))
try {
  execFileSync('ditto', ['-x', '-k', join(releaseDirectory, zip), extractedRoot], { stdio: 'inherit' })
  const extractedApp = join(extractedRoot, 'Debate Studio.app')
  const extracted = validateFormalSparkleBundle(extractedApp, version)
  if (extracted.appAsarSize !== packaged.appAsarSize) {
    throw new Error('SPARKLE_ZIP_APP_ASAR_SIZE_MISMATCH')
  }
  const extractedManifest = bundleManifest(extractedApp)
  if (JSON.stringify(extractedManifest) !== JSON.stringify(packagedManifest)) {
    throw new Error('SPARKLE_ZIP_FILE_MANIFEST_MISMATCH')
  }
  console.log(JSON.stringify({
    dmg: join(releaseDirectory, dmg),
    zip: join(releaseDirectory, zip),
    appPath,
    bytes,
    packaged,
    extracted,
    bundleEntryCount: packagedManifest.length
  }, null, 2))
} finally {
  rmSync(extractedRoot, { recursive: true, force: true })
}

function bundleManifest(root) {
  const entries = []
  const pending = [{ absolute: root, relative: '' }]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const name of readdirSync(current.absolute).sort()) {
      const absolute = join(current.absolute, name)
      const relative = current.relative ? join(current.relative, name) : name
      const stats = lstatSync(absolute)
      if (stats.isDirectory()) {
        entries.push(`${relative}/`)
        pending.push({ absolute, relative })
      } else if (stats.isSymbolicLink()) {
        entries.push(`${relative} -> ${readlinkSync(absolute)}`)
      } else {
        entries.push(`${relative} (${stats.size})`)
      }
    }
  }
  return entries.sort()
}
