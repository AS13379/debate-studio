import { describe, expect, it } from 'vitest'

import type { DebateParticipantConfig, DebateParticipantRole } from '../src/participant-config'
import type { PersistenceResult, SessionRecord } from '../src/persistence'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import { DebateSetupValidator } from '../src/setup-validation'
import {
  DebateSetupLoader,
  type DebateSetupLoaderDependencies,
  type DebateSetupLoaderRepositories
} from '../src/setup-loading'

const roles = ['affirmative', 'negative', 'moderator', 'judge'] as const

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

const session: SessionRecord = {
  id: 'session-1',
  debateId: 'debate-1',
  status: 'draft',
  currentStage: 'draft',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z'
}

function participant(role: DebateParticipantRole, modelProfileId = `profile-${role}`): DebateParticipantConfig {
  return {
    id: `participant-${role}`,
    sessionId: session.id,
    role,
    modelProfileId,
    displayName: `${role} participant`,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

function profile(role: DebateParticipantRole, connectionId = 'connection-1'): ModelProfile {
  return {
    id: `profile-${role}`,
    connectionId,
    modelId: `model-${role}`,
    displayName: `${role} model`,
    capabilities,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

const connection: ProviderConnection = {
  id: 'connection-1',
  providerId: 'openai',
  displayName: 'OpenAI connection',
  protocolType: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  credentialRef: 'openai:primary',
  enabled: true,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
}

interface FixtureOptions {
  session?: SessionRecord
  participants?: DebateParticipantConfig[]
  profiles?: ModelProfile[]
  connections?: ProviderConnection[]
}

function success<T>(value: T): PersistenceResult<T> {
  return { ok: true, value }
}

function fixture(options: FixtureOptions = {}): {
  dependencies: DebateSetupLoaderDependencies
  modelReads: Map<string, number>
  connectionReads: Map<string, number>
} {
  const configuredSession = Object.hasOwn(options, 'session') ? options.session : session
  const participants = options.participants ?? roles.map((role) => participant(role))
  const profiles = options.profiles ?? roles.map((role) => profile(role))
  const connections = options.connections ?? [connection]
  const profileById = new Map(profiles.map((item) => [item.id, item]))
  const connectionById = new Map(connections.map((item) => [item.id, item]))
  const modelReads = new Map<string, number>()
  const connectionReads = new Map<string, number>()

  const repositories: DebateSetupLoaderRepositories = {
    sessions: {
      get: (id) => success(configuredSession?.id === id ? configuredSession : undefined)
    },
    participants: {
      listBySession: (id) => success(participants.filter((item) => item.sessionId === id))
    },
    modelProfiles: {
      findById: (id) => {
        modelReads.set(id, (modelReads.get(id) ?? 0) + 1)
        return success(profileById.get(id))
      }
    },
    providerConnections: {
      findById: (id) => {
        connectionReads.set(id, (connectionReads.get(id) ?? 0) + 1)
        return success(connectionById.get(id))
      }
    }
  }

  return {
    dependencies: {
      repositories,
      environment: {
        getAvailableProtocolTypes: () => ['openai-chat'],
        getCapabilityRequirements: () => ({ requiredCapabilities: { textInput: true, streaming: true } })
      },
      validator: new DebateSetupValidator({ availableProtocolTypes: ['openai-chat'] })
    },
    modelReads,
    connectionReads
  }
}

describe('DebateSetupLoader', () => {
  it('loads a complete setup and returns a passing validation', () => {
    const { dependencies } = fixture()

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(result.loadErrors).toEqual([])
    expect(result.validation.valid).toBe(true)
    expect(result.setup?.session).toEqual(session)
    expect(result.setup?.affirmative).toMatchObject({
      participant: { role: 'affirmative' },
      modelProfile: { id: 'profile-affirmative' },
      providerConnection: { id: 'connection-1' }
    })
    expect(result.setup?.negative?.modelProfile?.id).toBe('profile-negative')
    expect(result.setup?.moderator?.modelProfile?.id).toBe('profile-moderator')
    expect(result.setup?.judge?.modelProfile?.id).toBe('profile-judge')
  })

  it('returns a structured error when the Session is missing', () => {
    const { dependencies } = fixture({ session: undefined })

    const result = new DebateSetupLoader(dependencies).load('missing-session')

    expect(result.setup).toBeUndefined()
    expect(result.loadErrors).toEqual([
      expect.objectContaining({ code: 'SESSION_NOT_FOUND', relatedId: 'missing-session', retryable: false })
    ])
  })

  it('reports an empty Participant configuration', () => {
    const { dependencies } = fixture({ participants: [] })

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(result.loadErrors).toEqual([
      expect.objectContaining({ code: 'PARTICIPANTS_EMPTY', relatedId: session.id })
    ])
    expect(result.validation.valid).toBe(false)
    expect(result.validation.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['MISSING_AFFIRMATIVE', 'MISSING_NEGATIVE', 'MISSING_MODERATOR'])
    )
  })

  it('reports a missing ModelProfile reference', () => {
    const profiles = roles.filter((role) => role !== 'negative').map((role) => profile(role))
    const { dependencies } = fixture({ profiles })

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(result.loadErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MODEL_PROFILE_NOT_FOUND', relatedId: 'profile-negative' })])
    )
    expect(result.validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MODEL_PROFILE_NOT_FOUND', role: 'negative' })])
    )
  })

  it('reports a missing ProviderConnection reference', () => {
    const { dependencies } = fixture({ connections: [] })

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(result.loadErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_CONNECTION_NOT_FOUND', relatedId: 'connection-1' })])
    )
    expect(result.validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_CONNECTION_NOT_FOUND' })])
    )
  })

  it('does not repeat ModelProfile or ProviderConnection queries shared by roles', () => {
    const sharedProfile = { ...profile('affirmative'), id: 'profile-shared', modelId: 'shared-model' }
    const participants = roles.map((role) => participant(role, sharedProfile.id))
    const { dependencies, modelReads, connectionReads } = fixture({ participants, profiles: [sharedProfile] })

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(modelReads.get(sharedProfile.id)).toBe(1)
    expect(connectionReads.get(connection.id)).toBe(1)
    expect(result.validation.valid).toBe(true)
    expect(result.validation.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_MODEL_PROFILE' })])
    )
  })

  it('converts a thrown Repository error into a structured load error', () => {
    const { dependencies } = fixture()
    dependencies.repositories.sessions.get = () => { throw new Error('database unavailable') }

    const result = new DebateSetupLoader(dependencies).load(session.id)

    expect(result.setup).toBeUndefined()
    expect(result.loadErrors).toEqual([
      expect.objectContaining({ code: 'REPOSITORY_READ_FAILED', relatedId: session.id, retryable: true })
    ])
  })

  it('never reads a CredentialStore', () => {
    const { dependencies } = fixture()
    let credentialReads = 0
    const dependenciesWithCredentialStore = {
      ...dependencies,
      credentialStore: {
        getCredential: () => { credentialReads += 1 }
      }
    } as unknown as DebateSetupLoaderDependencies

    const result = new DebateSetupLoader(dependenciesWithCredentialStore).load(session.id)

    expect(result.validation.valid).toBe(true)
    expect(credentialReads).toBe(0)
    expect(result.setup?.providerConnections[0]).toHaveProperty('credentialRef', 'openai:primary')
  })
})
