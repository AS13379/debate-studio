import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const artifact = process.argv[2]
const keychainProfile = process.env.APPLE_NOTARY_KEYCHAIN_PROFILE?.trim()

if (!artifact || !existsSync(artifact)) {
  console.error('用法：npm run release:notarize -- /absolute/path/to/Debate-Studio.dmg')
  process.exit(2)
}
if (!keychainProfile) {
  console.error('公证未执行：请先用 notarytool store-credentials 保存真实 Apple 凭据，并设置 APPLE_NOTARY_KEYCHAIN_PROFILE。')
  process.exit(2)
}

run('xcrun', ['notarytool', 'submit', artifact, '--keychain-profile', keychainProfile, '--wait'])
run('xcrun', ['stapler', 'staple', artifact])

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
