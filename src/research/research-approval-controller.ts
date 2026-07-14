export class ResearchApprovalController {
  private readonly decisions = new Map<string, (approved: boolean) => void>()

  wait(callId: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = (): void => {
        this.decisions.delete(callId)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      this.decisions.set(callId, (approved) => {
        signal.removeEventListener('abort', onAbort)
        this.decisions.delete(callId)
        resolve(approved)
      })
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  decide(callId: string, approved: boolean): boolean {
    const decision = this.decisions.get(callId)
    if (!decision) return false
    decision(approved)
    return true
  }

  hasPending(callId: string): boolean {
    return this.decisions.has(callId)
  }
}
