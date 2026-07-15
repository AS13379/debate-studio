import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { MockHttpTransport, MockJudgeAdapter } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const applications: DebateDesktopApplication[] = []
const directories: string[] = []
const HIDDEN_REASONING = 'private-chain-of-thought-must-never-be-stored'

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('debate quality v0.2', () => {
  it('automatically saves structured scoring and a public review after a completed Mock debate', async () => {
    const application = createApplication()
    const demo = application.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)

    const completed = await application.run.start(demo.value.sessionId)
    expect(completed).toMatchObject({ ok: true, state: { status: 'completed', currentStage: 'completed' } })

    const snapshot = application.quality.getByDebate(demo.value.id)
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.value.evaluation).toMatchObject({
      debateId: demo.value.id,
      sessionId: demo.value.sessionId,
      evaluatorModelId: 'mock-debate-model',
      promptTemplateId: 'prompt-judge',
      promptVersion: 1,
      evaluation: { winner: 'affirmative' }
    })
    expect(snapshot.value.review).toMatchObject({
      debateId: demo.value.id,
      sessionId: demo.value.sessionId,
      reviewerModelId: 'mock-debate-model',
      promptTemplateId: 'prompt-review',
      promptVersion: 1
    })
    const scores = snapshot.value.evaluation?.evaluation.scores
    expect(Object.keys(scores?.affirmative ?? {})).toHaveLength(6)
    expect(Object.values(scores?.affirmative ?? {}).every((item) => item.score >= 0 && item.score <= 10)).toBe(true)
    expect(snapshot.value.review?.review.summary).toContain('正方')
    expect(JSON.stringify(snapshot.value)).not.toContain(HIDDEN_REASONING)
    expect(JSON.stringify(snapshot.value)).not.toContain('chainOfThought')
  })

  it('records the active prompt version and preserves history when a judge prompt is changed', async () => {
    const application = createApplication()
    const demo = application.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)
    expect((await application.run.start(demo.value.sessionId)).ok).toBe(true)

    const listed = application.promptStudio.listTemplates()
    if (!listed.ok) throw new Error(listed.error.descriptionZh)
    const judge = listed.value.find((item) => item.template.task === 'judge')!
    const created = application.promptStudio.createVersion(
      judge.template.id,
      '优先检查论点、证据、反驳之间的公开对应关系。只给出可公开的简短理由。',
      'v0.2 质量实验'
    )
    expect(created).toMatchObject({ ok: true, value: { template: { activeVersion: 2 } } })

    const regenerated = await application.quality.regenerate(demo.value.id)
    expect(regenerated).toMatchObject({ ok: true, value: { evaluation: { promptVersion: 2 } } })
    const after = application.promptStudio.listTemplates()
    if (!after.ok) throw new Error(after.error.descriptionZh)
    const judgeAfter = after.value.find((item) => item.template.task === 'judge')!
    const reviewAfter = after.value.find((item) => item.template.task === 'review')!
    expect(judgeAfter.versions.map((item) => item.version)).toEqual([2, 1])
    expect(judgeAfter.usage.some((item) => item.version === 2 && item.modelId === 'mock-debate-model')).toBe(true)
    expect(reviewAfter.usage.some((item) => item.modelId === 'mock-debate-model')).toBe(true)
  })

  it('creates versions, rolls back without deleting history, and records model usage', () => {
    const application = createApplication()
    const listed = application.promptStudio.listTemplates()
    if (!listed.ok) throw new Error(listed.error.descriptionZh)
    expect(listed.value.map((item) => item.template.task)).toEqual([
      'argument', 'debate_planning', 'judge', 'rebuttal', 'research', 'review'
    ])
    const rebuttal = listed.value.find((item) => item.template.task === 'rebuttal')!
    const created = application.promptStudio.createVersion(rebuttal.template.id, '聚焦对方最关键的一个前提。', '收紧反驳范围')
    expect(created).toMatchObject({ ok: true, value: { template: { activeVersion: 2 } } })
    application.promptStudio.recordUsage({
      task: 'rebuttal', modelId: 'mock-model',
      sessionId: 'session-1', turnId: 'turn-1'
    })
    const rolledBack = application.promptStudio.rollback(rebuttal.template.id, 1)
    expect(rolledBack).toMatchObject({ ok: true, value: { template: { activeVersion: 1 } } })
    if (!rolledBack.ok) return
    expect(rolledBack.value.versions.map((item) => item.version)).toEqual([2, 1])
    expect(rolledBack.value.usage).toContainEqual(expect.objectContaining({
      task: 'rebuttal', version: 2, modelId: 'mock-model', sessionId: 'session-1', turnId: 'turn-1'
    }))
  })
})

function createApplication(): DebateDesktopApplication {
  const directory = mkdtempSync(join(tmpdir(), 'debate-quality-'))
  directories.push(directory)
  const mockAdapter = new MockJudgeAdapter({
    evaluationResponse: evaluationResponse(),
    reviewResponse: reviewResponse()
  })
  const initialized = initializeDebateDesktopApplication({
    appDataDirectory: directory,
    credentialStore: new MemoryCredentialStore(),
    openAITransport: new MockHttpTransport(),
    mockAdapter
  })
  if (!initialized.ok) throw initialized.error
  applications.push(initialized.value)
  return initialized.value
}

function evaluationResponse(): string {
  const scores = {
    logicalCompleteness: { score: 8.2, reason: '论点、证据与结论之间的关联清楚。' },
    evidenceQuality: { score: 7.6, reason: '公开证据支撑了主要主张。' },
    rebuttalEffectiveness: { score: 8, reason: '回应了对方的核心前提。' },
    factualAccuracy: { score: 8.4, reason: '没有发现与公开材料冲突的事实。' },
    argumentDepth: { score: 7.9, reason: '讨论了条件与影响范围。' },
    clarity: { score: 8.5, reason: '表达清楚且重点明确。' }
  }
  return JSON.stringify({
    winner: 'affirmative',
    scores: { affirmative: scores, negative: { ...scores, clarity: { score: 7.8, reason: '表达基本清楚。' } } },
    strengths: { affirmative: ['证据主线完整'], negative: ['风险分析明确'] },
    weaknesses: { affirmative: ['适用边界仍可细化'], negative: ['核心证据回应不足'] },
    keyTurningPoints: ['反驳阶段重新连接了主张与证据。'],
    evidenceUsage: { affirmative: '能用公开证据推进主张。', negative: '证据使用较少。' },
    reasoningQuality: { affirmative: '公开论证链清楚。', negative: '主要前提仍需补强。' },
    chainOfThought: HIDDEN_REASONING
  })
}

function reviewResponse(): string {
  return JSON.stringify({
    summary: '正方通过证据主线小幅占优。',
    bestArguments: ['正方在开篇明确了评价标准。'],
    bestRebuttals: ['正方回应了反方对实施风险的质疑。'],
    missedOpportunities: ['反方没有继续质疑证据适用边界。'],
    evidenceAnalysis: ['公开证据被用于支持主要主张。'],
    improvementSuggestions: ['总结阶段应回收尚未回应的核心问题。'],
    internalReasoning: HIDDEN_REASONING
  })
}
