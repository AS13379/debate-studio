import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { ExportFileStore } from './types'

export class LocalExportFileStore implements ExportFileStore {
  write(filePath: string, content: string): number {
    mkdirSync(dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    try {
      writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, filePath)
      return statSync(filePath).size
    } catch (cause) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      throw cause
    }
  }

  delete(filePath: string): boolean {
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }
}
