import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { CredentialStore } from '../security'
import { redactSensitiveText } from '../security'
import { AuthenticatedHttpTransport } from './authenticated-http-transport'
import { HttpTransportError, type HttpTransport, type HttpTransportRequest } from './http-transport'
import {
  presentProviderFailure,
  type ProviderFailureCode,
  type ProviderFailurePresentation
} from './provider-error-presentation'

export type ConnectionTestErrorCode =
  | 'INVALID_BASE_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CREDENTIAL_REFERENCE_MISSING'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_STORE_FAILED'
  | 'MODEL_PROFILE_INVALID'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'REQUEST_REJECTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'STREAM_INTERRUPTED'
  | 'CONTEXT_TOO_LONG'
  | 'IMAGE_UNSUPPORTED'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_PROVIDER_ERROR'

export interface ConnectionTestError {
  code: ConnectionTestErrorCode
  titleZh: string
  descriptionZh: string
  retryable: boolean
  providerStatus?: number
  suggestedActionZh: string
  technicalDetails: string
}

export type ConnectionTestResult =
  | { success: true; latencyMs: number; providerStatus: number; responsePreview: string }
  | { success: false; latencyMs: number; providerStatus?: number; error: ConnectionTestError }

export interface ConnectionTestServiceOptions {
  transport: HttpTransport
  credentialStore: CredentialStore
  now?: () => number
}

export class ConnectionTestService {
  private readonly now: () => number

  constructor(private readonly options: ConnectionTestServiceOptions) {
    this.now = options.now ?? (() => performance.now())
  }

  async test(
    connection: ProviderConnection,
    modelProfile?: ModelProfile,
    signal: AbortSignal = new AbortController().signal
  ): Promise<ConnectionTestResult> {
    const startedAt = this.now()
    const invalid = this.validate(connection, modelProfile)
    if (invalid) return this.failure(startedAt, invalid)

    const transport = new AuthenticatedHttpTransport(
      this.options.transport,
      this.options.credentialStore,
      (connectionId) => connectionId === connection.id ? connection.credentialRef : undefined
    )
    const request = this.createProbeRequest(connection, modelProfile, signal)

    try {
      const response = await transport.send(request)
      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          latencyMs: this.elapsed(startedAt),
          providerStatus: response.status,
          responsePreview: this.responsePreview(response.body, Boolean(modelProfile))
        }
      }
      return this.failure(startedAt, this.statusError(response.status, response.body), response.status)
    } catch (cause) {
      return this.failure(startedAt, this.transportError(cause))
    }
  }

  private validate(connection: ProviderConnection, modelProfile: ModelProfile | undefined): ConnectionTestError | undefined {
    try {
      const url = new URL(connection.baseUrl)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error('invalid protocol')
    } catch {
      return this.error('INVALID_BASE_URL', 'Base URL 无效', '请输入有效的 HTTP 或 HTTPS 平台地址。', false)
    }
    if (connection.protocolType !== 'openai-chat') {
      return this.error('UNSUPPORTED_PROTOCOL', '协议暂不支持', '当前连接测试只支持 OpenAI Chat Completions 兼容协议。', false)
    }
    if (!connection.credentialRef.trim()) {
      return this.error('CREDENTIAL_REFERENCE_MISSING', '凭据引用缺失', '该平台连接尚未关联安全凭据。', false)
    }
    if (modelProfile && (modelProfile.connectionId !== connection.id || !modelProfile.modelId.trim())) {
      return this.error('MODEL_PROFILE_INVALID', '模型配置无效', '指定的 ModelProfile 不属于当前连接，或 Model ID 为空。', false)
    }
    return undefined
  }

  private createProbeRequest(
    connection: ProviderConnection,
    modelProfile: ModelProfile | undefined,
    signal: AbortSignal
  ): HttpTransportRequest {
    const baseUrl = connection.baseUrl.replace(/\/+$/, '')
    return modelProfile
      ? {
          method: 'POST',
          url: `${baseUrl}/chat/completions`,
          headers: { 'content-type': 'application/json' },
          body: {
            model: modelProfile.modelId,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            stream: false,
            max_tokens: 1
          },
          signal,
          metadata: { providerConnectionId: connection.id }
        }
      : {
          method: 'GET',
          url: `${baseUrl}/models`,
          headers: { accept: 'application/json' },
          signal,
          metadata: { providerConnectionId: connection.id }
        }
  }

  private statusError(status: number, body: unknown): ConnectionTestError {
    const providerMessage = this.providerMessage(body)
    const providerCode = this.providerCode(body)
    return this.fromPresentation(
      presentProviderFailure({ statusCode: status, providerCode, message: providerMessage }),
      status
    )
  }

  private transportError(cause: unknown): ConnectionTestError {
    const presentation = cause instanceof HttpTransportError
      ? presentProviderFailure({
          message: cause.message,
          transportCode: cause.code,
          statusCode: cause.statusCode,
          titleZh: cause.titleZh,
          descriptionZh: cause.descriptionZh,
          retryable: cause.retryable
        })
      : presentProviderFailure({
          message: cause instanceof Error ? cause.message : 'Unknown connection test failure.',
          transportCode: 'TRANSPORT_FAILED'
        })
    return this.fromPresentation(presentation, cause instanceof HttpTransportError ? cause.statusCode : undefined)
  }

  private providerMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined
    const error = 'error' in body ? (body as { error?: unknown }).error : undefined
    if (!error || typeof error !== 'object' || !('message' in error)) return undefined
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? redactSensitiveText(message) : undefined
  }

  private providerCode(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined
    const error = 'error' in body ? (body as { error?: unknown }).error : undefined
    if (!error || typeof error !== 'object') return undefined
    const code = 'code' in error ? (error as { code?: unknown }).code : undefined
    const type = 'type' in error ? (error as { type?: unknown }).type : undefined
    return typeof code === 'string' ? code : typeof type === 'string' ? type : undefined
  }

  private responsePreview(body: unknown, usedModelProfile: boolean): string {
    if (usedModelProfile && body && typeof body === 'object' && 'choices' in body) {
      const choices = (body as { choices?: unknown }).choices
      const first = Array.isArray(choices) ? choices[0] : undefined
      if (first && typeof first === 'object' && 'message' in first) {
        const message = (first as { message?: unknown }).message
        if (message && typeof message === 'object' && 'content' in message) {
          const content = (message as { content?: unknown }).content
          if (typeof content === 'string' && content.trim()) return redactSensitiveText(content).slice(0, 200)
        }
      }
    }
    return usedModelProfile ? '服务商已接受最小模型请求。' : '服务商已返回有效连接响应。'
  }

  private fromPresentation(
    presentation: ProviderFailurePresentation,
    providerStatus?: number
  ): ConnectionTestError {
    return {
      code: this.connectionErrorCode(presentation.failureCode),
      titleZh: presentation.titleZh,
      descriptionZh: presentation.descriptionZh,
      retryable: presentation.retryable,
      providerStatus,
      suggestedActionZh: presentation.suggestedActionZh,
      technicalDetails: presentation.technicalDetails
    }
  }

  private connectionErrorCode(code: ProviderFailureCode): ConnectionTestErrorCode {
    return {
      API_KEY_MISSING: 'CREDENTIAL_MISSING',
      API_KEY_INVALID: 'AUTHENTICATION_FAILED',
      CREDENTIAL_STORE_FAILED: 'CREDENTIAL_STORE_FAILED',
      QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
      RATE_LIMITED: 'RATE_LIMITED',
      MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
      BASE_URL_INVALID: 'INVALID_BASE_URL',
      NETWORK_ERROR: 'NETWORK_ERROR',
      TIMEOUT: 'TIMEOUT',
      STREAM_INTERRUPTED: 'STREAM_INTERRUPTED',
      CONTEXT_TOO_LONG: 'CONTEXT_TOO_LONG',
      IMAGE_UNSUPPORTED: 'IMAGE_UNSUPPORTED',
      REQUEST_CANCELLED: 'CANCELLED',
      UNKNOWN_PROVIDER_ERROR: 'UNKNOWN_PROVIDER_ERROR'
    }[code] as ConnectionTestErrorCode
  }

  private error(
    code: ConnectionTestErrorCode,
    titleZh: string,
    descriptionZh: string,
    retryable: boolean,
    providerStatus?: number,
    suggestedActionZh = '检查连接配置后重试。',
    technicalDetails = descriptionZh
  ): ConnectionTestError {
    return {
      code,
      titleZh,
      descriptionZh,
      retryable,
      providerStatus,
      suggestedActionZh,
      technicalDetails: redactSensitiveText(technicalDetails)
    }
  }

  private failure(
    startedAt: number,
    error: ConnectionTestError,
    providerStatus = error.providerStatus
  ): ConnectionTestResult {
    return { success: false, latencyMs: this.elapsed(startedAt), providerStatus, error }
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, this.now() - startedAt)
  }
}
