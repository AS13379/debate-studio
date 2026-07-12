import { ProcessCommandRunner, type CommandResult, type CommandRunner } from './command-runner'
import type { CredentialError, CredentialResult, CredentialStore } from './credential-store'
import { redactSensitiveText } from './redaction'

export interface MacOSKeychainCredentialStoreOptions {
  serviceName?: string
  securityCommandPath?: string
  commandRunner?: CommandRunner
}

export class MacOSKeychainCredentialStore implements CredentialStore {
  private readonly serviceName: string
  private readonly securityCommandPath: string
  private readonly commandRunner: CommandRunner

  constructor(options: MacOSKeychainCredentialStoreOptions = {}) {
    this.serviceName = options.serviceName ?? 'com.debate-studio.credentials'
    this.securityCommandPath = options.securityCommandPath ?? '/usr/bin/security'
    this.commandRunner = options.commandRunner ?? new ProcessCommandRunner()
  }

  async setCredential(reference: string, credential: string): Promise<CredentialResult<void>> {
    const invalid = this.validate(reference, credential, 'set')
    if (invalid) return { ok: false, error: invalid }

    try {
      // Keeping -w last makes the security tool read the password from stdin instead of process arguments.
      const result = await this.commandRunner.run(
        this.securityCommandPath,
        ['add-generic-password', '-a', reference, '-s', this.serviceName, '-U', '-w'],
        credential
      )
      return result.exitCode === 0
        ? { ok: true, value: undefined }
        : { ok: false, error: this.commandError('set', result, credential) }
    } catch {
      return { ok: false, error: this.unavailable('set') }
    }
  }

  async getCredential(reference: string): Promise<CredentialResult<string | undefined>> {
    const invalid = this.validate(reference, undefined, 'get')
    if (invalid) return { ok: false, error: invalid }

    try {
      const result = await this.commandRunner.run(
        this.securityCommandPath,
        ['find-generic-password', '-a', reference, '-s', this.serviceName, '-w']
      )
      if (this.isMissing(result)) return { ok: true, value: undefined }
      if (result.exitCode !== 0) return { ok: false, error: this.commandError('get', result) }
      return { ok: true, value: result.stdout.replace(/\r?\n$/, '') }
    } catch {
      return { ok: false, error: this.unavailable('get') }
    }
  }

  async deleteCredential(reference: string): Promise<CredentialResult<boolean>> {
    const invalid = this.validate(reference, undefined, 'delete')
    if (invalid) return { ok: false, error: invalid }

    try {
      const result = await this.commandRunner.run(
        this.securityCommandPath,
        ['delete-generic-password', '-a', reference, '-s', this.serviceName]
      )
      if (this.isMissing(result)) return { ok: true, value: false }
      return result.exitCode === 0
        ? { ok: true, value: true }
        : { ok: false, error: this.commandError('delete', result) }
    } catch {
      return { ok: false, error: this.unavailable('delete') }
    }
  }

  async hasCredential(reference: string): Promise<CredentialResult<boolean>> {
    const result = await this.getCredential(reference)
    if (!result.ok) return { ok: false, error: { ...result.error, operation: 'has' } }
    return { ok: true, value: result.value !== undefined }
  }

  private validate(
    reference: string,
    credential: string | undefined,
    operation: CredentialError['operation']
  ): CredentialError | undefined {
    if (!reference.trim() || reference.includes('\0') || (credential !== undefined && credential.length === 0)) {
      return {
        code: 'INVALID_CREDENTIAL',
        message: 'Credential reference and credential must be non-empty.',
        operation,
        retryable: false
      }
    }
    return undefined
  }

  private isMissing(result: CommandResult): boolean {
    return result.exitCode === 44 || /could not be found/i.test(result.stderr)
  }

  private commandError(
    operation: CredentialError['operation'],
    result: CommandResult,
    knownSecret?: string
  ): CredentialError {
    const accessDenied = /denied|interaction is not allowed|authorization/i.test(result.stderr)
    return {
      code: accessDenied ? 'ACCESS_DENIED' : 'OPERATION_FAILED',
      message: redactSensitiveText(result.stderr.trim() || 'macOS Keychain operation failed.', knownSecret ? [knownSecret] : []),
      operation,
      retryable: !accessDenied
    }
  }

  private unavailable(operation: CredentialError['operation']): CredentialError {
    return {
      code: 'KEYCHAIN_UNAVAILABLE',
      message: 'macOS Keychain is unavailable.',
      operation,
      retryable: true
    }
  }
}

