import {
  HttpTransportError,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportStreamEvent
} from './http-transport'
import {
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedError,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from './model-adapter'

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIChatRequestBody {
  model: string
  messages: OpenAIChatMessage[]
  stream: boolean
  max_tokens?: number
}

export class OpenAIChatAdapter implements ModelAdapter {
  constructor(private readonly transport: HttpTransport) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    try {
      const response = await this.transport.send(this.createTransportRequest(request, false))
      if (!this.isSuccessfulStatus(response.status)) {
        throw new ModelAdapterError(this.httpError(response.status, response.body))
      }

      const content = this.responseContent(response.body)
      if (!content) {
        throw new ModelAdapterError({
          code: 'EMPTY_RESPONSE',
          message: 'OpenAI Chat response did not contain assistant content.',
          retryable: false
        })
      }
      return { requestId: request.requestId, content, finishReason: 'stop' }
    } catch (cause) {
      if (cause instanceof ModelAdapterError) throw cause
      throw new ModelAdapterError(this.transportError(request, cause))
    }
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    yield { type: 'started', requestId: request.requestId }

    let transportRequest: HttpTransportRequest
    try {
      transportRequest = this.createTransportRequest(request, true)
    } catch (cause) {
      yield this.errorEvent(request, cause)
      return
    }

    let content = ''
    try {
      for await (const event of this.transport.stream(transportRequest)) {
        if (event.type === 'error') {
          yield {
            type: 'error',
            requestId: request.requestId,
            error: this.httpError(event.status, event.body, event.message)
          }
          return
        }
        if (event.type === 'done') break

        const delta = this.streamDelta(event)
        if (!delta) continue
        content += delta
        yield { type: 'textDelta', requestId: request.requestId, delta }
      }
    } catch (cause) {
      yield this.errorEvent(request, cause)
      return
    }

    if (!content) {
      yield {
        type: 'error',
        requestId: request.requestId,
        error: {
          code: 'EMPTY_RESPONSE',
          message: 'OpenAI Chat stream ended without assistant content.',
          retryable: false
        }
      }
      return
    }

    yield {
      type: 'completed',
      response: { requestId: request.requestId, content, finishReason: 'stop' }
    }
  }

  private createTransportRequest(request: UnifiedRequest, stream: boolean): HttpTransportRequest {
    const runtime = request.modelRuntime
    if (!runtime?.modelId.trim() || !runtime.baseUrl.trim()) {
      throw new ModelAdapterError({
        code: 'REQUEST_FAILED',
        message: 'OpenAI Chat requires a non-empty modelId and baseUrl in modelRuntime.',
        retryable: false
      })
    }

    const body: OpenAIChatRequestBody = {
      model: runtime.modelId,
      messages: [
        {
          role: 'system',
          content: `辩题：${request.topic}\n角色：${request.participant.name}（${request.participant.role}）`
        },
        { role: 'user', content: request.prompt }
      ],
      stream
    }
    if (runtime.maxOutputTokens !== undefined) body.max_tokens = runtime.maxOutputTokens

    return {
      method: 'POST',
      url: `${runtime.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      headers: { 'content-type': 'application/json' },
      body,
      signal: request.signal
    }
  }

  private responseContent(body: unknown): string | undefined {
    const choice = this.firstChoice(body)
    if (!choice || !this.isRecord(choice.message)) return undefined
    return typeof choice.message.content === 'string' ? choice.message.content : undefined
  }

  private streamDelta(event: Extract<HttpTransportStreamEvent, { type: 'data' }>): string | undefined {
    const choice = this.firstChoice(event.data)
    if (!choice || !this.isRecord(choice.delta)) return undefined
    return typeof choice.delta.content === 'string' ? choice.delta.content : undefined
  }

  private firstChoice(body: unknown): Record<string, unknown> | undefined {
    if (!this.isRecord(body) || !Array.isArray(body.choices)) return undefined
    const choice: unknown = body.choices[0]
    return this.isRecord(choice) ? choice : undefined
  }

  private httpError(statusCode: number, body: unknown, fallbackMessage?: string): UnifiedError {
    const providerError = this.isRecord(body) && this.isRecord(body.error) ? body.error : undefined
    const message = providerError && typeof providerError.message === 'string'
      ? providerError.message
      : fallbackMessage ?? `OpenAI Chat request failed with HTTP ${statusCode}.`
    const providerCode = providerError && typeof providerError.code === 'string' ? providerError.code : undefined

    return {
      code: 'REQUEST_FAILED',
      message,
      retryable: statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500,
      statusCode,
      providerCode
    }
  }

  private transportError(request: UnifiedRequest, cause: unknown): UnifiedError {
    if (request.signal.aborted || (cause instanceof HttpTransportError && cause.code === 'CANCELLED')) {
      return { code: 'CANCELLED', message: 'OpenAI Chat request was cancelled.', retryable: true }
    }
    if (cause instanceof HttpTransportError) {
      return { code: 'REQUEST_FAILED', message: cause.message, retryable: cause.retryable }
    }
    return {
      code: 'REQUEST_FAILED',
      message: cause instanceof Error ? cause.message : 'OpenAI Chat transport failed.',
      retryable: true
    }
  }

  private errorEvent(request: UnifiedRequest, cause: unknown): Extract<UnifiedStreamEvent, { type: 'error' }> {
    return {
      type: 'error',
      requestId: request.requestId,
      error: cause instanceof ModelAdapterError ? cause.detail : this.transportError(request, cause)
    }
  }

  private isSuccessfulStatus(status: number): boolean {
    return status >= 200 && status < 300
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}
