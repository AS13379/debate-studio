import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { DEBATE_PLANNING_PROMPT_VERSION, MockPlannerAdapter } from '../src/debate-planner'
import { Database } from '../src/persistence'
import { MockAdapter, MockHttpTransport, type ModelAdapter, type UnifiedRequest, type UnifiedResponse, type UnifiedStreamEvent } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const directories: string[] = []
const applications: DebateDesktopApplication[] = []

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Debate Planner', () => {
  it('generates a complete editable plan from only a topic through MockAdapter', async () => {
    const { app } = await createApplication()
    const before = app.configuration.listDebates()
    const result = await app.planner.plan({ mode: 'auto', topic: '大学是否应设置每周无课日？', depth: 'standard' })
    const after = app.configuration.listDebates()

    expect(result).toMatchObject({ ok: true, value: { mode: 'auto', plan: {
      topic: '大学是否应设置每周无课日？', background: expect.any(String),
      affirmativePosition: expect.any(String), negativePosition: expect.any(String),
      keyQuestions: expect.any(Array), researchDirections: expect.any(Array), evidenceSuggestions: expect.any(Array)
    }, provenance: { promptVersion: DEBATE_PLANNING_PROMPT_VERSION, modelId: 'mock-debate-model' } } })
    expect(after).toEqual(before)
  })

  it('reports plain-language streaming progress without exposing credentials or hidden reasoning', async () => {
    const { app } = await createApplication(new MockAdapter({ plannerResponse: JSON.stringify({
      background: '背景', affirmativePosition: '正方', negativePosition: '反方',
      keyQuestions: ['问题'], researchDirections: ['方向'], evidenceSuggestions: ['证据']
    }) }))
    const events: Parameters<NonNullable<Parameters<typeof app.planner.plan>[1]>>[0][] = []
    const result = await app.planner.plan({ mode: 'auto', topic: '测试进度' }, (event) => events.push(event))

    expect(result.ok).toBe(true)
    expect(events.map((event) => event.stage)).toEqual(expect.arrayContaining(['preparing', 'routing', 'requesting', 'parsing', 'completed']))
    expect(events.find((event) => event.stage === 'requesting')?.rawInput).toContain('测试进度')
    expect(events.at(-1)?.rawOutput).toContain('"background":"背景"')
    expect(JSON.stringify(events)).not.toContain('Authorization')
    expect(JSON.stringify(events)).not.toContain('credentialRef')
  })

  it('uses initial positions in assisted mode without exposing secrets in UnifiedRequest', async () => {
    const adapter = new CapturingPlannerAdapter()
    const { app } = await createApplication(adapter)
    const result = await app.planner.plan({
      mode: 'assist', topic: '远程办公是否应成为默认选项？',
      affirmativePosition: '应当默认允许。', negativePosition: '应以线下为默认。'
    })

    expect(result.ok).toBe(true)
    expect(adapter.request?.messages[1]?.content).toContain('正方初始立场：应当默认允许。')
    expect(adapter.request?.messages[1]?.content).toContain('反方初始立场：应以线下为默认。')
    const serialized = JSON.stringify(adapter.request)
    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('Authorization')
  })

  it('rejects invalid JSON and does not silently create a plan', async () => {
    const { app } = await createApplication(new MockAdapter({ plannerResponse: '不是 JSON' }))
    await expect(app.planner.plan({ mode: 'auto', topic: '测试辩题' })).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_JSON', titleZh: '模型返回格式无法解析' }
    })
  })

  it('rejects explanatory text or Markdown wrapped around JSON', async () => {
    const wrapped = '```json\n{"background":"背景","affirmativePosition":"正方","negativePosition":"反方","keyQuestions":[],"researchDirections":[],"evidenceSuggestions":[]}\n```'
    const { app } = await createApplication(new MockAdapter({ plannerResponse: wrapped }))

    await expect(app.planner.plan({ mode: 'auto', topic: '测试严格 JSON' })).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_JSON', titleZh: '模型返回格式无法解析' }
    })
  })

  it('returns a friendly retryable error when the planner adapter fails', async () => {
    const { app } = await createApplication(new MockAdapter({ error: { message: 'planner unavailable' } }))
    await expect(app.planner.plan({ mode: 'auto', topic: '测试失败' })).resolves.toMatchObject({
      ok: false, error: { code: 'MODEL_REQUEST_FAILED', retryable: true }
    })
  })

  it('allows an in-flight planner request to be cancelled by operation id', async () => {
    const adapter = new BlockingPlannerAdapter()
    const { app } = await createApplication(adapter)
    const pending = app.planner.plan({ operationId: 'planner-cancel', mode: 'auto', topic: '取消中的规划' })
    await adapter.started

    expect(app.planner.cancel('planner-cancel')).toBe(true)
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'MODEL_REQUEST_FAILED' } })
    expect(adapter.aborted).toBe(true)
  })

  it('persists only the confirmed final structure and prompt provenance with the Session', async () => {
    const plan = {
      background: '最终背景', affirmativePosition: '最终正方', negativePosition: '最终反方',
      keyQuestions: ['争议一'], researchDirections: ['方向一'], evidenceSuggestions: ['官方资料']
    }
    const { app, directory } = await createApplication(new MockPlannerAdapter(plan))
    const generated = await app.planner.plan({ mode: 'auto', topic: '确认后才保存的辩题' })
    if (!generated.ok) throw new Error(generated.error.descriptionZh)
    const beforeConfirmation = app.configuration.listDebates()
    expect(beforeConfirmation.ok && beforeConfirmation.value).toHaveLength(1)

    const created = app.configuration.createDebate({
      topic: generated.value.plan.topic, background: generated.value.plan.background,
      affirmativePosition: generated.value.plan.affirmativePosition,
      negativePosition: generated.value.plan.negativePosition, freeDebateRounds: 1,
      planning: generated.value
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await app.close()
    applications.splice(applications.indexOf(app), 1)

    const opened = Database.open({ appDataDirectory: directory })
    if (!opened.ok) throw opened.error
    const saved = opened.value.get<Record<string, unknown>>('SELECT * FROM debate_plans WHERE debate_id = ?', created.value.id)
    expect(saved).toMatchObject({ ok: true, value: {
      session_id: created.value.sessionId, topic: '确认后才保存的辩题', background: '最终背景',
      prompt_version: DEBATE_PLANNING_PROMPT_VERSION, model_id: 'mock-debate-model'
    } })
    expect(JSON.stringify(saved)).not.toContain('apiKey')
    expect(JSON.stringify(saved)).not.toContain('credentialRef')
    opened.value.close()
  })
})

class CapturingPlannerAdapter implements ModelAdapter {
  request?: UnifiedRequest
  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    this.request = request
    return { requestId: request.requestId, finishReason: 'stop', content: JSON.stringify({
      background: '完善背景', affirmativePosition: '扩展后的正方立场', negativePosition: '扩展后的反方立场',
      keyQuestions: ['正方成本假设是否成立？', '反方替代方案是否可行？'],
      researchDirections: ['核实双方关键假设'], evidenceSuggestions: ['公开数据']
    }) }
  }
  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    const response = await this.complete(request)
    yield { type: 'started', requestId: request.requestId }
    yield { type: 'textDelta', requestId: request.requestId, delta: response.content }
    yield { type: 'completed', response }
  }
}

class BlockingPlannerAdapter implements ModelAdapter {
  aborted = false
  private notifyStarted!: () => void
  readonly started = new Promise<void>((resolve) => { this.notifyStarted = resolve })

  async complete(_request: UnifiedRequest): Promise<UnifiedResponse> {
    throw new Error('stream only')
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    this.notifyStarted()
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) resolve()
      else request.signal.addEventListener('abort', () => resolve(), { once: true })
    })
    this.aborted = request.signal.aborted
    yield {
      type: 'error', requestId: request.requestId,
      error: { code: 'CANCELLED', message: 'Planner cancelled.', retryable: true }
    }
  }
}

async function createApplication(adapter: ModelAdapter = new MockAdapter()): Promise<{ app: DebateDesktopApplication; directory: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'debate-planner-'))
  directories.push(directory)
  const initialized = initializeDebateDesktopApplication({
    appDataDirectory: directory, credentialStore: new MemoryCredentialStore(),
    openAITransport: new MockHttpTransport(), mockAdapter: adapter
  })
  if (!initialized.ok) throw initialized.error
  applications.push(initialized.value)
  const demo = await initialized.value.configuration.createMockDemoDebate()
  if (!demo.ok) throw new Error(demo.error.descriptionZh)
  const profileId = demo.value.participants[0]!.modelProfileId
  const routed = await initialized.value.modelRouting.savePolicy('debate_planning', profileId)
  if (!routed.ok) throw new Error(routed.error.descriptionZh)
  return { app: initialized.value, directory }
}
