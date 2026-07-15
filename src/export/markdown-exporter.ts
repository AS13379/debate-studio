import type { DebateExporter, DebateExportSnapshot, ExportResearchItem } from './types'
import { formatTimestamp, markdownQuote, roleLabel, safeInline, stageLabel } from './formatting'

export class MarkdownDebateExporter implements DebateExporter {
  readonly type = 'markdown' as const
  readonly extension = 'md'

  render(snapshot: DebateExportSnapshot): string {
    const lines: string[] = [
      `# ${safeInline(snapshot.metadata.title)}`,
      '',
      '## 导出信息',
      '',
      `- 导出时间：${formatTimestamp(snapshot.metadata.generatedAt)}`,
      `- 完成状态：${safeInline(snapshot.metadata.completionStatus)}`,
      `- 创建时间：${formatTimestamp(snapshot.metadata.createdAt)}`,
      `- 包含私有研究：${snapshot.metadata.includePrivateResearch ? '是（请谨慎分享）' : '否'}`,
      '',
      '## 辩题',
      '',
      markdownQuote(snapshot.metadata.topic),
      ''
    ]

    this.optionalSection(lines, '背景说明', snapshot.background)
    this.optionalSection(lines, '正方立场', snapshot.affirmativePosition)
    this.optionalSection(lines, '反方立场', snapshot.negativePosition)

    lines.push('## 使用模型摘要', '')
    if (snapshot.models.length === 0) lines.push('_无模型配置记录。_', '')
    for (const model of snapshot.models) {
      lines.push(`- ${roleLabel(model.role)}（${safeInline(model.participantDisplayName)}）：${safeInline(model.modelDisplayName)} / ${safeInline(model.modelId)} · ${safeInline(model.providerDisplayName)}`)
    }
    lines.push('')

    lines.push('## 研究', '')
    if (snapshot.publicPool) {
      lines.push('### 公共资源池', '')
      lines.push(`**辩题定义**`, '', markdownQuote(snapshot.publicPool.topicDefinition), '')
      this.list(lines, '时间范围', snapshot.publicPool.temporalScope ? [snapshot.publicPool.temporalScope] : [])
      this.list(lines, '地域范围', snapshot.publicPool.geographicScope ? [snapshot.publicPool.geographicScope] : [])
      this.list(lines, '关键概念', snapshot.publicPool.keyConcepts)
      this.list(lines, '争议方向', snapshot.publicPool.controversyDirections)
      this.list(lines, '事实边界', snapshot.publicPool.factBoundaries)
      if (snapshot.publicPool.moderatorNotes) this.optionalSection(lines, '主持人公开说明', snapshot.publicPool.moderatorNotes, 4)
    } else {
      lines.push('_没有公共资源池记录。_', '')
    }

    lines.push('### 双方研究摘要', '')
    for (const summary of snapshot.roleSummaries) {
      lines.push(`- ${roleLabel(summary.role)}：状态 ${safeInline(summary.status)}；目标 ${summary.goalCount}；来源 ${summary.sourceCount}；资料 ${summary.assetCount}；笔记 ${summary.noteCount}；暂定主张 ${summary.claimCount}`)
    }
    lines.push('')
    this.researchItems(lines, '公开研究资料', snapshot.publicResearch)
    if (snapshot.metadata.includePrivateResearch) {
      lines.push('> **隐私提示：本文件包含私有研究内容，请确认接收者和分享范围。**', '')
      this.researchItems(lines, '私有研究资料', snapshot.privateResearch ?? [])
    }

    lines.push('## 公开证据桌', '')
    if (snapshot.evidence.length === 0) lines.push('_没有公开证据。_', '')
    for (const evidence of snapshot.evidence) {
      lines.push(`### 证据 ${safeInline(evidence.publicCode)}：${safeInline(evidence.title)}`, '')
      lines.push(`- 提交方：${roleLabel(evidence.submitterRole)}`)
      lines.push(`- 当前状态：${safeInline(evidence.currentStatus)}`)
      lines.push(`- 提交时间：${formatTimestamp(evidence.createdAt)}`)
      if (evidence.sourceUrl) lines.push(`- 来源：${safeInline(evidence.sourceUrl)}`)
      lines.push('')
      if (evidence.summary) lines.push(markdownQuote(evidence.summary), '')
      lines.push('#### 状态历史', '')
      if (evidence.history.length === 0) lines.push('- 无状态历史。')
      for (const record of evidence.history) {
        lines.push(`- ${formatTimestamp(record.createdAt)} · ${safeInline(record.fromStatus ?? '初始')} → ${safeInline(record.toStatus)} · ${safeInline(record.changedBy)}：${safeInline(record.note)}`)
      }
      lines.push('')
    }

    lines.push('## 正式辩论', '')
    if (snapshot.turns.length === 0) lines.push('_没有可导出的正式发言。_', '')
    for (const turn of snapshot.turns) {
      lines.push(`### ${stageLabel(turn.stage)} · ${roleLabel(turn.role)}`, '')
      lines.push(`- 发言者：${safeInline(turn.participantName)}`)
      lines.push(`- 时间：${formatTimestamp(turn.completedAt ?? turn.createdAt)}`)
      lines.push(`- 状态：${safeInline(turn.status)}`, '')
      lines.push(markdownQuote(turn.content), '')
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
  }

  private optionalSection(lines: string[], title: string, content?: string, level = 2): void {
    if (!content?.trim()) return
    lines.push(`${'#'.repeat(level)} ${title}`, '', markdownQuote(content), '')
  }

  private list(lines: string[], title: string, values: string[]): void {
    if (values.length === 0) return
    lines.push(`**${title}**`, '')
    for (const value of values) lines.push(`- ${safeInline(value)}`)
    lines.push('')
  }

  private researchItems(lines: string[], title: string, items: ExportResearchItem[]): void {
    lines.push(`### ${title}`, '')
    if (items.length === 0) {
      lines.push('_没有可导出的资料。_', '')
      return
    }
    for (const item of items) {
      lines.push(`#### ${roleLabel(item.ownerRole)} · ${safeInline(item.title)}`, '')
      lines.push(`- 类型：${safeInline(item.kind)}`)
      lines.push(`- 可见性：${safeInline(item.visibility)}`)
      if (item.sourceType) lines.push(`- 来源类型：${safeInline(item.sourceType)}`)
      if (item.sourceUrl) lines.push(`- 来源：${safeInline(item.sourceUrl)}`)
      if (item.publishedAt) lines.push(`- 发布时间：${formatTimestamp(item.publishedAt)}`)
      lines.push('')
      if (item.content) lines.push(markdownQuote(item.content), '')
    }
  }
}
