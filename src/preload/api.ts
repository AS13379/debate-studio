import type { IpcRendererEvent } from 'electron'

import { IPC_CHANNELS, type DebateStudioApi, type RunEventDto } from '../shared/ipc-contract'

export interface IpcRendererLike {
  invoke(channel: string, input?: unknown): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: RunEventDto) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: RunEventDto) => void): void
}

export function createDebateStudioApi(ipcRenderer: IpcRendererLike): DebateStudioApi {
  return {
    getAppVersion: () => invoke(ipcRenderer, IPC_CHANNELS.getAppVersion),
    listProviderConnections: () => invoke(ipcRenderer, IPC_CHANNELS.listProviderConnections),
    listProviderPresets: () => invoke(ipcRenderer, IPC_CHANNELS.listProviderPresets),
    saveProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveProviderConnection, input),
    deleteProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteProviderConnection, input),
    listModelProfiles: () => invoke(ipcRenderer, IPC_CHANNELS.listModelProfiles),
    saveModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveModelProfile, input),
    deleteModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteModelProfile, input),
    copyModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.copyModelProfile, input),
    saveCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveCredential, input),
    deleteCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteCredential, input),
    testConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.testConnection, input),
    createDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.createDebate, input),
    saveParticipantBindings: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveParticipantBindings, input),
    createMockDemoDebate: () => invoke(ipcRenderer, IPC_CHANNELS.createMockDemoDebate),
    startDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.startDebate, input),
    pauseDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.pauseDebate, input),
    resumeDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.resumeDebate, input),
    stopDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.stopDebate, input),
    retryFailedTurn: (input) => invoke(ipcRenderer, IPC_CHANNELS.retryFailedTurn, input),
    getRunState: (input) => invoke(ipcRenderer, IPC_CHANNELS.getRunState, input),
    listDebates: () => invoke(ipcRenderer, IPC_CHANNELS.listDebates),
    getDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.getDebate, input),
    listDebateTurns: (input) => invoke(ipcRenderer, IPC_CHANNELS.listDebateTurns, input),
    loadDebateSetup: (input) => invoke(ipcRenderer, IPC_CHANNELS.loadDebateSetup, input),
    loadResearchWorkspace: (input) => invoke(ipcRenderer, IPC_CHANNELS.loadResearchWorkspace, input),
    addResearchAsset: (input) => invoke(ipcRenderer, IPC_CHANNELS.addResearchAsset, input),
    publishResearchEvidence: (input) => invoke(ipcRenderer, IPC_CHANNELS.publishResearchEvidence, input),
    challengeEvidence: (input) => invoke(ipcRenderer, IPC_CHANNELS.challengeEvidence, input),
    updateEvidenceStatus: (input) => invoke(ipcRenderer, IPC_CHANNELS.updateEvidenceStatus, input),
    runMockSearch: (input) => invoke(ipcRenderer, IPC_CHANNELS.runMockSearch, input),
    listSearchProviderConnections: () => invoke(ipcRenderer, IPC_CHANNELS.listSearchProviderConnections),
    saveSearchProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveSearchProviderConnection, input),
    deleteSearchProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteSearchProviderConnection, input),
    saveSearchCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveSearchCredential, input),
    deleteSearchCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteSearchCredential, input),
    testSearchConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.testSearchConnection, input),
    saveResearchRuntimeSettings: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveResearchRuntimeSettings, input),
    decideResearchToolCall: (input) => invoke(ipcRenderer, IPC_CHANNELS.decideResearchToolCall, input),
    listRecentErrors: () => invoke(ipcRenderer, IPC_CHANNELS.listRecentErrors),
    getErrorDetail: (input) => invoke(ipcRenderer, IPC_CHANNELS.getErrorDetail, input),
    clearErrors: () => invoke(ipcRenderer, IPC_CHANNELS.clearErrors),
    exportDiagnosticReport: () => invoke(ipcRenderer, IPC_CHANNELS.exportDiagnosticReport),
    getRecentLogs: () => invoke(ipcRenderer, IPC_CHANNELS.getRecentLogs),
    clearLogs: () => invoke(ipcRenderer, IPC_CHANNELS.clearLogs),
    reportRendererError: (input) => invoke(ipcRenderer, IPC_CHANNELS.reportRendererError, input),
    onRunEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: RunEventDto): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.runEvent, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, wrapped)
    }
  }
}

function invoke<T>(ipcRenderer: IpcRendererLike, channel: string, input?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, input) as Promise<T>
}
