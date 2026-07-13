import type { ProtocolType } from '../provider-config'
import type { ModelAdapter } from './model-adapter'

export type AdapterRegistryErrorCode = 'DUPLICATE_PROTOCOL' | 'ADAPTER_NOT_FOUND'

export interface AdapterRegistryError {
  code: AdapterRegistryErrorCode
  protocolType: ProtocolType
  message: string
}

export type AdapterRegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdapterRegistryError }

export class AdapterRegistry {
  private readonly adapters = new Map<ProtocolType, ModelAdapter>()

  register(protocolType: ProtocolType, adapter: ModelAdapter): AdapterRegistryResult<void> {
    if (this.adapters.has(protocolType)) {
      return {
        ok: false,
        error: {
          code: 'DUPLICATE_PROTOCOL',
          protocolType,
          message: `An adapter is already registered for protocol: ${protocolType}.`
        }
      }
    }

    this.adapters.set(protocolType, adapter)
    return { ok: true, value: undefined }
  }

  getAdapter(protocolType: ProtocolType): AdapterRegistryResult<ModelAdapter> {
    const adapter = this.adapters.get(protocolType)
    return adapter
      ? { ok: true, value: adapter }
      : {
          ok: false,
          error: {
            code: 'ADAPTER_NOT_FOUND',
            protocolType,
            message: `No adapter is registered for protocol: ${protocolType}.`
          }
        }
  }

  isAvailable(protocolType: ProtocolType): boolean {
    return this.adapters.has(protocolType)
  }

  getAvailableProtocolTypes(): readonly ProtocolType[] {
    return Object.freeze([...this.adapters.keys()])
  }
}
