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

export function ResearchPanel({ detail, refreshKey, onError }: ResearchPanelProps) {
  const [workspace, setWorkspace] = useState<ResearchWorkspaceDto>()
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    const result = await window.debateStudio.loadResearchWorkspace({ sessionId: detail.sessionId })
    if (result.ok) setWorkspace(result.value)
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

  return (
    <details className="research-panel panel" open>
      <summary>
        <div><strong>研究与证据</strong><span>公共资源池、双方隔离研究区与公开证据桌</span></div>
        <span>{workspace.evidence.length} 条公开证据</span>
      </summary>

      <div className="research-content">
        <section className="research-section public-pool">
          <div className="section-heading"><div><strong>公共资源池</strong><span>所有角色可见；主持人不会在此替双方完成论证</span></div></div>
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
          <AssetList assets={workspace.publicAssets} />
        </section>

        <div className="private-research-grid">
          {participants.affirmative && <RoleWorkspace
            title="正方研究" role="affirmative" workspace={workspace.affirmative}
            sessionId={detail.sessionId} participantId={participants.affirmative.id}
            disabled={busy} onError={onError} onSaved={reload}
            onPublish={(assetId) => act(() => window.debateStudio.publishResearchEvidence({
              sessionId: detail.sessionId, assetId, changedBy: participants.affirmative!.id
            }))}
          />}
          {participants.negative && <RoleWorkspace
            title="反方研究" role="negative" workspace={workspace.negative}
            sessionId={detail.sessionId} participantId={participants.negative.id}
            disabled={busy} onError={onError} onSaved={reload}
            onPublish={(assetId) => act(() => window.debateStudio.publishResearchEvidence({
              sessionId: detail.sessionId, assetId, changedBy: participants.negative!.id
            }))}
          />}
        </div>

        <section className="research-section evidence-desk">
          <div className="section-heading"><div><strong>公开证据桌</strong><span>发布不会删除原私有资料；状态变化保留完整历史</span></div></div>
          {workspace.evidence.length === 0 ? <p className="muted">尚未发布公开证据。</p> : workspace.evidence.map((evidence) => {
            const history = workspace.evidenceHistory.filter((item) => item.evidenceId === evidence.id)
            const challenger = evidence.submitterRole === 'affirmative' ? participants.negative : participants.affirmative
            return (
              <article className="evidence-card" key={evidence.id}>
                <header><strong>{evidence.publicCode} · {evidence.title}</strong><span className={`evidence-status evidence-${evidence.currentStatus}`}>{evidenceStatusLabel(evidence.currentStatus)}</span></header>
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
              </article>
            )
          })}
          {workspace.invalidEvidenceReferences.length > 0 && <div className="notice error">
            检测到 {workspace.invalidEvidenceReferences.length} 个不存在的证据编号引用：
            {workspace.invalidEvidenceReferences.map((item) => item.referenceCode).join('、')}
          </div>}
        </section>
      </div>
    </details>
  )
}

function RoleWorkspace({ title, role, workspace, sessionId, participantId, disabled, onError, onSaved, onPublish }: {
  title: string
  role: 'affirmative' | 'negative'
  workspace: RoleResearchWorkspaceDto
  sessionId: string
  participantId: string
  disabled: boolean
  onError(message: string): void
  onSaved(): Promise<void>
  onPublish(assetId: string): Promise<void>
}) {
  const [query, setQuery] = useState('')
  const search = async (): Promise<void> => {
    const result = await window.debateStudio.runMockSearch({ sessionId, ownerParticipantId: participantId, query })
    if (!result.ok) onError(result.error.descriptionZh)
    else { setQuery(''); await onSaved() }
  }
  return (
    <section className={`research-section private-workspace role-${role}`}>
      <div className="section-heading"><div><strong>{title}</strong><span>仅注入本方模型上下文；用户界面可查看</span></div></div>
      <ResearchList title="研究目标" values={workspace.goals.map((item) => item.description)} />
      <ResearchList title="准备核实的问题" values={workspace.queries.map((item) => item.query)} />
      <ResearchList title="资料与评价" values={workspace.sources.map((item) => `${item.title}：${item.evaluation || item.summary || '未评价'}`)} />
      <ResearchList title="研究笔记" values={workspace.notes.map((item) => item.content)} />
      <ResearchList title="暂定主张" values={workspace.claims.map((item) => item.claim)} />
      <div className="mock-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 Mock 搜索词（不访问网络）" /><button className="button secondary" disabled={disabled || !query.trim()} onClick={() => void search()}>Mock 搜索</button></div>
      <AssetComposer label="添加本方资料" sessionId={sessionId} ownerParticipantId={participantId} visibility={`${role}-private`} disabled={disabled} onError={onError} onSaved={onSaved} />
      <AssetList assets={workspace.assets} onPublish={onPublish} />
    </section>
  )
}

function ResearchList({ title, values }: { title: string; values: string[] }) {
  return <div className="research-list"><b>{title}</b>{values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value.slice(0, 20)}`}>{value}</li>)}</ul> : <span>暂无</span>}</div>
}

function AssetList({ assets, onPublish }: { assets: ResearchAssetDto[]; onPublish?(assetId: string): Promise<void> }) {
  if (!assets.length) return null
  return <div className="asset-list">{assets.map((asset) => <div className="asset-row" key={asset.id}>
    <div><strong>{asset.title}</strong><span>{asset.kind === 'image' ? '图片' : asset.kind === 'url' ? 'URL 元数据' : '文本'} · {asset.summary || asset.textContent?.slice(0, 80) || asset.url || '已保存'}</span>{asset.capabilityWarningZh && <small>{asset.capabilityWarningZh}</small>}</div>
    {onPublish && <button className="button secondary" onClick={() => void onPublish(asset.id)}>发布证据</button>}
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
  const [kind, setKind] = useState<'text' | 'url' | 'image'>('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File>()
  const save = async (): Promise<void> => {
    const common = { sessionId, ownerParticipantId, visibility, title, summary: kind === 'url' ? content : undefined }
    const input = kind === 'text'
      ? { ...common, kind, textContent: content }
      : kind === 'url'
        ? { ...common, kind, url: content }
        : { ...common, kind, fileName: file?.name || '', mimeType: file?.type || '', bytes: file ? [...new Uint8Array(await file.arrayBuffer())] : [] }
    const result = await window.debateStudio.addResearchAsset(input)
    if (!result.ok) onError(result.error.descriptionZh)
    else { setTitle(''); setContent(''); setFile(undefined); await onSaved() }
  }
  return <div className="asset-composer">
    <strong>{label}</strong>
    <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="text">粘贴文本</option><option value="url">URL 与人工摘要</option><option value="image">上传图片</option></select>
    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" />
    {kind === 'image' ? <input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0])} /> : <textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} placeholder={kind === 'url' ? '网页 URL（本次不抓取正文）' : '粘贴资料文本'} />}
    <button className="button secondary" disabled={disabled || !title.trim() || (kind === 'image' ? !file : !content.trim())} onClick={() => void save()}>保存资料</button>
  </div>
}

function EvidenceStatusEditor({ value, disabled, onSave }: { value: string; disabled: boolean; onSave(status: 'unverified' | 'supported' | 'disputed' | 'outdated' | 'inaccessible' | 'misleading' | 'rejected'): Promise<void> }) {
  const [status, setStatus] = useState(value as Parameters<typeof onSave>[0])
  useEffect(() => setStatus(value as Parameters<typeof onSave>[0]), [value])
  return <div className="status-editor"><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{['unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected'].map((item) => <option key={item} value={item}>{evidenceStatusLabel(item)}</option>)}</select><button className="button secondary" disabled={disabled || status === value} onClick={() => void onSave(status)}>主持人更新</button></div>
}

function evidenceStatusLabel(status: string): string {
  return { unverified: '未核验', supported: '获支持', disputed: '有争议', outdated: '已过时', inaccessible: '无法访问', misleading: '可能误导', rejected: '已驳回' }[status] ?? status
}
