import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { MockHttpTransport } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const temporaryDirectories: string[] = []
const applications: DebateDesktopApplication[] = []

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
})
