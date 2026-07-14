import type { CredentialResult } from '../security'

export interface SearchCredentialStore {
  getCredential(reference: string): Promise<CredentialResult<string | undefined>>
  setCredential(reference: string, credential: string): Promise<CredentialResult<void>>
  deleteCredential(reference: string): Promise<CredentialResult<boolean>>
  hasCredential(reference: string): Promise<CredentialResult<boolean>>
}
