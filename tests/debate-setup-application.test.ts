import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateSetupApplication } from '../src/application'
import type { DebateParticipantConfig, DebateParticipantRole } from '../src/participant-config'
import { initializePersistence } from '../src/persistence'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'

const temporaryDirectories: string[] = []

const createdAt = '2026-07-13T00:00:00.000Z'
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

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-studio-application-'))
  temporaryDirectories.push(path)
  return path
}

function seedCompleteSetup(appDataDirectory: string): void {
  const initialized = initializePersistence({ appDataDirectory })
  if (!initialized.ok) throw initialized.error
  const { database, repositories } = initialized.value

  const debate = database.run(
    'INSERT INTO debates (id, topic, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    'debate-1',
    '组合层加载测试',
    'draft',
    createdAt,
    createdAt
  )
  if (!debate.ok) throw debate.error
  const session = database.run(
    `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'session-1',
    'debate-1',
    'draft',
    'draft',
    createdAt,
    createdAt
  )
  if (!session.ok) throw session.error

  const connection: ProviderConnection = {
    id: 'connection-1',
    providerId: 'mock',
    displayName: 'Mock 测试连接',
    protocolType: 'mock',
    baseUrl: 'https://mock.local',
    credentialRef: 'mock:composition-test',
    enabled: true,
    createdAt,
    updatedAt: createdAt
  }
  const connectionResult = repositories.providerConnections.create(connection)
  if (!connectionResult.ok) throw connectionResult.error

  for (const role of roles) {
    const profile: ModelProfile = {
      id: `profile-${role}`,
      connectionId: connection.id,
      modelId: `model-${role}`,
      displayName: `${role} model`,
      capabilities,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      createdAt,
      updatedAt: createdAt
    }
    const profileResult = repositories.modelProfiles.create(profile)
    if (!profileResult.ok) throw profileResult.error

    const participant: DebateParticipantConfig = {
      id: `participant-${role}`,
      sessionId: 'session-1',
      role: role as DebateParticipantRole,
      modelProfileId: profile.id,
      displayName: `${role} participant`,
      createdAt,
      updatedAt: createdAt
    }
    const participantResult = repositories.participants.create(participant)
    if (!participantResult.ok) throw participantResult.error
  }

  const closed = database.close()
  if (!closed.ok) throw closed.error
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('DebateSetupApplication composition', () => {
  it('loads a complete setup through repositories composed over SQLite', () => {
    const appDataDirectory = temporaryDirectory()
    seedCompleteSetup(appDataDirectory)
    const initialized = initializeDebateSetupApplication({
      appDataDirectory,
      getCapabilityRequirements: () => ({ requiredCapabilities: { textInput: true, streaming: true } })
    })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    const result = initialized.value.loadDebateSetup('session-1')

    expect(result.loadErrors).toEqual([])
    expect(result.validation.valid).toBe(true)
    expect(result.setup?.session.id).toBe('session-1')
    expect(result.setup?.affirmative?.modelProfile?.id).toBe('profile-affirmative')
    expect(result.setup?.negative?.providerConnection?.id).toBe('connection-1')
    expect(result.setup?.moderator?.participant.role).toBe('moderator')
    expect(result.setup?.judge?.participant.role).toBe('judge')
    expect(result.setup?.availableProtocolTypes).toEqual(['mock', 'openai-chat'])
    expect(initialized.value.close()).toEqual({ ok: true, value: undefined })
  })

  it('releases the database once and blocks further setup reads', () => {
    const appDataDirectory = temporaryDirectory()
    seedCompleteSetup(appDataDirectory)
    const initialized = initializeDebateSetupApplication({ appDataDirectory })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    expect(initialized.value.close()).toEqual({ ok: true, value: undefined })
    expect(initialized.value.close()).toEqual({ ok: true, value: undefined })
    const result = initialized.value.loadDebateSetup('session-1')

    expect(result.setup).toBeUndefined()
    expect(result.loadErrors).toEqual([
      expect.objectContaining({ code: 'APPLICATION_CLOSED', relatedId: 'session-1', retryable: false })
    ])
  })
})
