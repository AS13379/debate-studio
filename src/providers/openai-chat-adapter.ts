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
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
  name?: string
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: {
      google?: {
        thought_signature?: string
      }
    }
  }>
}

export interface OpenAIChatRequestBody {
  model: string
  messages: OpenAIChatMessage[]
  stream: boolean
  max_tokens?: number
  max_completion_tokens?: number
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }>
  tool_choice?: 'auto' | 'none'
  thinking?: { type: 'enabled' | 'disabled' }
  enable_thinking?: boolean
  reasoning_effort?: 'max'
  temperature?: number
  extra_body?: {
    google: {
      thinking_config: {
        include_thoughts: boolean
      }
    }
  }
}

interface StreamToolCallAccumulator {
  id: string
  name: string
  arguments: string
  googleThoughtSignature?: string
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
      const finishReason = this.responseFinishReason(response.body)
      const reasoningContent = this.responseReasoningContent(response.body)
      if (finishReason === 'length') {
        throw new ModelAdapterError(this.outputLimitError(Boolean(reasoningContent)))
      }
      const toolCalls = this.responseToolCalls(response.body)
      if (!content && !toolCalls.length) {
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
        ...(reasoningContent ? { reasoningContent } : {}),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        usage: this.responseUsage(response.body)
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
    let reasoningContent = ''
    const streamedToolCalls = new Map<number, StreamToolCallAccumulator>()
    let finishReason: string | undefined
    let usage: UnifiedResponse['usage']
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

        usage = this.responseUsage(event.data) ?? usage
        finishReason = this.streamFinishReason(event) ?? finishReason
        this.accumulateStreamToolCalls(event, streamedToolCalls)

        const reasoningDelta = this.streamReasoningDelta(event)
        if (reasoningDelta) {
          reasoningContent += reasoningDelta
          yield { type: 'reasoningDelta', requestId: request.requestId, delta: reasoningDelta }
        }

        const textDelta = this.streamTextDelta(event)
        if (textDelta) {
          content += textDelta
          yield { type: 'textDelta', requestId: request.requestId, delta: textDelta }
        }
      }
    } catch (cause) {
      yield this.errorEvent(request, cause)
      return
    }

    if (finishReason === 'length') {
      yield {
        type: 'error',
        requestId: request.requestId,
        error: this.outputLimitError(Boolean(reasoningContent))
      }
      return
    }

    let toolCalls: UnifiedToolCall[]
    try {
      toolCalls = this.streamToolCalls(streamedToolCalls)
    } catch (cause) {
      yield this.errorEvent(request, cause)
      return
    }

    if (!content && !toolCalls.length) {
      yield {
        type: 'error',
        requestId: request.requestId,
        error: {
          code: 'EMPTY_RESPONSE',
          message: `OpenAI Chat stream ended without assistant content (finish_reason=${finishReason ?? 'missing'}, reasoning_content=${reasoningContent ? 'present' : 'absent'}).`,
          retryable: false
        }
      }
      return
    }

    yield {
      type: 'completed',
      response: {
        requestId: request.requestId,
        content,
        finishReason: toolCalls.length || finishReason === 'tool_calls' ? 'tool_calls' : 'stop',
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        usage
      }
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
        content: message.imageInputs?.length
          ? [
              { type: 'text' as const, text: message.content },
              ...message.imageInputs.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
              }))
            ]
          : message.content,
        ...(message.role === 'assistant' && message.reasoningContent
          ? { reasoning_content: message.reasoningContent }
          : {}),
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                ...(call.providerMetadata?.googleThoughtSignature
                  ? {
                      extra_content: {
                        google: { thought_signature: call.providerMetadata.googleThoughtSignature }
                      }
                    }
                  : {})
              }))
            }
          : {})
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
    this.applyReasoningConfiguration(body, request)

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

  private applyReasoningConfiguration(body: OpenAIChatRequestBody, request: UnifiedRequest): void {
    const enabled = request.runtimeMetadata.reasoningEnabled
    const providerId = request.runtimeMetadata.providerId?.toLowerCase()
    const modelId = request.modelId.toLowerCase()

    if (providerId === 'moonshot' || providerId === 'kimi') {
      // Kimi K3 always reasons and its provider default output budget is much
      // larger than the historical local profile defaults. Sending max_tokens
      // here can consume the entire budget on reasoning before any assistant
      // content or complete tool arguments are emitted, so leave the budget to
      // the service even when an older ModelProfile still contains 800/16000.
      if (/^kimi-k3(?:$|[-.])/.test(modelId)) {
        delete body.max_tokens
        body.max_completion_tokens = 1_048_576
        if (enabled !== false) body.reasoning_effort = 'max'
        return
      }

      // K2.5/K2.6 thinking mode has the same failure mode. Keep an explicit
      // user-selected cap only when thinking is disabled; otherwise use the
      // provider's model-specific default.
      if (/^kimi-k2\.(?:5|6)(?:$|[-.])/.test(modelId)) {
        if (enabled === undefined) return
        body.thinking = { type: enabled ? 'enabled' : 'disabled' }
        if (enabled) {
          delete body.max_tokens
          body.temperature = 1
        }
        return
      }

      if (enabled && /(?:thinking|reasoner)/.test(modelId)) {
        delete body.max_tokens
        body.temperature = 1
      }
      return
    }

    if (enabled === undefined) return

    if (providerId === 'deepseek' || providerId === 'zhipu' || providerId === 'xiaomi-mimo') {
      body.thinking = { type: enabled ? 'enabled' : 'disabled' }
      return
    }
    if (providerId === 'alibaba-dashscope') {
      body.enable_thinking = enabled
      return
    }
    if (providerId === 'gemini') {
      if (enabled) {
        body.extra_body = {
          google: { thinking_config: { include_thoughts: true } }
        }
      }
      return
    }
  }

  private outputLimitError(reasoningPresent: boolean): UnifiedError {
    return {
      code: 'REQUEST_FAILED',
      message: `OpenAI Chat reached max_tokens before completing assistant output (reasoning_content=${reasoningPresent ? 'present' : 'absent'}).`,
      titleZh: '模型输出上限不足',
      descriptionZh: reasoningPresent
        ? '模型的思考内容已经占满本轮输出额度，尚未生成完整正文或工具参数。已收到的思考内容和正文会保留。'
        : '模型在生成完整正文或工具参数前用完了本轮输出额度，已收到的部分文本会保留。',
      retryable: true,
      suggestedActionZh: '该请求已由服务商的输出上限截断。Kimi 思考模型会使用服务商默认额度；若仍失败，请缩小任务或更换模型。'
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
      const argumentsObject = this.parseToolArguments(item.function.name, rawArguments)
      const googleThoughtSignature = this.toolCallThoughtSignature(item)
      return [{
        id: item.id,
        name: item.function.name,
        arguments: argumentsObject,
        ...(googleThoughtSignature
          ? { providerMetadata: { googleThoughtSignature } }
          : {})
      }]
    })
  }

  private responseFinishReason(body: unknown): string | undefined {
    const choice = this.firstChoice(body)
    return choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined
  }

  private responseReasoningContent(body: unknown): string | undefined {
    const choice = this.firstChoice(body)
    if (!choice || !this.isRecord(choice.message)) return undefined
    const reasoningContent = choice.message.reasoning_content
    return typeof reasoningContent === 'string' && reasoningContent.length > 0
      ? reasoningContent
      : undefined
  }

  private responseUsage(body: unknown): UnifiedResponse['usage'] {
    if (!this.isRecord(body) || !this.isRecord(body.usage)) return undefined
    const inputTokens = typeof body.usage.prompt_tokens === 'number' ? body.usage.prompt_tokens : undefined
    const outputTokens = typeof body.usage.completion_tokens === 'number' ? body.usage.completion_tokens : undefined
    const totalTokens = typeof body.usage.total_tokens === 'number' ? body.usage.total_tokens : undefined
    return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens }
  }

  private hasReasoningContent(body: unknown): boolean {
    return Boolean(this.responseReasoningContent(body))
  }

  private streamTextDelta(event: Extract<HttpTransportStreamEvent, { type: 'data' }>): string | undefined {
    const choice = this.firstChoice(event.data)
    if (!choice || !this.isRecord(choice.delta)) return undefined
    return typeof choice.delta.content === 'string' ? choice.delta.content : undefined
  }

  private streamReasoningDelta(event: Extract<HttpTransportStreamEvent, { type: 'data' }>): string | undefined {
    const choice = this.firstChoice(event.data)
    if (!choice || !this.isRecord(choice.delta)) return undefined
    if (typeof choice.delta.reasoning_content === 'string') return choice.delta.reasoning_content
    return typeof choice.delta.reasoning === 'string' ? choice.delta.reasoning : undefined
  }

  private streamFinishReason(event: Extract<HttpTransportStreamEvent, { type: 'data' }>): string | undefined {
    const choice = this.firstChoice(event.data)
    return choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined
  }

  private accumulateStreamToolCalls(
    event: Extract<HttpTransportStreamEvent, { type: 'data' }>,
    target: Map<number, StreamToolCallAccumulator>
  ): void {
    const choice = this.firstChoice(event.data)
    if (!choice || !this.isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) return

    choice.delta.tool_calls.forEach((item, arrayIndex) => {
      if (!this.isRecord(item)) return
      const index = typeof item.index === 'number' ? item.index : arrayIndex
      const current = target.get(index) ?? { id: '', name: '', arguments: '' }
      if (typeof item.id === 'string' && item.id) current.id = item.id
      if (this.isRecord(item.function)) {
        if (typeof item.function.name === 'string' && item.function.name) current.name = item.function.name
        if (typeof item.function.arguments === 'string') current.arguments += item.function.arguments
      }
      const signature = this.toolCallThoughtSignature(item)
      if (signature) current.googleThoughtSignature = signature
      target.set(index, current)
    })
  }

  private streamToolCalls(source: Map<number, StreamToolCallAccumulator>): UnifiedToolCall[] {
    return [...source.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, item], index): UnifiedToolCall[] => {
        if (!item.name) return []
        return [{
          id: item.id || `tool-call-${index + 1}`,
          name: item.name,
          arguments: this.parseToolArguments(item.name, item.arguments || '{}'),
          ...(item.googleThoughtSignature
            ? { providerMetadata: { googleThoughtSignature: item.googleThoughtSignature } }
            : {})
        }]
      })
  }

  private parseToolArguments(name: string, rawArguments: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(rawArguments)
      if (this.isRecord(parsed)) return parsed
      throw new Error('parsed value is not an object')
    } catch (cause) {
      const trimmedArguments = rawArguments.trim()
      const parseError = cause instanceof Error ? cause.message.replace(/\s+/g, ' ').slice(0, 160) : 'unknown'
      const hasObjectEnvelope = trimmedArguments.startsWith('{') && trimmedArguments.endsWith('}')
      throw new ModelAdapterError({
        code: 'REQUEST_FAILED',
        message: `Tool call ${name} returned invalid JSON arguments (arguments_length=${rawArguments.length}, object_envelope=${hasObjectEnvelope}, parse_error=${parseError}).`,
        titleZh: '工具参数无法解析',
        descriptionZh: '模型返回的结构化工具参数不是有效 JSON。',
        retryable: true
      })
    }
  }

  private toolCallThoughtSignature(item: Record<string, unknown>): string | undefined {
    if (!this.isRecord(item.extra_content) || !this.isRecord(item.extra_content.google)) return undefined
    const signature = item.extra_content.google.thought_signature
    return typeof signature === 'string' && signature.length > 0 ? signature : undefined
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
