export type DebateParticipantRole = 'affirmative' | 'negative' | 'moderator' | 'judge'

export interface DebateParticipantConfig {
  id: string
  sessionId: string
  role: DebateParticipantRole
  modelProfileId: string
  displayName: string
  systemPromptTemplate?: string
  createdAt: string
  updatedAt: string
}

export interface DebateSessionParticipantBindings {
  sessionId: string
  affirmative?: DebateParticipantConfig
  negative?: DebateParticipantConfig
  moderator?: DebateParticipantConfig
  judge?: DebateParticipantConfig
}

export function buildDebateSessionParticipantBindings(
  sessionId: string,
  participants: readonly DebateParticipantConfig[]
): DebateSessionParticipantBindings {
  const bindings: DebateSessionParticipantBindings = { sessionId }
  for (const participant of participants) {
    if (participant.sessionId !== sessionId) continue
    bindings[participant.role] = { ...participant }
  }
  return bindings
}

