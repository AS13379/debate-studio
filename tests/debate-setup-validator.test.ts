import { describe, expect, it } from 'vitest'

import type { DebateParticipantConfig, DebateParticipantRole } from '../src/participant-config'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import { DebateSetupValidator, type DebateSetupValidationInput } from '../src/setup-validation'

const roles = ['affirmative', 'negative', 'moderator', 'judge'] as const

const capabilities: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: true,
  webSearch: false,
  structuredOutput: true
}

function participant(role: DebateParticipantRole): DebateParticipantConfig {
  return {
    id: `participant-${role}`,
    sessionId: 'session-1',
    role,
    modelProfileId: `profile-${role}`,
    displayName: `${role} participant`,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  }
}

function profile(role: DebateParticipantRole): ModelProfile {
  return {
    id: `profile-${role}`,
    connectionId: 'connection-1',
    modelId: `model-${role}`,
    displayName: `${role} model`,
    alias: role,
    capabilities,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  }
}

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'connection-1',
    providerId: 'openai',
    displayName: 'OpenAI 测试连接',
    protocolType: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    credentialRef: 'openai:primary',
    enabled: true,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides
  }
}

function completeInput(): DebateSetupValidationInput {
  return {
    sessionId: 'session-1',
    participants: roles.map(participant),
    modelProfiles: roles.map(profile),
    providerConnections: [connection()]
  }
}

function validator(protocols: Array<ProviderConnection['protocolType']> = ['openai-chat']): DebateSetupValidator {
  return new DebateSetupValidator({ availableProtocolTypes: protocols })
}

describe('DebateSetupValidator', () => {
  it('accepts a complete setup', () => {
    expect(validator().validate(completeInput())).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('rejects missing required roles', () => {
    const input = completeInput()
    input.participants = input.participants.filter((item) => item.role === 'judge')

    const result = validator().validate(input)

    expect(result.valid).toBe(false)
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MISSING_AFFIRMATIVE', 'MISSING_NEGATIVE', 'MISSING_MODERATOR'])
    )
  })

  it('allows an omitted judge with a warning', () => {
    const input = completeInput()
    input.participants = input.participants.filter((item) => item.role !== 'judge')

    const result = validator().validate(input)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'JUDGE_NOT_CONFIGURED', role: 'judge' })])
  })

  it('rejects a missing ModelProfile', () => {
    const input = completeInput()
    input.modelProfiles = input.modelProfiles.filter((item) => item.id !== 'profile-negative')

    expect(validator().validate(input)).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'MODEL_PROFILE_NOT_FOUND', role: 'negative' })]
    })
  })

  it('rejects a missing or disabled ProviderConnection', () => {
    const missing = completeInput()
    missing.providerConnections = []
    expect(validator().validate(missing).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_CONNECTION_NOT_FOUND' })])
    )

    const disabled = completeInput()
    disabled.providerConnections = [connection({ enabled: false })]
    expect(validator().validate(disabled).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_CONNECTION_DISABLED' })])
    )
  })

  it('rejects an empty credentialRef', () => {
    const input = completeInput()
    input.providerConnections = [connection({ credentialRef: '   ' })]

    expect(validator().validate(input).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CREDENTIAL_REFERENCE_MISSING' })])
    )
  })

  it('rejects an empty Model ID', () => {
    const input = completeInput()
    input.modelProfiles = input.modelProfiles.map((item) =>
      item.id === 'profile-affirmative' ? { ...item, modelId: ' ' } : item
    )

    expect(validator().validate(input).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MODEL_ID_MISSING', role: 'affirmative' })])
    )
  })

  it('warns about duplicate models without blocking startup', () => {
    const input = completeInput()
    input.participants = input.participants.map((item) =>
      item.role === 'negative' || item.role === 'moderator'
        ? { ...item, modelProfileId: 'profile-affirmative' }
        : item
    )

    const result = validator().validate(input)

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_MODEL_PROFILE' }),
        expect.objectContaining({ code: 'MODERATOR_MODEL_SHARED' })
      ])
    )
  })

  it('rejects protocols without an available Adapter type', () => {
    const result = validator([]).validate(completeInput())

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ADAPTER_UNAVAILABLE' })]))
  })

  it('checks model capabilities and URL format without making requests', () => {
    const input = completeInput()
    input.providerConnections = [connection({ baseUrl: 'not-a-url' })]
    input.requirements = { requiredCapabilities: { imageInput: true }, minimumContextWindow: 256_000 }

    const result = validator().validate(input)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_BASE_URL' }),
        expect.objectContaining({ code: 'MODEL_CAPABILITY_UNSUPPORTED' }),
        expect.objectContaining({ code: 'CONTEXT_WINDOW_INSUFFICIENT' })
      ])
    )
  })
})
