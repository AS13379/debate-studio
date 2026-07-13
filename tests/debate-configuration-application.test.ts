import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import type { ModelCapabilitiesDto } from '../src/shared/ipc-contract'
import { MockHttpTransport } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const temporaryDirectories: string[] = []
const applications: DebateDesktopApplication[] = []
const capabilities: ModelCapabilitiesDto = {
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

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-configuration-'))
  temporaryDirectories.push(path)
  return path
}

function createApplication(store = new MemoryCredentialStore()): { app: DebateDesktopApplication; store: MemoryCredentialStore } {
  const initialized = initializeDebateDesktopApplication({
    appDataDirectory: temporaryDirectory(),
    credentialStore: store,
    openAITransport: new MockHttpTransport(),
    streamWriteThrottleMs: 0
  })
  if (!initialized.ok) throw initialized.error
  applications.push(initialized.value)
  return { app: initialized.value, store }
}

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('DebateConfigurationApplication', () => {
  it('creates a complete runnable Mock demo and keeps deterministic presets idempotent', async () => {
    const { app } = createApplication()

    const first = app.configuration.createMockDemoDebate()
    const second = app.configuration.createMockDemoDebate()
    const connections = await app.configuration.listProviderConnections()
    const profiles = app.configuration.listModelProfiles()
    const debates = app.configuration.listDebates()

    expect(first).toMatchObject({
      ok: true,
      value: {
        id: 'mock-demo-debate',
        sessionId: 'mock-demo-session',
        status: 'draft',
        participants: [
          { role: 'affirmative', modelProfileId: 'mock-demo-profile' },
          { role: 'negative', modelProfileId: 'mock-demo-profile' },
          { role: 'moderator', modelProfileId: 'mock-demo-profile' }
        ]
      }
    })
    expect(second).toEqual(first)
    expect(connections.ok && connections.value).toHaveLength(1)
    expect(profiles.ok && profiles.value).toHaveLength(1)
    expect(debates.ok && debates.value).toHaveLength(1)
    const setup = await app.configuration.loadDebateSetup('mock-demo-session')
    expect(setup).toMatchObject({ ok: true, value: { validation: { valid: true } } })
  })

  it('stores API Keys only in CredentialStore and never returns plaintext or credentialRef', async () => {
    const { app, store } = createApplication()
    const secret = 'sk-ui-secret-value-123456'
    const connection = await app.configuration.saveProviderConnection({
      id: 'safe-connection',
      providerId: 'openai',
      displayName: 'OpenAI 安全连接',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true
    })
    expect(connection.ok).toBe(true)

    const saved = await app.configuration.saveCredential('safe-connection', secret)
    const listed = await app.configuration.listProviderConnections()

    expect(saved).toEqual({ ok: true, value: true })
    expect(await store.getCredential('openai:safe-connection')).toEqual({ ok: true, value: secret })
    expect(JSON.stringify(connection)).not.toContain(secret)
    expect(JSON.stringify(listed)).not.toContain(secret)
    expect(JSON.stringify(listed)).not.toContain('credentialRef')
    expect(listed).toMatchObject({ ok: true, value: [{ id: 'safe-connection', credentialConfigured: true }] })
  })

  it('preserves an existing Keychain credential when editing a connection', async () => {
    const { app, store } = createApplication()
    const secret = 'sk-preserved-on-edit-123456'
    await app.configuration.saveProviderConnection({
      id: 'editable-connection',
      providerId: 'openai',
      displayName: '编辑前',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true
    })
    await app.configuration.saveCredential('editable-connection', secret)

    const edited = await app.configuration.saveProviderConnection({
      id: 'editable-connection',
      providerId: 'openai',
      displayName: '编辑后',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      enabled: false
    })

    expect(edited).toMatchObject({
      ok: true,
      value: { id: 'editable-connection', displayName: '编辑后', enabled: false, credentialConfigured: true }
    })
    expect(await store.getCredential('openai:editable-connection')).toEqual({ ok: true, value: secret })
    expect(JSON.stringify(edited)).not.toContain(secret)
    expect(JSON.stringify(edited)).not.toContain('credentialRef')
  })

  it('deletes the Keychain credential only when explicitly requested', async () => {
    const { app, store } = createApplication()
    for (const id of ['keep-key', 'delete-key']) {
      await app.configuration.saveProviderConnection({
        id,
        providerId: 'openai',
        displayName: id,
        protocolType: 'openai-chat',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true
      })
      await app.configuration.saveCredential(id, `sk-${id}-secret-123456`)
    }

    expect(await app.configuration.deleteProviderConnection('keep-key', false)).toEqual({ ok: true, value: true })
    expect(await app.configuration.deleteProviderConnection('delete-key', true)).toEqual({ ok: true, value: true })
    expect(await store.hasCredential('openai:keep-key')).toEqual({ ok: true, value: true })
    expect(await store.hasCredential('openai:delete-key')).toEqual({ ok: true, value: false })
  })

  it('supports ModelProfile create, update, copy and delete without secret fields', async () => {
    const { app } = createApplication()
    await app.configuration.saveProviderConnection({
      id: 'profile-connection',
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      enabled: true
    })

    const created = app.configuration.saveModelProfile({
      id: 'profile-crud',
      connectionId: 'profile-connection',
      modelId: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      alias: '辩论模型',
      capabilities,
      contextWindow: 64_000,
      maxOutputTokens: 2_048
    })
    const updated = app.configuration.saveModelProfile({
      id: 'profile-crud',
      connectionId: 'profile-connection',
      modelId: 'deepseek-chat',
      displayName: 'DeepSeek Chat 更新',
      alias: '更新别名',
      capabilities: { ...capabilities, imageInput: true },
      contextWindow: 128_000,
      maxOutputTokens: 4_096
    })
    const copied = app.configuration.copyModelProfile('profile-crud')

    expect(created).toMatchObject({ ok: true, value: { id: 'profile-crud', modelId: 'deepseek-chat' } })
    expect(updated).toMatchObject({
      ok: true,
      value: { displayName: 'DeepSeek Chat 更新', alias: '更新别名', contextWindow: 128_000 }
    })
    expect(copied).toMatchObject({ ok: true, value: { displayName: 'DeepSeek Chat 更新 副本' } })
    const serialized = JSON.stringify(app.configuration.listModelProfiles())
    expect(serialized).not.toContain('"apiKey"')
    expect(serialized).not.toContain('"credentialRef"')
    expect(serialized).not.toContain('"secret"')
    expect(serialized).not.toContain('"token"')
    expect(app.configuration.deleteModelProfile('profile-crud')).toEqual({ ok: true, value: true })
  })

  it('binds a saved OpenAI Compatible ModelProfile to all required roles and passes setup validation', async () => {
    const { app } = createApplication()
    await app.configuration.saveProviderConnection({
      id: 'real-connection',
      providerId: 'openai',
      displayName: 'OpenAI Compatible',
      protocolType: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true
    })
    const profile = app.configuration.saveModelProfile({
      id: 'real-profile',
      connectionId: 'real-connection',
      modelId: 'gpt-test-manual-id',
      displayName: '真实模型配置',
      capabilities,
      contextWindow: 32_000,
      maxOutputTokens: 512
    })
    const debate = app.configuration.createDebate({
      topic: '真实模型是否可以被选中？',
      affirmativePosition: '可以。',
      negativePosition: '需要验证。',
      freeDebateRounds: 1
    })
    if (!profile.ok || !debate.ok) throw new Error('Test setup failed.')

    const bound = app.configuration.saveParticipantBindings({
      sessionId: debate.value.sessionId,
      affirmative: { modelProfileId: profile.value.id, displayName: '正方' },
      negative: { modelProfileId: profile.value.id, displayName: '反方' },
      moderator: { modelProfileId: profile.value.id, displayName: '主持人' }
    })
    const setup = await app.configuration.loadDebateSetup(debate.value.sessionId)

    expect(bound).toMatchObject({
      ok: true,
      value: {
        participants: [
          { role: 'affirmative', modelProfileId: 'real-profile' },
          { role: 'negative', modelProfileId: 'real-profile' },
          { role: 'moderator', modelProfileId: 'real-profile' }
        ]
      }
    })
    expect(setup).toMatchObject({
      ok: true,
      value: {
        validation: { valid: true, warnings: expect.any(Array) },
        modelProfiles: [{ id: 'real-profile', modelId: 'gpt-test-manual-id' }],
        providerConnections: [{ id: 'real-connection', protocolType: 'openai-chat' }]
      }
    })
  })
})
