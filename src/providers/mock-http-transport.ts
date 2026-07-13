import {
  HttpTransportError,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type HttpTransportStreamEvent
} from './http-transport'

export interface MockHttpTransportOptions {
  response?: HttpTransportResponse
  streamEvents?: readonly HttpTransportStreamEvent[]
  transportError?: {
    message?: string
    retryable?: boolean
  }
}

const DEFAULT_RESPONSE: HttpTransportResponse = {
  status: 200,
  body: {
    id: 'mock-chat-completion',
    choices: [{ message: { role: 'assistant', content: '[Mock OpenAI] 模拟响应' }, finish_reason: 'stop' }]
  }
}

const DEFAULT_STREAM_EVENTS: readonly HttpTransportStreamEvent[] = [
  { type: 'data', data: { choices: [{ delta: { content: '[Mock OpenAI] ' }, finish_reason: null }] } },
  { type: 'data', data: { choices: [{ delta: { content: '模拟响应' }, finish_reason: 'stop' }] } },
  { type: 'done' }
]

export class MockHttpTransport implements HttpTransport {
  readonly requests: HttpTransportRequest[] = []
  private readonly response: HttpTransportResponse
  private readonly streamEvents: readonly HttpTransportStreamEvent[]
  private readonly transportError?: MockHttpTransportOptions['transportError']

  constructor(options: MockHttpTransportOptions = {}) {
    this.response = options.response ?? DEFAULT_RESPONSE
    this.streamEvents = options.streamEvents ?? DEFAULT_STREAM_EVENTS
    this.transportError = options.transportError
  }

  async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    this.requests.push(request)
    this.assertRequestCanContinue(request)
    return this.response
  }

  async *stream(request: HttpTransportRequest): AsyncIterable<HttpTransportStreamEvent> {
    this.requests.push(request)
    this.assertRequestCanContinue(request)

    for (const event of this.streamEvents) {
      this.assertRequestCanContinue(request)
      yield event
      if (event.type === 'error' || event.type === 'done') return
    }
  }

  private assertRequestCanContinue(request: HttpTransportRequest): void {
    if (request.signal.aborted) {
      throw new HttpTransportError('Mock HTTP request was cancelled.', { code: 'CANCELLED', retryable: true })
    }
    if (this.transportError) {
      throw new HttpTransportError(this.transportError.message ?? 'Mock HTTP transport failed.', {
        retryable: this.transportError.retryable ?? true
      })
    }
  }
}
