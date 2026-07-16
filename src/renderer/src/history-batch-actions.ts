import type { DebateHistorySummaryDto, DebateStudioApi } from '../../shared/ipc-contract'

export type HistoryBatchAction =
  | 'favorite'
  | 'unfavorite'
  | 'archive'
  | 'restore'
  | 'delete'
  | 'export-markdown'
  | 'export-html'

export interface HistoryBatchIssue {
  debateId: string
  title: string
  reason: string
}

export interface HistoryBatchResult {
  action: HistoryBatchAction
  succeeded: string[]
  skipped: HistoryBatchIssue[]
  failed: HistoryBatchIssue[]
}

type HistoryBatchApi = Pick<
  DebateStudioApi,
  'toggleFavorite' | 'archiveDebate' | 'restoreDebate' | 'deleteDebate' | 'exportMarkdown' | 'exportHtml'
>

const IN_FLIGHT_STATUSES = new Set(['running', 'streaming'])

export async function executeHistoryBatchAction(
  api: HistoryBatchApi,
  debates: DebateHistorySummaryDto[],
  action: HistoryBatchAction,
  includePrivateResearch = false,
  onProgress: (completed: number, total: number) => void = () => undefined
): Promise<HistoryBatchResult> {
  const result: HistoryBatchResult = { action, succeeded: [], skipped: [], failed: [] }

  for (const [index, debate] of debates.entries()) {
    const skipReason = getSkipReason(debate, action)
    if (skipReason) {
      result.skipped.push(issue(debate, skipReason))
      onProgress(index + 1, debates.length)
      continue
    }

    try {
      const operation = await runAction(api, debate, action, includePrivateResearch)
      if (operation.ok) result.succeeded.push(debate.id)
      else result.failed.push(issue(debate, operation.error.descriptionZh))
    } catch (error) {
      result.failed.push(issue(debate, error instanceof Error ? error.message : '未知错误'))
    }
    onProgress(index + 1, debates.length)
  }

  return result
}

export function summarizeHistoryBatchResult(result: HistoryBatchResult): string {
  const label = {
    favorite: '收藏', unfavorite: '取消收藏', archive: '归档', restore: '恢复', delete: '软删除',
    'export-markdown': '导出 Markdown', 'export-html': '导出 HTML'
  }[result.action]
  const success = result.action.startsWith('export-')
    ? `已创建 ${result.succeeded.length} 个任务`
    : `成功 ${result.succeeded.length} 场`
  const parts = [success]
  if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 场`)
  if (result.failed.length) parts.push(`失败 ${result.failed.length} 场`)
  return `${label}：${parts.join(' · ')}`
}

function getSkipReason(debate: DebateHistorySummaryDto, action: HistoryBatchAction): string | undefined {
  if (['archive', 'delete'].includes(action) && IN_FLIGHT_STATUSES.has(debate.status)) {
    return '辩论正在运行，请先停止后再整理记录。'
  }
  if (action === 'archive' && debate.historyStatus !== 'active') return '只有当前记录可以归档。'
  if (action === 'restore' && debate.historyStatus === 'active') return '记录已在当前列表。'
  if (action === 'delete' && debate.historyStatus === 'deleted') return '记录已在回收站。'
  if (action.startsWith('export-') && debate.status !== 'completed') return '辩论完成后才能导出。'
  return undefined
}

async function runAction(
  api: HistoryBatchApi,
  debate: DebateHistorySummaryDto,
  action: HistoryBatchAction,
  includePrivateResearch: boolean
) {
  switch (action) {
    case 'favorite': return api.toggleFavorite({ id: debate.id, favorite: true })
    case 'unfavorite': return api.toggleFavorite({ id: debate.id, favorite: false })
    case 'archive': return api.archiveDebate({ id: debate.id })
    case 'restore': return api.restoreDebate({ id: debate.id })
    case 'delete': return api.deleteDebate({ id: debate.id, confirmed: true })
    case 'export-markdown': return api.exportMarkdown({ debateId: debate.id, exportOptions: { includePrivateResearch } })
    case 'export-html': return api.exportHtml({ debateId: debate.id, exportOptions: { includePrivateResearch } })
  }
}

function issue(debate: DebateHistorySummaryDto, reason: string): HistoryBatchIssue {
  return { debateId: debate.id, title: debate.displayTitle, reason }
}
