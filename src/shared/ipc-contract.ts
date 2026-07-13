import type {
  ConfigurationResultDto,
  ConnectionTestDto,
  CreateDebateInput,
  DebateDetailDto,
  DebateSetupDto,
  DebateSummaryDto,
  DebateTurnDto,
  ModelProfileDto,
  ProviderConnectionDto,
  SaveModelProfileInput,
  SaveParticipantBindingsInput,
  SaveProviderConnectionInput
} from './debate-dtos'

export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  listProviderConnections: 'configuration:list-provider-connections',
  saveProviderConnection: 'configuration:save-provider-connection',
  deleteProviderConnection: 'configuration:delete-provider-connection',
  listModelProfiles: 'configuration:list-model-profiles',
  saveModelProfile: 'configuration:save-model-profile',
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
  listDebateTurns: 'query:list-debate-turns',
  loadDebateSetup: 'query:load-debate-setup',
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
  saveProviderConnection(input: SaveProviderConnectionInput): Promise<ConfigurationResultDto<ProviderConnectionDto>>
  deleteProviderConnection(input: { id: string }): Promise<ConfigurationResultDto<boolean>>
  listModelProfiles(): Promise<ConfigurationResultDto<ModelProfileDto[]>>
  saveModelProfile(input: SaveModelProfileInput): Promise<ConfigurationResultDto<ModelProfileDto>>
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
  listDebates(): Promise<ConfigurationResultDto<DebateSummaryDto[]>>
  getDebate(input: { id: string }): Promise<ConfigurationResultDto<DebateDetailDto>>
  listDebateTurns(input: { sessionId: string }): Promise<ConfigurationResultDto<DebateTurnDto[]>>
  loadDebateSetup(input: { sessionId: string }): Promise<ConfigurationResultDto<DebateSetupDto>>
  onRunEvent(listener: (event: RunEventDto) => void): () => void
}

export type {
  ConfigurationResultDto,
  ConnectionTestDto,
  CreateDebateInput,
  DebateDetailDto,
  DebateSetupDto,
  DebateSummaryDto,
  DebateTurnDto,
  ModelCapabilitiesDto,
  ModelProfileDto,
  ParticipantBindingDto,
  ProtocolTypeDto,
  ProviderConnectionDto,
  SaveModelProfileInput,
  SaveParticipantBindingsInput,
  SaveProviderConnectionInput
} from './debate-dtos'
