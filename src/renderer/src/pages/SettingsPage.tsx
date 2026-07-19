import { lazy, Suspense } from 'react'

const ProviderManagementPage = lazy(() => import('./ProviderManagementPage').then((module) => ({ default: module.ProviderManagementPage })))
const ModelRoutingPage = lazy(() => import('./ModelRoutingPage').then((module) => ({ default: module.ModelRoutingPage })))
const CostStatisticsPage = lazy(() => import('./CostStatisticsPage').then((module) => ({ default: module.CostStatisticsPage })))
const DiagnosticsPage = lazy(() => import('./DiagnosticsPage').then((module) => ({ default: module.DiagnosticsPage })))
const PromptStudioPage = lazy(() => import('./PromptStudioPage').then((module) => ({ default: module.PromptStudioPage })))
const LanAccessPage = lazy(() => import('./LanAccessPage').then((module) => ({ default: module.LanAccessPage })))

export type SettingsTab = 'providers' | 'routing' | 'prompts' | 'costs' | 'diagnostics' | 'lan' | 'onboarding'

interface SettingsPageProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onOpenOnboarding: () => void
}

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'providers', label: '模型与平台' },
  { id: 'routing', label: '模型策略' },
  { id: 'prompts', label: 'Prompt 实验室' },
  { id: 'costs', label: '成本统计' },
  { id: 'diagnostics', label: '诊断与日志' },
  { id: 'lan', label: '局域网访问' },
  { id: 'onboarding', label: '首次引导' }
]

export function SettingsPage({ activeTab, onTabChange, onOpenOnboarding }: SettingsPageProps) {
  return (
    <section className="page-stack settings-page" aria-labelledby="settings-title">
      <header className="page-header compact">
        <div><span className="eyebrow">偏好与管理</span><h1 id="settings-title">设置</h1><p className="page-description">集中管理模型、运行策略、本地统计与诊断工具。</p></div>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => onTabChange(tab.id)}
          >{tab.label}</button>
        ))}
      </div>
      <div className="settings-tab-content" role="tabpanel">
        <Suspense fallback={<section className="panel muted page-loading" role="status">正在加载设置…</section>}>
          {activeTab === 'providers' && <ProviderManagementPage />}
          {activeTab === 'routing' && <ModelRoutingPage />}
          {activeTab === 'prompts' && <PromptStudioPage />}
          {activeTab === 'costs' && <CostStatisticsPage />}
          {activeTab === 'diagnostics' && <DiagnosticsPage />}
          {activeTab === 'lan' && <LanAccessPage />}
          {activeTab === 'onboarding' && (
            <section className="panel onboarding-settings-panel">
              <div><span className="eyebrow">快速开始</span><h2>重新打开首次使用引导</h2><p>可以重新检查模型连接、生成默认角色配置，或创建一场 Mock 示例辩论。已有数据不会被清除。</p></div>
              <button className="button primary" onClick={onOpenOnboarding}>打开首次引导</button>
            </section>
          )}
        </Suspense>
      </div>
    </section>
  )
}
