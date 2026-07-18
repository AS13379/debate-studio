import { useEffect, useRef, useState, type FormEvent } from 'react'

import type {
  DebateDetailDto,
  DebatePlanningDepthDto,
  DebatePlannerProgressDto,
  ModelProfileDto,
  PlannedDebateDto,
  ProviderConnectionDto
} from '../../../shared/ipc-contract'
import { OperationProgressDialog, type OperationLogItem } from '../components/OperationProgressDialog'
import { slowModelNotice } from '../model-latency'

export interface NewDebatePageProps {
  onBack(): void
  onCreated(debate: DebateDetailDto): void
  onOpenModels(): void
}

type CreationMode = 'auto' | 'assist' | 'manual'
type PlanField = 'background' | 'affirmative' | 'negative' | 'questions' | 'research' | 'evidence'

interface RoleModels {
  affirmative: string
  negative: string
  moderator: string
  judge: string
}

const EMPTY_ROLE_MODELS: RoleModels = { affirmative: '', negative: '', moderator: '', judge: '' }

const creationModes: Array<{ id: CreationMode; title: string; description: string; badge?: string }> = [
  { id: 'auto', title: 'AI 自动规划', description: '只填辩题，由 AI 生成可编辑的完整方案。', badge: '推荐' },
  { id: 'assist', title: 'AI 辅助完善', description: '保留你的双方立场，由 AI 扩展并指出研究重点。' },
  { id: 'manual', title: '完全手动', description: '保持原有流程，不调用任何规划模型。' }
]

export function NewDebatePage({ onBack, onCreated, onOpenModels }: NewDebatePageProps) {
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([])
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [roleModels, setRoleModels] = useState<RoleModels>(EMPTY_ROLE_MODELS)
  const [mode, setMode] = useState<CreationMode>('auto')
  const [topic, setTopic] = useState('')
  const [background, setBackground] = useState('')
  const [affirmativePosition, setAffirmativePosition] = useState('')
  const [negativePosition, setNegativePosition] = useState('')
  const [domain, setDomain] = useState('')
  const [depth, setDepth] = useState<DebatePlanningDepthDto>('standard')
  const [keyQuestions, setKeyQuestions] = useState<string[]>([])
  const [researchDirections, setResearchDirections] = useState<string[]>([])
  const [evidenceSuggestions, setEvidenceSuggestions] = useState<string[]>([])
  const [freeDebateRounds, setFreeDebateRounds] = useState(1)
  const [planned, setPlanned] = useState<PlannedDebateDto>()
  const [editingField, setEditingField] = useState<PlanField>()
  const [error, setError] = useState<string>()
  const [planning, setPlanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const activePlanningOperation = useRef<string | undefined>(undefined)
  const [plannerDialog, setPlannerDialog] = useState<{
    open: boolean; running: boolean; progress: number; description: string; logs: OperationLogItem[]; rawInput?: string; rawOutput?: string
  }>({ open: false, running: false, progress: 0, description: '', logs: [] })

  const refreshConfiguration = async (): Promise<void> => {
    const [connectionResult, profileResult] = await Promise.all([
      window.debateStudio.listProviderConnections(),
      window.debateStudio.listModelProfiles()
    ])
    if (connectionResult.ok) setConnections(connectionResult.value)
    else setError(connectionResult.error.descriptionZh)
    if (profileResult.ok) {
      setProfiles(profileResult.value)
      const first = profileResult.value[0]?.id
      if (first) setRoleModels((current) => current.affirmative ? current : {
        affirmative: first, negative: first, moderator: first, judge: ''
      })
    } else setError(profileResult.error.descriptionZh)
  }

  useEffect(() => { void refreshConfiguration() }, [])
  useEffect(() => window.debateStudio.onPlannerProgress((event) => {
    if (event.operationId !== activePlanningOperation.current) return
    setPlannerDialog((current) => plannerDialogFromEvent(current, event))
  }), [])

  const generatePlan = async (): Promise<void> => {
    setError(undefined)
    if (!topic.trim()) { setError('请先输入辩题。'); return }
    if (mode === 'assist' && (!affirmativePosition.trim() || !negativePosition.trim())) {
      setError('AI 辅助完善需要先填写正方和反方初始立场。')
      return
    }
    if (mode === 'manual') return
    const operationId = globalThis.crypto.randomUUID()
    activePlanningOperation.current = operationId
    setPlannerDialog({
      open: true, running: true, progress: 5, description: '正在准备辩题和规划模型。',
      logs: [{ id: 'started', label: '开始生成辩论方案', detail: `辩题：${topic.trim()}` }]
    })
    setPlanning(true)
    try {
      const result = await window.debateStudio.planDebate({
        operationId,
        mode,
        topic,
        background: background || undefined,
        domain: domain || undefined,
        depth,
        affirmativePosition: mode === 'assist' ? affirmativePosition : undefined,
        negativePosition: mode === 'assist' ? negativePosition : undefined
      })
      if (!result.ok) {
        setPlanned(undefined)
        setError(`${result.error.titleZh}：${result.error.descriptionZh} ${result.error.suggestedActionZh}`)
        return
      }
      const plan = result.value.plan
      setPlanned(result.value)
      setBackground(plan.background)
      setAffirmativePosition(plan.affirmativePosition)
      setNegativePosition(plan.negativePosition)
      setKeyQuestions(plan.keyQuestions)
      setResearchDirections(plan.researchDirections)
      setEvidenceSuggestions(plan.evidenceSuggestions)
      setEditingField(undefined)
      if (profiles.some((profile) => profile.id === result.value.provenance.modelProfileId)) {
        setRoleModels((current) => ({
          affirmative: current.affirmative || result.value.provenance.modelProfileId,
          negative: current.negative || result.value.provenance.modelProfileId,
          moderator: current.moderator || result.value.provenance.modelProfileId,
          judge: current.judge
        }))
      }
    } catch {
      setPlanned(undefined)
      setError('辩题规划服务暂时不可用，请重启应用或检查模型配置后重试。')
      setPlannerDialog((current) => ({ ...current, running: false, progress: 100, description: '主进程没有返回规划结果。', logs: [...current.logs, { id: 'ipc-failed', label: '规划服务暂时不可用', tone: 'error' }] }))
    } finally {
      setPlanning(false)
    }
  }

  const submitDebate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (mode !== 'manual' && !planned) { setError('请先生成并确认辩论方案。'); return }
    setSaving(true)
    setError(undefined)
    const planningConfirmation: PlannedDebateDto | undefined = planned && mode !== 'manual' ? {
      mode: planned.mode,
      plan: { topic: topic.trim(), background: background.trim(), affirmativePosition: affirmativePosition.trim(), negativePosition: negativePosition.trim(), keyQuestions, researchDirections, evidenceSuggestions },
      provenance: planned.provenance
    } : undefined
    const created = await window.debateStudio.createDebate({
      topic,
      background,
      affirmativePosition,
      negativePosition,
      freeDebateRounds,
      planning: planningConfirmation
    })
    if (!created.ok) {
      setError(created.error.descriptionZh)
      setSaving(false)
      return
    }
    const bound = await window.debateStudio.saveParticipantBindings({
      sessionId: created.value.sessionId,
      affirmative: { modelProfileId: roleModels.affirmative, displayName: '正方' },
      negative: { modelProfileId: roleModels.negative, displayName: '反方' },
      moderator: { modelProfileId: roleModels.moderator, displayName: '主持人' },
      judge: roleModels.judge ? { modelProfileId: roleModels.judge, displayName: '裁判' } : undefined
    })
    setSaving(false)
    if (!bound.ok) setError(bound.error.descriptionZh)
    else onCreated(bound.value)
  }

  const switchMode = (next: CreationMode): void => {
    setMode(next)
    setPlanned(undefined)
    setEditingField(undefined)
    setError(undefined)
  }

  const useAffirmativeForCoreRoles = (): void => {
    if (!roleModels.affirmative) return
    setRoleModels((current) => ({ ...current, negative: current.affirmative, moderator: current.affirmative }))
  }

  const profileLabel = (profile: ModelProfileDto): string => {
    const connection = connections.find((candidate) => candidate.id === profile.connectionId)
    return `${profile.displayName} · ${profile.modelId}${connection ? ` · ${connection.displayName}` : ''}`
  }

  const readyForConfiguration = mode === 'manual' || Boolean(planned)
  const selectedSlowModels = [...new Set(Object.values(roleModels)
    .map((id) => profiles.find((profile) => profile.id === id)?.modelId)
    .filter((modelId): modelId is string => Boolean(modelId && slowModelNotice(modelId))))]
  const canCreate = readyForConfiguration && topic.trim() && background.trim() && affirmativePosition.trim()
    && negativePosition.trim() && Number.isInteger(freeDebateRounds) && freeDebateRounds >= 1 && freeDebateRounds <= 20
    && roleModels.affirmative && roleModels.negative && roleModels.moderator

  return (
    <section className="page-stack new-debate-page" aria-labelledby="new-debate-title">
      <header className="page-header compact">
        <div><p className="eyebrow">Debate Planner</p><h1 id="new-debate-title">新建辩论</h1><p className="page-description">只输入一个辩题，也可以先生成方案、确认后再创建。</p></div>
        <button className="button ghost header-back-button" onClick={onBack}>返回列表</button>
      </header>

      <OperationProgressDialog
        open={plannerDialog.open}
        running={plannerDialog.running}
        title="AI 正在规划辩论"
        description={plannerDialog.description}
        progress={plannerDialog.progress}
        logs={plannerDialog.logs}
        rawInput={plannerDialog.rawInput}
        rawOutput={plannerDialog.rawOutput}
        onCancel={() => {
          const operationId = activePlanningOperation.current
          if (operationId) void window.debateStudio.cancelDebatePlanning({ operationId })
          setPlannerDialog((current) => ({
            ...current,
            running: false,
            description: '已请求停止规划；不会创建 Session。',
            logs: [...current.logs, { id: `cancel-${Date.now()}`, label: '用户停止了当前规划', tone: 'error' }]
          }))
        }}
        onClose={() => setPlannerDialog((current) => ({ ...current, open: false }))}
      />

      {error && <div className="notice error" role="alert">{error}</div>}
      {selectedSlowModels.length > 0 && <div className="notice warning" role="status">
        当前选择包含长思考模型（{selectedSlowModels.join('、')}）。生成前可能长时间没有正文，进度窗口会持续显示当前状态。
      </div>}

      <section className="creation-mode-panel panel">
        <div className="section-heading"><div><h2>创建方式</h2><span>AI 只返回最终结构化方案，不保存分析过程</span></div></div>
        <div className="creation-mode-grid" role="radiogroup" aria-label="创建方式">
          {creationModes.map((item) => <button type="button" role="radio" aria-checked={mode === item.id} className={mode === item.id ? 'selected' : ''} key={item.id} onClick={() => switchMode(item.id)}>
            <span>{item.title}{item.badge && <em>{item.badge}</em>}</span><small>{item.description}</small>
          </button>)}
        </div>
      </section>

      <form className="planner-form" onSubmit={(event) => void submitDebate(event)}>
        <section className="panel planner-input-panel">
          <label className="field">辩题<input name="topic" value={topic} required onChange={(event) => { setTopic(event.target.value); setPlanned(undefined) }} placeholder="例如：大学是否应将每周一天设为无课自主学习日？" /></label>
          {mode === 'auto' && <div className="planner-options">
            <label className="field">背景说明（可选）<textarea value={background} rows={2} onChange={(event) => setBackground(event.target.value)} placeholder="可留空，让 AI 自动补全范围和背景" /></label>
            <label className="field">领域（可选）<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="教育、科技、公共政策…" /></label>
            <label className="field">期望深度<select value={depth} onChange={(event) => setDepth(event.target.value as DebatePlanningDepthDto)}><option value="light">简要</option><option value="standard">标准</option><option value="deep">深入</option></select></label>
          </div>}
          {mode === 'assist' && <div className="assisted-positions">
            <label className="field">正方初始立场<textarea value={affirmativePosition} required rows={3} onChange={(event) => setAffirmativePosition(event.target.value)} /></label>
            <label className="field">反方初始立场<textarea value={negativePosition} required rows={3} onChange={(event) => setNegativePosition(event.target.value)} /></label>
          </div>}
          {mode === 'manual' && <div className="manual-debate-fields">
            <label className="field span-2">背景说明<textarea value={background} required rows={3} onChange={(event) => setBackground(event.target.value)} /></label>
            <label className="field">正方立场<textarea value={affirmativePosition} required rows={4} onChange={(event) => setAffirmativePosition(event.target.value)} /></label>
            <label className="field">反方立场<textarea value={negativePosition} required rows={4} onChange={(event) => setNegativePosition(event.target.value)} /></label>
          </div>}
          {mode !== 'manual' && <div className="planner-generate-row">
            <div><strong>{planned ? '方案已生成，可继续调整' : '尚未创建任何 Session'}</strong><span>使用“模型策略 → 辩题规划”模型；重新生成会替换当前未确认方案。</span></div>
            <button type="button" className="button primary" disabled={planning || !topic.trim()} onClick={() => void generatePlan()}>{planning ? '正在规划…' : planned ? '重新生成方案' : '生成辩论方案'}</button>
          </div>}
        </section>

        {planned && <PlanReview
          planned={planned} editingField={editingField} onEditingField={setEditingField}
          background={background} onBackground={setBackground}
          affirmative={affirmativePosition} onAffirmative={setAffirmativePosition}
          negative={negativePosition} onNegative={setNegativePosition}
          questions={keyQuestions} onQuestions={setKeyQuestions}
          research={researchDirections} onResearch={setResearchDirections}
          evidence={evidenceSuggestions} onEvidence={setEvidenceSuggestions}
        />}

        {readyForConfiguration && <section className="panel model-binding-panel">
          <div className="section-heading"><div><h2>辩论模型</h2><span>{connections.length} 个连接 · {profiles.length} 个模型；规划模型不会占用这里的角色绑定</span></div><button type="button" className="button secondary" onClick={onOpenModels}>模型与平台</button></div>
          <div className="model-binding-grid">
            <label className="field">自由辩论轮数<input type="number" min="1" max="20" value={freeDebateRounds} onChange={(event) => setFreeDebateRounds(Number(event.target.value))} /></label>
            <div />
            <ModelSelect label="正方模型" value={roleModels.affirmative} profiles={profiles} profileLabel={profileLabel} required onChange={(value) => setRoleModels((current) => ({ ...current, affirmative: value }))} />
            <div className="quick-binding"><button type="button" className="button secondary" disabled={!roleModels.affirmative} onClick={useAffirmativeForCoreRoles}>同一模型用于三个核心角色</button></div>
            <ModelSelect label="反方模型" value={roleModels.negative} profiles={profiles} profileLabel={profileLabel} required onChange={(value) => setRoleModels((current) => ({ ...current, negative: value }))} />
            <ModelSelect label="主持人模型" value={roleModels.moderator} profiles={profiles} profileLabel={profileLabel} required onChange={(value) => setRoleModels((current) => ({ ...current, moderator: value }))} />
            <ModelSelect label="裁判模型（可选）" value={roleModels.judge} profiles={profiles} profileLabel={profileLabel} onChange={(value) => setRoleModels((current) => ({ ...current, judge: value }))} />
          </div>
          {profiles.length === 0 && <div className="notice">尚无 ModelProfile。请先在“设置 → 模型与平台”中创建模型，或使用 Mock 示例。</div>}
        </section>}

        <div className="form-actions planner-final-actions">
          <button type="button" className="button ghost" onClick={onBack}>取消</button>
          <button className="button primary" disabled={saving || !canCreate}>{saving ? '正在创建…' : mode === 'manual' ? '创建并检查配置' : '确认方案并创建'}</button>
        </div>
      </form>
    </section>
  )
}

function plannerDialogFromEvent(
  current: { open: boolean; running: boolean; progress: number; description: string; logs: OperationLogItem[]; rawInput?: string; rawOutput?: string },
  event: DebatePlannerProgressDto
): typeof current {
  const tone: OperationLogItem['tone'] = event.stage === 'failed' ? 'error' : event.stage === 'completed' ? 'success' : 'normal'
  const nextItem: OperationLogItem = { id: `${event.stage}-${event.progress}-${event.rawOutput?.length ?? 0}`, label: event.labelZh, detail: event.detailZh, tone }
  const withoutPreviousStreaming = event.stage === 'streaming'
    ? current.logs.filter((item) => !item.id.startsWith('streaming-'))
    : current.logs
  return {
    ...current,
    open: true,
    running: event.stage !== 'completed' && event.stage !== 'failed',
    progress: event.progress,
    description: event.detailZh ?? event.labelZh,
    logs: [...withoutPreviousStreaming, nextItem].slice(-12),
    rawInput: event.rawInput ?? current.rawInput,
    rawOutput: event.rawOutput ?? current.rawOutput
  }
}

interface PlanReviewProps {
  planned: PlannedDebateDto
  editingField?: PlanField
  onEditingField(value?: PlanField): void
  background: string; onBackground(value: string): void
  affirmative: string; onAffirmative(value: string): void
  negative: string; onNegative(value: string): void
  questions: string[]; onQuestions(value: string[]): void
  research: string[]; onResearch(value: string[]): void
  evidence: string[]; onEvidence(value: string[]): void
}

export function PlanReview(props: PlanReviewProps) {
  const fields: Array<{ id: PlanField; label: string; value: string; rows: number; change(value: string): void }> = [
    { id: 'background', label: '背景说明', value: props.background, rows: 3, change: props.onBackground },
    { id: 'affirmative', label: '正方立场', value: props.affirmative, rows: 4, change: props.onAffirmative },
    { id: 'negative', label: '反方立场', value: props.negative, rows: 4, change: props.onNegative },
    { id: 'questions', label: '核心争议与潜在漏洞', value: props.questions.join('\n'), rows: 4, change: (value) => props.onQuestions(lines(value)) },
    { id: 'research', label: '研究方向', value: props.research.join('\n'), rows: 4, change: (value) => props.onResearch(lines(value)) },
    { id: 'evidence', label: '建议证据类型', value: props.evidence.join('\n'), rows: 3, change: (value) => props.onEvidence(lines(value)) }
  ]
  return <section className="panel plan-review-panel">
    <div className="section-heading"><div><span className="eyebrow">AI 生成方案</span><h2>确认并按需编辑</h2></div><small>{props.planned.provenance.modelId} · {props.planned.provenance.promptVersion} · {new Date(props.planned.provenance.createdAt).toLocaleString('zh-CN')}</small></div>
    <div className="plan-review-grid">{fields.map((field) => {
      const editing = props.editingField === field.id
      return <article className={editing ? 'editing' : ''} key={field.id}><header><strong>{field.label}</strong><button type="button" className="button ghost" onClick={() => props.onEditingField(editing ? undefined : field.id)}>{editing ? '完成' : '编辑'}</button></header><textarea aria-label={field.label} readOnly={!editing} value={field.value} rows={field.rows} onChange={(event) => field.change(event.target.value)} /></article>
    })}</div>
    <p className="plan-confirmation-note">当前仅保留最终结构化方案。点击“确认方案并创建”后，才会写入 Debate、Session 和 Planner 版本记录。</p>
  </section>
}

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12)
}

function ModelSelect({ label, value, profiles, profileLabel, required = false, onChange }: {
  label: string; value: string; profiles: ModelProfileDto[]; profileLabel(profile: ModelProfileDto): string; required?: boolean; onChange(value: string): void
}) {
  return <label className="field">{label}<select value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">{required ? '请选择模型' : '不配置独立裁判'}</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profileLabel(profile)}</option>)}</select></label>
}
