import { describe, expect, it } from 'vitest'

import { ResearchBudgetPolicy } from '../src/research'
import type { ResearchLoopState } from '../src/research'

describe('ResearchBudgetPolicy', () => {
  it('uses discovery limits to stop repeated exploration without disabling local finalization', () => {
    const policy = new ResearchBudgetPolicy({
      maxToolCalls: 2,
      maxSearches: 1,
      maxPageReads: 1,
      maxBodyCharacters: 1_000,
      maxDecisionRounds: 2,
      maxNoProgressRounds: 2,
      maxFinalizationRounds: 4,
      targetEvidenceCount: 1
    })
    const state = researchState({ decisionRoundCount: 2 })

    expect(policy.transition(state)).toEqual({ phase: 'finalizing', reason: 'decision-limit' })
    const tools = policy.availableToolNames({ ...state, phase: 'finalizing' })
    expect([...tools]).toEqual(expect.arrayContaining([
      'saveResearchNote', 'saveProvisionalClaim', 'publishEvidence', 'finishResearch'
    ]))
    expect(tools.has('searchWeb')).toBe(false)
    expect(tools.has('readWebPage')).toBe(false)
  })

  it('switches to finalization after repeated no-progress rounds and resets the counter on progress', () => {
    const policy = new ResearchBudgetPolicy({ maxNoProgressRounds: 2 })
    const once = policy.recordProgress(researchState(), false)
    const twice = policy.recordProgress(once, false)

    expect(policy.transition(twice)).toEqual({ phase: 'finalizing', reason: 'no-progress' })
    expect(policy.recordProgress(twice, true).noProgressRoundCount).toBe(0)
  })

  it('keeps legacy aggregate limits compatible while supplying safe anti-loop defaults', () => {
    const policy = new ResearchBudgetPolicy({
      maxToolCalls: 7,
      maxSearches: 2,
      maxPageReads: 2,
      maxBodyCharacters: 30_000
    })

    expect(policy.limits.maxToolCalls).toBe(7)
    expect(policy.limits.maxDecisionRounds).toBeGreaterThan(policy.limits.maxToolCalls)
    expect(policy.limits.maxFinalizationRounds).toBeGreaterThan(0)
    expect(policy.limits.targetEvidenceCount).toBeGreaterThan(0)
  })
})

function researchState(overrides: Partial<ResearchLoopState> = {}): ResearchLoopState {
  return {
    debateSessionId: 'session', researchSessionId: 'research', ownerParticipantId: 'participant',
    role: 'affirmative', mode: 'automatic', status: 'running', phase: 'discovery',
    decisionRoundCount: 0, noProgressRoundCount: 0, finalizationRoundCount: 0,
    toolCallCount: 0, searchCount: 0, pageReadCount: 0, bodyCharacters: 0,
    limits: { maxToolCalls: 7, maxSearches: 2, maxPageReads: 2, maxBodyCharacters: 30_000 },
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides
  }
}
