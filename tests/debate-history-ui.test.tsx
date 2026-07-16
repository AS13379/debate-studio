import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeleteDebateConfirmation } from '../src/renderer/src/components/DeleteDebateConfirmation'
import { BatchDeleteConfirmation, HomePage } from '../src/renderer/src/pages/HomePage'
import type { DebateHistoryDetailDto, DebateHistorySummaryDto } from '../src/shared/ipc-contract'

const summary: DebateHistorySummaryDto = {
  id: 'debate-1', sessionId: 'session-1', topic: '原始辩题', customTitle: '长期观察案例',
  displayTitle: '长期观察案例', favorite: true, historyStatus: 'active', tags: ['政策', '收藏'],
  status: 'completed', currentStage: 'completed', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z'
}

describe('debate history UI', () => {
  it('renders searchable history controls, metadata and management entry', () => {
    const html = renderToStaticMarkup(<HomePage debates={[summary]} loading={false} onCreate={() => undefined} onCreateDemo={() => undefined} onOpen={() => undefined} />)
    expect(html).toContain('搜索自定义名称或辩题')
    expect(html).toContain('只看收藏')
    expect(html).toContain('已归档')
    expect(html).toContain('回收站')
    expect(html).toContain('长期观察案例')
    expect(html).toContain('详情、重命名与标签')
    expect(html).toContain('批量收藏')
    expect(html).toContain('导出 HTML')
    expect(html).toContain('全选当前')
  })

  it('shows the actual soft-delete impact and protected external configuration', () => {
    const detail: DebateHistoryDetailDto = {
      ...summary,
      freeDebateRounds: 1,
      models: [],
      research: { status: 'completed', sessionCount: 3, completedSessionCount: 3, indexCount: 12 },
      evidenceCount: 2,
      turnCount: 20,
      eventCount: 61,
      deleteImpact: {
        debateRecords: 1, eventRecords: 61, researchIndexes: 12, evidenceLinks: 2, turnRecords: 20,
        providersAffected: 0, modelProfilesAffected: 0, credentialsAffected: 0
      }
    }
    const html = renderToStaticMarkup(<DeleteDebateConfirmation detail={detail} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />)
    expect(html).toContain('运行事件：61')
    expect(html).toContain('研究索引：12')
    expect(html).toContain('确认软删除')
    expect(html).toContain('Provider、ModelProfile 和系统加密凭据均不会受到影响')
  })

  it('shows a recoverable batch soft-delete confirmation', () => {
    const html = renderToStaticMarkup(<BatchDeleteConfirmation debates={[summary, { ...summary, id: 'debate-2', displayTitle: '第二场' }]} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />)
    expect(html).toContain('将 2 场辩论移入回收站')
    expect(html).toContain('API Key')
    expect(html).toContain('可在回收站恢复')
  })
})
