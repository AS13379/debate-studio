export interface HttpTransportRequest {
  method: 'POST'
  url: string
  headers: Readonly<Record<string, string>>
  body: unknown
  signal: AbortSignal
}

export interface HttpTransportResponse {
  status: number
  body: unknown
}

export type HttpTransportStreamEvent =
  | { type: 'data'; data: unknown }
  | { type: 'error'; status: number; body?: unknown; message?: string }
  | { type: 'done' }

export interface HttpTransport {
  send(request: HttpTransportRequest): Promise<HttpTransportResponse>
  stream(request: HttpTransportRequest): AsyncIterable<HttpTransportStreamEvent>
}

export interface HttpTransportErrorOptions {
  code?: 'TRANSPORT_FAILED' | 'CANCELLED'
  retryable?: boolean
  cause?: unknown
}

export class HttpTransportError extends Error {
  readonly code: 'TRANSPORT_FAILED' | 'CANCELLED'
  readonly retryable: boolean
  override readonly cause?: unknown

  constructor(message: string, options: HttpTransportErrorOptions = {}) {
    super(message)
    this.name = 'HttpTransportError'
    this.code = options.code ?? 'TRANSPORT_FAILED'
    this.retryable = options.retryable ?? true
    this.cause = options.cause
  }
}
