import { useEffect, useMemo, useState } from 'react'

import type {
  DebateDetailDto,
  DebateSetupDto,
  DebateTurnDto,
  RunCommandResultDto
} from '../../../shared/ipc-contract'
import { applyRunEvent, type LiveRunSnapshot } from '../run-state'
import { stageLabel, statusLabel } from './HomePage'

export interface LiveDebatePageProps {
  debateId: string
  onBack(): void
}

export function LiveDebatePage({ debateId, onBack }: LiveDebatePageProps) {
  const [detail, setDetail] = useState<DebateDetailDto>()
  const [setup, setSetup] = useState<DebateSetupDto>()
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot>({ turns: [] })
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

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
    if (setupResult.ok) setSetup(setupResult.value)
    if (!turnsResult.ok) setError(turnsResult.error.descriptionZh)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [debateId])
  useEffect(() => window.debateStudio.onRunEvent((event) => {
    if (event.sessionId === detail?.sessionId) setSnapshot((current) => applyRunEvent(current, event))
  }), [detail?.sessionId])

  const participantById = useMemo(
    () => new Map(detail?.participants.map((participant) => [participant.id, participant]) ?? []),
    [detail]
  )

  const runCommand = async (command: () => Promise<RunCommandResultDto>): Promise<void> => {
    setError(undefined)
    const result = await command()
    if (!result.ok) setError(result.error.descriptionZh)
    else setSnapshot((current) => ({ ...current, state: result.state }))
    await reload()
  }

  if (loading) return <section className="panel muted">正在从 SQLite 恢复辩论记录…</section>
  if (!detail) return <section className="notice error">{error ?? '辩论不存在。'}</section>
  const state = snapshot.state
  const status = state?.status ?? detail.status
  const sessionId = detail.sessionId

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
      {setup && !setup.validation.valid && (
        <div className="notice error">{setup.validation.errors.map((issue) => issue.titleZh).join('、')}</div>
      )}

      <div className="control-bar panel">
        <button className="button primary" disabled={status !== 'draft'} onClick={() => void runCommand(() => window.debateStudio.startDebate({ sessionId }))}>启动</button>
        <button className="button secondary" disabled={!['running', 'streaming'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.pauseDebate({ sessionId }))}>暂停</button>
        <button className="button secondary" disabled={status !== 'paused'} onClick={() => void runCommand(() => window.debateStudio.resumeDebate({ sessionId }))}>继续</button>
        <button className="button danger" disabled={!['running', 'streaming', 'paused', 'failed', 'interrupted'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.stopDebate({ sessionId }))}>停止</button>
        <button className="button secondary" disabled={!['failed', 'interrupted'].includes(status)} onClick={() => void runCommand(() => window.debateStudio.retryFailedTurn({ sessionId }))}>重试失败轮次</button>
      </div>

      <div className="participant-strip">
        {detail.participants.map((participant) => {
          const profile = setup?.modelProfiles.find((model) => model.id === participant.modelProfileId)
          return (
            <div className={`participant-chip role-${participant.role}`} key={participant.id}>
              <strong>{roleLabel(participant.role)}</strong>
              <span>{profile?.displayName ?? participant.displayName}</span>
            </div>
          )
        })}
      </div>

      <div className="turn-list" aria-live="polite">
        {snapshot.turns.length === 0 && <div className="empty-state compact"><h2>尚未开始发言</h2><p>点击“启动”后，MockAdapter 的流式输出会显示在这里。</p></div>}
        {snapshot.turns.map((turn) => {
          const participant = participantById.get(turn.participantId)
          return <TurnCard key={turn.id} turn={turn} role={participant?.role ?? 'moderator'} name={participant?.displayName ?? turn.participantId} />
        })}
      </div>
    </section>
  )
}

function TurnCard({ turn, role, name }: { turn: DebateTurnDto; role: string; name: string }) {
  return (
    <article className={`turn-card role-${role}`}>
      <header>
        <div><strong>{name}</strong><span>{stageLabel(turn.stage)}</span></div>
        <span className={`turn-status status-${turn.status}`}>{statusLabel(turn.status)}</span>
      </header>
      <div className="turn-content">{turn.content || (['running', 'streaming'].includes(turn.status) ? '正在生成…' : '无文本')}</div>
      {turn.error && <div className="turn-error"><strong>生成失败：</strong>{turn.error}</div>}
      {turn.retryOfTurnId && <small>重试自 Turn {turn.retryOfTurnId}</small>}
    </article>
  )
}

function roleLabel(role: string): string {
  return { affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' }[role] ?? role
}
