import type { EvidenceReferenceIssue, PublishedEvidence } from './types'

export interface EvidenceReferenceValidationInput {
  debateSessionId: string
  turnId: string
  participantId: string
  content: string
  evidence: readonly PublishedEvidence[]
  createId(): string
  createdAt: string
}

export class EvidenceReferenceValidator {
  validate(input: EvidenceReferenceValidationInput): EvidenceReferenceIssue[] {
    const known = new Set(input.evidence.map((item) => item.publicCode.toUpperCase()))
    const references = new Set(input.content.match(/\b[ABM]-S\d+\b/gi)?.map((item) => item.toUpperCase()) ?? [])
    return [...references]
      .filter((reference) => !known.has(reference))
      .map((reference) => ({
        id: input.createId(),
        debateSessionId: input.debateSessionId,
        turnId: input.turnId,
        participantId: input.participantId,
        referenceCode: reference,
        reason: 'EVIDENCE_NOT_FOUND',
        createdAt: input.createdAt
      }))
  }
}
