import { useEffect, useMemo, useRef, useState } from 'react'

import type { DebateHistorySummaryDto, DebateTurnDto, LanDebateDetailDto, LanEventEnvelopeDto, LanSessionSnapshotDto } from '../../shared/ipc-contract'
import type { LanDebateInsightsDto, LanExportRecordDto, LanModelProfileDto, LanResearchWorkspaceDto } from '../../shared/lan-dtos'
import type { PlannedDebateDto } from '../../shared/debate-dtos'
import type { DebateEvaluationDto } from '../../shared/quality-dtos'
import { DebateProgress } from '../../renderer/src/components/DebateProgress'
import {
  CreationModeSelector,
  DebateTurnCard,
  PageHeader,
  ParticipantStrip,
  RunControlBar,
  WorkbenchShell,
  type CreationMode
} from '../../renderer/src/components/UnifiedWorkbench'
import { applyRunEvent, type LiveRunSnapshot } from '../../renderer/src/run-state'
import { LanApiClient } from './lan-api-client'

type View = { type: 'list' } | { type: 'create' } | { type: 'live'; debateId: string; sessionId: string }

export function LanApp() {
  const client = useMemo(() => new LanApiClient(), [])
  const [ready, setReady] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [view, setView] = useState<View>({ type: 'list' })
  const [version, setVersion] = useState('…')

  const connect = () => void client.session().then((result) => {
    if (result.ok) { setReady(true); setConnectionError('') }
    else setConnectionError(`${result.error.titleZh}：${result.error.descriptionZh}`)
  })
  useEffect(connect, [client])
  useEffect(() => { void client.publicStatus().then((result) => result.ok && setVersion(result.value.version)) }, [client])

  if (!ready) return <div className="lan-centered"><div className="lan-spinner" /><p>{connectionError || '正在连接 Debate Studio…'}</p>{connectionError && <button className="button primary" onClick={connect}>重试连接</button>}</div>
  return <WorkbenchShell
    subtitle="局域网 Web 控制台"
    version={`v${version}`}
    mobileNavigation
    primaryNav={[
      { id: 'list', label: '辩论列表', active: view.type === 'list', onSelect: () => setView({ type: 'list' }) },
      { id: 'create', label: '新建辩论', active: view.type === 'create', onSelect: () => setView({ type: 'create' }) }
    ]}
  >{view.type === 'list'
      ? <DebateListPage client={client} onCreate={() => setView({ type: 'create' })} onOpen={(debate) => setView({ type: 'live', debateId: debate.id, sessionId: debate.sessionId })} />
      : view.type === 'create'
        ? <NewDebatePage client={client} onCancel={() => setView({ type: 'list' })} onCreated={(debate) => setView({ type: 'live', debateId: debate.id, sessionId: debate.sessionId })} />
        : <LivePage client={client} {...view} onBack={() => setView({ type: 'list' })} />}
  </WorkbenchShell>
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
  return <section className="page-stack" aria-labelledby="lan-home-title">
    <PageHeader id="lan-home-title" eyebrow="本地辩论工作台" title="辩论历史" description="查看和控制这台 Mac 上保存的辩论。" actions={<><button className="button secondary" onClick={onCreate}>新建辩论</button><button className="button primary" onClick={createMock}>创建 Mock 示例辩论</button></>} />
    <form className="panel history-toolbar web-history-toolbar" onSubmit={(event) => { event.preventDefault(); load(0) }}>
      <label className="field history-search">搜索<input type="search" aria-label="搜索辩论" placeholder="搜索自定义名称或辩题" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button className="button primary">搜索</button>
    </form>
    {message && <div className="empty-state compact"><h2>{message}</h2><p>可返回 Mac 客户端检查记录，或创建一场新的辩论。</p></div>}
    <div className="debate-grid">{items.map((debate) => <article className="debate-card" key={debate.id}>
      <div className="card-topline"><span className={`status-pill status-${debate.status}`}>{statusLabel(debate.status)}</span></div>
      <h2>{debate.displayTitle}</h2>
      {debate.displayTitle !== debate.topic && <p className="history-topic">原辩题：{debate.topic}</p>}
      <div className="history-card-facts"><span>当前阶段：{stageLabel(debate.currentStage)}</span><span>创建：{new Date(debate.createdAt).toLocaleString('zh-CN')}</span><span>更新：{new Date(debate.updatedAt).toLocaleString('zh-CN')}</span></div>
      {debate.tags.length > 0 && <div className="tag-list">{debate.tags.map((tag) => <span className="tag-pill" key={tag}>{tag}</span>)}</div>}
      <div className="compact-actions history-card-actions"><button className="button secondary" onClick={() => onOpen(debate)}>继续查看或运行</button></div>
    </article>)}</div>
    <div className="lan-pagination"><button className="button ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 20))}>上一页</button><span>第 {Math.floor(offset / 20) + 1} 页</span><button className="button ghost" disabled={!hasMore} onClick={() => load(offset + 20)}>下一页</button></div>
  </section>
}

function NewDebatePage({ client, onCancel, onCreated }: { client: LanApiClient; onCancel(): void; onCreated(debate: LanDebateDetailDto): void }) {
  const [mode, setMode] = useState<CreationMode>('auto')
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
  return <section className="page-stack new-debate-page" aria-labelledby="lan-new-debate-title">
    <PageHeader id="lan-new-debate-title" eyebrow="Debate Planner" title="新建辩论" description="只输入一个辩题，也可以先生成方案、确认后再创建。" actions={<button className="button ghost header-back-button" onClick={onCancel}>返回列表</button>} />
    <section className="creation-mode-panel panel"><div className="section-heading"><div><h2>创建方式</h2><span>AI 只返回最终结构化方案，不保存分析过程</span></div></div><CreationModeSelector value={mode} onChange={(value) => { setMode(value); setPlan(undefined) }} /></section>
    <section className="panel planner-input-panel lan-form-card">
      <label className="field">辩题<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：大学是否应设立每周无课日？" /></label>
      <div className="planner-options"><label className="field">背景说明（可选）<textarea value={background} onChange={(event) => setBackground(event.target.value)} placeholder="可留空，让 AI 自动补全" /></label><label className="field">领域（可选）<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="教育、科技、政策…" /></label><label className="field">期望深度<select value={depth} onChange={(event) => setDepth(event.target.value as typeof depth)}><option value="light">简要</option><option value="standard">标准</option><option value="deep">深入</option></select></label></div>
      {(mode !== 'auto' || plan) && <div className="assisted-positions"><label className="field">正方立场<textarea value={affirmative} onChange={(event) => setAffirmative(event.target.value)} /></label><label className="field">反方立场<textarea value={negative} onChange={(event) => setNegative(event.target.value)} /></label></div>}
      {mode !== 'manual' && <button className="button ghost" disabled={!canPlan || busy} onClick={() => void generate()}>{plan ? '重新生成方案' : '生成辩论方案'}</button>}
      {plan && <details className="lan-plan-details"><summary>编辑 AI 方案要点</summary><div className="lan-plan-editor"><label>核心争议（每行一项）<textarea value={plan.plan.keyQuestions.join('\n')} onChange={(event) => updatePlanList('keyQuestions', event.target.value)} /></label><label>研究方向（每行一项）<textarea value={plan.plan.researchDirections.join('\n')} onChange={(event) => updatePlanList('researchDirections', event.target.value)} /></label><label>建议证据类型（每行一项）<textarea value={plan.plan.evidenceSuggestions.join('\n')} onChange={(event) => updatePlanList('evidenceSuggestions', event.target.value)} /></label></div></details>}
    </section>
    <section className="panel model-binding-panel lan-form-card"><div className="section-heading"><div><h2>辩论模型</h2><span>{profiles.length} 个可用模型</span></div></div>{profiles.length ? <div className="model-binding-grid"><label className="field">自由辩论轮数<input type="number" min="1" max="20" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} /></label><div /><ModelSelect label="正方模型" value={models.affirmative} profiles={profiles} onChange={(value) => setModels({ ...models, affirmative: value })} /><ModelSelect label="反方模型" value={models.negative} profiles={profiles} onChange={(value) => setModels({ ...models, negative: value })} /><ModelSelect label="主持人模型" value={models.moderator} profiles={profiles} onChange={(value) => setModels({ ...models, moderator: value })} /><ModelSelect label="裁判模型（可选）" value={models.judge} profiles={profiles} optional onChange={(value) => setModels({ ...models, judge: value })} /></div> : <div className="notice">尚未配置模型。可返回 Mac 客户端配置，或在首页创建 Mock 示例。</div>}</section>
    {activity && <div className="notice" role="status"><span className={busy ? 'lan-activity-dot active' : 'lan-activity-dot'} />{activity}</div>}
    {message && <div className="notice error" role="alert">{message}</div>}
    <div className="form-actions planner-final-actions"><button className="button ghost" onClick={onCancel}>取消</button><button className="button primary" disabled={!canCreate} onClick={() => void create()}>创建辩论</button></div>
  </section>
}

function ModelSelect({ label, value, profiles, optional, onChange }: { label: string; value: string; profiles: LanModelProfileDto[]; optional?: boolean; onChange(value: string): void }) {
  return <label className="field">{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{optional && <option value="">不配置</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.alias || profile.displayName} · {profile.modelId}</option>)}</select></label>
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

  const status = snapshot.state?.status ?? detail?.status ?? 'draft'
  const stage = snapshot.state?.currentStage ?? detail?.currentStage ?? 'draft'
  return <section className="page-stack live-page lan-live" aria-labelledby="lan-live-title" onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120 }}>
    {offline && <div className="lan-offline">主机已离线，正在自动重连。当前画面会保留。</div>}
    <PageHeader id="lan-live-title" eyebrow="实时辩论" title={detail?.topic ?? '正在加载…'} description={`${statusLabel(status)} · 阶段：${stageLabel(stage)}`} actions={<button className="button ghost header-back-button" onClick={onBack}>返回列表</button>} />
    <DebateProgress stage={stage} />
    <InsightsSection insights={insights} />
    <RunControlBar status={status} statusText={statusLabel(status)} actions={[
      { id: 'start', label: '启动', tone: 'primary', disabled: status !== 'draft', onClick: () => void command('start') },
      { id: 'pause', label: '暂停', disabled: !['running', 'streaming'].includes(status), onClick: () => void command('pause') },
      { id: 'resume', label: '继续', disabled: status !== 'paused', onClick: () => void command('resume') },
      { id: 'stop', label: '停止', tone: 'danger', disabled: !['running', 'streaming', 'paused', 'failed', 'interrupted'].includes(status), onClick: () => void command('stop') }
    ]} />
    {error && <div className="notice error" role="alert">{error}</div>}
    <ParticipantStrip participants={(detail?.participants ?? []).map((participant) => ({ id: participant.id, role: participant.role, roleLabel: roleLabel(participant.role), name: participant.displayName }))} />
    <ResearchSection research={research} />
    {detail && <AssetUploadCard client={client} detail={detail} onUploaded={loadRelated} />}
    {turnCursor && <button className="button ghost load-older-button" onClick={() => void loadOlderTurns()}>加载更早的发言与研究记录</button>}
    <div className="turn-list">{snapshot.turns.map((turn) => <TurnCard key={turn.id} turn={turn} reasoning={snapshot.reasoningByTurn?.[turn.id]?.content} detail={detail} />)}</div>
    <section className="panel lan-export-card"><div className="section-heading"><div><h2>导出</h2><span>文件在 Mac 后台生成，浏览器只获取下载流。</span></div><div className="compact-actions"><button className="button ghost" onClick={() => void createExport('markdown')}>导出 Markdown</button><button className="button ghost" onClick={() => void createExport('html')}>导出 HTML</button></div></div><div className="lan-export-list">{exports.length ? exports.map((record) => <div key={record.exportId}><span>{record.type.toUpperCase()} · {exportStatus(record.status)}{record.status === 'generating' ? ` ${record.progress}%` : ''}</span>{record.status === 'completed' && <a className="button ghost" href={client.exportDownloadUrl(record.exportId)}>下载</a>}</div>) : <p className="muted">尚无导出记录。</p>}</div></section>
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
      {workspace.loopState && <p className="lan-research-status">{workspace.loopState.goal || '研究中'} · {workspace.loopState.status} · {workspace.loopState.toolCallCount} 次研究动作 · {workspace.loopState.decisionRoundCount ?? 0}/{workspace.loopState.limits.maxDecisionRounds ?? '—'} 轮决策</p>}
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
  const role = participant?.role ?? 'moderator'
  return <DebateTurnCard
    turn={turn}
    role={role}
    name={participant ? roleLabel(role) : '发言'}
    stageText={stageLabel(turn.stage)}
    statusText={statusLabel(turn.status)}
    reasoning={reasoning ? <details className="reasoning-activity"><summary><div><strong>服务商返回的思考内容 / 摘要</strong><span>当前 Web 会话实时同步</span></div><span className="reasoning-live-status">实时</span></summary><div className="reasoning-activity-body"><pre>{reasoning}</pre></div></details> : undefined}
    failure={turn.failure ? <div className="notice error"><strong>{turn.failure.titleZh}</strong><p>{turn.failure.descriptionZh}</p></div> : undefined}
  />
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
