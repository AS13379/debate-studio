import type { DebateStudioApi } from './ipc-contract'

declare global {
  interface Window {
    debateStudio: DebateStudioApi
  }
}

export {}
