import { useEffect, useState } from 'react'

import type { DebateDetailDto, DebateHistoryListQueryDto, DebateHistorySummaryDto } from '../../shared/ipc-contract'
import { HomePage } from './pages/HomePage'
import { LiveDebatePage } from './pages/LiveDebatePage'
import { NewDebatePage } from './pages/NewDebatePage'
import { ProviderManagementPage } from './pages/ProviderManagementPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { DebateHistoryPage } from './pages/DebateHistoryPage'

type Page = 'home' | 'new' | 'models' | 'diagnostics' | 'live' | 'history'

export function App() {
  const storedDebateId = localStorage.getItem('debate-studio:last-debate') ?? undefined
  const [page, setPage] = useState<Page>('home')
  const [selectedDebateId, setSelectedDebateId] = useState<string | undefined>(storedDebateId)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>()
  const [debates, setDebates] = useState<DebateHistorySummaryDto[]>([])
  const [historyQuery, setHistoryQuery] = useState<DebateHistoryListQueryDto>({ status: 'active', sort: 'updated-desc' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState('')

  const loadDebates = async (query = historyQuery): Promise<void> => {
    setLoading(true)
    const result = await window.debateStudio.listDebates(query)
    if (result.ok) {
      setDebates(result.value)
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
        {page === 'home' && (
          <HomePage
            debates={debates}
            query={historyQuery}
            loading={loading}
            error={error}
            onQueryChange={setHistoryQuery}
            onCreate={() => setPage('new')}
            onCreateDemo={() => void createDemo()}
            onOpen={openDebate}
            onOpenHistory={openHistory}
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
      </main>
    </div>
  )
}
