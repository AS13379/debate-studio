export type ProtocolType =
  | 'openai-chat'
  | 'openai-responses'
  | 'gemini-native'
  | 'dashscope-native'
  | 'mimo-native'

export interface ProviderConnection {
  id: string
  providerId: string
  displayName: string
  protocolType: ProtocolType
  baseUrl: string
  credentialRef: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelCapabilities {
  textInput: boolean
  imageInput: boolean
  documentInput: boolean
  audioInput: boolean
  videoInput: boolean
  streaming: boolean
  reasoning: boolean
  toolCalling: boolean
  webSearch: boolean
  structuredOutput: boolean
}

export interface ModelProfile {
  id: string
  connectionId: string
  modelId: string
  displayName: string
  alias?: string
  capabilities: ModelCapabilities
  contextWindow?: number
  maxOutputTokens?: number
  createdAt: string
  updatedAt: string
}

export interface ProviderPreset {
  providerId: string
  displayName: string
  defaultBaseUrl: string
  supportedProtocols: readonly ProtocolType[]
  capabilityHints: Partial<ModelCapabilities>
}

