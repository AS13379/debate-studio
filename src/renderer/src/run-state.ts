import type { DebateTurnDto, RunEventDto, RunStateDto } from '../../shared/ipc-contract'

export interface LiveRunSnapshot {
  state?: RunStateDto
  turns: DebateTurnDto[]
}

export function applyRunEvent(snapshot: LiveRunSnapshot, event: RunEventDto): LiveRunSnapshot {
  switch (event.type) {
    case 'stateChanged':
      return {
        ...snapshot,
        state: snapshot.state
          ? { ...snapshot.state, status: event.state.status, currentStage: event.state.currentStage }
          : {
              sessionId: event.sessionId,
              status: event.state.status,
              currentStage: event.state.currentStage,
              active: event.state.status === 'running' || event.state.status === 'streaming'
            }
      }
    case 'turnStarted':
      return { ...snapshot, turns: upsertTurn(snapshot.turns, event.turn) }
    case 'turnUpdated': {
      const existing = snapshot.turns.find((turn) => turn.id === event.turnId)
      const updated: DebateTurnDto = existing
        ? { ...existing, status: 'streaming', content: event.content }
        : {
            id: event.turnId,
            sessionId: event.sessionId,
            participantId: event.participantId,
            stage: event.stage,
            status: 'streaming',
            content: event.content,
            createdAt: event.createdAt
          }
      return { ...snapshot, turns: upsertTurn(snapshot.turns, updated) }
    }
    case 'turnCompleted':
    case 'turnFailed':
      return { ...snapshot, turns: upsertTurn(snapshot.turns, event.turn) }
    case 'sessionPaused':
      return withStatus(snapshot, event.sessionId, 'paused')
    case 'sessionStopped':
      return withStatus(snapshot, event.sessionId, 'stopped')
    case 'sessionCompleted':
      return withStatus(snapshot, event.sessionId, 'completed', 'completed')
  }
}

function upsertTurn(turns: DebateTurnDto[], turn: DebateTurnDto): DebateTurnDto[] {
  const index = turns.findIndex((candidate) => candidate.id === turn.id)
  if (index < 0) return [...turns, turn]
  return turns.map((candidate, candidateIndex) => candidateIndex === index ? turn : candidate)
}

function withStatus(
  snapshot: LiveRunSnapshot,
  sessionId: string,
  status: string,
  currentStage = snapshot.state?.currentStage ?? 'draft'
): LiveRunSnapshot {
  return {
    ...snapshot,
    state: {
      sessionId,
      status,
      currentStage,
      active: false,
      lastTurn: snapshot.state?.lastTurn
    }
  }
}
