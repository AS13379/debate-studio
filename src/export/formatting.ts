import { redactSensitiveText } from '../security'

const ROLE_LABELS: Record<string, string> = {
  affirmative: '正方',
  negative: '反方',
  moderator: '主持人',
  judge: '裁判',
  unknown: '未知角色'
}

const STAGE_LABELS: Record<string, string> = {
  moderating: '主持与规则说明',
  affirmative_opening: '正方开篇',
  negative_opening: '反方开篇',
  cross_examination: '交叉质询',
  rebuttal: '反驳',
  free_debate: '自由辩论',
  negative_closing: '反方总结',
  affirmative_closing: '正方总结',
  closing: '总结陈词',
  adjudication: '最终裁决'
}

export function roleLabel(role: string): string { return ROLE_LABELS[role] ?? role }
export function stageLabel(stage: string): string { return STAGE_LABELS[stage] ?? stage }

export function safeInline(value: string): string {
  return safeText(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function safeText(value: string): string {
  return redactSensitiveText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function markdownQuote(value: string): string {
  return safeText(value).split(/\r?\n/).map((line) => `> ${line}`).join('\n')
}

export function htmlEscape(value: string): string {
  return redactSensitiveText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatTimestamp(value: string): string {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return safeInline(value)
  return new Date(time).toLocaleString('zh-CN', { hour12: false })
}
