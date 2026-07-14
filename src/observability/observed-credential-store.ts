import type { CredentialResult, CredentialStore } from '../security'
import { ErrorCenter } from './error-center'
import type { LoggerLike } from './types'

export class ObservedCredentialStore implements CredentialStore {
  constructor(
    private readonly delegate: CredentialStore,
    private readonly logger: LoggerLike,
    private readonly errorCenter: ErrorCenter
  ) {}

  setCredential(reference: string, credential: string): Promise<CredentialResult<void>> {
    return this.observe('set', () => this.delegate.setCredential(reference, credential))
  }

  getCredential(reference: string): Promise<CredentialResult<string | undefined>> {
    return this.observe('get', () => this.delegate.getCredential(reference))
  }

  deleteCredential(reference: string): Promise<CredentialResult<boolean>> {
    return this.observe('delete', () => this.delegate.deleteCredential(reference))
  }

  hasCredential(reference: string): Promise<CredentialResult<boolean>> {
    return this.observe('has', () => this.delegate.hasCredential(reference))
  }

  private async observe<T>(operation: 'set' | 'get' | 'delete' | 'has', action: () => Promise<CredentialResult<T>>): Promise<CredentialResult<T>> {
    this.logger.debug(`Credential ${operation} 开始`, { source: 'credential-store', metadata: { operation } })
    try {
      const result = await action()
      if (result.ok) {
        this.logger.info(`Credential ${operation} 完成`, { source: 'credential-store', metadata: { operation } })
      } else {
        this.logger.warn(`Credential ${operation} 失败`, { source: 'credential-store', metadata: { operation, code: result.error.code } })
        this.errorCenter.capture(result.error, { source: 'credential-store', category: 'authentication', metadata: { operation } })
      }
      return result
    } catch (cause) {
      this.logger.error(`Credential ${operation} 异常`, { source: 'credential-store', metadata: { operation } })
      this.errorCenter.capture(cause, { source: 'credential-store', category: 'authentication', metadata: { operation } })
      throw cause
    }
  }
}
