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
  type UnifiedStreamEvent,
  type UnifiedToolCall
} from './model-adapter'
import { presentProviderFailure } from './provider-error-presentation'

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface OpenAIChatRequestBody {
  model: string
  messages: OpenAIChatMessage[]
  stream: boolean
  max_tokens?: number
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }>
  tool_choice?: 'auto' | 'none'
  thinking?: { type: 'enabled' | 'disabled' }
}

export class OpenAIChatAdapter implements ModelAdapter {
  constructor(private readonly transport: HttpTransport) {}

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    try {
      const response = await this.transport.send(this.createTransportRequest(request, false))
      if (!this.isSuccessfulStatus(response.status)) {
        throw new ModelAdapterError(this.httpError(response.status, response.body))
      }

      const content = this.responseContent(response.body) ?? ''
      const toolCalls = this.responseToolCalls(response.body)
      if (!content && !toolCalls.length) {
        const finishReason = this.responseFinishReason(response.body)
        if (finishReason === 'length') {
          throw new ModelAdapterError({
            code: 'REQUEST_FAILED',
            message: 'OpenAI Chat reached max_tokens before producing assistant content.',
            titleZh: '模型输出上限不足',
            descriptionZh: '模型在生成可用回复前已用完最大输出 Token。',
            retryable: true,
            suggestedActionZh: '提高该 ModelProfile 的最大输出 Token 后重试。'
          })
        }
        throw new ModelAdapterError({
          code: 'EMPTY_RESPONSE',
          message: `OpenAI Chat response did not contain assistant content (finish_reason=${finishReason ?? 'missing'}, reasoning_content=${this.hasReasoningContent(response.body) ? 'present' : 'absent'}).`,
          retryable: false
        })
      }
      return {
        requestId: request.requestId,
        content,
        finishReason: toolCalls.length ? 'tool_calls' : 'stop',
        toolCalls: toolCalls.length ? toolCalls : undefined
      }
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
    const baseUrl = request.runtimeMetadata.baseUrl
    if (!request.modelId.trim() || !baseUrl?.trim()) {
      throw new ModelAdapterError({
        code: 'REQUEST_FAILED',
        message: 'OpenAI Chat requires a non-empty modelId and runtimeMetadata.baseUrl.',
        ...presentProviderFailure({
          message: 'OpenAI Chat requires a non-empty modelId and runtimeMetadata.baseUrl.',
          titleZh: '模型或 Base URL 缺失',
          descriptionZh: '运行时没有可用的 Model ID 或 Base URL。',
          retryable: false
        })
      })
    }

    const body: OpenAIChatRequestBody = {
      model: request.modelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name,
        tool_call_id: message.toolCallId,
        tool_calls: message.toolCalls?.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      })),
      stream
    }
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }))
      body.tool_choice = request.toolChoice ?? 'auto'
    }
    if (request.runtimeMetadata.providerId === 'deepseek' && request.runtimeMetadata.reasoningEnabled === false) {
      body.thinking = { type: 'disabled' }
    }

    return {
      method: 'POST',
      url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      headers: { 'content-type': 'application/json' },
      body,
      signal: request.signal,
      metadata: {
        providerConnectionId: request.runtimeMetadata.providerConnectionId
      }
    }
  }

  private responseContent(body: unknown): string | undefined {
    const choice = this.firstChoice(body)
    if (!choice || !this.isRecord(choice.message)) return undefined
    return typeof choice.message.content === 'string' ? choice.message.content : undefined
  }

  private responseToolCalls(body: unknown): UnifiedToolCall[] {
    const choice = this.firstChoice(body)
    if (!choice || !this.isRecord(choice.message) || !Array.isArray(choice.message.tool_calls)) return []
    return choice.message.tool_calls.flatMap((item): UnifiedToolCall[] => {
      if (!this.isRecord(item) || typeof item.id !== 'string' || !this.isRecord(item.function) || typeof item.function.name !== 'string') return []
      const rawArguments = typeof item.function.arguments === 'string' ? item.function.arguments : '{}'
      try {
        const parsed: unknown = JSON.parse(rawArguments)
        if (!this.isRecord(parsed)) return []
        return [{ id: item.id, name: item.function.name, arguments: parsed }]
      } catch (cause) {
        const trimmedArguments = rawArguments.trim()
        const parseError = cause instanceof Error ? cause.message.replace(/\s+/g, ' ').slice(0, 160) : 'unknown'
        const hasObjectEnvelope = trimmedArguments.startsWith('{') && trimmedArguments.endsWith('}')
        throw new ModelAdapterError({
          code: 'REQUEST_FAILED',
          message: `Tool call ${item.function.name} returned invalid JSON arguments (arguments_length=${rawArguments.length}, object_envelope=${hasObjectEnvelope}, parse_error=${parseError}).`,
          titleZh: '工具参数无法解析',
          descriptionZh: '模型返回的结构化工具参数不是有效 JSON。',
          retryable: true
        })
      }
    })
  }

  private responseFinishReason(body: unknown): string | undefined {
    const choice = this.firstChoice(body)
    return choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined
  }

  private hasReasoningContent(body: unknown): boolean {
    const choice = this.firstChoice(body)
    return Boolean(choice && this.isRecord(choice.message) && typeof choice.message.reasoning_content === 'string' && choice.message.reasoning_content.length)
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
    const providerCode = providerError && typeof providerError.code === 'string'
      ? providerError.code
      : providerError && typeof providerError.type === 'string'
        ? providerError.type
        : undefined
    const presentation = presentProviderFailure({ statusCode, providerCode, message })

    return {
      code: 'REQUEST_FAILED',
      message,
      statusCode,
      providerCode,
      ...presentation
    }
  }

  private transportError(request: UnifiedRequest, cause: unknown): UnifiedError {
    if (request.signal.aborted || (cause instanceof HttpTransportError && cause.code === 'CANCELLED')) {
      const message = 'OpenAI Chat request was cancelled.'
      return {
        code: 'CANCELLED',
        message,
        ...presentProviderFailure({ message, transportCode: 'CANCELLED' })
      }
    }
    if (cause instanceof HttpTransportError) {
      const presentation = presentProviderFailure({
        message: cause.message,
        transportCode: cause.code,
        statusCode: cause.statusCode,
        titleZh: cause.titleZh,
        descriptionZh: cause.descriptionZh,
        retryable: cause.retryable
      })
      return {
        code: 'REQUEST_FAILED',
        message: cause.message,
        statusCode: cause.statusCode,
        ...presentation
      }
    }
    const message = cause instanceof Error ? cause.message : 'OpenAI Chat transport failed.'
    const presentation = presentProviderFailure({ message, transportCode: 'TRANSPORT_FAILED' })
    return {
      code: 'REQUEST_FAILED',
      message,
      ...presentation
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
