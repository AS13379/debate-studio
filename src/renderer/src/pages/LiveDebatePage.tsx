import { useEffect, useMemo, useState } from 'react'

import type {
  DebateDetailDto,
  DebateParticipantRoleDto,
  DebateSetupDto,
  DebateTurnDto,
  ModelProfileDto,
  ParticipantBindingDto,
  RunCommandResultDto,
  RunErrorDto
} from '../../../shared/ipc-contract'
import { ErrorRecoveryPanel } from '../components/ErrorRecoveryPanel'
import { DebateProgress } from '../components/DebateProgress'
import { ResearchPanel } from '../components/ResearchPanel'
import { DebateQualityPanel } from '../components/DebateQualityPanel'
import { DebateInlineManagement } from '../components/DebateInlineManagement'
import { DebateTurnCard, PageHeader, ParticipantStrip, RunControlBar } from '../components/UnifiedWorkbench'
import { applyRunEvent, type LiveReasoningSnapshot, type LiveRunSnapshot } from '../run-state'
import { stageLabel, statusLabel } from './HomePage'
import { isSlowFirstTokenModel } from '../model-latency'

export interface LiveDebatePageProps {
  debateId: string
  onBack(): void
  onOpenModels(): void
  onHistoryChanged?(): void | Promise<void>
}

export function isDebateStartBlocked(setup?: Pick<DebateSetupDto, 'validation'>): boolean {
  return !setup?.validation.valid
}

const RESEARCH_PREPARATION_STAGES = new Set([
  'validating', 'moderating', 'public_pool', 'affirmative_planning', 'negative_planning',
  'affirmative_research', 'negative_research', 'argument_drafting'
])

export function isResearchPreparationStage(stage: string): boolean {
  return RESEARCH_PREPARATION_STAGES.has(stage)
}

export function LiveDebatePage({ debateId, onBack, onOpenModels, onHistoryChanged = () => undefined }: LiveDebatePageProps) {
  const [detail, setDetail] = useState<DebateDetailDto>()
  const [setup, setSetup] = useState<DebateSetupDto>()
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot>({ turns: [] })
  const [error, setError] = useState<string>()
  const [commandFailure, setCommandFailure] = useState<RunErrorDto>()
  const [loading, setLoading] = useState(true)
  const [showRoleEditor, setShowRoleEditor] = useState(false)
  const [researchVersion, setResearchVersion] = useState(0)
  const [qualityVersion, setQualityVersion] = useState(0)
  const [olderTurnsCursor, setOlderTurnsCursor] = useState<{ createdAt: string; id: string }>()
  const [loadingOlderTurns, setLoadingOlderTurns] = useState(false)

  const reload = async (): Promise<void> => {
    const detailResult = await window.debateStudio.getDebate({ id: debateId })
    if (!detailResult.ok) {
      setError(detailResult.error.descriptionZh)
      setLoading(false)
      return
    }
    const sessionId = detailResult.value.sessionId
    const [stateResult, turnsResult, setupResult] = await Promise.all([
      window.debateStudio.getRunState({ sessionId }),
      window.debateStudio.listDebateTurnsPage({ sessionId, limit: 40 }),
      window.debateStudio.loadDebateSetup({ sessionId })
    ])
    setDetail(detailResult.value)
    if (stateResult.ok) setSnapshot({ state: stateResult.state, turns: turnsResult.ok ? turnsResult.value.turns : [] })
    else setCommandFailure(stateResult.error)
    if (setupResult.ok) setSetup(setupResult.value)
    else setError(setupResult.error.descriptionZh)
    if (turnsResult.ok) setOlderTurnsCursor(turnsResult.value.nextCursor)
    else setError(turnsResult.error.descriptionZh)
    setLoading(false)
  }

  const loadOlderTurns = async (): Promise<void> => {
    if (!detail || !olderTurnsCursor || loadingOlderTurns) return
    setLoadingOlderTurns(true)
    const result = await window.debateStudio.listDebateTurnsPage({
      sessionId: detail.sessionId,
      limit: 40,
      before: olderTurnsCursor
    })
    if (!result.ok) setError(result.error.descriptionZh)
    else {
      setSnapshot((current) => {
        const known = new Set(current.turns.map((turn) => turn.id))
        return { ...current, turns: [...result.value.turns.filter((turn) => !known.has(turn.id)), ...current.turns] }
      })
      setOlderTurnsCursor(result.value.nextCursor)
    }
    setLoadingOlderTurns(false)
  }

  useEffect(() => { void reload() }, [debateId])
  useEffect(() => window.debateStudio.onRunEvent((event) => {
    if (event.sessionId === detail?.sessionId) {
      setSnapshot((current) => applyRunEvent(current, event))
      if (event.type === 'turnCompleted' || (event.type === 'turnUpdated' && ['public_pool', 'affirmative_research', 'negative_research'].includes(event.stage))) {
        setResearchVersion((current) => current + 1)
      }
    }
  }), [detail?.sessionId])

  const participantById = useMemo(
    () => new Map(detail?.participants.map((participant) => [participant.id, participant]) ?? []),
    [detail]
  )

  const runCommand = async (command: () => Promise<RunCommandResultDto>): Promise<void> => {
    setError(undefined)
    setCommandFailure(undefined)
    const result = await command()
    if (!result.ok) setCommandFailure(result.error)
    else {
      setSnapshot((current) => ({ ...current, state: result.state }))
      if (result.state.status === 'completed') setQualityVersion((current) => current + 1)
    }
    await reload()
  }

  if (loading) return <section className="panel muted">正在从 SQLite 恢复辩论记录…</section>
  if (!detail) return <section className="notice error">{error ?? '辩论不存在。'}</section>
  const state = snapshot.state
  const status = state?.status ?? detail.status
  const sessionId = detail.sessionId
  const retryableTurnId = [...snapshot.turns]
    .reverse()
    .find((turn) => ['failed', 'cancelled', 'interrupted'].includes(turn.status))?.id
  const startBlocked = isDebateStartBlocked(setup)
  const researchTurns = snapshot.turns.filter((turn) => isResearchPreparationStage(turn.stage))
  const debateTurns = snapshot.turns.filter((turn) => !isResearchPreparationStage(turn.stage))
  const activeResearchTurn = [...researchTurns].reverse().find((turn) => ['running', 'streaming'].includes(turn.status))
  const activeTurn = [...snapshot.turns].reverse().find((turn) => ['running', 'streaming'].includes(turn.status))
  const activeParticipant = activeTurn ? participantById.get(activeTurn.participantId) : undefined
  const activeProfile = activeParticipant
    ? setup?.modelProfiles.find((profile) => profile.id === activeParticipant.modelProfileId)
    : undefined
  const activeReasoning = activeTurn ? snapshot.reasoningByTurn?.[activeTurn.id] : undefined
  const activeMayReason = Boolean(activeProfile?.capabilities.reasoning || (activeProfile && isSlowFirstTokenModel(activeProfile.modelId)))
  const slowProfiles = setup?.modelProfiles.filter((profile) => isSlowFirstTokenModel(profile.modelId)) ?? []
  const renderTurn = (turn: DebateTurnDto) => {
    const participant = participantById.get(turn.participantId)
    return <TurnCard
      key={turn.id}
      turn={turn}
      role={participant?.role ?? 'moderator'}
      name={participant?.displayName ?? turn.participantId}
      reasoning={turn.id === activeTurn?.id ? undefined : snapshot.reasoningByTurn?.[turn.id]}
      onRetry={turn.id === retryableTurnId ? () => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId })) : undefined}
      onChangeModel={() => setShowRoleEditor(true)}
      onOpenModels={onOpenModels}
    />
  }

  return (
    <section className="page-stack live-page" aria-labelledby="live-title">
      <PageHeader
        id="live-title"
        eyebrow="实时辩论"
        title={detail.topic}
        description={`${statusLabel(status)} · 阶段：${stageLabel(state?.currentStage ?? detail.currentStage)}`}
        actions={<button className="button ghost header-back-button" onClick={onBack}>返回列表</button>}
      />

      <DebateInlineManagement debateId={debateId} onChanged={onHistoryChanged} onExit={onBack} />

      <DebateProgress stage={state?.currentStage ?? detail.currentStage} />

      {slowProfiles.length > 0 && ['running', 'streaming'].includes(status) && <div className="notice warning slow-model-runtime-notice" role="status">
        正在使用长思考模型（{[...new Set(slowProfiles.map((profile) => profile.modelId))].join('、')}）。首段输出可能较慢；页面中的阶段、研究动作和计数仍会持续更新。
      </div>}

      {activeTurn && (
        <ReasoningActivityPanel
          reasoning={activeReasoning}
          active
          startedAt={activeTurn.createdAt}
          modelId={activeProfile?.modelId}
          possiblyReasoning={activeMayReason}
        />
      )}

      <DebateQualityPanel debateId={debateId} completed={status === 'completed'} refreshKey={qualityVersion} />

      {error && <div className="notice error" role="alert">{error}</div>}
      {commandFailure && (
        <ErrorRecoveryPanel
          failure={commandFailure}
          onRetry={['failed', 'interrupted'].includes(status)
            ? () => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId }))
            : undefined}
          onChangeModel={() => setShowRoleEditor(true)}
          onOpenConnection={onOpenModels}
        />
      )}
      {setup && (
        <SetupValidationPanel
          setup={setup}
          onChangeModel={() => setShowRoleEditor(true)}
          onOpenModels={onOpenModels}
        />
      )}
      {showRoleEditor && setup && (
        <RoleModelEditor
          sessionId={sessionId}
          participants={detail.participants}
          profiles={setup.modelProfiles}
          onCancel={() => setShowRoleEditor(false)}
          onSaved={async () => { setShowRoleEditor(false); await reload() }}
          onError={setError}
        />
      )}

      <RunControlBar status={status} statusText={statusLabel(status)} actions={[
        { id: 'start', label: '启动', tone: 'primary', disabled: status !== 'draft' || startBlocked, title: startBlocked ? '请先修正启动前检查中的错误' : undefined, onClick: () => void runCommand(() => window.debateStudio.startDebate({ sessionId })) },
        { id: 'pause', label: '暂停', disabled: !['running', 'streaming'].includes(status), onClick: () => void runCommand(() => window.debateStudio.pauseDebate({ sessionId })) },
        { id: 'resume', label: '继续', disabled: status !== 'paused', onClick: () => void runCommand(() => window.debateStudio.resumeDebate({ sessionId })) },
        { id: 'skip', label: '跳过当前阶段', disabled: !['running', 'streaming', 'failed', 'interrupted'].includes(status), title: '取消当前模型请求，保留已收到的内容，然后从下一阶段继续', onClick: () => void runCommand(() => window.debateStudio.skipDebate({ sessionId })) },
        { id: 'stop', label: '停止', tone: 'danger', disabled: !['running', 'streaming', 'paused', 'failed', 'interrupted'].includes(status), onClick: () => void runCommand(() => window.debateStudio.stopDebate({ sessionId })) },
        { id: 'retry', label: '重试失败轮次', disabled: !['failed', 'interrupted'].includes(status), onClick: () => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId })) }
      ]} />

      <ParticipantStrip participants={detail.participants.map((participant) => {
          const profile = setup?.modelProfiles.find((model) => model.id === participant.modelProfileId)
          const connection = profile ? setup?.providerConnections.find((candidate) => candidate.id === profile.connectionId) : undefined
          return { id: participant.id, role: participant.role, roleLabel: roleLabel(participant.role), name: profile?.displayName ?? participant.displayName, slow: Boolean(profile && isSlowFirstTokenModel(profile.modelId)), detail: connection?.displayName }
        })} />

      <ResearchPanel
        detail={detail}
        refreshKey={researchVersion}
        activeTurnStartedAt={activeResearchTurn?.createdAt}
        onSkipCurrentStage={['running', 'streaming'].includes(status)
          ? () => runCommand(() => window.debateStudio.skipDebate({ sessionId }))
          : undefined}
        onError={setError}
      />

      {olderTurnsCursor && (
        <button className="button ghost load-older-button" disabled={loadingOlderTurns} onClick={() => void loadOlderTurns()}>
          {loadingOlderTurns ? '正在加载更早记录…' : '加载更早的发言与研究记录'}
        </button>
      )}

      {researchTurns.length > 0 && <details className="research-turn-archive panel">
        <summary><div><strong>研究过程</strong><span>搜索、读页和资料整理已折叠，不影响查看正式辩论</span></div><span>{researchTurns.length} 条记录</span></summary>
        <div className="research-turn-archive-body">{researchTurns.map(renderTurn)}</div>
      </details>}

      <div className="turn-list" aria-live="polite">
        {snapshot.turns.length === 0 && <div className="empty-state compact"><h2>尚未开始发言</h2><p>点击“启动”后，模型的 SSE 流式输出会显示在这里。</p></div>}
        {snapshot.turns.length > 0 && debateTurns.length === 0 && <div className="empty-state compact"><h2>正在准备正式辩论</h2><p>研究过程已收起，开篇发言将直接显示在这里。</p></div>}
        {debateTurns.map(renderTurn)}
      </div>
    </section>
  )
}

function SetupValidationPanel({ setup, onChangeModel, onOpenModels }: { setup: DebateSetupDto; onChangeModel(): void; onOpenModels(): void }) {
  const { validation } = setup
  return (
    <details className={`setup-validation panel ${validation.valid ? 'valid' : 'invalid'}`} open={!validation.valid}>
      <summary><div><strong>{validation.valid ? '启动前检查通过' : '启动前检查未通过'}</strong><span>{validation.errors.length} 个错误 · {validation.warnings.length} 个警告</span></div></summary>
      <div className="setup-validation-body">
        <div className="header-actions"><button className="button secondary" onClick={onChangeModel}>更换角色模型</button><button className="button ghost" onClick={onOpenModels}>打开模型与平台</button></div>
        {validation.errors.map((issue) => (
        <div className="validation-issue error" key={`${issue.code}-${issue.configId ?? issue.role ?? ''}`}>
          <strong>{issue.titleZh}</strong><p>{issue.descriptionZh}</p><span>建议：{issue.suggestedActionZh}</span>
        </div>
        ))}
        {validation.warnings.map((issue) => (
        <div className="validation-issue warning" key={`${issue.code}-${issue.configId ?? issue.role ?? ''}`}>
          <strong>{issue.titleZh}</strong><p>{issue.descriptionZh}</p><span>建议：{issue.suggestedActionZh}</span>
        </div>
        ))}
      </div>
    </details>
  )
}

function RoleModelEditor({ sessionId, participants, profiles, onCancel, onSaved, onError }: {
  sessionId: string
  participants: ParticipantBindingDto[]
  profiles: ModelProfileDto[]
  onCancel(): void
  onSaved(): Promise<void>
  onError(message: string): void
}) {
  const initial = (role: DebateParticipantRoleDto): string => participants.find((participant) => participant.role === role)?.modelProfileId ?? ''
  const [bindings, setBindings] = useState<Record<DebateParticipantRoleDto, string>>({
    affirmative: initial('affirmative'),
    negative: initial('negative'),
    moderator: initial('moderator'),
    judge: initial('judge')
  })
  const save = async (): Promise<void> => {
    const result = await window.debateStudio.saveParticipantBindings({
      sessionId,
      affirmative: { modelProfileId: bindings.affirmative, displayName: '正方' },
      negative: { modelProfileId: bindings.negative, displayName: '反方' },
      moderator: { modelProfileId: bindings.moderator, displayName: '主持人' },
      judge: bindings.judge ? { modelProfileId: bindings.judge, displayName: '裁判' } : undefined
    })
    if (!result.ok) onError(result.error.descriptionZh)
    else await onSaved()
  }
  const select = (role: DebateParticipantRoleDto, label: string, required = true) => (
    <label className="field">{label}<select required={required} value={bindings[role]} onChange={(event) => setBindings((current) => ({ ...current, [role]: event.target.value }))}><option value="">{required ? '请选择模型' : '不配置独立裁判'}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.modelId}</option>)}</select></label>
  )
  return (
    <section className="panel form-grid role-model-editor">
      <div className="section-heading span-2"><div><strong>更换本场辩论的角色模型</strong><span>保存后会重新执行 DebateSetupValidator</span></div></div>
      {select('affirmative', '正方')}{select('negative', '反方')}{select('moderator', '主持人')}{select('judge', '裁判（可选）', false)}
      <div className="form-actions span-2"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" disabled={!bindings.affirmative || !bindings.negative || !bindings.moderator} onClick={() => void save()}>保存角色模型</button></div>
    </section>
  )
}

function TurnCard({ turn, role, name, reasoning, onRetry, onChangeModel, onOpenModels }: {
  turn: DebateTurnDto
  role: string
  name: string
  reasoning?: LiveReasoningSnapshot
  onRetry?(): void
  onChangeModel(): void
  onOpenModels(): void
}) {
  const failure = turn.failure ?? (turn.error ? {
    code: 'TURN_FAILED',
    titleZh: '模型请求失败',
    descriptionZh: '当前发言未能完成，已收到的部分文本会保留。',
    retryable: true,
    suggestedActionZh: '检查连接后重试，或更换模型。',
    technicalDetails: turn.error
  } : undefined)
  return <DebateTurnCard
    turn={turn}
    role={role}
    name={name}
    stageText={stageLabel(turn.stage)}
    statusText={statusLabel(turn.status)}
    reasoning={reasoning ? (
        <ReasoningActivityPanel
          reasoning={reasoning}
          active={false}
          startedAt={turn.createdAt}
        />
      ) : undefined}
    failure={failure ? <ErrorRecoveryPanel failure={failure} onRetry={onRetry} onChangeModel={onChangeModel} onOpenConnection={onOpenModels} /> : undefined}
    footer={<><small>Token 用量：未知</small>{turn.retryOfTurnId && <small>重试自 Turn {turn.retryOfTurnId}</small>}</>}
  />
}

export function ReasoningActivityPanel({ reasoning, active, startedAt, modelId, possiblyReasoning = true }: {
  reasoning?: LiveReasoningSnapshot
  active: boolean
  startedAt: string
  modelId?: string
  possiblyReasoning?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [active])

  const startedAtMs = Date.parse(startedAt)
  const elapsedSeconds = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((now - startedAtMs) / 1_000)) : 0
  const title = active
    ? (possiblyReasoning || reasoning ? '模型思考中…' : '模型生成中…')
    : '服务商返回的思考内容 / 摘要'
  return (
    <details className={`reasoning-activity ${active ? 'is-active' : ''}`} open={active || undefined}>
      <summary>
        <div>
          <strong className={active ? 'reasoning-shimmer-text' : undefined}>{title}</strong>
          <span>
            {active
              ? `已运行 ${elapsedSeconds} 秒${modelId ? ` · ${modelId}` : ''}`
              : `本页内收到 ${reasoning?.receivedCharacters ?? 0} 个字符`}
          </span>
        </div>
        <span className="reasoning-live-status" role="status">
          {active ? <><i aria-hidden="true" />实时</> : '仅本次运行可见'}
        </span>
      </summary>
      <div className="reasoning-activity-body" aria-live="polite">
        {reasoning?.content
          ? <pre>{reasoning.content}</pre>
          : <p>API 暂未返回可见的思考文本，但请求仍在运行。这里会持续计时，收到内容后立即显示。</p>}
        {reasoning?.truncated && <small>思考文本超过界面 12 万字符上限，较早内容已折叠，最新内容仍在持续显示。</small>}
        <small>这是服务商实际返回的思考内容或思考摘要，不代表完整内部推理。它只保留在当前页面内存中，不写入辩论正文、SQLite、日志或导出文件。</small>
      </div>
    </details>
  )
}

function roleLabel(role: string): string {
  return { affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' }[role] ?? role
}
