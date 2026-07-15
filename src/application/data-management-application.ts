import type { LoggerLike } from '../observability'
import type { PersistenceContext, PersistenceResult } from '../persistence'
import type {
  DatabaseBackupDto,
  DataManagementResultDto,
  DataManagementStateDto,
  RestoreDatabaseBackupResultDto
} from '../shared/data-management-dtos'

export interface DataManagementApplicationDependencies {
  persistence: PersistenceContext
  prepareForRestore(): Promise<PersistenceResult<void>>
  onRestoreCompleted?(): void
}

export class DataManagementApplication {
  constructor(
    private readonly dependencies: DataManagementApplicationDependencies,
    private readonly logger?: LoggerLike
  ) {}

  getState(): DataManagementResultDto<DataManagementStateDto> {
    const version = this.dependencies.persistence.migrations.currentVersion()
    if (!version.ok) return this.failure(version.error.code, '无法读取数据库状态', '数据库版本信息读取失败。', true)
    const backups = this.dependencies.persistence.backups.listBackups()
    if (!backups.ok) return this.failure(backups.error.code, '无法读取备份', '备份目录暂时无法读取，请稍后重试。', true)
    const items = backups.value.map(toDto)
    return {
      ok: true,
      value: {
        databasePath: this.dependencies.persistence.database.path,
        schemaVersion: version.value,
        latestBackup: items[0],
        backups: items
      }
    }
  }

  createBackup(): DataManagementResultDto<DatabaseBackupDto> {
    const version = this.dependencies.persistence.migrations.currentVersion()
    if (!version.ok) return this.failure(version.error.code, '无法创建备份', '数据库版本信息读取失败，备份未执行。', true)
    const result = this.dependencies.persistence.backups.createBackup('manual', version.value)
    if (!result.ok) return this.failure(result.error.code, '数据库备份失败', '无法创建安全备份，请检查磁盘空间和目录权限。', true)
    return { ok: true, value: toDto(result.value) }
  }

  async restoreBackup(backupId: string, confirmed: boolean): Promise<DataManagementResultDto<RestoreDatabaseBackupResultDto>> {
    if (!confirmed) {
      return this.failure(
        'RESTORE_CONFIRMATION_REQUIRED',
        '需要再次确认',
        '恢复会替换当前数据库，并取消正在运行的辩论。请在确认弹窗中再次同意。',
        false
      )
    }
    const validated = this.dependencies.persistence.backups.validateBackup(backupId)
    if (!validated.ok) return this.failure(validated.error.code, '备份不可用', '所选备份不存在或已损坏，未修改当前数据。', false)

    const version = this.dependencies.persistence.migrations.currentVersion()
    if (!version.ok) return this.failure(version.error.code, '恢复准备失败', '无法读取当前数据库版本，恢复未执行。', true)
    const safety = this.dependencies.persistence.backups.createBackup('pre-restore', version.value)
    if (!safety.ok) return this.failure(safety.error.code, '恢复准备失败', '无法创建恢复前安全备份，当前数据未被替换。', true)

    const closed = await this.dependencies.prepareForRestore()
    if (!closed.ok) return this.failure(closed.error.code, '无法安全停止应用', '运行中的任务或数据库未能安全关闭，恢复未执行。', true)

    const restored = this.dependencies.persistence.backups.restoreBackup(backupId)
    if (!restored.ok) {
      const rollback = this.dependencies.persistence.backups.restoreBackup(safety.value.id)
      this.logger?.error('数据库恢复失败', {
        source: 'data-management', metadata: { rollbackSucceeded: rollback.ok }
      })
      this.dependencies.onRestoreCompleted?.()
      return this.failure(restored.error.code, '数据库恢复失败', rollback.ok
        ? '恢复失败，已经自动还原恢复前的数据，应用将重新启动。'
        : '恢复失败，自动回滚也未完成。请保留备份并查看诊断日志。', false)
    }

    this.logger?.warn('用户恢复了数据库备份', {
      source: 'data-management', metadata: { schemaVersion: restored.value.schemaVersion }
    })
    this.dependencies.onRestoreCompleted?.()
    return { ok: true, value: { restoredBackupId: restored.value.id, restartScheduled: true } }
  }

  private failure<T>(code: string, titleZh: string, descriptionZh: string, retryable: boolean): DataManagementResultDto<T> {
    return { ok: false, error: { code, titleZh, descriptionZh, retryable } }
  }
}

function toDto(record: { id: string; createdAt: string; reason: DatabaseBackupDto['reason']; schemaVersion: number; fileSize: number }): DatabaseBackupDto {
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    schemaVersion: record.schemaVersion,
    fileSize: record.fileSize
  }
}
