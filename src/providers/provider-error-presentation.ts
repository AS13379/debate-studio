import { redactSensitiveText } from '../security'
import type { HttpTransportErrorCode } from './http-transport'

export type ProviderFailureCode =
  | 'API_KEY_MISSING'
  | 'API_KEY_INVALID'
  | 'CREDENTIAL_STORE_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'BASE_URL_INVALID'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'CONTEXT_TOO_LONG'
  | 'IMAGE_UNSUPPORTED'
  | 'REQUEST_CANCELLED'
  | 'UNKNOWN_PROVIDER_ERROR'

export interface ProviderFailurePresentation {
  failureCode: ProviderFailureCode
  titleZh: string
  descriptionZh: string
  retryable: boolean
  suggestedActionZh: string
  technicalDetails: string
}

export interface ProviderFailureInput {
  statusCode?: number
  providerCode?: string
  message?: string
  transportCode?: HttpTransportErrorCode
  titleZh?: string
  descriptionZh?: string
  retryable?: boolean
}

export function presentProviderFailure(input: ProviderFailureInput): ProviderFailurePresentation {
  const source = `${input.providerCode ?? ''} ${input.message ?? ''}`.toLowerCase()
  const technicalDetails = technicalDetailsFor(input)

  if (input.transportCode === 'CREDENTIAL_MISSING') {
    return presentation(
      'API_KEY_MISSING',
      input.titleZh ?? 'API Key 未配置',
      input.descriptionZh ?? '该平台连接尚未保存可用的 API Key。',
      false,
      '打开“模型与平台”，为连接保存 API Key 后重新测试。',
      technicalDetails
    )
  }
  if (input.transportCode === 'CREDENTIAL_STORE_FAILED') {
    return presentation(
      'CREDENTIAL_STORE_FAILED',
      input.titleZh ?? '系统加密凭据读取失败',
      input.descriptionZh ?? '应用无法从系统加密存储读取该连接的凭据。',
      input.retryable ?? true,
      '确认系统加密服务可用且当前用户会话未锁定，然后重试。',
      technicalDetails
    )
  }
  if (input.transportCode === 'CANCELLED') {
    return presentation(
      'REQUEST_CANCELLED',
      '请求已取消',
      '当前流式请求已停止，不会继续产生模型输出。',
      true,
      '需要继续时可重试当前失败 Turn。',
      technicalDetails
    )
  }
  if (input.transportCode === 'TIMEOUT') {
    return presentation(
      'TIMEOUT',
      '请求超时',
      '服务商未在规定时间内返回结果。',
      true,
      '检查网络和 Base URL，稍后重试或降低最大输出长度。',
      technicalDetails
    )
  }
  if (input.transportCode === 'STREAM_INTERRUPTED') {
    return presentation(
      'STREAM_INTERRUPTED',
      'SSE 流中断',
      '服务商在完成标记到达前关闭了流式连接，已收到的部分文本已保留。',
      true,
      '重试当前 Turn；若持续发生，请检查网络或服务商状态。',
      technicalDetails
    )
  }
  if (/reasoning_content.{0,80}(must be passed back|required)|thinking mode.{0,80}reasoning_content/i.test(source)) {
    return presentation(
      'UNKNOWN_PROVIDER_ERROR',
      '推理上下文衔接失败',
      '服务商没有收到继续当前工具调用所需的临时推理上下文。',
      true,
      '请重试当前阶段；应用只在本轮请求链内短暂回传该上下文，不会写入本地记录。',
      technicalDetails
    )
  }
  if (/context[_ -]?length|maximum context|max(?:imum)? tokens|上下文.{0,4}(过长|超限)/i.test(source)) {
    return presentation(
      'CONTEXT_TOO_LONG',
      '上下文过长',
      '当前请求超出了所选模型允许的上下文或 Token 限制。',
      false,
      '选择上下文更长的模型，或缩短辩题背景和提示词。',
      technicalDetails
    )
  }
  if (/(image|vision|图片|图像).{0,24}(unsupported|not support|不支持|不可用)/i.test(source)) {
    return presentation(
      'IMAGE_UNSUPPORTED',
      '模型不支持图片输入',
      '当前模型或兼容接口不接受图片输入。',
      false,
      '改用支持图片能力的 ModelProfile，或移除图片内容。',
      technicalDetails
    )
  }
  if (/insufficient[_ -]?(quota|balance|credit)|quota[_ -]?exceeded|billing|余额不足|额度不足|欠费/i.test(source)) {
    return presentation(
      'QUOTA_EXCEEDED',
      '账户余额或额度不足',
      '服务商拒绝了请求，因为当前账户没有足够余额、额度或可用配额。',
      false,
      '前往服务商控制台检查余额、账单和项目额度，处理后再重试。',
      technicalDetails
    )
  }
  if (/(model).{0,24}(not found|does not exist|unavailable|permission|access denied)|supported (?:api )?model names? are .{0,160}but you passed|模型.{0,16}(不存在|无权限|不可用)/i.test(source)) {
    return presentation(
      'MODEL_NOT_FOUND',
      '模型不存在或无权限',
      '服务商找不到该 Model ID，或当前 API Key 没有调用权限。',
      false,
      '核对 Model ID，并确认该账号或项目已开通模型权限。',
      technicalDetails
    )
  }
  if (input.statusCode === 401 || input.statusCode === 403) {
    return presentation(
      'API_KEY_INVALID',
      'API Key 无效',
      '服务商拒绝认证，API Key 可能错误、过期或不属于当前项目。',
      false,
      '在“模型与平台”中替换 API Key，然后重新测试连接。',
      technicalDetails
    )
  }
  if (input.statusCode === 429) {
    return presentation(
      'RATE_LIMITED',
      '请求频率受限',
      '当前请求触发了服务商的速率或并发限制。',
      true,
      '等待片刻后重试，或在服务商控制台检查速率限制。',
      technicalDetails
    )
  }
  if (input.statusCode === 404) {
    return presentation(
      'MODEL_NOT_FOUND',
      '模型或接口不存在',
      '服务商没有找到请求的模型或 Chat Completions 接口。',
      false,
      '核对 Model ID 与 Base URL，确认地址不重复包含 chat/completions。',
      technicalDetails
    )
  }
  if (/invalid url|failed to parse url|unsupported protocol|enotfound|getaddrinfo/i.test(source)) {
    return presentation(
      'BASE_URL_INVALID',
      'Base URL 错误',
      '当前 Base URL 格式、域名或协议无法用于连接服务商。',
      false,
      '使用官方预设恢复地址，或检查自定义 Base URL。',
      technicalDetails
    )
  }
  if (input.transportCode === 'TRANSPORT_FAILED') {
    return presentation(
      'NETWORK_ERROR',
      '网络连接失败',
      '应用无法连接到服务商，未收到有效 HTTP 响应。',
      true,
      '检查网络、代理、防火墙和 Base URL 后重试。',
      technicalDetails
    )
  }
  if (input.statusCode !== undefined && input.statusCode >= 500) {
    return presentation(
      'UNKNOWN_PROVIDER_ERROR',
      '服务商暂时不可用',
      '服务商返回了服务器错误，当前请求未能完成。',
      true,
      '稍后重试；若持续发生，请查看服务商状态页。',
      technicalDetails
    )
  }
  return presentation(
    'UNKNOWN_PROVIDER_ERROR',
    input.titleZh ?? '服务商返回未知错误',
    input.descriptionZh ?? '服务商未能完成请求，但返回信息不足以确定具体原因。',
    input.retryable ?? true,
    '展开技术详情核对错误；也可测试连接或更换模型后重试。',
    technicalDetails
  )
}

function presentation(
  failureCode: ProviderFailureCode,
  titleZh: string,
  descriptionZh: string,
  retryable: boolean,
  suggestedActionZh: string,
  technicalDetails: string
): ProviderFailurePresentation {
  return { failureCode, titleZh, descriptionZh, retryable, suggestedActionZh, technicalDetails }
}

function technicalDetailsFor(input: ProviderFailureInput): string {
  const parts = [
    input.statusCode === undefined ? undefined : `HTTP ${input.statusCode}`,
    input.providerCode ? `providerCode=${input.providerCode}` : undefined,
    input.transportCode ? `transportCode=${input.transportCode}` : undefined,
    input.message
  ].filter((part): part is string => Boolean(part))
  return redactSensitiveText(parts.join(' | ') || '服务商未返回更多技术信息。')
}
