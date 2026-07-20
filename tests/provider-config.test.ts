import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializePersistence } from '../src/persistence'
import {
  getProviderPreset,
  getProviderPresets,
  getFallbackProviderModels,
  type ModelCapabilities,
  type ModelProfile,
  type ProviderConnection
} from '../src/provider-config'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-studio-provider-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

const capabilities: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  documentInput: false,
  audioInput: false,
  videoInput: false,
  streaming: true,
  reasoning: true,
  toolCalling: true,
  webSearch: false,
  structuredOutput: true
}

function connection(): ProviderConnection {
  return {
    id: 'connection-openai',
    providerId: 'openai',
    displayName: 'OpenAI 主连接',
    protocolType: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    credentialRef: 'openai:primary',
    enabled: true,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  }
}

function profile(): ModelProfile {
  return {
    id: 'profile-primary',
    connectionId: 'connection-openai',
    modelId: 'manual-model-id',
    displayName: '主要模型',
    alias: '主力',
    capabilities,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  }
}

describe('provider configuration repositories', () => {
  it('creates and reads a connection with only its credential reference', () => {
    const initialized = initializePersistence({ appDataDirectory: temporaryDirectory() })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    const repository = initialized.value.repositories.providerConnections
    expect(repository.create(connection()).ok).toBe(true)
    const stored = repository.findById('connection-openai')

    expect(stored).toEqual({ ok: true, value: connection() })
    expect(stored.ok && stored.value?.credentialRef).toBe('openai:primary')
    expect(stored.ok && stored.value).not.toHaveProperty('apiKey')
    expect(stored.ok && stored.value).not.toHaveProperty('token')
    expect(stored.ok && stored.value).not.toHaveProperty('secret')

    const columns = initialized.value.database.all<{ name: string }>('PRAGMA table_info(provider_connections)')
    expect(columns.ok && columns.value.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['api_key', 'token', 'secret'])
    )
    initialized.value.database.close()
  })

  it('supports connection and model profile CRUD with cascade deletion', () => {
    const initialized = initializePersistence({ appDataDirectory: temporaryDirectory() })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return

    const connections = initialized.value.repositories.providerConnections
    const profiles = initialized.value.repositories.modelProfiles
    const providerConnection = connection()
    const modelProfile = profile()

    expect(connections.create(providerConnection).ok).toBe(true)
    expect(profiles.create(modelProfile).ok).toBe(true)
    const disposableProfile = {
      ...modelProfile,
      id: 'profile-disposable',
      modelId: 'disposable-model',
      createdAt: '2026-07-12T00:00:01.000Z',
      updatedAt: '2026-07-12T00:00:01.000Z'
    }
    expect(profiles.create(disposableProfile).ok).toBe(true)
    expect(profiles.findById(modelProfile.id)).toEqual({ ok: true, value: modelProfile })
    expect(connections.list()).toEqual({ ok: true, value: [providerConnection] })
    expect(profiles.listByConnection(providerConnection.id)).toEqual({
      ok: true,
      value: [modelProfile, disposableProfile]
    })
    expect(profiles.delete(disposableProfile.id)).toEqual({ ok: true, value: true })
    expect(profiles.findById(disposableProfile.id)).toEqual({ ok: true, value: undefined })

    expect(connections.update({ ...providerConnection, displayName: '更新后的连接', enabled: false })).toEqual({
      ok: true,
      value: true
    })
    expect(profiles.update({ ...modelProfile, alias: '更新别名' })).toEqual({ ok: true, value: true })
    expect(connections.findById(providerConnection.id)).toMatchObject({
      ok: true,
      value: { displayName: '更新后的连接', enabled: false }
    })
    expect(profiles.findById(modelProfile.id)).toMatchObject({ ok: true, value: { alias: '更新别名' } })

    expect(connections.delete(providerConnection.id)).toEqual({ ok: true, value: true })
    expect(connections.findById(providerConnection.id)).toEqual({ ok: true, value: undefined })
    expect(profiles.findById(modelProfile.id)).toEqual({ ok: true, value: undefined })
    initialized.value.database.close()
  })

  it('provides the seven static provider presets without network access', () => {
    const presets = getProviderPresets()

    expect(presets.map((preset) => preset.providerId)).toEqual([
      'openai',
      'moonshot',
      'zhipu',
      'deepseek',
      'xiaomi-mimo',
      'alibaba-dashscope',
      'gemini'
    ])
    expect(getProviderPreset('deepseek')).toMatchObject({
      displayName: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      supportedProtocols: ['openai-chat']
    })
    expect(getProviderPreset('unknown')).toBeUndefined()
  })

  it('keeps third-party Bailian model capabilities in the offline catalog', () => {
    expect(getFallbackProviderModels('alibaba-dashscope')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'glm-5.2',
        contextWindow: 1_000_000,
        capabilities: expect.objectContaining({ reasoning: true, toolCalling: true, structuredOutput: true })
      })
    ]))
  })
})
