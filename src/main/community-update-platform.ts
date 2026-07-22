import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { access, chmod, lstat, mkdir, open, readFile, readlink, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
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
  private confirmedStartupVersion?: string

  constructor(private readonly options: CommunityUpdatePlatformOptions) { this.fetchImpl = options.fetchImpl ?? fetch }

  async check(): Promise<CommunityUpdateInfo | undefined> {
    const response = await this.fetchImpl(`https://github.com/${OWNER}/${REPO}/releases/latest/download/${MANIFEST_NAME}`, { redirect: 'follow', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`MANIFEST_HTTP_${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('MANIFEST_SIZE_INVALID')
    const manifest = parseAndVerifyManifest(JSON.parse(new TextDecoder().decode(bytes)), this.options.currentVersion, PUBLIC_KEY, { allowOlder: true })
    this.manifest = manifest
    if (compareSemver(manifest.version, this.options.currentVersion) <= 0) return undefined
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
    await rm(archive, { force: true })
    await rename(partial, archive)
    this.manifest = manifest
    await this.extractAndVerify(archive, manifest)
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
    const launcher = join(this.options.cacheDirectory, 'install-update.command')
    await writeFile(script, createInstallHelperScript(), { mode: 0o700 })
    await chmod(script, 0o700)
    await writeFile(launcher, createInstallTerminalLauncherScript({
      helperPath: script,
      parentPid: process.pid,
      appPath: this.options.appPath,
      stagedApp: this.stagedApp,
      cacheDirectory: this.options.cacheDirectory,
      version: this.manifest.version
    }), { mode: 0o700 })
    await chmod(launcher, 0o700)
    // Opening a local .command file avoids silently installing in a detached
    // background process. Terminal becomes the visible, self-contained update
    // console and keeps failures on screen for diagnosis.
    await execFileAsync('/usr/bin/open', ['-a', 'Terminal', launcher])
    setTimeout(() => this.options.quit(), 300)
  }

  async showDownloadedUpdateInFinder(): Promise<void> {
    const path = this.manifest
      ? join(this.options.cacheDirectory, this.manifest.assetName)
      : await newestCachedUpdateArchive(this.options.cacheDirectory)
    if (!path) throw new Error('UPDATE_NOT_DOWNLOADED')
    this.options.showItemInFolder(path)
  }
  async openLatestRelease(): Promise<void> { await this.options.openExternal(`https://github.com/${OWNER}/${REPO}/releases/latest`) }
  async clearCache(): Promise<void> { await rm(this.options.cacheDirectory, { recursive: true, force: true }); this.manifest = undefined; this.stagedApp = undefined }
  async cacheSize(): Promise<number> { return directorySize(this.options.cacheDirectory) }

  async confirmPendingStartup(): Promise<boolean> {
    const pending = await readJson(join(this.options.cacheDirectory, 'install-pending.json'))
    if (!pending || pending.version !== this.options.currentVersion) return false
    this.confirmedStartupVersion = this.options.currentVersion
    await writeJsonAtomic(join(this.options.cacheDirectory, 'launch-confirmed.json'), {
      version: this.options.currentVersion,
      confirmedAt: new Date().toISOString(),
      phase: 'electron-ready'
    })
    return true
  }

  async readStartupResult(): Promise<{ type: 'updated' | 'rolled-back' | 'interrupted'; version?: string; messageZh: string } | undefined> {
    await mkdir(this.options.cacheDirectory, { recursive: true })
    if (this.confirmedStartupVersion) {
      const version = this.confirmedStartupVersion
      this.confirmedStartupVersion = undefined
      return { type: 'updated', version, messageZh: `已安全更新到 v${version}。` }
    }
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
    await updateVerificationStep('ARCHIVE_LIST_FAILED', () => validateTarEntries(archive))
    // The archive is already project-signed and hash-verified. Electron's bundled
    // runtime can report harmless framework-symlink warnings as fatal in strict
    // mode, so extraction is followed by our own path, symlink and bundle checks.
    await updateVerificationStep('ARCHIVE_EXTRACT_FAILED', () => extractTar({ file: archive, cwd: staging, strict: false, preservePaths: false }))
    const app = join(staging, 'Debate Studio.app')
    const appStat = await updateVerificationStep('APP_BUNDLE_MISSING', () => stat(app))
    if (!appStat.isDirectory()) throw new Error('APP_BUNDLE_MISSING')
    await updateVerificationStep('ARCHIVE_TREE_VALIDATION_FAILED', () => validateExtractedTree(app))
    const { stdout: bundleId } = await updateVerificationStep('PLIST_BUNDLE_ID_READ_FAILED', () => execFileAsync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents', 'Info.plist')]))
    const { stdout: version } = await updateVerificationStep('PLIST_VERSION_READ_FAILED', () => execFileAsync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents', 'Info.plist')]))
    if (bundleId.trim() !== BUNDLE_ID) throw new Error('BUNDLE_ID_INVALID')
    if (version.trim() !== manifest.version) throw new Error('BUNDLE_VERSION_INVALID')
    this.stagedApp = app
  }
}

async function updateVerificationStep<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (cause) {
    const detail = cause instanceof Error ? cause.message.match(/[A-Z][A-Z0-9_]{2,80}/)?.[0] : undefined
    throw new Error(detail ? `${code}_${detail}` : code)
  }
}

export function canonicalManifestPayload(manifest: Omit<CommunityUpdateManifest, 'signature'>): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: manifest.schemaVersion, channel: manifest.channel, version: manifest.version, platform: manifest.platform, arch: manifest.arch, tag: manifest.tag, assetName: manifest.assetName, size: manifest.size, sha256: manifest.sha256, releaseDate: manifest.releaseDate, releaseNotes: manifest.releaseNotes ?? '', notesSha256: manifest.notesSha256, bundleId: manifest.bundleId, keyId: manifest.keyId }), 'utf8')
}

export function parseAndVerifyManifest(input: unknown, currentVersion: string, publicKeyPem = PUBLIC_KEY, options: { allowOlder?: boolean } = {}): CommunityUpdateManifest {
  if (!input || typeof input !== 'object') throw new Error('MANIFEST_INVALID')
  const m = input as CommunityUpdateManifest
  if (m.schemaVersion !== 1 || m.channel !== 'stable' || m.platform !== 'darwin' || m.arch !== 'arm64' || m.bundleId !== BUNDLE_ID || m.keyId !== KEY_ID) throw new Error('MANIFEST_PLATFORM_INVALID')
  if (!/^\d+\.\d+\.\d+$/.test(m.version) || m.tag !== `v${m.version}` || m.assetName !== `Debate-Studio-${m.version}-arm64.update.tar.gz`) throw new Error('MANIFEST_VERSION_INVALID')
  if (!Number.isSafeInteger(m.size) || m.size <= 0 || m.size > MAX_PACKAGE_BYTES || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('MANIFEST_SIZE_INVALID')
  const notes = m.releaseNotes ?? ''
  if (createHash('sha256').update(notes).digest('hex') !== m.notesSha256) throw new Error('MANIFEST_NOTES_HASH_INVALID')
  const { signature, ...unsigned } = m
  if (!signature || !verifySignature(null, canonicalManifestPayload(unsigned), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))) throw new Error('MANIFEST_SIGNATURE_INVALID')
  if (!options.allowOlder && compareSemver(m.version, currentVersion) < 0) throw new Error('MANIFEST_DOWNGRADE_REJECTED')
  return m
}

export function compareSemver(a: string, b: string): number { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] - bb[i] } return 0 }
function releaseAssetUrl(m: CommunityUpdateManifest): string { return `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(m.tag)}/${encodeURIComponent(m.assetName)}` }
async function validateTarEntries(archive: string): Promise<void> { await listTar({ file: archive, onentry: (entry) => { const path = entry.path.replace(/\\/g, '/'); if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('ARCHIVE_PATH_INVALID') } }) }
async function validateExtractedTree(root: string): Promise<void> { const walk = async (dir: string): Promise<void> => { for (const name of await readdir(dir)) { const path = join(dir, name); const info = await lstat(path); if (info.isSymbolicLink()) { const real = resolve(dirname(path), await readlink(path)); if (relative(root, real).startsWith(`..${sep}`) || relative(root, real) === '..') throw new Error('ARCHIVE_SYMLINK_INVALID') } else if (info.isDirectory()) await walk(path) } }; await walk(root) }
async function directorySize(path: string): Promise<number> { try { let total = 0; for (const name of await readdir(path)) { const item = join(path, name); const info = await lstat(item); total += info.isDirectory() ? await directorySize(item) : info.size } return total } catch { return 0 } }
async function newestCachedUpdateArchive(directory: string): Promise<string | undefined> {
  try {
    const candidates = (await readdir(directory)).filter((name) => /^Debate-Studio-\d+\.\d+\.\d+-arm64\.update\.tar\.gz$/.test(name))
    const dated = await Promise.all(candidates.map(async (name) => ({ path: join(directory, name), modified: (await stat(join(directory, name))).mtimeMs })))
    return dated.sort((a, b) => b.modified - a.modified)[0]?.path
  } catch { return undefined }
}
async function readJson(path: string): Promise<Record<string, any> | undefined> { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined } }
async function writeJsonAtomic(path: string, value: unknown): Promise<void> { const temp = `${path}.partial`; await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path) }

export interface InstallHelperScriptOptions {
  openCommand?: string
  xattrCommand?: string
  privilegedXattrCommand?: string
  sleepCommand?: string
  sleepSeconds?: number
  parentWaitIterations?: number
  confirmationWaitIterations?: number
  launchWaitIterations?: number
  settleSeconds?: number
  languageSelectionSeconds?: number
  successCloseSeconds?: number
}

export function createInstallHelperScript(options: InstallHelperScriptOptions = {}): string {
  const openCommand = shellLiteral(options.openCommand ?? '/usr/bin/open')
  const xattrCommand = shellLiteral(options.xattrCommand ?? '/usr/bin/xattr')
  const privilegedXattrCommand = options.privilegedXattrCommand ? shellLiteral(options.privilegedXattrCommand) : "''"
  const sleepCommand = shellLiteral(options.sleepCommand ?? '/bin/sleep')
  const sleepSeconds = positiveNumber(options.sleepSeconds, 0.25)
  const parentWaitIterations = positiveInteger(options.parentWaitIterations, 240)
  const confirmationWaitIterations = positiveInteger(options.confirmationWaitIterations, 120)
  const launchWaitIterations = positiveInteger(options.launchWaitIterations, 40)
  const settleSeconds = positiveNumber(options.settleSeconds, 2)
  const languageSelectionSeconds = positiveNumber(options.languageSelectionSeconds, 4)
  const successCloseSeconds = positiveNumber(options.successCloseSeconds, 3)
  return `#!/bin/zsh
set -u
unsetopt BG_NICE 2>/dev/null || true
PARENT_PID="$1"; APP_PATH="$2"; STAGED_APP="$3"; CACHE_DIR="$4"; VERSION="$5"
BACKUP_PATH="$APP_PATH.community-update-backup"
RESULT="$CACHE_DIR/install-result.json"; CONFIRMED="$CACHE_DIR/launch-confirmed.json"; PENDING="$CACHE_DIR/install-pending.json"
LOG="$CACHE_DIR/install-last.log"
LAUNCH_LOG="$CACHE_DIR/launch-last.log"
OPEN_COMMAND=${openCommand}; XATTR_COMMAND=${xattrCommand}; PRIVILEGED_XATTR_COMMAND=${privilegedXattrCommand}; SLEEP_COMMAND=${sleepCommand}
SLEEP_SECONDS=${sleepSeconds}; PARENT_WAIT_ITERATIONS=${parentWaitIterations}; CONFIRMATION_WAIT_ITERATIONS=${confirmationWaitIterations}; LAUNCH_WAIT_ITERATIONS=${launchWaitIterations}
LANGUAGE_SELECTION_SECONDS=${languageSelectionSeconds}; SUCCESS_CLOSE_SECONDS=${successCloseSeconds}
INTERACTIVE=0; [ -t 0 ] && INTERACTIVE=1
LANGUAGE="\${DEBATE_UPDATE_LANGUAGE:-zh}"
mkdir -p "$CACHE_DIR"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

if [ "$INTERACTIVE" -eq 1 ] && [ -z "\${DEBATE_UPDATE_LANGUAGE:-}" ]; then
  printf '\nDebate Studio Update / Debate Studio 更新安装\n'
  printf '  1. 中文（默认）\n  2. English\n'
  printf '请在 %s 秒内选择 1 或 2；未选择将自动使用中文：' "$LANGUAGE_SELECTION_SECONDS"
  if read -r -t "$LANGUAGE_SELECTION_SECONDS" choice; then
    [ "$choice" = "2" ] && LANGUAGE="en" || LANGUAGE="zh"
  else
    LANGUAGE="zh"
    printf '\n未收到选择，已自动使用中文。\n'
  fi
fi
[ "$LANGUAGE" = "en" ] || LANGUAGE="zh"

message() {
  case "$LANGUAGE:$1" in
    zh:START) printf '开始安装 Debate Studio v%s。' "$VERSION" ;;
    en:START) printf 'Starting installation of Debate Studio v%s.' "$VERSION" ;;
    zh:SAFETY) printf '本次只替换应用程序，不会修改数据库、API Key 或辩论记录。' ;;
    en:SAFETY) printf 'Only the application is replaced; databases, API keys, and debate records are untouched.' ;;
    zh:WAIT_PARENT) printf '正在等待旧版本安全退出…' ;;
    en:WAIT_PARENT) printf 'Waiting for the previous version to exit safely…' ;;
    zh:WAIT_PROGRESS) printf '旧版本仍在退出，已等待 %s 秒。' "$2" ;;
    en:WAIT_PROGRESS) printf 'The previous version is still exiting (%s seconds elapsed).' "$2" ;;
    zh:PARENT_DONE) printf '旧版本已完全退出。' ;;
    en:PARENT_DONE) printf 'The previous version has fully exited.' ;;
    zh:BACKUP) printf '正在创建当前应用的临时回滚备份…' ;;
    en:BACKUP) printf 'Creating a temporary rollback backup…' ;;
    zh:REPLACE) printf '正在替换应用程序文件…' ;;
    en:REPLACE) printf 'Replacing application files…' ;;
    zh:QUARANTINE) printf '正在清除已验证新版本的 macOS 隔离属性…' ;;
    en:QUARANTINE) printf 'Removing the macOS quarantine attribute from the verified update…' ;;
    zh:QUARANTINE_DONE) printf '隔离属性已清除，正在进行启动前复查。' ;;
    en:QUARANTINE_DONE) printf 'The quarantine attribute was removed; running a final pre-launch check.' ;;
    zh:QUARANTINE_AUTH) printf '普通权限无法清除隔离属性。是否允许 macOS 弹出系统授权窗口后重试？[y/N] ' ;;
    en:QUARANTINE_AUTH) printf 'Normal permissions could not remove quarantine. Allow a macOS authorization prompt and retry? [y/N] ' ;;
    zh:QUARANTINE_DENIED) printf '未获得授权，已停止安装并恢复旧版本。' ;;
    en:QUARANTINE_DENIED) printf 'Authorization was not granted. Installation stopped and the previous version will be restored.' ;;
    zh:LAUNCH) printf '正在启动新版本（只启动一次，不会循环拉起）…' ;;
    en:LAUNCH) printf 'Launching the new version once; repeated launch attempts are disabled.' ;;
    zh:WAIT_CONFIRM) printf '新版本进程已启动，正在等待 Electron 就绪确认…' ;;
    en:WAIT_CONFIRM) printf 'The new process is running; waiting for Electron readiness confirmation…' ;;
    zh:HEALTH_PROGRESS) printf '仍在等待新版本健康确认，已等待 %s 秒；不会重复启动。' "$2" ;;
    en:HEALTH_PROGRESS) printf 'Still waiting for startup confirmation after %s seconds; the app will not be launched again.' "$2" ;;
    zh:SUCCESS) printf '更新成功：Debate Studio v%s 已启动，旧版本备份已清理。' "$VERSION" ;;
    en:SUCCESS) printf 'Update succeeded: Debate Studio v%s is running and the old backup was removed.' "$VERSION" ;;
    zh:CLOSE) printf '此窗口将在 %s 秒后自动关闭。' "$SUCCESS_CLOSE_SECONDS" ;;
    en:CLOSE) printf 'This window will close automatically in %s seconds.' "$SUCCESS_CLOSE_SECONDS" ;;
    zh:ROLLBACK) printf '新版本未通过启动确认，正在恢复旧版本…' ;;
    en:ROLLBACK) printf 'The new version did not confirm startup; restoring the previous version…' ;;
    zh:ROLLBACK_DONE) printf '旧版本已恢复并重新启动，本地数据没有被修改。' ;;
    en:ROLLBACK_DONE) printf 'The previous version was restored and reopened; local data was not modified.' ;;
    zh:FAILED) printf '更新未完成。错误代码：%s' "$2" ;;
    en:FAILED) printf 'The update did not complete. Error code: %s' "$2" ;;
    zh:LOG_PATH) printf '完整日志保存在：%s' "$LOG" ;;
    en:LOG_PATH) printf 'The complete log is saved at: %s' "$LOG" ;;
    zh:KEEP_OPEN) printf '窗口将保留以便排查。确认记录完成后，按回车关闭。' ;;
    en:KEEP_OPEN) printf 'This window will remain open for diagnosis. Press Return when you are ready to close it.' ;;
    *) printf '%s' "$1" ;;
  esac
}

say() {
  printf '[%s] ' "$(date '+%H:%M:%S')"
  message "$@"
  printf '\n'
}

technical() { printf '    [debug] %s\n' "$*"; }

run_privileged_xattr() {
  if [ -n "$PRIVILEGED_XATTR_COMMAND" ]; then
    "$PRIVILEGED_XATTR_COMMAND" "$APP_PATH"
    return $?
  fi
  /usr/bin/osascript - "$APP_PATH" <<'APPLESCRIPT'
on run argv
  set appPath to item 1 of argv
  do shell script "/usr/bin/xattr -dr com.apple.quarantine " & quoted form of appPath with administrator privileges
end run
APPLESCRIPT
}

clear_verified_app_quarantine() {
  say QUARANTINE
  technical "quarantine_target=$(basename "$APP_PATH") verification=project-signature+sha256+bundle-id"
  if "$XATTR_COMMAND" -dr com.apple.quarantine "$APP_PATH"; then
    say QUARANTINE_DONE
    return 0
  fi
  technical "quarantine_remove=permission-denied"
  if [ "$INTERACTIVE" -ne 1 ]; then return 1; fi
  message QUARANTINE_AUTH
  if ! read -r -t 30 quarantine_choice; then printf '\n'; return 1; fi
  case "$quarantine_choice" in
    y|Y|yes|YES|是) ;;
    *) say QUARANTINE_DENIED; return 1 ;;
  esac
  if run_privileged_xattr; then
    say QUARANTINE_DONE
    return 0
  fi
  technical "quarantine_remove=authorized-attempt-failed"
  return 1
}

keep_failure_visible() {
  say LOG_PATH
  if [ "$INTERACTIVE" -eq 1 ]; then
    say KEEP_OPEN
    read -r _ || true
  fi
}

close_terminal_after_success() {
  [ "$INTERACTIVE" -eq 1 ] || return 0
  local target_tty="$(tty)"
  "$SLEEP_COMMAND" "$SUCCESS_CLOSE_SECONDS"
  (
    /usr/bin/osascript - "$target_tty" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  set targetTTY to item 1 of argv
  tell application "Terminal"
    repeat with terminalWindow in windows
      repeat with terminalTab in tabs of terminalWindow
        if tty of terminalTab is targetTTY then
          close terminalWindow
          return
        end if
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
  ) &!
}

write_failure_result() {
  local code="$1"; local text="$2"
  printf '{"status":"rolled-back","version":"%s","messageZh":"%s","detailCode":"%s"}' "$VERSION" "$text" "$code" > "$RESULT"
}

say START
say SAFETY
technical "pid=$PARENT_PID version=$VERSION app=$(basename "$APP_PATH")"
say WAIT_PARENT
i=0
while kill -0 "$PARENT_PID" 2>/dev/null && [ "$i" -lt "$PARENT_WAIT_ITERATIONS" ]; do
  "$SLEEP_COMMAND" "$SLEEP_SECONDS"; i=$((i+1))
  if [ $((i % 20)) -eq 0 ]; then say WAIT_PROGRESS "$((i * SLEEP_SECONDS))"; fi
done
if kill -0 "$PARENT_PID" 2>/dev/null; then
  say FAILED UPDATE_PARENT_EXIT_TIMEOUT
  write_failure_result UPDATE_PARENT_EXIT_TIMEOUT '旧版本未能及时退出，安装尚未执行。'
  rm -f "$PENDING" "$CONFIRMED" 2>/dev/null || true
  keep_failure_visible
  exit 1
fi
say PARENT_DONE
"$SLEEP_COMMAND" ${settleSeconds}
rollback() {
  local code="$1"; local text="$2"
  say ROLLBACK
  technical "rollback_reason=$code"
  rm -rf "$APP_PATH" 2>/dev/null || true
  if [ -d "$BACKUP_PATH" ]; then mv "$BACKUP_PATH" "$APP_PATH" 2>/dev/null || true; "$OPEN_COMMAND" "$APP_PATH" >/dev/null 2>&1 || true; fi
  rm -f "$PENDING" "$CONFIRMED" 2>/dev/null || true
  write_failure_result "$code" "$text"
  say ROLLBACK_DONE
  say FAILED "$code"
  keep_failure_visible
}
rm -rf "$BACKUP_PATH" 2>/dev/null || true
rm -f "$CONFIRMED" "$RESULT" 2>/dev/null || true
say BACKUP
if ! mv "$APP_PATH" "$BACKUP_PATH"; then
  rm -f "$PENDING" 2>/dev/null || true
  say FAILED UPDATE_BACKUP_FAILED
  write_failure_result UPDATE_BACKUP_FAILED '无法备份当前应用，安装未执行。'
  keep_failure_visible
  exit 1
fi
say REPLACE
if ! mv "$STAGED_APP" "$APP_PATH"; then rollback UPDATE_REPLACE_FAILED '无法替换应用文件，已自动恢复旧版本。'; exit 1; fi
if ! clear_verified_app_quarantine; then rollback UPDATE_QUARANTINE_REMOVE_FAILED '无法清除新版本的 macOS 隔离属性，已自动恢复旧版本。'; exit 1; fi
say LAUNCH
APP_EXECUTABLE="$APP_PATH/Contents/MacOS/Debate Studio"
: > "$LAUNCH_LOG"
if [ -x "$APP_EXECUTABLE" ]; then
  "$APP_EXECUTABLE" >> "$LAUNCH_LOG" 2>&1 &
else
  technical "launch_executable=missing"
  rollback UPDATE_LAUNCH_FAILED 'macOS 未能启动新版本，已自动恢复旧版本。'
  exit 1
fi
NEW_APP_PID=$!
technical "launch_process_pid=$NEW_APP_PID attempt=1"
i=0
while [ ! -f "$CONFIRMED" ] && kill -0 "$NEW_APP_PID" 2>/dev/null && [ "$i" -lt "$LAUNCH_WAIT_ITERATIONS" ]; do
  "$SLEEP_COMMAND" "$SLEEP_SECONDS"
  i=$((i+1))
done
if [ ! -f "$CONFIRMED" ] && ! kill -0 "$NEW_APP_PID" 2>/dev/null; then
  technical "launch_process=exited-before-ready pid=$NEW_APP_PID"
  if [ -s "$LAUNCH_LOG" ]; then
    technical "launch_log_tail_begin"
    tail -n 30 "$LAUNCH_LOG"
    technical "launch_log_tail_end"
  fi
  rollback UPDATE_LAUNCH_FAILED '新版本进程在就绪前退出，已自动恢复旧版本。'
  exit 1
fi
say WAIT_CONFIRM
i=0
while [ ! -f "$CONFIRMED" ] && [ "$i" -lt "$CONFIRMATION_WAIT_ITERATIONS" ]; do
  "$SLEEP_COMMAND" "$SLEEP_SECONDS"
  i=$((i+1))
  if [ "$i" -gt 0 ] && [ $((i % 40)) -eq 0 ]; then say HEALTH_PROGRESS "$((i * SLEEP_SECONDS))"; fi
done
if [ -f "$CONFIRMED" ]; then
  rm -rf "$BACKUP_PATH" 2>/dev/null || true
  for cached_item in "$CACHE_DIR"/*; do
    [ "$cached_item" = "$LOG" ] && continue
    rm -rf "$cached_item" 2>/dev/null || true
  done
  say SUCCESS
  say CLOSE
  close_terminal_after_success
  exit 0
fi
rollback UPDATE_STARTUP_CONFIRMATION_TIMEOUT '新版本未能成功启动，已自动恢复旧版本。'
exit 1
`
}

export interface InstallTerminalLauncherScriptOptions {
  helperPath: string
  parentPid: number
  appPath: string
  stagedApp: string
  cacheDirectory: string
  version: string
}

export function createInstallTerminalLauncherScript(options: InstallTerminalLauncherScriptOptions): string {
  return `#!/bin/zsh
exec /bin/zsh ${shellLiteral(options.helperPath)} ${shellLiteral(String(options.parentPid))} ${shellLiteral(options.appPath)} ${shellLiteral(options.stagedApp)} ${shellLiteral(options.cacheDirectory)} ${shellLiteral(options.version)}
`
}

function shellLiteral(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'` }
function positiveInteger(value: number | undefined, fallback: number): number { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback }
function positiveNumber(value: number | undefined, fallback: number): number { return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback }

export function resolveRunningAppPath(execPath: string): string { const marker = '.app/Contents/MacOS/'; const index = execPath.indexOf(marker); return index < 0 ? '' : execPath.slice(0, index + 4) }
