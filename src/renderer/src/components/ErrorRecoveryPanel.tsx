import type { DebateTurnFailureDto, RunErrorDto } from '../../../shared/ipc-contract'

export type ReadableFailure = DebateTurnFailureDto | RunErrorDto

export interface ErrorRecoveryPanelProps {
  failure: ReadableFailure
  onRetry?(): void
  onChangeModel?(): void
  onOpenConnection?(): void
}

export function ErrorRecoveryPanel({ failure, onRetry, onChangeModel, onOpenConnection }: ErrorRecoveryPanelProps) {
  const legacyOutputLimit = failure.code === 'EMPTY_RESPONSE'
    && failure.technicalDetails?.includes('finish_reason=length')
    && failure.technicalDetails.includes('reasoning_content=present')
  const effectivelyRetryable = failure.retryable || legacyOutputLimit
  const titleZh = legacyOutputLimit ? '模型输出上限不足' : failure.titleZh
  const descriptionZh = legacyOutputLimit
    ? '这是旧版本保存的失败记录：模型的思考内容占满了当时的输出上限，尚未生成完整正文。请重试以创建使用新配置的 Turn。'
    : failure.descriptionZh
  const suggestedActionZh = legacyOutputLimit
    ? '点击重试；新 Turn 会使用 Kimi 思考模型的安全输出下限，原失败记录仍会保留。'
    : failure.suggestedActionZh
  const retryGuidance = effectivelyRetryable
    ? '建议直接重试'
    : '建议先检查配置，也可以强制重试'

  return (
    <div className="failure-panel" role="alert">
      <div className="failure-heading">
        <div>
          <strong>{titleZh}</strong>
          <span>{retryGuidance}</span>
        </div>
        <span className={`retry-badge ${effectivelyRetryable ? 'retryable' : 'blocked'}`}>
          {effectivelyRetryable ? '可重试' : '可强制重试'}
        </span>
      </div>
      <p>{descriptionZh}</p>
      {suggestedActionZh && <p className="suggestion"><strong>建议：</strong>{suggestedActionZh}</p>}
      <div className="failure-actions">
        {onRetry && <button className="button secondary" onClick={onRetry}>{effectivelyRetryable ? '重试' : '仍然重试'}</button>}
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
