import { describe, expect, it } from 'vitest'

import type { ProviderConnection } from '../src/provider-config'
import { MockHttpTransport, ProviderModelDiscoveryService } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const connection: ProviderConnection = {
  id: 'moonshot-connection',
  providerId: 'moonshot',
  displayName: 'Moonshot / Kimi',
  protocolType: 'openai-chat',
  baseUrl: 'https://api.moonshot.cn/v1',
  credentialRef: 'moonshot:credential',
  enabled: true,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z'
}

describe('ProviderModelDiscoveryService', () => {
  it('uses the authenticated provider model list and never returns the credential', async () => {
    const credentialStore = new MemoryCredentialStore()
    await credentialStore.setCredential(connection.credentialRef, 'sk-secret-not-real')
    const transport = new MockHttpTransport({ response: { status: 200, body: {
      object: 'list',
      data: [
        { id: 'kimi-k2.6', owned_by: 'moonshot', context_length: 262144, supports_image_in: true, supports_reasoning: true },
        { id: 'moonshot-v1-32k', owned_by: 'moonshot' }
      ]
    } } })

    const result = await new ProviderModelDiscoveryService(transport, credentialStore).list(connection)

    expect(result).toMatchObject({ source: 'provider-api', models: [
      { id: 'kimi-k2.6', contextWindow: 262144, capabilities: { imageInput: true, reasoning: true } },
      { id: 'moonshot-v1-32k' }
    ] })
    expect(transport.requests[0]).toMatchObject({ method: 'GET', url: 'https://api.moonshot.cn/v1/models' })
    expect(JSON.stringify(result)).not.toContain('sk-secret-not-real')
    expect(JSON.stringify(result)).not.toContain('credentialRef')
  })

  it('falls back to the built-in Moonshot and Kimi list when live discovery fails', async () => {
    const result = await new ProviderModelDiscoveryService(
      new MockHttpTransport({ transportError: { message: 'offline' } }),
      new MemoryCredentialStore()
    ).list(connection)

    expect(result.source).toBe('built-in')
    expect(result.warningZh).toContain('离线名单')
    expect(result.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'kimi-k3', 'kimi-k2.6', 'moonshot-v1-8k', 'moonshot-v1-128k'
    ]))
  })
})
