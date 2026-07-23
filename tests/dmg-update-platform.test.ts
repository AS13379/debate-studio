import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MacDmgUpdatePlatform,
  compareSemver,
  parseGitHubRelease,
  validateDmgUpdateInfo
} from '../src/main/dmg-update-platform'
import type { DmgUpdateInfo } from '../src/shared/update-dtos'

const roots: string[] = []
const bytes = new TextEncoder().encode('verified dmg fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const version = '0.6.1'
const assetName = `Debate-Studio-${version}-arm64.dmg`
const downloadUrl = `https://github.com/AS13379/debate-studio/releases/download/v${version}/${assetName}`
const info: DmgUpdateInfo = {
  version,
  size: bytes.byteLength,
  sha256,
  assetName,
  downloadUrl,
  releaseName: 'Debate Studio v0.6.1',
  releaseNotes: '安全下载'
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('GitHub DMG release metadata', () => {
  it('selects the exact arm64 DMG and GitHub SHA-256 digest', () => {
    expect(parseGitHubRelease(releaseFixture())).toMatchObject(info)
  })

  it('rejects missing SHA-256, arbitrary download URLs and oversized assets', () => {
    expect(() => parseGitHubRelease(releaseFixture({ digest: null }))).toThrow(/SHA256_UNAVAILABLE/)
    expect(() => parseGitHubRelease(releaseFixture({ browser_download_url: 'https://example.com/update.dmg' }))).toThrow(/URL_INVALID/)
    expect(() => parseGitHubRelease(releaseFixture({ size: 501 * 1024 * 1024 }))).toThrow(/SIZE_INVALID/)
  })

  it('uses strict semantic ordering and fixed asset identity', () => {
    expect(compareSemver('0.6.1', '0.6.0')).toBeGreaterThan(0)
    expect(() => validateDmgUpdateInfo({ ...info, assetName: '../Debate Studio.app' })).toThrow(/ASSET_INVALID/)
  })
})

describe('MacDmgUpdatePlatform', () => {
  it('detects a newer release and downloads the verified DMG', async () => {
    const fixture = await createPlatform([
      new Response(JSON.stringify(releaseFixture()), { status: 200 }),
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      })
    ])
    const detected = await fixture.platform.check()
    expect(detected).toMatchObject(info)
    await fixture.platform.download(detected!, new AbortController().signal, vi.fn())
    expect(await readFile(join(fixture.cache, assetName))).toEqual(Buffer.from(bytes))
  })

  it('refuses a SHA-256 mismatch and removes the partial file', async () => {
    const fixture = await createPlatform([
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      })
    ])
    await expect(fixture.platform.download(
      { ...info, sha256: 'f'.repeat(64) },
      new AbortController().signal,
      vi.fn()
    )).rejects.toThrow(/SHA256_MISMATCH/)
    await expect(access(join(fixture.cache, `${assetName}.partial`))).rejects.toThrow()
    await expect(access(join(fixture.cache, assetName))).rejects.toThrow()
  })

  it('cancels an in-flight download without leaving a partial file', async () => {
    const controller = new AbortController()
    const fixture = await createPlatform([], async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        setTimeout(resolve, 10_000)
      })
      return new Response(bytes)
    })
    const pending = fixture.platform.download(info, controller.signal, vi.fn())
    controller.abort()
    await expect(pending).rejects.toThrow()
    await expect(access(join(fixture.cache, `${assetName}.partial`))).rejects.toThrow()
  })

  it('opens or reveals only the cached DMG and never receives an application path', async () => {
    const fixture = await createPlatform([
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      })
    ])
    await fixture.platform.download(info, new AbortController().signal, vi.fn())
    await fixture.platform.openDownloadedUpdate()
    await fixture.platform.showDownloadedUpdateInFinder()
    expect(fixture.openPath).toHaveBeenCalledWith(join(fixture.cache, assetName))
    expect(fixture.showItemInFolder).toHaveBeenCalledWith(join(fixture.cache, assetName))
    expect(JSON.stringify(fixture.openPath.mock.calls)).not.toContain('/Applications/')
  })

  it('deletes the downloaded DMG without touching files outside the cache', async () => {
    const fixture = await createPlatform([
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      })
    ])
    await fixture.platform.download(info, new AbortController().signal, vi.fn())
    await fixture.platform.deleteDownloadedUpdate()
    await expect(access(join(fixture.cache, assetName))).rejects.toThrow()
  })
})

async function createPlatform(
  responses: Response[],
  fetchOverride?: typeof fetch
) {
  const root = await mkdtemp(join(tmpdir(), 'debate-studio-dmg-update-'))
  roots.push(root)
  const cache = join(root, 'cache')
  const openPath = vi.fn(async () => '')
  const showItemInFolder = vi.fn()
  const fetchImpl = fetchOverride ?? vi.fn(async () => {
    const response = responses.shift()
    if (!response) throw new Error('UNEXPECTED_FETCH')
    return response
  }) as typeof fetch
  const platform = new MacDmgUpdatePlatform({
    currentVersion: '0.6.0',
    cacheDirectory: cache,
    showItemInFolder,
    openPath,
    openExternal: vi.fn(async () => undefined),
    fetchImpl
  })
  return { root, cache, platform, openPath, showItemInFolder }
}

function releaseFixture(assetOverrides: Record<string, unknown> = {}) {
  return {
    tag_name: `v${version}`,
    name: `Debate Studio v${version}`,
    body: '安全下载',
    published_at: '2026-07-23T00:00:00.000Z',
    draft: false,
    prerelease: false,
    assets: [{
      name: assetName,
      size: bytes.byteLength,
      digest: `sha256:${sha256}`,
      browser_download_url: downloadUrl,
      ...assetOverrides
    }]
  }
}
