import { useEffect, useMemo, useState } from 'react'

import type { ModelProfileDto, OnboardingProviderRecommendationDto, OnboardingStateDto } from '../../../shared/ipc-contract'

export function OnboardingWizard({ state, onClose, onCreated }: {
  state: OnboardingStateDto
  onClose(): void
  onCreated(debateId: string): void
}) {
  const [step, setStep] = useState(state.currentStep || 1)
  const [selectedProvider, setSelectedProvider] = useState(state.recommendations[0]?.providerId ?? '')
  const selected = useMemo(() => state.recommendations.find((item) => item.providerId === selectedProvider), [state, selectedProvider])
  const [form, setForm] = useState(() => providerForm(selected))
  const [saved, setSaved] = useState<{ connectionId: string; modelProfileId: string }>()
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [advanced, setAdvanced] = useState(false)
  const [defaults, setDefaults] = useState({ affirmative: '', negative: '', moderator: '' })
  const [status, setStatus] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [customModel, setCustomModel] = useState(false)

  useEffect(() => { setForm(providerForm(selected)); setCustomModel(false) }, [selectedProvider])
  useEffect(() => {
    if (step >= 4) void window.debateStudio.listModelProfiles().then((result) => {
      if (!result.ok) return
      setProfiles(result.value)
      const first = saved?.modelProfileId ?? result.value[0]?.id ?? ''
      setDefaults((current) => current.affirmative ? current : { affirmative: first, negative: first, moderator: first })
    })
  }, [step, saved])

  const saveProvider = async (): Promise<void> => {
    if (!selected) return
    setBusy(true); setStatus(undefined)
    const result = await window.debateStudio.saveOnboardingProvider({
      providerId: selected.providerId,
      displayName: selected.displayName,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      modelDisplayName: form.modelId,
      apiKey: form.apiKey,
      contextWindow: selected.recommendedContextWindow,
      maxOutputTokens: selected.recommendedMaxOutputTokens,
      capabilities: selected.capabilities
    })
    setBusy(false)
    if (!result.ok) return setStatus(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setForm((current) => ({ ...current, apiKey: '' }))
    setSaved(result.value); setStatus('模型连接与凭据已安全保存，正在自动测试…'); setStep(3)
    await test(result.value)
  }

  const test = async (target = saved): Promise<void> => {
    if (!target) return
    setBusy(true); setStatus('正在发送最小连接测试…')
    const result = await window.debateStudio.testOnboardingConnection({
      connectionId: target.connectionId,
      modelProfileId: target.modelProfileId
    })
    setBusy(false)
    if (!result.ok) return setStatus(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setStatus(`连接正常，延迟 ${result.value.latencyMs} ms。`); setStep(4)
  }

  const saveDefaults = async (): Promise<void> => {
    const value = advanced ? defaults : { affirmative: defaults.affirmative, negative: defaults.affirmative, moderator: defaults.affirmative }
    const result = await window.debateStudio.saveOnboardingDefaults(value)
    if (!result.ok) return setStatus(`${result.error.titleZh}：${result.error.descriptionZh}`)
    setStatus('默认角色与模型策略已生成。'); setStep(5)
  }

  const createDemo = async (): Promise<void> => {
    setBusy(true)
    const result = await window.debateStudio.createOnboardingDemo()
    setBusy(false)
    if (!result.ok) return setStatus(`${result.error.titleZh}：${result.error.descriptionZh}`)
    onCreated(result.value.debateId)
  }

  const skip = async (): Promise<void> => {
    await window.debateStudio.skipOnboarding()
    onClose()
  }

  return <div className="modal-backdrop onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <section className="onboarding-wizard">
      <header><div><p className="eyebrow">首次使用 · {step}/5</p><h1 id="onboarding-title">{stepTitle(step)}</h1></div><button className="button ghost" onClick={() => void skip()}>跳过引导</button></header>
      <div className="onboarding-progress" aria-label={`引导进度 ${step}/5`}>{[1, 2, 3, 4, 5].map((item) => <span key={item} className={item <= step ? 'active' : ''} />)}</div>
      {step === 1 && <div className="onboarding-copy"><div className="onboarding-symbol">辩</div><h2>本地 AI 辩论工作台</h2><p>辩论、研究、证据和日志都保存在这台 Mac。API Key 由你提供，并通过系统加密存储；项目没有账号系统，也不会云同步。</p><button className="button primary" onClick={() => setStep(2)}>开始配置</button></div>}
      {step === 2 && <div className="onboarding-form">
        <label className="field">模型服务<select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>{state.recommendations.map((item) => <option key={item.providerId} value={item.providerId}>{item.displayName}</option>)}</select></label>
        <div className="onboarding-recommendation"><b>推荐：{selected?.recommendedModelId}</b><span>{selected?.recommendedContextWindow.toLocaleString()} 上下文 · {selected?.recommendedMaxOutputTokens} 最大输出</span><small>{selected?.costNoticeZh}</small></div>
        {selected && <div className="provider-official-links">
          <button type="button" className="button ghost official-link" onClick={() => void window.debateStudio.openExternalUrl({ url: selected.platformUrl })}>打开服务商平台</button>
          <button type="button" className="button ghost official-link" onClick={() => void window.debateStudio.openExternalUrl({ url: selected.documentationUrl })}>接入文档</button>
          <button type="button" className="button ghost official-link" onClick={() => void window.debateStudio.openExternalUrl({ url: selected.pricingUrl })}>官方定价</button>
        </div>}
        <label className="field">Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
        <label className="field">模型<select value={customModel ? '__custom__' : form.modelId} onChange={(event) => {
          if (event.target.value === '__custom__') { setCustomModel(true); setForm({ ...form, modelId: '' }) }
          else { setCustomModel(false); setForm({ ...form, modelId: event.target.value }) }
        }}>
          {selected?.modelOptions.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.id}</option>)}
          <option value="__custom__">自定义 Model ID…</option>
        </select></label>
        {customModel && <label className="field">自定义 Model ID<input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /></label>}
        <label className="field">API Key<input type="password" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="只发送到主进程并保存到系统加密存储" /></label>
        <button className="button primary" disabled={busy || !form.apiKey || !form.modelId || !form.baseUrl} onClick={() => void saveProvider()}>{busy ? '正在保存…' : '安全保存并继续'}</button>
      </div>}
      {step === 3 && <div className="onboarding-copy"><div className="onboarding-symbol">连</div><h2>{busy ? '正在自动测试连接' : '连接测试没有通过'}</h2><p>{busy ? '正在发送一个最小模型请求。API Key 已离开输入框，只在主进程安全存储和请求 Header 中使用。' : '检查下方中文错误后可以直接重试，不需要返回寻找测试按钮。'}</p>{busy && <div className="operation-progress onboarding-auto-test"><span style={{ width: '68%' }} /></div>}{!busy && <button className="button primary" disabled={!saved} onClick={() => void test()}>重新测试</button>}</div>}
      {step === 4 && <div className="onboarding-form"><label className="checkbox-field"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />高级模式：三个角色使用不同模型</label>
        <ModelSelect label="正方" value={defaults.affirmative} profiles={profiles} onChange={(affirmative) => setDefaults({ ...defaults, affirmative, ...(!advanced ? { negative: affirmative, moderator: affirmative } : {}) })} />
        {advanced && <><ModelSelect label="反方" value={defaults.negative} profiles={profiles} onChange={(negative) => setDefaults({ ...defaults, negative })} /><ModelSelect label="主持人" value={defaults.moderator} profiles={profiles} onChange={(moderator) => setDefaults({ ...defaults, moderator })} /></>}
        <p className="muted">普通用户只需一个模型；系统同时生成研究、论证、反驳和裁判的默认路由策略。</p><button className="button primary" disabled={!defaults.affirmative || (advanced && (!defaults.negative || !defaults.moderator))} onClick={() => void saveDefaults()}>生成默认配置</button>
      </div>}
      {step === 5 && <div className="onboarding-copy"><div className="onboarding-symbol">✓</div><h2>工作台已经准备好</h2><p>你可以创建一个完全离线的 Mock 示例，先熟悉辩论流程；真实模型配置会保留。</p><div className="compact-actions"><button className="button primary" disabled={busy} onClick={() => void createDemo()}>创建示例辩论</button><button className="button secondary" onClick={() => void skip()}>稍后再创建</button></div></div>}
      {status && <div className={`notice ${status.includes('正常') || status.includes('已') ? 'success' : ''}`} role="status">{status}</div>}
    </section>
  </div>
}

function ModelSelect({ label, value, profiles, onChange }: { label: string; value: string; profiles: ModelProfileDto[]; onChange(value: string): void }) {
  return <label className="field">{label}模型<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.modelId}</option>)}</select></label>
}

function providerForm(selected?: OnboardingProviderRecommendationDto) {
  return { baseUrl: selected?.defaultBaseUrl ?? '', modelId: selected?.recommendedModelId ?? '', apiKey: '' }
}

function stepTitle(step: number): string {
  return ['欢迎', '添加模型服务', '测试连接', '创建默认配置', '第一次 Demo'][step - 1] ?? '首次使用'
}
