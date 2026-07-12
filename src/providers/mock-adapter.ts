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
}

export class MockAdapter implements ModelAdapter {
  private readonly chunks: string[]
  private readonly delayMs: number
  private readonly simulatedError?: MockAdapterOptions['error']

  constructor(options: MockAdapterOptions = {}) {
    this.chunks = options.chunks ?? [options.responseText ?? '[Mock] 模拟模型发言']
    this.delayMs = options.delayMs ?? 0
    this.simulatedError = options.error
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
    for (const [index, chunk] of this.chunks.entries()) {
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
