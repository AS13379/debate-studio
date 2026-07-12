export type PersistenceErrorCode =
  | 'INVALID_PATH'
  | 'OPEN_FAILED'
  | 'DATABASE_CLOSED'
  | 'QUERY_FAILED'
  | 'MIGRATION_FAILED'
  | 'SERIALIZATION_FAILED'

export interface PersistenceError {
  code: PersistenceErrorCode
  message: string
  operation: string
  cause?: unknown
}

export type PersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PersistenceError }

export function persistenceFailure(
  code: PersistenceErrorCode,
  operation: string,
  cause: unknown,
  message?: string
): PersistenceResult<never> {
  return {
    ok: false,
    error: {
      code,
      operation,
      cause,
      message: message ?? (cause instanceof Error ? cause.message : 'Unknown persistence error.')
    }
  }
}

