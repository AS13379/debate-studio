import {
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedError,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from './model-adapter'

export interface MockAdapterOptions {
  responseText?: string
  chunks?: string[]
  delayMs?: number
  error?: {
    message?: string
    atChunk?: number
  }
  plannerResponse?: string
}

export class MockAdapter implements ModelAdapter {
  private readonly chunks: string[]
  private readonly delayMs: number
  private readonly simulatedError?: MockAdapterOptions['error']
  private readonly plannerResponse?: string

  constructor(options: MockAdapterOptions = {}) {
    this.chunks = options.chunks ?? [options.responseText ?? '[Mock] 模拟模型发言']
    this.delayMs = options.delayMs ?? 0
    this.simulatedError = options.error
    this.plannerResponse = options.plannerResponse
  }

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    let response: UnifiedResponse | undefined
    for await (const event of this.stream(request)) {
      if (event.type === 'error') throw new ModelAdapterError(event.error)
      if (event.type === 'completed') response = event.response
    }

    if (!response) {
      throw new ModelAdapterError({ code: 'EMPTY_RESPONSE', message: 'Mock adapter returned no response.', retryable: true })
    }
    return response
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    yield { type: 'started', requestId: request.requestId }

    if (this.simulatedError && this.simulatedError.atChunk === undefined) {
      yield this.errorEvent(request, this.simulatedError?.message)
      return
    }

    let content = ''
    const chunks = request.runtimeMetadata.purpose === 'debate-planning'
      ? [this.plannerResponse ?? mockPlanResponse(request.topic)]
      : this.chunks
    for (const [index, chunk] of chunks.entries()) {
      if (request.signal.aborted || (await this.waitForDelay(request.signal))) {
        yield this.cancelledEvent(request)
        return
      }
      if (this.simulatedError?.atChunk === index) {
        yield this.errorEvent(request, this.simulatedError.message)
        return
      }

      content += chunk
      yield { type: 'textDelta', requestId: request.requestId, delta: chunk }
    }

    if (request.signal.aborted) {
      yield this.cancelledEvent(request)
      return
    }

    yield {
      type: 'completed',
      response: { requestId: request.requestId, content, finishReason: 'stop' }
    }
  }

  private async waitForDelay(signal: AbortSignal): Promise<boolean> {
    if (this.delayMs <= 0) return signal.aborted

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve(false)
      }, this.delayMs)
      const onAbort = (): void => {
        clearTimeout(timeout)
        resolve(true)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private errorEvent(request: UnifiedRequest, message = 'Mock request failed.'): UnifiedStreamEvent {
    const error: UnifiedError = { code: 'REQUEST_FAILED', message, retryable: true }
    return { type: 'error', requestId: request.requestId, error }
  }

  private cancelledEvent(request: UnifiedRequest): UnifiedStreamEvent {
    return {
      type: 'error',
      requestId: request.requestId,
      error: { code: 'CANCELLED', message: 'Mock request was cancelled.', retryable: true }
    }
  }
}

function mockPlanResponse(topic: string): string {
  return JSON.stringify({
    background: `围绕“${topic}”界定讨论范围、适用条件与评价标准。`,
    affirmativePosition: `正方主张“${topic}”成立，并将从可行性、收益与长期影响展开论证。`,
    negativePosition: `反方主张“${topic}”不成立或条件不足，并将从风险、代价与替代方案展开论证。`,
    keyQuestions: ['核心概念应如何界定？', '主要收益与代价分别由谁承担？', '在什么条件下结论可能发生变化？'],
    researchDirections: ['查找权威定义与适用边界', '比较支持和反对立场的实证材料', '识别典型案例与反例'],
    evidenceSuggestions: ['官方统计或政策文件', '同行评审研究', '可核验的现实案例']
  })
}
