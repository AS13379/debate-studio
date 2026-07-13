import type { ZodType } from 'zod'

import type { DebateConfigurationApplication, DebateRunApplication, DebateRunEvent, ResearchApplication } from '../application'
import type { DebateTurn } from '../domain'
import { redactForExport, redactSensitiveText } from '../security'
import {
  IPC_CHANNELS,
  type ConfigurationResultDto,
  type DebateTurnDto,
  type RunCommandResultDto,
  type RunEventDto
} from '../shared/ipc-contract'
import {
  addResearchAssetSchema,
  challengeEvidenceSchema,
  connectionInputSchema,
  connectionTestInputSchema,
  createDebateSchema,
  credentialInputSchema,
  deleteProviderConnectionSchema,
  idInputSchema,
  publishEvidenceSchema,
  runMockSearchSchema,
  saveModelProfileSchema,
  saveParticipantBindingsSchema,
  saveProviderConnectionSchema,
  sessionInputSchema,
  updateEvidenceStatusSchema
} from '../shared/ipc-schemas'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface DebateIpcDependencies {
  ipcMain: IpcMainLike
  configuration: DebateConfigurationApplication
  run: DebateRunApplication
  research?: ResearchApplication
  getAppVersion(): string
  broadcastRunEvent(event: RunEventDto): void
}

const registeredChannels = Object.values(IPC_CHANNELS).filter((channel) => channel !== IPC_CHANNELS.runEvent)

export function registerDebateIpc(dependencies: DebateIpcDependencies): () => void {
  const { ipcMain, configuration, run, research } = dependencies
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => dependencies.getAppVersion())
  ipcMain.handle(IPC_CHANNELS.listProviderConnections, () => configuration.listProviderConnections())
  ipcMain.handle(IPC_CHANNELS.listProviderPresets, () => configuration.listProviderPresets())
  ipcMain.handle(IPC_CHANNELS.saveProviderConnection, validated(saveProviderConnectionSchema, (input) => configuration.saveProviderConnection(input)))
  ipcMain.handle(IPC_CHANNELS.deleteProviderConnection, validated(deleteProviderConnectionSchema, (input) => configuration.deleteProviderConnection(input.id, input.deleteCredential)))
  ipcMain.handle(IPC_CHANNELS.listModelProfiles, () => configuration.listModelProfiles())
  ipcMain.handle(IPC_CHANNELS.saveModelProfile, validated(saveModelProfileSchema, (input) => configuration.saveModelProfile(input)))
  ipcMain.handle(IPC_CHANNELS.deleteModelProfile, validated(idInputSchema, (input) => configuration.deleteModelProfile(input.id)))
  ipcMain.handle(IPC_CHANNELS.copyModelProfile, validated(idInputSchema, (input) => configuration.copyModelProfile(input.id)))
  ipcMain.handle(IPC_CHANNELS.saveCredential, validated(credentialInputSchema, (input) => configuration.saveCredential(input.connectionId, input.credential)))
  ipcMain.handle(IPC_CHANNELS.deleteCredential, validated(connectionInputSchema, (input) => configuration.deleteCredential(input.connectionId)))
  ipcMain.handle(IPC_CHANNELS.testConnection, validated(connectionTestInputSchema, (input) => configuration.testConnection(input.connectionId, input.modelProfileId)))
  ipcMain.handle(IPC_CHANNELS.createDebate, validated(createDebateSchema, (input) => configuration.createDebate(input)))
  ipcMain.handle(IPC_CHANNELS.saveParticipantBindings, validated(saveParticipantBindingsSchema, (input) => configuration.saveParticipantBindings(input)))
  ipcMain.handle(IPC_CHANNELS.createMockDemoDebate, () => configuration.createMockDemoDebate())
  ipcMain.handle(IPC_CHANNELS.startDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.start(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.pauseDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.pause(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.resumeDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.resume(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.stopDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.stop(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.retryFailedTurn, validated(sessionInputSchema, async (input) => mapRunResult(await run.retryFailedTurn(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.getRunState, validated(sessionInputSchema, (input) => mapRunResult(run.getRunState(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.listDebates, () => configuration.listDebates())
  ipcMain.handle(IPC_CHANNELS.getDebate, validated(idInputSchema, (input) => configuration.getDebate(input.id)))
  ipcMain.handle(IPC_CHANNELS.listDebateTurns, validated(sessionInputSchema, (input) => configuration.listDebateTurns(input.sessionId)))
  ipcMain.handle(IPC_CHANNELS.loadDebateSetup, validated(sessionInputSchema, (input) => configuration.loadDebateSetup(input.sessionId)))
  ipcMain.handle(IPC_CHANNELS.loadResearchWorkspace, validated(sessionInputSchema, (input) => research?.loadWorkspace(input.sessionId) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.addResearchAsset, validated(addResearchAssetSchema, (input) => research?.addAsset(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.publishResearchEvidence, validated(publishEvidenceSchema, (input) => research?.publishEvidence(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.challengeEvidence, validated(challengeEvidenceSchema, (input) => research?.challengeEvidence(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.updateEvidenceStatus, validated(updateEvidenceStatusSchema, (input) => research?.updateEvidenceStatus(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.runMockSearch, validated(runMockSearchSchema, (input) => research?.runMockSearch(input) ?? researchUnavailable()))

  const unsubscribe = run.subscribe((event) => dependencies.broadcastRunEvent(mapRunEvent(event)))
  return () => {
    unsubscribe()
    for (const channel of registeredChannels) ipcMain.removeHandler(channel)
  }
}

function validated<T>(schema: ZodType<T>, action: (input: T) => unknown): (event: unknown, input?: unknown) => unknown {
  return (_event, input) => {
    const parsed = schema.safeParse(input)
    if (!parsed.success) return validationFailure()
    return action(parsed.data)
  }
}

function validationFailure(): ConfigurationResultDto<never> {
  return {
    ok: false,
    error: {
      code: 'IPC_VALIDATION_FAILED',
      titleZh: '输入校验失败',
      descriptionZh: '请求参数格式无效，操作未执行。',
      retryable: false
    }
  }
}

function researchUnavailable(): ConfigurationResultDto<never> {
  return {
    ok: false,
    error: {
      code: 'RESEARCH_APPLICATION_UNAVAILABLE',
      titleZh: '研究服务不可用',
      descriptionZh: '研究应用层尚未完成组合，操作未执行。',
      retryable: false
    }
  }
}

function mapRunResult(result: ReturnType<DebateRunApplication['getRunState']>): RunCommandResultDto {
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        titleZh: result.error.titleZh,
        descriptionZh: result.error.descriptionZh,
        retryable: result.error.retryable,
        suggestedActionZh: result.error.code === 'RUNTIME_PREPARATION_FAILED'
          ? '根据启动前检查修正模型与连接配置。'
          : result.error.retryable ? '稍后重试当前操作。' : '检查当前 Session 状态和配置。',
        technicalDetails: redactSensitiveText(result.error.persistence?.message ?? result.error.code)
      }
    }
  }
  return {
    ok: true,
    state: {
      ...result.state,
      lastTurn: result.state.lastTurn ? redactForExport({ ...result.state.lastTurn }) : undefined
    }
  }
}

function mapRunEvent(event: DebateRunEvent): RunEventDto {
  const base = { id: event.id, sessionId: event.sessionId, createdAt: event.createdAt }
  switch (event.type) {
    case 'stateChanged':
      return {
        ...base,
        type: event.type,
        state: { status: event.event.to.status, currentStage: event.event.to.stage }
      }
    case 'turnStarted':
    case 'turnCompleted':
    case 'turnFailed':
      return { ...base, type: event.type, turn: turnDto(event.turn) }
    case 'turnUpdated':
      return {
        ...base,
        type: event.type,
        turnId: event.turnId,
        stage: event.stage,
        participantId: event.participantId,
        delta: event.delta,
        content: event.content
      }
    case 'sessionPaused':
    case 'sessionStopped':
    case 'sessionCompleted':
      return { ...base, type: event.type }
  }
}

function turnDto(turn: DebateTurn): DebateTurnDto {
  return redactForExport({ ...turn })
}
