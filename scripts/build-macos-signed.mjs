import { spawnSync } from 'node:child_process'

const identity = process.env.CSC_NAME?.trim()
if (!identity) {
  console.error('缺少 CSC_NAME。请安装真实 Apple Developer ID Application 证书后再执行签名构建。')
  process.exit(2)
}

run('npm', ['run', 'build'])
run('npx', [
  'electron-builder', '--mac', 'dmg', '--arm64',
  `--config.mac.identity=${identity}`
])

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
