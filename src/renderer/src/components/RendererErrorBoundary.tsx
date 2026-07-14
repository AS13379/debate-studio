import { Component, type ErrorInfo, type ReactNode } from 'react'

interface RendererErrorBoundaryState { failed: boolean }

export class RendererErrorBoundary extends Component<{ children: ReactNode }, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void window.debateStudio.reportRendererError({
      title: '界面显示异常',
      userMessage: '当前页面未能正常显示，可重新加载后再试。',
      technicalMessage: `${error.name}: ${error.message}`,
      source: 'react-error-boundary'
    }).catch(() => undefined)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="renderer-failure">
        <div className="panel">
          <span className="eyebrow">界面异常</span>
          <h1>当前页面未能正常显示</h1>
          <p>错误摘要已记录到“诊断与日志”，不包含页面内容或凭据。</p>
          <button className="button primary" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </main>
    )
  }
}
