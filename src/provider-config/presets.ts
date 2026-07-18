import type { ProviderPreset } from './types'

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    platformUrl: 'https://platform.openai.com/api-keys',
    documentationUrl: 'https://developers.openai.com/api/docs/models',
    pricingUrl: 'https://openai.com/api/pricing/',
    supportedProtocols: ['openai-responses', 'openai-chat'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, toolCalling: true, structuredOutput: true }
  },
  {
    providerId: 'moonshot',
    displayName: 'Moonshot / Kimi',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    platformUrl: 'https://platform.kimi.com/',
    documentationUrl: 'https://platform.kimi.com/docs/api/quickstart',
    pricingUrl: 'https://platform.kimi.com/docs/pricing/chat',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'zhipu',
    displayName: '智谱 BigModel',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    platformUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    pricingUrl: 'https://bigmodel.cn/pricing',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    platformUrl: 'https://platform.deepseek.com/api_keys',
    documentationUrl: 'https://api-docs.deepseek.com/',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true, structuredOutput: true }
  },
  {
    providerId: 'xiaomi-mimo',
    displayName: '小米 MiMo',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    platformUrl: 'https://platform.xiaomimimo.com/',
    documentationUrl: 'https://mimo.mi.com/docs/zh-CN/',
    pricingUrl: 'https://mimo.mi.com/docs/en-US/news/previous-news/billing',
    supportedProtocols: ['openai-chat'],
    capabilityHints: { textInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'alibaba-dashscope',
    displayName: '阿里云百炼 / DashScope',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    platformUrl: 'https://bailian.console.aliyun.com/',
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/',
    pricingUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    supportedProtocols: ['openai-chat', 'dashscope-native'],
    capabilityHints: { textInput: true, imageInput: true, streaming: true, reasoning: true, toolCalling: true }
  },
  {
    providerId: 'gemini',
    displayName: 'Gemini OpenAI Compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    platformUrl: 'https://aistudio.google.com/app/apikey',
    documentationUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
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
