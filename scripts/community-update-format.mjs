export const UPDATE_KEY_ID = 'ds-update-2026-01'
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAr0CR6ECKCKB0Yd/kRHenZODMOHOMUBoLaQL1t+Gv/ZE=
-----END PUBLIC KEY-----`

export function canonicalManifestPayload(manifest) {
  return Buffer.from(JSON.stringify({
    schemaVersion: manifest.schemaVersion, channel: manifest.channel, version: manifest.version,
    platform: manifest.platform, arch: manifest.arch, tag: manifest.tag, assetName: manifest.assetName,
    size: manifest.size, sha256: manifest.sha256, releaseDate: manifest.releaseDate,
    releaseNotes: manifest.releaseNotes ?? '', notesSha256: manifest.notesSha256,
    bundleId: manifest.bundleId, keyId: manifest.keyId
  }), 'utf8')
}
