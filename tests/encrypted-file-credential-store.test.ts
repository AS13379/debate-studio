import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  EncryptedFileCredentialStore,
  type CredentialCipher
} from '../src/security'

class TestCipher implements CredentialCipher {
  constructor(private readonly available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Array.from(Buffer.from(value), (byte) => byte ^ 0xa5))
  }

  decryptString(value: Buffer): string {
    return Buffer.from(Array.from(value, (byte) => byte ^ 0xa5)).toString()
  }
}

describe('EncryptedFileCredentialStore', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  function createStore(cipher: CredentialCipher = new TestCipher()) {
    const directory = mkdtempSync(join(tmpdir(), 'debate-credentials-'))
    directories.push(directory)
    const filePath = join(directory, 'security', 'credentials.bin')
    return { store: new EncryptedFileCredentialStore({ filePath, cipher }), filePath }
  }

  it('persists multiple isolated credentials only inside an encrypted payload', async () => {
    const { store, filePath } = createStore()
    const firstReference = 'deepseek:primary'
    const firstSecret = 'sk-sensitive-deepseek-value'

    expect(await store.setCredential(firstReference, firstSecret)).toEqual({ ok: true, value: undefined })
    expect(await store.setCredential('openai:backup', 'sk-sensitive-openai-value')).toEqual({ ok: true, value: undefined })

    expect(await store.getCredential(firstReference)).toEqual({ ok: true, value: firstSecret })
    expect(await store.hasCredential('openai:backup')).toEqual({ ok: true, value: true })
    const rawFile = readFileSync(filePath)
    expect(rawFile.includes(Buffer.from(firstReference))).toBe(false)
    expect(rawFile.includes(Buffer.from(firstSecret))).toBe(false)
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it('deletes a credential without affecting the remaining vault', async () => {
    const { store } = createStore()
    await store.setCredential('deepseek:primary', 'secret-a')
    await store.setCredential('openai:primary', 'secret-b')

    expect(await store.deleteCredential('deepseek:primary')).toEqual({ ok: true, value: true })
    expect(await store.getCredential('deepseek:primary')).toEqual({ ok: true, value: undefined })
    expect(await store.getCredential('openai:primary')).toEqual({ ok: true, value: 'secret-b' })
  })

  it('returns a structured error when system encryption is unavailable', async () => {
    const { store } = createStore(new TestCipher(false))

    expect(await store.setCredential('deepseek:primary', 'secret')).toMatchObject({
      ok: false,
      error: { code: 'KEYCHAIN_UNAVAILABLE', operation: 'set', retryable: true }
    })
  })

  it('returns a structured error for a corrupted encrypted vault', async () => {
    const { store, filePath } = createStore()
    await store.setCredential('deepseek:primary', 'secret')
    writeFileSync(filePath, Buffer.from('not-an-encrypted-vault'))

    expect(await store.getCredential('deepseek:primary')).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_FAILED', operation: 'get', retryable: true }
    })
  })
})
