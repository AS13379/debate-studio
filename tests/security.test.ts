import { describe, expect, it } from 'vitest'

import {
  createCredentialReference,
  MacOSKeychainCredentialStore,
  maskSecret,
  MemoryCredentialStore,
  redactForExport,
  redactSensitiveText,
  REDACTED,
  type CommandResult,
  type CommandRunner
} from '../src/security'

class FakeKeychainCommandRunner implements CommandRunner {
  readonly credentials = new Map<string, string>()
  readonly invocations: Array<{ args: readonly string[]; stdin?: string }> = []

  async run(_command: string, args: readonly string[], stdin?: string): Promise<CommandResult> {
    this.invocations.push({ args, stdin })
    const action = args[0]
    const accountIndex = args.indexOf('-a')
    const account = args[accountIndex + 1]

    if (action === 'add-generic-password') {
      this.credentials.set(account, stdin ?? '')
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    if (action === 'find-generic-password') {
      const value = this.credentials.get(account)
      return value === undefined
        ? { exitCode: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' }
        : { exitCode: 0, stdout: `${value}\n`, stderr: '' }
    }
    if (action === 'delete-generic-password') {
      const deleted = this.credentials.delete(account)
      return deleted
        ? { exitCode: 0, stdout: '', stderr: '' }
        : { exitCode: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' }
    }
    return { exitCode: 1, stdout: '', stderr: 'Unsupported command.' }
  }
}

describe('CredentialStore', () => {
  it('supports basic credential read and write', async () => {
    const store = new MemoryCredentialStore()

    expect((await store.setCredential('openai:primary', 'sk-test-secret')).ok).toBe(true)
    expect(await store.getCredential('openai:primary')).toEqual({ ok: true, value: 'sk-test-secret' })
    expect(await store.hasCredential('openai:primary')).toEqual({ ok: true, value: true })
  })

  it('cannot read a credential after deletion', async () => {
    const store = new MemoryCredentialStore()
    await store.setCredential('deepseek:primary', 'deepseek-secret')

    expect(await store.deleteCredential('deepseek:primary')).toEqual({ ok: true, value: true })
    expect(await store.getCredential('deepseek:primary')).toEqual({ ok: true, value: undefined })
    expect(await store.hasCredential('deepseek:primary')).toEqual({ ok: true, value: false })
  })

  it('keeps multiple credential references isolated', async () => {
    const store = new MemoryCredentialStore()
    const primary = createCredentialReference('openai', 'primary')
    const backup = createCredentialReference('openai', 'backup')
    const otherProvider = createCredentialReference('deepseek', 'primary')

    await store.setCredential(primary, 'secret-a')
    await store.setCredential(backup, 'secret-b')
    await store.setCredential(otherProvider, 'secret-c')

    expect(await store.getCredential(primary)).toEqual({ ok: true, value: 'secret-a' })
    expect(await store.getCredential(backup)).toEqual({ ok: true, value: 'secret-b' })
    expect(await store.getCredential(otherProvider)).toEqual({ ok: true, value: 'secret-c' })
  })

  it('uses the Keychain command without putting the secret in process arguments', async () => {
    const runner = new FakeKeychainCommandRunner()
    const store = new MacOSKeychainCredentialStore({ commandRunner: runner })
    const secret = 'sk-sensitive-value-123456'

    expect((await store.setCredential('openai:primary', secret)).ok).toBe(true)
    expect(await store.getCredential('openai:primary')).toEqual({ ok: true, value: secret })
    expect(runner.invocations[0]?.args).not.toContain(secret)
    expect(runner.invocations[0]?.args.at(-1)).toBe('-w')
    expect(runner.invocations[0]?.stdin).toBe(secret)
  })

  it('redacts secrets from text and exported structures', () => {
    const secret = 'sk-sensitive-value-123456'
    const log = `request failed: apiKey=${secret}; Authorization: Bearer ${secret}`

    expect(maskSecret(secret)).toBe('sk-…456')
    expect(redactSensitiveText(log, [secret])).not.toContain(secret)
    expect(redactSensitiveText(log, [secret])).toContain(REDACTED)
    expect(
      redactForExport({ provider: 'openai', apiKey: secret, nested: { token: secret }, message: `failed for ${secret}` }, [secret])
    ).toEqual({
      provider: 'openai',
      apiKey: REDACTED,
      nested: { token: REDACTED },
      message: `failed for ${REDACTED}`
    })
  })

  it('returns a structured error when macOS Keychain is unavailable', async () => {
    const unavailableRunner: CommandRunner = {
      run: async () => { throw new Error('ENOENT') }
    }
    const store = new MacOSKeychainCredentialStore({ commandRunner: unavailableRunner })

    expect(await store.getCredential('openai:primary')).toMatchObject({
      ok: false,
      error: { code: 'KEYCHAIN_UNAVAILABLE', operation: 'get', retryable: true }
    })
  })
})
