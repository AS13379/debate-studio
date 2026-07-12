import { describe, expect, it } from 'vitest'

import { DebateEngine, type DebateConfig, type DebateStage } from '../src/domain'

function createEngine(): DebateEngine {
  let id = 0
  const config: DebateConfig = {
    id: 'debate-1',
    topic: '人工智能是否改善公共讨论？',
    participants: [
      { id: 'affirmative-1', role: 'affirmative', name: '正方 Mock' },
      { id: 'negative-1', role: 'negative', name: '反方 Mock' },
      { id: 'moderator-1', role: 'moderator', name: '主持人 Mock' }
    ]
  }

  return new DebateEngine(config, {
    createId: () => `id-${++id}`,
    now: () => new Date('2026-07-12T00:00:00.000Z')
  })
}

describe('DebateEngine', () => {
  it('completes a normal mock debate through every explicit stage', () => {
    const engine = createEngine()
    const visited: DebateStage[] = [engine.getState().stage]

    const start = engine.dispatch({ type: 'start' })
    expect(start.ok).toBe(true)
    visited.push(engine.getState().stage)

    while (engine.getState().stage !== 'completed') {
      const result = engine.advance()
      expect(result.ok).toBe(true)
      visited.push(engine.getState().stage)
    }

    expect(visited).toEqual([
      'draft',
      'validating',
      'moderating',
      'affirmative_opening',
      'negative_opening',
      'rebuttal',
      'free_debate',
      'closing',
      'adjudication',
      'completed'
    ])
    expect(engine.getState().status).toBe('completed')
    expect(engine.getTurns()).toHaveLength(8)
    expect(new Set(engine.getTurns().map((turn) => turn.id)).size).toBe(8)
    expect(engine.getEvents().filter((event) => event.type === 'mockSpeech')).toHaveLength(8)
  })

  it('pauses and resumes without changing the current stage', () => {
    const engine = createEngine()
    engine.dispatch({ type: 'start' })

    const paused = engine.dispatch({ type: 'pause' })
    expect(paused.ok).toBe(true)
    expect(engine.getState()).toMatchObject({ stage: 'validating', status: 'paused' })
    expect(engine.advance().ok).toBe(false)

    const resumed = engine.dispatch({ type: 'resume' })
    expect(resumed.ok).toBe(true)
    expect(engine.getState()).toMatchObject({ stage: 'validating', status: 'running' })
  })

  it('cannot continue after being stopped', () => {
    const engine = createEngine()
    engine.dispatch({ type: 'start' })
    expect(engine.dispatch({ type: 'stop' }).ok).toBe(true)

    expect(engine.dispatch({ type: 'resume' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TRANSITION' }
    })
    expect(engine.advance()).toMatchObject({ ok: false })
    expect(engine.getState().status).toBe('stopped')
  })

  it('rejects illegal commands without producing events or changing state', () => {
    const engine = createEngine()
    const before = engine.getState()

    const result = engine.dispatch({ type: 'pause' })

    expect(result).toMatchObject({ ok: false, events: [], error: { code: 'INVALID_TRANSITION' } })
    expect(engine.getState()).toEqual(before)
    expect(engine.getEvents()).toHaveLength(0)
  })

  it('skips the current stage and records a skipped turn', () => {
    const engine = createEngine()
    engine.dispatch({ type: 'start' })

    const result = engine.dispatch({ type: 'skip', reason: '测试跳过验证' })

    expect(result.ok).toBe(true)
    expect(engine.getState()).toMatchObject({ stage: 'moderating', status: 'running' })
    expect(engine.getTurns()).toEqual([
      expect.objectContaining({ stage: 'validating', status: 'skipped' })
    ])
    expect(result.events.map((event) => event.type)).toEqual(['stageSkipped', 'stateChanged'])
  })

  it('forceNext advances and records a forced turn', () => {
    const engine = createEngine()
    engine.dispatch({ type: 'start' })

    const result = engine.dispatch({ type: 'forceNext', reason: '用户强制推进' })

    expect(result.ok).toBe(true)
    expect(engine.getState().stage).toBe('moderating')
    expect(engine.getTurns()[0]).toMatchObject({ stage: 'validating', status: 'forced' })
  })
})
