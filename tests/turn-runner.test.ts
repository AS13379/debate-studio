import { describe, expect, it } from 'vitest'

import { DebateEngine, type DebateConfig } from '../src/domain'
import { TurnRunner } from '../src/execution'
import { MockAdapter } from '../src/providers'

function createEngine(): DebateEngine {
  const config: DebateConfig = {
    id: 'debate-runner',
    topic: 'TurnRunner 是否正确驱动状态机？',
    participants: [
      { id: 'affirmative-1', role: 'affirmative', name: '正方' },
      { id: 'negative-1', role: 'negative', name: '反方' },
      { id: 'moderator-1', role: 'moderator', name: '主持人' }
    ]
  }
  const engine = new DebateEngine(config)
  engine.dispatch({ type: 'start' })
  return engine
}

function createRunner(adapter: MockAdapter, prefix = 'runner'): TurnRunner {
  let id = 0
  return new TurnRunner(adapter, {
    createId: () => `${prefix}-id-${++id}`,
    now: () => new Date('2026-07-12T00:00:00.000Z')
  })
}

describe('TurnRunner', () => {
  it('completes a streamed turn and advances the engine', async () => {
    const engine = createEngine()
    const runner = createRunner(new MockAdapter({ chunks: ['验证', '完成'] }))

    const result = await runner.startTurn(engine)

    expect(result.turn).toMatchObject({ stage: 'validating', status: 'completed', content: '验证完成' })
    expect(engine.getState().stage).toBe('moderating')
    expect(engine.getTurns()).toEqual([expect.objectContaining({ id: result.turn.id })])
  })

  it('forwards reasoning only to the live observer and removes it from retained events', async () => {
    const engine = createEngine()
    const marker = '仅当前页面可见的思考内容'
    const runner = createRunner(new MockAdapter({ reasoningChunks: [marker], chunks: ['公开回答'] }))
    const received: string[] = []

    const result = await runner.startTurn(engine, undefined, undefined, {
      onReasoningUpdated: (_turn, delta) => received.push(delta)
    })

    expect(received.join('')).toBe(marker)
    expect(result.turn.content).toBe('公开回答')
    expect(JSON.stringify(result.streamEvents)).not.toContain(marker)
    expect(JSON.stringify(result.streamEvents)).not.toContain('reasoningContent')
  })

  it('converts an adapter error into a failed turn without advancing', async () => {
    const engine = createEngine()
    const runner = createRunner(new MockAdapter({ error: { message: '模拟请求失败' } }))

    const result = await runner.startTurn(engine)

    expect(result.turn).toMatchObject({ status: 'failed', error: '模拟请求失败' })
    expect(engine.getState().stage).toBe('validating')
    expect(engine.getTurns()).toHaveLength(0)
  })

  it('cancels an active request without advancing', async () => {
    const engine = createEngine()
    const runner = createRunner(new MockAdapter({ chunks: ['不会完成'], delayMs: 50 }))

    const pending = runner.startTurn(engine)
    expect(runner.cancelTurn()).toBe(true)
    const result = await pending

    expect(result.turn.status).toBe('cancelled')
    expect(engine.getState().stage).toBe('validating')
    expect(engine.getTurns()).toHaveLength(0)
  })

  it('retries a failed turn with a new id and advances on success', async () => {
    const engine = createEngine()
    const failingRunner = createRunner(new MockAdapter({ error: { message: '第一次失败' } }), 'first')
    const failed = await failingRunner.startTurn(engine)
    const retryRunner = createRunner(new MockAdapter({ responseText: '重试成功' }), 'retry')

    const retried = await retryRunner.retryTurn(engine, failed.turn)

    expect(retried.turn).toMatchObject({ status: 'completed', retryOfTurnId: failed.turn.id })
    expect(retried.turn.id).not.toBe(failed.turn.id)
    expect(engine.getState().stage).toBe('moderating')
  })
})
