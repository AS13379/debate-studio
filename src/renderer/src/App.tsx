import { lazy, Profiler, Suspense, useEffect, useRef, useState } from 'react'

import type { DebateDetailDto, DebateHistoryListQueryDto, DebateHistorySummaryDto } from '../../shared/ipc-contract'
import { HomePage } from './pages/HomePage'

const LiveDebatePage = lazy(() => import('./pages/LiveDebatePage').then((module) => ({ default: module.LiveDebatePage })))
const NewDebatePage = lazy(() => import('./pages/NewDebatePage').then((module) => ({ default: module.NewDebatePage })))
const ProviderManagementPage = lazy(() => import('./pages/ProviderManagementPage').then((module) => ({ default: module.ProviderManagementPage })))
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage').then((module) => ({ default: module.DiagnosticsPage })))
const DebateHistoryPage = lazy(() => import('./pages/DebateHistoryPage').then((module) => ({ default: module.DebateHistoryPage })))

type Page = 'home' | 'new' | 'models' | 'diagnostics' | 'live' | 'history'

export function App() {
  const storedDebateId = localStorage.getItem('debate-studio:last-debate') ?? undefined
  const [page, setPage] = useState<Page>('home')
  const [selectedDebateId, setSelectedDebateId] = useState<string | undefined>(storedDebateId)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>()
  const [debates, setDebates] = useState<DebateHistorySummaryDto[]>([])
  const [historyQuery, setHistoryQuery] = useState<DebateHistoryListQueryDto>({ status: 'active', sort: 'updated-desc' })
  const [loading, setLoading] = useState(true)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState('')
  const lastPerformanceReportAt = useRef(0)

  const reportRender = (_id: string, _phase: string, actualDuration: number): void => {
    const now = performance.now()
    if (now - lastPerformanceReportAt.current < 750) return
    lastPerformanceReportAt.current = now
    const reporter = window.debateStudio.reportRendererPerformance
    if (typeof reporter === 'function') void reporter({ durationMs: actualDuration, source: page })
  }

  const loadDebates = async (query = historyQuery, append = false): Promise<void> => {
    setLoading(true)
    const offset = append ? debates.length : 0
    const result = await window.debateStudio.listDebates({ ...query, limit: 51, offset })
    if (result.ok) {
      const page = result.value.slice(0, 50)
      setDebates((current) => append ? [...current, ...page] : page)
      setHistoryHasMore(result.value.length > 50)
      setError(undefined)
    } else setError(result.error.descriptionZh)
    setLoading(false)
  }

  useEffect(() => {
    void window.debateStudio.getAppVersion().then(setVersion)
    if (storedDebateId) {
      void window.debateStudio.getDebateDetail({ id: storedDebateId }).then((result) => {
        if (result.ok && result.value.historyStatus === 'active') setPage('live')
        else {
          localStorage.removeItem('debate-studio:last-debate')
          setSelectedDebateId(undefined)
        }
      })
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDebates(historyQuery), 160)
    return () => window.clearTimeout(timeout)
  }, [historyQuery])

  const openDebate = (debate: Pick<DebateHistorySummaryDto, 'id'> | DebateDetailDto): void => {
    localStorage.setItem('debate-studio:last-debate', debate.id)
    setSelectedDebateId(debate.id)
    setPage('live')
  }

  const goHome = (): void => {
    localStorage.removeItem('debate-studio:last-debate')
    setSelectedDebateId(undefined)
    setSelectedHistoryId(undefined)
    setPage('home')
    void loadDebates()
  }

  const openHistory = (debate: DebateHistorySummaryDto): void => {
    setSelectedHistoryId(debate.id)
    setPage('history')
  }

  const createDemo = async (): Promise<void> => {
    setError(undefined)
    const result = await window.debateStudio.createMockDemoDebate()
    if (!result.ok) setError(result.error.descriptionZh)
    else openDebate(result.value)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">DS</div>
        <div className="brand-copy"><strong>Debate Studio</strong><span>本地 AI 辩论</span></div>
        <nav aria-label="主导航">
          <button className={page === 'home' ? 'active' : ''} onClick={goHome}>辩论列表</button>
          <button className={page === 'new' ? 'active' : ''} onClick={() => setPage('new')}>新建辩论</button>
          <button className={page === 'models' ? 'active' : ''} onClick={() => setPage('models')}>模型与平台</button>
          <button className={page === 'diagnostics' ? 'active' : ''} onClick={() => setPage('diagnostics')}>诊断与日志</button>
        </nav>
        <span className="app-version">v{version || '…'}</span>
      </aside>
      <main className="content-area">
        <Profiler id={page} onRender={reportRender}>
        <Suspense fallback={<section className="panel muted page-loading" role="status">正在按需加载页面…</section>}>
        <>
        {page === 'home' && (
          <HomePage
            debates={debates}
            query={historyQuery}
            loading={loading}
            error={error}
            hasMore={historyHasMore}
            onQueryChange={setHistoryQuery}
            onLoadMore={() => void loadDebates(historyQuery, true)}
            onCreate={() => setPage('new')}
            onCreateDemo={() => void createDemo()}
            onOpenModels={() => setPage('models')}
            onOpen={openDebate}
            onOpenHistory={openHistory}
            onExport={openHistory}
          />
        )}
        {page === 'new' && <NewDebatePage onBack={goHome} onCreated={openDebate} onOpenModels={() => setPage('models')} />}
        {page === 'models' && <ProviderManagementPage />}
        {page === 'diagnostics' && <DiagnosticsPage />}
        {page === 'history' && selectedHistoryId && <DebateHistoryPage
          debateId={selectedHistoryId}
          onBack={goHome}
          onChanged={() => void loadDebates()}
          onOpenDebate={(id) => openDebate({ id })}
        />}
        {page === 'live' && selectedDebateId && (
          <LiveDebatePage debateId={selectedDebateId} onBack={goHome} onOpenModels={() => setPage('models')} />
        )}
        </>
        </Suspense>
        </Profiler>
      </main>
    </div>
  )
}
