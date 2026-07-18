import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomePage } from '../src/renderer/src/pages/HomePage'
import { isResearchPreparationStage } from '../src/renderer/src/pages/LiveDebatePage'
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
