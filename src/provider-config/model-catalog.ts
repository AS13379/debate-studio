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
    model('kimi-k3', 'Kimi K3', 1_000_000, 1_048_576, { reasoning: true, imageInput: true, videoInput: true, toolCalling: true, structuredOutput: true }),
    model('kimi-k2.6', 'Kimi K2.6', 262_144, 262_144, { reasoning: true, imageInput: true, videoInput: true, toolCalling: true, structuredOutput: true }),
    model('kimi-k2.5', 'Kimi K2.5', 262_144, 262_144, { reasoning: true, imageInput: true, toolCalling: true, structuredOutput: true }),
    model('moonshot-v1-8k', 'Moonshot V1 8K', 8_192),
    model('moonshot-v1-32k', 'Moonshot V1 32K', 32_768),
    model('moonshot-v1-128k', 'Moonshot V1 128K', 131_072),
    model('moonshot-v1-8k-vision-preview', 'Moonshot V1 Vision 8K', 8_192, undefined, { imageInput: true }),
    model('moonshot-v1-32k-vision-preview', 'Moonshot V1 Vision 32K', 32_768, undefined, { imageInput: true }),
    model('moonshot-v1-128k-vision-preview', 'Moonshot V1 Vision 128K', 131_072, undefined, { imageInput: true })
  ],
  deepseek: [
    model('deepseek-v4-flash', 'DeepSeek V4 Flash', 1_000_000, 393_216, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('deepseek-v4-pro', 'DeepSeek V4 Pro', 1_000_000, 393_216, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('deepseek-chat', 'DeepSeek Chat（兼容别名，即将停用）', 1_000_000, 393_216, { toolCalling: true, structuredOutput: true }),
    model('deepseek-reasoner', 'DeepSeek Reasoner（兼容别名，即将停用）', 1_000_000, 393_216, { reasoning: true, toolCalling: true, structuredOutput: true })
  ],
  zhipu: [
    model('glm-5.1', 'GLM-5.1', 200_000, 128_000, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('glm-4.5', 'GLM-4.5', 131_072, 98_304, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('glm-4.5-air', 'GLM-4.5 Air', 131_072, 98_304, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('glm-4v-plus-0111', 'GLM-4V Plus', 16_384, undefined, { imageInput: true })
  ],
  'xiaomi-mimo': [
    model('mimo-v2.5-pro', 'MiMo V2.5 Pro', 1_000_000, 131_072, { reasoning: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('mimo-v2.5', 'MiMo V2.5', 1_000_000, 131_072, { imageInput: true, documentInput: true, audioInput: true, videoInput: true, reasoning: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('mimo-v2-pro', 'MiMo V2 Pro', 1_000_000, 131_072, { reasoning: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('mimo-v2-omni', 'MiMo V2 Omni', 262_144, 131_072, { imageInput: true, documentInput: true, audioInput: true, videoInput: true, reasoning: true, toolCalling: true, webSearch: true }),
    model('mimo-v2-flash', 'MiMo V2 Flash', undefined, undefined, { reasoning: true, toolCalling: true, structuredOutput: true })
  ],
  'alibaba-dashscope': [
    model('qwen3.7-plus', 'Qwen 3.7 Plus', 1_000_000, 65_536, { imageInput: true, videoInput: true, reasoning: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('qwen3-max', 'Qwen 3 Max', 262_144, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('qwen-plus', 'Qwen Plus', 1_000_000, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('qwen-flash', 'Qwen Flash', 1_000_000, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('qwen-vl-max', 'Qwen VL Max', undefined, undefined, { imageInput: true, videoInput: true }),
    // Model Studio is a multi-vendor gateway. Keep major third-party model
    // families in the offline catalog so a sparse /models response does not
    // silently discard their runtime capabilities.
    model('glm-5.2', 'GLM-5.2（百炼）', 1_000_000, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('ZHIPU/GLM-5.2', 'GLM-5.2（智谱 / 百炼工作空间）', 1_000_000, undefined, { reasoning: true, toolCalling: true, structuredOutput: true }),
    model('deepseek-r1-distill-qwen-32b', 'DeepSeek R1 Distill Qwen 32B（百炼）', undefined, undefined, { reasoning: true }),
    model('xiaomi/mimo-v2.5-pro', 'MiMo V2.5 Pro（百炼）', 1_000_000, 131_072, { reasoning: true, toolCalling: true, webSearch: true, structuredOutput: true })
  ],
  gemini: [
    model('gemini-3.5-flash', 'Gemini 3.5 Flash', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('gemini-3.5-pro-preview', 'Gemini 3.5 Pro Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('gemini-3.5-flash-preview', 'Gemini 3.5 Flash Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('gemini-3-pro-preview', 'Gemini 3 Pro Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true, webSearch: true, structuredOutput: true }),
    model('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 1_048_576, 65_536, { reasoning: true, imageInput: true, documentInput: true, audioInput: true, videoInput: true, toolCalling: true, webSearch: true, structuredOutput: true })
  ]
}

export function getFallbackProviderModels(providerId: string): ProviderModelCatalogEntry[] {
  return (MODEL_CATALOG[providerId] ?? []).map((entry) => ({
    ...entry,
    capabilities: entry.capabilities ? { ...entry.capabilities } : undefined
  }))
}

export function getProviderModelPreset(providerId: string, modelId: string): ProviderModelCatalogEntry | undefined {
  const normalized = modelId.trim().toLowerCase()
  const candidates = MODEL_CATALOG[providerId] ?? []
  const exact = candidates.find((entry) => entry.id.toLowerCase() === normalized)
  const datedAlias = candidates
    .filter((entry) => normalized.startsWith(`${entry.id.toLowerCase()}-`))
    .sort((left, right) => right.id.length - left.id.length)[0]
  const found = exact ?? datedAlias
  return found ? { ...found, capabilities: found.capabilities ? { ...found.capabilities } : undefined } : undefined
}

function model(
  id: string,
  displayName: string,
  contextWindow?: number,
  maxOutputTokens?: number,
  capabilities?: ProviderModelCatalogEntry['capabilities']
): ProviderModelCatalogEntry {
  return {
    id,
    displayName,
    contextWindow,
    maxOutputTokens,
    capabilities: { textInput: true, streaming: true, ...capabilities }
  }
}
