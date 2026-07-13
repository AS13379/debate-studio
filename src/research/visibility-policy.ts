import type { ParticipantRole } from '../domain'
import type { ResearchVisibility } from './types'

export class ResearchVisibilityPolicy {
  canModelRead(
    role: ParticipantRole,
    participantId: string,
    visibility: ResearchVisibility,
    ownerParticipantId: string
  ): boolean {
    if (visibility === 'public') return true
    if (participantId !== ownerParticipantId) return false
    return visibility === this.privateVisibilityFor(role)
  }

  privateVisibilityFor(role: ParticipantRole): ResearchVisibility | undefined {
    if (role === 'affirmative') return 'affirmative-private'
    if (role === 'negative') return 'negative-private'
    if (role === 'moderator') return 'moderator-private'
    return undefined
  }

  assertOwnedPrivateRecord(visibility: ResearchVisibility, ownerParticipantId: string): void {
    if (visibility !== 'public' && !ownerParticipantId.trim()) {
      throw new Error('Private research records require an owner participant.')
    }
  }
}
