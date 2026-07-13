import { describe, expect, it } from 'vitest'

import { DebateEngine, type DebateConfig, type ParticipantRole } from '../src/domain'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import {
  AuthenticatedHttpTransport,
  MockAdapter,
  MockHttpTransport,
  OpenAIChatAdapter,
  type HttpTransportRequest,
  type ModelAdapter,
  type UnifiedRequest
} from '../src/providers'
import { TurnRunnerFactory, type DebateRuntimeConfig, type RuntimeParticipant } from '../src/runtime'
import { MemoryCredentialStore } from '../src/security'

const timestamp = '2026-07-13T00:00:00.000Z'
const credentialReference = 'openai:authenticated-test'
const apiKey = 'sk-authenticated-secret-123456'
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

class CountingCredentialStore extends MemoryCredentialStore {
  reads = 0

  override async getCredential(reference: string) {
    this.reads += 1
    return super.getCredential(reference)
  }
}

function httpRequest(): HttpTransportRequest {
  return {
    method: 'POST',
    url: 'https://provider.test/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    body: { model: 'test-model' },
    signal: new AbortController().signal,
    metadata: { providerConnectionId: 'connection-moderator' }
  }
}

function runtimeParticipant(role: ParticipantRole, adapter: ModelAdapter): RuntimeParticipant {
  const modelProfile: ModelProfile = {
    id: `profile-${role}`,
    connectionId: `connection-${role}`,
    modelId: `model-${role}`,
    displayName: `${role} model`,
    capabilities,
    maxOutputTokens: 64,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const providerConnection: ProviderConnection = {
    id: modelProfile.connectionId,
    providerId: 'openai',
    displayName: `${role} connection`,
    protocolType: adapter instanceof MockAdapter ? 'mock' : 'openai-chat',
    baseUrl: 'https://provider.test/v1',
    credentialRef: credentialReference,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return { role, modelProfile, providerConnection, adapter }
}

function runtimeConfig(adapter: ModelAdapter): DebateRuntimeConfig {
  return {
    session: {
      id: 'credential-session',
      debateId: 'credential-debate',
      status: 'draft',
      currentStage: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    affirmative: runtimeParticipant('affirmative', adapter),
    negative: runtimeParticipant('negative', adapter),
    moderator: runtimeParticipant('moderator', adapter)
  }
}

function engine(): DebateEngine {
  const config: DebateConfig = {
    id: 'credential-session',
    topic: '凭据是否安全注入？',
    participants: [
      { id: 'moderator', role: 'moderator', name: '主持人' },
      { id: 'affirmative', role: 'affirmative', name: '正方' },
      { id: 'negative', role: 'negative', name: '反方' }
    ]
  }
  const debate = new DebateEngine(config)
  debate.dispatch({ type: 'start' })
  return debate
}

describe('AuthenticatedHttpTransport', () => {
  it('reads the credential and adds it only to the Authorization header', async () => {
    const store = new MemoryCredentialStore()
    await store.setCredential(credentialReference, apiKey)
    const delegate = new MockHttpTransport()
    const transport = new AuthenticatedHttpTransport(delegate, store, () => credentialReference)
    const originalRequest = httpRequest()

    await transport.send(originalRequest)

    expect(delegate.requests[0].headers.authorization).toBe(`Bearer ${apiKey}`)
    expect(originalRequest.headers).not.toHaveProperty('authorization')
    expect(originalRequest).not.toHaveProperty('credentialRef')
  })

  it('returns a Chinese structured error when credentialRef has no stored credential', async () => {
    const transport = new AuthenticatedHttpTransport(
      new MockHttpTransport(),
      new MemoryCredentialStore(),
      () => credentialReference
    )

    await expect(transport.send(httpRequest())).rejects.toMatchObject({
      code: 'CREDENTIAL_MISSING',
      titleZh: 'API 凭据缺失',
      retryable: false
    })
  })

  it('redacts a provider echo of the API Key before it reaches error events or Turn data', async () => {
    const store = new MemoryCredentialStore()
    await store.setCredential(credentialReference, apiKey)
    const delegate = new MockHttpTransport({
      streamEvents: [{
        type: 'error',
        status: 500,
        body: { error: { code: 'provider_error', message: `provider echoed ${apiKey}` } }
      }]
    })
    const transport = new AuthenticatedHttpTransport(delegate, store, () => credentialReference)
    const adapter = new OpenAIChatAdapter(transport)
    const config = runtimeConfig(adapter)
    const bundle = new TurnRunnerFactory().create(config)

    const result = await bundle.turnRunner.startTurn(engine())

    expect(result.turn.status).toBe('failed')
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(result.turn.error).toContain('[REDACTED]')
    expect(delegate.requests[0].headers.authorization).toBe(`Bearer ${apiKey}`)

    const prepared = bundle.executor.prepareRequest({
      requestId: 'prepare-request',
      turnId: 'prepare-turn',
      sessionId: 'credential-session',
      stage: 'validating',
      topic: '凭据测试',
      participant: { id: 'moderator', role: 'moderator', name: '主持人' },
      prompt: '请验证。',
      signal: new AbortController().signal,
      modelId: '',
      messages: [],
      stream: true,
      maxTokens: undefined,
      runtimeMetadata: {
        sessionId: 'credential-session',
        role: 'moderator',
        turnId: 'prepare-turn',
        stage: 'validating'
      }
    } satisfies UnifiedRequest, true)
    expect(prepared.ok).toBe(true)
    if (prepared.ok) {
      expect(JSON.stringify(prepared.request)).not.toContain(apiKey)
      expect(prepared.request).not.toHaveProperty('credentialRef')
      expect(prepared.request.runtimeMetadata).not.toHaveProperty('credentialRef')
    }
  })

  it('does not read CredentialStore for MockAdapter turns', async () => {
    const store = new CountingCredentialStore()
    await store.setCredential(credentialReference, apiKey)
    const bundle = new TurnRunnerFactory().create(runtimeConfig(new MockAdapter({ responseText: '本地 Mock' })))

    const result = await bundle.turnRunner.startTurn(engine())

    expect(result.turn.status).toBe('completed')
    expect(store.reads).toBe(0)
  })
})
