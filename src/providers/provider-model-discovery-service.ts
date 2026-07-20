import { getFallbackProviderModels, getProviderModelPreset, type ProviderConnection, type ProviderModelCatalogEntry } from '../provider-config'
import type { CredentialStore } from '../security'
import { AuthenticatedHttpTransport } from './authenticated-http-transport'
import type { HttpTransport } from './http-transport'

export interface AvailableProviderModel extends ProviderModelCatalogEntry {
  ownedBy?: string
}

export interface ProviderModelDiscoveryResult {
  models: AvailableProviderModel[]
  source: 'provider-api' | 'built-in'
  warningZh?: string
}

export class ProviderModelDiscoveryService {
  constructor(private readonly transport: HttpTransport, private readonly credentialStore: CredentialStore) {}

  async list(connection: ProviderConnection, signal = new AbortController().signal): Promise<ProviderModelDiscoveryResult> {
    const fallback = getFallbackProviderModels(connection.providerId)
    if (connection.protocolType === 'mock') return { models: fallback, source: 'built-in' }
    try {
      const authenticated = new AuthenticatedHttpTransport(
        this.transport,
        this.credentialStore,
        (connectionId) => connectionId === connection.id ? connection.credentialRef : undefined
      )
      const response = await authenticated.send({
        method: 'GET',
        url: `${connection.baseUrl.replace(/\/+$/, '')}/models`,
        headers: { accept: 'application/json' },
        signal,
        metadata: { providerConnectionId: connection.id }
      })
      if (response.status < 200 || response.status >= 300) throw new Error(`Provider returned HTTP ${response.status}.`)
      const models = parseModels(response.body, connection.providerId, fallback)
      if (!models.length) throw new Error('Provider returned an empty model list.')
      return { models, source: 'provider-api' }
    } catch {
      return {
        models: fallback,
        source: 'built-in',
        warningZh: fallback.length
          ? '暂时无法读取服务商实时模型列表，当前显示应用内置的离线名单；仍可选择“自定义”。'
          : '该自定义平台没有可用的离线模型名单，请使用“自定义 Model ID”。'
      }
    }
  }
}

function parseModels(body: unknown, providerId: string, fallback: ProviderModelCatalogEntry[]): AvailableProviderModel[] {
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray((body as { data?: unknown }).data)) return []
  const fallbackById = new Map(fallback.map((entry) => [entry.id, entry]))
  const discovered = (body as { data: unknown[] }).data.flatMap((item): AvailableProviderModel[] => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof (item as { id?: unknown }).id !== 'string') return []
    const record = item as Record<string, unknown>
    const id = String(record.id).trim()
    if (!id) return []
    const known = fallbackById.get(id) ?? getProviderModelPreset(providerId, id)
    return [{
      ...known,
      id,
      displayName: known?.displayName ?? id,
      ownedBy: typeof record.owned_by === 'string' ? record.owned_by : undefined,
      contextWindow: positiveInteger(record.context_length) ?? known?.contextWindow,
      capabilities: {
        ...known?.capabilities,
        imageInput: bool(record.supports_image_in) ?? known?.capabilities?.imageInput,
        videoInput: bool(record.supports_video_in) ?? known?.capabilities?.videoInput,
        reasoning: bool(record.supports_reasoning) ?? known?.capabilities?.reasoning
      }
    }]
  })
  return [...new Map(discovered.map((entry) => [entry.id, entry])).values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
