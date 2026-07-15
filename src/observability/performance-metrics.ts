import type {
  PerformanceMetricSummary,
  PerformanceSnapshot,
  SessionPerformanceMetric
} from './types'

interface SessionAccumulator {
  sessionId: string
  startedAt: number
  finishedAt?: number
  status: string
  turnCount: number
  responseDurations: number[]
  maxGenerationCharacters: number
}

export interface PerformanceMetricsOptions {
  now?: () => Date
  memoryUsage?: () => { rss: number }
  maxSamples?: number
  maxSessions?: number
}

export class PerformanceMetricsCollector {
  private readonly now: () => Date
  private readonly memoryUsage: () => { rss: number }
  private readonly maxSamples: number
  private readonly maxSessions: number
  private readonly sqliteDurations: number[] = []
  private readonly rendererDurations: number[] = []
  private readonly exportDurations: number[] = []
  private readonly sessions = new Map<string, SessionAccumulator>()
  private readonly turnStartedAt = new Map<string, number>()
  private exportCompleted = 0
  private exportFailed = 0
  private exportCancelled = 0
  private memoryPeakBytes = 0

  constructor(options: PerformanceMetricsOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.memoryUsage = options.memoryUsage ?? (() => process.memoryUsage())
    this.maxSamples = Math.max(20, options.maxSamples ?? 2_000)
    this.maxSessions = Math.max(5, options.maxSessions ?? 30)
    this.sampleMemory()
  }

  recordSQLite(durationMs: number): void {
    this.push(this.sqliteDurations, durationMs)
    this.sampleMemory()
  }

  recordRenderer(durationMs: number): void {
    this.push(this.rendererDurations, durationMs)
    this.sampleMemory()
  }

  recordExport(durationMs: number, status: 'completed' | 'failed' | 'cancelled'): void {
    this.push(this.exportDurations, durationMs)
    if (status === 'completed') this.exportCompleted += 1
    else if (status === 'cancelled') this.exportCancelled += 1
    else this.exportFailed += 1
    this.sampleMemory()
  }

  sessionStarted(sessionId: string, timestamp: string): void {
    if (this.sessions.has(sessionId)) return
    this.sessions.set(sessionId, {
      sessionId,
      startedAt: parseTime(timestamp, this.now().getTime()),
      status: 'running',
      turnCount: 0,
      responseDurations: [],
      maxGenerationCharacters: 0
    })
    this.trimSessions()
    this.sampleMemory()
  }

  turnStarted(sessionId: string, turnId: string, timestamp: string): void {
    this.sessionStarted(sessionId, timestamp)
    this.turnStartedAt.set(turnId, parseTime(timestamp, this.now().getTime()))
  }

  turnFinished(sessionId: string, turnId: string, timestamp: string, contentLength: number): void {
    this.sessionStarted(sessionId, timestamp)
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.turnCount += 1
    session.maxGenerationCharacters = Math.max(session.maxGenerationCharacters, Math.max(0, contentLength))
    const finishedAt = parseTime(timestamp, this.now().getTime())
    const startedAt = this.turnStartedAt.get(turnId)
    if (startedAt !== undefined) session.responseDurations.push(Math.max(0, finishedAt - startedAt))
    this.turnStartedAt.delete(turnId)
    this.sampleMemory()
  }

  sessionFinished(sessionId: string, timestamp: string, status: string): void {
    this.sessionStarted(sessionId, timestamp)
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.finishedAt = parseTime(timestamp, this.now().getTime())
    session.status = status
    this.sampleMemory()
  }

  snapshot(): PerformanceSnapshot {
    const now = this.now()
    const nowTime = now.getTime()
    return {
      generatedAt: now.toISOString(),
      sessions: [...this.sessions.values()].map((session): SessionPerformanceMetric => ({
        sessionId: session.sessionId,
        status: session.status,
        totalDurationMs: Math.max(0, (session.finishedAt ?? nowTime) - session.startedAt),
        turnCount: session.turnCount,
        averageResponseMs: average(session.responseDurations),
        maxGenerationCharacters: session.maxGenerationCharacters
      })).reverse(),
      sqlite: summarize(this.sqliteDurations),
      renderer: summarize(this.rendererDurations),
      exports: {
        ...summarize(this.exportDurations),
        completed: this.exportCompleted,
        failed: this.exportFailed,
        cancelled: this.exportCancelled
      },
      memoryPeakBytes: this.memoryPeakBytes || undefined
    }
  }

  private push(target: number[], value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    target.push(value)
    if (target.length > this.maxSamples) target.splice(0, target.length - this.maxSamples)
  }

  private sampleMemory(): void {
    try { this.memoryPeakBytes = Math.max(this.memoryPeakBytes, this.memoryUsage().rss) } catch { /* unavailable */ }
  }

  private trimSessions(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined
      if (!oldest) return
      this.sessions.delete(oldest)
    }
  }
}

function parseTime(timestamp: string, fallback: number): number {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : fallback
}

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function summarize(values: number[]): PerformanceMetricSummary {
  if (!values.length) return { count: 0, averageMs: 0, maxMs: 0, p95Ms: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    count: values.length,
    averageMs: average(values),
    maxMs: sorted.at(-1) ?? 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
  }
}
