import type { ZodType } from 'zod'

import type {
  CostApplication, DataManagementApplication, DebateConfigurationApplication, DebateHistoryApplication, DebateQualityApplication, DebateRunApplication, DebateRunEvent, DiagnosticsApplication, ExportApplication, ModelRoutingApplication, OnboardingApplication, PromptStudioApplication, ResearchApplication
} from '../application'
import type { DebateTurn } from '../domain'
import type { ErrorCenter, LoggerLike } from '../observability'
import type { DebatePlanner } from '../debate-planner'
import { redactForExport, redactSensitiveText } from '../security'
import {
  IPC_CHANNELS,
  type ConfigurationResultDto,
  type DebateTurnDto,
  type DebatePlannerProgressDto,
  type RunCommandResultDto,
  type RunEventDto
} from '../shared/ipc-contract'
import {
  addResearchAssetSchema,
  assetInputSchema,
  challengeEvidenceSchema,
  cancelExportSchema,
  debateTurnPageSchema,
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
  externalUrlSchema,
  publishEvidenceSchema,
  providerModelDiscoverySchema,
  researchRuntimeSettingsSchema,
  rendererErrorSchema,
  rendererPerformanceSchema,
  restoreDatabaseBackupSchema,
  renameDebateSchema,
  researchToolDecisionSchema,
  runMockSearchSchema,
  saveSearchProviderConnectionSchema,
  searchCredentialInputSchema,
  saveModelProfileSchema,
  saveParticipantBindingsSchema,
  saveProviderConnectionSchema,
  planDebateSchema,
  plannerOperationSchema,
  sessionInputSchema,
  toggleFavoriteSchema,
  updateEvidenceStatusSchema
  , onboardingProviderSchema
  , onboardingDefaultsSchema
  , saveModelRoutingPolicySchema
  , saveProviderPricingSchema
  , createPromptVersionSchema
  , rollbackPromptSchema
} from '../shared/ipc-schemas'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface DebateIpcDependencies {
  ipcMain: IpcMainLike
  configuration: DebateConfigurationApplication
  planner?: DebatePlanner
  onboarding?: OnboardingApplication
  modelRouting?: ModelRoutingApplication
  costs?: CostApplication
  promptStudio?: PromptStudioApplication
  quality?: DebateQualityApplication
  history: DebateHistoryApplication
  run: DebateRunApplication
  research?: ResearchApplication
  diagnostics: DiagnosticsApplication
  dataManagement: DataManagementApplication
  exports: ExportApplication
  logger: LoggerLike
  errorCenter: ErrorCenter
  getAppVersion(): string
  openExternalUrl?(url: string): Promise<void>
  broadcastRunEvent(event: RunEventDto): void
  broadcastPlannerProgress(event: DebatePlannerProgressDto): void
}

const registeredChannels = Object.values(IPC_CHANNELS).filter((channel) => channel !== IPC_CHANNELS.runEvent && channel !== IPC_CHANNELS.plannerProgress)

export function registerDebateIpc(dependencies: DebateIpcDependencies): () => void {
  const { configuration, run, research } = dependencies
  const rawIpcMain = dependencies.ipcMain
  const ipcMain = observedIpcMain(dependencies)
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => dependencies.getAppVersion())
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, validated(externalUrlSchema, async (input) => {
    if (!dependencies.openExternalUrl || !isAllowedExternalUrl(input.url)) return externalUrlFailure('EXTERNAL_URL_NOT_ALLOWED', '此链接不在官方平台白名单中。')
    try {
      await dependencies.openExternalUrl(input.url)
      return { ok: true, value: true }
    } catch {
      return externalUrlFailure('EXTERNAL_URL_OPEN_FAILED', '无法调用系统浏览器，请稍后重试。')
    }
  }))
  ipcMain.handle(IPC_CHANNELS.getOnboardingState, () => dependencies.onboarding?.getState() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.saveOnboardingProvider, validated(onboardingProviderSchema, (input) => dependencies.onboarding?.saveProvider(input) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.testOnboardingConnection, validated(connectionTestInputSchema, (input) => dependencies.onboarding?.testConnection(input.connectionId, input.modelProfileId) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.saveOnboardingDefaults, validated(onboardingDefaultsSchema, (input) => dependencies.onboarding?.saveDefaultModels(input) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.createOnboardingDemo, () => dependencies.onboarding?.createDemo() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.skipOnboarding, () => dependencies.onboarding?.skip() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.reopenOnboarding, () => dependencies.onboarding?.reopen() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.listModelRoutingPolicies, () => dependencies.modelRouting?.listPolicies() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.saveModelRoutingPolicy, validated(saveModelRoutingPolicySchema, (input) => dependencies.modelRouting?.savePolicy(input.task, input.modelProfileId) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.createDefaultModelRouting, () => dependencies.modelRouting?.createDefaults() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.listProviderPricing, () => dependencies.costs?.listPricing() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.saveProviderPricing, validated(saveProviderPricingSchema, (input) => dependencies.costs?.savePricing(input) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.getCostSummary, () => dependencies.costs?.getSummary() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.listPromptTemplates, () => dependencies.promptStudio?.listTemplates() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.createPromptVersion, validated(createPromptVersionSchema, (input) => dependencies.promptStudio?.createVersion(input.templateId, input.content, input.changeNote) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.rollbackPromptVersion, validated(rollbackPromptSchema, (input) => dependencies.promptStudio?.rollback(input.templateId, input.version) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.getDebateQuality, validated(idInputSchema, (input) => dependencies.quality?.getByDebate(input.id) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.listDebateQuality, () => dependencies.quality?.listOverview() ?? workbenchUnavailable())
  ipcMain.handle(IPC_CHANNELS.regenerateDebateQuality, validated(idInputSchema, (input) => dependencies.quality?.regenerate(input.id) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.listProviderConnections, () => configuration.listProviderConnections())
  ipcMain.handle(IPC_CHANNELS.listProviderPresets, () => configuration.listProviderPresets())
  ipcMain.handle(IPC_CHANNELS.saveProviderConnection, validated(saveProviderConnectionSchema, (input) => configuration.saveProviderConnection(input)))
  ipcMain.handle(IPC_CHANNELS.deleteProviderConnection, validated(deleteProviderConnectionSchema, (input) => configuration.deleteProviderConnection(input.id, input.deleteCredential)))
  ipcMain.handle(IPC_CHANNELS.listModelProfiles, () => configuration.listModelProfiles())
  ipcMain.handle(IPC_CHANNELS.listAvailableProviderModels, validated(providerModelDiscoverySchema, (input) => configuration.listAvailableProviderModels(input.connectionId)))
  ipcMain.handle(IPC_CHANNELS.saveModelProfile, validated(saveModelProfileSchema, (input) => configuration.saveModelProfile(input)))
  ipcMain.handle(IPC_CHANNELS.deleteModelProfile, validated(idInputSchema, (input) => configuration.deleteModelProfile(input.id)))
  ipcMain.handle(IPC_CHANNELS.copyModelProfile, validated(idInputSchema, (input) => configuration.copyModelProfile(input.id)))
  ipcMain.handle(IPC_CHANNELS.saveCredential, validated(credentialInputSchema, (input) => configuration.saveCredential(input.connectionId, input.credential)))
  ipcMain.handle(IPC_CHANNELS.deleteCredential, validated(connectionInputSchema, (input) => configuration.deleteCredential(input.connectionId)))
  ipcMain.handle(IPC_CHANNELS.testConnection, validated(connectionTestInputSchema, (input) => configuration.testConnection(input.connectionId, input.modelProfileId)))
  ipcMain.handle(IPC_CHANNELS.planDebate, validated(planDebateSchema, (input) => dependencies.planner?.plan(input, (event) => {
    dependencies.broadcastPlannerProgress({ operationId: input.operationId, ...event })
  }) ?? workbenchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.cancelDebatePlanning, validated(plannerOperationSchema, (input) => ({
    ok: true,
    value: dependencies.planner?.cancel(input.operationId) ?? false
  })))
  ipcMain.handle(IPC_CHANNELS.createDebate, validated(createDebateSchema, (input) => configuration.createDebate(input)))
  ipcMain.handle(IPC_CHANNELS.saveParticipantBindings, validated(saveParticipantBindingsSchema, (input) => configuration.saveParticipantBindings(input)))
  ipcMain.handle(IPC_CHANNELS.createMockDemoDebate, () => configuration.createMockDemoDebate())
  ipcMain.handle(IPC_CHANNELS.startDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.start(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.pauseDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.pause(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.resumeDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.resume(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.stopDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.stop(input.sessionId))))
  ipcMain.handle(IPC_CHANNELS.skipDebate, validated(sessionInputSchema, async (input) => mapRunResult(await run.skip(input.sessionId, '用户选择强制停止当前请求并进入下一阶段'))))
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
  ipcMain.handle(IPC_CHANNELS.listDebateTurnsPage, validated(debateTurnPageSchema, (input) => configuration.listDebateTurnsPage(input.sessionId, input.limit, input.before)))
  ipcMain.handle(IPC_CHANNELS.loadDebateSetup, validated(sessionInputSchema, (input) => configuration.loadDebateSetup(input.sessionId)))
  ipcMain.handle(IPC_CHANNELS.loadResearchWorkspace, validated(sessionInputSchema, (input) => research?.loadWorkspace(input.sessionId) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.addResearchAsset, validated(addResearchAssetSchema, (input) => research?.addAsset(input) ?? researchUnavailable()))
  ipcMain.handle(IPC_CHANNELS.analyzeImageAsset, validated(assetInputSchema, (input) => research?.analyzeImageAsset(input.assetId) ?? researchUnavailable()))
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
  ipcMain.handle(IPC_CHANNELS.reportRendererPerformance, validated(rendererPerformanceSchema, (input) => dependencies.diagnostics.reportRendererPerformance(input)))
  ipcMain.handle(IPC_CHANNELS.getPerformanceSnapshot, () => dependencies.diagnostics.getPerformanceSnapshot())
  ipcMain.handle(IPC_CHANNELS.getDataManagementState, () => dependencies.dataManagement.getState())
  ipcMain.handle(IPC_CHANNELS.createDatabaseBackup, () => dependencies.dataManagement.createBackup())
  ipcMain.handle(IPC_CHANNELS.restoreDatabaseBackup, validated(
    restoreDatabaseBackupSchema,
    (input) => dependencies.dataManagement.restoreBackup(input.backupId, input.confirmed)
  ))
  ipcMain.handle(IPC_CHANNELS.exportMarkdown, validated(exportDebateSchema, (input) => dependencies.exports.exportDebateMarkdown(input.debateId, input.exportOptions)))
  ipcMain.handle(IPC_CHANNELS.exportHtml, validated(exportDebateSchema, (input) => dependencies.exports.exportDebateHtml(input.debateId, input.exportOptions)))
  ipcMain.handle(IPC_CHANNELS.listExports, () => dependencies.exports.getExportHistory())
  ipcMain.handle(IPC_CHANNELS.deleteExport, validated(deleteExportSchema, (input) => dependencies.exports.deleteExportRecord(input.exportId)))
  ipcMain.handle(IPC_CHANNELS.cancelExport, validated(cancelExportSchema, (input) => dependencies.exports.cancelExport(input.exportId)))

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
        if (channel !== IPC_CHANNELS.reportRendererPerformance) {
          dependencies.logger.debug('IPC 调用开始', { source: 'ipc', metadata: { channel } })
        }
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

function workbenchUnavailable(): ConfigurationResultDto<never> {
  return {
    ok: false,
    error: {
      code: 'WORKBENCH_APPLICATION_UNAVAILABLE',
      titleZh: '工作台服务不可用',
      descriptionZh: '本地工作台应用层尚未完成组合，操作未执行。',
      retryable: false
    }
  }
}

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'platform.openai.com', 'developers.openai.com', 'openai.com',
  'platform.kimi.com',
  'platform.deepseek.com', 'api-docs.deepseek.com',
  'bigmodel.cn', 'docs.bigmodel.cn',
  'platform.xiaomimimo.com', 'mimo.mi.com',
  'bailian.console.aliyun.com', 'help.aliyun.com',
  'aistudio.google.com', 'ai.google.dev',
  'app.tavily.com', 'docs.tavily.com'
])

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function externalUrlFailure(code: string, descriptionZh: string): ConfigurationResultDto<never> {
  return {
    ok: false,
    error: { code, titleZh: '无法打开官方链接', descriptionZh, retryable: false }
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
    case 'turnReasoningUpdated':
      return {
        ...base,
        type: event.type,
        turnId: event.turnId,
        stage: event.stage,
        participantId: event.participantId,
        delta: redactSensitiveText(event.delta)
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
