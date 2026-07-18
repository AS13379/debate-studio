import type { IpcRendererEvent } from 'electron'

import { IPC_CHANNELS, type DebatePlannerProgressDto, type DebateStudioApi, type RunEventDto } from '../shared/ipc-contract'

export interface IpcRendererLike {
  invoke(channel: string, input?: unknown): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: RunEventDto | DebatePlannerProgressDto) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: RunEventDto | DebatePlannerProgressDto) => void): void
}

export function createDebateStudioApi(ipcRenderer: IpcRendererLike): DebateStudioApi {
  return {
    getAppVersion: () => invoke(ipcRenderer, IPC_CHANNELS.getAppVersion),
    openExternalUrl: (input) => invoke(ipcRenderer, IPC_CHANNELS.openExternalUrl, input),
    getOnboardingState: () => invoke(ipcRenderer, IPC_CHANNELS.getOnboardingState),
    saveOnboardingProvider: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveOnboardingProvider, input),
    testOnboardingConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.testOnboardingConnection, input),
    saveOnboardingDefaults: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveOnboardingDefaults, input),
    createOnboardingDemo: () => invoke(ipcRenderer, IPC_CHANNELS.createOnboardingDemo),
    skipOnboarding: () => invoke(ipcRenderer, IPC_CHANNELS.skipOnboarding),
    reopenOnboarding: () => invoke(ipcRenderer, IPC_CHANNELS.reopenOnboarding),
    listModelRoutingPolicies: () => invoke(ipcRenderer, IPC_CHANNELS.listModelRoutingPolicies),
    saveModelRoutingPolicy: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveModelRoutingPolicy, input),
    createDefaultModelRouting: () => invoke(ipcRenderer, IPC_CHANNELS.createDefaultModelRouting),
    listProviderPricing: () => invoke(ipcRenderer, IPC_CHANNELS.listProviderPricing),
    saveProviderPricing: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveProviderPricing, input),
    getCostSummary: () => invoke(ipcRenderer, IPC_CHANNELS.getCostSummary),
    listPromptTemplates: () => invoke(ipcRenderer, IPC_CHANNELS.listPromptTemplates),
    createPromptVersion: (input) => invoke(ipcRenderer, IPC_CHANNELS.createPromptVersion, input),
    rollbackPromptVersion: (input) => invoke(ipcRenderer, IPC_CHANNELS.rollbackPromptVersion, input),
    getDebateQuality: (input) => invoke(ipcRenderer, IPC_CHANNELS.getDebateQuality, input),
    listDebateQuality: () => invoke(ipcRenderer, IPC_CHANNELS.listDebateQuality),
    regenerateDebateQuality: (input) => invoke(ipcRenderer, IPC_CHANNELS.regenerateDebateQuality, input),
    listProviderConnections: () => invoke(ipcRenderer, IPC_CHANNELS.listProviderConnections),
    listProviderPresets: () => invoke(ipcRenderer, IPC_CHANNELS.listProviderPresets),
    saveProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveProviderConnection, input),
    deleteProviderConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteProviderConnection, input),
    listModelProfiles: () => invoke(ipcRenderer, IPC_CHANNELS.listModelProfiles),
    listAvailableProviderModels: (input) => invoke(ipcRenderer, IPC_CHANNELS.listAvailableProviderModels, input),
    saveModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveModelProfile, input),
    deleteModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteModelProfile, input),
    copyModelProfile: (input) => invoke(ipcRenderer, IPC_CHANNELS.copyModelProfile, input),
    saveCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveCredential, input),
    deleteCredential: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteCredential, input),
    testConnection: (input) => invoke(ipcRenderer, IPC_CHANNELS.testConnection, input),
    planDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.planDebate, input),
    cancelDebatePlanning: (input) => invoke(ipcRenderer, IPC_CHANNELS.cancelDebatePlanning, input),
    createDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.createDebate, input),
    saveParticipantBindings: (input) => invoke(ipcRenderer, IPC_CHANNELS.saveParticipantBindings, input),
    createMockDemoDebate: () => invoke(ipcRenderer, IPC_CHANNELS.createMockDemoDebate),
    startDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.startDebate, input),
    pauseDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.pauseDebate, input),
    resumeDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.resumeDebate, input),
    stopDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.stopDebate, input),
    skipDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.skipDebate, input),
    retryFailedTurn: (input) => invoke(ipcRenderer, IPC_CHANNELS.retryFailedTurn, input),
    getRunState: (input) => invoke(ipcRenderer, IPC_CHANNELS.getRunState, input),
    listDebates: (input) => invoke(ipcRenderer, IPC_CHANNELS.listDebates, input),
    getDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.getDebate, input),
    getDebateDetail: (input) => invoke(ipcRenderer, IPC_CHANNELS.getDebateDetail, input),
    renameDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.renameDebate, input),
    toggleFavorite: (input) => invoke(ipcRenderer, IPC_CHANNELS.toggleFavorite, input),
    addTag: (input) => invoke(ipcRenderer, IPC_CHANNELS.addTag, input),
    removeTag: (input) => invoke(ipcRenderer, IPC_CHANNELS.removeTag, input),
    archiveDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.archiveDebate, input),
    restoreDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.restoreDebate, input),
    deleteDebate: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteDebate, input),
    listDebateTurns: (input) => invoke(ipcRenderer, IPC_CHANNELS.listDebateTurns, input),
    listDebateTurnsPage: (input) => invoke(ipcRenderer, IPC_CHANNELS.listDebateTurnsPage, input),
    loadDebateSetup: (input) => invoke(ipcRenderer, IPC_CHANNELS.loadDebateSetup, input),
    loadResearchWorkspace: (input) => invoke(ipcRenderer, IPC_CHANNELS.loadResearchWorkspace, input),
    addResearchAsset: (input) => invoke(ipcRenderer, IPC_CHANNELS.addResearchAsset, input),
    analyzeImageAsset: (input) => invoke(ipcRenderer, IPC_CHANNELS.analyzeImageAsset, input),
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
    reportRendererPerformance: (input) => invoke(ipcRenderer, IPC_CHANNELS.reportRendererPerformance, input),
    getPerformanceSnapshot: () => invoke(ipcRenderer, IPC_CHANNELS.getPerformanceSnapshot),
    getDataManagementState: () => invoke(ipcRenderer, IPC_CHANNELS.getDataManagementState),
    createDatabaseBackup: () => invoke(ipcRenderer, IPC_CHANNELS.createDatabaseBackup),
    restoreDatabaseBackup: (input) => invoke(ipcRenderer, IPC_CHANNELS.restoreDatabaseBackup, input),
    exportMarkdown: (input) => invoke(ipcRenderer, IPC_CHANNELS.exportMarkdown, input),
    exportHtml: (input) => invoke(ipcRenderer, IPC_CHANNELS.exportHtml, input),
    listExports: () => invoke(ipcRenderer, IPC_CHANNELS.listExports),
    deleteExport: (input) => invoke(ipcRenderer, IPC_CHANNELS.deleteExport, input),
    cancelExport: (input) => invoke(ipcRenderer, IPC_CHANNELS.cancelExport, input),
    onRunEvent: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: RunEventDto | DebatePlannerProgressDto): void => listener(payload as RunEventDto)
      ipcRenderer.on(IPC_CHANNELS.runEvent, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.runEvent, wrapped)
    },
    onPlannerProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: RunEventDto | DebatePlannerProgressDto): void => listener(payload as DebatePlannerProgressDto)
      ipcRenderer.on(IPC_CHANNELS.plannerProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.plannerProgress, wrapped)
    }
  }
}

function invoke<T>(ipcRenderer: IpcRendererLike, channel: string, input?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, input) as Promise<T>
}
