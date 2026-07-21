import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalManifestPayload, compareSemver, parseAndVerifyManifest, resolveRunningAppPath } from '../src/main/community-update-platform'
import type { CommunityUpdateManifest } from '../src/shared/update-dtos'

function signedManifest(overrides: Partial<CommunityUpdateManifest> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const notes = '安全更新'
  const unsigned = {
    schemaVersion: 1 as const, channel: 'stable' as const, version: '0.5.0', platform: 'darwin' as const,
    arch: 'arm64' as const, tag: 'v0.5.0', assetName: 'Debate-Studio-0.5.0-arm64.update.tar.gz',
    size: 1024, sha256: 'a'.repeat(64), releaseDate: '2026-07-21T00:00:00.000Z', releaseNotes: notes,
    notesSha256: createHash('sha256').update(notes).digest('hex'), bundleId: 'com.leander.debatestudio' as const,
    keyId: 'ds-update-2026-01', ...overrides
  }
  const signature = sign(null, canonicalManifestPayload(unsigned), privateKey).toString('base64')
  return { manifest: { ...unsigned, signature }, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}

describe('community update manifest', () => {
  it('accepts an intact Ed25519-signed stable arm64 upgrade', () => { const { manifest, publicKey } = signedManifest(); expect(parseAndVerifyManifest(manifest, '0.4.9', publicKey).version).toBe('0.5.0') })
  it('rejects tampering and a wrong public key', () => { const { manifest } = signedManifest(); const other = signedManifest().publicKey; expect(() => parseAndVerifyManifest({ ...manifest, size: 2048 }, '0.4.9', other)).toThrow(/SIGNATURE/) })
  it('rejects downgrade, wrong platform and oversized package', () => {
    let value = signedManifest(); expect(() => parseAndVerifyManifest(value.manifest, '0.5.1', value.publicKey)).toThrow(/DOWNGRADE/)
    value = signedManifest({ platform: 'darwin' }); const bad = { ...value.manifest, arch: 'x64' }; expect(() => parseAndVerifyManifest(bad, '0.4.9', value.publicKey)).toThrow(/PLATFORM/)
    value = signedManifest({ size: 301 * 1024 * 1024 }); expect(() => parseAndVerifyManifest(value.manifest, '0.4.9', value.publicKey)).toThrow(/SIZE/)
  })
  it('uses strict semantic ordering and resolves only a running app bundle', () => { expect(compareSemver('0.5.0', '0.4.99')).toBeGreaterThan(0); expect(resolveRunningAppPath('/Applications/Debate Studio.app/Contents/MacOS/Debate Studio')).toBe('/Applications/Debate Studio.app'); expect(resolveRunningAppPath('/tmp/electron')).toBe('') })
})
