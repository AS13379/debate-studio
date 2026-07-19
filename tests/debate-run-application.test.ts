import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DebateRunApplication,
  initializeDebateRunApplication,
  type DebateRunEvent
} from '../src/application'
import type { DebateParticipantConfig, DebateParticipantRole } from '../src/participant-config'
import { initializePersistence, type PersistenceContext } from '../src/persistence'
import type { ModelCapabilities, ModelProfile, ProviderConnection } from '../src/provider-config'
import {
  MockHttpTransport,
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from '../src/providers'
import { MemoryCredentialStore } from '../src/security'

const temporaryDirectories: string[] = []
const applications: DebateRunApplication[] = []
const timestamp = '2026-07-13T00:00:00.000Z'
const requiredRoles = ['affirmative', 'negative', 'moderator'] as const

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

type AdapterBehavior = 'success' | 'fail' | 'interrupt' | 'waitForAbort' | 'streamThenWaitForAbort'

class ScriptedAdapter implements ModelAdapter {
  readonly requests: UnifiedRequest[] = []
  abortedRequests = 0

  constructor(private readonly behaviors: AdapterBehavior[] = []) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    let response: UnifiedResponse | undefined
    for await (const event of this.stream(request)) {
      if (event.type === 'error') throw new ModelAdapterError(event.error)
      if (event.type === 'completed') response = event.response
    }
    if (!response) throw new Error('ScriptedAdapter returned no response.')
    return response
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    this.requests.push(request)
    const behavior = this.behaviors.shift() ?? 'success'
    yield { type: 'started', requestId: request.requestId }

    if (behavior === 'waitForAbort' || behavior === 'streamThenWaitForAbort') {
      if (behavior === 'streamThenWaitForAbort') {
        yield { type: 'textDelta', requestId: request.requestId, delta: '节流保存的部分文本' }
      }
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve()
        request.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      this.abortedRequests += 1
      yield {
        type: 'error',
        requestId: request.requestId,
        error: { code: 'CANCELLED', message: 'Mock request was cancelled.', retryable: true }
      }
      return
    }

    if (behavior === 'fail') {
      yield {
        type: 'error',
        requestId: request.requestId,
        error: { code: 'REQUEST_FAILED', message: '模拟运行失败', retryable: true }
      }
      return
    }

    if (behavior === 'interrupt') {
      yield { type: 'textDelta', requestId: request.requestId, delta: '流中断前收到的部分文本' }
      yield {
        type: 'error',
        requestId: request.requestId,
        error: {
          code: 'REQUEST_FAILED',
          failureCode: 'STREAM_INTERRUPTED',
          message: 'SSE stream ended before [DONE].',
          titleZh: 'SSE 流中断',
          descriptionZh: '服务商在完成标记到达前关闭了流式连接，已收到的部分文本已保留。',
          retryable: true,
          suggestedActionZh: '重试当前 Turn。',
          technicalDetails: 'transportCode=STREAM_INTERRUPTED'
        }
      }
      return
    }

    const chunks = [`${request.stage}:`, '模拟发言']
    let content = ''
    yield { type: 'reasoningDelta', requestId: request.requestId, delta: '仅用于实时界面的思考标记' }
    for (const delta of chunks) {
      content += delta
      yield { type: 'textDelta', requestId: request.requestId, delta }
    }
    yield {
      type: 'completed',
      response: { requestId: request.requestId, content, finishReason: 'stop' }
    }
  }
}

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-run-application-'))
  temporaryDirectories.push(path)
  return path
}

function seedSetup(
  appDataDirectory: string,
  options: {
    sessionStatus?: string
    currentStage?: string
    roles?: readonly DebateParticipantRole[]
    interruptedTurn?: boolean
    interruptedTurnStatus?: 'running' | 'streaming'
  } = {}
): void {
  const initialized = initializePersistence({ appDataDirectory })
  if (!initialized.ok) throw initialized.error
  const { database, repositories } = initialized.value
  const sessionStatus = options.sessionStatus ?? 'draft'
  const currentStage = options.currentStage ?? 'draft'
  const roles = options.roles ?? requiredRoles

  const debate = repositories.debates.save({
    id: 'debate-headless',
    topic: '无 UI 能否完成一场辩论？',
    status: sessionStatus,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  if (!debate.ok) throw debate.error
  const session = database.run(
    `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'session-headless',
    'debate-headless',
    sessionStatus,
    currentStage,
    timestamp,
    timestamp
  )
  if (!session.ok) throw session.error

  const connection: ProviderConnection = {
    id: 'connection-mock',
    providerId: 'mock',
    displayName: 'Headless Mock',
    protocolType: 'mock',
    baseUrl: 'https://mock.invalid',
    credentialRef: 'mock:no-key-read',
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const connectionSaved = repositories.providerConnections.create(connection)
  if (!connectionSaved.ok) throw connectionSaved.error

  for (const role of roles) {
    const profile: ModelProfile = {
      id: `profile-${role}`,
      connectionId: connection.id,
      modelId: `mock-${role}`,
      displayName: `${role} model`,
      capabilities,
      contextWindow: 32_000,
      maxOutputTokens: 512,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const profileSaved = repositories.modelProfiles.create(profile)
    if (!profileSaved.ok) throw profileSaved.error
    const participant: DebateParticipantConfig = {
      id: `participant-${role}`,
      sessionId: 'session-headless',
      role,
      modelProfileId: profile.id,
      displayName: `${role} participant`,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const participantSaved = repositories.participants.create(participant)
    if (!participantSaved.ok) throw participantSaved.error
  }

  if (options.interruptedTurn) {
    const turn = repositories.turns.create({
      id: 'turn-before-restart',
      sessionId: 'session-headless',
      participantId: 'participant-moderator',
      stage: currentStage,
      status: options.interruptedTurnStatus ?? 'streaming',
      content: '已经保存的部分文本',
      createdAt: timestamp
    })
    if (!turn.ok) throw turn.error
  }

  const closed = database.close()
  if (!closed.ok) throw closed.error
}

function createApplication(
  appDataDirectory: string,
  adapter: ModelAdapter,
  streamWriteThrottleMs = 0
): DebateRunApplication {
  const initialized = initializeDebateRunApplication({
    appDataDirectory,
    mockAdapter: adapter,
    openAITransport: new MockHttpTransport(),
    credentialStore: new MemoryCredentialStore(),
    streamWriteThrottleMs
  })
  if (!initialized.ok) throw initialized.error
  applications.push(initialized.value)
  return initialized.value
}

function inspectDatabase(appDataDirectory: string): PersistenceContext {
  const initialized = initializePersistence({ appDataDirectory })
  if (!initialized.ok) throw initialized.error
  return initialized.value
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out while waiting for the headless adapter.')
}

afterEach(async () => {
  for (const app of applications.splice(0)) await app.close()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('DebateRunApplication headless integration', () => {
  it('runs a complete debate and persists every Turn, Event and Usage record', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter()
    const app = createApplication(appDataDirectory, adapter)
    const receivedEvents: DebateRunEvent[] = []
    app.subscribe((event) => receivedEvents.push(event))

    const result = await app.start('session-headless')

    expect(result).toMatchObject({ ok: true, state: { status: 'completed', currentStage: 'completed', active: false } })
    expect(adapter.requests).toHaveLength(20)
    expect(adapter.requests.every((request) => !('apiKey' in request) && !('credentialRef' in request))).toBe(true)
    await app.close()

    const inspected = inspectDatabase(appDataDirectory)
    const turns = inspected.repositories.turns.listBySession('session-headless')
    const events = inspected.repositories.events.listBySession('session-headless')
    const usage = inspected.repositories.usage.listBySession('session-headless')
    expect(turns.ok && turns.value).toHaveLength(20)
    expect(turns.ok && turns.value.every((turn) => turn.status === 'completed' && Boolean(turn.content))).toBe(true)
    expect(receivedEvents.some((event) => event.type === 'turnReasoningUpdated')).toBe(true)
    expect(events.ok && events.value.map((event) => event.id)).toEqual(
      receivedEvents.filter((event) => event.type !== 'turnReasoningUpdated').map((event) => event.id)
    )
    expect(events.ok && events.value.map((event) => event.type)).toEqual(expect.arrayContaining([
      'stateChanged',
      'turnStarted',
      'turnUpdated',
      'turnCompleted',
      'sessionCompleted'
    ]))
    expect(JSON.stringify(turns)).not.toContain('mock:no-key-read')
    expect(JSON.stringify(events)).not.toContain('mock:no-key-read')
    expect(JSON.stringify(usage)).not.toContain('mock:no-key-read')
    expect(JSON.stringify(turns)).not.toContain('仅用于实时界面的思考标记')
    expect(JSON.stringify(events)).not.toContain('仅用于实时界面的思考标记')
    expect(usage.ok && usage.value).toHaveLength(20)
    inspected.database.close()
  })

  it('pauses by cancelling the active request and does not advance', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['waitForAbort'])
    const app = createApplication(appDataDirectory, adapter)
    const pending = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)

    const paused = await app.pause('session-headless')
    await pending

    expect(paused).toMatchObject({ ok: true, state: { status: 'paused', currentStage: 'validating' } })
    expect(adapter.abortedRequests).toBe(1)
    expect(adapter.requests).toHaveLength(1)
    expect(app.getRunState('session-headless')).toMatchObject({
      ok: true,
      state: { lastTurn: { status: 'cancelled', content: '' } }
    })
  })

  it('resumes a paused session and completes from the same stage', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['waitForAbort'])
    const app = createApplication(appDataDirectory, adapter)
    const pending = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)
    await app.pause('session-headless')
    await pending

    const resumed = await app.resume('session-headless')

    expect(resumed).toMatchObject({ ok: true, state: { status: 'completed', currentStage: 'completed' } })
    expect(adapter.requests).toHaveLength(21)
  })

  it('throttles streaming text writes and force-saves the partial text when cancelled', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['streamThenWaitForAbort'])
    const app = createApplication(appDataDirectory, adapter, 5)
    const pending = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)
    await waitFor(() => {
      const state = app.getRunState('session-headless')
      return state.ok && state.state.lastTurn?.content === '节流保存的部分文本'
    })

    await app.pause('session-headless')
    await pending

    expect(app.getRunState('session-headless')).toMatchObject({
      ok: true,
      state: {
        status: 'paused',
        lastTurn: { status: 'cancelled', content: '节流保存的部分文本' }
      }
    })
  })

  it('keeps partial text and structured recovery details after an SSE interruption', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const app = createApplication(appDataDirectory, new ScriptedAdapter(['interrupt']))

    const result = await app.start('session-headless')

    expect(result).toMatchObject({
      ok: true,
      state: {
        status: 'failed',
        currentStage: 'validating',
        lastTurn: {
          status: 'failed',
          content: '流中断前收到的部分文本',
          failure: {
            code: 'STREAM_INTERRUPTED',
            titleZh: 'SSE 流中断',
            retryable: true
          }
        }
      }
    })
  })

  it('stops the active session and never calls the Adapter again', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['waitForAbort'])
    const app = createApplication(appDataDirectory, adapter)
    const pending = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)

    const stopped = await app.stop('session-headless')
    await pending
    const callsAtStop = adapter.requests.length
    const rejectedResume = await app.resume('session-headless')

    expect(stopped).toMatchObject({ ok: true, state: { status: 'stopped' } })
    expect(rejectedResume).toMatchObject({ ok: false, error: { code: 'INVALID_RUN_STATE' } })
    expect(adapter.requests).toHaveLength(callsAtStop)
  })

  it('keeps a failed Turn and creates a linked replacement when retrying', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['fail'])
    const app = createApplication(appDataDirectory, adapter)

    const failed = await app.start('session-headless')
    const retried = await app.retryFailedTurn('session-headless')

    expect(failed).toMatchObject({ ok: true, state: { status: 'failed', lastTurn: { status: 'failed' } } })
    expect(retried).toMatchObject({ ok: true, state: { status: 'completed' } })
    await app.close()

    const inspected = inspectDatabase(appDataDirectory)
    const turns = inspected.repositories.turns.listBySession('session-headless')
    expect(turns.ok).toBe(true)
    if (turns.ok) {
      expect(turns.value).toHaveLength(21)
      const original = turns.value[0]
      const replacement = turns.value[1]
      expect(original).toMatchObject({ status: 'failed', error: '模拟运行失败' })
      expect(replacement).toMatchObject({ status: 'completed', retryOfTurnId: original.id })
      expect(replacement.id).not.toBe(original.id)
    }
    inspected.database.close()
  })

  it.each(['running', 'streaming'] as const)(
    'marks %s records interrupted on restart without calling the Adapter',
    async (inProgressStatus) => {
      const appDataDirectory = temporaryDirectory()
      seedSetup(appDataDirectory, {
        sessionStatus: inProgressStatus,
        currentStage: 'validating',
        interruptedTurn: true,
        interruptedTurnStatus: inProgressStatus
      })
      const adapter = new ScriptedAdapter()
      const app = createApplication(appDataDirectory, adapter)

      const recovered = app.getRunState('session-headless')

      expect(recovered).toMatchObject({
        ok: true,
        state: {
          status: 'interrupted',
          currentStage: 'validating',
          active: false,
          lastTurn: { status: 'interrupted', content: '已经保存的部分文本' }
        }
      })
      expect(adapter.requests).toHaveLength(0)

      const retried = await app.retryFailedTurn('session-headless')
      expect(retried).toMatchObject({ ok: true, state: { status: 'completed' } })
    }
  )

  it('rejects a second concurrent start for the same Session', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['waitForAbort'])
    const app = createApplication(appDataDirectory, adapter)
    const first = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)

    const second = await app.start('session-headless')

    expect(second).toMatchObject({ ok: false, error: { code: 'SESSION_ALREADY_RUNNING' } })
    await app.stop('session-headless')
    await first
  })

  it('cancels every in-flight request when the application closes', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory)
    const adapter = new ScriptedAdapter(['waitForAbort'])
    const app = createApplication(appDataDirectory, adapter)
    const pending = app.start('session-headless')
    await waitFor(() => adapter.requests.length === 1)

    const closed = await app.close()
    await pending

    expect(closed).toEqual({ ok: true, value: undefined })
    expect(adapter.abortedRequests).toBe(1)
    expect(app.getRunState('session-headless')).toMatchObject({
      ok: false,
      error: { code: 'APPLICATION_CLOSED' }
    })
  })

  it('does not create or call a Runner when RuntimePreparation fails', async () => {
    const appDataDirectory = temporaryDirectory()
    seedSetup(appDataDirectory, { roles: ['moderator'] })
    const adapter = new ScriptedAdapter()
    const app = createApplication(appDataDirectory, adapter)

    const result = await app.start('session-headless')

    expect(result).toMatchObject({ ok: false, error: { code: 'RUNTIME_PREPARATION_FAILED' } })
    expect(adapter.requests).toHaveLength(0)
    expect(app.getRunState('session-headless')).toMatchObject({ ok: true, state: { status: 'draft' } })
  })
})
