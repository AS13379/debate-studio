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
      'addResearchAsset', 'addTag', 'analyzeImageAsset', 'archiveDebate', 'cancelDebatePlanning', 'cancelExport', 'challengeEvidence', 'clearErrors', 'clearLogs', 'copyModelProfile', 'createDatabaseBackup', 'createDebate', 'createDefaultModelRouting', 'createMockDemoDebate', 'createOnboardingDemo', 'createPromptVersion', 'decideResearchToolCall', 'deleteCredential',
      'deleteDebate', 'deleteExport', 'deleteModelProfile', 'deleteProviderConnection', 'deleteSearchCredential', 'deleteSearchProviderConnection',
      'exportDiagnosticReport', 'exportHtml', 'exportMarkdown', 'getAppVersion', 'getCostSummary', 'getDataManagementState', 'getDebate', 'getDebateDetail', 'getDebateQuality', 'getErrorDetail', 'getLanServerStatus', 'getOnboardingState', 'getPerformanceSnapshot', 'getRecentLogs', 'getRunState', 'kickLanDevice', 'listAvailableProviderModels', 'listDebateTurns', 'listDebateTurnsPage', 'listDebateQuality', 'listDebates',
      'listExports', 'listModelProfiles', 'listModelRoutingPolicies', 'listPromptTemplates', 'listProviderConnections', 'listProviderPresets', 'listProviderPricing', 'listRecentErrors', 'listSearchProviderConnections', 'loadDebateSetup', 'loadResearchWorkspace', 'logoutAllLanDevices', 'onLanStatusChanged', 'onPlannerProgress', 'onRunEvent', 'openExternalUrl', 'openLanPreview',
      'pauseDebate', 'planDebate', 'publishResearchEvidence', 'regenerateDebateQuality', 'removeTag', 'renameDebate', 'reopenOnboarding', 'reportRendererError', 'reportRendererPerformance', 'restoreDatabaseBackup', 'restoreDebate', 'resumeDebate', 'retryFailedTurn', 'rollbackPromptVersion', 'runMockSearch', 'saveCredential', 'saveModelProfile', 'saveModelRoutingPolicy', 'saveOnboardingDefaults', 'saveOnboardingProvider',
      'saveParticipantBindings', 'saveProviderConnection', 'saveProviderPricing', 'saveResearchRuntimeSettings', 'saveSearchCredential', 'saveSearchProviderConnection',
      'skipDebate', 'skipOnboarding', 'startDebate', 'startLanServer', 'stopDebate', 'stopLanServer', 'testConnection', 'testOnboardingConnection', 'testSearchConnection', 'toggleFavorite', 'updateEvidenceStatus', 'updateLanServerConfig'
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
