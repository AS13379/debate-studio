import { describe, expect, it } from 'vitest'

import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import { ConnectionTestService, MockHttpTransport } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const timestamp = '2026-07-13T00:00:00.000Z'
const credentialReference = 'openai:connection-test'
const apiKey = 'sk-connection-test-secret-123456'
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

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'connection-test',
    providerId: 'openai',
    displayName: 'OpenAI compatible test',
    protocolType: 'openai-chat',
    baseUrl: 'https://provider.test/v1/',
    credentialRef: credentialReference,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function profile(): ModelProfile {
  return {
    id: 'profile-test',
    connectionId: 'connection-test',
    modelId: 'provider-model',
    displayName: 'Provider model',
    capabilities,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

async function credentialStore(): Promise<MemoryCredentialStore> {
  const store = new MemoryCredentialStore()
  await store.setCredential(credentialReference, apiKey)
  return store
}

describe('ConnectionTestService', () => {
  it('tests a connection successfully without loading or saving a model list', async () => {
    const transport = new MockHttpTransport({
      response: { status: 200, body: { object: 'list', data: [] } }
    })
    const times = [100, 128]
    const service = new ConnectionTestService({
      transport,
      credentialStore: await credentialStore(),
      now: () => times.shift() ?? 128
    })

    const result = await service.test(connection())

    expect(result).toEqual({
      success: true,
      latencyMs: 28,
      providerStatus: 200,
      responsePreview: '服务商已返回有效连接响应。'
    })
    expect(transport.requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://provider.test/v1/models',
      headers: { authorization: `Bearer ${apiKey}` }
    })
  })

  it('uses a minimal Chat Completions request when validating a ModelProfile', async () => {
    const transport = new MockHttpTransport({
      response: {
        status: 200,
        body: { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }
      }
    })
    const service = new ConnectionTestService({ transport, credentialStore: await credentialStore() })

    const result = await service.test(connection(), profile())

    expect(result.success).toBe(true)
    expect(transport.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://provider.test/v1/chat/completions',
      body: {
        model: 'provider-model',
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        stream: false,
        max_tokens: 1
      }
    })
  })

  it('returns provider status and a retryable Chinese error for provider failures', async () => {
    const transport = new MockHttpTransport({
      response: { status: 500, body: { error: { message: '平台内部错误' } } }
    })
    const service = new ConnectionTestService({ transport, credentialStore: await credentialStore() })

    const result = await service.test(connection())

    expect(result).toMatchObject({
      success: false,
      providerStatus: 500,
      error: {
        code: 'UNKNOWN_PROVIDER_ERROR',
        titleZh: '服务商暂时不可用',
        descriptionZh: '服务商返回了服务器错误，当前请求未能完成。',
        retryable: true
      }
    })
  })

  it('fails without sending a request when the credential reference is empty', async () => {
    const transport = new MockHttpTransport()
    const service = new ConnectionTestService({ transport, credentialStore: await credentialStore() })

    const result = await service.test(connection({ credentialRef: '' }))

    expect(result).toMatchObject({
      success: false,
      error: { code: 'CREDENTIAL_REFERENCE_MISSING', titleZh: '凭据引用缺失', retryable: false }
    })
    expect(transport.requests).toEqual([])
  })

  it('returns a structured missing-credential error when the reference is not in CredentialStore', async () => {
    const transport = new MockHttpTransport()
    const service = new ConnectionTestService({
      transport,
      credentialStore: new MemoryCredentialStore()
    })

    const result = await service.test(connection())

    expect(result).toMatchObject({
      success: false,
      error: { code: 'CREDENTIAL_MISSING', titleZh: 'API 凭据缺失', retryable: false }
    })
    expect(transport.requests).toEqual([])
  })
})
