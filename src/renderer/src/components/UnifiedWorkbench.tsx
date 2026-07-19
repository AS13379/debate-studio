import type { ReactNode } from 'react'

import type { DebateTurnDto } from '../../../shared/ipc-contract'
import brandIconUrl from '../../../../build/icon.svg?url'
import { formatDebateSpeechMarkdown } from '../debate-speech'
import { MarkdownContent } from './MarkdownContent'

export interface WorkbenchNavItem {
  id: string
  label: string
  active: boolean
  onSelect(): void
}

export function WorkbenchShell({
  subtitle,
  version,
  primaryNav,
  managementNav = [],
  mobileNavigation = false,
  children
}: {
  subtitle: string
  version: string
  primaryNav: WorkbenchNavItem[]
  managementNav?: WorkbenchNavItem[]
  mobileNavigation?: boolean
  children: ReactNode
}) {
  const renderGroup = (label: string, items: WorkbenchNavItem[], extraClass = '') => items.length > 0 && (
    <div className={`sidebar-nav-group ${extraClass}`.trim()}>
      <span className="sidebar-nav-label">{label}</span>
      {items.map((item) => <button key={item.id} className={item.active ? 'active' : ''} onClick={item.onSelect}>{item.label}</button>)}
    </div>
  )
  return (
    <div className={`app-shell${mobileNavigation ? ' web-workbench-shell' : ''}`}>
      <aside className="sidebar">
        <div className="brand-mark" aria-hidden="true"><img src={brandIconUrl} alt="" /></div>
        <div className="brand-copy"><strong>Debate Studio</strong><span>{subtitle}</span></div>
        <nav aria-label="主导航">
          {renderGroup('工作台', primaryNav)}
          {renderGroup('管理', managementNav, 'sidebar-nav-settings')}
        </nav>
        <span className="app-version">{version}</span>
      </aside>
      <main className="content-area">{children}</main>
      {mobileNavigation && <nav className="workbench-bottom-nav" aria-label="移动端导航">
        {primaryNav.map((item) => <button key={item.id} className={item.active ? 'active' : ''} onClick={item.onSelect}>{item.label}</button>)}
      </nav>}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions, id }: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  id?: string
}) {
  return <header className="page-header compact">
    <div><p className="eyebrow">{eyebrow}</p><h1 id={id}>{title}</h1><p className="page-description">{description}</p></div>
    {actions && <div className="header-actions">{actions}</div>}
  </header>
}

export type CreationMode = 'auto' | 'assist' | 'manual'

const creationModes: Array<{ id: CreationMode; title: string; description: string; badge?: string }> = [
  { id: 'auto', title: 'AI 自动规划', description: '只填辩题，由 AI 生成可编辑的完整方案。', badge: '推荐' },
  { id: 'assist', title: 'AI 辅助完善', description: '保留你的双方立场，由 AI 扩展并指出研究重点。' },
  { id: 'manual', title: '完全手动', description: '保持原有流程，不调用任何规划模型。' }
]

export function CreationModeSelector({ value, onChange }: { value: CreationMode; onChange(value: CreationMode): void }) {
  return <div className="creation-mode-grid" role="radiogroup" aria-label="创建方式">
    {creationModes.map((item) => <button type="button" role="radio" aria-checked={value === item.id} className={value === item.id ? 'selected' : ''} key={item.id} onClick={() => onChange(item.id)}>
      <span>{item.title}{item.badge && <em>{item.badge}</em>}</span><small>{item.description}</small>
    </button>)}
  </div>
}

export interface RunControlAction {
  id: string
  label: string
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
  onClick(): void
}

export function RunControlBar({ status, statusText, actions }: { status: string; statusText: string; actions: RunControlAction[] }) {
  if (['completed', 'stopped'].includes(status)) {
    return <div className="control-bar panel control-bar-compact"><span>运行控制</span><strong>{statusText}</strong></div>
  }
  return <div className="control-bar panel">
    {actions.map((action) => <button key={action.id} className={`button ${action.tone ?? 'secondary'}`} disabled={action.disabled} title={action.title} onClick={action.onClick}>{action.label}</button>)}
  </div>
}

export interface ParticipantStripItem {
  id: string
  role: string
  roleLabel: string
  name: string
  detail?: string
  slow?: boolean
}

export function ParticipantStrip({ participants }: { participants: ParticipantStripItem[] }) {
  return <div className="participant-strip">
    {participants.map((participant) => <div className={`participant-chip role-${participant.role}`} key={participant.id}>
      <strong>{participant.roleLabel}</strong><span>{participant.name}</span>
      {participant.slow && <small className="slow-model-badge">长思考 · 首字较慢</small>}
      {participant.detail && <small>{participant.detail}</small>}
    </div>)}
  </div>
}

export function DebateTurnCard({ turn, role, name, stageText, statusText, reasoning, failure, footer }: {
  turn: DebateTurnDto
  role: string
  name: string
  stageText: string
  statusText: string
  reasoning?: ReactNode
  failure?: ReactNode
  footer?: ReactNode
}) {
  const speech = formatDebateSpeechMarkdown(turn.content, turn.stage)
  const visibleContent = speech || (['running', 'streaming'].includes(turn.status) ? '正在整理发言…' : '无文本')
  return <article className={`turn-card role-${role}`}>
    <header><div><strong>{name}</strong><span>{stageText}</span></div><span className={`turn-status status-${turn.status}`}>{statusText}</span></header>
    {reasoning}
    <div className="turn-content"><MarkdownContent content={visibleContent} /></div>
    {failure}
    {footer ?? <small>Token 用量：未知</small>}
  </article>
}
