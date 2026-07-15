import { existsSync } from 'node:fs'
import { chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { ExportFileStore } from './types'

export class LocalExportFileStore implements ExportFileStore {
  async write(filePath: string, content: string, options: {
    signal?: AbortSignal
    onProgress?: (progress: number) => void
    chunkCharacters?: number
  } = {}): Promise<number> {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await chmod(dirname(filePath), 0o700)
    const temporaryPath = `${filePath}.tmp`
    const chunkSize = Math.max(16_384, options.chunkCharacters ?? 256 * 1024)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      throwIfAborted(options.signal)
      handle = await open(temporaryPath, 'w', 0o600)
      for (let offset = 0; offset < content.length; offset += chunkSize) {
        throwIfAborted(options.signal)
        await handle.writeFile(content.slice(offset, offset + chunkSize), { encoding: 'utf8' })
        options.onProgress?.(Math.min(1, (offset + chunkSize) / Math.max(1, content.length)))
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      await handle.close()
      handle = undefined
      throwIfAborted(options.signal)
      await rename(temporaryPath, filePath)
      return (await stat(filePath)).size
    } catch (cause) {
      await handle?.close().catch(() => undefined)
      if (existsSync(temporaryPath)) await unlink(temporaryPath).catch(() => undefined)
      throw cause
    }
  }

  async delete(filePath: string): Promise<boolean> {
    if (!existsSync(filePath)) return false
    await unlink(filePath)
    return true
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Export was cancelled.')
  error.name = 'AbortError'
  throw error
}
