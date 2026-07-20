import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ResearchApplication } from '../src/application'
import type { DebateTurn } from '../src/domain'
import { SessionRunner, TurnRunner } from '../src/execution'
import { initializePersistence, type PersistenceContext } from '../src/persistence'
import type { ModelCapabilities } from '../src/provider-config'
import { MockAdapter, type ModelAdapter, type UnifiedRequest, type UnifiedResponse, type UnifiedStreamEvent } from '../src/providers'
import {
  MockSearchTool,
  DebatePromptBuilder,
  ResearchContextReader,
  ResearchRunCoordinator
} from '../src/research'

const timestamp = '2026-07-13T00:00:00.000Z'
const temporaryDirectories: string[] = []

const capabilities: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: false,
  webSearch: false,
  structuredOutput: true
}

interface Seeded {
  directory: string
  persistence: PersistenceContext
  application: ResearchApplication
  search: MockSearchTool
}

function seed(): Seeded {
  const directory = mkdtempSync(join(tmpdir(), 'debate-research-'))
  temporaryDirectories.push(directory)
  const initialized = initializePersistence({ appDataDirectory: directory })
  if (!initialized.ok) throw new Error(initialized.error.message)
  const persistence = initialized.value
  const repositories = persistence.repositories
  expect(repositories.providerConnections.create({
    id: 'mock-connection', providerId: 'mock', displayName: 'Mock', protocolType: 'mock',
    baseUrl: 'mock://local', credentialRef: 'mock-ref', enabled: true,
    createdAt: timestamp, updatedAt: timestamp
  }).ok).toBe(true)
  expect(repositories.modelProfiles.create({
    id: 'mock-profile', connectionId: 'mock-connection', modelId: 'mock-model', displayName: 'Mock',
    capabilities, createdAt: timestamp, updatedAt: timestamp
  }).ok).toBe(true)
  expect(repositories.debates.save({
    id: 'debate-1', topic: '城市是否应扩大公共交通投入？', background: '本地测试背景',
    affirmativePosition: '应扩大投入', negativePosition: '不应扩大投入', freeDebateRounds: 1,
    status: 'draft', createdAt: timestamp, updatedAt: timestamp
  }).ok).toBe(true)
  expect(repositories.sessions.create({
    id: 'session-1', debateId: 'debate-1', status: 'draft', currentStage: 'draft',
    createdAt: timestamp, updatedAt: timestamp
  }).ok).toBe(true)
  for (const [id, role] of [
    ['affirmative-1', 'affirmative'], ['negative-1', 'negative'], ['moderator-1', 'moderator'],
    ['judge-1', 'judge']
  ] as const) {
    expect(repositories.participants.create({
      id, sessionId: 'session-1', role, modelProfileId: 'mock-profile', displayName: id,
      createdAt: timestamp, updatedAt: timestamp
    }).ok).toBe(true)
  }
  const search = new MockSearchTool({ now: () => new Date(timestamp) })
  return {
    directory,
    persistence,
    search,
    application: new ResearchApplication({
      persistence, appDataDirectory: directory, searchTool: search,
      now: () => new Date(timestamp), createId: incrementalId()
    })
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('research and evidence MVP', () => {
  it('persists moderator public pool and both structured research plans', () => {
    const seeded = seed()
    const coordinator = new ResearchRunCoordinator({
      research: seeded.persistence.repositories.research,
      participants: seeded.persistence.repositories.participants,
      createId: incrementalId(), now: () => new Date(timestamp)
    })
    expect(coordinator.handleCompletedTurn(turn('public-pool-turn', 'public_pool', 'moderator-1', JSON.stringify({
      topicDefinition: '讨论城市公共交通投入规模', keyConcepts: ['公共交通', '财政投入'],
      controversyDirections: ['效率', '公平'], factBoundaries: ['不自动抓取网页正文']
    }))).ok).toBe(true)
    expect(coordinator.handleCompletedTurn(turn('affirmative-plan', 'affirmative_planning', 'affirmative-1', JSON.stringify({
      goals: ['核实公共交通的社会收益'], questions: ['边际投入是否有效？']
    }))).ok).toBe(true)
    expect(coordinator.handleCompletedTurn(turn('negative-plan', 'negative_planning', 'negative-1', JSON.stringify({
      goals: ['核实财政机会成本'], questions: ['是否存在更低成本方案？']
    }))).ok).toBe(true)

    const workspace = seeded.application.loadWorkspace('session-1')
    expect(workspace.ok).toBe(true)
    if (!workspace.ok) return
    expect(workspace.value.publicPool?.keyConcepts).toContain('公共交通')
    expect(workspace.value.affirmative.goals[0]?.description).toContain('社会收益')
    expect(workspace.value.negative.goals[0]?.description).toContain('机会成本')
    seeded.persistence.database.close()
  })

  it('enforces model context isolation while the user workspace can display both sides', () => {
    const seeded = seed()
    expect(seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'text', title: '正方秘密资料', textContent: 'AFFIRMATIVE_ONLY'
    }).ok).toBe(true)
    expect(seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'negative-1', visibility: 'negative-private',
      kind: 'text', title: '反方秘密资料', textContent: 'NEGATIVE_ONLY'
    }).ok).toBe(true)
    const reader = new ResearchContextReader(
      seeded.persistence.repositories.debates,
      seeded.persistence.repositories.research,
      seeded.persistence.repositories.turns,
      seeded.persistence.repositories.participants
    )
    const affirmative = reader.load({
      debateSessionId: 'session-1', debateId: 'debate-1', participantId: 'affirmative-1',
      role: 'affirmative', topic: 'fallback'
    })
    const negative = reader.load({
      debateSessionId: 'session-1', debateId: 'debate-1', participantId: 'negative-1',
      role: 'negative', topic: 'fallback'
    })
    expect(affirmative.visibleAssets.map((item) => item.textContent)).toContain('AFFIRMATIVE_ONLY')
    expect(affirmative.visibleAssets.map((item) => item.textContent)).not.toContain('NEGATIVE_ONLY')
    expect(negative.visibleAssets.map((item) => item.textContent)).toContain('NEGATIVE_ONLY')
    expect(negative.visibleAssets.map((item) => item.textContent)).not.toContain('AFFIRMATIVE_ONLY')
    const connection = seeded.persistence.repositories.providerConnections.findById('mock-connection')
    const profile = seeded.persistence.repositories.modelProfiles.findById('mock-profile')
    const participants = seeded.persistence.repositories.participants.listBySession('session-1')
    if (!connection.ok || !connection.value || !profile.ok || !profile.value || !participants.ok) throw new Error('runtime seed failed')
    const adapter = new MockAdapter()
    const runtimeParticipant = (role: 'affirmative' | 'negative' | 'moderator') => ({
      role,
      participant: participants.value.find((item) => item.role === role)!,
      modelProfile: profile.value!, providerConnection: connection.value!, adapter
    })
    const runtime = {
      session: { id: 'session-1', debateId: 'debate-1', status: 'running', currentStage: 'affirmative_opening', createdAt: timestamp, updatedAt: timestamp },
      affirmative: runtimeParticipant('affirmative'), negative: runtimeParticipant('negative'), moderator: runtimeParticipant('moderator')
    }
    const request: UnifiedRequest = {
      requestId: 'request-1', turnId: 'turn-1', sessionId: 'session-1', stage: 'affirmative_opening',
      topic: '城市是否应扩大公共交通投入？', participant: { id: 'affirmative-1', role: 'affirmative', name: '正方' },
      prompt: '开篇', signal: new AbortController().signal, modelId: 'mock-model', messages: [], stream: true,
      maxTokens: 100, runtimeMetadata: { sessionId: 'session-1', role: 'affirmative', turnId: 'turn-1', stage: 'affirmative_opening' }
    }
    const messages = new DebatePromptBuilder(reader).build(request, runtime.affirmative, runtime)
    expect(messages[0]?.content).toContain('AFFIRMATIVE_ONLY')
    expect(messages[0]?.content).not.toContain('NEGATIVE_ONLY')
    const userWorkspace = seeded.application.loadWorkspace('session-1')
    expect(userWorkspace.ok && userWorkspace.value.affirmative.assets).toHaveLength(1)
    expect(userWorkspace.ok && userWorkspace.value.negative.assets).toHaveLength(1)
    seeded.persistence.database.close()
  })

  it('injects completed public speeches into live rebuttal and adjudication prompts', () => {
    const seeded = seed()
    const repositories = seeded.persistence.repositories
    for (const record of [
      {
        id: 'opening-a', sessionId: 'session-1', participantId: 'affirmative-1', stage: 'affirmative_opening',
        status: 'completed', content: 'PUBLIC_AFFIRMATIVE_ARGUMENT', createdAt: timestamp, completedAt: timestamp
      },
      {
        id: 'opening-b', sessionId: 'session-1', participantId: 'negative-1', stage: 'negative_opening',
        status: 'completed', content: 'PUBLIC_NEGATIVE_ARGUMENT', createdAt: timestamp, completedAt: timestamp
      },
      {
        id: 'private-research', sessionId: 'session-1', participantId: 'affirmative-1', stage: 'affirmative_research',
        status: 'completed', content: 'PRIVATE_RESEARCH_MUST_NOT_LEAK', createdAt: timestamp, completedAt: timestamp
      },
      {
        id: 'failed-rebuttal', sessionId: 'session-1', participantId: 'negative-1', stage: 'rebuttal',
        status: 'failed', content: 'FAILED_PARTIAL_MUST_NOT_APPEAR', createdAt: timestamp
      }
    ]) expect(repositories.turns.create(record).ok).toBe(true)

    const reader = new ResearchContextReader(
      repositories.debates,
      repositories.research,
      repositories.turns,
      repositories.participants
    )
    const connection = repositories.providerConnections.findById('mock-connection')
    const profile = repositories.modelProfiles.findById('mock-profile')
    const participants = repositories.participants.listBySession('session-1')
    if (!connection.ok || !connection.value || !profile.ok || !profile.value || !participants.ok) throw new Error('runtime seed failed')
    const adapter = new MockAdapter()
    const runtimeParticipant = (role: 'affirmative' | 'negative' | 'moderator' | 'judge') => ({
      role,
      participant: participants.value.find((item) => item.role === role)!,
      modelProfile: profile.value!, providerConnection: connection.value!, adapter
    })
    const runtime = {
      session: { id: 'session-1', debateId: 'debate-1', status: 'running', currentStage: 'adjudication', createdAt: timestamp, updatedAt: timestamp },
      affirmative: runtimeParticipant('affirmative'), negative: runtimeParticipant('negative'),
      moderator: runtimeParticipant('moderator'), judge: runtimeParticipant('judge')
    }
    const request = (stage: 'rebuttal' | 'adjudication', role: 'affirmative' | 'judge'): UnifiedRequest => ({
      requestId: `request-${stage}`, turnId: `turn-${stage}`, sessionId: 'session-1', stage,
      topic: '城市是否应扩大公共交通投入？',
      participant: { id: role === 'judge' ? 'judge-1' : 'affirmative-1', role, name: role === 'judge' ? '裁判' : '正方' },
      prompt: `完成${stage}`, signal: new AbortController().signal, modelId: 'mock-model', messages: [], stream: true,
      maxTokens: undefined, runtimeMetadata: { sessionId: 'session-1', role, turnId: `turn-${stage}`, stage }
    })
    const builder = new DebatePromptBuilder(reader)
    const rebuttal = builder.build(request('rebuttal', 'affirmative'), runtime.affirmative, runtime)[0]?.content ?? ''
    const adjudication = builder.build(request('adjudication', 'judge'), runtime.judge, runtime)[0]?.content ?? ''

    for (const prompt of [rebuttal, adjudication]) {
      expect(prompt).toContain('PUBLIC_AFFIRMATIVE_ARGUMENT')
      expect(prompt).toContain('PUBLIC_NEGATIVE_ARGUMENT')
      expect(prompt).not.toContain('PRIVATE_RESEARCH_MUST_NOT_LEAK')
      expect(prompt).not.toContain('FAILED_PARTIAL_MUST_NOT_APPEAR')
    }
    expect(adjudication).toContain('Turn 1｜affirmative_opening｜正方')
    expect(adjudication).toContain('Turn 2｜negative_opening｜反方')
    seeded.persistence.database.close()
  })

  it('publishes a private asset with a stable code and preserves append-only status history', () => {
    const seeded = seed()
    const asset = seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'url', title: '人工 URL 资料', url: 'https://example.test/source', summary: '人工填写摘要'
    })
    expect(asset.ok).toBe(true)
    if (!asset.ok) return
    const first = seeded.application.publishEvidence({ sessionId: 'session-1', assetId: asset.value.id, changedBy: 'affirmative-1' })
    const duplicate = seeded.application.publishEvidence({ sessionId: 'session-1', assetId: asset.value.id, changedBy: 'affirmative-1' })
    expect(first).toMatchObject({ ok: true, value: { publicCode: 'A-S1' } })
    expect(duplicate).toEqual(first)
    if (!first.ok) return
    expect(seeded.application.challengeEvidence({
      sessionId: 'session-1', evidenceId: first.value.evidenceId, changedBy: 'negative-1', note: '来源适用性待核实'
    })).toEqual({ ok: true, value: true })
    expect(seeded.application.updateEvidenceStatus({
      sessionId: 'session-1', evidenceId: first.value.evidenceId, changedBy: 'moderator-1',
      status: 'supported', note: '主持人确认其支持范围'
    })).toEqual({ ok: true, value: true })
    const workspace = seeded.application.loadWorkspace('session-1')
    expect(workspace.ok && workspace.value.evidence[0]?.currentStatus).toBe('supported')
    expect(workspace.ok && workspace.value.evidenceHistory).toHaveLength(3)
    expect(workspace.ok && workspace.value.affirmative.assets[0]?.visibility).toBe('affirmative-private')
    seeded.persistence.database.close()
  })

  it('marks nonexistent evidence references without rejecting valid codes', () => {
    const seeded = seed()
    const repository = seeded.persistence.repositories
    const asset = seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'text', title: '证据', textContent: '内容'
    })
    if (!asset.ok) throw new Error('asset failed')
    const published = seeded.application.publishEvidence({ sessionId: 'session-1', assetId: asset.value.id, changedBy: 'affirmative-1' })
    if (!published.ok) throw new Error('publish failed')
    expect(repository.turns.create({
      id: 'formal-turn', sessionId: 'session-1', participantId: 'affirmative-1', stage: 'affirmative_opening',
      status: 'completed', content: '有效 A-S1，无效 B-S99。', createdAt: timestamp, completedAt: timestamp
    }).ok).toBe(true)
    const coordinator = new ResearchRunCoordinator({
      research: repository.research, participants: repository.participants,
      createId: incrementalId(), now: () => new Date(timestamp)
    })
    expect(coordinator.handleCompletedTurn(turn('formal-turn', 'affirmative_opening', 'affirmative-1', '有效 A-S1，无效 B-S99。')).ok).toBe(true)
    const issues = repository.research.listReferenceIssues('session-1')
    expect(issues.ok && issues.value.map((item) => item.referenceCode)).toEqual(['B-S99'])
    seeded.persistence.database.close()
  })

  it('uses MockSearchTool without any real network request and keeps results private', async () => {
    const seeded = seed()
    const result = await seeded.application.runMockSearch({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', query: '公共交通收益'
    })
    expect(result).toEqual({ ok: true, value: 1 })
    expect(seeded.search.networkRequestCount).toBe(0)
    expect(seeded.search.requests).toHaveLength(1)
    const reader = new ResearchContextReader(
      seeded.persistence.repositories.debates,
      seeded.persistence.repositories.research,
      seeded.persistence.repositories.turns,
      seeded.persistence.repositories.participants
    )
    const negative = reader.load({ debateSessionId: 'session-1', debateId: 'debate-1', participantId: 'negative-1', role: 'negative', topic: 'x' })
    expect(negative.visibleSources).toHaveLength(0)
    seeded.persistence.database.close()
  })

  it('stores text, URL metadata and images under app data without exposing the local path', () => {
    const seeded = seed()
    expect(seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'text', title: '文字', textContent: '人工文字'
    }).ok).toBe(true)
    expect(seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'url', title: '网页', url: 'https://example.test/meta', summary: '只保存元数据'
    }).ok).toBe(true)
    const image = seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'affirmative-1', visibility: 'affirmative-private',
      kind: 'image', title: '测试图片', fileName: 'evidence.png', mimeType: 'image/png', bytes: [137, 80, 78, 71]
    })
    expect(image.ok).toBe(true)
    if (image.ok) {
      expect(image.value).not.toHaveProperty('localPath')
      expect(image.value.hasLocalFile).toBe(true)
      expect(image.value.capabilityWarningZh).toContain('未声明图片输入能力')
    }
    const records = seeded.persistence.repositories.research.listAssets('session-1')
    const imageRecord = records.ok ? records.value.find((item) => item.kind === 'image') : undefined
    expect(imageRecord?.localPath && existsSync(imageRecord.localPath)).toBe(true)
    seeded.persistence.database.close()
  })

  it('restores research records and the current research stage after reopening SQLite', () => {
    const seeded = seed()
    const added = seeded.application.addAsset({
      sessionId: 'session-1', ownerParticipantId: 'negative-1', visibility: 'negative-private',
      kind: 'text', title: '恢复测试', textContent: '重启后仍应存在'
    })
    expect(added.ok).toBe(true)
    expect(seeded.persistence.repositories.sessions.updateRuntimeState('session-1', 'paused', 'negative_research', timestamp)).toEqual({ ok: true, value: true })
    seeded.persistence.database.close()

    const reopened = initializePersistence({ appDataDirectory: seeded.directory })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.repositories.sessions.get('session-1')).toMatchObject({
      ok: true, value: { status: 'paused', currentStage: 'negative_research' }
    })
    const restored = reopened.value.repositories.research.listAssets('session-1')
    expect(restored.ok && restored.value[0]?.textContent).toBe('重启后仍应存在')
    reopened.value.database.close()
  })

  it('applies pause, resume, failure and retry semantics inside a research stage', async () => {
    const pauseAdapter = new ResearchStageAdapter(['wait-for-cancel'])
    const pausedRunner = researchStageRunner(pauseAdapter)
    const pending = pausedRunner.run()
    await Promise.resolve()
    expect(pausedRunner.pause()).toBe(true)
    const paused = await pending
    expect(paused).toMatchObject({ status: 'paused', state: { stage: 'affirmative_research' } })
    const resumed = await pausedRunner.resume()
    expect(resumed.status).toBe('completed')
    expect(pauseAdapter.calls).toBeGreaterThan(1)

    const retryAdapter = new ResearchStageAdapter(['fail'])
    const retryRunner = researchStageRunner(retryAdapter)
    const failed = await retryRunner.run()
    expect(failed).toMatchObject({ status: 'failed', state: { stage: 'affirmative_research' } })
    if (!failed.lastTurn) throw new Error('Expected failed research turn.')
    const retried = await retryRunner.retryFailedTurn(failed.lastTurn)
    expect(retried.status).toBe('completed')
    expect(retried.lastTurn?.retryOfTurnId).toBeUndefined()
    const completedResearchTurn = retryRunner.engine.getTurns().find((item) => item.stage === 'affirmative_research')
    expect(completedResearchTurn?.retryOfTurnId).toBe(failed.lastTurn.id)
    expect(completedResearchTurn?.id).not.toBe(failed.lastTurn.id)
  })
})

function turn(
  id: string,
  stage: DebateTurn['stage'],
  participantId: string,
  content: string
): DebateTurn {
  return {
    id, sessionId: 'session-1', stage, participantId, status: 'completed', content, createdAt: timestamp
  }
}

function incrementalId(): () => string {
  let value = 0
  return () => `research-id-${++value}`
}

function researchStageRunner(adapter: ModelAdapter): SessionRunner {
  return new SessionRunner({
    id: 'research-stage-session', topic: '研究阶段恢复测试', participants: [
      { id: 'affirmative-1', role: 'affirmative', name: '正方' },
      { id: 'negative-1', role: 'negative', name: '反方' },
      { id: 'moderator-1', role: 'moderator', name: '主持人' }
    ]
  }, new TurnRunner(adapter), {
    engine: { initialState: { stage: 'affirmative_research', status: 'running' } }
  })
}

class ResearchStageAdapter implements ModelAdapter {
  calls = 0

  constructor(private readonly behaviors: Array<'wait-for-cancel' | 'fail'>) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    for await (const event of this.stream(request)) {
      if (event.type === 'completed') return event.response
    }
    throw new Error('No response')
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    this.calls += 1
    const behavior = this.behaviors.shift()
    yield { type: 'started', requestId: request.requestId }
    if (behavior === 'fail') {
      yield { type: 'error', requestId: request.requestId, error: { code: 'REQUEST_FAILED', message: '研究失败', retryable: true } }
      return
    }
    if (behavior === 'wait-for-cancel') {
      yield { type: 'textDelta', requestId: request.requestId, delta: '已生成的研究片段' }
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve()
        else request.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'error', requestId: request.requestId, error: { code: 'CANCELLED', message: '已取消', retryable: true } }
      return
    }
    const content = `${request.stage} Mock 完成`
    yield { type: 'textDelta', requestId: request.requestId, delta: content }
    yield { type: 'completed', response: { requestId: request.requestId, content, finishReason: 'stop' } }
  }
}
