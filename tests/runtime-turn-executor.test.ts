import { describe, expect, it } from 'vitest'

import { DebateEngine, type DebateConfig, type DebateStage, type ParticipantRole } from '../src/domain'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import {
  MockHttpTransport,
  OpenAIChatAdapter,
  type ModelAdapter,
  type OpenAIChatRequestBody,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from '../src/providers'
import {
  TurnRunnerFactory,
  type DebateRuntimeConfig,
  type RuntimeParticipant
} from '../src/runtime'

const timestamp = '2026-07-13T00:00:00.000Z'
const roles = ['affirmative', 'negative', 'moderator', 'judge'] as const
const capabilities: ModelCapabilities = {
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

class RecordingAdapter implements ModelAdapter {
  readonly requests: UnifiedRequest[] = []

  constructor(private readonly content: string) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    this.requests.push(request)
    return { requestId: request.requestId, content: this.content, finishReason: 'stop' }
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    this.requests.push(request)
    yield { type: 'started', requestId: request.requestId }
    yield { type: 'textDelta', requestId: request.requestId, delta: this.content }
    yield {
      type: 'completed',
      response: { requestId: request.requestId, content: this.content, finishReason: 'stop' }
    }
  }
}

function debateConfig(): DebateConfig {
  const engineRoles = ['affirmative', 'negative', 'judge', 'moderator'] as const
  return {
    id: 'runtime-execution-session',
    topic: '运行时执行路由是否正确？',
    participants: engineRoles.map((role) => ({ id: `domain-${role}`, role, name: role }))
  }
}

function engineAt(targetStage: Exclude<DebateStage, 'draft' | 'completed'>): DebateEngine {
  const engine = new DebateEngine(debateConfig())
  engine.dispatch({ type: 'start' })
  while (engine.getState().stage !== targetStage) {
    const advanced = engine.advance({ content: '测试准备阶段' })
    if (!advanced.ok) throw new Error(advanced.error.message)
  }
  return engine
}

function runtimeParticipant(role: ParticipantRole, adapter: ModelAdapter): RuntimeParticipant {
  const modelProfile: ModelProfile = {
    id: `profile-${role}`,
    connectionId: `connection-${role}`,
    modelId: `model-${role}`,
    displayName: `${role} model`,
    capabilities,
    contextWindow: 32_000,
    maxOutputTokens: role === 'moderator' ? 1024 : 2048,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const providerConnection: ProviderConnection = {
    id: modelProfile.connectionId,
    providerId: role,
    displayName: `${role} connection`,
    protocolType: adapter instanceof OpenAIChatAdapter ? 'openai-chat' : 'mock',
    baseUrl: `https://${role}.runtime.test/v1`,
    credentialRef: `sensitive-reference:${role}`,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return {
    role,
    participant: {
      id: `domain-${role}`,
      sessionId: 'runtime-execution-session',
      role,
      modelProfileId: modelProfile.id,
      displayName: role,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    modelProfile,
    providerConnection,
    adapter
  }
}

interface RuntimeAdapters {
  affirmative?: ModelAdapter
  negative?: ModelAdapter
  moderator?: ModelAdapter
  judge?: ModelAdapter
}

function runtimeConfig(adapters: RuntimeAdapters = {}, includeJudge = true): DebateRuntimeConfig {
  const affirmative = adapters.affirmative ?? new RecordingAdapter('正方响应')
  const negative = adapters.negative ?? new RecordingAdapter('反方响应')
  const moderator = adapters.moderator ?? new RecordingAdapter('主持人响应')
  const judge = adapters.judge ?? new RecordingAdapter('裁判响应')
  return {
    session: {
      id: 'runtime-execution-session',
      debateId: 'runtime-execution-debate',
      status: 'draft',
      currentStage: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    affirmative: runtimeParticipant('affirmative', affirmative),
    negative: runtimeParticipant('negative', negative),
    moderator: runtimeParticipant('moderator', moderator),
    judge: includeJudge ? runtimeParticipant('judge', judge) : undefined
  }
}

function factoryBundle(config: DebateRuntimeConfig) {
  let id = 0
  return new TurnRunnerFactory().create(config, {
    createId: () => `runtime-id-${++id}`,
    now: () => new Date(timestamp)
  })
}

describe('RuntimeTurnExecutor and TurnRunnerFactory', () => {
  it.each([
    ['affirmative', 'affirmative_opening'],
    ['negative', 'negative_opening'],
    ['moderator', 'validating']
  ] as const)('routes a %s turn to the matching model', async (role, stage) => {
    const adapter = new RecordingAdapter(`${role} response`)
    const config = runtimeConfig({ [role]: adapter })
    const { turnRunner } = factoryBundle(config)

    const result = await turnRunner.startTurn(engineAt(stage), `${role} prompt`)

    expect(result.turn.status).toBe('completed')
    expect(adapter.requests).toHaveLength(1)
    const request = adapter.requests[0]
    expect(request.modelId).toBe(`model-${role}`)
    expect(request.messages).toEqual([
      { role: 'system', content: `辩题：运行时执行路由是否正确？\n角色：${role}（${role}）` },
      { role: 'user', content: `${role} prompt` }
    ])
    expect(request.stream).toBe(true)
    expect(request.maxTokens).toBe(role === 'moderator' ? 1024 : 2048)
    expect(request.runtimeMetadata).toMatchObject({
      sessionId: 'runtime-execution-session',
      role,
      turnId: result.turn.id,
      stage,
      modelProfileId: `profile-${role}`,
      providerConnectionId: `connection-${role}`,
      baseUrl: `https://${role}.runtime.test/v1`
    })
  })

  it('supports different Adapter instances for different roles', async () => {
    const affirmative = new RecordingAdapter('affirmative adapter')
    const negative = new RecordingAdapter('negative adapter')
    const bundle = factoryBundle(runtimeConfig({ affirmative, negative }))

    await bundle.turnRunner.startTurn(engineAt('affirmative_opening'))
    await bundle.turnRunner.startTurn(engineAt('negative_opening'))

    expect(affirmative.requests).toHaveLength(1)
    expect(negative.requests).toHaveLength(1)
    expect(affirmative.requests[0].modelId).toBe('model-affirmative')
    expect(negative.requests[0].modelId).toBe('model-negative')
  })

  it('returns a structured error when the current role is missing', async () => {
    const bundle = factoryBundle(runtimeConfig({}, false))

    const result = await bundle.turnRunner.startTurn(engineAt('adjudication'))

    expect(result.turn).toMatchObject({ status: 'failed', participantId: 'domain-judge' })
    const errorEvent = result.streamEvents.find((event) => event.type === 'error')
    expect(errorEvent).toEqual({
      type: 'error',
      requestId: expect.any(String),
      error: {
        code: 'RUNTIME_CONFIGURATION_ERROR',
        titleZh: '运行角色配置缺失',
        descriptionZh: '当前 Turn 需要裁判，但 DebateRuntimeConfig 中没有对应的 RuntimeParticipant。',
        message: 'Runtime participant is missing for role: judge.',
        role: 'judge',
        retryable: false
      }
    })
  })

  it('does not copy credential references or sensitive fields into UnifiedRequest', async () => {
    const adapter = new RecordingAdapter('safe request')
    const bundle = factoryBundle(runtimeConfig({ affirmative: adapter }))

    await bundle.turnRunner.startTurn(engineAt('affirmative_opening'))

    const request = adapter.requests[0] as UnifiedRequest & Record<string, unknown>
    expect(request).not.toHaveProperty('apiKey')
    expect(request).not.toHaveProperty('token')
    expect(request).not.toHaveProperty('secret')
    expect(request).not.toHaveProperty('credentialRef')
    expect(request.runtimeMetadata).not.toHaveProperty('credentialRef')
    expect(JSON.stringify(request)).not.toContain('sensitive-reference')
  })

  it('delivers the resolved model request to MockHttpTransport', async () => {
    const transport = new MockHttpTransport()
    const openAI = new OpenAIChatAdapter(transport)
    const bundle = factoryBundle(runtimeConfig({ affirmative: openAI }))

    const result = await bundle.turnRunner.startTurn(engineAt('affirmative_opening'), '请提出核心论点。')

    expect(result.turn.status).toBe('completed')
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]).toMatchObject({
      url: 'https://affirmative.runtime.test/v1/chat/completions',
      headers: { 'content-type': 'application/json' }
    })
    expect(transport.requests[0].headers).not.toHaveProperty('authorization')
    expect(transport.requests[0].body as OpenAIChatRequestBody).toEqual({
      model: 'model-affirmative',
      messages: [
        {
          role: 'system',
          content: '辩题：运行时执行路由是否正确？\n角色：affirmative（affirmative）'
        },
        { role: 'user', content: '请提出核心论点。' }
      ],
      stream: true,
      max_tokens: 2048
    })
  })

  it('keeps the exact RuntimeParticipant Adapter instance when factory wiring is reused', async () => {
    const adapter = new RecordingAdapter('same instance')
    const config = runtimeConfig({ affirmative: adapter })
    const bundle = factoryBundle(config)

    await bundle.turnRunner.startTurn(engineAt('affirmative_opening'))
    await bundle.turnRunner.startTurn(engineAt('affirmative_closing'))

    expect(config.affirmative.adapter).toBe(adapter)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0].modelId).toBe(adapter.requests[1].modelId)
  })
})
