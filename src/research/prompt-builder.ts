import type { UnifiedMessage, UnifiedRequest } from '../providers'
import type { DebateRuntimeConfig, RuntimeParticipant, RuntimePromptBuilder } from '../runtime'
import { ResearchContextReader } from './context-reader'
import type { ResearchPromptContext } from './types'

interface PhasePrompt {
  build(context: ResearchPromptContext): string
}

const roleLabel = (role: ResearchPromptContext['role']): string => ({
  affirmative: '正方', negative: '反方', moderator: '主持人', judge: '裁判'
})[role]

const fixedContext = (context: ResearchPromptContext): string => `
辩题：${context.topic}
背景：${context.background || '未提供'}
固定正方立场：${context.affirmativePosition || '支持辩题'}
固定反方立场：${context.negativePosition || '反对辩题'}
当前角色：${roleLabel(context.role)}

规则：
1. 永久保持当前固定立场，不替对方完成论证。
2. 只使用本提示词中列出的资料；不得推测或泄露其他角色的私有研究。
3. 公开证据只能引用下方真实存在的稳定编号（如 A-S1、B-S1、M-S1），不得伪造编号。
4. 输出可观察的研究结论、依据和未解决问题，不输出隐藏思维链。
`.trim()

const publicPoolText = (context: ResearchPromptContext): string => {
  const pool = context.publicPool
  if (!pool) return '公共资源池：尚未建立。'
  return `公共资源池：
- 辩题定义：${pool.topicDefinition}
- 时间范围：${pool.temporalScope || '未限定'}
- 地域范围：${pool.geographicScope || '未限定'}
- 关键概念：${pool.keyConcepts.join('；') || '无'}
- 争议方向：${pool.controversyDirections.join('；') || '无'}
- 明显事实边界：${pool.factBoundaries.join('；') || '无'}`
}

const researchMaterialText = (context: ResearchPromptContext): string => {
  const sources = context.visibleSources.map((item) =>
    `- [资料 ${item.id}] ${item.title}；摘要：${item.summary || '无'}；评价：${item.evaluation || '未评价'}；URL：${item.url || '无'}`)
  const assets = context.visibleAssets.map((item) =>
    `- [资产 ${item.id}] ${item.title}（${item.kind}）；内容/摘要：${item.textContent || item.summary || item.url || '仅保存了元数据'}`)
  const notes = context.visibleNotes.map((item) => `- [笔记 ${item.id}] ${item.content}`)
  const claims = context.visibleClaims.map((item) =>
    `- [暂定主张 ${item.id}] ${item.claim}；${item.unresolved ? '尚未解决' : '已形成'}`)
  return `可见研究资料：
${sources.join('\n') || '- 无'}
可见人工资产：
${assets.join('\n') || '- 无'}
可见研究笔记：
${notes.join('\n') || '- 无'}
可见暂定主张：
${claims.join('\n') || '- 无'}`
}

const evidenceText = (context: ResearchPromptContext): string => `公开证据桌：
${context.publishedEvidence.map((item) =>
  `- [${item.publicCode}] ${item.title}；状态：${item.currentStatus}；摘要：${item.summary || '无'}；来源：${item.sourceUrl || '无'}`
).join('\n') || '- 当前没有已发布证据；不得引用任何证据编号。'}`

const publicDebateText = (context: ResearchPromptContext): string => {
  if (context.publicDebateTurns.length === 0) return '此前公开发言：尚无已完成的正式辩论发言。'
  const transcript = context.publicDebateTurns.map((turn, index) => [
    `Turn ${index + 1}｜${turn.stage}｜${roleLabel(turn.participantRole)}（${turn.participantName}）`,
    turn.content.slice(0, 3_000)
  ].join('\n')).join('\n\n')
  const maximum = 80_000
  if (transcript.length <= maximum) return `此前公开发言：\n${transcript}`
  const half = Math.floor((maximum - 40) / 2)
  return `此前公开发言：\n${transcript.slice(0, half)}\n\n[中间部分因上下文长度已省略]\n\n${transcript.slice(-half)}`
}

const spokenOutputRules = (): string => `现场发言格式：
1. 只输出可在辩论现场直接朗读的实质内容。
2. 不要输出“收到”“好的”“作为正方/反方”“我方坚定认为”“下面我将”等开场套话。
3. 不要生成“对方可能的论点”“反驳：”“回应：”等元标题，直接给出论证、质询或裁决内容。
4. 不要复述任务、预告写作结构或解释你将如何回答。
5. 不输出 JSON 或代码块；可使用简洁 Markdown 强调、引用和列表。`

export class ModeratorPublicPoolPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}

任务：只建立中立、有限的公共资源池，不为任何一方生成完整论证。
${researchMaterialText(context)}
请输出 JSON：{"topicDefinition":"","temporalScope":"","geographicScope":"","keyConcepts":[],"controversyDirections":[],"factBoundaries":[],"moderatorNotes":""}。
可包含辩题定义、范围、关键概念、争议方向、用户公共资料和明显事实边界。`
  }
}

export class ResearchPlanningPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}

${publicPoolText(context)}
${researchMaterialText(context)}

任务：为${roleLabel(context.role)}制定研究计划。请输出 JSON：{"goals":[],"questions":[],"unresolvedQuestions":[]}。
只列准备核实的内容，不编造已经获得的资料。`
  }
}

export class PrivateResearchPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}

${publicPoolText(context)}
${researchMaterialText(context)}

任务：整理本方资料，输出 JSON：{"selectedSources":[],"sourceEvaluations":[],"provisionalClaims":[],"unresolvedQuestions":[]}。
不得声称已经自动抓取网页正文；URL 只有人工填写的标题和摘要可用。`
  }
}

export class ArgumentDraftingPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}

${publicPoolText(context)}
${researchMaterialText(context)}
${evidenceText(context)}

任务：形成可公开检查的论证提纲，区分主张、依据、可能反驳和未解决问题。只有公开证据编号可在正式发言中引用。`
  }
}

export class OpeningPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}\n\n${publicPoolText(context)}\n${researchMaterialText(context)}\n${evidenceText(context)}\n${publicDebateText(context)}\n\n${spokenOutputRules()}\n\n任务：完成本方开篇陈词。论点清楚，引用证据时只用已列编号。`
  }
}

export class CrossExaminationPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}\n\n${researchMaterialText(context)}\n${evidenceText(context)}\n${publicDebateText(context)}\n\n${spokenOutputRules()}\n\n任务：根据此前公开发言提出交叉质询，准确指出待澄清的主张或证据；不得把“质疑”描述为已完成核验。`
  }
}

export class RebuttalPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}\n\n${researchMaterialText(context)}\n${evidenceText(context)}\n${publicDebateText(context)}\n\n${spokenOutputRules()}\n\n任务：针对此前公开发言中的对方论点进行反驳。私有笔记可辅助组织，但不得泄露或冒充公开证据。`
  }
}

export class ClosingPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}\n\n${researchMaterialText(context)}\n${evidenceText(context)}\n${publicDebateText(context)}\n\n${spokenOutputRules()}\n\n任务：结合此前公开发言完成本方总结陈词，区分已获支持、仍有争议和未解决的部分。`
  }
}

export class AdjudicationPrompt implements PhasePrompt {
  build(context: ResearchPromptContext): string {
    return `${fixedContext(context)}\n\n${publicPoolText(context)}\n${researchMaterialText(context)}\n${evidenceText(context)}\n${publicDebateText(context)}\n\n${spokenOutputRules()}\n\n任务：依据上方完整的此前公开发言和公开证据进行裁决；不得读取或推断任何一方的私有研究。说明评判标准、不确定性和争议证据的影响。`
  }
}

export class DebatePromptBuilder implements RuntimePromptBuilder {
  private readonly templates = {
    public_pool: new ModeratorPublicPoolPrompt(),
    affirmative_planning: new ResearchPlanningPrompt(),
    negative_planning: new ResearchPlanningPrompt(),
    affirmative_research: new PrivateResearchPrompt(),
    negative_research: new PrivateResearchPrompt(),
    argument_drafting: new ArgumentDraftingPrompt(),
    affirmative_opening: new OpeningPrompt(),
    negative_opening: new OpeningPrompt(),
    cross_examination: new CrossExaminationPrompt(),
    rebuttal: new RebuttalPrompt(),
    free_debate: new RebuttalPrompt(),
    negative_closing: new ClosingPrompt(),
    affirmative_closing: new ClosingPrompt(),
    closing: new ClosingPrompt(),
    adjudication: new AdjudicationPrompt()
  } satisfies Partial<Record<UnifiedRequest['stage'], PhasePrompt>>

  constructor(private readonly contextReader: ResearchContextReader) {}

  build(request: UnifiedRequest, participant: RuntimeParticipant, runtimeConfig: DebateRuntimeConfig): UnifiedMessage[] {
    const context = this.contextReader.load({
      debateSessionId: request.sessionId,
      debateId: runtimeConfig.session.debateId,
      participantId: participant.participant.id,
      role: participant.role,
      topic: request.topic
    })
    const template = this.templates[request.stage as keyof typeof this.templates]
    const system = template?.build(context) ?? `${fixedContext(context)}\n\n${publicPoolText(context)}\n${evidenceText(context)}`
    return [
      { role: 'system', content: system },
      { role: 'user', content: request.prompt }
    ]
  }
}
