import type { ParticipantRole } from '../domain'
import type { DebateRepository, ResearchRepository } from '../persistence'
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

  constructor(
    private readonly debates: DebateRepository,
    private readonly research: ResearchRepository
  ) {}

  load(request: ResearchContextRequest): ResearchPromptContext {
    const debate = this.unwrap(this.debates.findById(request.debateId), '辩论配置')
    const publicPool = this.unwrap(this.research.getPublicPool(request.debateSessionId), '公共资源池')
    const sources = this.unwrap(this.research.listSources(request.debateSessionId), '研究资料')
    const assets = this.unwrap(this.research.listAssets(request.debateSessionId), '研究资产')
    const notes = this.unwrap(this.research.listNotes(request.debateSessionId), '研究笔记')
    const claims = this.unwrap(this.research.listClaims(request.debateSessionId), '暂定主张')
    const evidence = this.unwrap(this.research.listEvidence(request.debateSessionId), '公开证据')

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
      publishedEvidence: evidence
    }
  }

  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, label: string): T {
    if (!result.ok) throw new Error(`读取${label}失败：${result.error.message}`)
    return result.value
  }
}
