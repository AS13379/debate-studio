import { lazy, Profiler, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { DebateDetailDto, DebateHistoryListQueryDto, DebateHistorySummaryDto, OnboardingStateDto } from '../../shared/ipc-contract'
import type { SettingsTab } from './pages/SettingsPage'
import { HomePage } from './pages/HomePage'
import { OnboardingWizard } from './components/OnboardingWizard'
import brandIconUrl from '../../../build/icon.svg?url'

const LiveDebatePage = lazy(() => import('./pages/LiveDebatePage').then((module) => ({ default: module.LiveDebatePage })))
const NewDebatePage = lazy(() => import('./pages/NewDebatePage').then((module) => ({ default: module.NewDebatePage })))
const DebateHistoryPage = lazy(() => import('./pages/DebateHistoryPage').then((module) => ({ default: module.DebateHistoryPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const DebateQualityPage = lazy(() => import('./pages/DebateQualityPage').then((module) => ({ default: module.DebateQualityPage })))

type Page = 'home' | 'new' | 'quality' | 'settings' | 'live' | 'history'

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
  const [onboarding, setOnboarding] = useState<OnboardingStateDto>()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('providers')
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
    void window.debateStudio.getOnboardingState().then((result) => {
      if (!result.ok) return
      setOnboarding(result.value)
      setShowOnboarding(result.value.status === 'pending')
    })
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

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [page, settingsTab, selectedDebateId, selectedHistoryId])

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

  const openSettings = (tab: SettingsTab = 'providers'): void => {
    setSettingsTab(tab)
    setPage('settings')
  }

  const createDemo = async (): Promise<void> => {
    setError(undefined)
    const result = await window.debateStudio.createMockDemoDebate()
    if (!result.ok) setError(result.error.descriptionZh)
    else openDebate(result.value)
  }

  const reopenOnboarding = async (): Promise<void> => {
    await window.debateStudio.reopenOnboarding()
    const result = await window.debateStudio.getOnboardingState()
    if (result.ok) { setOnboarding(result.value); setShowOnboarding(true) }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-hidden="true"><img src={brandIconUrl} alt="" /></div>
        <div className="brand-copy"><strong>Debate Studio</strong><span>本地 AI 辩论</span></div>
        <nav aria-label="主导航">
          <div className="sidebar-nav-group">
            <span className="sidebar-nav-label">工作台</span>
            <button className={page === 'home' ? 'active' : ''} onClick={goHome}>辩论列表</button>
            <button className={page === 'new' ? 'active' : ''} onClick={() => setPage('new')}>新建辩论</button>
            <button className={page === 'quality' ? 'active' : ''} onClick={() => setPage('quality')}>质量分析</button>
          </div>
          <div className="sidebar-nav-group sidebar-nav-settings">
            <span className="sidebar-nav-label">管理</span>
            <button className={page === 'settings' ? 'active' : ''} onClick={() => openSettings()}>设置</button>
          </div>
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
            onOpenModels={() => openSettings('providers')}
            needsModelSetup={onboarding?.needsModelSetup ?? false}
            onOpenOnboarding={() => void reopenOnboarding()}
            onOpen={openDebate}
            onOpenHistory={openHistory}
            onChanged={() => loadDebates()}
          />
        )}
        {page === 'new' && <NewDebatePage onBack={goHome} onCreated={openDebate} onOpenModels={() => openSettings('providers')} />}
        {page === 'quality' && <DebateQualityPage onOpenDebate={(id) => openDebate({ id })} />}
        {page === 'settings' && <SettingsPage activeTab={settingsTab} onTabChange={setSettingsTab} onOpenOnboarding={() => void reopenOnboarding()} />}
        {page === 'history' && selectedHistoryId && <DebateHistoryPage
          debateId={selectedHistoryId}
          onBack={goHome}
          onChanged={() => void loadDebates()}
          onOpenDebate={(id) => openDebate({ id })}
        />}
        {page === 'live' && selectedDebateId && (
          <LiveDebatePage debateId={selectedDebateId} onBack={goHome} onOpenModels={() => openSettings('providers')} onHistoryChanged={() => loadDebates()} />
        )}
        </>
        </Suspense>
        </Profiler>
      </main>
      {showOnboarding && onboarding && <OnboardingWizard
        state={onboarding}
        onClose={() => { setShowOnboarding(false); void window.debateStudio.getOnboardingState().then((result) => result.ok && setOnboarding(result.value)) }}
        onCreated={(debateId) => { setShowOnboarding(false); openDebate({ id: debateId }) }}
      />}
    </div>
  )
}
