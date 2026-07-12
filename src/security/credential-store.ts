export type CredentialErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'ACCESS_DENIED'
  | 'OPERATION_FAILED'

export interface CredentialError {
  code: CredentialErrorCode
  message: string
  operation: 'set' | 'get' | 'delete' | 'has'
  retryable: boolean
}

export type CredentialResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CredentialError }

export interface CredentialStore {
  setCredential(reference: string, credential: string): Promise<CredentialResult<void>>
  getCredential(reference: string): Promise<CredentialResult<string | undefined>>
  deleteCredential(reference: string): Promise<CredentialResult<boolean>>
  hasCredential(reference: string): Promise<CredentialResult<boolean>>
}

/**
 * Design-only boundary for a possible local development fallback.
 * A future implementation must require explicit opt-in and must never store its file in the repository.
 * macOS Keychain remains the recommended and default store.
 */
export interface InsecureLocalCredentialStoreOptions {
  filePathOutsideRepository: string
  explicitlyAllowPlaintext: true
}

export function createCredentialReference(providerId: string, keyId: string): string {
  if (!providerId.trim() || !keyId.trim()) throw new Error('Provider id and key id are required.')
  return `${providerId.trim()}:${keyId.trim()}`
}

