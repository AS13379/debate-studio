import type { CredentialResult, CredentialStore } from './credential-store'

/** Volatile test/development store. Values are never written to disk. */
export class MemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, string>()

  async setCredential(reference: string, credential: string): Promise<CredentialResult<void>> {
    if (!reference.trim() || !credential) return this.invalid('set')
    this.credentials.set(reference, credential)
    return { ok: true, value: undefined }
  }

  async getCredential(reference: string): Promise<CredentialResult<string | undefined>> {
    if (!reference.trim()) return this.invalid('get')
    return { ok: true, value: this.credentials.get(reference) }
  }

  async deleteCredential(reference: string): Promise<CredentialResult<boolean>> {
    if (!reference.trim()) return this.invalid('delete')
    return { ok: true, value: this.credentials.delete(reference) }
  }

  async hasCredential(reference: string): Promise<CredentialResult<boolean>> {
    if (!reference.trim()) return this.invalid('has')
    return { ok: true, value: this.credentials.has(reference) }
  }

  private invalid(operation: 'set' | 'get' | 'delete' | 'has'): CredentialResult<never> {
    return {
      ok: false,
      error: {
        code: 'INVALID_CREDENTIAL',
        message: 'Credential reference and credential must be non-empty.',
        operation,
        retryable: false
      }
    }
  }
}

