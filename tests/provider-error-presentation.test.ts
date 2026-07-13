import { describe, expect, it } from 'vitest'

import { presentProviderFailure } from '../src/providers'

describe('Provider error presentation', () => {
  it.each([
    [{ statusCode: 401, message: 'invalid api key' }, 'API_KEY_INVALID', 'API Key 无效', false],
    [{ statusCode: 429, message: 'too many requests' }, 'RATE_LIMITED', '请求频率受限', true],
    [
      { statusCode: 429, providerCode: 'insufficient_quota', message: 'insufficient quota' },
      'QUOTA_EXCEEDED',
      '账户余额或额度不足',
      false
    ],
    [
      { statusCode: 404, providerCode: 'model_not_found', message: 'model does not exist' },
      'MODEL_NOT_FOUND',
      '模型不存在或无权限',
      false
    ],
    [{ transportCode: 'TIMEOUT' as const, message: 'request timed out' }, 'TIMEOUT', '请求超时', true]
  ])('maps provider failures to actionable Chinese UI copy', (input, code, titleZh, retryable) => {
    expect(presentProviderFailure(input)).toMatchObject({
      failureCode: code,
      titleZh,
      retryable,
      suggestedActionZh: expect.any(String),
      technicalDetails: expect.any(String)
    })
  })

  it('distinguishes common configuration, stream and capability failures', () => {
    expect(presentProviderFailure({ message: 'TypeError: Failed to parse URL' }).failureCode).toBe('BASE_URL_INVALID')
    expect(presentProviderFailure({ transportCode: 'TRANSPORT_FAILED', message: 'fetch failed' }).failureCode).toBe('NETWORK_ERROR')
    expect(presentProviderFailure({ transportCode: 'STREAM_INTERRUPTED', message: 'closed' })).toMatchObject({
      failureCode: 'STREAM_INTERRUPTED',
      titleZh: 'SSE 流中断'
    })
    expect(presentProviderFailure({ providerCode: 'context_length_exceeded' }).failureCode).toBe('CONTEXT_TOO_LONG')
    expect(presentProviderFailure({ message: 'image input is unsupported' }).failureCode).toBe('IMAGE_UNSUPPORTED')
  })

  it('redacts credentials from technical details', () => {
    const credential = 'sk-super-secret-provider-value-123456'
    const result = presentProviderFailure({
      statusCode: 401,
      message: `Authorization: Bearer ${credential}`
    })

    expect(result.technicalDetails).not.toContain(credential)
    expect(result.technicalDetails).toContain('[REDACTED]')
  })
})
