import { randomUUID } from 'node:crypto'

import type { DebateTurn } from '../domain'
import type { DebateParticipantRepository, PersistenceResult, ResearchRepository } from '../persistence'
import { EvidenceReferenceValidator } from './evidence-reference-validator'
import type { PrivateResearchVisibility, ResearchOwnerRole, ResearchSession } from './types'

export interface ResearchRunCoordinatorDependencies {
  research: ResearchRepository
  participants: DebateParticipantRepository
  createId?: () => string
  now?: () => Date
}

export class ResearchRunCoordinator {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly evidenceValidator = new EvidenceReferenceValidator()

  constructor(private readonly dependencies: ResearchRunCoordinatorDependencies) {
    this.createId = dependencies.createId ?? randomUUID
    this.now = dependencies.now ?? (() => new Date())
  }

  handleCompletedTurn(turn: DebateTurn): PersistenceResult<void> {
    if (turn.status !== 'completed') return { ok: true, value: undefined }
    const participant = this.dependencies.participants.get(turn.participantId)
    if (!participant.ok) return participant
    if (!participant.value) return { ok: true, value: undefined }
    const role = participant.value.role
    if (role === 'judge') return this.validateEvidenceReferences(turn)

    if (turn.stage === 'public_pool' && role === 'moderator') {
      return this.savePublicPool(turn, participant.value.id)
    }
    if (turn.stage === 'affirmative_planning' || turn.stage === 'negative_planning') {
      return this.savePlan(turn, participant.value.id, role)
    }
    if (turn.stage === 'affirmative_research' || turn.stage === 'negative_research') {
      return this.saveResearch(turn, participant.value.id, role)
    }
    if (turn.stage === 'argument_drafting') {
      return this.saveDraft(turn, participant.value.id, role)
    }
    if (turn.stage === 'affirmative_opening' || turn.stage === 'negative_opening') {
      const completed = this.ensureSession(turn.sessionId, participant.value.id, role, 'completed')
      if (!completed.ok) return completed
    }
    return this.validateEvidenceReferences(turn)
  }

  private savePublicPool(turn: DebateTurn, ownerParticipantId: string): PersistenceResult<void> {
    const researchSession = this.ensureSession(turn.sessionId, ownerParticipantId, 'moderator', 'completed')
    if (!researchSession.ok) return researchSession
    const parsed = this.object(turn.content)
    const now = this.timestamp()
    return this.dependencies.research.savePublicPool({
      id: this.createId(), debateSessionId: turn.sessionId, ownerParticipantId, visibility: 'public',
      topicDefinition: this.string(parsed.topicDefinition) || turn.content || '主持人尚未补充辩题定义。',
      temporalScope: this.string(parsed.temporalScope) || undefined,
      geographicScope: this.string(parsed.geographicScope) || undefined,
      keyConcepts: this.strings(parsed.keyConcepts),
      controversyDirections: this.strings(parsed.controversyDirections),
      userSubmittedSourceIds: [], factBoundaries: this.strings(parsed.factBoundaries),
      moderatorNotes: this.string(parsed.moderatorNotes) || undefined, createdAt: now, updatedAt: now
    })
  }

  private savePlan(turn: DebateTurn, ownerParticipantId: string, role: ResearchOwnerRole): PersistenceResult<void> {
    const researchSession = this.ensureSession(turn.sessionId, ownerParticipantId, role, 'planning')
    if (!researchSession.ok) return researchSession
    const parsed = this.object(turn.content)
    const goals = this.strings(parsed.goals)
    const questions = [...this.strings(parsed.questions), ...this.strings(parsed.unresolvedQuestions)]
    const fallbackGoals = goals.length ? goals : [turn.content || '研究计划尚未提供具体目标。']
    for (const description of fallbackGoals) {
      const saved = this.dependencies.research.saveGoal({
        id: this.createId(), debateSessionId: turn.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId, visibility: this.visibility(role), description, status: 'planned',
        createdAt: this.timestamp(), updatedAt: this.timestamp()
      })
      if (!saved.ok) return saved
    }
    for (const query of questions) {
      const saved = this.dependencies.research.saveQuery({
        id: this.createId(), debateSessionId: turn.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId, visibility: this.visibility(role), query, createdAt: this.timestamp()
      })
      if (!saved.ok) return saved
    }
    return { ok: true, value: undefined }
  }

  private saveResearch(turn: DebateTurn, ownerParticipantId: string, role: ResearchOwnerRole): PersistenceResult<void> {
    const researchSession = this.ensureSession(turn.sessionId, ownerParticipantId, role, 'researching')
    if (!researchSession.ok) return researchSession
    const parsed = this.object(turn.content)
    const note = this.dependencies.research.saveNote({
      id: this.createId(), debateSessionId: turn.sessionId, researchSessionId: researchSession.value.id,
      ownerParticipantId, visibility: this.visibility(role),
      content: turn.content || '研究阶段已完成，但没有文本输出。', createdAt: this.timestamp()
    })
    if (!note.ok) return note
    for (const claim of this.strings(parsed.provisionalClaims)) {
      const saved = this.dependencies.research.saveClaim({
        id: this.createId(), debateSessionId: turn.sessionId, researchSessionId: researchSession.value.id,
        ownerParticipantId, visibility: this.visibility(role), claim,
        supportingSourceIds: this.strings(parsed.selectedSources), unresolved: true, createdAt: this.timestamp()
      })
      if (!saved.ok) return saved
    }
    return { ok: true, value: undefined }
  }

  private saveDraft(turn: DebateTurn, ownerParticipantId: string, role: ResearchOwnerRole): PersistenceResult<void> {
    const researchSession = this.ensureSession(turn.sessionId, ownerParticipantId, role, 'drafting')
    if (!researchSession.ok) return researchSession
    return this.dependencies.research.saveNote({
      id: this.createId(), debateSessionId: turn.sessionId, researchSessionId: researchSession.value.id,
      ownerParticipantId, visibility: this.visibility(role),
      content: `论证草案：\n${turn.content || '无内容'}`, createdAt: this.timestamp()
    })
  }

  private validateEvidenceReferences(turn: DebateTurn): PersistenceResult<void> {
    const evidence = this.dependencies.research.listEvidence(turn.sessionId)
    if (!evidence.ok) return evidence
    const issues = this.evidenceValidator.validate({
      debateSessionId: turn.sessionId, turnId: turn.id, participantId: turn.participantId,
      content: turn.content || '', evidence: evidence.value,
      createId: this.createId, createdAt: this.timestamp()
    })
    for (const issue of issues) {
      const saved = this.dependencies.research.createReferenceIssue(issue)
      if (!saved.ok) return saved
    }
    return { ok: true, value: undefined }
  }

  private ensureSession(
    debateSessionId: string,
    ownerParticipantId: string,
    role: ResearchOwnerRole,
    status: ResearchSession['status']
  ): PersistenceResult<ResearchSession> {
    const existing = this.dependencies.research.findSessionByOwner(debateSessionId, role)
    if (!existing.ok) return existing
    const timestamp = this.timestamp()
    const session: ResearchSession = existing.value
      ? { ...existing.value, status, updatedAt: timestamp }
      : {
          id: this.createId(), debateSessionId, ownerParticipantId, ownerRole: role,
          visibility: this.visibility(role), status, createdAt: timestamp, updatedAt: timestamp
        }
    const saved = this.dependencies.research.saveSession(session)
    return saved.ok ? { ok: true, value: session } : saved
  }

  private visibility(role: ResearchOwnerRole): PrivateResearchVisibility {
    return `${role}-private` as PrivateResearchVisibility
  }

  private object(content?: string): Record<string, unknown> {
    if (!content) return {}
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(cleaned) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }

  private string(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  private strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}
