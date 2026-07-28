import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { validateSparklePrivateKeyFile } from './sparkle-private-key.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readArguments(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('参数格式无效。需要 --archive、--version、--tag 和 --output。')
    }
    result.set(key.slice(2), value)
  }
  return result
}

function required(argumentsMap, name) {
  const value = argumentsMap.get(name)?.trim()
  if (!value) throw new Error(`缺少 --${name}。`)
  return value
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const argumentsMap = readArguments(process.argv.slice(2))
const archive = resolve(required(argumentsMap, 'archive'))
const version = required(argumentsMap, 'version')
const tag = required(argumentsMap, 'tag')
const output = resolve(required(argumentsMap, 'output'))
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Sparkle 版本格式无效：${version}`)
}
if (!existsSync(archive) || !statSync(archive).isFile() || statSync(archive).size === 0) {
  throw new Error(`更新 ZIP 不存在或为空：${archive}`)
}

const key = validateSparklePrivateKeyFile({ repositoryRoot })
const signUpdate = resolve(
  process.env.SPARKLE_SIGN_UPDATE_PATH
    ?? `${repositoryRoot}/native/sparkle/vendor/bin/sign_update`
)
if (!existsSync(signUpdate)) {
  throw new Error(`未找到 Sparkle sign_update：${signUpdate}`)
}

const signed = spawnSync(
  signUpdate,
  ['--ed-key-file', key.path, archive],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
)
if (signed.status !== 0) {
  const detail = signed.stderr.trim() || 'sign_update 未返回详细信息'
  throw new Error(`Sparkle ZIP 签名失败：${detail}`)
}

const signature = signed.stdout.match(/sparkle:edSignature="([^"]+)"/)?.[1]
const signedLength = Number(signed.stdout.match(/length="([0-9]+)"/)?.[1] ?? Number.NaN)
const actualLength = statSync(archive).size
if (!signature || !Number.isFinite(signedLength)) {
  throw new Error('sign_update 未返回有效的 EdDSA 签名和文件大小。')
}
if (signedLength !== actualLength) {
  throw new Error(`sign_update 文件大小不匹配：签名结果 ${signedLength}，实际 ${actualLength}。`)
}

const archiveName = basename(archive)
const encodedTag = encodeURIComponent(tag)
const encodedArchive = encodeURIComponent(archiveName)
const downloadUrl = `https://github.com/AS13379/debate-studio/releases/download/${encodedTag}/${encodedArchive}`
const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Debate Studio Updates</title>
    <link>https://github.com/AS13379/debate-studio/releases/latest/download/appcast.xml</link>
    <description>Debate Studio stable macOS updates.</description>
    <language>zh-CN</language>
    <item>
      <title>Debate Studio ${escapeXml(version)}</title>
      <sparkle:version>${escapeXml(version)}</sparkle:version>
      <sparkle:shortVersionString>${escapeXml(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure
        url="${escapeXml(downloadUrl)}"
        length="${actualLength}"
        type="application/octet-stream"
        sparkle:edSignature="${escapeXml(signature)}" />
    </item>
  </channel>
</rss>
`

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, appcast, { encoding: 'utf8', mode: 0o644 })
process.stdout.write(JSON.stringify({
  archive: archiveName,
  version,
  tag,
  bytes: actualLength,
  appcast: output,
  signed: true
}, null, 2))
process.stdout.write('\n')
