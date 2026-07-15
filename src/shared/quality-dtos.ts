export type DebateWinnerDto = 'affirmative' | 'negative' | 'draw'
export type DebateScoreDimensionDto =
  | 'logicalCompleteness'
  | 'evidenceQuality'
  | 'rebuttalEffectiveness'
  | 'factualAccuracy'
  | 'argumentDepth'
  | 'clarity'

export interface DebateDimensionScoreDto { score: number; reason: string }
export type DebateSideScoresDto = Record<DebateScoreDimensionDto, DebateDimensionScoreDto>

export interface DebateEvaluationDto {
  winner: DebateWinnerDto
  scores: Record<'affirmative' | 'negative', DebateSideScoresDto>
  strengths: Record<'affirmative' | 'negative', string[]>
  weaknesses: Record<'affirmative' | 'negative', string[]>
  keyTurningPoints: string[]
  evidenceUsage: Record<'affirmative' | 'negative', string>
  reasoningQuality: Record<'affirmative' | 'negative', string>
}

export interface DebateEvaluationRecordDto {
  id: string
  debateId: string
  sessionId: string
  evaluation: DebateEvaluationDto
  evaluatorModelId: string
  promptTemplateId: string
  promptVersion: number
  createdAt: string
}

export interface DebateReviewDto {
  summary: string
  bestArguments: string[]
  bestRebuttals: string[]
  missedOpportunities: string[]
  evidenceAnalysis: string[]
  improvementSuggestions: string[]
}

export interface DebateReviewRecordDto {
  id: string
  debateId: string
  sessionId: string
  review: DebateReviewDto
  reviewerModelId: string
  promptTemplateId: string
  promptVersion: number
  createdAt: string
}

export interface DebateQualitySnapshotDto {
  evaluation?: DebateEvaluationRecordDto
  review?: DebateReviewRecordDto
  evidenceCount: number
  turnCount: number
  models: string[]
}

export interface DebateQualityOverviewItemDto {
  debateId: string
  sessionId: string
  title: string
  winner: DebateWinnerDto
  averageScore: number
  evidenceCount: number
  turnCount: number
  models: string[]
  weaknesses: string[]
  promptVersion: number
  createdAt: string
}

export interface DebateQualityErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
  technicalDetails?: string
}

export type DebateQualityResultDto<T> = { ok: true; value: T } | { ok: false; error: DebateQualityErrorDto }
