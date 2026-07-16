import { describe, expect, it, vi } from 'vitest'

import type { DebateHistorySummaryDto, DebateStudioApi } from '../src/shared/ipc-contract'
import { executeHistoryBatchAction, summarizeHistoryBatchResult } from '../src/renderer/src/history-batch-actions'

const completed: DebateHistorySummaryDto = {
  id: 'debate-completed', sessionId: 'session-completed', topic: '已完成辩论', displayTitle: '已完成辩论',
  favorite: false, historyStatus: 'active', tags: [], status: 'completed', currentStage: 'completed',
  createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z'
}

function api(overrides: Partial<DebateStudioApi> = {}): DebateStudioApi {
  const ok = async () => ({ ok: true as const, value: {} as never })
  return {
    toggleFavorite: vi.fn(ok), archiveDebate: vi.fn(ok), restoreDebate: vi.fn(ok), deleteDebate: vi.fn(ok),
    exportMarkdown: vi.fn(ok), exportHtml: vi.fn(ok), ...overrides
  } as unknown as DebateStudioApi
}

describe('history batch actions', () => {
  it('soft deletes eligible records sequentially and skips an in-flight debate', async () => {
    const client = api()
    const running = { ...completed, id: 'debate-running', displayTitle: '运行中', status: 'running' }
    const progress: string[] = []
    const result = await executeHistoryBatchAction(client, [completed, running], 'delete', false, (done, total) => progress.push(`${done}/${total}`))

    expect(client.deleteDebate).toHaveBeenCalledOnce()
    expect(client.deleteDebate).toHaveBeenCalledWith({ id: completed.id, confirmed: true })
    expect(result.succeeded).toEqual([completed.id])
    expect(result.skipped).toEqual([expect.objectContaining({ debateId: running.id, reason: expect.stringContaining('请先停止') })])
    expect(progress).toEqual(['1/2', '2/2'])
    expect(summarizeHistoryBatchResult(result)).toBe('软删除：成功 1 场 · 跳过 1 场')
  })

  it('exports only completed debates and forwards the private research choice', async () => {
    const client = api()
    const draft = { ...completed, id: 'debate-draft', displayTitle: '草稿', status: 'draft', currentStage: 'draft' }
    const result = await executeHistoryBatchAction(client, [completed, draft], 'export-html', true)

    expect(client.exportHtml).toHaveBeenCalledOnce()
    expect(client.exportHtml).toHaveBeenCalledWith({ debateId: completed.id, exportOptions: { includePrivateResearch: true } })
    expect(result.skipped).toEqual([expect.objectContaining({ debateId: draft.id, reason: '辩论完成后才能导出。' })])
  })

  it('keeps processing after a structured failure', async () => {
    const toggleFavorite = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { descriptionZh: '数据库暂时锁定' } })
      .mockResolvedValueOnce({ ok: true, value: {} })
    const client = api({ toggleFavorite: toggleFavorite as DebateStudioApi['toggleFavorite'] })
    const second = { ...completed, id: 'debate-second', displayTitle: '第二场' }
    const result = await executeHistoryBatchAction(client, [completed, second], 'favorite')

    expect(result.failed).toEqual([expect.objectContaining({ debateId: completed.id, reason: '数据库暂时锁定' })])
    expect(result.succeeded).toEqual([second.id])
  })
})
