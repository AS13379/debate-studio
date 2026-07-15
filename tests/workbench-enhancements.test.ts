import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { AssetProcessor } from '../src/assets'
import { CostCalculator } from '../src/cost'
import { AdapterRegistry, MockAdapter, MockHttpTransport } from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const directories: string[] = []
const applications: DebateDesktopApplication[] = []

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local AI workbench enhancements', () => {
  it('starts new users in onboarding and keeps Mock usable after skipping', async () => {
    const app = createApplication()
    const initial = await app.onboarding.getState()
    expect(initial).toMatchObject({ ok: true, value: { status: 'pending', needsModelSetup: true } })
    expect(await app.onboarding.skip()).toEqual({ ok: true, value: true })
    const demo = await app.configuration.createMockDemoDebate()
    expect(demo.ok).toBe(true)
    expect(await app.onboarding.getState()).toMatchObject({ ok: true, value: { status: 'skipped' } })
  })

  it('saves a provider credential without returning its value or credentialRef', async () => {
    const app = createApplication()
    const recommendation = (await app.onboarding.getState())
    if (!recommendation.ok) throw new Error(recommendation.error.descriptionZh)
    const deepseek = recommendation.value.recommendations.find((item) => item.providerId === 'deepseek')!
    const secret = 'sk-unit-test-never-real'
    const saved = await app.onboarding.saveProvider({
      providerId: deepseek.providerId,
      displayName: deepseek.displayName,
      baseUrl: deepseek.defaultBaseUrl,
      modelId: deepseek.recommendedModelId,
      modelDisplayName: 'Test DeepSeek',
      apiKey: secret,
      contextWindow: deepseek.recommendedContextWindow,
      maxOutputTokens: 400,
      capabilities: deepseek.capabilities
    })
    expect(saved.ok).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(secret)
    expect(JSON.stringify(saved)).not.toContain('credentialRef')
    expect(JSON.stringify(await app.configuration.listProviderConnections())).not.toContain('credentialRef')
  })

  it('generates default role and task model configuration', async () => {
    const app = createApplication()
    const demo = await app.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)
    const profileId = demo.value.participants[0]!.modelProfileId
    expect(await app.onboarding.saveDefaultModels({ affirmative: profileId, negative: profileId, moderator: profileId })).toEqual({ ok: true, value: true })
    const state = await app.onboarding.getState()
    expect(state).toMatchObject({ ok: true, value: { defaultModels: { affirmative: profileId, negative: profileId, moderator: profileId } } })
    const policies = await app.modelRouting.listPolicies()
    expect(policies.ok && policies.value.map((item) => item.task)).toEqual(expect.arrayContaining(['debate_planning', 'research', 'argument_generation', 'rebuttal', 'judge']))
  })

  it('routes different tasks to different saved models', async () => {
    const app = createApplication()
    const demo = await app.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)
    const profileResult = app.configuration.listModelProfiles()
    if (!profileResult.ok) throw new Error(profileResult.error.descriptionZh)
    const original = profileResult.value[0]!
    const second = app.configuration.saveModelProfile({
      connectionId: original.connectionId,
      modelId: 'mock-research-model',
      displayName: 'Mock Research',
      capabilities: { textInput: true, imageInput: false, documentInput: false, audioInput: false, videoInput: false, streaming: true, reasoning: false, toolCalling: false, webSearch: false, structuredOutput: true }
    })
    if (!second.ok) throw new Error(second.error.descriptionZh)
    expect((await app.modelRouting.savePolicy('research', second.value.id)).ok).toBe(true)
    expect((await app.modelRouting.savePolicy('argument_generation', original.id)).ok).toBe(true)
    const policies = await app.modelRouting.listPolicies()
    if (!policies.ok) throw new Error(policies.error.descriptionZh)
    expect(policies.value.find((item) => item.task === 'research')?.modelProfileId).toBe(second.value.id)
    expect(policies.value.find((item) => item.task === 'argument_generation')?.modelProfileId).toBe(original.id)
  })

  it('calculates cost only when both token usage and explicit pricing exist', () => {
    const calculator = new CostCalculator()
    expect(calculator.calculate({ inputTokens: 1_000_000, outputTokens: 500_000 }, {
      id: 'price', modelProfileId: 'profile', modelId: 'model', inputPricePerMillion: 1,
      outputPricePerMillion: 4, currency: 'USD', updatedAt: '2026-07-15T00:00:00.000Z'
    })).toMatchObject({ known: true, inputCost: 1, outputCost: 2, totalCost: 3 })
    expect(calculator.calculate({ inputTokens: undefined, outputTokens: undefined })).toEqual({ known: false, reason: 'TOKEN_USAGE_UNKNOWN' })
    expect(calculator.calculate({ inputTokens: 10, outputTokens: 20 })).toEqual({ known: false, reason: 'PRICING_NOT_CONFIGURED' })
  })

  it('persists image thumbnails and PDF metadata without OCR', async () => {
    const app = createApplication({ createImageThumbnail: () => Uint8Array.from([137, 80, 78, 71]) })
    const demo = await app.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)
    const owner = demo.value.participants.find((item) => item.role === 'affirmative')!
    const image = app.research.addAsset({
      sessionId: demo.value.sessionId, ownerParticipantId: owner.id, visibility: 'affirmative-private',
      kind: 'image', title: '图片', fileName: 'image.png', mimeType: 'image/png', bytes: [137, 80, 78, 71]
    })
    expect(image).toMatchObject({ ok: true, value: { kind: 'image', hasLocalFile: true, fileMetadata: { mediaType: 'image', fileSize: 4 } } })
    if (image.ok) expect(image.value.thumbnailDataUrl).toMatch(/^data:image\/png;base64,/)
    const pdfBytes = [...new TextEncoder().encode('%PDF-1.4\n/Type /Page\n/Type /Page\n%%EOF')]
    const pdf = app.research.addAsset({
      sessionId: demo.value.sessionId, ownerParticipantId: owner.id, visibility: 'affirmative-private',
      kind: 'pdf', title: 'PDF', fileName: 'document.pdf', mimeType: 'application/pdf', bytes: pdfBytes
    })
    expect(pdf).toMatchObject({ ok: true, value: { kind: 'pdf', fileMetadata: { mediaType: 'pdf', pageCount: 2 } } })
  })

  it('blocks non-vision models and analyzes only after capability routing succeeds', async () => {
    const app = createApplication()
    const demo = await app.configuration.createMockDemoDebate()
    if (!demo.ok) throw new Error(demo.error.descriptionZh)
    const owner = demo.value.participants.find((item) => item.role === 'affirmative')!
    const asset = app.research.addAsset({
      sessionId: demo.value.sessionId, ownerParticipantId: owner.id, visibility: 'affirmative-private',
      kind: 'image', title: '图片', fileName: 'image.png', mimeType: 'image/png', bytes: [137, 80, 78, 71]
    })
    if (!asset.ok) throw new Error(asset.error.descriptionZh)
    const profile = app.configuration.listModelProfiles()
    if (!profile.ok) throw new Error(profile.error.descriptionZh)
    const textProfile = profile.value.find((item) => item.id === owner.modelProfileId)!
    const rejected = await app.modelRouting.savePolicy('vision_analysis', textProfile.id)
    expect(rejected).toMatchObject({ ok: false, error: { code: 'VISION_UNSUPPORTED' } })

    const visionProfile = app.configuration.saveModelProfile({
      connectionId: textProfile.connectionId, modelId: 'mock-vision', displayName: 'Mock Vision',
      capabilities: { ...textProfile.capabilities, imageInput: true }
    })
    if (!visionProfile.ok) throw new Error(visionProfile.error.descriptionZh)
    expect((await app.modelRouting.savePolicy('vision_analysis', visionProfile.value.id)).ok).toBe(true)
    const analyzed = await app.research.analyzeImageAsset(asset.value.id)
    expect(analyzed).toMatchObject({ ok: true, value: { modelProfileId: visionProfile.value.id } })
  })

  it('keeps AdapterRegistry and AssetProcessor test doubles local', () => {
    const registry = new AdapterRegistry()
    const adapter = new MockAdapter()
    expect(registry.register('mock', adapter).ok).toBe(true)
    expect(registry.getAdapter('mock')).toEqual({ ok: true, value: adapter })
    const directory = temporaryDirectory()
    const processor = new AssetProcessor({ directory })
    expect(processor.process({ assetId: 'pdf', fileName: 'x.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4\n/Type /Page'), createdAt: new Date().toISOString() }).ok).toBe(true)
  })
})

function createApplication(options: { createImageThumbnail?: (bytes: Uint8Array, mimeType: string) => Uint8Array | undefined } = {}): DebateDesktopApplication {
  const directory = temporaryDirectory()
  const result = initializeDebateDesktopApplication({
    appDataDirectory: directory,
    credentialStore: new MemoryCredentialStore(),
    openAITransport: new MockHttpTransport(),
    mockAdapter: new MockAdapter({ chunks: ['Mock'] }),
    createImageThumbnail: options.createImageThumbnail
  })
  if (!result.ok) throw new Error(result.error.message)
  applications.push(result.value)
  return result.value
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'debate-workbench-'))
  directories.push(directory)
  return directory
}
