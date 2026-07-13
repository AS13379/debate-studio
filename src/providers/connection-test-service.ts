import type { ModelProfile, ProviderConnection } from '../provider-config'
import type { CredentialStore } from '../security'
import { redactSensitiveText } from '../security'
import { AuthenticatedHttpTransport } from './authenticated-http-transport'
import { HttpTransportError, type HttpTransport, type HttpTransportRequest } from './http-transport'

export type ConnectionTestErrorCode =
  | 'INVALID_BASE_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CREDENTIAL_REFERENCE_MISSING'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_STORE_FAILED'
  | 'MODEL_PROFILE_INVALID'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'REQUEST_REJECTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'

export interface ConnectionTestError {
  code: ConnectionTestErrorCode
  titleZh: string
  descriptionZh: string
  retryable: boolean
  providerStatus?: number
}

export type ConnectionTestResult =
  | { success: true; latencyMs: number; providerStatus: number }
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
        return { success: true, latencyMs: this.elapsed(startedAt), providerStatus: response.status }
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
    if (status === 401 || status === 403) {
      return this.error('AUTHENTICATION_FAILED', '认证失败', providerMessage ?? '平台拒绝了当前 API Key。', false, status)
    }
    if (status === 429) {
      return this.error('RATE_LIMITED', '请求频率受限', providerMessage ?? '平台暂时限制了请求频率。', true, status)
    }
    if (status >= 500) {
      return this.error('PROVIDER_ERROR', '平台服务异常', providerMessage ?? '平台服务暂时不可用。', true, status)
    }
    return this.error('REQUEST_REJECTED', '连接测试请求被拒绝', providerMessage ?? '平台未接受最小连接测试请求。', false, status)
  }

  private transportError(cause: unknown): ConnectionTestError {
    if (!(cause instanceof HttpTransportError)) {
      return this.error('NETWORK_ERROR', '网络请求失败', '连接测试发生未知网络错误。', true)
    }
    const description = cause.descriptionZh ?? redactSensitiveText(cause.message)
    switch (cause.code) {
      case 'CREDENTIAL_MISSING':
        return this.error('CREDENTIAL_MISSING', cause.titleZh ?? 'API 凭据缺失', description, false)
      case 'CREDENTIAL_STORE_FAILED':
        return this.error('CREDENTIAL_STORE_FAILED', cause.titleZh ?? '读取安全凭据失败', description, cause.retryable)
      case 'TIMEOUT':
        return this.error('TIMEOUT', '连接测试超时', '平台未在规定时间内响应。', true)
      case 'CANCELLED':
        return this.error('CANCELLED', '连接测试已取消', '连接测试请求已取消。', true)
      case 'INVALID_JSON':
      case 'EMPTY_RESPONSE':
      case 'STREAM_INTERRUPTED':
        return this.error('INVALID_RESPONSE', '平台响应无效', description, cause.retryable)
      default:
        return this.error('NETWORK_ERROR', '网络请求失败', description, cause.retryable)
    }
  }

  private providerMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined
    const error = 'error' in body ? (body as { error?: unknown }).error : undefined
    if (!error || typeof error !== 'object' || !('message' in error)) return undefined
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? redactSensitiveText(message) : undefined
  }

  private error(
    code: ConnectionTestErrorCode,
    titleZh: string,
    descriptionZh: string,
    retryable: boolean,
    providerStatus?: number
  ): ConnectionTestError {
    return { code, titleZh, descriptionZh, retryable, providerStatus }
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
