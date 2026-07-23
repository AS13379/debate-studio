import { createHash } from 'node:crypto'
import { open, mkdir, readdir, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { DmgUpdatePlatform } from '../application/application-update-service'
import type { DmgUpdateInfo } from '../shared/update-dtos'

const OWNER = 'AS13379'
const REPO = 'debate-studio'
const RELEASE_API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
const RELEASE_PAGE_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`
const MAX_RELEASE_METADATA_BYTES = 256 * 1024
const MAX_DMG_BYTES = 500 * 1024 * 1024
const DMG_NAME_PATTERN = /^Debate-Studio-\d+\.\d+\.\d+-arm64\.dmg(?:\.partial)?$/

interface GitHubReleaseAsset {
  name?: unknown
  size?: unknown
  digest?: unknown
  browser_download_url?: unknown
}

interface GitHubReleaseResponse {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

export interface DmgUpdatePlatformOptions {
  currentVersion: string
  cacheDirectory: string
  showItemInFolder(path: string): void
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  fetchImpl?: typeof fetch
}

export class MacDmgUpdatePlatform implements DmgUpdatePlatform {
  private readonly fetchImpl: typeof fetch
  private downloadedPath?: string

  constructor(private readonly options: DmgUpdatePlatformOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async check(): Promise<DmgUpdateInfo | undefined> {
    const response = await this.fetchImpl(RELEASE_API_URL, {
      redirect: 'follow',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Debate-Studio/${this.options.currentVersion}`
      }
    })
    if (!response.ok) throw new Error(`RELEASE_HTTP_${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELEASE_METADATA_BYTES) {
      throw new Error('RELEASE_METADATA_SIZE_INVALID')
    }
    const info = parseGitHubRelease(JSON.parse(new TextDecoder().decode(bytes)))
    if (compareSemver(info.version, this.options.currentVersion) <= 0) return undefined
    return info
  }

  async download(
    info: DmgUpdateInfo,
    signal: AbortSignal,
    onProgress: (progress: {
      transferredBytes: number
      totalBytes: number
      bytesPerSecond: number
    }) => void
  ): Promise<void> {
    validateDmgUpdateInfo(info)
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const partialPath = join(this.options.cacheDirectory, `${info.assetName}.partial`)
    const finalPath = join(this.options.cacheDirectory, info.assetName)
    await rm(partialPath, { force: true })

    const response = await this.fetchImpl(info.downloadUrl, {
      redirect: 'follow',
      signal,
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': `Debate-Studio/${this.options.currentVersion}`
      }
    })
    if (!response.ok || !response.body) throw new Error(`ASSET_HTTP_${response.status}`)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > 0 && contentLength !== info.size) throw new Error('ASSET_SIZE_HEADER_MISMATCH')

    const file = await open(partialPath, 'w', 0o600)
    const hash = createHash('sha256')
    const reader = response.body.getReader()
    const startedAt = Date.now()
    let transferredBytes = 0
    try {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.byteLength) continue
          transferredBytes += value.byteLength
          if (transferredBytes > info.size || transferredBytes > MAX_DMG_BYTES) {
            throw new Error('ASSET_SIZE_LIMIT_EXCEEDED')
          }
          hash.update(value)
          await writeAll(file, value)
          onProgress({
            transferredBytes,
            totalBytes: info.size,
            bytesPerSecond: transferredBytes / Math.max(1, (Date.now() - startedAt) / 1000)
          })
        }
        await file.sync()
      } catch (cause) {
        await reader.cancel().catch(() => undefined)
        throw cause
      } finally {
        await file.close()
      }
      if (transferredBytes !== info.size) throw new Error('ASSET_SIZE_MISMATCH')
      if (hash.digest('hex') !== info.sha256) throw new Error('ASSET_SHA256_MISMATCH')
      await rename(partialPath, finalPath)
      this.downloadedPath = finalPath
      onProgress({
        transferredBytes,
        totalBytes: info.size,
        bytesPerSecond: transferredBytes / Math.max(1, (Date.now() - startedAt) / 1000)
      })
    } catch (cause) {
      await rm(partialPath, { force: true })
      throw cause
    }
  }

  async openDownloadedUpdate(): Promise<void> {
    const path = await this.resolveDownloadedPath()
    const error = await this.options.openPath(path)
    if (error) throw new Error(`DMG_OPEN_FAILED_${sanitizeDetail(error)}`)
  }

  async showDownloadedUpdateInFinder(): Promise<void> {
    this.options.showItemInFolder(await this.resolveDownloadedPath())
  }

  async deleteDownloadedUpdate(): Promise<void> {
    await this.removeCachedDmgFiles()
    this.downloadedPath = undefined
  }

  async openLatestRelease(): Promise<void> {
    await this.options.openExternal(RELEASE_PAGE_URL)
  }

  async clearCache(): Promise<void> {
    await rm(this.options.cacheDirectory, { recursive: true, force: true })
    this.downloadedPath = undefined
  }

  async cacheSize(): Promise<number> {
    return directorySize(this.options.cacheDirectory)
  }

  private async resolveDownloadedPath(): Promise<string> {
    if (this.downloadedPath && await isFile(this.downloadedPath)) return this.downloadedPath
    const candidates = await listCachedDmgFiles(this.options.cacheDirectory)
    const latest = candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
    if (!latest) throw new Error('DMG_NOT_DOWNLOADED')
    this.downloadedPath = latest.path
    return latest.path
  }

  private async removeCachedDmgFiles(): Promise<void> {
    try {
      const names = await readdir(this.options.cacheDirectory)
      await Promise.all(names
        .filter((name) => DMG_NAME_PATTERN.test(name))
        .map((name) => rm(join(this.options.cacheDirectory, name), { force: true })))
    } catch (cause) {
      if (!isMissingFileError(cause)) throw cause
    }
  }
}

async function writeAll(file: FileHandle, value: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < value.byteLength) {
    const { bytesWritten } = await file.write(value, offset, value.byteLength - offset)
    if (bytesWritten <= 0) throw new Error('ASSET_WRITE_INTERRUPTED')
    offset += bytesWritten
  }
}

export function parseGitHubRelease(input: unknown): DmgUpdateInfo {
  if (!input || typeof input !== 'object') throw new Error('RELEASE_METADATA_INVALID')
  const release = input as GitHubReleaseResponse
  if (release.draft === true || release.prerelease === true) throw new Error('RELEASE_CHANNEL_INVALID')
  if (typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('RELEASE_VERSION_INVALID')
  }
  const version = release.tag_name.slice(1)
  const assetName = `Debate-Studio-${version}-arm64.dmg`
  const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : []
  const asset = assets.find((item) => item.name === assetName)
  if (!asset) throw new Error('RELEASE_DMG_ASSET_MISSING')
  if (!Number.isSafeInteger(asset.size) || Number(asset.size) <= 0 || Number(asset.size) > MAX_DMG_BYTES) {
    throw new Error('RELEASE_DMG_SIZE_INVALID')
  }
  if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error('RELEASE_SHA256_UNAVAILABLE')
  }
  const expectedUrl = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${assetName}`
  if (asset.browser_download_url !== expectedUrl) throw new Error('RELEASE_DMG_URL_INVALID')

  return {
    version,
    size: Number(asset.size),
    sha256: asset.digest.slice('sha256:'.length),
    assetName,
    downloadUrl: expectedUrl,
    releaseName: typeof release.name === 'string' && release.name.trim()
      ? release.name.trim().slice(0, 300)
      : `Debate Studio v${version}`,
    releaseNotes: typeof release.body === 'string' ? release.body : undefined,
    releaseDate: typeof release.published_at === 'string' ? release.published_at : undefined
  }
}

export function validateDmgUpdateInfo(info: DmgUpdateInfo): void {
  if (!/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error('UPDATE_VERSION_INVALID')
  const expectedName = `Debate-Studio-${info.version}-arm64.dmg`
  const expectedUrl = `https://github.com/${OWNER}/${REPO}/releases/download/v${info.version}/${expectedName}`
  if (info.assetName !== expectedName || info.downloadUrl !== expectedUrl) throw new Error('UPDATE_ASSET_INVALID')
  if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_DMG_BYTES) {
    throw new Error('UPDATE_SIZE_INVALID')
  }
  if (!/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('UPDATE_SHA256_INVALID')
}

export function compareSemver(a: string, b: string): number {
  const aa = a.split('.').map(Number)
  const bb = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] !== bb[index]) return aa[index] - bb[index]
  }
  return 0
}

async function listCachedDmgFiles(directory: string): Promise<Array<{ path: string; modifiedAt: number }>> {
  try {
    const names = await readdir(directory)
    return Promise.all(names
      .filter((name) => /^Debate-Studio-\d+\.\d+\.\d+-arm64\.dmg$/.test(name))
      .map(async (name) => {
        const path = join(directory, name)
        return { path, modifiedAt: (await stat(path)).mtimeMs }
      }))
  } catch (cause) {
    if (isMissingFileError(cause)) return []
    throw cause
  }
}

async function directorySize(path: string): Promise<number> {
  try {
    let total = 0
    for (const name of await readdir(path)) {
      const item = join(path, name)
      const info = await stat(item)
      total += info.isDirectory() ? await directorySize(item) : info.size
    }
    return total
  } catch (cause) {
    if (isMissingFileError(cause)) return 0
    throw cause
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function isMissingFileError(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
}

function sanitizeDetail(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'UNKNOWN'
}
