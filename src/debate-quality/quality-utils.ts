import type { DebateRecord, PersistenceContext, SessionRecord, TurnRecord } from '../persistence'
import type { PublishedEvidence } from '../research'

const FORMAL_STAGES = new Set([
  'affirmative_opening', 'negative_opening', 'cross_examination', 'rebuttal', 'free_debate',
  'negative_closing', 'affirmative_closing', 'closing'
])

export interface QualitySourceData {
  debate: DebateRecord
  session: SessionRecord
  turns: TurnRecord[]
  evidence: PublishedEvidence[]
}

export function loadQualitySource(persistence: PersistenceContext, sessionId: string): QualitySourceData | undefined {
  const session = persistence.repositories.sessions.get(sessionId)
  if (!session.ok || !session.value) return undefined
  const debate = persistence.repositories.debates.findById(session.value.debateId)
  const turns = persistence.repositories.turns.listBySession(sessionId)
  const evidence = persistence.repositories.research.listEvidence(sessionId)
  if (!debate.ok || !debate.value || !turns.ok || !evidence.ok) return undefined
  return {
    debate: debate.value,
    session: session.value,
    turns: turns.value.filter((turn) => FORMAL_STAGES.has(turn.stage) && turn.status === 'completed'),
    evidence: evidence.value
  }
}

export function publicDebateInput(data: QualitySourceData): string {
  const transcript = bounded(data.turns.map((turn, index) =>
    `Turn ${index + 1} | ${turn.stage} | participant=${turn.participantId}\n${(turn.content ?? '').slice(0, 3_000)}`
  ).join('\n\n'), 80_000)
  const evidence = data.evidence.map((item) =>
    `${item.publicCode} | ${item.currentStatus} | ${item.title} | ${(item.summary ?? '').slice(0, 800)}`
  ).join('\n')
  return [
    `辩题：${data.debate.topic}`,
    `正方固定立场：${data.debate.affirmativePosition ?? '支持辩题'}`,
    `反方固定立场：${data.debate.negativePosition ?? '反对辩题'}`,
    `公开证据：\n${evidence || '无'}`,
    `正式辩论发言：\n${transcript || '无'}`
  ].join('\n\n')
}

export function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n[内容已按长度上限截断]`
}

