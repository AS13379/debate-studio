import { describe, expect, it } from 'vitest'

import type { UnifiedRequest, UnifiedStreamEvent } from '../src/providers'
import { MockAdapter } from '../src/providers'

function createRequest(): UnifiedRequest {
  return {
    requestId: 'request-1',
    turnId: 'turn-1',
    sessionId: 'debate-1',
    stage: 'affirmative_opening',
    topic: '测试辩题',
    participant: { id: 'affirmative-1', role: 'affirmative', name: '正方' },
    prompt: '请立论',
    signal: new AbortController().signal
  }
}

describe('MockAdapter', () => {
  it('streams deterministic chunks and also supports a normal response', async () => {
    const adapter = new MockAdapter({ chunks: ['第一段', '，第二段'] })
    const events: UnifiedStreamEvent[] = []

    for await (const event of adapter.stream(createRequest())) events.push(event)

    expect(events.map((event) => event.type)).toEqual(['started', 'textDelta', 'textDelta', 'completed'])
    expect(events.filter((event) => event.type === 'textDelta').map((event) => event.delta).join('')).toBe('第一段，第二段')
    await expect(adapter.complete(createRequest())).resolves.toMatchObject({
      content: '第一段，第二段',
      finishReason: 'stop'
    })
  })
})

