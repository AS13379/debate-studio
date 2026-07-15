import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { MockAdapter, MockHttpTransport } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const paths: string[] = []
const applications: DebateDesktopApplication[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-history-'))
  paths.push(path)
  return path
}

function createApplication(path: string, store = new MemoryCredentialStore(), clock = { value: new Date('2026-07-15T00:00:00.000Z') }) {
  const result = initializeDebateDesktopApplication({
    appDataDirectory: path,
    credentialStore: store,
    openAITransport: new MockHttpTransport(),
    mockAdapter: new MockAdapter({ chunks: ['测试发言'], delayMs: 0 }),
    streamWriteThrottleMs: 0,
    now: () => clock.value
  })
  if (!result.ok) throw result.error
  applications.push(result.value)
  return { app: result.value, store, clock }
}

function createDebate(app: DebateDesktopApplication, topic: string) {
  const result = app.configuration.createDebate({
    topic,
    affirmativePosition: '支持',
    negativePosition: '反对',
    freeDebateRounds: 1
  })
  if (!result.ok) throw result.error
  return result.value
}

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('DebateHistoryApplication', () => {
  it('creates metadata, renames, favorites, tags, searches and sorts history', () => {
    const { app, clock } = createApplication(temporaryDirectory())
    const first = createDebate(app, '第一场：城市交通政策')
    clock.value = new Date('2026-07-16T00:00:00.000Z')
    const second = createDebate(app, '第二场：教育政策')

    const initial = app.history.listDebates()
    expect(initial.ok && initial.value.map((item) => item.id)).toEqual([second.id, first.id])

    clock.value = new Date('2026-07-17T00:00:00.000Z')
    expect(app.history.renameDebate(first.id, '重点政策复盘')).toMatchObject({ ok: true, value: { displayTitle: '重点政策复盘' } })
    expect(app.history.favoriteDebate(first.id)).toMatchObject({ ok: true, value: { favorite: true } })
    expect(app.history.addTag(first.id, '政策')).toMatchObject({ ok: true, value: { tags: ['政策'] } })
    expect(app.history.addTag(first.id, '政策')).toMatchObject({ ok: true, value: { tags: ['政策'] } })
    expect(app.history.addTag(first.id, '长期观察')).toMatchObject({ ok: true, value: { tags: ['政策', '长期观察'] } })
    const updatedDescending = app.history.listDebates()
    expect(updatedDescending.ok && updatedDescending.value[0]?.id).toBe(first.id)

    const searched = app.history.listDebates({ search: '重点政策' })
    expect(searched.ok && searched.value.map((item) => item.id)).toEqual([first.id])
    const tagged = app.history.listDebates({ tag: '政策', favoriteOnly: true })
    expect(tagged.ok && tagged.value.map((item) => item.id)).toEqual([first.id])
    const createdAscending = app.history.listDebates({ sort: 'created-asc' })
    expect(createdAscending.ok && createdAscending.value.map((item) => item.id)).toEqual([first.id, second.id])

    expect(app.history.removeTag(first.id, '政策')).toMatchObject({ ok: true, value: { tags: ['长期观察'] } })
    expect(app.history.unfavoriteDebate(first.id)).toMatchObject({ ok: true, value: { favorite: false } })
  })

  it('archives, restores and soft-deletes without removing run data, providers, models or credentials', async () => {
    const { app, store } = createApplication(temporaryDirectory())
    const demo = app.configuration.createMockDemoDebate()
    if (!demo.ok) throw demo.error
    const completed = await app.run.start(demo.value.sessionId)
    expect(completed).toMatchObject({ ok: true, state: { status: 'completed' } })

    const before = app.history.getDebateDetail(demo.value.id)
    expect(before).toMatchObject({
      ok: true,
      value: {
        turnCount: 20,
        models: expect.arrayContaining([expect.objectContaining({ role: 'affirmative', modelId: 'mock-debate-model' })]),
        finalAdjudication: { content: expect.any(String) }
      }
    })
    if (!before.ok) return

    const connection = await app.configuration.saveProviderConnection({
      id: 'history-safe-provider',
      providerId: 'openai',
      displayName: '不受历史删除影响的平台',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true
    })
    if (!connection.ok) throw connection.error
    expect(await app.configuration.saveCredential(connection.value.id, 'sk-history-safe-secret')).toEqual({ ok: true, value: true })

    expect(app.history.archiveDebate(demo.value.id)).toMatchObject({ ok: true, value: { historyStatus: 'archived' } })
    expect(app.history.restoreDebate(demo.value.id)).toMatchObject({ ok: true, value: { historyStatus: 'active' } })
    expect(app.history.deleteDebate(demo.value.id, false)).toMatchObject({ ok: false, error: { code: 'DELETE_CONFIRMATION_REQUIRED' } })
    expect(app.history.deleteDebate(demo.value.id, true)).toMatchObject({ ok: true, value: { historyStatus: 'deleted', turnCount: 20 } })

    const active = app.history.listDebates()
    expect(active.ok && active.value.some((item) => item.id === demo.value.id)).toBe(false)
    const deleted = app.history.listDebates({ status: 'deleted' })
    expect(deleted.ok && deleted.value.some((item) => item.id === demo.value.id)).toBe(true)
    expect(app.configuration.getDebate(demo.value.id).ok).toBe(true)
    expect(app.configuration.listModelProfiles()).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ id: 'mock-demo-profile' })]) })
    expect(await store.getCredential('openai:history-safe-provider')).toEqual({ ok: true, value: 'sk-history-safe-secret' })

    const restored = app.history.restoreDebate(demo.value.id)
    expect(restored).toMatchObject({ ok: true, value: { historyStatus: 'active', turnCount: before.value.turnCount } })
    expect(JSON.stringify(restored)).not.toContain('credentialRef')
    expect(JSON.stringify(restored)).not.toContain('sk-history-safe-secret')
  })

  it('persists favorite, tags and deleted state across an application restart', async () => {
    const path = temporaryDirectory()
    const first = createApplication(path).app
    const debate = createDebate(first, '重启恢复测试')
    expect(first.history.renameDebate(debate.id, '重启后仍存在')).toMatchObject({ ok: true })
    expect(first.history.favoriteDebate(debate.id)).toMatchObject({ ok: true })
    expect(first.history.addTag(debate.id, '恢复')).toMatchObject({ ok: true })
    expect(first.history.deleteDebate(debate.id, true)).toMatchObject({ ok: true })
    await first.close()
    applications.splice(applications.indexOf(first), 1)

    const reopened = createApplication(path).app
    const detail = reopened.history.getDebateDetail(debate.id)
    expect(detail).toMatchObject({
      ok: true,
      value: { displayTitle: '重启后仍存在', favorite: true, historyStatus: 'deleted', tags: ['恢复'] }
    })
    expect(reopened.history.restoreDebate(debate.id)).toMatchObject({ ok: true, value: { historyStatus: 'active' } })
  })
})
