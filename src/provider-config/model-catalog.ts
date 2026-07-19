import type { ProviderModelCatalogEntry } from './types'

// Offline fallback only. The UI prefers the provider's authenticated /models response.
const MODEL_CATALOG: Readonly<Record<string, readonly ProviderModelCatalogEntry[]>> = {
  openai: [
    model('gpt-5.1', 'GPT-5.1', 400_000, 128_000, { reasoning: true, imageInput: true, toolCalling: true, structuredOutput: true }),
    model('gpt-5-mini', 'GPT-5 mini', 400_000, 128_000, { reasoning: true, imageInput: true, toolCalling: true, structuredOutput: true }),
    model('gpt-4.1', 'GPT-4.1', 1_047_576, 32_768, { imageInput: true, toolCalling: true, structuredOutput: true }),
    model('gpt-4.1-mini', 'GPT-4.1 mini', 1_047_576, 32_768, { imageInput: true, toolCalling: true, structuredOutput: true })
  ],
  moonshot: [
    model('kimi-k3', 'Kimi K3', 1_000_000, 1_048_576, { reasoning: true, toolCalling: true }),
    model('kimi-k2.6', 'Kimi K2.6', 262_144, 262_144, { reasoning: true, imageInput: true, videoInput: true, toolCalling: true }),
    model('kimi-k2.5', 'Kimi K2.5', 262_144, 262_144, { reasoning: true, imageInput: true, toolCalling: true }),
    model('moonshot-v1-8k', 'Moonshot V1 8K', 8_192),
    model('moonshot-v1-32k', 'Moonshot V1 32K', 32_768),
    model('moonshot-v1-128k', 'Moonshot V1 128K', 131_072),
    model('moonshot-v1-8k-vision-preview', 'Moonshot V1 Vision 8K', 8_192, undefined, { imageInput: true }),
    model('moonshot-v1-32k-vision-preview', 'Moonshot V1 Vision 32K', 32_768, undefined, { imageInput: true }),
    model('moonshot-v1-128k-vision-preview', 'Moonshot V1 Vision 128K', 131_072, undefined, { imageInput: true })
  ],
  deepseek: [
    model('deepseek-v4-flash', 'DeepSeek V4 Flash', undefined, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('deepseek-v4-pro', 'DeepSeek V4 Pro', undefined, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('deepseek-chat', 'DeepSeek Chat', 131_072, 8_192, { toolCalling: true, structuredOutput: true }),
    model('deepseek-reasoner', 'DeepSeek Reasoner', 131_072, 65_536, { reasoning: true })
  ],
  zhipu: [
    model('glm-5.1', 'GLM-5.1', undefined, undefined, { reasoning: true, toolCalling: true }),
    model('glm-4.5', 'GLM-4.5', 131_072, undefined, { reasoning: true, toolCalling: true }),
    model('glm-4.5-air', 'GLM-4.5 Air', 131_072, undefined, { reasoning: true, toolCalling: true }),
    model('glm-4v-plus-0111', 'GLM-4V Plus', 16_384, undefined, { imageInput: true })
  ],
  'xiaomi-mimo': [
    model('mimo-v2-flash', 'MiMo V2 Flash', undefined, undefined, { reasoning: true, toolCalling: true }),
    model('mimo-v2-pro', 'MiMo V2 Pro', undefined, undefined, { reasoning: true, toolCalling: true })
  ],
  'alibaba-dashscope': [
    model('qwen3.7-plus', 'Qwen 3.7 Plus', 1_000_000, undefined, { reasoning: true, toolCalling: true }),
    model('qwen3-max', 'Qwen 3 Max', 262_144, undefined, { reasoning: true, toolCalling: true }),
    model('qwen-plus', 'Qwen Plus', 1_000_000, undefined, { reasoning: true, toolCalling: true }),
    model('qwen-flash', 'Qwen Flash', 1_000_000, undefined, { reasoning: true, toolCalling: true }),
    model('qwen-vl-max', 'Qwen VL Max', undefined, undefined, { imageInput: true })
  ],
  gemini: [
    model('gemini-3.5-pro-preview', 'Gemini 3.5 Pro Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true }),
    model('gemini-3.5-flash-preview', 'Gemini 3.5 Flash Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true }),
    model('gemini-3-pro-preview', 'Gemini 3 Pro Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true }),
    model('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true })
  ]
}

export function getFallbackProviderModels(providerId: string): ProviderModelCatalogEntry[] {
  return (MODEL_CATALOG[providerId] ?? []).map((entry) => ({
    ...entry,
    capabilities: entry.capabilities ? { ...entry.capabilities } : undefined
  }))
}

function model(
  id: string,
  displayName: string,
  contextWindow?: number,
  maxOutputTokens?: number,
  capabilities?: ProviderModelCatalogEntry['capabilities']
): ProviderModelCatalogEntry {
  return { id, displayName, contextWindow, maxOutputTokens, capabilities }
}
