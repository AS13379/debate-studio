import { useEffect, useState } from 'react'

import type { ModelProfileDto, ModelRoutingPolicyDto, ModelRoutingTaskDto } from '../../../shared/ipc-contract'

const tasks: Array<[ModelRoutingTaskDto, string, string]> = [
  ['debate_planning', '辩题规划', '创建前生成双方立场与研究方向'],
  ['research', '研究', '资料整理与研究计划'],
  ['search_summary', '搜索摘要', '压缩搜索结果与网页摘要'],
  ['argument_generation', '正式论证', '开篇、自由辩论与总结'],
  ['rebuttal', '反驳', '交叉质询和针对性反驳'],
  ['judge', '裁判', '最终裁决'],
  ['vision_analysis', '图片分析', '仅发送给声明图片能力的模型']
]

export function ModelRoutingPage() {
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [policies, setPolicies] = useState<ModelRoutingPolicyDto[]>([])
  const [message, setMessage] = useState<string>()
  const load = async () => {
    const [profileResult, policyResult] = await Promise.all([window.debateStudio.listModelProfiles(), window.debateStudio.listModelRoutingPolicies()])
    if (profileResult.ok) setProfiles(profileResult.value)
    if (policyResult.ok) setPolicies(policyResult.value)
  }
  useEffect(() => { void load() }, [])
  const save = async (task: ModelRoutingTaskDto, modelProfileId: string) => {
    const result = await window.debateStudio.saveModelRoutingPolicy({ task, modelProfileId })
    setMessage(result.ok ? '模型策略已保存。' : result.error.descriptionZh)
    await load()
  }
  const createDefaults = async () => { await window.debateStudio.createDefaultModelRouting(); await load(); setMessage('已按能力生成缺失的默认策略。') }
  return <section className="page-stack"><header className="page-header"><div><p className="eyebrow">本地任务调度</p><h1>模型策略</h1><p className="page-description">角色决定立场，策略决定任务使用哪个模型；未配置的任务继续使用角色原模型。</p></div><button className="button secondary" onClick={() => void createDefaults()}>生成缺失默认策略</button></header>
    {message && <div className="notice">{message}</div>}
    <div className="panel routing-table"><div className="routing-row routing-head"><b>任务</b><b>当前模型</b><b>状态</b></div>{tasks.map(([task, label, description]) => {
      const policy = policies.find((item) => item.task === task)
      return <div className="routing-row" key={task}><div><strong>{label}</strong><span>{description}</span></div><select value={policy?.modelProfileId ?? ''} onChange={(event) => void save(task, event.target.value)}><option value="">使用角色模型</option>{profiles.filter((profile) => task !== 'vision_analysis' || profile.capabilities.imageInput).map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.modelId}</option>)}</select><span className={`status-pill ${policy?.ready ? 'status-completed' : ''}`}>{policy ? policy.ready ? '可用' : policy.issueZh : '回退'}</span></div>
    })}</div>
  </section>
}
