import { useEffect, useMemo, useRef, useState } from 'react'

import type { DebateHistorySummaryDto, DebateTurnDto, LanDebateDetailDto, LanEventEnvelopeDto, LanSessionSnapshotDto } from '../../shared/ipc-contract'
import type { LanDebateInsightsDto, LanExportRecordDto, LanModelProfileDto, LanResearchWorkspaceDto } from '../../shared/lan-dtos'
import type { PlannedDebateDto } from '../../shared/debate-dtos'
import type { DebateEvaluationDto } from '../../shared/quality-dtos'
import { DebateProgress } from '../../renderer/src/components/DebateProgress'
import { MarkdownContent } from '../../renderer/src/components/MarkdownContent'
import { applyRunEvent, type LiveRunSnapshot } from '../../renderer/src/run-state'
import { LanApiClient } from './lan-api-client'

type View = { type: 'list' } | { type: 'create' } | { type: 'live'; debateId: string; sessionId: string }

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
    <aside className="lan-nav"><strong>Debate Studio</strong><small>Web 控制台</small><button className={view.type === 'list' ? 'active' : ''} onClick={() => setView({ type: 'list' })}>辩论</button><button className={view.type === 'create' ? 'active' : ''} onClick={() => setView({ type: 'create' })}>新建辩论</button><p>无需密码 · 仅用于可信网络</p></aside>
    <main>{view.type === 'list'
      ? <DebateListPage client={client} onCreate={() => setView({ type: 'create' })} onOpen={(debate) => setView({ type: 'live', debateId: debate.id, sessionId: debate.sessionId })} />
      : view.type === 'create'
        ? <NewDebatePage client={client} onCancel={() => setView({ type: 'list' })} onCreated={(debate) => setView({ type: 'live', debateId: debate.id, sessionId: debate.sessionId })} />
        : <LivePage client={client} {...view} onBack={() => setView({ type: 'list' })} />}</main>
    <nav className="lan-bottom-nav"><button className={view.type === 'list' ? 'active' : ''} onClick={() => setView({ type: 'list' })}>辩论列表</button><button className={view.type === 'create' ? 'active' : ''} onClick={() => setView({ type: 'create' })}>新建辩论</button></nav>
  </div>
}

function DebateListPage({ client, onCreate, onOpen }: { client: LanApiClient; onCreate(): void; onOpen(debate: Pick<DebateHistorySummaryDto, 'id' | 'sessionId'>): void }) {
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
  const createMock = () => void client.createMockDebate().then((result) => result.ok ? onOpen(result.value) : setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`))
  return <section className="lan-page"><header className="lan-page-header"><div><span className="eyebrow">本地工作台</span><h1>辩论列表</h1><p>查看和控制 Mac 上已有的辩论。</p></div><div className="lan-header-actions"><button className="button ghost" onClick={createMock}>创建 Mock 示例</button><button className="button primary" onClick={onCreate}>新建辩论</button></div></header>
    <form className="lan-search" onSubmit={(event) => { event.preventDefault(); load(0) }}><input aria-label="搜索辩论" placeholder="搜索辩题或名称" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button primary">搜索</button></form>
    {message && <p className="lan-empty">{message}</p>}
    <div className="lan-debate-grid">{items.map((debate) => <button className="lan-debate-card" key={debate.id} onClick={() => onOpen(debate)}><span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span><h2>{debate.displayTitle}</h2><p>{debate.topic}</p><small>{stageLabel(debate.currentStage)} · {new Date(debate.updatedAt).toLocaleString('zh-CN')}</small></button>)}</div>
    <div className="lan-pagination"><button className="button ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 20))}>上一页</button><span>第 {Math.floor(offset / 20) + 1} 页</span><button className="button ghost" disabled={!hasMore} onClick={() => load(offset + 20)}>下一页</button></div>
  </section>
}

function NewDebatePage({ client, onCancel, onCreated }: { client: LanApiClient; onCancel(): void; onCreated(debate: LanDebateDetailDto): void }) {
  const [mode, setMode] = useState<'auto' | 'assist' | 'manual'>('auto')
  const [topic, setTopic] = useState('')
  const [background, setBackground] = useState('')
  const [affirmative, setAffirmative] = useState('')
  const [negative, setNegative] = useState('')
  const [domain, setDomain] = useState('')
  const [depth, setDepth] = useState<'light' | 'standard' | 'deep'>('standard')
  const [rounds, setRounds] = useState(1)
  const [profiles, setProfiles] = useState<LanModelProfileDto[]>([])
  const [models, setModels] = useState({ affirmative: '', negative: '', moderator: '', judge: '' })
  const [plan, setPlan] = useState<PlannedDebateDto>()
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { void client.listModelProfiles().then((result) => {
    if (!result.ok) return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setProfiles(result.value)
    const first = result.value[0]?.id ?? ''
    setModels({ affirmative: first, negative: first, moderator: first, judge: '' })
  }) }, [client])

  const generate = async () => {
    setBusy(true); setMessage(''); setActivity('正在请求辩题规划模型…')
    const result = await client.planDebate({
      operationId: crypto.randomUUID(), mode: mode === 'assist' ? 'assist' : 'auto', topic, background: background || undefined,
      domain: domain || undefined, depth, affirmativePosition: affirmative || undefined, negativePosition: negative || undefined
    })
    setBusy(false)
    if (!result.ok) { setActivity(''); return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`) }
    setPlan(result.value); setBackground(result.value.plan.background); setAffirmative(result.value.plan.affirmativePosition); setNegative(result.value.plan.negativePosition)
    setActivity('方案已生成，可在下方继续编辑。')
  }

  const create = async () => {
    setBusy(true); setMessage(''); setActivity('正在创建 Session 并绑定角色模型…')
    const result = await client.createDebate({
      debate: { topic, background: background || undefined, affirmativePosition: affirmative, negativePosition: negative, freeDebateRounds: rounds, planning: mode === 'manual' ? undefined : plan },
      bindings: { affirmativeModelProfileId: models.affirmative, negativeModelProfileId: models.negative, moderatorModelProfileId: models.moderator, judgeModelProfileId: models.judge || undefined }
    })
    setBusy(false)
    if (!result.ok) { setActivity(''); return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`) }
    onCreated(result.value)
  }

  const updatePlanList = (field: 'keyQuestions' | 'researchDirections' | 'evidenceSuggestions', value: string) => {
    if (!plan) return
    setPlan({ ...plan, plan: { ...plan.plan, [field]: value.split('\n').map((item) => item.trim()).filter(Boolean) } })
  }

  const canPlan = Boolean(topic.trim() && (mode !== 'assist' || (affirmative.trim() && negative.trim())))
  const canCreate = Boolean(topic.trim() && affirmative.trim() && negative.trim() && models.affirmative && models.negative && models.moderator && !busy)
  return <section className="lan-page lan-create-page">
    <header className="lan-page-header"><div><span className="eyebrow">DEBATE PLANNER</span><h1>新建辩论</h1><p>可让 AI 生成方案，也可完全手动填写。</p></div><button className="lan-back" onClick={onCancel}>← 返回列表</button></header>
    <section className="lan-form-card">
      <div className="lan-mode-grid">{([
        ['auto', 'AI 自动规划', '只需辩题，自动生成完整方案'],
        ['assist', 'AI 辅助完善', '保留双方初始立场并扩展'],
        ['manual', '完全手动', '不调用规划模型']
      ] as const).map(([value, title, copy]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setPlan(undefined) }}><strong>{title}</strong><span>{copy}</span></button>)}</div>
      <label>辩题<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：大学是否应设立每周无课日？" /></label>
      <div className="lan-form-columns"><label>领域（可选）<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="教育、科技、政策…" /></label><label>期望深度<select value={depth} onChange={(event) => setDepth(event.target.value as typeof depth)}><option value="light">精简</option><option value="standard">标准</option><option value="deep">深入</option></select></label></div>
      <label>背景说明<textarea value={background} onChange={(event) => setBackground(event.target.value)} placeholder="可留空，让 AI 自动补全" /></label>
      {(mode !== 'auto' || plan) && <div className="lan-form-columns"><label>正方立场<textarea value={affirmative} onChange={(event) => setAffirmative(event.target.value)} /></label><label>反方立场<textarea value={negative} onChange={(event) => setNegative(event.target.value)} /></label></div>}
      {mode !== 'manual' && <button className="button ghost" disabled={!canPlan || busy} onClick={() => void generate()}>{plan ? '重新生成方案' : '生成辩论方案'}</button>}
      {plan && <details className="lan-plan-details"><summary>编辑 AI 方案要点</summary><div className="lan-plan-editor"><label>核心争议（每行一项）<textarea value={plan.plan.keyQuestions.join('\n')} onChange={(event) => updatePlanList('keyQuestions', event.target.value)} /></label><label>研究方向（每行一项）<textarea value={plan.plan.researchDirections.join('\n')} onChange={(event) => updatePlanList('researchDirections', event.target.value)} /></label><label>建议证据类型（每行一项）<textarea value={plan.plan.evidenceSuggestions.join('\n')} onChange={(event) => updatePlanList('evidenceSuggestions', event.target.value)} /></label></div></details>}
    </section>
    <section className="lan-form-card"><h2>角色模型</h2>{profiles.length ? <><div className="lan-form-columns"><ModelSelect label="正方" value={models.affirmative} profiles={profiles} onChange={(value) => setModels({ ...models, affirmative: value })} /><ModelSelect label="反方" value={models.negative} profiles={profiles} onChange={(value) => setModels({ ...models, negative: value })} /><ModelSelect label="主持人" value={models.moderator} profiles={profiles} onChange={(value) => setModels({ ...models, moderator: value })} /><ModelSelect label="裁判（可选）" value={models.judge} profiles={profiles} optional onChange={(value) => setModels({ ...models, judge: value })} /></div><label>自由辩论轮数<input type="number" min="1" max="20" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} /></label></> : <p className="lan-empty">尚未配置模型。可返回 Mac 客户端配置，或在首页创建 Mock 示例。</p>}</section>
    {activity && <div className="lan-activity" role="status"><span className={busy ? 'lan-activity-dot active' : 'lan-activity-dot'} />{activity}</div>}
    {message && <p className="lan-error" role="alert">{message}</p>}
    <div className="lan-create-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" disabled={!canCreate} onClick={() => void create()}>创建辩论</button></div>
  </section>
}

function ModelSelect({ label, value, profiles, optional, onChange }: { label: string; value: string; profiles: LanModelProfileDto[]; optional?: boolean; onChange(value: string): void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{optional && <option value="">不配置</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.alias || profile.displayName} · {profile.modelId}</option>)}</select></label>
}

function LivePage({ client, debateId, sessionId, onBack }: { client: LanApiClient; debateId: string; sessionId: string; onBack(): void }) {
  const [detail, setDetail] = useState<LanDebateDetailDto>()
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot>({ turns: [] })
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [research, setResearch] = useState<LanResearchWorkspaceDto>()
  const [insights, setInsights] = useState<LanDebateInsightsDto>()
  const [exports, setExports] = useState<LanExportRecordDto[]>([])
  const [turnCursor, setTurnCursor] = useState<{ createdAt: string; id: string }>()
  const epoch = useRef('')
  const sequence = useRef(0)
  const pending = useRef<LanEventEnvelopeDto[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  const syncSnapshot = async () => {
    const result = await client.getSnapshot(sessionId)
    if (!result.ok) return setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
    applyServerSnapshot(result.value, setDetail, setSnapshot, epoch, sequence)
    setTurnCursor(result.value.turnPage.nextCursor)
    for (const event of pending.current.splice(0)) acceptEvent(event)
  }
  const loadRelated = () => {
    void client.getResearch(sessionId).then((result) => { if (result.ok) setResearch(result.value) })
    void client.getInsights(debateId).then((result) => { if (result.ok) setInsights(result.value) })
    void client.listExports(debateId).then((result) => { if (result.ok) setExports(result.value) })
  }
  const acceptEvent = (envelope: LanEventEnvelopeDto) => {
    if (epoch.current && envelope.streamEpoch !== epoch.current) { epoch.current = envelope.streamEpoch; sequence.current = 0; void syncSnapshot(); return }
    if (envelope.sequence <= sequence.current) return
    sequence.current = envelope.sequence
    setSnapshot((current) => applyRunEvent(current, envelope.event))
    if (envelope.event.type === 'sessionCompleted' || envelope.event.type === 'turnCompleted') loadRelated()
  }

  useEffect(() => {
    const disconnect = client.connectEvents(sessionId, { onEvent: (event) => epoch.current ? acceptEvent(event) : pending.current.push(event), onOnline: () => { setOffline(false); void syncSnapshot() }, onOffline: () => setOffline(true) })
    void client.getDebate(debateId).then((result) => { if (result.ok) setDetail(result.value) })
    loadRelated()
    return disconnect
  }, [client, debateId, sessionId])

  useEffect(() => { if (follow.current) scrollRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [snapshot.turns])
  useEffect(() => {
    if (!exports.some((record) => record.status === 'generating')) return
    const timer = window.setInterval(() => void client.listExports(debateId).then((result) => { if (result.ok) setExports(result.value) }), 800)
    return () => window.clearInterval(timer)
  }, [client, debateId, exports])

  const command = async (value: 'start' | 'pause' | 'resume' | 'stop') => {
    setError('')
    const result = await client.command(sessionId, value)
    if (!result.ok) setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
  }

  const createExport = async (type: 'markdown' | 'html') => {
    setError('')
    const result = await client.createExport(debateId, type, false)
    if (!result.ok) return setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setExports((current) => [result.value, ...current.filter((item) => item.exportId !== result.value.exportId)])
    window.setTimeout(loadRelated, 300)
  }

  const loadOlderTurns = async () => {
    if (!turnCursor) return
    follow.current = false
    const result = await client.getSnapshot(sessionId, 40, turnCursor)
    if (!result.ok) return setError(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setTurnCursor(result.value.turnPage.nextCursor)
    setSnapshot((current) => {
      const known = new Set(current.turns.map((turn) => turn.id))
      return { ...current, turns: [...result.value.turnPage.turns.filter((turn) => !known.has(turn.id)), ...current.turns] }
    })
  }

  return <section className="lan-page lan-live" onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120 }}>
    {offline && <div className="lan-offline">主机已离线，正在自动重连。当前画面会保留。</div>}
    <header><button className="lan-back" onClick={onBack}>← 返回列表</button><span className="eyebrow">实时辩论</span><h1>{detail?.displayTitle ?? '正在加载…'}</h1><p>{statusLabel(snapshot.state?.status)} · {stageLabel(snapshot.state?.currentStage)}</p></header>
    <DebateProgress stage={snapshot.state?.currentStage ?? detail?.currentStage ?? 'draft'} />
    <div className="lan-controls"><button className="button primary" onClick={() => void command('start')}>启动</button><button className="button ghost" onClick={() => void command('pause')}>暂停</button><button className="button ghost" onClick={() => void command('resume')}>继续</button><button className="button danger" onClick={() => void command('stop')}>停止</button></div>
    {error && <p className="lan-error" role="alert">{error}</p>}
    <section className="lan-participants"><h2>参与角色</h2><div>{detail?.participants.map((participant) => <span key={participant.id}>{roleLabel(participant.role)} · {participant.displayName}</span>)}</div></section>
    <ResearchSection research={research} />
    {detail && <AssetUploadCard client={client} detail={detail} onUploaded={loadRelated} />}
    {turnCursor && <button className="button ghost lan-load-older" onClick={() => void loadOlderTurns()}>加载更早发言</button>}
    <div className="lan-turn-list">{snapshot.turns.map((turn) => <TurnCard key={turn.id} turn={turn} reasoning={snapshot.reasoningByTurn?.[turn.id]?.content} detail={detail} />)}</div>
    <InsightsSection insights={insights} />
    <section className="lan-participants lan-export-card"><div className="lan-section-heading"><div><h2>导出</h2><p>文件在 Mac 后台生成，浏览器只获取下载流。</p></div><div><button className="button ghost" onClick={() => void createExport('markdown')}>导出 Markdown</button><button className="button ghost" onClick={() => void createExport('html')}>导出 HTML</button></div></div><div className="lan-export-list">{exports.length ? exports.map((record) => <div key={record.exportId}><span>{record.type.toUpperCase()} · {exportStatus(record.status)}{record.status === 'generating' ? ` ${record.progress}%` : ''}</span>{record.status === 'completed' && <a className="button ghost" href={client.exportDownloadUrl(record.exportId)}>下载</a>}</div>) : <p className="muted">尚无导出记录。</p>}</div></section>
    <div ref={scrollRef} />
  </section>
}

function ResearchSection({ research }: { research?: LanResearchWorkspaceDto }) {
  if (!research) return <details className="lan-collapsible"><summary>研究与证据 <span>尚无记录</span></summary><p className="muted">开始辩论后，研究过程会在这里更新。</p></details>
  const sections = [
    ['主持人研究', research.moderator],
    ['正方研究', research.affirmative],
    ['反方研究', research.negative]
  ] as const
  return <section className="lan-research-stack">
    <details className="lan-collapsible"><summary>公共资源池 <span>{research.publicAssets.length} 条资料</span></summary>{research.publicPool ? <div className="lan-detail-body"><p>{research.publicPool.topicDefinition}</p><TagList items={research.publicPool.keyConcepts} /><ul>{research.publicPool.factBoundaries.map((item) => <li key={item}>{item}</li>)}</ul></div> : <p className="muted">尚未建立公共资源池。</p>}</details>
    {sections.map(([title, workspace]) => <details className="lan-collapsible" key={title}><summary>{title} <span>{workspace.sources.length} 个来源 · {workspace.toolCalls.length} 次工具调用</span></summary><div className="lan-detail-body">
      {workspace.loopState && <p className="lan-research-status">{workspace.loopState.goal || '研究中'} · {workspace.loopState.status} · {workspace.loopState.toolCallCount}/{workspace.loopState.limits.maxToolCalls}</p>}
      <h3>搜索词</h3>{workspace.queries.length ? <ul>{workspace.queries.map((item) => <li key={item.id}>{item.query}</li>)}</ul> : <p className="muted">暂无</p>}
      <h3>来源与资料</h3>{workspace.sources.length ? <div className="lan-source-list">{workspace.sources.map((source) => <article key={source.id}><strong>{source.title}</strong><small>{source.domain || source.sourceType} · {source.verificationLevel === 'full-text-read' ? '已读取正文' : '仅摘要'}</small>{source.summary && <p>{source.summary}</p>}</article>)}</div> : <p className="muted">暂无</p>}
      <details><summary>详细工具记录</summary><ul>{workspace.toolCalls.map((call) => <li key={call.id}>{call.toolName} · {call.status}{call.resultSummary ? ` · ${call.resultSummary}` : ''}</li>)}</ul></details>
    </div></details>)}
    <details className="lan-collapsible"><summary>公开证据桌 <span>{research.evidence.length} 条证据</span></summary><div className="lan-source-list">{research.evidence.map((item) => <article key={item.id}><strong>{item.publicCode} · {item.title}</strong><small>{roleLabel(item.submitterRole)} · {evidenceStatus(item.currentStatus)}</small>{item.summary && <p>{item.summary}</p>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a>}</article>)}</div></details>
  </section>
}

function AssetUploadCard({ client, detail, onUploaded }: { client: LanApiClient; detail: LanDebateDetailDto; onUploaded(): void }) {
  const owners = detail.participants.filter((participant) => participant.role !== 'judge')
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [file, setFile] = useState<File>()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const upload = async () => {
    const owner = owners.find((item) => item.id === ownerId)
    if (!owner || !file) return
    const visibility = owner.role === 'affirmative' ? 'affirmative-private' : owner.role === 'negative' ? 'negative-private' : 'moderator-private'
    setBusy(true); setMessage('正在安全上传并保存到研究区…')
    const result = await client.uploadAsset({ sessionId: detail.sessionId, ownerParticipantId: owner.id, visibility, title: title || file.name, file })
    setBusy(false)
    if (!result.ok) return setMessage(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setMessage(`已保存：${result.value.title}`); setFile(undefined); setTitle(''); onUploaded()
  }
  return <details className="lan-collapsible"><summary>添加图片或 PDF <span>最大 10 / 25 MB</span></summary><div className="lan-upload-form"><label>归属研究区<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{roleLabel(owner.role)} · {owner.displayName}</option>)}</select></label><label>标题（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>文件<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0])} /></label><button className="button primary" disabled={!file || !ownerId || busy} onClick={() => void upload()}>{busy ? '正在上传…' : '上传'}</button>{message && <p className="muted">{message}</p>}</div></details>
}

function InsightsSection({ insights }: { insights?: LanDebateInsightsDto }) {
  const evaluation = insights?.quality?.evaluation?.evaluation
  const review = insights?.quality?.review?.review
  const average = evaluation ? averageEvaluation(evaluation.scores) : undefined
  return <details className="lan-collapsible"><summary>评分、复盘与成本 <span>{average === undefined ? '尚无评分' : `${average.toFixed(1)} / 10`}</span></summary><div className="lan-detail-body">
    {evaluation ? <><div className="lan-score-hero"><strong>{winnerLabel(evaluation.winner)}</strong><span>{average?.toFixed(1)} / 10</span></div><h3>关键转折</h3><ul>{evaluation.keyTurningPoints.map((item) => <li key={item}>{item}</li>)}</ul></> : <p className="muted">辩论完成后会显示结构化评分。</p>}
    {review && <><h3>赛后复盘</h3><p>{review.summary}</p><h3>改进建议</h3><ul>{review.improvementSuggestions.map((item) => <li key={item}>{item}</li>)}</ul></>}
    <h3>本场成本</h3><p>{insights?.cost ? `${insights.cost.calls} 次调用 · ${insights.cost.totalTokens ?? 'Token 未知'} · ${insights.cost.totalCost === undefined ? '费用未知' : `${insights.cost.totalCost.toFixed(4)} ${insights.cost.currency}`}` : '暂无成本记录。'}</p>
  </div></details>
}

function TagList({ items }: { items: string[] }) { return <div className="lan-tag-list">{items.map((item) => <span key={item}>{item}</span>)}</div> }

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
function evidenceStatus(value: string) { return ({ unverified: '未核验', supported: '已支持', disputed: '有争议', outdated: '已过时', inaccessible: '无法访问', misleading: '可能误导', rejected: '已驳回' } as Record<string, string>)[value] ?? value }
function exportStatus(value: string) { return ({ generating: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[value] ?? value }
function winnerLabel(value: string) { return value === 'affirmative' ? '正方胜' : value === 'negative' ? '反方胜' : '平局' }
function averageEvaluation(scores: DebateEvaluationDto['scores']) {
  const values = Object.values(scores).flatMap((side) => Object.values(side).map((item) => item.score))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
