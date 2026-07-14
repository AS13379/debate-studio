import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModeratorResearchToolSection } from '../src/renderer/src/components/ResearchPanel'
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

    expect(html).toContain('主持人研究工具')
    expect(html).toContain('searchWeb')
    expect(html).toContain('允许')
    expect(html).toContain('拒绝')
  })
})
