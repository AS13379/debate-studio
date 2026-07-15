import type {
  DebateEvaluationService,
  DebateQualityOverviewItem,
  DebateQualityResult,
  DebateQualitySnapshot,
  DebateReviewService
} from '../debate-quality'
import type { PersistenceContext } from '../persistence'

export class DebateQualityApplication {
  constructor(
    private readonly persistence: PersistenceContext,
    private readonly evaluationService: DebateEvaluationService,
    private readonly reviewService: DebateReviewService
  ) {}

  async generateForCompletedSession(sessionId: string): Promise<DebateQualityResult<DebateQualitySnapshot>> {
    const session = this.persistence.repositories.sessions.get(sessionId)
    if (!session.ok || !session.value) return this.failure('SESSION_NOT_FOUND', '辩论 Session 不存在', '无法生成质量分析。', false)
    if (session.value.status !== 'completed') return this.failure('SESSION_NOT_COMPLETED', '辩论尚未完成', '只有完成后才会生成评分和复盘。', false)
    const evaluation = await this.evaluationService.evaluate(sessionId)
    if (!evaluation.ok) return evaluation
    const review = await this.reviewService.review(sessionId)
    if (!review.ok) return review
    return this.getByDebate(session.value.debateId)
  }

  async regenerate(debateId: string): Promise<DebateQualityResult<DebateQualitySnapshot>> {
    const sessions = this.persistence.repositories.sessions.listByDebate(debateId)
    if (!sessions.ok) return this.failure('QUALITY_LOAD_FAILED', '质量数据读取失败', '无法读取辩论 Session。', true)
    const session = sessions.value[0]
    return session
      ? this.generateForCompletedSession(session.id)
      : this.failure('SESSION_NOT_FOUND', '辩论 Session 不存在', '无法重新生成质量分析。', false)
  }

  getByDebate(debateId: string): DebateQualityResult<DebateQualitySnapshot> {
    const sessions = this.persistence.repositories.sessions.listByDebate(debateId)
    if (!sessions.ok) return this.failure('QUALITY_LOAD_FAILED', '质量数据读取失败', '无法读取 Session。', true)
    const session = sessions.value[0]
    if (!session) return this.failure('SESSION_NOT_FOUND', '辩论 Session 不存在', '无法读取质量分析。', false)
    const evaluation = this.persistence.repositories.debateQuality.findEvaluationByDebate(debateId)
    const review = this.persistence.repositories.debateQuality.findReviewByDebate(debateId)
    const turns = this.persistence.repositories.turns.listBySession(session.id)
    const usage = this.persistence.repositories.usage.listBySession(session.id)
    const evidence = this.persistence.repositories.research.listEvidence(session.id)
    if (!evaluation.ok || !review.ok || !turns.ok || !usage.ok || !evidence.ok) return this.failure('QUALITY_LOAD_FAILED', '质量数据读取失败', '无法汇集评分、复盘或证据统计。', true)
    return {
      ok: true,
      value: {
        evaluation: evaluation.value,
        review: review.value,
        evidenceCount: evidence.value.length,
        turnCount: turns.value.length,
        models: [...new Set(usage.value.map((record) => record.modelId).filter((item): item is string => Boolean(item)))]
      }
    }
  }

  listOverview(): DebateQualityResult<DebateQualityOverviewItem[]> {
    const evaluations = this.persistence.repositories.debateQuality.listEvaluations()
    if (!evaluations.ok) return this.failure('QUALITY_LOAD_FAILED', '质量趋势读取失败', '无法读取历史评分。', true)
    const items: DebateQualityOverviewItem[] = []
    for (const record of evaluations.value) {
      const debate = this.persistence.repositories.debates.findById(record.debateId)
      const turns = this.persistence.repositories.turns.listBySession(record.sessionId)
      const usage = this.persistence.repositories.usage.listBySession(record.sessionId)
      const evidence = this.persistence.repositories.research.listEvidence(record.sessionId)
      if (!debate.ok || !debate.value || !turns.ok || !usage.ok || !evidence.ok) continue
      const scores = Object.values(record.evaluation.scores).flatMap((side) => Object.values(side).map((score) => score.score))
      items.push({
        debateId: record.debateId, sessionId: record.sessionId, title: debate.value.topic,
        winner: record.evaluation.winner,
        averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10 : 0,
        evidenceCount: evidence.value.length, turnCount: turns.value.length,
        models: [...new Set(usage.value.map((item) => item.modelId).filter((item): item is string => Boolean(item)))],
        weaknesses: [...new Set([
          ...record.evaluation.weaknesses.affirmative,
          ...record.evaluation.weaknesses.negative
        ])],
        promptVersion: record.promptVersion, createdAt: record.createdAt
      })
    }
    return { ok: true, value: items }
  }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
