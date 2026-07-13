import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CredentialError, CredentialResult, CredentialStore } from './credential-store'

export interface CredentialCipher {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface EncryptedFileCredentialStoreOptions {
  filePath: string
  cipher: CredentialCipher
}

interface CredentialVault {
  version: 1
  credentials: Record<string, string>
}

/**
 * Stores one system-encrypted vault outside SQLite and the project directory.
 * Both credential references and values are inside the encrypted payload.
 */
export class EncryptedFileCredentialStore implements CredentialStore {
  private readonly filePath: string
  private readonly cipher: CredentialCipher

  constructor(options: EncryptedFileCredentialStoreOptions) {
    this.filePath = options.filePath
    this.cipher = options.cipher
  }

  async setCredential(reference: string, credential: string): Promise<CredentialResult<void>> {
    const invalid = this.validate(reference, credential, 'set')
    if (invalid) return { ok: false, error: invalid }

    try {
      const vault = this.readVault()
      this.writeVault({
        ...vault,
        credentials: { ...vault.credentials, [reference]: credential }
      })
      return { ok: true, value: undefined }
    } catch {
      return { ok: false, error: this.operationError('set') }
    }
  }

  async getCredential(reference: string): Promise<CredentialResult<string | undefined>> {
    const invalid = this.validate(reference, undefined, 'get')
    if (invalid) return { ok: false, error: invalid }

    try {
      return { ok: true, value: this.readVault().credentials[reference] }
    } catch {
      return { ok: false, error: this.operationError('get') }
    }
  }

  async deleteCredential(reference: string): Promise<CredentialResult<boolean>> {
    const invalid = this.validate(reference, undefined, 'delete')
    if (invalid) return { ok: false, error: invalid }

    try {
      const vault = this.readVault()
      if (!Object.hasOwn(vault.credentials, reference)) return { ok: true, value: false }
      delete vault.credentials[reference]
      this.writeVault(vault)
      return { ok: true, value: true }
    } catch {
      return { ok: false, error: this.operationError('delete') }
    }
  }

  async hasCredential(reference: string): Promise<CredentialResult<boolean>> {
    const result = await this.getCredential(reference)
    if (!result.ok) return { ok: false, error: { ...result.error, operation: 'has' } }
    return { ok: true, value: Boolean(result.value) }
  }

  private readVault(): CredentialVault {
    if (!existsSync(this.filePath)) return this.emptyVault()
    this.assertEncryptionAvailable()
    const encrypted = readFileSync(this.filePath)
    if (encrypted.length === 0) throw new Error('Credential vault is empty.')
    const parsed: unknown = JSON.parse(this.cipher.decryptString(encrypted))
    if (!this.isCredentialVault(parsed)) throw new Error('Credential vault format is invalid.')
    return parsed
  }

  private writeVault(vault: CredentialVault): void {
    this.assertEncryptionAvailable()
    const encrypted = this.cipher.encryptString(JSON.stringify(vault))
    if (encrypted.length === 0) throw new Error('Credential encryption returned an empty payload.')

    const directory = dirname(this.filePath)
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    try {
      writeFileSync(temporaryPath, encrypted, { mode: 0o600 })
      renameSync(temporaryPath, this.filePath)
      chmodSync(this.filePath, 0o600)
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      throw error
    }
  }

  private assertEncryptionAvailable(): void {
    if (!this.cipher.isEncryptionAvailable()) throw new Error('System encryption is unavailable.')
  }

  private emptyVault(): CredentialVault {
    return { version: 1, credentials: {} }
  }

  private isCredentialVault(value: unknown): value is CredentialVault {
    if (!value || typeof value !== 'object') return false
    const candidate = value as { version?: unknown; credentials?: unknown }
    if (
      candidate.version !== 1 ||
      !candidate.credentials ||
      typeof candidate.credentials !== 'object' ||
      Array.isArray(candidate.credentials)
    ) return false
    return Object.values(candidate.credentials).every((credential) => typeof credential === 'string' && credential.length > 0)
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

  private operationError(operation: CredentialError['operation']): CredentialError {
    let encryptionAvailable = false
    try {
      encryptionAvailable = this.cipher.isEncryptionAvailable()
    } catch {
      // Treat cipher availability failures as an unavailable system encryption service.
    }
    return {
      code: encryptionAvailable ? 'OPERATION_FAILED' : 'KEYCHAIN_UNAVAILABLE',
      message: encryptionAvailable
        ? 'Encrypted credential storage operation failed.'
        : 'System credential encryption is unavailable.',
      operation,
      retryable: true
    }
  }
}
