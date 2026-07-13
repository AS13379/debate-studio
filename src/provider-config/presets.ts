import type { ProviderPreset } from './types'

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportedProtocols: ['openai-responses', 'openai-chat'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, toolCalling: true, structuredOutput: true }
  },
  {
    providerId: 'moonshot',
    displayName: 'Moonshot / Kimi',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'zhipu',
    displayName: '智谱 BigModel',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true, structuredOutput: true }
  },
  {
    providerId: 'xiaomi-mimo',
    displayName: '小米 MiMo',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'alibaba-dashscope',
    displayName: '阿里云百炼 / DashScope',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    supportedProtocols: ['openai-chat', 'dashscope-native'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'gemini',
    displayName: 'Gemini OpenAI Compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportedProtocols: ['openai-chat'],
    capabilityHints: {
      textInput: true,
      imageInput: true,
      documentInput: true,
      audioInput: true,
      videoInput: true,
      streaming: true,
      reasoning: true,
      toolCalling: true
    }
  }
]

export function getProviderPresets(): ProviderPreset[] {
  return PROVIDER_PRESETS.map((preset) => ({
    ...preset,
    supportedProtocols: [...preset.supportedProtocols],
    capabilityHints: { ...preset.capabilityHints }
  }))
}

export function getProviderPreset(providerId: string): ProviderPreset | undefined {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.providerId === providerId)
  return preset
    ? { ...preset, supportedProtocols: [...preset.supportedProtocols], capabilityHints: { ...preset.capabilityHints } }
    : undefined
}
