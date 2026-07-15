import { randomUUID } from 'node:crypto'

import type { PersistenceContext } from '../persistence'
import type {
  ActivePromptVersion,
  PromptRuntime,
  PromptRuntimeUsageInput,
  PromptStudioResult,
  PromptTask,
  PromptTemplateRecord,
  PromptUsageRecord,
  PromptVersionRecord
} from './types'

export interface PromptTemplateDetail {
  template: PromptTemplateRecord
  versions: PromptVersionRecord[]
  usage: PromptUsageRecord[]
}

export class PromptStudioApplication implements PromptRuntime {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly persistence: PersistenceContext, options: { createId?: () => string; now?: () => Date } = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  listTemplates(): PromptStudioResult<PromptTemplateDetail[]> {
    const templates = this.persistence.repositories.promptStudio.listTemplates()
    if (!templates.ok) return this.failure('PROMPT_LIST_FAILED', '无法读取 Prompt', '本地 Prompt 版本读取失败。', true)
    const details: PromptTemplateDetail[] = []
    for (const template of templates.value) {
      const versions = this.persistence.repositories.promptStudio.listVersions(template.id)
      const usage = this.persistence.repositories.promptStudio.listUsage(template.id)
      if (!versions.ok || !usage.ok) return this.failure('PROMPT_LIST_FAILED', '无法读取 Prompt 历史', '版本或调用记录读取失败。', true)
      details.push({ template, versions: versions.value, usage: usage.value.slice(0, 100) })
    }
    return { ok: true, value: details }
  }

  createVersion(templateId: string, content: string, changeNote?: string): PromptStudioResult<PromptTemplateDetail> {
    const normalized = content.trim()
    if (!normalized || normalized.length > 40_000) {
      return this.failure('PROMPT_INVALID', 'Prompt 内容无效', 'Prompt 需要包含内容且不能超过 40,000 字符。', false)
    }
    const templates = this.persistence.repositories.promptStudio.listTemplates()
    if (!templates.ok) return this.failure('PROMPT_SAVE_FAILED', 'Prompt 保存失败', '无法读取模板。', true)
    const template = templates.value.find((item) => item.id === templateId)
    if (!template) return this.failure('PROMPT_NOT_FOUND', 'Prompt 不存在', '当前模板可能已被移除。', false)
    const versions = this.persistence.repositories.promptStudio.listVersions(templateId)
    if (!versions.ok) return this.failure('PROMPT_SAVE_FAILED', 'Prompt 保存失败', '无法读取历史版本。', true)
    const number = Math.max(0, ...versions.value.map((item) => item.version)) + 1
    const createdAt = this.timestamp()
    const version: PromptVersionRecord = {
      id: this.createId(), templateId, version: number, content: normalized,
      changeNote: changeNote?.trim().slice(0, 500) || undefined, createdAt
    }
    const saved = this.persistence.database.transaction(() => {
      this.unwrap(this.persistence.repositories.promptStudio.createVersion(version))
      this.unwrap(this.persistence.repositories.promptStudio.setActiveVersion(templateId, number, createdAt))
    })
    if (!saved.ok) return this.failure('PROMPT_SAVE_FAILED', 'Prompt 保存失败', '新版本未写入本地数据库。', true)
    return this.detail(template.task)
  }

  rollback(templateId: string, version: number): PromptStudioResult<PromptTemplateDetail> {
    const target = this.persistence.repositories.promptStudio.findVersion(templateId, version)
    if (!target.ok) return this.failure('PROMPT_ROLLBACK_FAILED', 'Prompt 回滚失败', '无法读取目标版本。', true)
    if (!target.value) return this.failure('PROMPT_VERSION_NOT_FOUND', 'Prompt 版本不存在', '请重新加载版本列表。', false)
    const changed = this.persistence.repositories.promptStudio.setActiveVersion(templateId, version, this.timestamp())
    if (!changed.ok || !changed.value) return this.failure('PROMPT_ROLLBACK_FAILED', 'Prompt 回滚失败', '未能切换当前激活版本。', true)
    const templates = this.persistence.repositories.promptStudio.listTemplates()
    const task = templates.ok ? templates.value.find((item) => item.id === templateId)?.task : undefined
    return task ? this.detail(task) : this.failure('PROMPT_NOT_FOUND', 'Prompt 不存在', '回滚后无法读取模板。', true)
  }

  resolveActive(task: PromptTask): ActivePromptVersion | undefined {
    const template = this.persistence.repositories.promptStudio.findTemplateByTask(task)
    if (!template.ok || !template.value) return undefined
    const version = this.persistence.repositories.promptStudio.findVersion(template.value.id, template.value.activeVersion)
    return version.ok && version.value ? { template: template.value, version: version.value } : undefined
  }

  recordUsage(input: PromptRuntimeUsageInput): void {
    const active = this.resolveActive(input.task)
    if (!active) return
    this.persistence.repositories.promptStudio.createUsage({
      id: this.createId(), promptTemplateId: active.template.id, promptVersionId: active.version.id,
      task: input.task, version: active.version.version, modelProfileId: input.modelProfileId,
      modelId: input.modelId, sessionId: input.sessionId, turnId: input.turnId, createdAt: this.timestamp()
    })
  }

  private detail(task: PromptTask): PromptStudioResult<PromptTemplateDetail> {
    const listed = this.listTemplates()
    if (!listed.ok) return listed
    const detail = listed.value.find((item) => item.template.task === task)
    return detail ? { ok: true, value: detail } : this.failure('PROMPT_NOT_FOUND', 'Prompt 不存在', '无法读取已更新的 Prompt。', false)
  }

  private unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (!result.ok) throw result.error
    return result.value
  }

  private timestamp(): string { return this.now().toISOString() }

  private failure(code: string, titleZh: string, descriptionZh: string, retryable: boolean): { ok: false; error: { code: string; titleZh: string; descriptionZh: string; retryable: boolean } } {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}
