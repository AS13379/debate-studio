import type {
  ConfigurationResultDto,
  ConnectionTestDto,
  CreateDebateInput,
  DebateDetailDto,
  DebateParticipantRoleDto,
  DebateSetupDto,
  DebateSummaryDto,
  DebateTurnDto,
  DebateTurnPageDto,
  DebateTurnPageInputDto,
  ModelProfileDto,
  ProviderPresetDto,
  ProviderConnectionDto,
  SaveModelProfileInput,
  SaveParticipantBindingsInput,
  SaveProviderConnectionInput
} from './debate-dtos'
import type {
  AddResearchAssetInput,
  ChallengeEvidenceInput,
  PublishEvidenceInput,
  ResearchAssetDto,
  ResearchResultDto,
  ResearchRuntimeSettingsInput,
  ResearchWorkspaceDto,
  RunMockSearchInput,
  SaveSearchProviderConnectionInput,
  SearchProviderConnectionDto,
  UpdateEvidenceStatusInput
} from './research-dtos'
import type {
  DiagnosticExportDto,
  DiagnosticsResultDto,
  ErrorRecordDto,
  LogEntryDto,
  PerformanceSnapshotDto,
  RendererErrorInputDto,
  RendererPerformanceInputDto
} from './diagnostics-dtos'
import type {
  DebateHistoryDetailDto,
  DebateHistoryListQueryDto,
  DebateHistoryResultDto,
  DebateHistorySummaryDto,
  DebateTagInputDto,
  DeleteDebateInputDto,
  RenameDebateInputDto,
  ToggleFavoriteInputDto
} from './history-dtos'
import type {
  DebateExportRecordDto,
  DebateExportResultDto,
  CancelExportInputDto,
  DeleteExportInputDto,
  ExportDebateInputDto
} from './export-dtos'
import type {
  DatabaseBackupDto,
  DataManagementResultDto,
  DataManagementStateDto,
  RestoreDatabaseBackupInputDto,
  RestoreDatabaseBackupResultDto
} from './data-management-dtos'

export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  listProviderConnections: 'configuration:list-provider-connections',
  listProviderPresets: 'configuration:list-provider-presets',
  saveProviderConnection: 'configuration:save-provider-connection',
  deleteProviderConnection: 'configuration:delete-provider-connection',
  listModelProfiles: 'configuration:list-model-profiles',
  saveModelProfile: 'configuration:save-model-profile',
  deleteModelProfile: 'configuration:delete-model-profile',
  copyModelProfile: 'configuration:copy-model-profile',
  saveCredential: 'configuration:save-credential',
  deleteCredential: 'configuration:delete-credential',
  testConnection: 'configuration:test-connection',
  createDebate: 'configuration:create-debate',
  saveParticipantBindings: 'configuration:save-participant-bindings',
  createMockDemoDebate: 'configuration:create-mock-demo-debate',
  startDebate: 'run:start-debate',
  pauseDebate: 'run:pause-debate',
  resumeDebate: 'run:resume-debate',
  stopDebate: 'run:stop-debate',
  retryFailedTurn: 'run:retry-failed-turn',
  getRunState: 'run:get-state',
  listDebates: 'query:list-debates',
  getDebate: 'query:get-debate',
  getDebateDetail: 'history:get-debate-detail',
  renameDebate: 'history:rename-debate',
  toggleFavorite: 'history:toggle-favorite',
  addTag: 'history:add-tag',
  removeTag: 'history:remove-tag',
  archiveDebate: 'history:archive-debate',
  restoreDebate: 'history:restore-debate',
  deleteDebate: 'history:delete-debate',
  listDebateTurns: 'query:list-debate-turns',
  listDebateTurnsPage: 'query:list-debate-turns-page',
  loadDebateSetup: 'query:load-debate-setup',
  loadResearchWorkspace: 'research:load-workspace',
  addResearchAsset: 'research:add-asset',
  publishResearchEvidence: 'research:publish-evidence',
  challengeEvidence: 'research:challenge-evidence',
  updateEvidenceStatus: 'research:update-evidence-status',
  runMockSearch: 'research:run-mock-search',
  listSearchProviderConnections: 'research:list-search-provider-connections',
  saveSearchProviderConnection: 'research:save-search-provider-connection',
  deleteSearchProviderConnection: 'research:delete-search-provider-connection',
  saveSearchCredential: 'research:save-search-credential',
  deleteSearchCredential: 'research:delete-search-credential',
  testSearchConnection: 'research:test-search-connection',
  saveResearchRuntimeSettings: 'research:save-runtime-settings',
  decideResearchToolCall: 'research:decide-tool-call',
  listRecentErrors: 'diagnostics:list-recent-errors',
  getErrorDetail: 'diagnostics:get-error-detail',
  clearErrors: 'diagnostics:clear-errors',
  exportDiagnosticReport: 'diagnostics:export-report',
  getRecentLogs: 'diagnostics:get-recent-logs',
  clearLogs: 'diagnostics:clear-logs',
  reportRendererError: 'diagnostics:report-renderer-error',
  reportRendererPerformance: 'diagnostics:report-renderer-performance',
  getPerformanceSnapshot: 'diagnostics:get-performance-snapshot',
  getDataManagementState: 'data:get-state',
  createDatabaseBackup: 'data:create-backup',
  restoreDatabaseBackup: 'data:restore-backup',
  exportMarkdown: 'export:markdown',
  exportHtml: 'export:html',
  listExports: 'export:list',
  deleteExport: 'export:delete',
  cancelExport: 'export:cancel',
  runEvent: 'run:event'
} as const

export interface RunStateDto {
  sessionId: string
  status: string
  currentStage: string
  active: boolean
  lastTurn?: DebateTurnDto
}

export interface RunErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh?: string
  technicalDetails?: string
}

export type RunCommandResultDto =
  | { ok: true; state: RunStateDto }
  | { ok: false; error: RunErrorDto }

interface RunEventBase {
  id: string
  sessionId: string
  createdAt: string
}

export type RunEventDto =
  | (RunEventBase & { type: 'stateChanged'; state: { status: string; currentStage: string } })
  | (RunEventBase & { type: 'turnStarted'; turn: DebateTurnDto })
  | (RunEventBase & {
      type: 'turnUpdated'
      turnId: string
      stage: string
      participantId: string
      delta: string
      content: string
    })
  | (RunEventBase & { type: 'turnCompleted'; turn: DebateTurnDto })
  | (RunEventBase & { type: 'turnFailed'; turn: DebateTurnDto })
  | (RunEventBase & { type: 'sessionPaused' | 'sessionStopped' | 'sessionCompleted' })

export interface DebateStudioApi {
  getAppVersion(): Promise<string>
  listProviderConnections(): Promise<ConfigurationResultDto<ProviderConnectionDto[]>>
  listProviderPresets(): Promise<ConfigurationResultDto<ProviderPresetDto[]>>
  saveProviderConnection(input: SaveProviderConnectionInput): Promise<ConfigurationResultDto<ProviderConnectionDto>>
  deleteProviderConnection(input: { id: string; deleteCredential: boolean }): Promise<ConfigurationResultDto<boolean>>
  listModelProfiles(): Promise<ConfigurationResultDto<ModelProfileDto[]>>
  saveModelProfile(input: SaveModelProfileInput): Promise<ConfigurationResultDto<ModelProfileDto>>
  deleteModelProfile(input: { id: string }): Promise<ConfigurationResultDto<boolean>>
  copyModelProfile(input: { id: string }): Promise<ConfigurationResultDto<ModelProfileDto>>
  saveCredential(input: { connectionId: string; credential: string }): Promise<ConfigurationResultDto<boolean>>
  deleteCredential(input: { connectionId: string }): Promise<ConfigurationResultDto<boolean>>
  testConnection(input: { connectionId: string; modelProfileId?: string }): Promise<ConfigurationResultDto<ConnectionTestDto>>
  createDebate(input: CreateDebateInput): Promise<ConfigurationResultDto<DebateDetailDto>>
  saveParticipantBindings(input: SaveParticipantBindingsInput): Promise<ConfigurationResultDto<DebateDetailDto>>
  createMockDemoDebate(): Promise<ConfigurationResultDto<DebateDetailDto>>
  startDebate(input: { sessionId: string }): Promise<RunCommandResultDto>
  pauseDebate(input: { sessionId: string }): Promise<RunCommandResultDto>
  resumeDebate(input: { sessionId: string }): Promise<RunCommandResultDto>
  stopDebate(input: { sessionId: string }): Promise<RunCommandResultDto>
  retryFailedTurn(input: { sessionId: string }): Promise<RunCommandResultDto>
  getRunState(input: { sessionId: string }): Promise<RunCommandResultDto>
  listDebates(input?: DebateHistoryListQueryDto): Promise<DebateHistoryResultDto<DebateHistorySummaryDto[]>>
  getDebate(input: { id: string }): Promise<ConfigurationResultDto<DebateDetailDto>>
  getDebateDetail(input: { id: string }): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  renameDebate(input: RenameDebateInputDto): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  toggleFavorite(input: ToggleFavoriteInputDto): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  addTag(input: DebateTagInputDto): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  removeTag(input: DebateTagInputDto): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  archiveDebate(input: { id: string }): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  restoreDebate(input: { id: string }): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  deleteDebate(input: DeleteDebateInputDto): Promise<DebateHistoryResultDto<DebateHistoryDetailDto>>
  listDebateTurns(input: { sessionId: string }): Promise<ConfigurationResultDto<DebateTurnDto[]>>
  listDebateTurnsPage(input: DebateTurnPageInputDto): Promise<ConfigurationResultDto<DebateTurnPageDto>>
  loadDebateSetup(input: { sessionId: string }): Promise<ConfigurationResultDto<DebateSetupDto>>
  loadResearchWorkspace(input: { sessionId: string }): Promise<ResearchResultDto<ResearchWorkspaceDto>>
  addResearchAsset(input: AddResearchAssetInput): Promise<ResearchResultDto<ResearchAssetDto>>
  publishResearchEvidence(input: PublishEvidenceInput): Promise<ResearchResultDto<{ evidenceId: string; publicCode: string }>>
  challengeEvidence(input: ChallengeEvidenceInput): Promise<ResearchResultDto<boolean>>
  updateEvidenceStatus(input: UpdateEvidenceStatusInput): Promise<ResearchResultDto<boolean>>
  runMockSearch(input: RunMockSearchInput): Promise<ResearchResultDto<number>>
  listSearchProviderConnections(): Promise<ResearchResultDto<SearchProviderConnectionDto[]>>
  saveSearchProviderConnection(input: SaveSearchProviderConnectionInput): Promise<ResearchResultDto<SearchProviderConnectionDto>>
  deleteSearchProviderConnection(input: { id: string }): Promise<ResearchResultDto<boolean>>
  saveSearchCredential(input: { connectionId: string; credential: string }): Promise<ResearchResultDto<boolean>>
  deleteSearchCredential(input: { connectionId: string }): Promise<ResearchResultDto<boolean>>
  testSearchConnection(input: { connectionId: string }): Promise<ResearchResultDto<{ success: boolean; latencyMs: number; titleZh: string; descriptionZh: string; retryable: boolean }>>
  saveResearchRuntimeSettings(input: ResearchRuntimeSettingsInput): Promise<ResearchResultDto<boolean>>
  decideResearchToolCall(input: { callId: string; approved: boolean }): Promise<ResearchResultDto<boolean>>
  listRecentErrors(): Promise<DiagnosticsResultDto<ErrorRecordDto[]>>
  getErrorDetail(input: { id: string }): Promise<DiagnosticsResultDto<ErrorRecordDto | undefined>>
  clearErrors(): Promise<DiagnosticsResultDto<boolean>>
  exportDiagnosticReport(): Promise<DiagnosticsResultDto<DiagnosticExportDto>>
  getRecentLogs(): Promise<DiagnosticsResultDto<LogEntryDto[]>>
  clearLogs(): Promise<DiagnosticsResultDto<boolean>>
  reportRendererError(input: RendererErrorInputDto): Promise<DiagnosticsResultDto<boolean>>
  reportRendererPerformance(input: RendererPerformanceInputDto): Promise<DiagnosticsResultDto<boolean>>
  getPerformanceSnapshot(): Promise<DiagnosticsResultDto<PerformanceSnapshotDto>>
  getDataManagementState(): Promise<DataManagementResultDto<DataManagementStateDto>>
  createDatabaseBackup(): Promise<DataManagementResultDto<DatabaseBackupDto>>
  restoreDatabaseBackup(input: RestoreDatabaseBackupInputDto): Promise<DataManagementResultDto<RestoreDatabaseBackupResultDto>>
  exportMarkdown(input: ExportDebateInputDto): Promise<DebateExportResultDto<DebateExportRecordDto>>
  exportHtml(input: ExportDebateInputDto): Promise<DebateExportResultDto<DebateExportRecordDto>>
  listExports(): Promise<DebateExportResultDto<DebateExportRecordDto[]>>
  deleteExport(input: DeleteExportInputDto): Promise<DebateExportResultDto<{ deleted: boolean }>>
  cancelExport(input: CancelExportInputDto): Promise<DebateExportResultDto<{ cancelled: boolean }>>
  onRunEvent(listener: (event: RunEventDto) => void): () => void
}

export type {
  DatabaseBackupDto,
  DataManagementErrorDto,
  DataManagementResultDto,
  DataManagementStateDto,
  RestoreDatabaseBackupInputDto,
  RestoreDatabaseBackupResultDto
} from './data-management-dtos'

export type {
  ConfigurationResultDto,
  ConnectionTestDto,
  CreateDebateInput,
  DebateDetailDto,
  DebateParticipantRoleDto,
  DebateSetupDto,
  DebateSummaryDto,
  DebateTurnDto,
  DebateTurnPageDto,
  DebateTurnPageInputDto,
  DebateTurnFailureDto,
  DebateSetupIssueDto,
  ModelCapabilitiesDto,
  ModelProfileDto,
  ProviderPresetDto,
  ParticipantBindingDto,
  ProtocolTypeDto,
  ProviderConnectionDto,
  SaveModelProfileInput,
  SaveParticipantBindingsInput,
  SaveProviderConnectionInput
} from './debate-dtos'
export type {
  AddResearchAssetInput,
  ChallengeEvidenceInput,
  PublishEvidenceInput,
  ResearchAssetDto,
  ResearchErrorDto,
  ResearchResultDto,
  ResearchWorkspaceDto,
  ResearchRuntimeSettingsInput,
  RoleResearchWorkspaceDto,
  RunMockSearchInput,
  SaveSearchProviderConnectionInput,
  SearchProviderConnectionDto,
  UpdateEvidenceStatusInput
} from './research-dtos'
export type {
  DiagnosticExportDto,
  DiagnosticsResultDto,
  ErrorCategoryDto,
  ErrorRecordDto,
  ErrorSeverityDto,
  LogEntryDto,
  LogLevelDto,
  PerformanceMetricSummaryDto,
  PerformanceSnapshotDto,
  RendererErrorInputDto,
  RendererPerformanceInputDto
} from './diagnostics-dtos'
export type {
  DebateHistoryDetailDto,
  DebateHistoryListQueryDto,
  DebateHistoryModelDto,
  DebateHistoryResultDto,
  DebateHistorySortDto,
  DebateHistoryStatusDto,
  DebateHistorySummaryDto,
  DebateTagInputDto,
  DeleteDebateInputDto,
  RenameDebateInputDto,
  ToggleFavoriteInputDto
} from './history-dtos'
export type {
  DebateExportOptionsDto,
  DebateExportRecordDto,
  DebateExportResultDto,
  DebateExportStatusDto,
  DebateExportTypeDto,
  CancelExportInputDto,
  DeleteExportInputDto,
  ExportDebateInputDto
} from './export-dtos'
