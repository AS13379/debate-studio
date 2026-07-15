import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const releaseDirectory = join(process.cwd(), 'release')
const dmg = existsSync(releaseDirectory)
  ? readdirSync(releaseDirectory).find((name) => /^Debate-Studio-.*-arm64\.dmg$/.test(name))
  : undefined
const appPath = join(releaseDirectory, 'mac-arm64', 'Debate Studio.app')

if (!dmg || !existsSync(appPath)) {
  console.error('未找到 arm64 DMG 或未打包的 .app 产物。')
  process.exit(1)
}
const bytes = statSync(join(releaseDirectory, dmg)).size
if (bytes < 1_000_000) {
  console.error('DMG 体积异常。')
  process.exit(1)
}
console.log(JSON.stringify({ dmg: join(releaseDirectory, dmg), appPath, bytes }, null, 2))
