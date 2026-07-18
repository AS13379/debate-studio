import { describe, expect, it } from 'vitest'

import {
  AdapterRegistry,
  FetchHttpTransport,
  MockHttpTransport,
  ModelAdapterError,
  OpenAIChatAdapter,
  type OpenAIChatRequestBody,
  type UnifiedRequest,
  type UnifiedStreamEvent
} from '../src/providers'

function request(): UnifiedRequest {
  return {
    requestId: 'request-openai',
    turnId: 'turn-openai',
    sessionId: 'session-openai',
    stage: 'affirmative_opening',
    topic: '人工智能是否应当拥有法律人格',
    participant: { id: 'affirmative-openai', role: 'affirmative', name: '正方' },
    prompt: '请完成正方立论。',
    signal: new AbortController().signal,
    modelId: 'gpt-test',
    messages: [
      { role: 'system', content: '辩题：人工智能是否应当拥有法律人格\n角色：正方（affirmative）' },
      { role: 'user', content: '请完成正方立论。' }
    ],
    stream: false,
    maxTokens: 2048,
    runtimeMetadata: {
      sessionId: 'session-openai',
      role: 'affirmative',
      turnId: 'turn-openai',
      stage: 'affirmative_opening',
      baseUrl: 'https://api.example.test/v1/',
      modelProfileId: 'profile-openai',
      providerConnectionId: 'connection-openai'
    }
  }
}

describe('OpenAIChatAdapter', () => {
  it('converts UnifiedRequest into an OpenAI Chat transport request', async () => {
    const transport = new MockHttpTransport()
    const adapter = new OpenAIChatAdapter(transport)

    await adapter.complete(request())

    expect(transport.requests).toHaveLength(1)
    const converted = transport.requests[0]
    const body = converted.body as OpenAIChatRequestBody
    expect(converted).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/v1/chat/completions',
      headers: { 'content-type': 'application/json' }
    })
    expect(converted.headers).not.toHaveProperty('authorization')
    expect(body).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: '辩题：人工智能是否应当拥有法律人格\n角色：正方（affirmative）' },
        { role: 'user', content: '请完成正方立论。' }
      ],
      stream: false,
      max_tokens: 2048
    })
  })

  it('converts an OpenAI Chat response into UnifiedResponse', async () => {
    const transport = new MockHttpTransport({
      response: {
        status: 200,
        body: {
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: '这是转换后的完整响应。' }, finish_reason: 'stop' }]
        }
      }
    })
    const response = await new OpenAIChatAdapter(transport).complete(request())

    expect(response).toEqual({
      requestId: 'request-openai',
      content: '这是转换后的完整响应。',
      finishReason: 'stop'
    })
  })

  it('keeps provider-reported token usage without estimating missing values', async () => {
    const transport = new MockHttpTransport({
      response: {
        status: 200,
        body: {
          choices: [{ message: { role: 'assistant', content: '带用量的响应。' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
        }
      }
    })

    await expect(new OpenAIChatAdapter(transport).complete(request())).resolves.toMatchObject({
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
    })

    const withoutUsage = await new OpenAIChatAdapter(new MockHttpTransport()).complete(request())
    expect(withoutUsage.usage).toBeUndefined()
  })

  it('maps native function tools and parses tool calls', async () => {
    const transport = new MockHttpTransport({ response: { status: 200, body: {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'call-1', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"测试"}' }
      }] }, finish_reason: 'tool_calls' }]
    } } })
    const adapter = new OpenAIChatAdapter(transport)
    const response = await adapter.complete({
      ...request(),
      tools: [{ name: 'searchWeb', description: '搜索', parameters: { type: 'object' } }],
      toolChoice: 'auto'
    })
    expect((transport.requests[0].body as OpenAIChatRequestBody & { tools: unknown[]; tool_choice: string })).toMatchObject({
      tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'searchWeb' } }]
    })
    expect(response).toEqual({ requestId: 'request-openai', content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'searchWeb', arguments: { query: '测试' } }] })
  })

  it('disables DeepSeek thinking when the ModelProfile does not enable reasoning', async () => {
    const transport = new MockHttpTransport()
    await new OpenAIChatAdapter(transport).complete({
      ...request(),
      runtimeMetadata: {
        ...request().runtimeMetadata,
        providerId: 'deepseek',
        reasoningEnabled: false
      }
    })

    expect(transport.requests[0].body).toMatchObject({ thinking: { type: 'disabled' } })
  })

  it('disables DeepSeek thinking for multi-turn tool loops even when the profile supports reasoning', async () => {
    const transport = new MockHttpTransport({ response: { status: 200, body: {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'call-search', type: 'function', function: { name: 'searchWeb', arguments: '{"query":"测试"}' }
      }] }, finish_reason: 'tool_calls' }]
    } } })
    await new OpenAIChatAdapter(transport).complete({
      ...request(),
      tools: [{ name: 'searchWeb', description: '搜索', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      runtimeMetadata: {
        ...request().runtimeMetadata,
        providerId: 'deepseek',
        reasoningEnabled: true
      }
    })

    expect(transport.requests[0].body).toMatchObject({
      thinking: { type: 'disabled' },
      tools: [{ type: 'function', function: { name: 'searchWeb' } }]
    })
  })

  it('maps image input only when a vision request explicitly contains image bytes', async () => {
    const transport = new MockHttpTransport()
    const visionRequest = request()
    visionRequest.messages = [
      { role: 'system', content: '只输出公开图片分析。' },
      {
        role: 'user',
        content: '分析图片。',
        imageInputs: [{ mimeType: 'image/png', base64: 'iVBORw0KGgo=' }]
      }
    ]
    visionRequest.runtimeMetadata.purpose = 'vision-analysis'

    await new OpenAIChatAdapter(transport).complete(visionRequest)

    const body = transport.requests[0].body as OpenAIChatRequestBody
    expect(body.messages[0]).toEqual({ role: 'system', content: '只输出公开图片分析。' })
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '分析图片。' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
      ]
    })
    expect(JSON.stringify(body.messages[0])).not.toContain('image_url')
  })

  it('classifies an empty length-limited response as a retryable output-limit error', async () => {
    const transport = new MockHttpTransport({ response: { status: 200, body: {
      choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'length' }]
    } } })

    await expect(new OpenAIChatAdapter(transport).complete(request())).rejects.toMatchObject({
      detail: {
        code: 'REQUEST_FAILED',
        titleZh: '模型输出上限不足',
        retryable: true
      }
    })
  })

  it('reports safe shape diagnostics without copying invalid tool arguments into the error', async () => {
    const invalidArguments = '{"query":'
    const transport = new MockHttpTransport({ response: { status: 200, body: {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'call-invalid', type: 'function', function: { name: 'searchWeb', arguments: invalidArguments }
      }] }, finish_reason: 'tool_calls' }]
    } } })
    const completion = new OpenAIChatAdapter(transport).complete(request())

    await expect(completion).rejects.toMatchObject({
      detail: {
        titleZh: '工具参数无法解析',
        message: expect.stringContaining('arguments_length=9, object_envelope=false')
      }
    })
    await expect(completion).rejects.not.toMatchObject({
      detail: { message: expect.stringContaining(invalidArguments) }
    })
  })

  it('converts OpenAI stream chunks into UnifiedStreamEvent values', async () => {
    const transport = new MockHttpTransport({
      streamEvents: [
        { type: 'data', data: { choices: [{ delta: { role: 'assistant' }, finish_reason: null }] } },
        { type: 'data', data: { choices: [{ delta: { content: '第一段' }, finish_reason: null }] } },
        { type: 'data', data: { choices: [{ delta: { content: '，第二段' }, finish_reason: 'stop' }] } },
        { type: 'done' }
      ]
    })
    const events: UnifiedStreamEvent[] = []

    for await (const event of new OpenAIChatAdapter(transport).stream(request())) events.push(event)

    expect(events.map((event) => event.type)).toEqual(['started', 'textDelta', 'textDelta', 'completed'])
    expect(events.filter((event) => event.type === 'textDelta').map((event) => event.delta).join('')).toBe('第一段，第二段')
    expect(events.at(-1)).toEqual({
      type: 'completed',
      response: { requestId: 'request-openai', content: '第一段，第二段', finishReason: 'stop' }
    })
    expect((transport.requests[0].body as OpenAIChatRequestBody).stream).toBe(true)
  })

  it('keeps usage from the final stream chunk', async () => {
    const transport = new MockHttpTransport({
      streamEvents: [
        { type: 'data', data: { choices: [{ delta: { content: '流式内容' } }] } },
        { type: 'data', data: { choices: [], usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } } },
        { type: 'done' }
      ]
    })
    const events: UnifiedStreamEvent[] = []

    for await (const event of new OpenAIChatAdapter(transport).stream(request())) events.push(event)

    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      response: { usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } }
    })
  })

  it('keeps emitted deltas and converts an interrupted SSE stream into a recoverable error', async () => {
    const encoder = new TextEncoder()
    const transport = new FetchHttpTransport({
      fetchImplementation: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已收到部分文本"}}]}\n\n'))
          controller.close()
        }
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const events: UnifiedStreamEvent[] = []

    for await (const event of new OpenAIChatAdapter(transport).stream(request())) events.push(event)

    expect(events).toEqual([
      { type: 'started', requestId: 'request-openai' },
      { type: 'textDelta', requestId: 'request-openai', delta: '已收到部分文本' },
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          failureCode: 'STREAM_INTERRUPTED',
          titleZh: 'SSE 流中断',
          retryable: true
        })
      })
    ])
  })

  it('converts an HTTP error into a structured ModelAdapterError', async () => {
    const transport = new MockHttpTransport({
      response: {
        status: 429,
        body: { error: { code: 'rate_limit_exceeded', message: '请求频率过高。' } }
      }
    })
    const completion = new OpenAIChatAdapter(transport).complete(request())

    await expect(completion).rejects.toBeInstanceOf(ModelAdapterError)
    await expect(completion).rejects.toMatchObject({
      detail: {
        code: 'REQUEST_FAILED',
        message: '请求频率过高。',
        retryable: true,
        statusCode: 429,
        providerCode: 'rate_limit_exceeded'
      }
    })
  })

  it('can be registered as the openai-chat protocol without making a request', () => {
    const registry = new AdapterRegistry()
    const transport = new MockHttpTransport()
    const adapter = new OpenAIChatAdapter(transport)

    expect(registry.register('openai-chat', adapter)).toEqual({ ok: true, value: undefined })
    expect(registry.getAdapter('openai-chat')).toEqual({ ok: true, value: adapter })
    expect(transport.requests).toEqual([])
  })
})
