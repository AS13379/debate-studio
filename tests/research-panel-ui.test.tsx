import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModeratorResearchToolSection, ResearchPresetSelector, researchPresetForLimits } from '../src/renderer/src/components/ResearchPanel'
import type { RoleResearchWorkspaceDto } from '../src/shared/ipc-contract'

describe('research panel UI', () => {
  it('renders approval controls for a pending moderator tool call', () => {
    const workspace: RoleResearchWorkspaceDto = {
      goals: [], queries: [], sources: [], assets: [], notes: [], claims: [],
      searchSessions: [], fetchedPages: [], sourceEvaluations: [],
      toolCalls: [{
        id: 'call-moderator-search', debateSessionId: 'session-ui', researchSessionId: 'research-ui',
        ownerParticipantId: 'moderator-ui', visibility: 'moderator-private', role: 'moderator',
        toolName: 'searchWeb', operationKey: 'moderator-search-1', argumentsJson: '{"query":"test"}',
        status: 'pending-approval', createdAt: '2026-07-14T00:00:00.000Z'
      }]
    }

    const html = renderToStaticMarkup(
      <ModeratorResearchToolSection workspace={workspace} onDecision={async () => undefined} />
    )

    expect(html).toContain('主持人研究记录')
    expect(html).toContain('searchWeb')
    expect(html).toContain('允许')
    expect(html).toContain('拒绝')
  })

  it('offers simple research presets instead of raw numeric limit inputs', () => {
    const html = renderToStaticMarkup(<ResearchPresetSelector value="balanced" onChange={() => undefined} />)

    expect(html).toContain('快速')
    expect(html).toContain('标准')
    expect(html).toContain('深入')
    expect(html).toContain('优先尽快开辩')
    expect(html).not.toContain('省额度')
    expect(html).not.toContain('type="number"')
    expect(html).toContain('aria-pressed="true"')
    expect(researchPresetForLimits({ maxToolCalls: 5, maxSearches: 1, maxPageReads: 1, maxBodyCharacters: 15_000 })).toBe('quick')
    expect(researchPresetForLimits({ maxToolCalls: 12, maxSearches: 4, maxPageReads: 4, maxBodyCharacters: 60_000 })).toBe('deep')
    // Existing saved v0.2.4 presets keep their selected label and the runtime
    // translates them to the faster budget automatically.
    expect(researchPresetForLimits({ maxToolCalls: 8, maxSearches: 2, maxPageReads: 2, maxBodyCharacters: 25_000 })).toBe('quick')
    expect(researchPresetForLimits({ maxToolCalls: 20, maxSearches: 5, maxPageReads: 5, maxBodyCharacters: 80_000 })).toBe('deep')
    expect(researchPresetForLimits({ maxToolCalls: 64, maxSearches: 4, maxPageReads: 4, maxBodyCharacters: 80_000, maxDecisionRounds: 20, maxNoProgressRounds: 3, maxFinalizationRounds: 8, targetEvidenceCount: 2 })).toBe('balanced')
  })
})
