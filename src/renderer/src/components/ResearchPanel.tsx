import { useEffect, useMemo, useState } from 'react'

import type {
  DebateDetailDto,
  ResearchAssetDto,
  ResearchWorkspaceDto,
  RoleResearchWorkspaceDto
} from '../../../shared/ipc-contract'

interface ResearchPanelProps {
  detail: DebateDetailDto
  refreshKey: number
  onError(message: string): void
}

export type ResearchPresetId = 'quick' | 'balanced' | 'deep'

export const RESEARCH_PRESETS = {
  quick: {
    label: '精简', description: '更快、更省额度',
    limits: { maxToolCalls: 8, maxSearches: 2, maxPageReads: 2, maxBodyCharacters: 25_000 }
  },
  balanced: {
    label: '标准', description: '搜索深度与消耗平衡',
    limits: { maxToolCalls: 12, maxSearches: 3, maxPageReads: 3, maxBodyCharacters: 45_000 }
  },
  deep: {
    label: '深入', description: '更多来源与正文阅读',
    limits: { maxToolCalls: 20, maxSearches: 5, maxPageReads: 5, maxBodyCharacters: 80_000 }
  }
} as const

export function researchPresetForLimits(limits: ResearchWorkspaceDto['runtimeSettings']['limits']): ResearchPresetId {
  const matching = (Object.entries(RESEARCH_PRESETS) as Array<[ResearchPresetId, typeof RESEARCH_PRESETS[ResearchPresetId]]>)
    .find(([, preset]) => Object.entries(preset.limits).every(([key, value]) => limits[key as keyof typeof limits] === value))
  return matching?.[0] ?? 'balanced'
}

export function ResearchPresetSelector({ value, onChange }: { value: ResearchPresetId; onChange(value: ResearchPresetId): void }) {
  return <div className="research-preset-selector" role="group" aria-label="研究深度">
    {(Object.entries(RESEARCH_PRESETS) as Array<[ResearchPresetId, typeof RESEARCH_PRESETS[ResearchPresetId]]>).map(([id, preset]) => (
      <button key={id} type="button" className={value === id ? 'selected' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>
        <strong>{preset.label}</strong><span>{preset.description}</span>
      </button>
    ))}
  </div>
}

export function ResearchPanel({ detail, refreshKey, onError }: ResearchPanelProps) {
  const [workspace, setWorkspace] = useState<ResearchWorkspaceDto>()
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'automatic' | 'step-confirmation'>('automatic')
  const [presetId, setPresetId] = useState<ResearchPresetId>('balanced')

  const reload = async (): Promise<void> => {
    const result = await window.debateStudio.loadResearchWorkspace({ sessionId: detail.sessionId })
    if (result.ok) {
      setWorkspace(result.value)
      setMode(result.value.runtimeSettings.mode)
      setPresetId(researchPresetForLimits(result.value.runtimeSettings.limits))
    }
    else onError(result.error.descriptionZh)
  }

  useEffect(() => { void reload() }, [detail.sessionId, refreshKey])

  const participants = useMemo(() => ({
    affirmative: detail.participants.find((item) => item.role === 'affirmative'),
    negative: detail.participants.find((item) => item.role === 'negative'),
    moderator: detail.participants.find((item) => item.role === 'moderator')
  }), [detail.participants])

  const act = async (operation: () => Promise<{ ok: boolean; error?: { descriptionZh: string } }>): Promise<void> => {
    setBusy(true)
    const result = await operation()
    if (!result.ok) onError(result.error?.descriptionZh ?? '研究操作失败。')
    await reload()
    setBusy(false)
  }

  if (!workspace) return <section className="panel muted">正在加载研究与证据数据…</section>

  const activeResearch = ([['主持人', workspace.moderator], ['正方', workspace.affirmative], ['反方', workspace.negative]] as const)
    .find(([, roleWorkspace]) => roleWorkspace.loopState && ['running', 'waiting-approval', 'summarizing'].includes(roleWorkspace.loopState.status))
  const limits = RESEARCH_PRESETS[presetId].limits

  return (
    <details className={`research-panel panel ${activeResearch ? 'is-active' : ''}`}>
      <summary>
        <div><strong className={activeResearch ? 'research-shimmer-text' : undefined}>{activeResearch ? '研究中…' : '研究资料与证据'}</strong><span>{activeResearch ? `${activeResearch[0]}正在搜索、阅读并整理资料` : '已折叠；需要时点击三角展开'}</span></div>
        <span>{workspace.evidence.length} 条公开证据</span>
      </summary>

      <div className="research-content">
        {activeResearch && <div className="research-activity-line"><span className="activity-dot" /><strong>{activeResearch[0]}研究正在进行</strong><span>系统会自动完成搜索和网页阅读</span></div>}
        <details className="research-section collapsible-section research-controls">
          <summary><div><strong>研究设置</strong><span>{RESEARCH_PRESETS[presetId].label} · {mode === 'automatic' ? '全自动' : '只在发布证据前确认'}</span></div></summary>
          <div className="collapsible-body">
            <label className="field compact-field">执行模式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="automatic">全自动（推荐）</option><option value="step-confirmation">只在发布证据前确认</option></select></label>
            <ResearchPresetSelector value={presetId} onChange={setPresetId} />
            <div className="compact-actions">
              <button className="button secondary" onClick={() => void act(() => window.debateStudio.saveResearchRuntimeSettings({ mode, limits }))}>保存研究偏好</button>
              <button className="button danger" onClick={() => void window.debateStudio.stopDebate({ sessionId: detail.sessionId }).then((result) => { if (!result.ok) onError(result.error.descriptionZh) })}>停止研究 / 辩论</button>
            </div>
          </div>
        </details>
        <ModeratorResearchToolSection workspace={workspace.moderator} onDecision={async (callId, approved) => {
          const result = await window.debateStudio.decideResearchToolCall({ callId, approved })
          if (!result.ok) onError(result.error.descriptionZh)
          await reload()
        }} />
        <details className="research-section collapsible-section public-pool">
          <summary><div><strong>公共资源池</strong><span>{workspace.publicAssets.length} 条人工资料</span></div></summary>
          <div className="collapsible-body">
            {workspace.publicPool ? (
            <div className="research-copy">
              <p><b>辩题定义：</b>{workspace.publicPool.topicDefinition}</p>
              <p><b>范围：</b>{workspace.publicPool.temporalScope || '未限定时间'} · {workspace.publicPool.geographicScope || '未限定地域'}</p>
              <p><b>关键概念：</b>{workspace.publicPool.keyConcepts.join('、') || '暂无'}</p>
              <p><b>争议方向：</b>{workspace.publicPool.controversyDirections.join('、') || '暂无'}</p>
              <p><b>事实边界：</b>{workspace.publicPool.factBoundaries.join('、') || '暂无'}</p>
            </div>
            ) : <p className="muted">运行到“公共资源池”阶段后，主持人输出会保存在这里。</p>}
            {participants.moderator && (
              <AssetComposer
                label="添加公共资料"
                sessionId={detail.sessionId}
                ownerParticipantId={participants.moderator.id}
                visibility="public"
                disabled={busy}
                onError={onError}
                onSaved={reload}
              />
            )}
            <AssetList assets={workspace.publicAssets} onAnalyze={(assetId) => act(() => window.debateStudio.analyzeImageAsset({ assetId }))} />
          </div>
        </details>

        <div className="private-research-grid">
          {participants.affirmative && <RoleWorkspace
            title="正方研究" role="affirmative" workspace={workspace.affirmative}
            sessionId={detail.sessionId} participantId={participants.affirmative.id}
            disabled={busy} onError={onError} onSaved={reload}
            onPublish={(assetId) => act(() => window.debateStudio.publishResearchEvidence({
              sessionId: detail.sessionId, assetId, changedBy: participants.affirmative!.id
            }))} onAnalyze={(assetId) => act(() => window.debateStudio.analyzeImageAsset({ assetId }))}
          />}
          {participants.negative && <RoleWorkspace
            title="反方研究" role="negative" workspace={workspace.negative}
            sessionId={detail.sessionId} participantId={participants.negative.id}
            disabled={busy} onError={onError} onSaved={reload}
            onPublish={(assetId) => act(() => window.debateStudio.publishResearchEvidence({
              sessionId: detail.sessionId, assetId, changedBy: participants.negative!.id
            }))} onAnalyze={(assetId) => act(() => window.debateStudio.analyzeImageAsset({ assetId }))}
          />}
        </div>

        <details className="research-section collapsible-section evidence-desk">
          <summary><div><strong>公开证据桌</strong><span>{workspace.evidence.length} 条证据</span></div></summary>
          <div className="collapsible-body">
            {workspace.evidence.length === 0 ? <p className="muted">尚未发布公开证据。</p> : workspace.evidence.map((evidence) => {
            const history = workspace.evidenceHistory.filter((item) => item.evidenceId === evidence.id)
            const challenger = evidence.submitterRole === 'affirmative' ? participants.negative : participants.affirmative
            return (
              <details className="evidence-card" key={evidence.id}>
                <summary><strong>{evidence.publicCode} · {evidence.title}</strong><span className={`evidence-status evidence-${evidence.currentStatus}`}>{evidenceStatusLabel(evidence.currentStatus)}</span></summary>
                <div className="evidence-body">
                  <p>{evidence.summary || '无摘要'}</p>
                  <small>{evidence.sourceUrl || '人工资料 / 本地资产'}</small>
                  <div className="compact-actions">
                    {challenger && <button className="button secondary" disabled={busy} onClick={() => void act(() => window.debateStudio.challengeEvidence({
                      sessionId: detail.sessionId, evidenceId: evidence.id, changedBy: challenger.id, note: '对该证据的适用性或可靠性提出质疑。'
                    }))}>提出质疑</button>}
                    {participants.moderator && <EvidenceStatusEditor
                      value={evidence.currentStatus} disabled={busy}
                      onSave={(status) => act(() => window.debateStudio.updateEvidenceStatus({
                        sessionId: detail.sessionId, evidenceId: evidence.id, changedBy: participants.moderator!.id,
                        status, note: '主持人在公开证据桌更新状态。'
                      }))}
                    />}
                  </div>
                  <details className="history-list"><summary>状态历史（{history.length}）</summary>{history.map((item) => (
                    <p key={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {evidenceStatusLabel(item.toStatus)} · {item.note}</p>
                  ))}</details>
                </div>
              </details>
            )
            })}
            {workspace.invalidEvidenceReferences.length > 0 && <div className="notice error">
              检测到 {workspace.invalidEvidenceReferences.length} 个不存在的证据编号引用：
              {workspace.invalidEvidenceReferences.map((item) => item.referenceCode).join('、')}
            </div>}
          </div>
        </details>
      </div>
    </details>
  )
}

export function ModeratorResearchToolSection({ workspace, onDecision }: {
  workspace: RoleResearchWorkspaceDto
  onDecision(callId: string, approved: boolean): Promise<void>
}) {
  if (!workspace.toolCalls.length && !workspace.fetchedPages.length && !workspace.sourceEvaluations.length) return null
  return <details className="research-section collapsible-section moderator-tool-activity">
    <summary><div><strong>主持人研究记录</strong><span>{workspace.toolCalls.length} 次工具调用</span></div></summary>
    <div className="collapsible-body"><ToolCallList calls={workspace.toolCalls} onDecision={onDecision} /><FetchedPageList workspace={workspace} /></div>
  </details>
}

function RoleWorkspace({ title, role, workspace, sessionId, participantId, disabled, onError, onSaved, onPublish, onAnalyze }: {
  title: string
  role: 'affirmative' | 'negative'
  workspace: RoleResearchWorkspaceDto
  sessionId: string
  participantId: string
  disabled: boolean
  onError(message: string): void
  onSaved(): Promise<void>
  onPublish(assetId: string): Promise<void>
  onAnalyze(assetId: string): Promise<void>
}) {
  const [query, setQuery] = useState('')
  const search = async (): Promise<void> => {
    const result = await window.debateStudio.runMockSearch({ sessionId, ownerParticipantId: participantId, query })
    if (!result.ok) onError(result.error.descriptionZh)
    else { setQuery(''); await onSaved() }
  }
  return (
    <details className={`research-section collapsible-section private-workspace role-${role}`}>
      <summary><div><strong>{title}</strong><span>{workspace.sources.length} 条资料 · {workspace.claims.length} 条暂定主张</span></div></summary>
      <div className="collapsible-body">
        {workspace.loopState && <div className="research-progress">
          <strong>{['running', 'waiting-approval', 'summarizing'].includes(workspace.loopState.status) ? '研究中…' : '研究已记录'}</strong>
          <span>工具 {workspace.loopState.toolCallCount}/{workspace.loopState.limits.maxToolCalls} · 搜索 {workspace.loopState.searchCount}/{workspace.loopState.limits.maxSearches} · 读页 {workspace.loopState.pageReadCount}/{workspace.loopState.limits.maxPageReads}</span>
        </div>}
        <ResearchList title="研究目标" values={workspace.goals.map((item) => item.description)} />
        <ResearchList title="准备核实的问题" values={workspace.queries.map((item) => item.query)} />
        <ResearchList title="资料与评价" values={workspace.sources.map((item) => `${item.title}：${item.evaluation || item.summary || '未评价'}`)} />
        <ResearchList title="研究笔记" values={workspace.notes.map((item) => item.content)} />
        <ResearchList title="暂定主张" values={workspace.claims.map((item) => item.claim)} />
        <ToolCallList calls={workspace.toolCalls} onDecision={async (callId, approved) => {
          const result = await window.debateStudio.decideResearchToolCall({ callId, approved })
          if (!result.ok) onError(result.error.descriptionZh)
          await onSaved()
        }} />
        <FetchedPageList workspace={workspace} />
        <details className="research-subsection"><summary>手动添加或搜索资料</summary><div className="research-subsection-body">
          <div className="mock-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 Mock 搜索词（不访问网络）" /><button className="button secondary" disabled={disabled || !query.trim()} onClick={() => void search()}>Mock 搜索</button></div>
          <AssetComposer label="添加本方资料" sessionId={sessionId} ownerParticipantId={participantId} visibility={`${role}-private`} disabled={disabled} onError={onError} onSaved={onSaved} />
          <AssetList assets={workspace.assets} onPublish={onPublish} onAnalyze={onAnalyze} />
        </div></details>
      </div>
    </details>
  )
}

function ToolCallList({ calls, onDecision }: { calls: RoleResearchWorkspaceDto['toolCalls']; onDecision(callId: string, approved: boolean): Promise<void> }) {
  const [page, setPage] = useState(0)
  const pageSize = 8
  if (!calls.length) return null
  const visible = [...calls].reverse().slice(page * pageSize, (page + 1) * pageSize)
  return <div className="tool-call-list"><b>研究工具调用</b>{visible.map((call) => <div className="tool-call-row" key={call.id}>
    <div><strong>{call.toolName}</strong><span>{call.status} · {new Date(call.createdAt).toLocaleTimeString('zh-CN')}</span><small>{call.resultSummary || call.errorDescriptionZh || '等待执行'}</small></div>
    {call.status === 'pending-approval' && <div className="compact-actions"><button className="button primary" onClick={() => void onDecision(call.id, true)}>允许</button><button className="button secondary" onClick={() => void onDecision(call.id, false)}>拒绝</button></div>}
  </div>)}
  {calls.length > pageSize && <div className="pagination"><button className="button ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}/{Math.ceil(calls.length / pageSize)}</span><button className="button ghost" disabled={(page + 1) * pageSize >= calls.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
  </div>
}

function FetchedPageList({ workspace }: { workspace: RoleResearchWorkspaceDto }) {
  if (!workspace.fetchedPages.length && !workspace.sourceEvaluations.length) return null
  return <div className="fetched-page-list"><b>已打开网页与来源评价</b>{workspace.fetchedPages.map((page) => {
    const evaluations = workspace.sourceEvaluations.filter((item) => item.sourceId === page.sourceId)
    return <details key={page.id}><summary>{page.title} · {page.status === 'completed' ? '已读取正文' : '无法访问'}</summary>
      <p>{page.summary}</p><small>{page.finalUrl}</small>
      {evaluations.map((evaluation) => <div className="source-evaluation" key={evaluation.id}><strong>{evaluation.sourceType} · {evaluation.basedOn === 'full-text' ? '基于正文' : '仅基于摘要'}</strong><p>用途：{evaluation.purpose}</p><p>可信度：{evaluation.credibility}</p><p>局限：{evaluation.limitations}</p></div>)}
    </details>
  })}</div>
}

function ResearchList({ title, values }: { title: string; values: string[] }) {
  return <details className="research-list"><summary><b>{title}</b><span>{values.length}</span></summary>{values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value.slice(0, 20)}`}>{value}</li>)}</ul> : <span>暂无</span>}</details>
}

function AssetList({ assets, onPublish, onAnalyze }: { assets: ResearchAssetDto[]; onPublish?(assetId: string): Promise<void>; onAnalyze?(assetId: string): Promise<void> }) {
  if (!assets.length) return null
  return <div className="asset-list">{assets.map((asset) => <div className="asset-row" key={asset.id}>
    {asset.thumbnailDataUrl && <img className="asset-thumbnail" src={asset.thumbnailDataUrl} alt={asset.title} />}
    <div><strong>{asset.title}</strong><span>{asset.kind === 'image' ? '图片' : asset.kind === 'pdf' ? `PDF · ${asset.fileMetadata?.pageCount ?? '未知'} 页` : asset.kind === 'url' ? 'URL 元数据' : '文本'} · {asset.fileMetadata ? formatFileSize(asset.fileMetadata.fileSize) : asset.summary || asset.textContent?.slice(0, 80) || asset.url || '已保存'}</span>{asset.fileMetadata?.analysisStatus && asset.kind === 'image' && <small>分析状态：{analysisStatusLabel(asset.fileMetadata.analysisStatus)}{asset.fileMetadata.analysisModelProfileId ? ` · 模型 ${asset.fileMetadata.analysisModelProfileId}` : ''}</small>}{asset.capabilityWarningZh && <small>{asset.capabilityWarningZh}</small>}</div>
    <div className="compact-actions">{onAnalyze && asset.kind === 'image' && <button className="button secondary" onClick={() => void onAnalyze(asset.id)}>分析图片</button>}{onPublish && <button className="button secondary" onClick={() => void onPublish(asset.id)}>发布证据</button>}</div>
  </div>)}</div>
}

function AssetComposer({ label, sessionId, ownerParticipantId, visibility, disabled, onError, onSaved }: {
  label: string
  sessionId: string
  ownerParticipantId: string
  visibility: 'public' | 'affirmative-private' | 'negative-private'
  disabled: boolean
  onError(message: string): void
  onSaved(): Promise<void>
}) {
  const [kind, setKind] = useState<'text' | 'url' | 'image' | 'pdf'>('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File>()
  const save = async (): Promise<void> => {
    const common = { sessionId, ownerParticipantId, visibility, title, summary: kind === 'url' ? content : undefined }
    const input = kind === 'text'
      ? { ...common, kind, textContent: content }
      : kind === 'url'
        ? { ...common, kind, url: content }
        : { ...common, kind, fileName: file?.name || '', mimeType: kind === 'pdf' ? 'application/pdf' : file?.type || '', bytes: file ? [...new Uint8Array(await file.arrayBuffer())] : [] }
    const result = await window.debateStudio.addResearchAsset(input)
    if (!result.ok) onError(result.error.descriptionZh)
    else { setTitle(''); setContent(''); setFile(undefined); await onSaved() }
  }
  return <div className="asset-composer">
    <strong>{label}</strong>
    <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setFile(undefined) }}><option value="text">粘贴文本</option><option value="url">URL 与人工摘要</option><option value="image">上传图片</option><option value="pdf">上传 PDF（不做 OCR）</option></select>
    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" />
    {kind === 'image' || kind === 'pdf' ? <input type="file" accept={kind === 'pdf' ? 'application/pdf' : 'image/*'} onChange={(event) => setFile(event.target.files?.[0])} /> : <textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} placeholder={kind === 'url' ? '网页 URL（本次不抓取正文）' : '粘贴资料文本'} />}
    <button className="button secondary" disabled={disabled || !title.trim() || (kind === 'image' || kind === 'pdf' ? !file : !content.trim())} onClick={() => void save()}>保存资料</button>
  </div>
}

function formatFileSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
function analysisStatusLabel(status: string): string { return ({ 'not-requested': '未分析', pending: '分析中', completed: '已完成', failed: '失败' } as Record<string, string>)[status] ?? status }

function EvidenceStatusEditor({ value, disabled, onSave }: { value: string; disabled: boolean; onSave(status: 'unverified' | 'supported' | 'disputed' | 'outdated' | 'inaccessible' | 'misleading' | 'rejected'): Promise<void> }) {
  const [status, setStatus] = useState(value as Parameters<typeof onSave>[0])
  useEffect(() => setStatus(value as Parameters<typeof onSave>[0]), [value])
  return <div className="status-editor"><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{['unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected'].map((item) => <option key={item} value={item}>{evidenceStatusLabel(item)}</option>)}</select><button className="button secondary" disabled={disabled || status === value} onClick={() => void onSave(status)}>主持人更新</button></div>
}

function evidenceStatusLabel(status: string): string {
  return { unverified: '未核验', supported: '获支持', disputed: '有争议', outdated: '已过时', inaccessible: '无法访问', misleading: '可能误导', rejected: '已驳回' }[status] ?? status
}
