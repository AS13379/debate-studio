import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationUpdatePanel } from '../src/renderer/src/pages/ApplicationUpdatePage'

const base = {
  currentVersion: '0.4.5',
  supported: true,
  automaticCheckEnabled: true,
  automaticDownloadEnabled: false as const,
  messageZh: '发现新版本 0.5.0。',
  cacheSizeBytes: 0,
  verificationStatus: 'not-verified' as const,
  manualInstallAvailable: true
}

describe('ApplicationUpdatePanel', () => {
  it('shows available release metadata and explicit user-controlled download actions', () => {
    const html = renderToStaticMarkup(<ApplicationUpdatePanel
      state={{ ...base, status: 'available', availableVersion: '0.5.0', releaseName: 'Next', releaseNotes: '改进稳定性' }}
      onAction={vi.fn()}
      onAutomaticCheckChange={vi.fn()}
    />)
    expect(html).toContain('当前版本')
    expect(html).toContain('v0.4.5')
    expect(html).toContain('发现 v0.5.0')
    expect(html).toContain('改进稳定性')
    expect(html).toContain('下载更新')
    expect(html).toContain('稍后提醒')
    expect(html).toContain('自动下载：关闭')
  })

  it('shows download progress and cancellation without exposing a local file path', () => {
    const html = renderToStaticMarkup(<ApplicationUpdatePanel
      state={{ ...base, status: 'downloading', availableVersion: '0.5.0', progress: { percent: 52.5, transferredBytes: 5_505_024, totalBytes: 10_485_760, bytesPerSecond: 10 } }}
      onAction={vi.fn()}
      onAutomaticCheckChange={vi.fn()}
    />)
    expect(html).toContain('52.5%')
    expect(html).toContain('取消下载')
    expect(html).not.toContain('/Users/')
    expect(html).not.toContain('credentialRef')
  })
})
