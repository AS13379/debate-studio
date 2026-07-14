import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ErrorRecoveryPanel } from '../src/renderer/src/components/ErrorRecoveryPanel'
import { ConnectionTestStatus } from '../src/renderer/src/pages/ProviderManagementPage'
import { isDebateStartBlocked } from '../src/renderer/src/pages/LiveDebatePage'

describe('provider management UI states', () => {
  it('renders successful connection latency and a short response', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestStatus result={{
        success: true,
        latencyMs: 37,
        providerStatus: 200,
        responsePreview: 'OK'
      }} />
    )

    expect(html).toContain('凭据测试成功')
    expect(html).toContain('37 ms')
    expect(html).toContain('OK')
  })

  it('renders failure reason, retry state, suggestion and redacted technical details', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestStatus result={{
        success: false,
        latencyMs: 41,
        providerStatus: 401,
        error: {
          code: 'API_KEY_INVALID',
          titleZh: 'API Key 无效',
          descriptionZh: '服务商拒绝认证。',
          retryable: false,
          suggestedActionZh: '替换 API Key 后重新测试。',
          technicalDetails: 'HTTP 401 | [REDACTED]'
        }
      }} />
    )

    expect(html).toContain('凭据测试失败：API Key 无效')
    expect(html).toContain('需修正配置')
    expect(html).toContain('替换 API Key 后重新测试。')
    expect(html).toContain('[REDACTED]')
  })

  it('offers retry, model replacement and connection settings actions for a Turn failure', () => {
    const html = renderToStaticMarkup(
      <ErrorRecoveryPanel
        failure={{
          code: 'RATE_LIMITED',
          titleZh: '请求频率受限',
          descriptionZh: '当前请求触发了速率限制。',
          retryable: true,
          suggestedActionZh: '稍后重试。',
          technicalDetails: 'HTTP 429'
        }}
        onRetry={() => undefined}
        onChangeModel={() => undefined}
        onOpenConnection={() => undefined}
      />
    )

    expect(html).toContain('重试')
    expect(html).toContain('更换模型')
    expect(html).toContain('打开连接设置')
    expect(html).toContain('查看详情')
  })

  it('uses the application Validator result as the only start gate', () => {
    expect(isDebateStartBlocked()).toBe(true)
    expect(isDebateStartBlocked({
      validation: { valid: false, errors: [], warnings: [] }
    })).toBe(true)
    expect(isDebateStartBlocked({
      validation: { valid: true, errors: [], warnings: [] }
    })).toBe(false)
  })
})
