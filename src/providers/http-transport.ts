export interface HttpTransportRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Readonly<Record<string, string>>
  body?: unknown
  signal: AbortSignal
  metadata?: {
    providerConnectionId?: string
  }
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
  code?: HttpTransportErrorCode
  retryable?: boolean
  statusCode?: number
  titleZh?: string
  descriptionZh?: string
}

export type HttpTransportErrorCode =
  | 'TRANSPORT_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'INVALID_JSON'
  | 'EMPTY_RESPONSE'
  | 'STREAM_INTERRUPTED'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_STORE_FAILED'

export class HttpTransportError extends Error {
  readonly code: HttpTransportErrorCode
  readonly retryable: boolean
  readonly statusCode?: number
  readonly titleZh?: string
  readonly descriptionZh?: string

  constructor(message: string, options: HttpTransportErrorOptions = {}) {
    super(message)
    this.name = 'HttpTransportError'
    this.code = options.code ?? 'TRANSPORT_FAILED'
    this.retryable = options.retryable ?? true
    this.statusCode = options.statusCode
    this.titleZh = options.titleZh
    this.descriptionZh = options.descriptionZh
  }
}
