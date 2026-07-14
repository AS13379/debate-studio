import { stageLabel } from '../pages/HomePage'

interface DebateProgressProps {
  stage: string
}

export const DEBATE_PROGRESS_SEGMENTS = [
  { id: 'setup', label: '准备', stages: ['draft', 'validating', 'moderating'] },
  { id: 'research', label: '研究', stages: ['public_pool', 'affirmative_planning', 'negative_planning', 'affirmative_research', 'negative_research', 'argument_drafting'] },
  { id: 'opening', label: '开篇', stages: ['affirmative_opening', 'negative_opening'] },
  { id: 'debate', label: '交锋', stages: ['cross_examination', 'rebuttal', 'free_debate'] },
  { id: 'closing', label: '总结', stages: ['negative_closing', 'affirmative_closing', 'closing'] },
  { id: 'adjudication', label: '裁决', stages: ['adjudication', 'completed'] }
] as const

export function progressSegmentIndex(stage: string): number {
  const index = DEBATE_PROGRESS_SEGMENTS.findIndex((segment) => (segment.stages as readonly string[]).includes(stage))
  return index < 0 ? 0 : index
}

export function DebateProgress({ stage }: DebateProgressProps) {
  const activeIndex = progressSegmentIndex(stage)
  const finished = stage === 'completed'
  return <section className="debate-progress panel" aria-label="辩论进度">
    <div className="debate-progress-heading"><strong>辩论进度</strong><span>当前：{stageLabel(stage)}</span></div>
    <div className="debate-progress-segments">
      {DEBATE_PROGRESS_SEGMENTS.map((segment, index) => {
        const completed = finished || index < activeIndex
        const active = !finished && index === activeIndex
        return <div
          className={`debate-progress-segment ${completed ? 'completed' : ''} ${active ? 'active' : ''}`}
          key={segment.id}
          aria-current={active ? 'step' : undefined}
        >
          <span className="segment-track" />
          <small>{segment.label}</small>
        </div>
      })}
    </div>
  </section>
}
