import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DebateHistoryApplication, ExportApplication } from '../src/application'
import type { ExportFileStore } from '../src/export'
import { initializePersistence, type PersistenceContext, type PersistenceResult } from '../src/persistence'

const temporaryDirectories: string[] = []
const contexts: PersistenceContext[] = []
const NOW = '2026-07-15T10:00:00.000Z'
const SECRET = 'sk-unit-test-supersecret-value'
const CREDENTIAL_REFERENCE = 'provider-ref-must-not-export'
const LONG_TEXT = `长文本开始 ${'辩论内容。'.repeat(1_200)} 长文本结束`

afterEach(() => {
  for (const context of contexts.splice(0)) context.database.close()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('debate export application', () => {
  it('exports structured Markdown in chronological order without private research or secrets by default', async () => {
    const fixture = createFixture()
    const result = fixture.application.exportDebateMarkdown('debate-1', { includePrivateResearch: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('generating')
    const completed = await waitForExport(fixture.application, result.value.exportId)
    const content = readFileSync(completed.filePath, 'utf8')
    expect(content).toContain('# 可分享的归档名称')
    expect(content).toContain('## 公共资源池')
    expect(content).toContain('## 公开证据桌')
    expect(content).toContain('### 证据 A-S1')
    expect(content).toContain('## 正式辩论')
    expect(content.indexOf('正方核心发言')).toBeLessThan(content.indexOf('反方核心发言'))
    expect(content).toContain('长文本结束')
    expect(content).not.toContain('正方秘密研究原文')
    expect(content).not.toContain(SECRET)
    expect(content).not.toContain(CREDENTIAL_REFERENCE)
    expect(content).not.toContain('<script>')
    expect(content).toContain('&lt;script&gt;')
    expect(completed).toMatchObject({ type: 'markdown', includePrivateResearch: false, status: 'completed', progress: 100 })
    expect(completed.fileSize).toBeGreaterThan(0)
  })

  it('exports a standalone safe HTML file and only includes private research after explicit opt-in', async () => {
    const fixture = createFixture()
    const defaultResult = fixture.application.exportDebateHtml('debate-1', { includePrivateResearch: false })
    const privateResult = fixture.application.exportDebateHtml('debate-1', { includePrivateResearch: true })

    expect(defaultResult.ok).toBe(true)
    expect(privateResult.ok).toBe(true)
    if (!defaultResult.ok || !privateResult.ok) return
    const defaultCompleted = await waitForExport(fixture.application, defaultResult.value.exportId)
    const privateCompleted = await waitForExport(fixture.application, privateResult.value.exportId)
    const publicHtml = readFileSync(defaultCompleted.filePath, 'utf8')
    const privateHtml = readFileSync(privateCompleted.filePath, 'utf8')
    expect(publicHtml).toContain('<!doctype html>')
    expect(publicHtml).toContain('Content-Security-Policy')
    expect(publicHtml).toContain('@media(prefers-color-scheme:dark)')
    expect(publicHtml).toContain('<details class="card turn"')
    expect(publicHtml).not.toMatch(/<script[\s>]/i)
    expect(publicHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(publicHtml).not.toContain('正方秘密研究原文')
    expect(privateHtml).toContain('正方秘密研究原文')
    expect(privateHtml).toContain('本文件包含私有研究内容')
    expect(privateHtml).not.toContain(SECRET)
    expect(privateHtml).not.toContain(CREDENTIAL_REFERENCE)
  })

  it('keeps a redacted failed record when writing the file fails', async () => {
    const fixture = createFixture({
      async write() { throw new Error(`Authorization: Bearer ${SECRET}`) },
      async delete() { return false }
    })
    const result = fixture.application.exportDebateMarkdown('debate-1', { includePrivateResearch: false })
    expect(result).toMatchObject({ ok: true, value: { status: 'generating' } })
    expect(JSON.stringify(result)).not.toContain(SECRET)

    if (!result.ok) return
    await waitForExport(fixture.application, result.value.exportId, 'failed')

    const history = fixture.application.getExportHistory()
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value).toHaveLength(1)
    expect(history.value[0]).toMatchObject({ status: 'failed', fileSize: 0 })
    expect(JSON.stringify(history.value[0])).not.toContain(SECRET)
    expect(JSON.stringify(history.value[0])).toContain('[REDACTED]')
  })

  it('deletes the generated file together with its export record', async () => {
    const fixture = createFixture()
    const exported = fixture.application.exportDebateMarkdown('debate-1', { includePrivateResearch: false })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const completed = await waitForExport(fixture.application, exported.value.exportId)
    expect(existsSync(completed.filePath)).toBe(true)

    expect(await fixture.application.deleteExportRecord(exported.value.exportId)).toEqual({ ok: true, value: { deleted: true } })
    expect(existsSync(completed.filePath)).toBe(false)
    expect(fixture.application.getExportHistory()).toEqual({ ok: true, value: [] })
  })

  it('restores export history after reopening the SQLite database', async () => {
    const fixture = createFixture()
    const exported = fixture.application.exportDebateHtml('debate-1', { includePrivateResearch: false })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    await waitForExport(fixture.application, exported.value.exportId)
    fixture.context.database.close()
    contexts.splice(contexts.indexOf(fixture.context), 1)

    const reopened = initializePersistence({ appDataDirectory: fixture.directory })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    contexts.push(reopened.value)
    const history = new DebateHistoryApplication({ persistence: reopened.value })
    const application = new ExportApplication({ persistence: reopened.value, history, appDataDirectory: fixture.directory })
    const records = application.getExportHistory()
    expect(records.ok).toBe(true)
    if (!records.ok) return
    expect(records.value).toHaveLength(1)
    expect(records.value[0]).toMatchObject({ type: 'html', status: 'completed', debateTitle: '可分享的归档名称' })
  })
})

async function waitForExport(
  application: ExportApplication,
  exportId: string,
  expected: 'completed' | 'failed' | 'cancelled' = 'completed'
): Promise<import('../src/shared/ipc-contract').DebateExportRecordDto> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const history = application.getExportHistory()
    if (history.ok) {
      const record = history.value.find((item) => item.exportId === exportId)
      if (record && record.status !== 'generating') {
        expect(record.status).toBe(expected)
        return record
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Export ${exportId} did not finish.`)
}

function createFixture(fileStore?: ExportFileStore): {
  directory: string
  context: PersistenceContext
  application: ExportApplication
} {
  const directory = mkdtempSync(join(tmpdir(), 'debate-export-'))
  temporaryDirectories.push(directory)
  const initialized = initializePersistence({ appDataDirectory: directory })
  if (!initialized.ok) throw initialized.error
  const context = initialized.value
  contexts.push(context)
  seed(context)
  const history = new DebateHistoryApplication({ persistence: context, now: () => new Date(NOW) })
  expect(history.renameDebate('debate-1', '可分享的归档名称').ok).toBe(true)
  const application = new ExportApplication({
    persistence: context,
    history,
    appDataDirectory: directory,
    fileStore,
    now: () => new Date('2026-07-15T12:00:00.000Z'),
    createId: sequenceId('export')
  })
  return { directory, context, application }
}

function seed(context: PersistenceContext): void {
  const repositories = context.repositories
  ok(repositories.providerConnections.create({
    id: 'connection-1', providerId: 'mock', displayName: 'Mock 平台', protocolType: 'mock',
    baseUrl: 'https://mock.invalid/v1', credentialRef: CREDENTIAL_REFERENCE, enabled: true,
    createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.modelProfiles.create({
    id: 'model-1', connectionId: 'connection-1', modelId: 'mock-debate', displayName: 'Mock Debate',
    capabilities: { textInput: true, imageInput: false, documentInput: false, audioInput: false, videoInput: false, streaming: true, reasoning: false, toolCalling: false, webSearch: false, structuredOutput: false },
    maxOutputTokens: 400, createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.debates.save({
    id: 'debate-1', topic: '大学是否应该设置固定自主学习日', background: '简单背景',
    affirmativePosition: '应该设置', negativePosition: '不应该设置', freeDebateRounds: 1,
    status: 'completed', createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.sessions.create({ id: 'session-1', debateId: 'debate-1', status: 'completed', currentStage: 'completed', createdAt: NOW, updatedAt: NOW }))

  const participants = [
    ['participant-a', 'affirmative', '正方'],
    ['participant-b', 'negative', '反方'],
    ['participant-m', 'moderator', '主持人'],
    ['participant-j', 'judge', '裁判']
  ] as const
  for (const [id, role, displayName] of participants) ok(repositories.participants.create({ id, sessionId: 'session-1', role, modelProfileId: 'model-1', displayName, createdAt: NOW, updatedAt: NOW }))

  ok(repositories.turns.create({ id: 'turn-a', sessionId: 'session-1', participantId: 'participant-a', stage: 'affirmative_opening', status: 'completed', content: `正方核心发言\n<script>alert(1)</script>\napiKey=${SECRET}`, createdAt: '2026-07-15T10:01:00.000Z', completedAt: '2026-07-15T10:01:05.000Z' }))
  ok(repositories.turns.create({ id: 'turn-b', sessionId: 'session-1', participantId: 'participant-b', stage: 'negative_opening', status: 'completed', content: `反方核心发言\n${LONG_TEXT}`, createdAt: '2026-07-15T10:02:00.000Z', completedAt: '2026-07-15T10:02:05.000Z' }))
  ok(repositories.turns.create({ id: 'turn-j', sessionId: 'session-1', participantId: 'participant-j', stage: 'adjudication', status: 'completed', content: '裁判最终裁决', createdAt: '2026-07-15T10:03:00.000Z', completedAt: '2026-07-15T10:03:05.000Z' }))

  ok(repositories.research.saveSession({ id: 'research-a', debateSessionId: 'session-1', ownerParticipantId: 'participant-a', ownerRole: 'affirmative', visibility: 'affirmative-private', status: 'completed', createdAt: NOW, updatedAt: NOW }))
  ok(repositories.research.saveSession({ id: 'research-b', debateSessionId: 'session-1', ownerParticipantId: 'participant-b', ownerRole: 'negative', visibility: 'negative-private', status: 'completed', createdAt: NOW, updatedAt: NOW }))
  ok(repositories.research.saveSession({ id: 'research-m', debateSessionId: 'session-1', ownerParticipantId: 'participant-m', ownerRole: 'moderator', visibility: 'moderator-private', status: 'completed', createdAt: NOW, updatedAt: NOW }))
  ok(repositories.research.saveGoal({ id: 'goal-a', debateSessionId: 'session-1', researchSessionId: 'research-a', ownerParticipantId: 'participant-a', visibility: 'affirmative-private', description: '正方研究目标', status: 'completed', createdAt: NOW, updatedAt: NOW }))
  ok(repositories.research.saveAsset({ id: 'asset-private', debateSessionId: 'session-1', researchSessionId: 'research-a', ownerParticipantId: 'participant-a', visibility: 'affirmative-private', kind: 'text', title: '正方私有资料', textContent: `正方秘密研究原文 Authorization: Bearer ${SECRET}`, createdBy: 'user', isOriginal: true, createdAt: NOW }))
  ok(repositories.research.saveSource({ id: 'source-public', debateSessionId: 'session-1', researchSessionId: 'research-m', ownerParticipantId: 'participant-m', visibility: 'public', title: '公开资料来源', url: 'https://example.test/source', summary: '<script>alert(1)</script> 公开摘要', sourceType: 'manual-url', createdAt: NOW }))
  ok(repositories.research.savePublicPool({ id: 'pool-1', debateSessionId: 'session-1', ownerParticipantId: 'participant-m', visibility: 'public', topicDefinition: '讨论自主学习日的教育价值', keyConcepts: ['自主学习'], controversyDirections: ['课时与自主性'], userSubmittedSourceIds: ['source-public'], factBoundaries: ['不讨论联网资料'], moderatorNotes: '公共说明', createdAt: NOW, updatedAt: NOW }))
  ok(repositories.research.createEvidence(
    { id: 'evidence-1', debateSessionId: 'session-1', publicCode: 'A-S1', submittedByParticipantId: 'participant-a', submitterRole: 'affirmative', sourceId: 'source-public', title: '公开证据标题', summary: '公开证据摘要', sourceUrl: 'https://example.test/source', currentStatus: 'unverified', createdAt: NOW },
    { id: 'history-1', debateSessionId: 'session-1', evidenceId: 'evidence-1', toStatus: 'unverified', changedBy: 'participant-a', note: '首次发布', createdAt: NOW }
  ))
  ok(repositories.research.changeEvidenceStatus('evidence-1', 'supported', { id: 'history-2', debateSessionId: 'session-1', evidenceId: 'evidence-1', fromStatus: 'unverified', toStatus: 'supported', changedBy: 'participant-m', note: '主持人确认', createdAt: '2026-07-15T10:04:00.000Z' }))
}

function ok(result: PersistenceResult<unknown>): void {
  if (!result.ok) throw result.error
}

function sequenceId(prefix: string): () => string {
  let index = 0
  return () => `${prefix}-${++index}`
}
