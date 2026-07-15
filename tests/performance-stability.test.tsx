import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DebateHistoryApplication,
  ExportApplication,
  initializeDebateDesktopApplication,
  type DebateDesktopApplication
} from '../src/application'
import type { ExportFileStore } from '../src/export'
import { PerformanceMetricsCollector } from '../src/observability'
import { initializePersistence, type PersistenceContext, type PersistenceResult } from '../src/persistence'
import { HomePage } from '../src/renderer/src/pages/HomePage'
import { MemoryCredentialStore } from '../src/security'
import type { DebateExportRecordDto, DebateHistorySummaryDto } from '../src/shared/ipc-contract'

const directories: string[] = []
const contexts: PersistenceContext[] = []
const applications: DebateDesktopApplication[] = []
const NOW = '2026-07-15T12:00:00.000Z'

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const context of contexts.splice(0)) context.database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('product stability under long local workloads', () => {
  it('collects bounded content-free performance diagnostics', () => {
    const metrics = new PerformanceMetricsCollector({
      now: () => new Date('2026-07-15T12:00:10.000Z'),
      memoryUsage: () => ({ rss: 128 * 1024 * 1024 }),
      maxSamples: 25
    })
    for (let index = 0; index < 80; index += 1) metrics.recordSQLite(index / 10)
    metrics.recordRenderer(4.2)
    metrics.sessionStarted('session-performance', '2026-07-15T12:00:00.000Z')
    metrics.turnStarted('session-performance', 'turn-private', '2026-07-15T12:00:01.000Z')
    metrics.turnFinished('session-performance', 'turn-private', '2026-07-15T12:00:03.000Z', 12_345)
    metrics.sessionFinished('session-performance', '2026-07-15T12:00:10.000Z', 'completed')

    const snapshot = metrics.snapshot()
    expect(snapshot.sqlite.count).toBe(25)
    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: 'session-performance', totalDurationMs: 10_000, turnCount: 1,
      averageResponseMs: 2_000, maxGenerationCharacters: 12_345
    })
    expect(snapshot.memoryPeakBytes).toBe(128 * 1024 * 1024)
    expect(JSON.stringify(snapshot)).not.toContain('private research body')
  })

  it('pages 60 long turns, 2500 events, 300 evidence records, and 220 histories without full reads', () => {
    const fixture = createPersistence()
    seedCompletedDebate(fixture.context, { turnCount: 60, eventCount: 2_500, evidenceCount: 300, turnCharacters: 512 })
    seedHistory(fixture.context, 220)

    const pageStarted = performance.now()
    const firstPage = fixture.context.repositories.turns.listPage('session-long', 40)
    const pageDuration = performance.now() - pageStarted
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) return
    expect(firstPage.value.records).toHaveLength(40)
    expect(firstPage.value.nextCursor).toBeDefined()
    expect(firstPage.value.records.at(-1)?.id).toBe('turn-059')
    const secondPage = fixture.context.repositories.turns.listPage('session-long', 40, firstPage.value.nextCursor)
    expect(secondPage.ok && secondPage.value.records).toHaveLength(20)

    const eventStarted = performance.now()
    const eventCount = fixture.context.database.get<{ count: number }>('SELECT COUNT(*) AS count FROM events WHERE session_id = ?', 'session-long')
    const eventDuration = performance.now() - eventStarted
    expect(eventCount).toEqual({ ok: true, value: { count: 2_500 } })

    const evidenceStarted = performance.now()
    const evidence = fixture.context.repositories.research.listEvidence('session-long')
    const evidenceDuration = performance.now() - evidenceStarted
    expect(evidence.ok && evidence.value).toHaveLength(300)

    const historyApplication = new DebateHistoryApplication({ persistence: fixture.context })
    const historyStarted = performance.now()
    const history = historyApplication.listDebates({ status: 'active', sort: 'updated-desc', limit: 51, offset: 0 })
    const historyDuration = performance.now() - historyStarted
    expect(history.ok && history.value).toHaveLength(51)

    expect({ pageDuration, eventDuration, evidenceDuration, historyDuration }).toEqual({
      pageDuration: expect.any(Number), eventDuration: expect.any(Number),
      evidenceDuration: expect.any(Number), historyDuration: expect.any(Number)
    })
    expect(Math.max(pageDuration, eventDuration, evidenceDuration, historyDuration)).toBeLessThan(1_000)
  })

  it('starts a megabyte-scale export without waiting for file I/O and completes in the background', async () => {
    const fixture = createPersistence()
    seedCompletedDebate(fixture.context, { turnCount: 60, eventCount: 100, evidenceCount: 100, turnCharacters: 24_000 })
    const history = new DebateHistoryApplication({ persistence: fixture.context })
    const metrics = new PerformanceMetricsCollector()
    const application = new ExportApplication({
      persistence: fixture.context,
      history,
      appDataDirectory: fixture.directory,
      performanceMetrics: metrics
    })

    const startedAt = performance.now()
    const started = application.exportDebateHtml('debate-long', { includePrivateResearch: true })
    const startDuration = performance.now() - startedAt
    expect(started).toMatchObject({ ok: true, value: { status: 'generating', progress: 0 } })
    expect(startDuration).toBeLessThan(250)
    if (!started.ok) return

    const completed = await waitForExport(application, started.value.exportId)
    expect(completed.fileSize).toBeGreaterThan(1_000_000)
    expect(existsSync(completed.filePath)).toBe(true)
    expect(metrics.snapshot().exports.completed).toBe(1)
  })

  it('loads web summaries by default and fetches the full body only by explicit source lookup', () => {
    const fixture = createPersistence()
    seedCompletedDebate(fixture.context, { turnCount: 1, eventCount: 1, evidenceCount: 0, turnCharacters: 100 })
    const repository = fixture.context.repositories.research
    ok(repository.saveSession({
      id: 'research-summary', debateSessionId: 'session-long', ownerParticipantId: 'participant-a',
      ownerRole: 'affirmative', visibility: 'affirmative-private', status: 'completed', createdAt: NOW, updatedAt: NOW
    }))
    ok(repository.saveSource({
      id: 'source-summary', debateSessionId: 'session-long', researchSessionId: 'research-summary',
      ownerParticipantId: 'participant-a', visibility: 'affirmative-private', title: '长网页',
      url: 'https://example.test/long', summary: '结构化摘要', sourceType: 'manual-url', createdAt: NOW
    }))
    const longBody = `正文不可默认加载-${'资料'.repeat(50_000)}`
    ok(repository.saveFetchedPage({
      id: 'page-summary', debateSessionId: 'session-long', researchSessionId: 'research-summary',
      sourceId: 'source-summary', ownerParticipantId: 'participant-a', visibility: 'affirmative-private',
      url: 'https://example.test/long', finalUrl: 'https://example.test/long', title: '长网页',
      contentType: 'text/html', bodyText: longBody, summary: '结构化摘要', excerpt: '必要摘录',
      bodyCharacters: longBody.length, status: 'completed', fetchedAt: NOW, createdAt: NOW
    }))

    const summaries = repository.listFetchedPageSummaries('session-long')
    expect(summaries.ok).toBe(true)
    if (!summaries.ok) return
    expect(summaries.value[0]).toMatchObject({ bodyText: '', summary: '结构化摘要', bodyCharacters: longBody.length })
    expect(JSON.stringify(summaries.value)).not.toContain('正文不可默认加载')
    const full = repository.findFetchedPageBySource('source-summary')
    expect(full.ok && full.value?.bodyText).toBe(longBody)
  })

  it('cancels an in-flight export and preserves a recoverable record without a partial file', async () => {
    const fixture = createPersistence()
    seedCompletedDebate(fixture.context, { turnCount: 5, eventCount: 5, evidenceCount: 5, turnCharacters: 2_000 })
    const slowStore = new AbortableFileStore()
    const application = new ExportApplication({
      persistence: fixture.context,
      history: new DebateHistoryApplication({ persistence: fixture.context }),
      appDataDirectory: fixture.directory,
      fileStore: slowStore
    })
    const started = application.exportDebateMarkdown('debate-long', { includePrivateResearch: false })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await slowStore.started

    expect(await application.cancelExport(started.value.exportId)).toEqual({ ok: true, value: { cancelled: true } })
    const cancelled = await waitForExport(application, started.value.exportId, 'cancelled')
    expect(cancelled.error?.titleZh).toBe('导出已取消')
    expect(existsSync(cancelled.filePath)).toBe(false)
  })

  it('marks a generating export interrupted after an application restart', async () => {
    const fixture = createPersistence()
    seedCompletedDebate(fixture.context, { turnCount: 1, eventCount: 1, evidenceCount: 0, turnCharacters: 100 })
    ok(fixture.context.repositories.exports.create({
      id: 'export-interrupted', debateId: 'debate-long', type: 'markdown', includePrivateResearch: false,
      filePath: join(fixture.directory, 'exports', 'interrupted.md'), createdAt: NOW, updatedAt: NOW,
      fileSize: 0, status: 'generating', progress: 62
    }))
    fixture.context.database.close()
    contexts.splice(contexts.indexOf(fixture.context), 1)

    const reopened = initializeDebateDesktopApplication({
      appDataDirectory: fixture.directory,
      credentialStore: new MemoryCredentialStore()
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    applications.push(reopened.value)
    const history = reopened.value.exports.getExportHistory()
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.value[0]).toMatchObject({
      exportId: 'export-interrupted', status: 'failed', progress: 62,
      error: { titleZh: '导出因应用关闭而中断' }
    })
  })

  it('renders only one history page smoothly and returns a structured SQLite lock error', () => {
    const fixture = createPersistence()
    seedHistory(fixture.context, 60)
    const rows = new DebateHistoryApplication({ persistence: fixture.context }).listDebates({ limit: 50 })
    expect(rows.ok).toBe(true)
    if (!rows.ok) return
    const renderStarted = performance.now()
    const html = renderToStaticMarkup(<HomePage
      debates={rows.value}
      loading={false}
      hasMore
      onCreate={() => undefined}
      onCreateDemo={() => undefined}
      onOpen={() => undefined}
    />)
    expect(html).toContain('加载更多历史记录')
    expect(performance.now() - renderStarted).toBeLessThan(1_000)

    const second = initializePersistence({ appDataDirectory: fixture.directory })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    contexts.push(second.value)
    ok(fixture.context.database.execute('PRAGMA busy_timeout = 10'))
    ok(second.value.database.execute('BEGIN IMMEDIATE'))
    const locked = fixture.context.repositories.settings.set('lock-probe', { safe: true })
    expect(locked).toMatchObject({ ok: false, error: { code: 'QUERY_FAILED', operation: 'run' } })
    ok(second.value.database.execute('ROLLBACK'))
  })
})

class AbortableFileStore implements ExportFileStore {
  private resolveStarted!: () => void
  readonly started = new Promise<void>((resolve) => { this.resolveStarted = resolve })

  async write(_filePath: string, _content: string, options?: { signal?: AbortSignal }): Promise<number> {
    this.resolveStarted()
    return new Promise<number>((_resolve, reject) => {
      const fail = (): void => {
        const error = new Error('cancelled')
        error.name = 'AbortError'
        reject(error)
      }
      if (options?.signal?.aborted) fail()
      else options?.signal?.addEventListener('abort', fail, { once: true })
    })
  }

  async delete(): Promise<boolean> { return false }
}

function createPersistence(): { directory: string; context: PersistenceContext } {
  const directory = mkdtempSync(join(tmpdir(), 'debate-stability-'))
  directories.push(directory)
  const initialized = initializePersistence({ appDataDirectory: directory })
  if (!initialized.ok) throw initialized.error
  contexts.push(initialized.value)
  return { directory, context: initialized.value }
}

function seedCompletedDebate(context: PersistenceContext, options: {
  turnCount: number
  eventCount: number
  evidenceCount: number
  turnCharacters: number
}): void {
  const repositories = context.repositories
  ok(repositories.providerConnections.create({
    id: 'connection-long', providerId: 'mock', displayName: 'Mock', protocolType: 'mock',
    baseUrl: 'https://mock.invalid/v1', credentialRef: 'reference-only', enabled: true,
    createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.modelProfiles.create({
    id: 'model-long', connectionId: 'connection-long', modelId: 'mock-long', displayName: 'Mock Long',
    capabilities: { textInput: true, imageInput: false, documentInput: false, audioInput: false, videoInput: false, streaming: true, reasoning: false, toolCalling: false, webSearch: false, structuredOutput: false },
    createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.debates.save({
    id: 'debate-long', topic: '长辩论稳定性测试', status: 'completed', freeDebateRounds: 1,
    createdAt: NOW, updatedAt: NOW
  }))
  ok(repositories.sessions.create({
    id: 'session-long', debateId: 'debate-long', status: 'completed', currentStage: 'completed',
    createdAt: NOW, updatedAt: NOW
  }))
  for (const [id, role, name] of [
    ['participant-a', 'affirmative', '正方'], ['participant-b', 'negative', '反方'],
    ['participant-m', 'moderator', '主持人'], ['participant-j', 'judge', '裁判']
  ] as const) {
    ok(repositories.participants.create({ id, sessionId: 'session-long', role, modelProfileId: 'model-long', displayName: name, createdAt: NOW, updatedAt: NOW }))
  }
  for (let index = 0; index < options.turnCount; index += 1) {
    const timestamp = new Date(Date.parse(NOW) + index * 1_000).toISOString()
    ok(repositories.turns.create({
      id: `turn-${String(index).padStart(3, '0')}`, sessionId: 'session-long',
      participantId: index % 2 ? 'participant-b' : 'participant-a',
      stage: index === options.turnCount - 1 ? 'adjudication' : 'free_debate', status: 'completed',
      content: `${index}:${'辩'.repeat(options.turnCharacters)}`, createdAt: timestamp, completedAt: timestamp
    }))
  }
  for (let index = 0; index < options.eventCount; index += 1) {
    ok(repositories.events.create({
      id: `event-${String(index).padStart(5, '0')}`, sessionId: 'session-long', type: 'turnUpdated',
      payloadJson: JSON.stringify({ status: 'saved', index }), createdAt: new Date(Date.parse(NOW) + index).toISOString()
    }))
  }
  for (let index = 0; index < options.evidenceCount; index += 1) {
    const code = `A-S${index + 1}`
    ok(repositories.research.createEvidence({
      id: `evidence-${index}`, debateSessionId: 'session-long', publicCode: code,
      submittedByParticipantId: 'participant-a', submitterRole: 'affirmative',
      title: `证据 ${index + 1}`, summary: '仅保存摘要', currentStatus: 'unverified', createdAt: NOW
    }, {
      id: `evidence-history-${index}`, debateSessionId: 'session-long', evidenceId: `evidence-${index}`,
      toStatus: 'unverified', changedBy: 'participant-a', note: '首次发布', createdAt: NOW
    }))
  }
}

function seedHistory(context: PersistenceContext, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const timestamp = new Date(Date.parse(NOW) - index * 1_000).toISOString()
    ok(context.repositories.debates.save({
      id: `history-debate-${index}`, topic: `历史压力记录 ${index}`, status: 'completed',
      freeDebateRounds: 1, createdAt: timestamp, updatedAt: timestamp
    }))
    ok(context.repositories.sessions.create({
      id: `history-session-${index}`, debateId: `history-debate-${index}`, status: 'completed',
      currentStage: 'completed', createdAt: timestamp, updatedAt: timestamp
    }))
  }
}

async function waitForExport(
  application: ExportApplication,
  exportId: string,
  expected: 'completed' | 'failed' | 'cancelled' = 'completed'
): Promise<DebateExportRecordDto> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const history = application.getExportHistory()
    if (history.ok) {
      const record = history.value.find((candidate) => candidate.exportId === exportId)
      if (record && record.status !== 'generating') {
        expect(record.status).toBe(expected)
        return record
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Export ${exportId} did not finish.`)
}

function ok(result: PersistenceResult<unknown>): void {
  if (!result.ok) throw result.error
}
