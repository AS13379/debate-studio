import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializePersistence, type PersistenceContext, type SessionRecord } from '../src/persistence'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'debate-studio-session-'))
  temporaryDirectories.push(path)
  return path
}

function initializedContext(): PersistenceContext {
  const initialized = initializePersistence({ appDataDirectory: temporaryDirectory() })
  if (!initialized.ok) throw initialized.error
  return initialized.value
}

function seedSession(context: PersistenceContext): SessionRecord {
  const session: SessionRecord = {
    id: 'session-readonly',
    debateId: 'debate-readonly',
    status: 'draft',
    currentStage: 'draft',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z'
  }
  const debate = context.database.run(
    'INSERT INTO debates (id, topic, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    session.debateId,
    '只读 Session 测试',
    'draft',
    session.createdAt,
    session.updatedAt
  )
  if (!debate.ok) throw debate.error
  const inserted = context.database.run(
    `INSERT INTO sessions (id, debate_id, status, current_stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    session.id,
    session.debateId,
    session.status,
    session.currentStage,
    session.createdAt,
    session.updatedAt
  )
  if (!inserted.ok) throw inserted.error
  return session
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('SQLiteSessionRepository', () => {
  it('reads an existing Session and checks existence without exposing write methods', () => {
    const context = initializedContext()
    const session = seedSession(context)
    const repository = context.repositories.sessions

    expect(repository.get(session.id)).toEqual({ ok: true, value: session })
    expect(repository.exists(session.id)).toEqual({ ok: true, value: true })
    expect(repository).not.toHaveProperty('save')
    expect(repository).not.toHaveProperty('delete')
    expect(repository).not.toHaveProperty('update')
    context.database.close()
  })

  it('returns empty and false results for a missing Session', () => {
    const context = initializedContext()

    expect(context.repositories.sessions.get('missing-session')).toEqual({ ok: true, value: undefined })
    expect(context.repositories.sessions.exists('missing-session')).toEqual({ ok: true, value: false })
    context.database.close()
  })

  it('shares the PersistenceContext database connection and rejects reads after it closes', () => {
    const context = initializedContext()
    const sessions = context.repositories.sessions
    const settings = context.repositories.settings

    expect(settings.set('connection-proof', true).ok).toBe(true)
    expect(context.database.close()).toEqual({ ok: true, value: undefined })
    expect(sessions.get('any-session')).toMatchObject({ ok: false, error: { code: 'DATABASE_CLOSED' } })
    expect(settings.get('connection-proof')).toMatchObject({ ok: false, error: { code: 'DATABASE_CLOSED' } })
  })
})
