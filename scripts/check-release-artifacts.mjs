import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const releaseDirectory = join(process.cwd(), 'release')
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const dmg = `Debate-Studio-${version}-arm64.dmg`
const appPath = join(releaseDirectory, 'mac-arm64', 'Debate Studio.app')

if (!existsSync(join(releaseDirectory, dmg)) || !existsSync(appPath)) {
  console.error('未找到 arm64 DMG 或未打包的 .app 产物。')
  process.exit(1)
}
const bytes = statSync(join(releaseDirectory, dmg)).size
if (bytes < 1_000_000) {
  console.error('DMG 体积异常。')
  process.exit(1)
}
console.log(JSON.stringify({ dmg: join(releaseDirectory, dmg), appPath, bytes }, null, 2))
