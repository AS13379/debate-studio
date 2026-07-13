import type { DebateTurnFailureDto, RunErrorDto } from '../../../shared/ipc-contract'

export type ReadableFailure = DebateTurnFailureDto | RunErrorDto

export interface ErrorRecoveryPanelProps {
  failure: ReadableFailure
  onRetry?(): void
  onChangeModel?(): void
  onOpenConnection?(): void
}

export function ErrorRecoveryPanel({ failure, onRetry, onChangeModel, onOpenConnection }: ErrorRecoveryPanelProps) {
  return (
    <div className="failure-panel" role="alert">
      <div className="failure-heading">
        <div>
          <strong>{failure.titleZh}</strong>
          <span>{failure.retryable ? '可以重试' : '需要先修正配置'}</span>
        </div>
        <span className={`retry-badge ${failure.retryable ? 'retryable' : 'blocked'}`}>
          {failure.retryable ? '可重试' : '不可直接重试'}
        </span>
      </div>
      <p>{failure.descriptionZh}</p>
      {failure.suggestedActionZh && <p className="suggestion"><strong>建议：</strong>{failure.suggestedActionZh}</p>}
      <div className="failure-actions">
        {onRetry && failure.retryable && <button className="button secondary" onClick={onRetry}>重试</button>}
        {onChangeModel && <button className="button secondary" onClick={onChangeModel}>更换模型</button>}
        {onOpenConnection && <button className="button ghost" onClick={onOpenConnection}>打开连接设置</button>}
      </div>
      {failure.technicalDetails && (
        <details>
          <summary>技术详情</summary>
          <pre>{failure.technicalDetails}</pre>
        </details>
      )}
    </div>
  )
}
