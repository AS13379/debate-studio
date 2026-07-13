import {
  HttpTransportError,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type HttpTransportStreamEvent
} from './http-transport'

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FetchHttpTransportOptions {
  fetchImplementation?: FetchImplementation
  timeoutMs?: number
}

interface AbortScope {
  signal: AbortSignal
  timedOut(): boolean
  externallyAborted(): boolean
  cleanup(): void
}

export class FetchHttpTransport implements HttpTransport {
  private readonly fetchImplementation: FetchImplementation
  private readonly timeoutMs: number

  constructor(options: FetchHttpTransportOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    const scope = this.createAbortScope(request.signal)
    try {
      const response = await this.fetchImplementation(request.url, this.requestInit(request, scope.signal))
      const body = await this.readJsonResponse(response, response.ok)
      return { status: response.status, body }
    } catch (cause) {
      throw this.normalizeError(cause, scope, false)
    } finally {
      scope.cleanup()
    }
  }

  async *stream(request: HttpTransportRequest): AsyncIterable<HttpTransportStreamEvent> {
    const scope = this.createAbortScope(request.signal)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await this.fetchImplementation(request.url, this.requestInit(request, scope.signal, true))
      if (!response.ok) {
        const body = await this.readJsonResponse(response, false)
        yield { type: 'error', status: response.status, body }
        return
      }
      if (!response.body) {
        throw new HttpTransportError('SSE response body is empty.', {
          code: 'EMPTY_RESPONSE',
          retryable: true
        })
      }

      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedData = false

      while (true) {
        const result = await reader.read()
        if (result.done) {
          buffer += decoder.decode()
          break
        }
        buffer += decoder.decode(result.value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = this.parseSseBlock(block)
          if (event?.type === 'done') {
            yield event
            return
          }
          if (event?.type === 'data') {
            receivedData = true
            yield event
          }
          boundary = buffer.indexOf('\n\n')
        }
      }

      buffer = buffer.replace(/\r\n/g, '\n').trim()
      if (buffer) {
        const event = this.parseSseBlock(buffer)
        if (event?.type === 'done') {
          yield event
          return
        }
        if (event?.type === 'data') {
          receivedData = true
          yield event
        }
      }

      throw new HttpTransportError(
        receivedData ? 'SSE stream ended before the [DONE] marker.' : 'SSE stream returned no events.',
        {
          code: receivedData ? 'STREAM_INTERRUPTED' : 'EMPTY_RESPONSE',
          retryable: true
        }
      )
    } catch (cause) {
      throw this.normalizeError(cause, scope, true)
    } finally {
      reader?.releaseLock()
      scope.cleanup()
    }
  }

  private requestInit(request: HttpTransportRequest, signal: AbortSignal, streaming = false): RequestInit {
    const headers = streaming
      ? { ...request.headers, accept: 'text/event-stream' }
      : { ...request.headers }
    return {
      method: request.method,
      headers,
      body: request.method === 'POST' && request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal
    }
  }

  private async readJsonResponse(response: Response, requireBody: boolean): Promise<unknown> {
    const text = await response.text()
    if (!text.trim()) {
      if (!requireBody) return undefined
      throw new HttpTransportError('HTTP response body is empty.', {
        code: 'EMPTY_RESPONSE',
        retryable: true,
        statusCode: response.status
      })
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      if (!response.ok) return { error: { message: text } }
      throw new HttpTransportError('HTTP response body is not valid JSON.', {
        code: 'INVALID_JSON',
        retryable: false,
        statusCode: response.status
      })
    }
  }

  private parseSseBlock(block: string): Extract<HttpTransportStreamEvent, { type: 'data' | 'done' }> | undefined {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data) return undefined
    if (data === '[DONE]') return { type: 'done' }
    try {
      return { type: 'data', data: JSON.parse(data) as unknown }
    } catch {
      throw new HttpTransportError('SSE event contains invalid JSON.', {
        code: 'INVALID_JSON',
        retryable: false
      })
    }
  }

  private createAbortScope(externalSignal: AbortSignal): AbortScope {
    const controller = new AbortController()
    let timedOut = false
    let externallyAborted = externalSignal.aborted
    const onAbort = (): void => {
      externallyAborted = true
      controller.abort(externalSignal.reason)
    }
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onAbort, { once: true })

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('Request timed out.'))
    }, this.timeoutMs)

    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      externallyAborted: () => externallyAborted,
      cleanup: () => {
        clearTimeout(timeout)
        externalSignal.removeEventListener('abort', onAbort)
      }
    }
  }

  private normalizeError(cause: unknown, scope: AbortScope, streaming: boolean): HttpTransportError {
    if (cause instanceof HttpTransportError) return cause
    if (scope.timedOut()) {
      return new HttpTransportError('HTTP request timed out.', { code: 'TIMEOUT', retryable: true })
    }
    if (scope.externallyAborted()) {
      return new HttpTransportError('HTTP request was cancelled.', { code: 'CANCELLED', retryable: true })
    }
    return new HttpTransportError(
      cause instanceof Error ? cause.message : streaming ? 'HTTP stream was interrupted.' : 'HTTP request failed.',
      { code: streaming ? 'STREAM_INTERRUPTED' : 'TRANSPORT_FAILED', retryable: true }
    )
  }
}
