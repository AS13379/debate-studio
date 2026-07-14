import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ResearchApplication } from '../src/application'
import { initializePersistence } from '../src/persistence'
import { MemoryCredentialStore } from '../src/security'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe('search provider application boundary', () => {
  it('stores only credential references and never returns the API key or reference to Renderer', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'search-app-'))
    directories.push(directory)
    const initialized = initializePersistence({ appDataDirectory: directory })
    if (!initialized.ok) throw initialized.error
    const credentialStore = new MemoryCredentialStore()
    const application = new ResearchApplication({
      persistence: initialized.value,
      appDataDirectory: directory,
      credentialStore,
      searchFetch: async () => new Response(JSON.stringify({ results: [{ title: 'ok', url: 'https://example.test', content: 'ok' }] }), { status: 200 })
    })
    const created = application.saveSearchProviderConnection({
      displayName: 'Tavily', baseUrl: 'https://api.tavily.com', enabled: true, isDefault: true
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const saved = await application.saveSearchCredential(created.value.id, 'tvly-real-looking-secret')
    expect(saved).toEqual({ ok: true, value: true })
    const listed = await application.listSearchProviderConnections()
    expect(listed).toMatchObject({ ok: true, value: [expect.objectContaining({ credentialConfigured: true })] })
    expect(JSON.stringify(listed)).not.toContain('tvly-real-looking-secret')
    expect(JSON.stringify(listed)).not.toContain('credentialRef')
    const databaseRow = initialized.value.database.get<Record<string, unknown>>('SELECT * FROM search_provider_connections LIMIT 1')
    expect(JSON.stringify(databaseRow)).not.toContain('tvly-real-looking-secret')
    const tested = await application.testSearchConnection(created.value.id)
    expect(tested).toMatchObject({ ok: true, value: { success: true } })
    initialized.value.database.close()
  })
})
