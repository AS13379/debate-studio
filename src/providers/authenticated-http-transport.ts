import type { CredentialStore } from '../security'
import { redactForExport, redactSensitiveText } from '../security'
import {
  HttpTransportError,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type HttpTransportStreamEvent
} from './http-transport'

export type CredentialReferenceResolver = (
  providerConnectionId: string
) => string | undefined | Promise<string | undefined>

interface AuthenticatedRequest {
  request: HttpTransportRequest
  credential: string
}

export class AuthenticatedHttpTransport implements HttpTransport {
  constructor(
    private readonly delegate: HttpTransport,
    private readonly credentialStore: CredentialStore,
    private readonly resolveCredentialReference: CredentialReferenceResolver
  ) {}

  async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    const authenticated = await this.authenticate(request)
    try {
      const response = await this.delegate.send(authenticated.request)
      return {
        status: response.status,
        body: redactForExport(response.body, [authenticated.credential])
      }
    } catch (cause) {
      throw this.sanitizeError(cause, authenticated.credential)
    }
  }

  async *stream(request: HttpTransportRequest): AsyncIterable<HttpTransportStreamEvent> {
    const authenticated = await this.authenticate(request)
    try {
      for await (const event of this.delegate.stream(authenticated.request)) {
        if (event.type === 'data') {
          yield { type: 'data', data: redactForExport(event.data, [authenticated.credential]) }
        } else if (event.type === 'error') {
          yield {
            ...event,
            body: redactForExport(event.body, [authenticated.credential]),
            message: event.message ? redactSensitiveText(event.message, [authenticated.credential]) : undefined
          }
        } else {
          yield event
        }
      }
    } catch (cause) {
      throw this.sanitizeError(cause, authenticated.credential)
    }
  }

  private async authenticate(request: HttpTransportRequest): Promise<AuthenticatedRequest> {
    const connectionId = request.metadata?.providerConnectionId
    if (!connectionId) throw this.missingCredential('请求缺少 ProviderConnection 上下文。')

    let reference: string | undefined
    try {
      reference = await this.resolveCredentialReference(connectionId)
    } catch {
      throw new HttpTransportError('读取凭据引用失败。', {
        code: 'CREDENTIAL_STORE_FAILED',
        retryable: true,
        titleZh: '读取凭据引用失败',
        descriptionZh: '无法从本地连接配置中读取凭据引用，请检查数据库状态后重试。'
      })
    }
    if (!reference?.trim()) throw this.missingCredential('该平台连接没有有效的凭据引用。')

    let credentialResult: Awaited<ReturnType<CredentialStore['getCredential']>>
    try {
      credentialResult = await this.credentialStore.getCredential(reference)
    } catch {
      throw new HttpTransportError('系统安全存储读取失败。', {
        code: 'CREDENTIAL_STORE_FAILED',
        retryable: true,
        titleZh: '读取安全凭据失败',
        descriptionZh: '系统加密存储暂时不可用，请确认当前用户会话未锁定或稍后重试。'
      })
    }
    if (!credentialResult.ok) {
      throw new HttpTransportError(redactSensitiveText(credentialResult.error.message), {
        code: 'CREDENTIAL_STORE_FAILED',
        retryable: credentialResult.error.retryable,
        titleZh: '读取安全凭据失败',
        descriptionZh: '无法从系统加密存储读取 API Key，请确认当前用户会话未锁定或稍后重试。'
      })
    }
    if (!credentialResult.value) throw this.missingCredential('系统安全存储中没有找到该连接的 API Key。')

    return {
      credential: credentialResult.value,
      request: {
        ...request,
        headers: {
          ...request.headers,
          authorization: `Bearer ${credentialResult.value}`
        }
      }
    }
  }

  private missingCredential(descriptionZh: string): HttpTransportError {
    return new HttpTransportError('API credential is unavailable.', {
      code: 'CREDENTIAL_MISSING',
      retryable: false,
      titleZh: 'API 凭据缺失',
      descriptionZh
    })
  }

  private sanitizeError(cause: unknown, credential: string): HttpTransportError {
    if (cause instanceof HttpTransportError) {
      return new HttpTransportError(redactSensitiveText(cause.message, [credential]), {
        code: cause.code,
        retryable: cause.retryable,
        statusCode: cause.statusCode,
        titleZh: cause.titleZh,
        descriptionZh: cause.descriptionZh
          ? redactSensitiveText(cause.descriptionZh, [credential])
          : undefined
      })
    }
    return new HttpTransportError(
      redactSensitiveText(cause instanceof Error ? cause.message : 'Authenticated HTTP request failed.', [credential]),
      { code: 'TRANSPORT_FAILED', retryable: true }
    )
  }
}
