import { useEffect, useMemo, useRef, useState } from 'react'

import type { DebateHistorySummaryDto, DebateTurnDto, LanDebateDetailDto, LanEventEnvelopeDto, LanSessionSnapshotDto } from '../../shared/ipc-contract'
import { DebateProgress } from '../../renderer/src/components/DebateProgress'
import { MarkdownContent } from '../../renderer/src/components/MarkdownContent'
import { applyRunEvent, type LiveRunSnapshot } from '../../renderer/src/run-state'
import { LanApiClient } from './lan-api-client'

type View = { type: 'list' } | { type: 'live'; debateId: string; sessionId: string }

export function LanApp() {
  const client = useMemo(() => new LanApiClient(), [])
  const [ready, setReady] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [view, setView] = useState<View>({ type: 'list' })

  const connect = () => void client.session().then((result) => {
    if (result.ok) { setReady(true); setConnectionError('') }
    else setConnectionError(`${result.error.titleZh}：${result.error.descriptionZh}`)
  })
  useEffect(connect, [client])

  if (!ready) return <div className="lan-centered"><div className="lan-spinner" /><p>{connectionError || '正在连接 Debate Studio…'}</p>{connectionError && <button className="button primary" onClick={connect}>重试连接</button>}</div>
  return <div className="lan-shell">
    <aside className="lan-nav"><strong>Debate Studio</strong><small>Web 控制台</small><button className="active" onClick={() => setView({ type: 'list' })}>辩论</button><p>无需密码 · 仅用于可信网络</p></aside>
    <main>{view.type === 'list'
      ? <DebateListPage client={client} onOpen={(debate) => setView({ type: 'live', debateId: debate.id, sessionId: debate.sessionId })} />
      : <LivePage client={client} {...view} onBack={() => setView({ type: 'list' })} />}</main>
    <nav className="lan-bottom-nav"><button className="active" onClick={() => setView({ type: 'list' })}>辩论列表</button></nav>
  </div>
}

function DebateListPage({ client, onOpen }: { client: LanApiClient; onOpen(debate: DebateHistorySummaryDto): void }) {
  const [items, setItems] = useState<DebateHistorySummaryDto[]>([])
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [message, setMessage] = useState('正在读取…')
  const load = (nextOffset = 0) => void client.listDebates(search, nextOffset).then((result) => {
    if (!result.ok) return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setItems(result.value.debates); setHasMore(result.value.hasMore); setOffset(nextOffset); setMessage(result.value.debates.length ? '' : '没有找到辩论。')
  })
  useEffect(() => load(0), [])
  return <section className="lan-page"><header><span className="eyebrow">本地历史</span><h1>辩论列表</h1><p>查看和控制 Mac 上已有的辩论。</p></header>
    <form className="lan-search" onSubmit={(event) => { event.preventDefault(); load(0) }}><input aria-label="搜索辩论" placeholder="搜索辩题或名称" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button primary">搜索</button></form>
    {message && <p className="lan-empty">{message}</p>}
    <div className="lan-debate-grid">{items.map((debate) => <button className="lan-debate-card" key={debate.id} onClick={() => onOpen(debate)}><span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span><h2>{debate.displayTitle}</h2><p>{debate.topic}</p><small>{stageLabel(debate.currentStage)} · {new Date(debate.updatedAt).toLocaleString('zh-CN')}</small></button>)}</div>
    <div className="lan-pagination"><button className="button ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 20))}>上一页</button><span>第 {Math.floor(offset / 20) + 1} 页</span><button className="button ghost" disabled={!hasMore} onClick={() => load(offset + 20)}>下一页</button></div>
  </section>
}

function LivePage({ client, debateId, sessionId, onBack }: { client: LanApiClient; debateId: string; sessionId: string; onBack(): void }) {
  const [detail, setDetail] = useState<LanDebateDetailDto>()
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot>({ turns: [] })
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef('')
  const sequence = useRef(0)
  const pending = useRef<LanEventEnvelopeDto[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  const syncSnapshot = async () => {
    const result = await client.getSnapshot(sessionId)
    if (!result.ok) return setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
    applyServerSnapshot(result.value, setDetail, setSnapshot, epoch, sequence)
    for (const event of pending.current.splice(0)) acceptEvent(event)
  }
  const acceptEvent = (envelope: LanEventEnvelopeDto) => {
    if (epoch.current && envelope.streamEpoch !== epoch.current) { epoch.current = envelope.streamEpoch; sequence.current = 0; void syncSnapshot(); return }
    if (envelope.sequence <= sequence.current) return
    sequence.current = envelope.sequence
    setSnapshot((current) => applyRunEvent(current, envelope.event))
  }

  useEffect(() => {
    const disconnect = client.connectEvents(sessionId, { onEvent: (event) => epoch.current ? acceptEvent(event) : pending.current.push(event), onOnline: () => { setOffline(false); void syncSnapshot() }, onOffline: () => setOffline(true) })
    void client.getDebate(debateId).then((result) => { if (result.ok) setDetail(result.value) })
    return disconnect
  }, [client, debateId, sessionId])

  useEffect(() => { if (follow.current) scrollRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [snapshot.turns])

  const command = async (value: 'start' | 'pause' | 'resume' | 'stop') => {
    setError('')
    const result = await client.command(sessionId, value)
    if (!result.ok) setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
  }

  return <section className="lan-page lan-live" onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120 }}>
    {offline && <div className="lan-offline">主机已离线，正在自动重连。当前画面会保留。</div>}
    <header><button className="lan-back" onClick={onBack}>← 返回列表</button><span className="eyebrow">实时辩论</span><h1>{detail?.displayTitle ?? '正在加载…'}</h1><p>{statusLabel(snapshot.state?.status)} · {stageLabel(snapshot.state?.currentStage)}</p></header>
    <DebateProgress stage={snapshot.state?.currentStage ?? detail?.currentStage ?? 'draft'} />
    <div className="lan-controls"><button className="button primary" onClick={() => void command('start')}>启动</button><button className="button ghost" onClick={() => void command('pause')}>暂停</button><button className="button ghost" onClick={() => void command('resume')}>继续</button><button className="button danger" onClick={() => void command('stop')}>停止</button></div>
    {error && <p className="lan-error" role="alert">{error}</p>}
    <section className="lan-participants"><h2>参与角色</h2><div>{detail?.participants.map((participant) => <span key={participant.id}>{roleLabel(participant.role)} · {participant.displayName}</span>)}</div></section>
    <div className="lan-turn-list">{snapshot.turns.map((turn) => <TurnCard key={turn.id} turn={turn} reasoning={snapshot.reasoningByTurn?.[turn.id]?.content} detail={detail} />)}</div>
    <div ref={scrollRef} />
  </section>
}

function TurnCard({ turn, reasoning, detail }: { turn: DebateTurnDto; reasoning?: string; detail?: LanDebateDetailDto }) {
  const participant = detail?.participants.find((value) => value.id === turn.participantId)
  return <article className="lan-turn-card"><div className="lan-turn-head"><div><strong>{participant ? roleLabel(participant.role) : '发言'}</strong><span>{stageLabel(turn.stage)}</span></div><span className={`status-pill status-${turn.status}`}>{statusLabel(turn.status)}</span></div>
    {reasoning && <details className="lan-reasoning"><summary>模型仍在思考 · 查看活动</summary><pre>{reasoning}</pre></details>}
    <div className="turn-content">{turn.content ? <MarkdownContent content={turn.content} /> : <p className="muted">正在等待正文…</p>}</div>
    {turn.failure && <div className="lan-error"><strong>{turn.failure.titleZh}</strong><p>{turn.failure.descriptionZh}</p></div>}
  </article>
}

function applyServerSnapshot(value: LanSessionSnapshotDto, setDetail: (value: LanDebateDetailDto) => void, setSnapshot: (value: LiveRunSnapshot) => void, epoch: React.MutableRefObject<string>, sequence: React.MutableRefObject<number>) {
  epoch.current = value.streamEpoch; sequence.current = value.latestSequence; setDetail(value.debate); setSnapshot({ state: value.state, turns: value.turnPage.turns })
}
function roleLabel(value: string) { return ({ affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判' } as Record<string, string>)[value] ?? value }
function statusLabel(value?: string) { return ({ draft: '草稿', running: '运行中', streaming: '生成中', paused: '已暂停', stopped: '已停止', completed: '已完成', failed: '失败', interrupted: '已中断' } as Record<string, string>)[value ?? ''] ?? value ?? '未知' }
function stageLabel(value?: string) { return ({ draft: '准备', validating: '校验', moderating: '主持准备', public_pool: '公共资源池', affirmative_planning: '正方规划', negative_planning: '反方规划', affirmative_research: '正方研究', negative_research: '反方研究', argument_drafting: '论证草拟', affirmative_opening: '正方开篇', negative_opening: '反方开篇', rebuttal: '反驳', free_debate: '自由辩论', closing: '总结', adjudication: '裁决', completed: '完成' } as Record<string, string>)[value ?? ''] ?? value ?? '未知阶段' }
