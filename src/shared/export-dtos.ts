import type { ConfigurationResultDto } from './debate-dtos'

export type DebateExportTypeDto = 'markdown' | 'html'
export type DebateExportStatusDto = 'generating' | 'completed' | 'failed' | 'cancelled'

export interface DebateExportOptionsDto {
  includePrivateResearch: boolean
}

export interface ExportDebateInputDto {
  debateId: string
  exportOptions: DebateExportOptionsDto
}

export interface DeleteExportInputDto {
  exportId: string
}

export interface CancelExportInputDto {
  exportId: string
}

export interface DebateExportRecordDto {
  exportId: string
  debateId: string
  debateTitle: string
  type: DebateExportTypeDto
  includePrivateResearch: boolean
  filePath: string
  createdAt: string
  updatedAt: string
  fileSize: number
  status: DebateExportStatusDto
  progress: number
  error?: {
    titleZh: string
    descriptionZh: string
  }
}

export type DebateExportResultDto<T> = ConfigurationResultDto<T>
