import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDebateSessionParticipantBindings, type DebateParticipantConfig } from '../src/participant-config'
import { initializePersistence } from '../src/persistence'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-studio-participant-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

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

describe('DebateParticipantRepository', () => {
  it('creates, reads, updates and deletes role-to-model bindings', () => {
    const initialized = initializePersistence({ appDataDirectory: temporaryDirectory() })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    const connection: ProviderConnection = {
      id: 'connection-1',
      providerId: 'openai',
      displayName: '配置测试连接',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      credentialRef: 'openai:participant-test',
      enabled: true,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z'
    }
    expect(initialized.value.repositories.providerConnections.create(connection).ok).toBe(true)

    const roles = ['affirmative', 'negative', 'moderator', 'judge'] as const
    for (const [index, role] of roles.entries()) {
      const profile: ModelProfile = {
        id: `profile-${role}`,
        connectionId: connection.id,
        modelId: `manual-${role}-model`,
        displayName: `${role} model`,
        alias: role,
        capabilities,
        createdAt: `2026-07-12T00:00:0${index}.000Z`,
        updatedAt: `2026-07-12T00:00:0${index}.000Z`
      }
      expect(initialized.value.repositories.modelProfiles.create(profile).ok).toBe(true)
    }

    expect(
      initialized.value.database.run(
        'INSERT INTO debates (id, topic, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        'debate-1',
        '参与者配置测试',
        'draft',
        '2026-07-12T00:00:00.000Z',
        '2026-07-12T00:00:00.000Z'
      ).ok
    ).toBe(true)
    expect(
      initialized.value.database.run(
        `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        'session-1',
        'debate-1',
        'draft',
        'draft',
        '2026-07-12T00:00:00.000Z',
        '2026-07-12T00:00:00.000Z'
      ).ok
    ).toBe(true)

    const participantConfigs: DebateParticipantConfig[] = roles.map((role, index) => ({
      id: `participant-${role}`,
      sessionId: 'session-1',
      role,
      modelProfileId: `profile-${role}`,
      displayName: `${role} participant`,
      systemPromptTemplate: role === 'moderator' ? '请主持辩论：{{topic}}' : undefined,
      createdAt: `2026-07-12T00:01:0${index}.000Z`,
      updatedAt: `2026-07-12T00:01:0${index}.000Z`
    }))

    const repository = initialized.value.repositories.participants
    for (const participant of participantConfigs) expect(repository.create(participant).ok).toBe(true)

    expect(repository.get('participant-affirmative')).toEqual({ ok: true, value: participantConfigs[0] })
    expect(repository.listBySession('session-1')).toEqual({ ok: true, value: participantConfigs })

    const bindings = buildDebateSessionParticipantBindings('session-1', participantConfigs)
    expect(bindings.affirmative?.modelProfileId).toBe('profile-affirmative')
    expect(bindings.negative?.modelProfileId).toBe('profile-negative')
    expect(bindings.moderator?.modelProfileId).toBe('profile-moderator')
    expect(bindings.judge?.modelProfileId).toBe('profile-judge')

    const moderator = { ...participantConfigs[2], displayName: '更新后的主持人' }
    expect(repository.update(moderator)).toEqual({ ok: true, value: true })
    expect(repository.get(moderator.id)).toMatchObject({ ok: true, value: { displayName: '更新后的主持人' } })

    expect(repository.delete('participant-judge')).toEqual({ ok: true, value: true })
    expect(repository.get('participant-judge')).toEqual({ ok: true, value: undefined })
    const remaining = repository.listBySession('session-1')
    expect(remaining.ok && remaining.value).toHaveLength(3)

    const stored = repository.get('participant-affirmative')
    expect(stored.ok && stored.value).not.toHaveProperty('apiKey')
    expect(stored.ok && stored.value).not.toHaveProperty('credentialRef')
    expect(stored.ok && stored.value).not.toHaveProperty('modelProfile')
    initialized.value.database.close()
  })

  it('rejects a participant whose model profile does not exist', () => {
    const initialized = initializePersistence({ appDataDirectory: temporaryDirectory() })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    initialized.value.database.run(
      "INSERT INTO debates (id, topic, status, created_at, updated_at) VALUES ('d', 't', 'draft', 'now', 'now')"
    )
    initialized.value.database.run(
      `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
       VALUES ('s', 'd', 'draft', 'draft', 'now', 'now')`
    )

    const result = initialized.value.repositories.participants.create({
      id: 'invalid-participant',
      sessionId: 's',
      role: 'affirmative',
      modelProfileId: 'missing-profile',
      displayName: '无效配置',
      createdAt: 'now',
      updatedAt: 'now'
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'QUERY_FAILED' } })
    initialized.value.database.close()
  })
})
