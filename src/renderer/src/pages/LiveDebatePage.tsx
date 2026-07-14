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
import { ResearchPanel } from '../components/ResearchPanel'
import { applyRunEvent, type LiveRunSnapshot } from '../run-state'
import { stageLabel, statusLabel } from './HomePage'

export interface LiveDebatePageProps {
  debateId: string
  onBack(): void
  onOpenModels(): void
}

export function isDebateStartBlocked(setup?: Pick<DebateSetupDto, 'validation'>): boolean {
  return !setup?.validation.valid
}

export function LiveDebatePage({ debateId, onBack, onOpenModels }: LiveDebatePageProps) {
  const [detail, setDetail] = useState<DebateDetailDto>()
  const [setup, setSetup] = useState<DebateSetupDto>()
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot>({ turns: [] })
  const [error, setError] = useState<string>()
  const [commandFailure, setCommandFailure] = useState<RunErrorDto>()
  const [loading, setLoading] = useState(true)
  const [showRoleEditor, setShowRoleEditor] = useState(false)
  const [researchVersion, setResearchVersion] = useState(0)

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
      window.debateStudio.listDebateTurns({ sessionId }),
      window.debateStudio.loadDebateSetup({ sessionId })
    ])
    setDetail(detailResult.value)
    if (stateResult.ok) setSnapshot({ state: stateResult.state, turns: turnsResult.ok ? turnsResult.value : [] })
    else setCommandFailure(stateResult.error)
    if (setupResult.ok) setSetup(setupResult.value)
    else setError(setupResult.error.descriptionZh)
    if (!turnsResult.ok) setError(turnsResult.error.descriptionZh)
    setLoading(false)
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
    else setSnapshot((current) => ({ ...current, state: result.state }))
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

  return (
    <section className="page-stack live-page" aria-labelledby="live-title">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">实时辩论</p>
          <h1 id="live-title">{detail.topic}</h1>
          <div className="live-meta">
            <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>
            <span>阶段：{stageLabel(state?.currentStage ?? detail.currentStage)}</span>
          </div>
        </div>
        <button className="button ghost" onClick={onBack}>返回列表</button>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {commandFailure && (
        <ErrorRecoveryPanel
          failure={commandFailure}
          onRetry={commandFailure.retryable ? () => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId })) : undefined}
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

      <div className="control-bar panel">
        <button
          className="button primary"
          disabled={status !== 'draft' || startBlocked}
          title={startBlocked ? '请先修正启动前检查中的错误' : undefined}
          onClick={() => void runCommand(() => window.debateStudio.startDebate({ sessionId }))}
        >启动</button>
        <button className="button secondary" disabled={!['running', 'streaming'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.pauseDebate({ sessionId }))}>暂停</button>
        <button className="button secondary" disabled={status !== 'paused'} onClick={() => void runCommand(() => window.debateStudio.resumeDebate({ sessionId }))}>继续</button>
        <button className="button danger" disabled={!['running', 'streaming', 'paused', 'failed', 'interrupted'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.stopDebate({ sessionId }))}>停止</button>
        <button className="button secondary" disabled={!['failed', 'interrupted'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId }))}>重试失败轮次</button>
      </div>

      <div className="participant-strip">
        {detail.participants.map((participant) => {
          const profile = setup?.modelProfiles.find((model) => model.id === participant.modelProfileId)
          const connection = profile ? setup?.providerConnections.find((candidate) => candidate.id === profile.connectionId) : undefined
          return (
            <div className={`participant-chip role-${participant.role}`} key={participant.id}>
              <strong>{roleLabel(participant.role)}</strong>
              <span>{profile?.displayName ?? participant.displayName}</span>
              {connection && <small>{connection.displayName}</small>}
            </div>
          )
        })}
      </div>

      <ResearchPanel detail={detail} refreshKey={researchVersion} onError={setError} />

      <div className="turn-list" aria-live="polite">
        {snapshot.turns.length === 0 && <div className="empty-state compact"><h2>尚未开始发言</h2><p>点击“启动”后，模型的 SSE 流式输出会显示在这里。</p></div>}
        {snapshot.turns.map((turn) => {
          const participant = participantById.get(turn.participantId)
          return (
            <TurnCard
              key={turn.id}
              turn={turn}
              role={participant?.role ?? 'moderator'}
              name={participant?.displayName ?? turn.participantId}
              onRetry={turn.id === retryableTurnId ? () => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId })) : undefined}
              onChangeModel={() => setShowRoleEditor(true)}
              onOpenModels={onOpenModels}
            />
          )
        })}
      </div>
    </section>
  )
}

function SetupValidationPanel({ setup, onChangeModel, onOpenModels }: { setup: DebateSetupDto; onChangeModel(): void; onOpenModels(): void }) {
  const { validation } = setup
  return (
    <section className={`setup-validation panel ${validation.valid ? 'valid' : 'invalid'}`}>
      <div className="section-heading">
        <div>
          <strong>{validation.valid ? '启动前检查通过' : '启动前检查未通过'}</strong>
          <span>{validation.errors.length} 个错误 · {validation.warnings.length} 个警告</span>
        </div>
        <div className="header-actions"><button className="button secondary" onClick={onChangeModel}>更换角色模型</button><button className="button ghost" onClick={onOpenModels}>打开模型与平台</button></div>
      </div>
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
    </section>
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

function TurnCard({ turn, role, name, onRetry, onChangeModel, onOpenModels }: {
  turn: DebateTurnDto
  role: string
  name: string
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
  return (
    <article className={`turn-card role-${role}`}>
      <header>
        <div><strong>{name}</strong><span>{stageLabel(turn.stage)}</span></div>
        <span className={`turn-status status-${turn.status}`}>{statusLabel(turn.status)}</span>
      </header>
      <div className="turn-content">{turn.content || (['running', 'streaming'].includes(turn.status) ? '正在生成…' : '无文本')}</div>
      <small>Token 用量：未知</small>
      {failure && <ErrorRecoveryPanel failure={failure} onRetry={onRetry} onChangeModel={onChangeModel} onOpenConnection={onOpenModels} />}
      {turn.retryOfTurnId && <small>重试自 Turn {turn.retryOfTurnId}</small>}
    </article>
  )
}

function roleLabel(role: string): string {
  return { affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' }[role] ?? role
}
