import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type {
  DebateDetailDto,
  ModelCapabilitiesDto,
  ModelProfileDto,
  ProviderConnectionDto,
  ProtocolTypeDto
} from '../../../shared/ipc-contract'

const defaultCapabilities: ModelCapabilitiesDto = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: false,
  webSearch: false,
  structuredOutput: false
}

export interface NewDebatePageProps {
  onBack(): void
  onCreated(debate: DebateDetailDto): void
}

export function NewDebatePage({ onBack, onCreated }: NewDebatePageProps) {
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([])
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showModelForm, setShowModelForm] = useState(false)

  const refreshConfiguration = async (): Promise<void> => {
    const [connectionResult, profileResult] = await Promise.all([
      window.debateStudio.listProviderConnections(),
      window.debateStudio.listModelProfiles()
    ])
    if (connectionResult.ok) setConnections(connectionResult.value)
    else setError(connectionResult.error.descriptionZh)
    if (profileResult.ok) setProfiles(profileResult.value)
    else setError(profileResult.error.descriptionZh)
  }

  useEffect(() => { void refreshConfiguration() }, [])

  const submitDebate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError(undefined)
    const created = await window.debateStudio.createDebate({
      topic: String(form.get('topic') ?? ''),
      background: String(form.get('background') ?? ''),
      affirmativePosition: String(form.get('affirmativePosition') ?? ''),
      negativePosition: String(form.get('negativePosition') ?? ''),
      freeDebateRounds: Number(form.get('freeDebateRounds') ?? 1)
    })
    if (!created.ok) {
      setError(created.error.descriptionZh)
      setSaving(false)
      return
    }
    const binding = (name: string, displayName: string) => ({
      modelProfileId: String(form.get(name) ?? ''),
      displayName
    })
    const judgeProfileId = String(form.get('judgeModel') ?? '')
    const bound = await window.debateStudio.saveParticipantBindings({
      sessionId: created.value.sessionId,
      affirmative: binding('affirmativeModel', '正方'),
      negative: binding('negativeModel', '反方'),
      moderator: binding('moderatorModel', '主持人'),
      judge: judgeProfileId ? { modelProfileId: judgeProfileId, displayName: '裁判' } : undefined
    })
    setSaving(false)
    if (!bound.ok) setError(bound.error.descriptionZh)
    else onCreated(bound.value)
  }

  return (
    <section className="page-stack" aria-labelledby="new-debate-title">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">配置</p>
          <h1 id="new-debate-title">新建辩论</h1>
          <p className="page-description">第一版只配置文本模型和基础角色。</p>
        </div>
        <button className="button ghost" onClick={onBack}>返回列表</button>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="configuration-toolbar panel">
        <div><strong>模型配置</strong><span>{connections.length} 个连接 · {profiles.length} 个模型</span></div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => setShowProviderForm((value) => !value)}>新建连接</button>
          <button className="button secondary" disabled={connections.length === 0} onClick={() => setShowModelForm((value) => !value)}>新建模型</button>
        </div>
      </div>

      {showProviderForm && <ProviderForm onSaved={() => { setShowProviderForm(false); void refreshConfiguration() }} />}
      {showModelForm && <ModelForm connections={connections} onSaved={() => { setShowModelForm(false); void refreshConfiguration() }} />}

      <form className="panel form-grid" onSubmit={(event) => void submitDebate(event)}>
        <label className="field span-2">辩题<input name="topic" required placeholder="例如：人工智能是否会提升人类创造力？" /></label>
        <label className="field span-2">背景说明<textarea name="background" rows={3} placeholder="可选：补充讨论范围和背景" /></label>
        <label className="field">正方立场<textarea name="affirmativePosition" required rows={3} /></label>
        <label className="field">反方立场<textarea name="negativePosition" required rows={3} /></label>
        <label className="field">自由辩论轮数<input name="freeDebateRounds" type="number" min="1" max="20" defaultValue="1" required /></label>
        <div />
        <ModelSelect name="affirmativeModel" label="正方模型" profiles={profiles} required />
        <ModelSelect name="negativeModel" label="反方模型" profiles={profiles} required />
        <ModelSelect name="moderatorModel" label="主持人模型" profiles={profiles} required />
        <ModelSelect name="judgeModel" label="裁判模型（可选）" profiles={profiles} />
        {profiles.length === 0 && <div className="notice span-2">请先创建 ProviderConnection 和 ModelProfile，或返回首页创建 Mock 示例。</div>}
        <div className="form-actions span-2">
          <button type="button" className="button ghost" onClick={onBack}>取消</button>
          <button className="button primary" disabled={saving || profiles.length === 0}>{saving ? '正在创建…' : '创建并查看辩论'}</button>
        </div>
      </form>
    </section>
  )
}

function ModelSelect({ name, label, profiles, required = false }: { name: string; label: string; profiles: ModelProfileDto[]; required?: boolean }) {
  return (
    <label className="field">{label}
      <select name={name} required={required} defaultValue="">
        <option value="">{required ? '请选择模型' : '不配置独立裁判'}</option>
        {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.displayName} · {profile.modelId}</option>)}
      </select>
    </label>
  )
}

function ProviderForm({ onSaved }: { onSaved(): void }) {
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const saved = await window.debateStudio.saveProviderConnection({
      providerId: String(form.get('providerId') ?? ''),
      displayName: String(form.get('displayName') ?? ''),
      protocolType: String(form.get('protocolType') ?? 'openai-chat') as ProtocolTypeDto,
      baseUrl: String(form.get('baseUrl') ?? ''),
      enabled: true
    })
    if (!saved.ok) return setError(saved.error.descriptionZh)
    const credential = String(form.get('credential') ?? '')
    if (credential) {
      const credentialSaved = await window.debateStudio.saveCredential({ connectionId: saved.value.id, credential })
      if (!credentialSaved.ok) return setError(credentialSaved.error.descriptionZh)
    }
    onSaved()
  }
  return (
    <form className="panel form-grid inline-editor" onSubmit={(event) => void submit(event)}>
      <h2 className="span-2">新建 ProviderConnection</h2>
      {error && <div className="notice error span-2">{error}</div>}
      <label className="field">Provider ID<input name="providerId" required placeholder="例如 deepseek" /></label>
      <label className="field">显示名称<input name="displayName" required /></label>
      <label className="field">协议<select name="protocolType" defaultValue="openai-chat"><option value="openai-chat">OpenAI Chat 兼容</option><option value="mock">Mock</option></select></label>
      <label className="field">Base URL<input name="baseUrl" type="url" required placeholder="https://api.example.com/v1" /></label>
      <label className="field span-2">API Key（可选，仅写入 Keychain）<input name="credential" type="password" autoComplete="off" /></label>
      <div className="form-actions span-2"><button className="button primary">保存连接</button></div>
    </form>
  )
}

function ModelForm({ connections, onSaved }: { connections: ProviderConnectionDto[]; onSaved(): void }) {
  const [error, setError] = useState<string>()
  const availableConnections = useMemo(() => connections.filter((connection) => connection.enabled), [connections])
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const saved = await window.debateStudio.saveModelProfile({
      connectionId: String(form.get('connectionId') ?? ''),
      modelId: String(form.get('modelId') ?? ''),
      displayName: String(form.get('displayName') ?? ''),
      capabilities: defaultCapabilities,
      contextWindow: optionalNumber(form.get('contextWindow')),
      maxOutputTokens: optionalNumber(form.get('maxOutputTokens'))
    })
    if (!saved.ok) setError(saved.error.descriptionZh)
    else onSaved()
  }
  return (
    <form className="panel form-grid inline-editor" onSubmit={(event) => void submit(event)}>
      <h2 className="span-2">新建 ModelProfile</h2>
      {error && <div className="notice error span-2">{error}</div>}
      <label className="field">平台连接<select name="connectionId" required>{availableConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}</select></label>
      <label className="field">Model ID<input name="modelId" required /></label>
      <label className="field">显示名称<input name="displayName" required /></label>
      <label className="field">上下文长度<input name="contextWindow" type="number" min="1" /></label>
      <label className="field">最大输出 Token<input name="maxOutputTokens" type="number" min="1" /></label>
      <div className="form-actions span-2"><button className="button primary">保存模型</button></div>
    </form>
  )
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const number = Number(value)
  return value && Number.isFinite(number) && number > 0 ? number : undefined
}
