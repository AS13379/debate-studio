export type PromptTaskDto = 'debate_planning' | 'research' | 'argument' | 'rebuttal' | 'judge' | 'review'

export interface PromptTemplateDto {
  id: string
  task: PromptTaskDto
  displayName: string
  activeVersion: number
  createdAt: string
  updatedAt: string
}

export interface PromptVersionDto {
  id: string
  templateId: string
  version: number
  content: string
  changeNote?: string
  createdAt: string
}

export interface PromptUsageDto {
  id: string
  promptTemplateId: string
  promptVersionId: string
  task: PromptTaskDto
  version: number
  modelId: string
  sessionId?: string
  turnId?: string
  createdAt: string
}

export interface PromptTemplateDetailDto {
  template: PromptTemplateDto
  versions: PromptVersionDto[]
  usage: PromptUsageDto[]
}

export interface PromptStudioErrorDto { code: string; titleZh: string; descriptionZh: string; retryable: boolean }
export type PromptStudioResultDto<T> = { ok: true; value: T } | { ok: false; error: PromptStudioErrorDto }

export interface CreatePromptVersionInputDto { templateId: string; content: string; changeNote?: string }
export interface RollbackPromptInputDto { templateId: string; version: number }
