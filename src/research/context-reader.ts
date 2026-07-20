import type { ParticipantRole } from '../domain'
import type {
  DebateParticipantRepository,
  DebateRepository,
  ResearchRepository,
  TurnRepository
} from '../persistence'
import type { ResearchPromptContext, ResearchVisibility } from './types'
import { ResearchVisibilityPolicy } from './visibility-policy'

export interface ResearchContextRequest {
  debateSessionId: string
  debateId: string
  participantId: string
  role: ParticipantRole
  topic: string
}

export class ResearchContextReader {
  private readonly policy = new ResearchVisibilityPolicy()

  private readonly formalStages = new Set([
    'affirmative_opening',
    'negative_opening',
    'cross_examination',
    'rebuttal',
    'free_debate',
    'negative_closing',
    'affirmative_closing',
    'closing'
  ])

  constructor(
    private readonly debates: DebateRepository,
    private readonly research: ResearchRepository,
    private readonly turns: TurnRepository,
    private readonly participants: DebateParticipantRepository
  ) {}

  load(request: ResearchContextRequest): ResearchPromptContext {
    const debate = this.unwrap(this.debates.findById(request.debateId), '辩论配置')
    const publicPool = this.unwrap(this.research.getPublicPool(request.debateSessionId), '公共资源池')
    const sources = this.unwrap(this.research.listSources(request.debateSessionId), '研究资料')
    const assets = this.unwrap(this.research.listAssets(request.debateSessionId), '研究资产')
    const notes = this.unwrap(this.research.listNotes(request.debateSessionId), '研究笔记')
    const claims = this.unwrap(this.research.listClaims(request.debateSessionId), '暂定主张')
    const evidence = this.unwrap(this.research.listEvidence(request.debateSessionId), '公开证据')
    const turns = this.unwrap(this.turns.listBySession(request.debateSessionId), '正式辩论发言')
    const participants = this.unwrap(this.participants.listBySession(request.debateSessionId), '辩论参与者')
    const participantsById = new Map(participants.map((participant) => [participant.id, participant]))

    const readable = <T extends { ownerParticipantId: string; visibility: ResearchVisibility }>(record: T) =>
      this.policy.canModelRead(request.role, request.participantId, record.visibility, record.ownerParticipantId)

    return {
      debateSessionId: request.debateSessionId,
      participantId: request.participantId,
      role: request.role,
      topic: debate?.topic ?? request.topic,
      background: debate?.background,
      affirmativePosition: debate?.affirmativePosition,
      negativePosition: debate?.negativePosition,
      publicPool,
      visibleSources: sources.filter(readable),
      visibleAssets: assets.filter(readable),
      visibleNotes: notes.filter(readable),
      visibleClaims: claims.filter(readable),
      publishedEvidence: evidence,
      publicDebateTurns: turns
        .filter((turn) => turn.status === 'completed' && this.formalStages.has(turn.stage) && Boolean(turn.content?.trim()))
        .map((turn) => {
          const participant = participantsById.get(turn.participantId)
          return {
            id: turn.id,
            stage: turn.stage,
            participantId: turn.participantId,
            participantRole: participant?.role ?? 'moderator',
            participantName: participant?.displayName ?? turn.participantId,
            content: turn.content!.trim(),
            createdAt: turn.createdAt
          }
        })
    }
  }

  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, label: string): T {
    if (!result.ok) throw new Error(`读取${label}失败：${result.error.message}`)
    return result.value
  }
}
