import { describe, expect, it } from 'vitest'

import { createDebateStudioApi, type IpcRendererLike } from '../src/preload/api'
import { IPC_CHANNELS, type RunEventDto } from '../src/shared/ipc-contract'

class RecordingIpcRenderer implements IpcRendererLike {
  readonly invocations: Array<{ channel: string; input?: unknown }> = []
  listener?: (event: never, payload: RunEventDto) => void
  removedListener?: (event: never, payload: RunEventDto) => void

  async invoke(channel: string, input?: unknown): Promise<unknown> {
    this.invocations.push({ channel, input })
    return { ok: true, value: [] }
  }

  on(_channel: string, listener: (event: never, payload: RunEventDto) => void): void {
    this.listener = listener
  }

  removeListener(_channel: string, listener: (event: never, payload: RunEventDto) => void): void {
    this.removedListener = listener
  }
}

describe('preload DebateStudioApi', () => {
  it('exposes only the explicit method whitelist', () => {
    const api = createDebateStudioApi(new RecordingIpcRenderer())

    expect(Object.keys(api).sort()).toEqual([
      'addResearchAsset', 'challengeEvidence', 'copyModelProfile', 'createDebate', 'createMockDemoDebate', 'decideResearchToolCall', 'deleteCredential',
      'deleteModelProfile', 'deleteProviderConnection', 'deleteSearchCredential', 'deleteSearchProviderConnection',
      'getAppVersion', 'getDebate', 'getRunState', 'listDebateTurns', 'listDebates',
      'listModelProfiles', 'listProviderConnections', 'listProviderPresets', 'listSearchProviderConnections', 'loadDebateSetup', 'loadResearchWorkspace', 'onRunEvent',
      'pauseDebate', 'publishResearchEvidence', 'resumeDebate', 'retryFailedTurn', 'runMockSearch', 'saveCredential', 'saveModelProfile',
      'saveParticipantBindings', 'saveProviderConnection', 'saveResearchRuntimeSettings', 'saveSearchCredential', 'saveSearchProviderConnection',
      'startDebate', 'stopDebate', 'testConnection', 'testSearchConnection', 'updateEvidenceStatus'
    ].sort())
    expect(api).not.toHaveProperty('invoke')
    expect(api).not.toHaveProperty('getCredential')
  })

  it('subscribes to the single run event channel and removes the exact wrapped listener', () => {
    const ipc = new RecordingIpcRenderer()
    const api = createDebateStudioApi(ipc)
    const received: RunEventDto[] = []
    const unsubscribe = api.onRunEvent((event) => received.push(event))
    const event: RunEventDto = {
      id: 'event-1',
      type: 'sessionPaused',
      sessionId: 'session-1',
      createdAt: '2026-07-13T00:00:00.000Z'
    }

    ipc.listener?.(undefined as never, event)
    unsubscribe()

    expect(received).toEqual([event])
    expect(ipc.removedListener).toBe(ipc.listener)
    expect(IPC_CHANNELS.runEvent).toBe('run:event')
  })
})
