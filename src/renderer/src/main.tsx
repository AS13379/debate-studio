import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'

import './styles.css'

window.addEventListener('error', (event) => {
  void window.debateStudio.reportRendererError({
    title: '界面脚本运行异常',
    userMessage: '页面执行时发生错误，部分功能可能暂时不可用。',
    technicalMessage: event.message || '未知 Renderer 错误',
    source: 'window-error'
  }).catch(() => undefined)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const technicalMessage = reason instanceof Error ? `${reason.name}: ${reason.message}` : '未处理的 Promise 异常'
  void window.debateStudio.reportRendererError({
    title: '界面异步操作失败',
    userMessage: '一项界面操作未能完成，可稍后重试。',
    technicalMessage,
    source: 'unhandled-rejection'
  }).catch(() => undefined)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RendererErrorBoundary><App /></RendererErrorBoundary>
  </StrictMode>
)
