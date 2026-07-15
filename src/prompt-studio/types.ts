export const PROMPT_TASKS = [
  'debate_planning',
  'research',
  'argument',
  'rebuttal',
  'judge',
  'review'
] as const

export type PromptTask = (typeof PROMPT_TASKS)[number]

export interface PromptTemplateRecord {
  id: string
  task: PromptTask
  displayName: string
  activeVersion: number
  createdAt: string
  updatedAt: string
}

export interface PromptVersionRecord {
  id: string
  templateId: string
  version: number
  content: string
  changeNote?: string
  createdAt: string
}

export interface PromptUsageRecord {
  id: string
  promptTemplateId: string
  promptVersionId: string
  task: PromptTask
  version: number
  modelProfileId?: string
  modelId: string
  sessionId?: string
  turnId?: string
  createdAt: string
}

export interface ActivePromptVersion {
  template: PromptTemplateRecord
  version: PromptVersionRecord
}

export interface PromptStudioError {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export type PromptStudioResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PromptStudioError }

export interface PromptRuntimeUsageInput {
  task: PromptTask
  modelProfileId?: string
  modelId: string
  sessionId?: string
  turnId?: string
}

export interface PromptRuntime {
  resolveActive(task: PromptTask): ActivePromptVersion | undefined
  recordUsage(input: PromptRuntimeUsageInput): void
}

