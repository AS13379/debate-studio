export interface DatabaseBackupDto {
  id: string
  createdAt: string
  reason: 'manual' | 'pre-migration' | 'pre-restore'
  schemaVersion: number
  fileSize: number
}

export interface DataManagementStateDto {
  databasePath: string
  schemaVersion: number
  latestBackup?: DatabaseBackupDto
  backups: DatabaseBackupDto[]
}

export interface DataManagementErrorDto {
  code: string
  titleZh: string
  descriptionZh: string
  retryable: boolean
}

export type DataManagementResultDto<T> =
  | { ok: true; value: T }
  | { ok: false; error: DataManagementErrorDto }

export interface RestoreDatabaseBackupInputDto {
  backupId: string
  confirmed: boolean
}

export interface RestoreDatabaseBackupResultDto {
  restoredBackupId: string
  restartScheduled: boolean
}
