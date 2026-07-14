const FORMAL_DEBATE_STAGES = new Set([
  'affirmative_opening', 'negative_opening', 'cross_examination', 'rebuttal', 'free_debate',
  'negative_closing', 'affirmative_closing', 'closing', 'adjudication'
])

const META_HEADING = /^(?:(?:对方可能(?:提出)?的?(?:论点|观点))|(?:(?:正方|反方)(?:的)?(?:论点|观点|反驳))|(?:反驳|回应|回答|发言))(?:[一二三四五六七八九十\d]*[\s：:.、-]?.*)?$/u

const META_LINE_PATTERNS = [
  /^(?:现在)?进入[^\n]{0,30}(?:阶段|环节)[。！!：:\s]*$/u,
  /^(?:我作为|作为)(?:本场辩论的)?(?:正方|反方|主持人|裁判)[^\n]{0,160}(?:如下|问题|阶段|质询|反驳|裁决|陈词)[：:。！!\s]*$/u,
  /^(?:尊敬的[^\n]{0,80}|(?:感谢|谢谢)主持人[^\n]{0,80}|(?:各位)?大家好)[：:。！!，,\s]*$/u,
  /^(?:经过[^\n]{0,30})?我方(?:今天)?(?:观点明确|坚定地?认为|坚决认为|坚持认为)[：:，,][^\n]{0,160}(?:下面|以下|总结|。|！|!)*[^\n]*$/u,
  /^以下(?:是|为)?[^\n]{0,80}(?:反驳|发言|陈词|质询)(?:内容|问题)?[：:。！!\s]*$/u,
  /^(?:正方|反方)(?:交叉)?质询(?:：|:)[^\n]{0,80}$/u,
  /^我方质询[：:\s]*$/u,
  /^针对对方(?:可能)?提出的?第?[一二三四五六七八九十\d]+(?:个)?(?:论点|观点)[：:].*$/u,
  /^请(?:正方|反方)[^\n]{0,100}(?:回应|回答|作出回应)[。！!：:\s]*$/u,
  /^(?:谢谢|谢谢大家|谢谢各位)[。！!\s]*$/u
]

const LEADING_META_PATTERNS = [
  /^(?:收到|好的|明白)(?:了)?[!！。．,，:：\s]*/u,
  /^针对对方(?:可能)?提出的?(?:论点|观点)?[^。！？\n]*[。！？]\s*/u,
  /^(?:我|我方)(?:在此|将|现在)?(?:进行|作出)?(?:反驳|回应)[。！？：:\s]*/u,
  /^以下是[^。！？\n]*(?:反驳|发言|陈词)[。！？：:\s]*/u
]

function unwrapMarkdownHeading(line: string): string {
  return line.trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^\*\*(.*?)\*\*$/u, '$1')
    .replace(/^__(.*?)__$/u, '$1')
    .trim()
}

function stripLeadingMeta(value: string): string {
  let result = value.trimStart()
  let changed = true
  while (changed) {
    changed = false
    for (const pattern of LEADING_META_PATTERNS) {
      const next = result.replace(pattern, '')
      if (next !== result) {
        result = next.trimStart()
        changed = true
      }
    }
  }

  const stancePrefix = /^(?:我方)(?:在此)?(?:坚定)?(?:主张|认为|坚持认为)[^。！？\n]{0,120}[。！？]\s*/u
  const stanceMatch = result.match(stancePrefix)
  if (stanceMatch && result.slice(stanceMatch[0].length).trim().length > 0) {
    result = result.slice(stanceMatch[0].length).trimStart()
    return stripLeadingMeta(result)
  }
  return result
}

export function formatDebateSpeechMarkdown(content: string | undefined, stage: string): string {
  const normalized = (content ?? '').replace(/\r\n?/g, '\n').trim()
  if (!normalized || !FORMAL_DEBATE_STAGES.has(stage)) return normalized

  const withoutPreamble = stripLeadingMeta(normalized)
  const lines = withoutPreamble.split('\n').filter((line) => {
    const plainLine = unwrapMarkdownHeading(line)
    return !META_HEADING.test(plainLine) && !META_LINE_PATTERNS.some((pattern) => pattern.test(plainLine))
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
