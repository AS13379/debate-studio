import { useEffect, useState, type FormEvent } from 'react'

import type {
  DebateDetailDto,
  ModelProfileDto,
  ProviderConnectionDto
} from '../../../shared/ipc-contract'

export interface NewDebatePageProps {
  onBack(): void
  onCreated(debate: DebateDetailDto): void
  onOpenModels(): void
}

interface RoleModels {
  affirmative: string
  negative: string
  moderator: string
  judge: string
}

const EMPTY_ROLE_MODELS: RoleModels = { affirmative: '', negative: '', moderator: '', judge: '' }

export function NewDebatePage({ onBack, onCreated, onOpenModels }: NewDebatePageProps) {
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([])
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [roleModels, setRoleModels] = useState<RoleModels>(EMPTY_ROLE_MODELS)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

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
    const bound = await window.debateStudio.saveParticipantBindings({
      sessionId: created.value.sessionId,
      affirmative: { modelProfileId: roleModels.affirmative, displayName: '正方' },
      negative: { modelProfileId: roleModels.negative, displayName: '反方' },
      moderator: { modelProfileId: roleModels.moderator, displayName: '主持人' },
      judge: roleModels.judge ? { modelProfileId: roleModels.judge, displayName: '裁判' } : undefined
    })
    setSaving(false)
    if (!bound.ok) setError(bound.error.descriptionZh)
    else onCreated(bound.value)
  }

  const useAffirmativeForCoreRoles = (): void => {
    if (!roleModels.affirmative) return
    setRoleModels((current) => ({
      ...current,
      negative: current.affirmative,
      moderator: current.affirmative
    }))
  }

  const profileLabel = (profile: ModelProfileDto): string => {
    const connection = connections.find((candidate) => candidate.id === profile.connectionId)
    return `${profile.displayName} · ${profile.modelId}${connection ? ` · ${connection.displayName}` : ''}`
  }

  return (
    <section className="page-stack" aria-labelledby="new-debate-title">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">配置</p>
          <h1 id="new-debate-title">新建辩论</h1>
          <p className="page-description">选择已保存的 Mock 或 OpenAI Compatible ModelProfile。</p>
        </div>
        <button className="button ghost" onClick={onBack}>返回列表</button>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="configuration-toolbar panel">
        <div><strong>模型配置</strong><span>{connections.length} 个连接 · {profiles.length} 个模型</span></div>
        <button className="button secondary" onClick={onOpenModels}>打开模型与平台</button>
      </div>

      <form className="panel form-grid" onSubmit={(event) => void submitDebate(event)}>
        <label className="field span-2">辩题<input name="topic" required placeholder="例如：人工智能是否会提升人类创造力？" /></label>
        <label className="field span-2">背景说明<textarea name="background" rows={3} placeholder="可选：补充讨论范围和背景" /></label>
        <label className="field">正方立场<textarea name="affirmativePosition" required rows={3} /></label>
        <label className="field">反方立场<textarea name="negativePosition" required rows={3} /></label>
        <label className="field">自由辩论轮数<input name="freeDebateRounds" type="number" min="1" max="20" defaultValue="1" required /></label>
        <div />
        <ModelSelect
          label="正方模型"
          value={roleModels.affirmative}
          profiles={profiles}
          profileLabel={profileLabel}
          required
          onChange={(value) => setRoleModels((current) => ({ ...current, affirmative: value }))}
        />
        <div className="quick-binding">
          <button type="button" className="button secondary" disabled={!roleModels.affirmative} onClick={useAffirmativeForCoreRoles}>同一模型用于正方、反方和主持人</button>
        </div>
        <ModelSelect
          label="反方模型"
          value={roleModels.negative}
          profiles={profiles}
          profileLabel={profileLabel}
          required
          onChange={(value) => setRoleModels((current) => ({ ...current, negative: value }))}
        />
        <ModelSelect
          label="主持人模型"
          value={roleModels.moderator}
          profiles={profiles}
          profileLabel={profileLabel}
          required
          onChange={(value) => setRoleModels((current) => ({ ...current, moderator: value }))}
        />
        <ModelSelect
          label="裁判模型（可选）"
          value={roleModels.judge}
          profiles={profiles}
          profileLabel={profileLabel}
          onChange={(value) => setRoleModels((current) => ({ ...current, judge: value }))}
        />
        {profiles.length === 0 && (
          <div className="notice span-2">
            尚无 ModelProfile。请先打开“模型与平台”创建连接和模型，或返回首页创建 Mock 示例。
          </div>
        )}
        <div className="notice span-2">
          创建后会在实时辩论页显示 DebateSetupValidator 的错误和警告；存在阻断错误时无法启动。
        </div>
        <div className="form-actions span-2">
          <button type="button" className="button ghost" onClick={onBack}>取消</button>
          <button
            className="button primary"
            disabled={saving || !roleModels.affirmative || !roleModels.negative || !roleModels.moderator}
          >
            {saving ? '正在创建…' : '创建并检查配置'}
          </button>
        </div>
      </form>
    </section>
  )
}

function ModelSelect({
  label,
  value,
  profiles,
  profileLabel,
  required = false,
  onChange
}: {
  label: string
  value: string
  profiles: ModelProfileDto[]
  profileLabel(profile: ModelProfileDto): string
  required?: boolean
  onChange(value: string): void
}) {
  return (
    <label className="field">{label}
      <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">{required ? '请选择模型' : '不配置独立裁判'}</option>
        {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profileLabel(profile)}</option>)}
      </select>
    </label>
  )
}
