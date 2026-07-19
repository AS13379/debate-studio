import { lazy, Profiler, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { DebateDetailDto, DebateHistoryListQueryDto, DebateHistorySummaryDto, OnboardingStateDto } from '../../shared/ipc-contract'
import type { SettingsTab } from './pages/SettingsPage'
import { HomePage } from './pages/HomePage'
import { OnboardingWizard } from './components/OnboardingWizard'
import { WorkbenchShell } from './components/UnifiedWorkbench'

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
    <WorkbenchShell
      subtitle="本地 AI 辩论"
      version={`v${version || '…'}`}
      primaryNav={[
        { id: 'home', label: '辩论列表', active: page === 'home', onSelect: goHome },
        { id: 'new', label: '新建辩论', active: page === 'new', onSelect: () => setPage('new') },
        { id: 'quality', label: '质量分析', active: page === 'quality', onSelect: () => setPage('quality') }
      ]}
      managementNav={[{ id: 'settings', label: '设置', active: page === 'settings', onSelect: () => openSettings() }]}
    >
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
      {showOnboarding && onboarding && <OnboardingWizard
        state={onboarding}
        onClose={() => { setShowOnboarding(false); void window.debateStudio.getOnboardingState().then((result) => result.ok && setOnboarding(result.value)) }}
        onCreated={(debateId) => { setShowOnboarding(false); openDebate({ id: debateId }) }}
      />}
    </WorkbenchShell>
  )
}
