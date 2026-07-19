import type { DebateTurnDto, RunEventDto, RunStateDto } from '../../shared/ipc-contract'

export interface LiveRunSnapshot {
  state?: RunStateDto
  turns: DebateTurnDto[]
  reasoningByTurn?: Record<string, LiveReasoningSnapshot>
}

export interface LiveReasoningSnapshot {
  content: string
  updatedAt: string
  truncated: boolean
  receivedCharacters: number
}

const MAX_TRANSIENT_REASONING_CHARACTERS = 120_000
const TRUNCATION_NOTICE = '……较早的思考内容已因界面长度上限折叠……\n\n'

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
    case 'turnReasoningUpdated': {
      const previous = snapshot.reasoningByTurn?.[event.turnId]
      const combined = `${previous?.content ?? ''}${event.delta}`
      const truncated = Boolean(previous?.truncated) || combined.length > MAX_TRANSIENT_REASONING_CHARACTERS
      const content = combined.length > MAX_TRANSIENT_REASONING_CHARACTERS
        ? `${TRUNCATION_NOTICE}${combined.slice(-(MAX_TRANSIENT_REASONING_CHARACTERS - TRUNCATION_NOTICE.length))}`
        : combined
      return {
        ...snapshot,
        reasoningByTurn: {
          ...snapshot.reasoningByTurn,
          [event.turnId]: {
            content,
            updatedAt: event.createdAt,
            truncated,
            receivedCharacters: (previous?.receivedCharacters ?? 0) + event.delta.length
          }
        }
      }
    }
    case 'turnCompleted':
      return { ...snapshot, turns: upsertTurn(snapshot.turns, event.turn) }
    case 'turnFailed': {
      const updated = { ...snapshot, turns: upsertTurn(snapshot.turns, event.turn) }
      return event.turn.status === 'failed'
        ? withStatus(updated, event.sessionId, 'failed', event.turn.stage)
        : updated
    }
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
