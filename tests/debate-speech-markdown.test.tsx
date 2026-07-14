import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownContent } from '../src/renderer/src/components/MarkdownContent'
import { formatDebateSpeechMarkdown } from '../src/renderer/src/debate-speech'
import { RebuttalPrompt, type ResearchPromptContext } from '../src/research'

describe('debate speech presentation', () => {
  it('removes response acknowledgements and meta headings from formal debate speech', () => {
    const source = `收到。我方坚定认为“大学应将每周一天设为无课自主学习日”。针对对方可能提出的论点，我在此进行反驳。

**对方可能的论点一：设置无课日会降低教学时数，导致学生学业倒退。**

**反驳：**

取消一天课程并不等于减少学习，关键是学生能否把自主时间转化为深度学习。`

    expect(formatDebateSpeechMarkdown(source, 'rebuttal')).toBe(
      '取消一天课程并不等于减少学习，关键是学生能否把自主时间转化为深度学习。'
    )
  })

  it('does not rewrite persisted research output', () => {
    const content = '**研究目标：** 核对相关数据。'
    expect(formatDebateSpeechMarkdown(content, 'affirmative_research')).toBe(content)
  })

  it('removes historical stage scaffolding while retaining its following argument', () => {
    const source = `我作为正方的交锋反驳如下：

针对对方可能提出的第一论点：“设置无课日会降低教学质量”

教学时数不等于教学质量。

谢谢。`

    expect(formatDebateSpeechMarkdown(source, 'rebuttal')).toBe('教学时数不等于教学质量。')
  })

  it('hides ceremonial greetings and role restatement in historical formal turns', () => {
    const source = `感谢主持人，各位评委、对方辩友，大家好。

我方观点明确：大学不应该将每周一天设为无课自主学习日。

自主时间是否有效，取决于学习支持与自律能力。`

    expect(formatDebateSpeechMarkdown(source, 'negative_opening')).toBe(
      '自主时间是否有效，取决于学习支持与自律能力。'
    )
  })

  it('hides cross-examination wrappers but keeps the questions', () => {
    const source = `作为反方，现就辩题相关证据问题，向正方提出以下交叉质询：

**反方交叉质询：待澄清的主张与证据**

质询一：新增时间为何会转化为有效学习？`

    expect(formatDebateSpeechMarkdown(source, 'cross_examination')).toBe(
      '质询一：新增时间为何会转化为有效学习？'
    )
  })

  it('renders CommonMark while ignoring raw HTML and inerting links', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'**核心论点**\n\n- 证据一\n- 证据二\n\n[外部资料](https://example.com)\n\n<script>alert(1)</script>'} />
    )

    expect(html).toContain('<strong>核心论点</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('class="markdown-link"')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('renders bold emitted next to Chinese text even when model spacing is malformed', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'这是** 核心观点 **的实证支持。'} />)
    expect(html).toContain('这是 <strong>核心观点</strong> 的实证支持。')
    expect(html).not.toContain('**')
  })

  it('drops an unmatched bold marker instead of showing Markdown punctuation', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'核心结论：**课时不等于质量。'} />)
    expect(html).toContain('核心结论：课时不等于质量。')
    expect(html).not.toContain('**')
  })

  it('instructs the model to return directly speakable rebuttal content', () => {
    const context: ResearchPromptContext = {
      debateSessionId: 'session-speech', participantId: 'participant-affirmative', role: 'affirmative',
      topic: '大学应将每周一天设为无课自主学习日',
      visibleSources: [], visibleAssets: [], visibleNotes: [], visibleClaims: [], publishedEvidence: []
    }

    const prompt = new RebuttalPrompt().build(context)
    expect(prompt).toContain('只输出可在辩论现场直接朗读的实质内容')
    expect(prompt).toContain('不要生成“对方可能的论点”')
  })
})
