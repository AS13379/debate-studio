import type { DebateTurnFailureDto, RunErrorDto } from '../../../shared/ipc-contract'

export type ReadableFailure = DebateTurnFailureDto | RunErrorDto

export interface ErrorRecoveryPanelProps {
  failure: ReadableFailure
  onRetry?(): void
  onChangeModel?(): void
  onOpenConnection?(): void
}

export function ErrorRecoveryPanel({ failure, onRetry, onChangeModel, onOpenConnection }: ErrorRecoveryPanelProps) {
  const retryGuidance = failure.retryable
    ? '建议直接重试'
    : '建议先检查配置，也可以强制重试'

  return (
    <div className="failure-panel" role="alert">
      <div className="failure-heading">
        <div>
          <strong>{failure.titleZh}</strong>
          <span>{retryGuidance}</span>
        </div>
        <span className={`retry-badge ${failure.retryable ? 'retryable' : 'blocked'}`}>
          {failure.retryable ? '可重试' : '可强制重试'}
        </span>
      </div>
      <p>{failure.descriptionZh}</p>
      {failure.suggestedActionZh && <p className="suggestion"><strong>建议：</strong>{failure.suggestedActionZh}</p>}
      <div className="failure-actions">
        {onRetry && <button className="button secondary" onClick={onRetry}>{failure.retryable ? '重试' : '仍然重试'}</button>}
        {onChangeModel && <button className="button secondary" onClick={onChangeModel}>更换模型</button>}
        {onOpenConnection && <button className="button ghost" onClick={onOpenConnection}>打开连接设置</button>}
      </div>
      <details>
        <summary>查看详情</summary>
        <pre>错误代码：{failure.code}{failure.technicalDetails ? `\n${failure.technicalDetails}` : ''}</pre>
      </details>
    </div>
  )
}
