import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { canonicalManifestPayload, UPDATE_KEY_ID } from './community-update-format.mjs'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const version = packageJson.version
const releaseDir = join(root, 'release')
const appParent = join(releaseDir, 'mac-arm64')
const appName = 'Debate Studio.app'
const assetName = `Debate-Studio-${version}-arm64.update.tar.gz`
const assetPath = join(releaseDir, assetName)
const manifestPath = join(releaseDir, 'debate-studio-mac-arm64.json')
const encodedKey = process.env.DEBATE_STUDIO_UPDATE_PRIVATE_KEY_BASE64
if (!encodedKey) throw new Error('缺少 DEBATE_STUDIO_UPDATE_PRIVATE_KEY_BASE64。')
const privateKey = createPrivateKey(Buffer.from(encodedKey, 'base64').toString('utf8'))
await createTar({ gzip: true, cwd: appParent, file: assetPath, portable: true, noMtime: true }, [appName])
const archive = await readFile(assetPath)
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const section = changelog.match(new RegExp(`## \\[${version.replaceAll('.', '\\.')}\\][\\s\\S]*?(?=\\n## \\[|$)`))?.[0] ?? `Debate Studio v${version}`
const releaseNotes = section.slice(0, 8_000)
const unsigned = {
  schemaVersion: 1, channel: 'stable', version, platform: 'darwin', arch: 'arm64', tag: `v${version}`,
  assetName, size: (await stat(assetPath)).size, sha256: createHash('sha256').update(archive).digest('hex'),
  releaseDate: new Date().toISOString(), releaseNotes,
  notesSha256: createHash('sha256').update(releaseNotes).digest('hex'),
  bundleId: 'com.leander.debatestudio', keyId: UPDATE_KEY_ID
}
const manifest = { ...unsigned, signature: sign(null, canonicalManifestPayload(unsigned), privateKey).toString('base64') }
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
console.log(JSON.stringify({ assetName, manifest: 'debate-studio-mac-arm64.json', bytes: manifest.size, sha256: manifest.sha256 }))
