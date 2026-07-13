import { describe, expect, it } from 'vitest'

import {
  FetchHttpTransport,
  ModelAdapterError,
  OpenAIChatAdapter,
  type FetchImplementation,
  type HttpTransportRequest,
  type UnifiedRequest
} from '../src/providers'

function transportRequest(signal: AbortSignal = new AbortController().signal): HttpTransportRequest {
  return {
    method: 'POST',
    url: 'https://provider.test/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    body: { model: 'test-model' },
    signal
  }
}

function unifiedRequest(): UnifiedRequest {
  return {
    requestId: 'fetch-request',
    turnId: 'fetch-turn',
    sessionId: 'fetch-session',
    stage: 'affirmative_opening',
    topic: 'Fetch transport 测试',
    participant: { id: 'affirmative', role: 'affirmative', name: '正方' },
    prompt: '请回答。',
    signal: new AbortController().signal,
    modelId: 'test-model',
    messages: [{ role: 'user', content: '请回答。' }],
    stream: false,
    maxTokens: 32,
    runtimeMetadata: {
      sessionId: 'fetch-session',
      role: 'affirmative',
      turnId: 'fetch-turn',
      stage: 'affirmative_opening',
      providerConnectionId: 'fetch-connection',
      baseUrl: 'https://provider.test/v1'
    }
  }
}

function responseFetch(status: number, body: unknown): FetchImplementation {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function pendingFetch(): FetchImplementation {
  return async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

describe('FetchHttpTransport', () => {
  it('parses a normal JSON response without network access', async () => {
    const transport = new FetchHttpTransport({
      fetchImplementation: responseFetch(200, { choices: [{ message: { content: '正常响应' } }] })
    })

    await expect(transport.send(transportRequest())).resolves.toEqual({
      status: 200,
      body: { choices: [{ message: { content: '正常响应' } }] }
    })
  })

  it('parses SSE chunks and the [DONE] marker', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"，第二段"}}]}\r\n\r\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })
    const transport = new FetchHttpTransport({
      fetchImplementation: async () => new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    })
    const events = []

    for await (const event of transport.stream(transportRequest())) events.push(event)

    expect(events).toEqual([
      { type: 'data', data: { choices: [{ delta: { content: '第一段' } }] } },
      { type: 'data', data: { choices: [{ delta: { content: '，第二段' } }] } },
      { type: 'done' }
    ])
  })

  it('distinguishes caller cancellation from timeout', async () => {
    const controller = new AbortController()
    const cancelledTransport = new FetchHttpTransport({ fetchImplementation: pendingFetch(), timeoutMs: 1_000 })
    const cancelled = cancelledTransport.send(transportRequest(controller.signal))
    controller.abort()

    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED', retryable: true })

    const timeoutTransport = new FetchHttpTransport({ fetchImplementation: pendingFetch(), timeoutMs: 5 })
    await expect(timeoutTransport.send(transportRequest())).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true
    })
  })

  it.each([
    [401, false],
    [429, true],
    [500, true]
  ] as const)('preserves HTTP %s for Adapter error normalization', async (status, retryable) => {
    const transport = new FetchHttpTransport({
      fetchImplementation: responseFetch(status, {
        error: { code: `provider-${status}`, message: `provider status ${status}` }
      })
    })
    const completion = new OpenAIChatAdapter(transport).complete(unifiedRequest())

    await expect(completion).rejects.toBeInstanceOf(ModelAdapterError)
    await expect(completion).rejects.toMatchObject({
      detail: {
        code: 'REQUEST_FAILED',
        statusCode: status,
        providerCode: `provider-${status}`,
        retryable
      }
    })
  })

  it('reports invalid JSON and empty successful responses', async () => {
    const invalidJson = new FetchHttpTransport({
      fetchImplementation: async () => new Response('{invalid', { status: 200 })
    })
    const empty = new FetchHttpTransport({
      fetchImplementation: async () => new Response('', { status: 200 })
    })

    await expect(invalidJson.send(transportRequest())).rejects.toMatchObject({ code: 'INVALID_JSON' })
    await expect(empty.send(transportRequest())).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('reports a stream that closes before [DONE] as interrupted', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"未完成"}}]}\n\n'))
        controller.close()
      }
    })
    const transport = new FetchHttpTransport({
      fetchImplementation: async () => new Response(stream, { status: 200 })
    })
    const consume = async (): Promise<void> => {
      for await (const _event of transport.stream(transportRequest())) {
        // Consume until the transport reports the interrupted stream.
      }
    }

    await expect(consume()).rejects.toMatchObject({ code: 'STREAM_INTERRUPTED', retryable: true })
  })
})
