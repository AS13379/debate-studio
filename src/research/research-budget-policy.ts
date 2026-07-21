import type {
  ResearchBudgetPhase,
  ResearchCompletionReason,
  ResearchLoopState,
  ResearchToolLimits,
  ResearchToolName
} from './types'
import { RESEARCH_BUDGET_PRESETS } from '../shared/research-budget-presets'

export { RESEARCH_BUDGET_PRESETS } from '../shared/research-budget-presets'

export const DEFAULT_RESEARCH_TOOL_LIMITS: Required<ResearchToolLimits> = RESEARCH_BUDGET_PRESETS.balanced

const FINALIZATION_TOOLS = new Set<ResearchToolName>([
  'saveResearchNote',
  'saveProvisionalClaim',
  'publishEvidence',
  'finishResearch'
])

export interface ResearchBudgetTransition {
  phase: ResearchBudgetPhase
  reason?: Exclude<ResearchCompletionReason, 'model-finished' | 'model-summary' | 'finalization-limit'>
}

export class ResearchBudgetPolicy {
  readonly limits: Required<ResearchToolLimits>

  constructor(input?: Partial<ResearchToolLimits>) {
    this.limits = normalizeResearchToolLimits(input)
  }

  transition(state: ResearchLoopState): ResearchBudgetTransition {
    if ((state.phase ?? 'discovery') === 'finalizing') return { phase: 'finalizing' }
    if ((state.noProgressRoundCount ?? 0) >= this.limits.maxNoProgressRounds) {
      return { phase: 'finalizing', reason: 'no-progress' }
    }
    if ((state.decisionRoundCount ?? 0) >= this.limits.maxDecisionRounds) {
      return { phase: 'finalizing', reason: 'decision-limit' }
    }
    if (state.pageReadCount >= this.limits.maxPageReads || state.bodyCharacters >= this.limits.maxBodyCharacters) {
      return { phase: 'finalizing', reason: 'discovery-limit' }
    }
    return { phase: 'discovery' }
  }

  availableToolNames(state: ResearchLoopState): ReadonlySet<ResearchToolName> {
    if ((state.phase ?? 'discovery') === 'finalizing') return FINALIZATION_TOOLS
    const allowed = new Set<ResearchToolName>(FINALIZATION_TOOLS)
    if (state.searchCount < this.limits.maxSearches) allowed.add('searchWeb')
    if (state.pageReadCount < this.limits.maxPageReads && state.bodyCharacters < this.limits.maxBodyCharacters) {
      allowed.add('readWebPage')
    }
    return allowed
  }

  canRunAnotherFinalizationRound(state: ResearchLoopState): boolean {
    return (state.finalizationRoundCount ?? 0) < this.limits.maxFinalizationRounds
  }

  recordModelRound(state: ResearchLoopState): ResearchLoopState {
    return (state.phase ?? 'discovery') === 'finalizing'
      ? { ...state, finalizationRoundCount: (state.finalizationRoundCount ?? 0) + 1 }
      : { ...state, decisionRoundCount: (state.decisionRoundCount ?? 0) + 1 }
  }

  recordProgress(state: ResearchLoopState, madeProgress: boolean): ResearchLoopState {
    return {
      ...state,
      noProgressRoundCount: madeProgress ? 0 : (state.noProgressRoundCount ?? 0) + 1
    }
  }
}

export function normalizeResearchToolLimits(input?: Partial<ResearchToolLimits>): Required<ResearchToolLimits> {
  const merged = { ...DEFAULT_RESEARCH_TOOL_LIMITS, ...input }
  return {
    maxToolCalls: positiveInteger(merged.maxToolCalls, DEFAULT_RESEARCH_TOOL_LIMITS.maxToolCalls),
    maxSearches: positiveInteger(merged.maxSearches, DEFAULT_RESEARCH_TOOL_LIMITS.maxSearches),
    maxPageReads: positiveInteger(merged.maxPageReads, DEFAULT_RESEARCH_TOOL_LIMITS.maxPageReads),
    maxBodyCharacters: positiveInteger(merged.maxBodyCharacters, DEFAULT_RESEARCH_TOOL_LIMITS.maxBodyCharacters),
    maxDecisionRounds: positiveInteger(merged.maxDecisionRounds, DEFAULT_RESEARCH_TOOL_LIMITS.maxDecisionRounds),
    maxNoProgressRounds: positiveInteger(merged.maxNoProgressRounds, DEFAULT_RESEARCH_TOOL_LIMITS.maxNoProgressRounds),
    maxFinalizationRounds: positiveInteger(merged.maxFinalizationRounds, DEFAULT_RESEARCH_TOOL_LIMITS.maxFinalizationRounds),
    targetEvidenceCount: positiveInteger(merged.targetEvidenceCount, DEFAULT_RESEARCH_TOOL_LIMITS.targetEvidenceCount)
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
