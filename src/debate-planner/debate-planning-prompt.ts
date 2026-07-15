import type { DebatePlanningInput } from './types'

export const DEBATE_PLANNING_PROMPT_VERSION = 'debate-planning-v1'

export class DebatePlanningPrompt {
  build(input: DebatePlanningInput): { system: string; user: string } {
    const modeInstruction = input.mode === 'assist'
      ? '在不改变用户原意的前提下扩展双方初始立场，并在关键问题中指出双方各自需要补强的潜在漏洞。'
      : '从中立主持人的角度，为双方形成强度相当、可以被证据检验的合理立场。'
    const depth = { light: '简要', standard: '标准', deep: '深入' }[input.depth ?? 'standard']
    const context = [
      `辩题：${input.topic.trim()}`,
      input.background?.trim() ? `用户背景：${input.background.trim()}` : undefined,
      input.domain?.trim() ? `领域：${input.domain.trim()}` : undefined,
      `期望深度：${depth}`,
      input.affirmativePosition?.trim() ? `正方初始立场：${input.affirmativePosition.trim()}` : undefined,
      input.negativePosition?.trim() ? `反方初始立场：${input.negativePosition.trim()}` : undefined
    ].filter(Boolean).join('\n')

    return {
      system: [
        '你是 Debate Planner，只负责在辩论创建前生成平衡、可编辑的最终方案。',
        '分析辩题含义、双方合理立场和争议边界，但不要输出分析过程、隐藏思维链或任何解释。',
        '不要虚构具体事实、数字、来源或证据编号。',
        modeInstruction,
        '只输出一个严格 JSON 对象，不要使用 Markdown 代码块。',
        'JSON 必须包含 background、affirmativePosition、negativePosition、keyQuestions、researchDirections、evidenceSuggestions；后三项必须是字符串数组。'
      ].join('\n'),
      user: context
    }
  }
}
