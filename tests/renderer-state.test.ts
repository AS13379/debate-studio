import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomePage } from '../src/renderer/src/pages/HomePage'
import { isResearchPreparationStage, ReasoningActivityPanel } from '../src/renderer/src/pages/LiveDebatePage'
import { applyRunEvent } from '../src/renderer/src/run-state'

describe('Renderer state', () => {
  it('shows an actionable empty database state', () => {
    const html = renderToStaticMarkup(createElement(HomePage, {
      debates: [],
      loading: false,
      onCreate: () => undefined,
      onCreateDemo: () => undefined,
      onOpen: () => undefined
    }))

    expect(html).toContain('还没有辩论')
    expect(html).toContain('创建 Mock 示例辩论')
    expect(html).not.toContain('disabled')
  })

  it('applies streamed text and terminal events to the visible Turn', () => {
    const started = applyRunEvent({ turns: [] }, {
      id: 'event-start',
      type: 'turnStarted',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:00.000Z',
      turn: {
        id: 'turn-ui',
        sessionId: 'session-ui',
        participantId: 'participant-ui',
        stage: 'validating',
        status: 'running',
        createdAt: '2026-07-13T00:00:00.000Z'
      }
    })
    const streamed = applyRunEvent(started, {
      id: 'event-delta',
      type: 'turnUpdated',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:01.000Z',
      turnId: 'turn-ui',
      participantId: 'participant-ui',
      stage: 'validating',
      delta: '流式',
      content: '流式内容'
    })
    const completed = applyRunEvent(streamed, {
      id: 'event-complete',
      type: 'turnCompleted',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:02.000Z',
      turn: { ...streamed.turns[0], status: 'completed', content: '流式内容' }
    })

    expect(streamed.turns).toEqual([expect.objectContaining({ id: 'turn-ui', status: 'streaming', content: '流式内容' })])
    expect(completed.turns).toEqual([expect.objectContaining({ id: 'turn-ui', status: 'completed', content: '流式内容' })])
  })

  it('keeps provider reasoning in bounded renderer memory without changing Turn content', () => {
    const started = applyRunEvent({ turns: [] }, {
      id: 'event-start',
      type: 'turnStarted',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:00.000Z',
      turn: {
        id: 'turn-reasoning', sessionId: 'session-ui', participantId: 'participant-ui',
        stage: 'validating', status: 'running', content: '', createdAt: '2026-07-13T00:00:00.000Z'
      }
    })
    const reasoned = applyRunEvent(started, {
      id: 'event-reasoning',
      type: 'turnReasoningUpdated',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:01.000Z',
      turnId: 'turn-reasoning',
      participantId: 'participant-ui',
      stage: 'validating',
      delta: '这是服务商返回的思考文本'
    })

    expect(reasoned.turns[0].content).toBe('')
    expect(reasoned.reasoningByTurn?.['turn-reasoning']).toMatchObject({
      content: '这是服务商返回的思考文本',
      truncated: false,
      receivedCharacters: 12
    })
  })

  it('bounds very long transient reasoning while retaining its latest content', () => {
    const longDelta = `起点${'x'.repeat(125_000)}最新思考`
    const snapshot = applyRunEvent({ turns: [] }, {
      id: 'event-reasoning-long',
      type: 'turnReasoningUpdated',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:01.000Z',
      turnId: 'turn-long',
      participantId: 'participant-ui',
      stage: 'validating',
      delta: longDelta
    })
    const reasoning = snapshot.reasoningByTurn?.['turn-long']

    expect(reasoning?.truncated).toBe(true)
    expect(reasoning?.receivedCharacters).toBe(longDelta.length)
    expect(reasoning?.content.length).toBeLessThanOrEqual(120_000)
    expect(reasoning?.content).toContain('最新思考')
  })

  it('renders an active, collapsible provider reasoning area with elapsed activity context', () => {
    const html = renderToStaticMarkup(createElement(ReasoningActivityPanel, {
      active: true,
      startedAt: new Date().toISOString(),
      modelId: 'kimi-k3-thinking',
      reasoning: {
        content: '正在核对证据边界',
        updatedAt: new Date().toISOString(),
        truncated: false,
        receivedCharacters: 8
      }
    }))

    expect(html).toContain('模型思考中')
    expect(html).toContain('kimi-k3-thinking')
    expect(html).toContain('正在核对证据边界')
    expect(html).toContain('不代表完整内部推理')
    expect(html).toContain('open=""')
  })

  it('separates research preparation from the formal debate timeline', () => {
    expect(isResearchPreparationStage('public_pool')).toBe(true)
    expect(isResearchPreparationStage('negative_research')).toBe(true)
    expect(isResearchPreparationStage('argument_drafting')).toBe(true)
    expect(isResearchPreparationStage('affirmative_opening')).toBe(false)
    expect(isResearchPreparationStage('free_debate')).toBe(false)
  })

  it('stops presenting a failed model turn as an active run', () => {
    const failed = applyRunEvent({
      state: { sessionId: 'session-ui', status: 'streaming', currentStage: 'public_pool', active: true },
      turns: []
    }, {
      id: 'event-failed',
      type: 'turnFailed',
      sessionId: 'session-ui',
      createdAt: '2026-07-13T00:00:02.000Z',
      turn: {
        id: 'turn-failed', sessionId: 'session-ui', participantId: 'moderator-ui',
        stage: 'public_pool', status: 'failed', content: '', createdAt: '2026-07-13T00:00:00.000Z'
      }
    })

    expect(failed.state).toMatchObject({ status: 'failed', active: false, currentStage: 'public_pool' })
  })
})
