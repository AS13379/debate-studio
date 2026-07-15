export const DEBATE_SCORE_DIMENSIONS = [
  'logicalCompleteness',
  'evidenceQuality',
  'rebuttalEffectiveness',
  'factualAccuracy',
  'argumentDepth',
  'clarity'
] as const

export type DebateScoreDimension = (typeof DEBATE_SCORE_DIMENSIONS)[number]
export type DebateEvaluationSide = 'affirmative' | 'negative'
export type DebateWinner = DebateEvaluationSide | 'draw'

export interface DebateDimensionScore {
  score: number
  reason: string
}

export type DebateSideScores = Record<DebateScoreDimension, DebateDimensionScore>

export interface DebateEvaluation {
  winner: DebateWinner
  scores: Record<DebateEvaluationSide, DebateSideScores>
  strengths: Record<DebateEvaluationSide, string[]>
  weaknesses: Record<DebateEvaluationSide, string[]>
  keyTurningPoints: string[]
  evidenceUsage: Record<DebateEvaluationSide, string>
  reasoningQuality: Record<DebateEvaluationSide, string>
}

export interface DebateEvaluationRecord {
  id: string
  debateId: string
  sessionId: string
  evaluation: DebateEvaluation
  evaluatorModelProfileId?: string
  evaluatorModelId: string
  promptTemplateId: string
  promptVersion: number
  createdAt: string
}

export interface DebateReview {
  summary: string
  bestArguments: string[]
  bestRebuttals: string[]
  missedOpportunities: string[]
  evidenceAnalysis: string[]
  improvementSuggestions: string[]
}

export interface DebateReviewRecord {
  id: string
  debateId: string
  sessionId: string
  review: DebateReview
  reviewerModelProfileId?: string
  reviewerModelId: string
  promptTemplateId: string
  promptVersion: number
  createdAt: string
}

export interface DebateQualityError {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  technicalDetails?: string
}

export type DebateQualityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DebateQualityError }

export interface DebateQualitySnapshot {
  evaluation?: DebateEvaluationRecord
  review?: DebateReviewRecord
  evidenceCount: number
  turnCount: number
  models: string[]
}

export interface DebateQualityOverviewItem {
  debateId: string
  sessionId: string
  title: string
  winner: DebateWinner
  averageScore: number
  evidenceCount: number
  turnCount: number
  models: string[]
  weaknesses: string[]
  promptVersion: number
  createdAt: string
}
