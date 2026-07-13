import { describe, expect, it } from 'vitest'

import type { DebateParticipantRole } from '../src/participant-config'
import type { ModelCapabilities, ModelProfile, ProtocolType, ProviderConnection } from '../src/provider-config'
import { AdapterRegistry, MockAdapter } from '../src/providers'
import { DebateRuntimeResolver } from '../src/runtime'
import type { LoadedDebateSetup, LoadedParticipantSetup } from '../src/setup-loading'

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

interface SetupOptions {
  includeJudge?: boolean
  protocolType?: ProtocolType
  connectionEnabled?: boolean
  sharedProfile?: boolean
}

function setupFixture(options: SetupOptions = {}): LoadedDebateSetup {
  const includeJudge = options.includeJudge ?? true
  const protocolType = options.protocolType ?? 'mock'
  const connection: ProviderConnection = {
    id: 'connection-runtime',
    providerId: protocolType,
    displayName: 'Runtime connection',
    protocolType,
    baseUrl: 'https://runtime.local',
    credentialRef: 'runtime:credential-ref',
    enabled: options.connectionEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const sharedProfile: ModelProfile = {
    id: 'profile-shared',
    connectionId: connection.id,
    modelId: 'shared-model',
    displayName: 'Shared model',
    capabilities,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const participantSetup = (role: DebateParticipantRole): LoadedParticipantSetup => {
    const modelProfile: ModelProfile = options.sharedProfile
      ? sharedProfile
      : {
          ...sharedProfile,
          id: `profile-${role}`,
          modelId: `model-${role}`,
          displayName: `${role} model`
        }
    return {
      participant: {
        id: `participant-${role}`,
        sessionId: 'session-runtime',
        role,
        modelProfileId: modelProfile.id,
        displayName: role,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      modelProfile,
      providerConnection: connection
    }
  }
  const roleSetups = new Map(roles.map((role) => [role, participantSetup(role)]))
  const selectedRoles = includeJudge ? roles : roles.filter((role) => role !== 'judge')
  const modelProfiles = selectedRoles
    .map((role) => roleSetups.get(role)?.modelProfile)
    .filter((profile): profile is ModelProfile => Boolean(profile))
    .filter((profile, index, profiles) => profiles.findIndex((candidate) => candidate.id === profile.id) === index)

  return {
    session: {
      id: 'session-runtime',
      debateId: 'debate-runtime',
      status: 'draft',
      currentStage: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    affirmative: roleSetups.get('affirmative'),
    negative: roleSetups.get('negative'),
    moderator: roleSetups.get('moderator'),
    judge: includeJudge ? roleSetups.get('judge') : undefined,
    modelProfiles,
    providerConnections: [connection],
    availableProtocolTypes: [protocolType]
  }
}

function mockRegistry(): { registry: AdapterRegistry; adapter: MockAdapter } {
  const registry = new AdapterRegistry()
  const adapter = new MockAdapter()
  const registered = registry.register('mock', adapter)
  if (!registered.ok) throw new Error(registered.error.message)
  return { registry, adapter }
}

describe('DebateRuntimeResolver', () => {
  it('resolves all four roles into runtime participants', () => {
    const { registry } = mockRegistry()
    const result = new DebateRuntimeResolver().resolve(setupFixture(), registry)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.session.id).toBe('session-runtime')
    expect(result.config.affirmative).toMatchObject({ role: 'affirmative', modelProfile: { id: 'profile-affirmative' } })
    expect(result.config.negative).toMatchObject({ role: 'negative', providerConnection: { id: 'connection-runtime' } })
    expect(result.config.moderator.role).toBe('moderator')
    expect(result.config.judge?.role).toBe('judge')
  })

  it('succeeds when the optional judge is missing', () => {
    const { registry } = mockRegistry()
    const result = new DebateRuntimeResolver().resolve(setupFixture({ includeJudge: false }), registry)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.judge).toBeUndefined()
  })

  it('returns role-linked errors when an Adapter is unavailable', () => {
    const registry = new AdapterRegistry()
    registry.register('mock', new MockAdapter())
    const result = new DebateRuntimeResolver().resolve(
      setupFixture({ includeJudge: false, protocolType: 'openai-chat' }),
      registry
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE', role: 'affirmative', retryable: false }),
        expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE', role: 'negative', retryable: false }),
        expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE', role: 'moderator', retryable: false })
      ])
    )
  })

  it('rejects a disabled ProviderConnection', () => {
    const { registry } = mockRegistry()
    const result = new DebateRuntimeResolver().resolve(
      setupFixture({ includeJudge: false, connectionEnabled: false }),
      registry
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PROVIDER_CONNECTION_DISABLED', role: 'affirmative' })
        ])
      )
    }
  })

  it('reuses one registered Adapter across roles and shared model profiles', () => {
    const { registry, adapter } = mockRegistry()
    const result = new DebateRuntimeResolver().resolve(setupFixture({ sharedProfile: true }), registry)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.affirmative.adapter).toBe(adapter)
    expect(result.config.negative.adapter).toBe(adapter)
    expect(result.config.moderator.adapter).toBe(adapter)
    expect(result.config.judge?.adapter).toBe(adapter)
    expect(result.config.affirmative.modelProfile).toBe(result.config.negative.modelProfile)
  })
})
