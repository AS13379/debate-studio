export interface ResearchBudgetPresetLimits {
  maxToolCalls: number
  maxSearches: number
  maxPageReads: number
  maxBodyCharacters: number
  maxDecisionRounds: number
  maxNoProgressRounds: number
  maxFinalizationRounds: number
  targetEvidenceCount: number
}

export const RESEARCH_BUDGET_PRESETS = {
  quick: {
    maxToolCalls: 32, maxSearches: 2, maxPageReads: 2, maxBodyCharacters: 30_000,
    maxDecisionRounds: 12, maxNoProgressRounds: 2, maxFinalizationRounds: 6, targetEvidenceCount: 1
  },
  balanced: {
    maxToolCalls: 64, maxSearches: 4, maxPageReads: 4, maxBodyCharacters: 80_000,
    maxDecisionRounds: 20, maxNoProgressRounds: 3, maxFinalizationRounds: 8, targetEvidenceCount: 2
  },
  deep: {
    maxToolCalls: 96, maxSearches: 8, maxPageReads: 8, maxBodyCharacters: 160_000,
    maxDecisionRounds: 32, maxNoProgressRounds: 4, maxFinalizationRounds: 10, targetEvidenceCount: 3
  }
} as const satisfies Record<string, ResearchBudgetPresetLimits>
