import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export class SparklePrivateKeyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SparklePrivateKeyError'
    this.code = code
  }
}

export function resolveSparklePrivateKeyPath(rawPath) {
  const value = rawPath?.trim()
  if (!value) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_MISSING',
      'SPARKLE_PRIVATE_KEY_FILE 未设置。请指向仓库外、权限为 600 的 Sparkle 私钥文件。'
    )
  }
  const expanded = value === '~'
    ? homedir()
    : value.startsWith(`~${sep}`)
      ? resolve(homedir(), value.slice(2))
      : value
  if (!isAbsolute(expanded)) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_NOT_ABSOLUTE',
      'SPARKLE_PRIVATE_KEY_FILE 必须是绝对路径。'
    )
  }
  return resolve(expanded)
}

export function validateSparklePrivateKeyFile({
  keyFile = process.env.SPARKLE_PRIVATE_KEY_FILE,
  repositoryRoot = process.env.SPARKLE_REPOSITORY_ROOT ?? process.cwd()
} = {}) {
  const keyPath = resolveSparklePrivateKeyPath(keyFile)
  let stats
  try {
    stats = lstatSync(keyPath)
  } catch {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_NOT_FOUND',
      `Sparkle 私钥文件不存在：${keyPath}`
    )
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_INVALID_TYPE',
      'Sparkle 私钥必须是普通文件，不能是目录或符号链接。'
    )
  }

  const permissions = stats.mode & 0o777
  if (permissions !== 0o600 && permissions !== 0o400) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_PERMISSIONS',
      `Sparkle 私钥权限必须为 600（或只读的 400），当前为 ${permissions.toString(8)}。请运行 chmod 600。`
    )
  }

  const contents = readFileSync(keyPath, 'utf8').trim()
  if (!contents) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_EMPTY',
      'Sparkle 私钥文件为空。'
    )
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contents)) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_FORMAT',
      'Sparkle 私钥文件不是有效的 Base64 Ed25519 私钥。'
    )
  }
  const decoded = Buffer.from(contents, 'base64')
  if (decoded.byteLength !== 32) {
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_FORMAT',
      `Sparkle 私钥解码后应为 32 字节，当前为 ${decoded.byteLength} 字节。`
    )
  }

  const root = realpathSync(resolve(repositoryRoot))
  const keyRealPath = realpathSync(keyPath)
  const repositoryRelativePath = relative(root, keyRealPath)
  const isInsideRepository = repositoryRelativePath !== ''
    && repositoryRelativePath !== '..'
    && !repositoryRelativePath.startsWith(`..${sep}`)
    && !isAbsolute(repositoryRelativePath)

  if (isInsideRepository) {
    const tracked = spawnSync(
      'git',
      ['-C', root, 'ls-files', '--error-unmatch', '--', repositoryRelativePath],
      { stdio: 'ignore' }
    )
    if (tracked.status === 0) {
      throw new SparklePrivateKeyError(
        'SPARKLE_PRIVATE_KEY_FILE_TRACKED',
        'Sparkle 私钥已被 Git 跟踪，发布已终止。请先从 Git 索引和历史中安全移除。'
      )
    }
    throw new SparklePrivateKeyError(
      'SPARKLE_PRIVATE_KEY_FILE_IN_REPOSITORY',
      'Sparkle 私钥必须保存在 Git 仓库之外。'
    )
  }

  return {
    path: keyRealPath,
    permissions,
    byteLength: decoded.byteLength
  }
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    const result = validateSparklePrivateKeyFile()
    if (process.argv.includes('--print-path')) {
      process.stdout.write(`${result.path}\n`)
    } else {
      process.stdout.write('Sparkle 私钥文件检查通过。\n')
    }
  } catch (error) {
    const code = error instanceof SparklePrivateKeyError ? error.code : 'SPARKLE_PRIVATE_KEY_UNKNOWN'
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[${code}] ${message}\n`)
    process.exitCode = 1
  }
}
