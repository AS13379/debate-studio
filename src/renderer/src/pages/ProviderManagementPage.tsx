import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type {
  ConnectionTestDto,
  ModelCapabilitiesDto,
  ModelProfileDto,
  ProviderConnectionDto,
  ProviderPresetDto,
  ProtocolTypeDto,
  SearchProviderConnectionDto
} from '../../../shared/ipc-contract'

const DEFAULT_CAPABILITIES: ModelCapabilitiesDto = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: false,
  toolCalling: false,
  webSearch: false,
  structuredOutput: false
}

interface ConnectionDraft {
  id?: string
  presetId: string
  providerId: string
  displayName: string
  protocolType: ProtocolTypeDto
  baseUrl: string
  enabled: boolean
}

const EMPTY_CONNECTION: ConnectionDraft = {
  presetId: '',
  providerId: '',
  displayName: '',
  protocolType: 'openai-chat',
  baseUrl: '',
  enabled: true
}

export function ProviderManagementPage() {
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([])
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [presets, setPresets] = useState<ProviderPresetDto[]>([])
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>()
  const [editingModel, setEditingModel] = useState<ModelProfileDto | null>()
  const [tests, setTests] = useState<Record<string, ConnectionTestDto>>({})
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [developmentConnectionId, setDevelopmentConnectionId] = useState('')
  const [developmentProfileId, setDevelopmentProfileId] = useState('')
  const [developmentResult, setDevelopmentResult] = useState<ConnectionTestDto>()

  const refresh = async (): Promise<void> => {
    setLoading(true)
    const [connectionsResult, profilesResult, presetsResult] = await Promise.all([
      window.debateStudio.listProviderConnections(),
      window.debateStudio.listModelProfiles(),
      window.debateStudio.listProviderPresets()
    ])
    if (!connectionsResult.ok) setError(connectionsResult.error.descriptionZh)
    else setConnections(connectionsResult.value)
    if (!profilesResult.ok) setError(profilesResult.error.descriptionZh)
    else setProfiles(profilesResult.value)
    if (!presetsResult.ok) setError(presetsResult.error.descriptionZh)
    else setPresets(presetsResult.value)
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  const editConnection = (connection: ProviderConnectionDto): void => {
    setConnectionDraft({
      id: connection.id,
      presetId: presets.find((preset) => preset.providerId === connection.providerId)?.providerId ?? '',
      providerId: connection.providerId,
      displayName: connection.displayName,
      protocolType: connection.protocolType,
      baseUrl: connection.baseUrl,
      enabled: connection.enabled
    })
  }

  const testConnection = async (connection: ProviderConnectionDto): Promise<void> => {
    setError(undefined)
    const profile = profiles.find((candidate) => candidate.connectionId === connection.id)
    const result = await window.debateStudio.testConnection({
      connectionId: connection.id,
      modelProfileId: profile?.id
    })
    if (!result.ok) setError(result.error.descriptionZh)
    else setTests((current) => ({ ...current, [connection.id]: result.value }))
  }

  const deleteConnection = async (connection: ProviderConnectionDto, deleteCredential: boolean): Promise<void> => {
    const message = deleteCredential
      ? `确认删除“${connection.displayName}”以及对应的系统加密凭据？`
      : `确认仅删除“${connection.displayName}”的本地连接配置？系统加密凭据会保留。`
    if (!window.confirm(message)) return
    const result = await window.debateStudio.deleteProviderConnection({ id: connection.id, deleteCredential })
    if (!result.ok) setError(result.error.descriptionZh)
    else await refresh()
  }

  const deleteProfile = async (profile: ModelProfileDto): Promise<void> => {
    if (!window.confirm(`确认删除 ModelProfile“${profile.displayName}”？`)) return
    const result = await window.debateStudio.deleteModelProfile({ id: profile.id })
    if (!result.ok) setError(result.error.descriptionZh)
    else await refresh()
  }

  const copyProfile = async (profile: ModelProfileDto): Promise<void> => {
    const result = await window.debateStudio.copyModelProfile({ id: profile.id })
    if (!result.ok) setError(result.error.descriptionZh)
    else await refresh()
  }

  const runDevelopmentTest = async (): Promise<void> => {
    if (!developmentConnectionId) return
    setDevelopmentResult(undefined)
    const result = await window.debateStudio.testConnection({
      connectionId: developmentConnectionId,
      modelProfileId: developmentProfileId || undefined
    })
    if (!result.ok) setError(result.error.descriptionZh)
    else setDevelopmentResult(result.value)
  }

  const developmentProfiles = useMemo(
    () => profiles.filter((profile) => profile.connectionId === developmentConnectionId),
    [profiles, developmentConnectionId]
  )

  return (
    <section className="page-stack provider-page" aria-labelledby="providers-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">本地配置</p>
          <h1 id="providers-title">模型与平台</h1>
          <p className="page-description">连接配置保存在 SQLite；API Key 只保存到系统加密存储。</p>
        </div>
        <button className="button primary" onClick={() => setConnectionDraft({ ...EMPTY_CONNECTION })}>新建连接</button>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {loading && <div className="panel muted">正在读取本地模型配置…</div>}
      {connectionDraft && (
        <ConnectionEditor
          draft={connectionDraft}
          presets={presets}
          onChange={setConnectionDraft}
          onCancel={() => setConnectionDraft(undefined)}
          onSaved={async () => { setConnectionDraft(undefined); await refresh() }}
          onError={setError}
        />
      )}

      {!loading && connections.length === 0 && (
        <div className="empty-state compact">
          <h2>尚未配置真实模型平台</h2>
          <p>选择官方预设，保存 API Key，再手动创建 ModelProfile。</p>
          <button className="button primary" onClick={() => setConnectionDraft({ ...EMPTY_CONNECTION })}>新建第一个连接</button>
        </div>
      )}

      <div className="connection-list">
        {connections.map((connection) => {
          const connectionProfiles = profiles.filter((profile) => profile.connectionId === connection.id)
          return (
            <article className="panel connection-card" key={connection.id}>
              <header>
                <div>
                  <div className="connection-title">
                    <h2>{connection.displayName}</h2>
                    <span className={`status-pill ${connection.enabled ? 'status-completed' : 'status-stopped'}`}>
                      {connection.enabled ? '已启用' : '已禁用'}
                    </span>
                    {connection.protocolType !== 'mock' && (
                      <span className={`credential-badge ${connection.credentialConfigured ? 'configured' : ''}`}>
                        {connection.credentialConfigured ? '已保存凭据' : '未配置凭据'}
                      </span>
                    )}
                  </div>
                  <p>{connection.providerId} · {connection.protocolType}</p>
                  <code>{connection.baseUrl}</code>
                </div>
                <div className="header-actions">
                  <button className="button secondary" onClick={() => editConnection(connection)}>编辑连接</button>
                  <button
                    className="button secondary"
                    disabled={connection.protocolType !== 'openai-chat'}
                    title={connection.protocolType !== 'openai-chat' ? 'Mock 连接无需真实网络测试' : undefined}
                    onClick={() => void testConnection(connection)}
                  >测试连接</button>
                </div>
              </header>

              {connection.protocolType !== 'mock' && (
                <CredentialEditor connection={connection} onChanged={refresh} onError={setError} />
              )}
              {tests[connection.id] && <ConnectionTestStatus result={tests[connection.id]} />}

              <div className="model-section">
                <div className="section-heading">
                  <div><strong>ModelProfile</strong><span>{connectionProfiles.length} 个手动模型</span></div>
                  <button className="button secondary" onClick={() => setEditingModel(emptyProfile(connection.id))}>新建模型</button>
                </div>
                {connectionProfiles.length === 0 && <p className="muted">尚未填写 Model ID。</p>}
                <div className="model-grid">
                  {connectionProfiles.map((profile) => (
                    <div className="model-card" key={profile.id}>
                      <div><strong>{profile.displayName}</strong><span>{profile.alias || '无本地别名'}</span></div>
                      <code>{profile.modelId}</code>
                      <p>{profile.contextWindow ? `${profile.contextWindow.toLocaleString()} context` : '上下文未知'} · {profile.maxOutputTokens ? `${profile.maxOutputTokens.toLocaleString()} max output` : '输出上限未知'}</p>
                      <div className="compact-actions">
                        <button className="button ghost" onClick={() => setEditingModel(profile)}>编辑</button>
                        <button className="button ghost" onClick={() => void copyProfile(profile)}>复制</button>
                        <button className="button ghost danger-text" onClick={() => void deleteProfile(profile)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="danger-zone">
                <button className="button ghost danger-text" onClick={() => void deleteConnection(connection, false)}>仅删除连接配置</button>
                <button className="button danger" onClick={() => void deleteConnection(connection, true)}>删除连接和系统加密凭据</button>
              </div>
            </article>
          )
        })}
      </div>

      {editingModel !== undefined && (
        <ModelProfileEditor
          key={editingModel?.id ?? 'new-model'}
          profile={editingModel ?? emptyProfile(connections[0]?.id ?? '')}
          connections={connections}
          onCancel={() => setEditingModel(undefined)}
          onSaved={async () => { setEditingModel(undefined); await refresh() }}
          onError={setError}
        />
      )}

      <SearchProviderSection onError={setError} />

      {import.meta.env.DEV && (
        <section className="panel development-test">
          <div>
            <p className="eyebrow">仅开发环境</p>
            <h2>真实连接测试</h2>
            <p>只有点击按钮后才会发送最小请求；自动测试不会进入这里。</p>
          </div>
          <div className="form-grid">
            <label className="field">ProviderConnection
              <select value={developmentConnectionId} onChange={(event) => { setDevelopmentConnectionId(event.target.value); setDevelopmentProfileId('') }}>
                <option value="">请选择连接</option>
                {connections.filter((connection) => connection.protocolType === 'openai-chat').map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.displayName}</option>
                ))}
              </select>
            </label>
            <label className="field">可选 ModelProfile
              <select value={developmentProfileId} onChange={(event) => setDevelopmentProfileId(event.target.value)}>
                <option value="">仅验证连接</option>
                {developmentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.modelId}</option>)}
              </select>
            </label>
          </div>
          <button className="button primary" disabled={!developmentConnectionId} onClick={() => void runDevelopmentTest()}>发送最小测试请求</button>
          {developmentResult && <ConnectionTestStatus result={developmentResult} />}
        </section>
      )}
    </section>
  )
}

function ConnectionEditor({
  draft,
  presets,
  onChange,
  onCancel,
  onSaved,
  onError
}: {
  draft: ConnectionDraft
  presets: ProviderPresetDto[]
  onChange(draft: ConnectionDraft): void
  onCancel(): void
  onSaved(): Promise<void>
  onError(message: string): void
}) {
  const [credential, setCredential] = useState('')
  const [saving, setSaving] = useState(false)
  const applyPreset = (providerId: string): void => {
    const preset = presets.find((candidate) => candidate.providerId === providerId)
    if (!preset) return onChange({ ...draft, presetId: '' })
    onChange({
      ...draft,
      presetId: preset.providerId,
      providerId: preset.providerId,
      displayName: preset.displayName,
      protocolType: preset.supportedProtocols.includes('openai-chat') ? 'openai-chat' : preset.supportedProtocols[0],
      baseUrl: preset.defaultBaseUrl
    })
  }
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    const saved = await window.debateStudio.saveProviderConnection({
      id: draft.id,
      providerId: draft.providerId,
      displayName: draft.displayName,
      protocolType: draft.protocolType,
      baseUrl: draft.baseUrl,
      enabled: draft.enabled
    })
    if (!saved.ok) {
      setSaving(false)
      return onError(saved.error.descriptionZh)
    }
    if (credential) {
      const keySaved = await window.debateStudio.saveCredential({ connectionId: saved.value.id, credential })
      if (!keySaved.ok) {
        setSaving(false)
        return onError(keySaved.error.descriptionZh)
      }
    }
    setCredential('')
    setSaving(false)
    await onSaved()
  }
  return (
    <form className="panel form-grid connection-editor" onSubmit={(event) => void submit(event)}>
      <div className="span-2 section-heading"><div><strong>{draft.id ? '编辑 ProviderConnection' : '新建 ProviderConnection'}</strong><span>API Key 不会写入 SQLite</span></div></div>
      <label className="field span-2">官方预设
        <select value={draft.presetId} onChange={(event) => applyPreset(event.target.value)}>
          <option value="">自定义 OpenAI Compatible</option>
          {presets.map((preset) => <option key={preset.providerId} value={preset.providerId}>{preset.displayName}</option>)}
        </select>
      </label>
      <label className="field">Provider ID<input required value={draft.providerId} onChange={(event) => onChange({ ...draft, providerId: event.target.value })} /></label>
      <label className="field">显示名称<input required value={draft.displayName} onChange={(event) => onChange({ ...draft, displayName: event.target.value })} /></label>
      <label className="field">协议
        <select value={draft.protocolType} onChange={(event) => onChange({ ...draft, protocolType: event.target.value as ProtocolTypeDto })}>
          <option value="openai-chat">OpenAI Chat Completions</option>
          {draft.protocolType === 'mock' && <option value="mock">Mock</option>}
        </select>
      </label>
      <label className="field checkbox-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />启用连接</label>
      <label className="field span-2">Base URL<input type="url" required value={draft.baseUrl} onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })} /></label>
      <label className="field span-2">API Key（可选，保存或替换到系统加密存储）<input type="password" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} /></label>
      <div className="form-actions span-2"><button type="button" className="button ghost" onClick={onCancel}>取消</button><button className="button primary" disabled={saving}>{saving ? '正在保存…' : '保存连接'}</button></div>
    </form>
  )
}

function CredentialEditor({ connection, onChanged, onError }: { connection: ProviderConnectionDto; onChanged(): Promise<void>; onError(message: string): void }) {
  const [credential, setCredential] = useState('')
  const save = async (): Promise<void> => {
    const result = await window.debateStudio.saveCredential({ connectionId: connection.id, credential })
    setCredential('')
    if (!result.ok) onError(result.error.descriptionZh)
    else await onChanged()
  }
  const remove = async (): Promise<void> => {
    const result = await window.debateStudio.deleteCredential({ connectionId: connection.id })
    if (!result.ok) onError(result.error.descriptionZh)
    else await onChanged()
  }
  return (
    <div className="credential-editor">
      <label className="field">{connection.credentialConfigured ? '替换 API Key' : '保存 API Key'}<input type="password" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} /></label>
      <button className="button secondary" disabled={!credential} onClick={() => void save()}>{connection.credentialConfigured ? '替换凭据' : '保存到系统加密存储'}</button>
      {connection.credentialConfigured && <button className="button ghost danger-text" onClick={() => void remove()}>删除凭据</button>}
    </div>
  )
}

function ModelProfileEditor({ profile, connections, onCancel, onSaved, onError }: { profile: ModelProfileDto; connections: ProviderConnectionDto[]; onCancel(): void; onSaved(): Promise<void>; onError(message: string): void }) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    const saved = await window.debateStudio.saveModelProfile({
      id: profile.id || undefined,
      connectionId: String(form.get('connectionId') ?? ''),
      modelId: String(form.get('modelId') ?? ''),
      displayName: String(form.get('displayName') ?? ''),
      alias: String(form.get('alias') ?? '') || undefined,
      capabilities: {
        ...profile.capabilities,
        textInput: form.get('textInput') === 'on',
        imageInput: form.get('imageInput') === 'on',
        streaming: form.get('streaming') === 'on',
        toolCalling: form.get('toolCalling') === 'on',
        structuredOutput: form.get('structuredOutput') === 'on'
      },
      contextWindow: optionalNumber(form.get('contextWindow')),
      maxOutputTokens: optionalNumber(form.get('maxOutputTokens'))
    })
    setSaving(false)
    if (!saved.ok) onError(saved.error.descriptionZh)
    else await onSaved()
  }
  return (
    <form className="panel form-grid model-editor" onSubmit={(event) => void submit(event)}>
      <div className="span-2 section-heading"><div><strong>{profile.id ? '编辑 ModelProfile' : '新建 ModelProfile'}</strong><span>Model ID 继续由用户手动填写</span></div></div>
      <label className="field">平台连接<select name="connectionId" defaultValue={profile.connectionId} required>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName}</option>)}</select></label>
      <label className="field">Model ID<input name="modelId" required defaultValue={profile.modelId} /></label>
      <label className="field">显示名称<input name="displayName" required defaultValue={profile.displayName} /></label>
      <label className="field">本地别名<input name="alias" defaultValue={profile.alias} /></label>
      <label className="field">上下文长度<input name="contextWindow" type="number" min="1" defaultValue={profile.contextWindow} /></label>
      <label className="field">最大输出 Token<input name="maxOutputTokens" type="number" min="1" defaultValue={profile.maxOutputTokens} /></label>
      <div className="capability-checks span-2">
        <label><input name="textInput" type="checkbox" defaultChecked={profile.capabilities.textInput} />文本能力</label>
        <label><input name="imageInput" type="checkbox" defaultChecked={profile.capabilities.imageInput} />图片能力</label>
        <label><input name="streaming" type="checkbox" defaultChecked={profile.capabilities.streaming} />流式输出能力</label>
        <label><input name="toolCalling" type="checkbox" defaultChecked={profile.capabilities.toolCalling} />原生工具调用</label>
        <label><input name="structuredOutput" type="checkbox" defaultChecked={profile.capabilities.structuredOutput} />结构化输出</label>
      </div>
      <div className="form-actions span-2"><button type="button" className="button ghost" onClick={onCancel}>取消</button><button className="button primary" disabled={saving}>{saving ? '正在保存…' : '保存模型'}</button></div>
    </form>
  )
}

function SearchProviderSection({ onError }: { onError(message: string): void }) {
  const [connections, setConnections] = useState<SearchProviderConnectionDto[]>([])
  const [draft, setDraft] = useState<{ id?: string; displayName: string; baseUrl: string; enabled: boolean; isDefault: boolean }>({ displayName: 'Tavily', baseUrl: 'https://api.tavily.com', enabled: true, isDefault: true })
  const [showEditor, setShowEditor] = useState(false)
  const [credential, setCredential] = useState<Record<string, string>>({})
  const [testMessage, setTestMessage] = useState<Record<string, string>>({})
  const reload = async (): Promise<void> => {
    const result = await window.debateStudio.listSearchProviderConnections()
    if (result.ok) setConnections(result.value)
    else onError(result.error.descriptionZh)
  }
  useEffect(() => { void reload() }, [])

  const saveConnection = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const result = await window.debateStudio.saveSearchProviderConnection(draft)
    if (!result.ok) onError(result.error.descriptionZh)
    else { setShowEditor(false); setDraft({ displayName: 'Tavily', baseUrl: 'https://api.tavily.com', enabled: true, isDefault: connections.length === 0 }); await reload() }
  }
  const saveKey = async (connectionId: string): Promise<void> => {
    const result = await window.debateStudio.saveSearchCredential({ connectionId, credential: credential[connectionId] ?? '' })
    setCredential((current) => ({ ...current, [connectionId]: '' }))
    if (!result.ok) onError(result.error.descriptionZh)
    else await reload()
  }
  const test = async (connectionId: string): Promise<void> => {
    const result = await window.debateStudio.testSearchConnection({ connectionId })
    if (!result.ok) onError(result.error.descriptionZh)
    else setTestMessage((current) => ({
      ...current,
      [connectionId]: `${result.value.titleZh}（${Math.round(result.value.latencyMs)} ms）：${result.value.descriptionZh}`
    }))
  }
  const remove = async (connection: SearchProviderConnectionDto): Promise<void> => {
    if (!window.confirm(`确认删除搜索连接“${connection.displayName}”？如需删除凭据，请先点击“删除 API Key”。`)) return
    const result = await window.debateStudio.deleteSearchProviderConnection({ id: connection.id })
    if (!result.ok) onError(result.error.descriptionZh)
    else await reload()
  }

  return <section className="panel search-provider-section">
    <div className="section-heading"><div><strong>搜索服务</strong><span>Tavily 作为首个真实 SearchTool；API Key 只保存到系统加密存储</span></div><button className="button secondary" onClick={() => { setDraft({ displayName: 'Tavily', baseUrl: 'https://api.tavily.com', enabled: true, isDefault: connections.length === 0 }); setShowEditor(true) }}>新建搜索连接</button></div>
    {connections.map((connection) => <article className="search-connection-row" key={connection.id}>
      <div><strong>{connection.displayName}</strong><span>{connection.enabled ? '已启用' : '已禁用'} · {connection.isDefault ? '默认搜索工具' : '非默认'} · {connection.credentialConfigured ? '已配置凭据' : '未配置凭据'}</span><code>{connection.baseUrl}</code></div>
      <div className="credential-editor">
        <label className="field">保存或替换 API Key<input type="password" autoComplete="off" value={credential[connection.id] ?? ''} onChange={(event) => setCredential((current) => ({ ...current, [connection.id]: event.target.value }))} /></label>
        <button className="button secondary" disabled={!credential[connection.id]} onClick={() => void saveKey(connection.id)}>保存凭据</button>
        <button className="button secondary" disabled={!connection.credentialConfigured} onClick={() => void test(connection.id)}>测试搜索</button>
        <button className="button ghost" onClick={() => { setDraft({ id: connection.id, displayName: connection.displayName, baseUrl: connection.baseUrl, enabled: connection.enabled, isDefault: connection.isDefault }); setShowEditor(true) }}>编辑</button>
        {!connection.isDefault && <button className="button ghost" onClick={() => void window.debateStudio.saveSearchProviderConnection({ id: connection.id, displayName: connection.displayName, baseUrl: connection.baseUrl, enabled: connection.enabled, isDefault: true }).then(reload)}>设为默认</button>}
        {connection.credentialConfigured && <button className="button ghost danger-text" onClick={() => void window.debateStudio.deleteSearchCredential({ connectionId: connection.id }).then(reload)}>删除 API Key</button>}
        <button className="button ghost danger-text" onClick={() => void remove(connection)}>删除连接</button>
      </div>
      {testMessage[connection.id] && <p className="notice">{testMessage[connection.id]}</p>}
    </article>)}
    {(connections.length === 0 || showEditor) && <form className="form-grid" onSubmit={(event) => void saveConnection(event)}>
      <label className="field">显示名称<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
      <label className="field">Base URL<input type="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
      <label className="field checkbox-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用连接</label>
      <label className="field checkbox-field"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />设为默认搜索工具</label>
      <div className="form-actions span-2">{showEditor && <button type="button" className="button ghost" onClick={() => setShowEditor(false)}>取消</button>}<button className="button primary">{draft.id ? '保存搜索连接' : '创建 Tavily 搜索连接'}</button></div>
    </form>}
  </section>
}

export function ConnectionTestStatus({ result }: { result: ConnectionTestDto }) {
  if (result.success) {
    return <div className="connection-test success"><strong>凭据测试成功</strong><span>{Math.round(result.latencyMs)} ms · HTTP {result.providerStatus ?? '未知'}</span><p>{result.responsePreview ?? '服务商已返回有效响应。'}</p></div>
  }
  const failure = result.error
  if (!failure) return <div className="connection-test failure">凭据测试失败</div>
  return (
    <div className="connection-test failure" role="alert">
      <div><strong>凭据测试失败：{failure.titleZh}</strong><span>{failure.retryable ? '可重试' : '需修正配置'}</span></div>
      <p>{failure.descriptionZh}</p>
      <p><strong>建议：</strong>{failure.suggestedActionZh}</p>
      <details><summary>技术详情</summary><pre>{failure.technicalDetails}</pre></details>
    </div>
  )
}

function emptyProfile(connectionId: string): ModelProfileDto {
  return {
    id: '',
    connectionId,
    modelId: '',
    displayName: '',
    capabilities: { ...DEFAULT_CAPABILITIES },
    createdAt: '',
    updatedAt: ''
  }
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const number = Number(value)
  return value && Number.isFinite(number) && number > 0 ? number : undefined
}
