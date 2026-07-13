import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeDebateDesktopApplication, type DebateDesktopApplication } from '../src/application'
import { registerDebateIpc, type IpcMainLike } from '../src/main/ipc-handlers'
import {
  MockHttpTransport,
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from '../src/providers'
import { MemoryCredentialStore } from '../src/security'
import { IPC_CHANNELS, type RunEventDto } from '../src/shared/ipc-contract'

const temporaryDirectories: string[] = []
const applications: DebateDesktopApplication[] = []

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()

  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }

  invoke<T>(channel: string, input?: unknown): Promise<T> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return Promise.resolve(handler({}, input) as T)
  }
}

class ControlledMockAdapter implements ModelAdapter {
  calls = 0
  aborted = 0

  constructor(private readonly waitOnCalls: number[] = []) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    let response: UnifiedResponse | undefined
    for await (const event of this.stream(request)) {
      if (event.type === 'error') throw new ModelAdapterError(event.error)
      if (event.type === 'completed') response = event.response
    }
    if (!response) throw new Error('No Mock response.')
    return response
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    this.calls += 1
    const call = this.calls
    yield { type: 'started', requestId: request.requestId }
    if (this.waitOnCalls.includes(call)) {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve()
        else request.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      this.aborted += 1
      yield {
        type: 'error',
        requestId: request.requestId,
        error: { code: 'CANCELLED', message: 'IPC Mock cancelled.', retryable: true }
      }
      return
    }
    const content = `${request.stage} 的 Mock 发言`
    yield { type: 'textDelta', requestId: request.requestId, delta: content }
    yield { type: 'completed', response: { requestId: request.requestId, content, finishReason: 'stop' } }
  }
}

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-ipc-ui-'))
  temporaryDirectories.push(path)
  return path
}

function createApplication(path: string, adapter: ModelAdapter = new ControlledMockAdapter()): DebateDesktopApplication {
  const initialized = initializeDebateDesktopApplication({
    appDataDirectory: path,
    mockAdapter: adapter,
    credentialStore: new MemoryCredentialStore(),
    openAITransport: new MockHttpTransport(),
    streamWriteThrottleMs: 0
  })
  if (!initialized.ok) throw initialized.error
  applications.push(initialized.value)
  return initialized.value
}

function register(application: DebateDesktopApplication, ipc = new FakeIpcMain()): {
  ipc: FakeIpcMain
  events: RunEventDto[]
  dispose: () => void
} {
  const events: RunEventDto[] = []
  const dispose = registerDebateIpc({
    ipcMain: ipc,
    configuration: application.configuration,
    run: application.run,
    getAppVersion: () => '0.1.0-test',
    broadcastRunEvent: (event) => events.push(event)
  })
  return { ipc, events, dispose }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for controlled IPC MockAdapter.')
}

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('typed IPC UI flow', () => {
  it('rejects invalid or extra input fields before calling the configuration application', async () => {
    const app = createApplication(temporaryDirectory())
    const { ipc, dispose } = register(app)
    const secret = 'sk-should-never-pass-validation'

    const invalid = await ipc.invoke<{ ok: boolean; error: { code: string } }>(
      IPC_CHANNELS.saveProviderConnection,
      {
        providerId: 'openai',
        displayName: 'Invalid input',
        protocolType: 'openai-chat',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
        apiKey: secret
      }
    )
    const connections = await ipc.invoke<{ ok: true; value: unknown[] }>(IPC_CHANNELS.listProviderConnections)

    expect(invalid).toMatchObject({ ok: false, error: { code: 'IPC_VALIDATION_FAILED' } })
    expect(connections.value).toEqual([])
    expect(JSON.stringify(invalid)).not.toContain(secret)
    dispose()
    expect(ipc.handlers.size).toBe(0)
  })

  it('returns only credential status over IPC when saving an API Key', async () => {
    const app = createApplication(temporaryDirectory())
    const { ipc, dispose } = register(app)
    const secret = 'sk-ipc-never-returned-123456'
    const savedConnection = await ipc.invoke<{ ok: true; value: { id: string } }>(
      IPC_CHANNELS.saveProviderConnection,
      {
        id: 'ipc-safe-connection',
        providerId: 'openai',
        displayName: 'IPC OpenAI',
        protocolType: 'openai-chat',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true
      }
    )
    const savedCredential = await ipc.invoke(
      IPC_CHANNELS.saveCredential,
      { connectionId: savedConnection.value.id, credential: secret }
    )
    const listed = await ipc.invoke<{ ok: true; value: unknown[] }>(IPC_CHANNELS.listProviderConnections)
    const serialized = JSON.stringify({ savedConnection, savedCredential, listed })

    expect(savedCredential).toEqual({ ok: true, value: true })
    expect(listed).toMatchObject({ ok: true, value: [{ credentialConfigured: true }] })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('credentialRef')
    dispose()
  })

  it('creates and completes the Mock demo through UI commands, broadcasts deltas, and reloads Turns from SQLite', async () => {
    const path = temporaryDirectory()
    const firstApplication = createApplication(path)
    const first = register(firstApplication)

    const demo = await first.ipc.invoke<{ ok: true; value: { sessionId: string } }>(IPC_CHANNELS.createMockDemoDebate)
    const completed = await first.ipc.invoke<{ ok: boolean; state: { status: string } }>(
      IPC_CHANNELS.startDebate,
      { sessionId: demo.value.sessionId }
    )
    const turns = await first.ipc.invoke<{ ok: true; value: unknown[] }>(
      IPC_CHANNELS.listDebateTurns,
      { sessionId: demo.value.sessionId }
    )

    expect(completed).toMatchObject({ ok: true, state: { status: 'completed' } })
    expect(turns.value).toHaveLength(8)
    expect(first.events.some((event) => event.type === 'turnUpdated')).toBe(true)
    expect(first.events.at(-1)?.type).toBe('sessionCompleted')
    first.dispose()
    await firstApplication.close()

    const reopenedApplication = createApplication(path)
    const reopened = register(reopenedApplication)
    const restoredTurns = await reopened.ipc.invoke<{ ok: true; value: Array<{ content?: string }> }>(
      IPC_CHANNELS.listDebateTurns,
      { sessionId: demo.value.sessionId }
    )
    expect(restoredTurns.value).toHaveLength(8)
    expect(restoredTurns.value.every((turn) => Boolean(turn.content))).toBe(true)
    reopened.dispose()
  })

  it('passes pause and resume commands to the active SessionRunner', async () => {
    const adapter = new ControlledMockAdapter([1])
    const app = createApplication(temporaryDirectory(), adapter)
    const { ipc, dispose } = register(app)
    const demo = await ipc.invoke<{ ok: true; value: { sessionId: string } }>(IPC_CHANNELS.createMockDemoDebate)
    const running = ipc.invoke(IPC_CHANNELS.startDebate, { sessionId: demo.value.sessionId })
    await waitFor(() => adapter.calls === 1)

    const paused = await ipc.invoke<{ ok: boolean; state: { status: string } }>(
      IPC_CHANNELS.pauseDebate,
      { sessionId: demo.value.sessionId }
    )
    await running
    const resumed = await ipc.invoke<{ ok: boolean; state: { status: string } }>(
      IPC_CHANNELS.resumeDebate,
      { sessionId: demo.value.sessionId }
    )

    expect(paused).toMatchObject({ ok: true, state: { status: 'paused' } })
    expect(resumed).toMatchObject({ ok: true, state: { status: 'completed' } })
    expect(adapter.aborted).toBe(1)
    expect(adapter.calls).toBe(9)
    dispose()
  })

  it('passes stop and prevents any later Adapter call', async () => {
    const adapter = new ControlledMockAdapter([1])
    const app = createApplication(temporaryDirectory(), adapter)
    const { ipc, dispose } = register(app)
    const demo = await ipc.invoke<{ ok: true; value: { sessionId: string } }>(IPC_CHANNELS.createMockDemoDebate)
    const running = ipc.invoke(IPC_CHANNELS.startDebate, { sessionId: demo.value.sessionId })
    await waitFor(() => adapter.calls === 1)

    const stopped = await ipc.invoke<{ ok: boolean; state: { status: string } }>(
      IPC_CHANNELS.stopDebate,
      { sessionId: demo.value.sessionId }
    )
    await running
    const callsAtStop = adapter.calls

    expect(stopped).toMatchObject({ ok: true, state: { status: 'stopped' } })
    expect(adapter.calls).toBe(callsAtStop)
    expect(adapter.aborted).toBe(1)
    dispose()
  })
})
