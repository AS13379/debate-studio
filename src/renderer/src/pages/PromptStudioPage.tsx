import { useEffect, useMemo, useState } from 'react'

import type { PromptTemplateDetailDto } from '../../../shared/ipc-contract'

export function PromptStudioPage() {
  const [details, setDetails] = useState<PromptTemplateDetailDto[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [content, setContent] = useState('')
  const [note, setNote] = useState('')
  const [compareLeft, setCompareLeft] = useState(1)
  const [compareRight, setCompareRight] = useState(1)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const load = async (): Promise<void> => {
    const result = await window.debateStudio.listPromptTemplates()
    if (!result.ok) { setError(result.error.descriptionZh); return }
    setDetails(result.value)
    setSelectedId((current) => current || result.value[0]?.template.id || '')
  }
  useEffect(() => { void load() }, [])
  const selected = useMemo(() => details.find((item) => item.template.id === selectedId), [details, selectedId])
  useEffect(() => {
    if (!selected) return
    const active = selected.versions.find((item) => item.version === selected.template.activeVersion)
    setContent(active?.content ?? '')
    setCompareLeft(selected.versions.at(1)?.version ?? selected.template.activeVersion)
    setCompareRight(selected.template.activeVersion)
  }, [selectedId, selected?.template.activeVersion])

  const save = async (): Promise<void> => {
    if (!selected) return
    setBusy(true); setError(undefined); setMessage(undefined)
    const result = await window.debateStudio.createPromptVersion({ templateId: selected.template.id, content, changeNote: note || undefined })
    if (!result.ok) setError(result.error.descriptionZh)
    else { setMessage(`已创建并激活 v${result.value.template.activeVersion}`); setNote(''); await load() }
    setBusy(false)
  }
  const rollback = async (version: number): Promise<void> => {
    if (!selected) return
    setBusy(true); setError(undefined)
    const result = await window.debateStudio.rollbackPromptVersion({ templateId: selected.template.id, version })
    if (!result.ok) setError(result.error.descriptionZh)
    else { setMessage(`已回滚到 v${version}，历史版本仍保留。`); await load() }
    setBusy(false)
  }
  const left = selected?.versions.find((item) => item.version === compareLeft)
  const right = selected?.versions.find((item) => item.version === compareRight)

  return <section className="page-stack prompt-studio-page" aria-labelledby="prompt-studio-title">
    <header className="page-header compact"><div><span className="eyebrow">PROMPT STUDIO</span><h2 id="prompt-studio-title">Prompt 实验室</h2><p className="page-description">创建新版本、对比和回滚；每次模型调用会记录实际使用的版本。</p></div></header>
    <div className="prompt-studio-layout">
      <aside className="panel prompt-template-list">{details.map((item) => <button key={item.template.id} className={selectedId === item.template.id ? 'active' : ''} onClick={() => setSelectedId(item.template.id)}><strong>{item.template.displayName}</strong><span>{taskLabel(item.template.task)} · v{item.template.activeVersion}</span></button>)}</aside>
      {selected && <div className="page-stack">
        <section className="panel prompt-editor-panel">
          <div className="section-heading"><div><strong>{selected.template.displayName}</strong><span>当前激活 v{selected.template.activeVersion} · {selected.usage.length} 条近期调用</span></div></div>
          <label className="field"><span>Prompt 内容</span><textarea rows={9} value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <label className="field"><span>版本说明（可选）</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="例如：强化证据边界" /></label>
          <div className="form-actions"><button className="button primary" disabled={busy || !content.trim()} onClick={() => void save()}>创建新版本并激活</button></div>
          {message && <div className="notice success">{message}</div>}{error && <div className="notice error">{error}</div>}
        </section>
        <section className="panel prompt-version-panel">
          <div className="section-heading"><div><strong>历史版本</strong><span>回滚只切换激活版本，不删除任何记录</span></div></div>
          <div className="prompt-version-list">{selected.versions.map((version) => <article key={version.id}><div><strong>v{version.version}{version.version === selected.template.activeVersion ? ' · 当前' : ''}</strong><span>{new Date(version.createdAt).toLocaleString('zh-CN')} · {version.changeNote ?? '无说明'}</span></div><button className="button ghost" disabled={busy || version.version === selected.template.activeVersion} onClick={() => void rollback(version.version)}>回滚至此版本</button></article>)}</div>
        </section>
        <section className="panel prompt-compare-panel">
          <div className="section-heading"><div><strong>版本对比</strong><span>并排检查指令变化</span></div></div>
          <div className="prompt-compare-selects"><label>Version A<select value={compareLeft} onChange={(event) => setCompareLeft(Number(event.target.value))}>{selected.versions.map((version) => <option key={version.id} value={version.version}>v{version.version}</option>)}</select></label><label>Version B<select value={compareRight} onChange={(event) => setCompareRight(Number(event.target.value))}>{selected.versions.map((version) => <option key={version.id} value={version.version}>v{version.version}</option>)}</select></label></div>
          <div className="prompt-compare-grid"><pre>{left?.content}</pre><pre>{right?.content}</pre></div>
        </section>
      </div>}
    </div>
  </section>
}

function taskLabel(task: string): string { return { debate_planning: '辩题规划', research: '研究', argument: '立论', rebuttal: '反驳', judge: '裁判', review: '复盘' }[task] ?? task }

