import { describe, expect, it } from 'vitest'

import type { DebateConfig } from '../src/domain'
import { SessionRunner, TurnRunner } from '../src/execution'
import { MockAdapter, type ModelAdapter, type UnifiedRequest, type UnifiedResponse, type UnifiedStreamEvent } from '../src/providers'

const config: DebateConfig = {
  id: 'session-runner-debate',
  topic: 'SessionRunner 能否自动完成辩论？',
  participants: [
    { id: 'affirmative-1', role: 'affirmative', name: '正方' },
    { id: 'negative-1', role: 'negative', name: '反方' },
    { id: 'moderator-1', role: 'moderator', name: '主持人' }
  ]
}

function createSession(adapter: ModelAdapter): SessionRunner {
  return new SessionRunner(config, new TurnRunner(adapter))
}

describe('SessionRunner', () => {
  it('runs a complete mock debate', async () => {
    const session = createSession(new MockAdapter({ chunks: ['模拟', '发言'] }))

    const result = await session.run()

    expect(result.status).toBe('completed')
    expect(session.engine.getState()).toMatchObject({ stage: 'completed', status: 'completed' })
    expect(session.engine.getTurns()).toHaveLength(20)
    expect(session.getEvents().filter((event) => event.type === 'turnStarted')).toHaveLength(20)
    expect(session.getEvents().filter((event) => event.type === 'sessionCompleted')).toHaveLength(1)
  })

  it('pauses an active run without advancing', async () => {
    const session = createSession(new MockAdapter({ responseText: '慢速响应', delayMs: 20 }))

    const pending = session.run()
    expect(session.pause()).toBe(true)
    const result = await pending

    expect(result.status).toBe('paused')
    expect(session.engine.getState()).toMatchObject({ stage: 'validating', status: 'paused' })
    expect(session.engine.getTurns()).toHaveLength(0)
  })

  it('resumes a paused session and completes it', async () => {
    const session = createSession(new MockAdapter({ responseText: '恢复后的响应', delayMs: 1 }))
    const firstRun = session.run()
    session.pause()
    await firstRun

    const result = await session.resume()

    expect(result.status).toBe('completed')
    expect(session.engine.getState().stage).toBe('completed')
  })

  it('stops without making further adapter calls', async () => {
    let calls = 0
    const delegate = new MockAdapter({ responseText: '不会完成', delayMs: 20 })
    const adapter: ModelAdapter = {
      complete(request: UnifiedRequest): Promise<UnifiedResponse> {
        return delegate.complete(request)
      },
      async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
        calls += 1
        yield* delegate.stream(request)
      }
    }
    const session = createSession(adapter)

    const pending = session.run()
    expect(session.stop()).toBe(true)
    const result = await pending
    const callsAtStop = calls
    const secondRun = await session.run()

    expect(result.status).toBe('stopped')
    expect(secondRun.status).toBe('stopped')
    expect(calls).toBe(callsAtStop)
  })

  it('stays at the current stage when the adapter fails', async () => {
    const session = createSession(new MockAdapter({ error: { message: '模拟 Adapter 失败' } }))

    const result = await session.run()

    expect(result.status).toBe('failed')
    expect(session.engine.getState()).toMatchObject({ stage: 'validating', status: 'running' })
    expect(session.engine.getTurns()).toHaveLength(0)
    expect(session.getEvents().at(-1)).toMatchObject({ type: 'sessionFailed', error: '模拟 Adapter 失败' })
  })

  it('advances exactly one action with step', async () => {
    const session = createSession(new MockAdapter({ responseText: '单步响应' }))

    const started = await session.step()
    const advanced = await session.step()

    expect(started.outcome).toBe('started')
    expect(advanced.outcome).toBe('turnCompleted')
    expect(session.engine.getState().stage).toBe('moderating')
    expect(session.engine.getTurns()).toHaveLength(1)
  })
})
