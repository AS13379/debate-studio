import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { access, chmod, lstat, mkdir, open, readFile, readlink, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { x as extractTar, t as listTar } from 'tar'
import type { CommunityUpdateInfo, CommunityUpdateManifest } from '../shared/update-dtos'
import type { CommunityUpdatePlatform } from '../application/application-update-service'

const execFileAsync = promisify(execFile)
const OWNER = 'AS13379'
const REPO = 'debate-studio'
const BUNDLE_ID = 'com.leander.debatestudio'
const KEY_ID = 'ds-update-2026-01'
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAr0CR6ECKCKB0Yd/kRHenZODMOHOMUBoLaQL1t+Gv/ZE=
-----END PUBLIC KEY-----`
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_PACKAGE_BYTES = 300 * 1024 * 1024
const MANIFEST_NAME = 'debate-studio-mac-arm64.json'

export interface CommunityUpdatePlatformOptions {
  currentVersion: string
  cacheDirectory: string
  appPath: string
  quit(): void
  showItemInFolder(path: string): void
  openExternal(url: string): Promise<void>
  fetchImpl?: typeof fetch
}

export class MacCommunityUpdatePlatform implements CommunityUpdatePlatform {
  private readonly fetchImpl: typeof fetch
  private manifest?: CommunityUpdateManifest
  private stagedApp?: string

  constructor(private readonly options: CommunityUpdatePlatformOptions) { this.fetchImpl = options.fetchImpl ?? fetch }

  async check(): Promise<CommunityUpdateInfo | undefined> {
    const response = await this.fetchImpl(`https://github.com/${OWNER}/${REPO}/releases/latest/download/${MANIFEST_NAME}`, { redirect: 'follow', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`MANIFEST_HTTP_${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('MANIFEST_SIZE_INVALID')
    const manifest = parseAndVerifyManifest(JSON.parse(new TextDecoder().decode(bytes)), this.options.currentVersion)
    if (compareSemver(manifest.version, this.options.currentVersion) <= 0) return undefined
    this.manifest = manifest
    return { version: manifest.version, size: manifest.size, releaseName: `Debate Studio v${manifest.version}`, releaseNotes: manifest.releaseNotes, releaseDate: manifest.releaseDate, manifest }
  }

  async download(info: CommunityUpdateInfo, signal: AbortSignal, onProgress: (progress: { transferredBytes: number; totalBytes: number; bytesPerSecond: number }) => void): Promise<void> {
    const manifest = parseAndVerifyManifest(info.manifest, this.options.currentVersion)
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const partial = join(this.options.cacheDirectory, `${manifest.assetName}.partial`)
    const archive = join(this.options.cacheDirectory, manifest.assetName)
    await rm(partial, { force: true })
    const url = releaseAssetUrl(manifest)
    const response = await this.fetchImpl(url, { signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`PACKAGE_HTTP_${response.status}`)
    const announced = Number(response.headers.get('content-length') ?? manifest.size)
    if (announced > MAX_PACKAGE_BYTES || manifest.size > MAX_PACKAGE_BYTES) throw new Error('PACKAGE_SIZE_INVALID')
    const handle = await open(partial, 'wx', 0o600)
    const hash = createHash('sha256')
    let transferred = 0
    const started = Date.now()
    try {
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        transferred += next.value.byteLength
        if (transferred > MAX_PACKAGE_BYTES || transferred > manifest.size) throw new Error('PACKAGE_SIZE_INVALID')
        hash.update(next.value)
        await handle.write(next.value)
        onProgress({ transferredBytes: transferred, totalBytes: manifest.size, bytesPerSecond: transferred / Math.max(0.001, (Date.now() - started) / 1000) })
      }
    } catch (cause) {
      await handle.close(); await rm(partial, { force: true }); throw cause
    }
    await handle.close()
    if (transferred !== manifest.size) { await rm(partial, { force: true }); throw new Error('PACKAGE_SIZE_MISMATCH') }
    if (hash.digest('hex') !== manifest.sha256) { await rm(partial, { force: true }); throw new Error('PACKAGE_HASH_MISMATCH') }
    await rename(partial, archive)
    await this.extractAndVerify(archive, manifest)
    this.manifest = manifest
  }

  async prepareInstall(): Promise<void> {
    if (!this.manifest || !this.stagedApp) throw new Error('UPDATE_NOT_STAGED')
    if (!this.options.appPath.endsWith('.app') || this.options.appPath.includes('/Volumes/')) throw new Error('APP_ON_READ_ONLY_DMG')
    await access(dirname(this.options.appPath), constants.W_OK)
    await writeJsonAtomic(join(this.options.cacheDirectory, 'install-pending.json'), { version: this.manifest.version, appPath: this.options.appPath, stagedApp: this.stagedApp, startedAt: new Date().toISOString() })
  }

  async launchInstaller(): Promise<void> {
    if (!this.manifest || !this.stagedApp) throw new Error('UPDATE_NOT_STAGED')
    const script = join(this.options.cacheDirectory, 'install-update.sh')
    await writeFile(script, INSTALL_HELPER, { mode: 0o700 })
    await chmod(script, 0o700)
    const child = spawn('/bin/sh', [script, String(process.pid), this.options.appPath, this.stagedApp, this.options.cacheDirectory, this.manifest.version], { detached: true, stdio: 'ignore' })
    child.unref()
    setTimeout(() => this.options.quit(), 40)
  }

  async showDownloadedUpdateInFinder(): Promise<void> {
    if (!this.manifest) throw new Error('UPDATE_NOT_DOWNLOADED')
    this.options.showItemInFolder(join(this.options.cacheDirectory, this.manifest.assetName))
  }
  async openLatestRelease(): Promise<void> { await this.options.openExternal(`https://github.com/${OWNER}/${REPO}/releases/latest`) }
  async clearCache(): Promise<void> { await rm(this.options.cacheDirectory, { recursive: true, force: true }); this.manifest = undefined; this.stagedApp = undefined }
  async cacheSize(): Promise<number> { return directorySize(this.options.cacheDirectory) }

  async readStartupResult(): Promise<{ type: 'updated' | 'rolled-back' | 'interrupted'; version?: string; messageZh: string } | undefined> {
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const resultPath = join(this.options.cacheDirectory, 'install-result.json')
    const pendingPath = join(this.options.cacheDirectory, 'install-pending.json')
    const result = await readJson(resultPath)
    if (result?.status === 'rolled-back') {
      await rm(resultPath, { force: true })
      return { type: 'rolled-back', version: result.version, messageZh: String(result.messageZh ?? '新版本未能启动，已恢复旧版本。') }
    }
    const pending = await readJson(pendingPath)
    if (pending && pending.version === this.options.currentVersion) {
      await writeJsonAtomic(join(this.options.cacheDirectory, 'launch-confirmed.json'), { version: this.options.currentVersion, confirmedAt: new Date().toISOString() })
      await rm(pendingPath, { force: true })
      return { type: 'updated', version: this.options.currentVersion, messageZh: `已安全更新到 v${this.options.currentVersion}。` }
    }
    if (pending && Date.now() - Date.parse(String(pending.startedAt)) > 10 * 60_000) return { type: 'interrupted', version: pending.version, messageZh: '上次更新在安装过程中中断，旧版本仍可使用。' }
    return undefined
  }

  private async extractAndVerify(archive: string, manifest: CommunityUpdateManifest): Promise<void> {
    const staging = join(this.options.cacheDirectory, `staging-${manifest.version}`)
    await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true })
    await validateTarEntries(archive)
    await extractTar({ file: archive, cwd: staging, strict: true, preservePaths: false })
    const app = join(staging, 'Debate Studio.app')
    const appStat = await stat(app)
    if (!appStat.isDirectory()) throw new Error('APP_BUNDLE_MISSING')
    await validateExtractedTree(app)
    const { stdout: bundleId } = await execFileAsync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents', 'Info.plist')])
    const { stdout: version } = await execFileAsync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents', 'Info.plist')])
    if (bundleId.trim() !== BUNDLE_ID) throw new Error('BUNDLE_ID_INVALID')
    if (version.trim() !== manifest.version) throw new Error('BUNDLE_VERSION_INVALID')
    this.stagedApp = app
  }
}

export function canonicalManifestPayload(manifest: Omit<CommunityUpdateManifest, 'signature'>): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: manifest.schemaVersion, channel: manifest.channel, version: manifest.version, platform: manifest.platform, arch: manifest.arch, tag: manifest.tag, assetName: manifest.assetName, size: manifest.size, sha256: manifest.sha256, releaseDate: manifest.releaseDate, releaseNotes: manifest.releaseNotes ?? '', notesSha256: manifest.notesSha256, bundleId: manifest.bundleId, keyId: manifest.keyId }), 'utf8')
}

export function parseAndVerifyManifest(input: unknown, currentVersion: string, publicKeyPem = PUBLIC_KEY): CommunityUpdateManifest {
  if (!input || typeof input !== 'object') throw new Error('MANIFEST_INVALID')
  const m = input as CommunityUpdateManifest
  if (m.schemaVersion !== 1 || m.channel !== 'stable' || m.platform !== 'darwin' || m.arch !== 'arm64' || m.bundleId !== BUNDLE_ID || m.keyId !== KEY_ID) throw new Error('MANIFEST_PLATFORM_INVALID')
  if (!/^\d+\.\d+\.\d+$/.test(m.version) || m.tag !== `v${m.version}` || m.assetName !== `Debate-Studio-${m.version}-arm64.update.tar.gz`) throw new Error('MANIFEST_VERSION_INVALID')
  if (!Number.isSafeInteger(m.size) || m.size <= 0 || m.size > MAX_PACKAGE_BYTES || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('MANIFEST_SIZE_INVALID')
  const notes = m.releaseNotes ?? ''
  if (createHash('sha256').update(notes).digest('hex') !== m.notesSha256) throw new Error('MANIFEST_NOTES_HASH_INVALID')
  const { signature, ...unsigned } = m
  if (!signature || !verifySignature(null, canonicalManifestPayload(unsigned), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))) throw new Error('MANIFEST_SIGNATURE_INVALID')
  if (compareSemver(m.version, currentVersion) < 0) throw new Error('MANIFEST_DOWNGRADE_REJECTED')
  return m
}

export function compareSemver(a: string, b: string): number { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] - bb[i] } return 0 }
function releaseAssetUrl(m: CommunityUpdateManifest): string { return `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(m.tag)}/${encodeURIComponent(m.assetName)}` }
async function validateTarEntries(archive: string): Promise<void> { await listTar({ file: archive, onentry: (entry) => { const path = entry.path.replace(/\\/g, '/'); if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('ARCHIVE_PATH_INVALID') } }) }
async function validateExtractedTree(root: string): Promise<void> { const walk = async (dir: string): Promise<void> => { for (const name of await readdir(dir)) { const path = join(dir, name); const info = await lstat(path); if (info.isSymbolicLink()) { const real = resolve(dirname(path), await readlink(path)); if (relative(root, real).startsWith(`..${sep}`) || relative(root, real) === '..') throw new Error('ARCHIVE_SYMLINK_INVALID') } else if (info.isDirectory()) await walk(path) } }; await walk(root) }
async function directorySize(path: string): Promise<number> { try { let total = 0; for (const name of await readdir(path)) { const item = join(path, name); const info = await lstat(item); total += info.isDirectory() ? await directorySize(item) : info.size } return total } catch { return 0 } }
async function readJson(path: string): Promise<Record<string, any> | undefined> { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined } }
async function writeJsonAtomic(path: string, value: unknown): Promise<void> { const temp = `${path}.partial`; await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path) }

const INSTALL_HELPER = `#!/bin/sh
set -u
PARENT_PID="$1"; APP_PATH="$2"; STAGED_APP="$3"; CACHE_DIR="$4"; VERSION="$5"
BACKUP_PATH="$APP_PATH.community-update-backup"
RESULT="$4/install-result.json"; CONFIRMED="$4/launch-confirmed.json"
i=0
while kill -0 "$PARENT_PID" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.25; i=$((i+1)); done
rollback() {
  rm -rf "$APP_PATH" 2>/dev/null || true
  if [ -d "$BACKUP_PATH" ]; then mv "$BACKUP_PATH" "$APP_PATH" 2>/dev/null || true; /usr/bin/open "$APP_PATH" >/dev/null 2>&1 || true; fi
  printf '{"status":"rolled-back","version":"%s","messageZh":"新版本未能成功启动，已自动恢复旧版本。"}' "$VERSION" > "$RESULT"
}
rm -rf "$BACKUP_PATH" "$CONFIRMED" 2>/dev/null || true
mv "$APP_PATH" "$BACKUP_PATH" || { printf '{"status":"rolled-back","version":"%s","messageZh":"无法备份当前应用，安装未执行。"}' "$VERSION" > "$RESULT"; exit 1; }
mv "$STAGED_APP" "$APP_PATH" || { rollback; exit 1; }
/usr/bin/open "$APP_PATH" >/dev/null 2>&1 || { rollback; exit 1; }
i=0
while [ ! -f "$CONFIRMED" ] && [ "$i" -lt 80 ]; do sleep 0.25; i=$((i+1)); done
if [ -f "$CONFIRMED" ]; then rm -rf "$BACKUP_PATH" "$CACHE_DIR"/* 2>/dev/null || true; exit 0; fi
rollback
exit 1
`

export function resolveRunningAppPath(execPath: string): string { const marker = '.app/Contents/MacOS/'; const index = execPath.indexOf(marker); return index < 0 ? '' : execPath.slice(0, index + 4) }
