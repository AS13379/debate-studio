import type { DebateHistoryDetailDto } from '../../../shared/ipc-contract'

export function DeleteDebateConfirmation({ detail, busy, onCancel, onConfirm }: {
  detail: DebateHistoryDetailDto
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  return <div className="modal-backdrop" role="presentation"><section className="delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="delete-confirmation-title">
    <p className="eyebrow">软删除确认</p>
    <h2 id="delete-confirmation-title">确定删除“{detail.displayTitle}”吗？</h2>
    <p>该记录会从当前列表移入回收站。以下关联内容将一起从日常视图隐藏，但不会被物理删除：</p>
    <ul>
      <li>辩论记录：{detail.deleteImpact.debateRecords}</li>
      <li>运行事件：{detail.deleteImpact.eventRecords}</li>
      <li>研究索引：{detail.deleteImpact.researchIndexes}</li>
      <li>证据关联：{detail.deleteImpact.evidenceLinks}</li>
      <li>Turn：{detail.deleteImpact.turnRecords}</li>
    </ul>
    <div className="notice">Provider、ModelProfile 和系统加密凭据均不会受到影响，并可随时恢复此辩论。</div>
    <div className="form-actions">
      <button className="button secondary" disabled={busy} onClick={onCancel}>取消</button>
      <button className="button danger" disabled={busy} onClick={onConfirm}>确认软删除</button>
    </div>
  </section></div>
}
