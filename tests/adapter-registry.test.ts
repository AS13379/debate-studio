import { describe, expect, it } from 'vitest'

import type { DebateParticipantConfig } from '../src/participant-config'
import type { ModelCapabilities, ModelProfile, ProtocolType, ProviderConnection } from '../src/provider-config'
import { AdapterRegistry, MockAdapter } from '../src/providers'
import { DebateSetupValidator } from '../src/setup-validation'

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

function validationInput(protocolType: ProtocolType): {
  sessionId: string
  participants: DebateParticipantConfig[]
  modelProfiles: ModelProfile[]
  providerConnections: ProviderConnection[]
} {
  const sessionId = 'session-registry'
  const timestamp = '2026-07-13T00:00:00.000Z'
  const participants: DebateParticipantConfig[] = ['affirmative', 'negative', 'moderator'].map((role) => ({
    id: `participant-${role}`,
    sessionId,
    role: role as DebateParticipantConfig['role'],
    modelProfileId: 'profile-registry',
    displayName: role,
    createdAt: timestamp,
    updatedAt: timestamp
  }))
  const modelProfile: ModelProfile = {
    id: 'profile-registry',
    connectionId: 'connection-registry',
    modelId: 'registry-model',
    displayName: 'Registry model',
    capabilities,
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const connection: ProviderConnection = {
    id: 'connection-registry',
    providerId: protocolType === 'mock' ? 'mock' : 'openai',
    displayName: 'Registry connection',
    protocolType,
    baseUrl: protocolType === 'mock' ? 'https://mock.local' : 'https://api.openai.com/v1',
    credentialRef: 'registry:test',
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return { sessionId, participants, modelProfiles: [modelProfile], providerConnections: [connection] }
}

describe('AdapterRegistry', () => {
  it('registers and returns the same MockAdapter', () => {
    const registry = new AdapterRegistry()
    const adapter = new MockAdapter()

    expect(registry.register('mock', adapter)).toEqual({ ok: true, value: undefined })
    expect(registry.isAvailable('mock')).toBe(true)
    expect(registry.getAdapter('mock')).toEqual({ ok: true, value: adapter })
  })

  it('returns an immutable snapshot of available protocols without openai-chat', () => {
    const registry = new AdapterRegistry()
    registry.register('mock', new MockAdapter())
    const protocols = registry.getAvailableProtocolTypes()

    expect(protocols).toEqual(['mock'])
    expect(protocols).not.toContain('openai-chat')
    expect(Object.isFrozen(protocols)).toBe(true)
  })

  it('rejects duplicate registrations for the same protocol', () => {
    const registry = new AdapterRegistry()
    const original = new MockAdapter({ responseText: 'original' })
    const duplicate = new MockAdapter({ responseText: 'duplicate' })

    expect(registry.register('mock', original).ok).toBe(true)
    expect(registry.register('mock', duplicate)).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_PROTOCOL', protocolType: 'mock' }
    })
    expect(registry.getAdapter('mock')).toEqual({ ok: true, value: original })
  })

  it('returns a structured error for an unregistered protocol', () => {
    const registry = new AdapterRegistry()

    expect(registry.isAvailable('openai-chat')).toBe(false)
    expect(registry.getAdapter('openai-chat')).toMatchObject({
      ok: false,
      error: { code: 'ADAPTER_NOT_FOUND', protocolType: 'openai-chat' }
    })
  })

  it('provides the protocol set used by Validator for registered and unregistered protocols', () => {
    const registry = new AdapterRegistry()
    registry.register('mock', new MockAdapter())
    const validator = new DebateSetupValidator({
      availableProtocolTypes: registry.getAvailableProtocolTypes()
    })

    const mockResult = validator.validate(validationInput('mock'))
    const openAiResult = validator.validate(validationInput('openai-chat'))

    expect(mockResult.valid).toBe(true)
    expect(mockResult.errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE' })])
    )
    expect(openAiResult.valid).toBe(false)
    expect(openAiResult.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE', configId: 'connection-registry' })])
    )
  })
})
