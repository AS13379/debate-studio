import { useEffect, useState } from 'react'

import type { DebateDetailDto, DebateSummaryDto } from '../../shared/ipc-contract'
import { HomePage } from './pages/HomePage'
import { LiveDebatePage } from './pages/LiveDebatePage'
import { NewDebatePage } from './pages/NewDebatePage'

type Page = 'home' | 'new' | 'live'

export function App() {
  const storedDebateId = localStorage.getItem('debate-studio:last-debate') ?? undefined
  const [page, setPage] = useState<Page>(storedDebateId ? 'live' : 'home')
  const [selectedDebateId, setSelectedDebateId] = useState<string | undefined>(storedDebateId)
  const [debates, setDebates] = useState<DebateSummaryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState('')

  const loadDebates = async (): Promise<void> => {
    setLoading(true)
    const result = await window.debateStudio.listDebates()
    if (result.ok) {
      setDebates(result.value)
      setError(undefined)
    } else setError(result.error.descriptionZh)
    setLoading(false)
  }

  useEffect(() => {
    void loadDebates()
    void window.debateStudio.getAppVersion().then(setVersion)
  }, [])

  const openDebate = (debate: Pick<DebateSummaryDto, 'id'> | DebateDetailDto): void => {
    localStorage.setItem('debate-studio:last-debate', debate.id)
    setSelectedDebateId(debate.id)
    setPage('live')
  }

  const goHome = (): void => {
    localStorage.removeItem('debate-studio:last-debate')
    setSelectedDebateId(undefined)
    setPage('home')
    void loadDebates()
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
        </nav>
        <span className="app-version">v{version || '…'}</span>
      </aside>
      <main className="content-area">
        {page === 'home' && (
          <HomePage
            debates={debates}
            loading={loading}
            error={error}
            onCreate={() => setPage('new')}
            onCreateDemo={() => void createDemo()}
            onOpen={openDebate}
          />
        )}
        {page === 'new' && <NewDebatePage onBack={goHome} onCreated={openDebate} />}
        {page === 'live' && selectedDebateId && <LiveDebatePage debateId={selectedDebateId} onBack={goHome} />}
      </main>
    </div>
  )
}
