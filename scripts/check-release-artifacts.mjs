import { createPublicKey, verify } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalManifestPayload, UPDATE_PUBLIC_KEY } from './community-update-format.mjs'

const releaseDirectory = join(process.cwd(), 'release')
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const dmg = `Debate-Studio-${version}-arm64.dmg`
const blockmap = `${dmg}.blockmap`
const zip = `Debate-Studio-${version}-arm64.zip`
const zipBlockmap = `${zip}.blockmap`
const updateMetadata = 'latest-mac.yml'
const appPath = join(releaseDirectory, 'mac-arm64', 'Debate Studio.app')
const communityArchive = `Debate-Studio-${version}-arm64.update.tar.gz`
const communityManifest = 'debate-studio-mac-arm64.json'

if (!existsSync(join(releaseDirectory, dmg)) || !existsSync(join(releaseDirectory, blockmap)) || !existsSync(join(releaseDirectory, zip)) || !existsSync(join(releaseDirectory, zipBlockmap)) || !existsSync(join(releaseDirectory, updateMetadata)) || !existsSync(appPath) || !existsSync(join(releaseDirectory, communityArchive)) || !existsSync(join(releaseDirectory, communityManifest))) {
  console.error('未找到 arm64 DMG、更新 ZIP、对应 blockmap、latest-mac.yml 或未打包的 .app 产物。')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(releaseDirectory, communityManifest), 'utf8'))
const { signature, ...unsigned } = manifest
if (manifest.version !== version || manifest.assetName !== communityArchive || !verify(null, canonicalManifestPayload(unsigned), createPublicKey(UPDATE_PUBLIC_KEY), Buffer.from(signature, 'base64'))) {
  console.error('社区更新 Manifest 的版本、文件名或项目签名无效。')
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
console.log(JSON.stringify({ dmg: join(releaseDirectory, dmg), blockmap: join(releaseDirectory, blockmap), zip: join(releaseDirectory, zip), zipBlockmap: join(releaseDirectory, zipBlockmap), updateMetadata: join(releaseDirectory, updateMetadata), appPath, bytes }, null, 2))
