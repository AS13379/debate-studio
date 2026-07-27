import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const keyValidator = join(root, 'scripts', 'sparkle-private-key.mjs')
const appcastGenerator = join(root, 'scripts', 'create-sparkle-appcast.mjs')
const createdDirectories: string[] = []

describe('Sparkle release signing secret management', () => {
  afterEach(() => {
    for (const directory of createdDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a missing, empty, or overly permissive private-key file', () => {
    expect(() => runValidator(undefined)).toThrow(/SPARKLE_PRIVATE_KEY_FILE_MISSING/)

    const directory = createTemporaryDirectory()
    const empty = join(directory, 'empty-key')
    writeFileSync(empty, '', { mode: 0o600 })
    expect(() => runValidator(empty)).toThrow(/SPARKLE_PRIVATE_KEY_FILE_EMPTY/)

    const permissive = join(directory, 'permissive-key')
    writeFileSync(permissive, testPrivateKey(), { mode: 0o644 })
    chmodSync(permissive, 0o644)
    expect(() => runValidator(permissive)).toThrow(/SPARKLE_PRIVATE_KEY_FILE_PERMISSIONS/)
  })

  it('accepts a repository-external 600 private-key file without printing its contents', () => {
    const directory = createTemporaryDirectory()
    const keyFile = join(directory, 'sparkle_private_key')
    const privateKey = testPrivateKey()
    writeFileSync(keyFile, privateKey, { mode: 0o600 })
    chmodSync(keyFile, 0o600)

    const result = runValidator(keyFile)

    expect(result).toContain('Sparkle 私钥文件检查通过')
    expect(result).not.toContain(privateKey)
  })

  it('rejects a private key tracked by Git', () => {
    const directory = createTemporaryDirectory()
    execFileSync('git', ['init', '--quiet'], { cwd: directory })
    const keyFile = join(directory, 'sparkle_private_key')
    writeFileSync(keyFile, testPrivateKey(), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
    execFileSync('git', ['add', '--force', 'sparkle_private_key'], { cwd: directory })

    expect(() => runValidator(keyFile, directory)).toThrow(/SPARKLE_PRIVATE_KEY_FILE_TRACKED/)
  })

  it('passes the external key explicitly to sign_update and creates a signed appcast', () => {
    const directory = createTemporaryDirectory()
    const keyFile = join(directory, 'sparkle_private_key')
    const archive = join(directory, 'Debate-Studio-9.8.7-arm64.zip')
    const output = join(directory, 'appcast.xml')
    const fakeSignUpdate = join(directory, 'sign_update')
    const privateKey = testPrivateKey()
    writeFileSync(keyFile, privateKey, { mode: 0o600 })
    chmodSync(keyFile, 0o600)
    writeFileSync(archive, 'signed archive fixture')
    writeFileSync(
      fakeSignUpdate,
      `#!/usr/bin/env node
const { statSync } = require('node:fs')
const args = process.argv.slice(2)
if (args[0] !== '--ed-key-file' || !args[1] || !args[2]) process.exit(2)
const length = statSync(args[2]).size
process.stdout.write('sparkle:edSignature="ZmFrZS1lZDI1NTE5LXNpZ25hdHVyZQ==" length="' + length + '"\\n')
`,
      { mode: 0o700 }
    )
    chmodSync(fakeSignUpdate, 0o700)

    const result = execFileSync(
      process.execPath,
      [
        appcastGenerator,
        '--archive', archive,
        '--version', '9.8.7',
        '--tag', 'v9.8.7',
        '--output', output
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          SPARKLE_PRIVATE_KEY_FILE: keyFile,
          SPARKLE_SIGN_UPDATE_PATH: fakeSignUpdate
        },
        encoding: 'utf8'
      }
    )
    const appcast = readFileSync(output, 'utf8')

    expect(result).toContain('"signed": true')
    expect(appcast).toContain('sparkle:edSignature="ZmFrZS1lZDI1NTE5LXNpZ25hdHVyZQ=="')
    expect(appcast).toContain('/releases/download/v9.8.7/Debate-Studio-9.8.7-arm64.zip')
    expect(appcast).not.toContain(privateKey)
  })

  it('uses only external-file and GitHub Secret inputs in release automation', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'macos-arm64-release.yml'), 'utf8')
    const isolatedSigner = readFileSync(
      join(root, 'experiments', 'sparkle-update-test', 'scripts', 'make-appcast.sh'),
      'utf8'
    )
    const appcastScript = readFileSync(appcastGenerator, 'utf8')
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')

    expect(workflow).toContain('secrets.SPARKLE_PRIVATE_KEY')
    expect(workflow).toContain('SPARKLE_PRIVATE_KEY_FILE=')
    expect(workflow).toContain('chmod 600')
    expect(workflow).toContain('release/appcast.xml')
    expect(isolatedSigner).toContain('--ed-key-file')
    expect(appcastScript).toContain("'--ed-key-file'")
    expect(`${workflow}\n${isolatedSigner}\n${appcastScript}`).not.toMatch(
      /security\s+(?:add|find)-generic-password/
    )
    expect(gitignore).toContain('sparkle_private_key')
  })

  it('does not track a Sparkle private key or expose developer signing controls to users', () => {
    const tracked = spawnSync(
      'git',
      ['ls-files', '*sparkle_private_key*'],
      { cwd: root, encoding: 'utf8' }
    )
    const rendererFiles = execFileSync(
      'rg',
      ['--files', 'src/renderer', 'src/lan-renderer'],
      { cwd: root, encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean)
    const rendererSource = rendererFiles
      .map((file) => readFileSync(join(root, file), 'utf8'))
      .join('\n')

    expect(tracked.stdout.trim()).toBe('')
    expect(rendererSource).not.toContain('SPARKLE_PRIVATE_KEY')
    expect(rendererSource).not.toContain('sparkle_private_key')
  })
})

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'debate-studio-sparkle-key-'))
  createdDirectories.push(directory)
  return directory
}

function testPrivateKey(): string {
  return Buffer.alloc(32, 0x5a).toString('base64')
}

function runValidator(keyFile?: string, repositoryRoot = root): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPARKLE_REPOSITORY_ROOT: repositoryRoot
  }
  delete env.SPARKLE_PRIVATE_KEY_FILE
  if (keyFile) env.SPARKLE_PRIVATE_KEY_FILE = keyFile
  return execFileSync(process.execPath, [keyValidator], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}
