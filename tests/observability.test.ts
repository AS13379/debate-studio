import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ErrorCenter, StructuredLogger } from '../src/observability'
import { DiagnosticsApplication } from '../src/application'

const directories: string[] = []
const secret = 'sk-observability-secret-123456789'

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-observability-'))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('global error center', () => {
  it('stores structured errors and automatically removes sensitive data', () => {
    const directory = temporaryDirectory()
    const center = new ErrorCenter({
      filePath: join(directory, 'errors.jsonl'), appVersion: '0.1.0-test',
      createId: () => 'error-1', now: () => new Date('2026-07-15T00:00:00.000Z')
    })

    const record = center.capture({
      code: 'CREDENTIAL_MISSING', titleZh: '凭据缺失', descriptionZh: '请重新配置 API Key。',
      technicalDetails: `Authorization: Bearer ${secret}; credentialRef=provider:private`, retryable: false
    }, {
      source: 'provider', sessionId: 'session-1',
      metadata: { credentialRef: 'provider:private', apiKey: secret, statusCode: 401, prompt: '用户私密内容' }
    })

    const serialized = JSON.stringify(record)
    expect(record.category).toBe('authentication')
    expect(record.title).toBe('凭据缺失')
    expect(record.metadata).toEqual({ statusCode: 401, code: 'CREDENTIAL_MISSING' })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('provider:private')
    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('用户私密内容')
    expect(center.getErrorDetail('error-1')).toMatchObject({ id: 'error-1', retryable: false })

    const restored = new ErrorCenter({ filePath: join(directory, 'errors.jsonl'), appVersion: '0.1.0-test' })
    expect(restored.listRecentErrors()).toHaveLength(1)
    restored.clearErrors()
    expect(restored.listRecentErrors()).toEqual([])
  })

  it('exports a diagnostic report without request payloads or private research data', () => {
    const directory = temporaryDirectory()
    const center = new ErrorCenter({
      filePath: join(directory, 'errors.jsonl'), appVersion: '0.2.0',
      systemInfo: { platform: 'darwin', arch: 'arm64' }, createId: () => 'error-report'
    })
    center.updateRuntimeSnapshot('rebuttal', 'running', '2026-07-15T00:00:00.000Z')
    center.capture({ code: 'TIMEOUT', titleZh: '请求超时', descriptionZh: '服务商未及时返回。', retryable: true }, {
      source: 'provider-http',
      metadata: { statusCode: 504, bodyText: '完整网页正文', privateResearch: '私有研究', authorization: secret }
    })

    const report = center.exportDiagnosticReport()
    const serialized = JSON.stringify(report)
    expect(report.application.version).toBe('0.2.0')
    expect(report.recentRuntime).toMatchObject({ stage: 'rebuttal', status: 'running' })
    expect(report.testStatus.status).toBe('not-run-in-app')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('完整网页正文')
    expect(serialized).not.toContain('私有研究')

    const logger = new StructuredLogger({ directory: join(directory, 'logs') })
    const diagnostics = new DiagnosticsApplication({ appDataDirectory: directory, errorCenter: center, logger })
    const exported = diagnostics.exportDiagnosticReport()
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const file = readFileSync(exported.value.filePath, 'utf8')
    expect(file).toContain('"recentErrors"')
    expect(file).not.toContain(secret)
    expect(file).not.toContain('完整网页正文')
  })
})

describe('structured logger', () => {
  it('records levels and redacts secrets and forbidden metadata', () => {
    const directory = temporaryDirectory()
    let id = 0
    const logger = new StructuredLogger({ directory, createId: () => `log-${++id}` })
    logger.debug('请求开始', { source: 'provider' })
    logger.info(`Authorization: Bearer ${secret}`, {
      source: 'provider', metadata: { credentialRef: 'provider:private', body: '完整请求体', statusCode: 200 }
    })
    logger.warn('接近限制', { source: 'runtime' })
    logger.error('请求失败', { source: 'network' })

    const logs = logger.getRecentLogs()
    const serialized = JSON.stringify(logs)
    expect(logs.map((entry) => entry.level)).toEqual(['debug', 'info', 'warn', 'error'])
    expect(logs[1].metadata).toEqual({ statusCode: 200 })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('provider:private')
    expect(serialized).not.toContain('完整请求体')
  })

  it('rotates files at the configured maximum size and can clear every file', () => {
    const directory = temporaryDirectory()
    const logger = new StructuredLogger({ directory, maxFileSizeBytes: 512, maxFiles: 2 })
    for (let index = 0; index < 30; index += 1) {
      logger.info(`轮转测试 ${index} ${'x'.repeat(80)}`, { source: 'rotation' })
    }

    expect(existsSync(`${logger.filePath}.1`)).toBe(true)
    expect(logger.getRecentLogs().length).toBeGreaterThan(0)
    expect(readFileSync(logger.filePath, 'utf8')).toContain('rotation')
    logger.clearLogs()
    expect(existsSync(logger.filePath)).toBe(false)
    expect(existsSync(`${logger.filePath}.1`)).toBe(false)
  })
})
