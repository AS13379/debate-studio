import type { ZodType } from 'zod'

import type {
  DebateConfigurationApplication, DebateHistoryApplication, DebateRunApplication, DebateRunEvent, DiagnosticsApplication, ExportApplication, ResearchApplication
} from '../application'
import type { DebateTurn } from '../domain'
import type { ErrorCenter, LoggerLike } from '../observability'
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
  deleteDebateSchema,
  deleteExportSchema,
  debateTagSchema,
  historyListQuerySchema,
  idInputSchema,
  exportDebateSchema,
  publishEvidenceSchema,
  researchRuntimeSettingsSchema,
  rendererErrorSchema,
  renameDebateSchema,
  researchToolDecisionSchema,
  runMockSearchSchema,
  saveSearchProviderConnectionSchema,
  searchCredentialInputSchema,
  saveModelProfileSchema,
  saveParticipantBindingsSchema,
  saveProviderConnectionSchema,
  sessionInputSchema,
  toggleFavoriteSchema,
  updateEvidenceStatusSchema
} from '../shared/ipc-schemas'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface DebateIpcDependencies {
  ipcMain: IpcMainLike
  configuration: DebateConfigurationApplication
  history: DebateHistoryApplication
  run: DebateRunApplication
  research?: ResearchApplication
  diagnostics: DiagnosticsApplication
  exports: ExportApplication
  logger: LoggerLike
  errorCenter: ErrorCenter
  getAppVersion(): string
  broadcastRunEvent(event: RunEventDto): void
}

const registeredChannels = Object.values(IPC_CHANNELS).filter((channel) => channel !== IPC_CHANNELS.runEvent)

export function registerDebateIpc(dependencies: DebateIpcDependencies): () => void {
  const { configuration, run, research } = dependencies
  const rawIpcMain = dependencies.ipcMain
  const ipcMain = observedIpcMain(dependencies)
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
  ipcMain.handle(IPC_CHANNELS.listDebates, validated(historyListQuerySchema, (input) => dependencies.history.listDebates(input)))
  ipcMain.handle(IPC_CHANNELS.getDebate, validated(idInputSchema, (input) => configuration.getDebate(input.id)))
  ipcMain.handle(IPC_CHANNELS.getDebateDetail, validated(idInputSchema, (input) => dependencies.history.getDebateDetail(input.id)))
  ipcMain.handle(IPC_CHANNELS.renameDebate, validated(renameDebateSchema, (input) => dependencies.history.renameDebate(input.id, input.customTitle)))
  ipcMain.handle(IPC_CHANNELS.toggleFavorite, validated(toggleFavoriteSchema, (input) => dependencies.history.toggleFavorite(input.id, input.favorite)))
  ipcMain.handle(IPC_CHANNELS.addTag, validated(debateTagSchema, (input) => dependencies.history.addTag(input.id, input.tag)))
  ipcMain.handle(IPC_CHANNELS.removeTag, validated(debateTagSchema, (input) => dependencies.history.removeTag(input.id, input.tag)))
  ipcMain.handle(IPC_CHANNELS.archiveDebate, validated(idInputSchema, (input) => dependencies.history.archiveDebate(input.id)))
  ipcMain.handle(IPC_CHANNELS.restoreDebate, validated(idInputSchema, (input) => dependencies.history.restoreDebate(input.id)))
  ipcMain.handle(IPC_CHANNELS.deleteDebate, validated(deleteDebateSchema, (input) => dependencies.history.deleteDebate(input.id, input.confirmed)))
  ipcMain.handle(IPC_CHANNELS.listDebateTurns, validated(sessionInputSchema, (input) => configuration.listDebateTurns(input.sessionId)))
  ipcMain.handle(IPC_CHANNELS.loadDebateSetup, validated(sessionInputSchema, (input) => configuration.loadDebateSetup(input.sessionId)))
  ipcMain.handle(IPC_CHANNELS.loadResearchWorkspace, validated(sessionInputSchema, (input) => research?.loadWorkspace(input.sessionId) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.addResearchAsset, validated(addResearchAssetSchema, (input) => research?.addAsset(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.publishResearchEvidence, validated(publishEvidenceSchema, (input) => research?.publishEvidence(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.challengeEvidence, validated(challengeEvidenceSchema, (input) => research?.challengeEvidence(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.updateEvidenceStatus, validated(updateEvidenceStatusSchema, (input) => research?.updateEvidenceStatus(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.runMockSearch, validated(runMockSearchSchema, (input) => research?.runMockSearch(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.listSearchProviderConnections, () => research?.listSearchProviderConnections() ?? researchUnavailable())
  ipcMain.handle(IPC_CHANNELS.saveSearchProviderConnection, validated(saveSearchProviderConnectionSchema, (input) => research?.saveSearchProviderConnection(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.deleteSearchProviderConnection, validated(idInputSchema, (input) => research?.deleteSearchProviderConnection(input.id) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.saveSearchCredential, validated(searchCredentialInputSchema, (input) => research?.saveSearchCredential(input.connectionId, input.credential) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.deleteSearchCredential, validated(connectionInputSchema, (input) => research?.deleteSearchCredential(input.connectionId) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.testSearchConnection, validated(connectionInputSchema, (input) => research?.testSearchConnection(input.connectionId) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.saveResearchRuntimeSettings, validated(researchRuntimeSettingsSchema, (input) => research?.saveRuntimeSettings(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.decideResearchToolCall, validated(researchToolDecisionSchema, (input) => research?.decideToolCall(input.callId, input.approved) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.listRecentErrors, () => dependencies.diagnostics.listRecentErrors())
  ipcMain.handle(IPC_CHANNELS.getErrorDetail, validated(idInputSchema, (input) => dependencies.diagnostics.getErrorDetail(input.id)))
  ipcMain.handle(IPC_CHANNELS.clearErrors, () => dependencies.diagnostics.clearErrors())
  ipcMain.handle(IPC_CHANNELS.exportDiagnosticReport, () => dependencies.diagnostics.exportDiagnosticReport())
  ipcMain.handle(IPC_CHANNELS.getRecentLogs, () => dependencies.diagnostics.getRecentLogs())
  ipcMain.handle(IPC_CHANNELS.clearLogs, () => dependencies.diagnostics.clearLogs())
  ipcMain.handle(IPC_CHANNELS.reportRendererError, validated(rendererErrorSchema, (input) => dependencies.diagnostics.reportRendererError(input)))
  ipcMain.handle(IPC_CHANNELS.exportMarkdown, validated(exportDebateSchema, (input) => dependencies.exports.exportDebateMarkdown(input.debateId, input.exportOptions)))
  ipcMain.handle(IPC_CHANNELS.exportHtml, validated(exportDebateSchema, (input) => dependencies.exports.exportDebateHtml(input.debateId, input.exportOptions)))
  ipcMain.handle(IPC_CHANNELS.listExports, () => dependencies.exports.getExportHistory())
  ipcMain.handle(IPC_CHANNELS.deleteExport, validated(deleteExportSchema, (input) => dependencies.exports.deleteExportRecord(input.exportId)))

  const unsubscribe = run.subscribe((event) => {
    dependencies.diagnostics.observeRunEvent(event)
    dependencies.broadcastRunEvent(mapRunEvent(event))
  })
  return () => {
    unsubscribe()
    for (const channel of registeredChannels) rawIpcMain.removeHandler(channel)
  }
}

function observedIpcMain(dependencies: DebateIpcDependencies): IpcMainLike {
  return {
    handle(channel, listener) {
      dependencies.ipcMain.handle(channel, async (event, input) => {
        dependencies.logger.debug('IPC 调用开始', { source: 'ipc', metadata: { channel } })
        try {
          const result = await listener(event, input)
          if (isFailureResult(result)) {
            dependencies.logger.warn('IPC 调用返回错误', {
              source: 'ipc', metadata: { channel, code: result.error.code }
            })
            dependencies.errorCenter.capture(result.error, {
              source: `ipc:${channel}`,
              metadata: { channel }
            })
          }
          return result
        } catch (cause) {
          dependencies.logger.error('IPC 调用异常', { source: 'ipc', metadata: { channel } })
          dependencies.errorCenter.capture(cause, { source: `ipc:${channel}`, metadata: { channel } })
          return ipcUnexpectedFailure()
        }
      })
    },
    removeHandler(channel) { dependencies.ipcMain.removeHandler(channel) }
  }
}

function isFailureResult(value: unknown): value is { ok: false; error: Record<string, unknown> & { code?: string } } {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false &&
    'error' in value && typeof value.error === 'object' && value.error !== null
}

function ipcUnexpectedFailure(): ConfigurationResultDto<never> {
  return {
    ok: false,
    error: {
      code: 'IPC_UNEXPECTED_ERROR',
      titleZh: '应用操作失败',
      descriptionZh: '主进程处理请求时发生异常，请在“诊断与日志”中查看详情。',
      retryable: true
    }
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
