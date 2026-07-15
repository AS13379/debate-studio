import type { DebateExporter, DebateExportSnapshot, ExportResearchItem } from './types'
import { formatTimestamp, htmlEscape, roleLabel, stageLabel } from './formatting'

export class HtmlDebateExporter implements DebateExporter {
  readonly type = 'html' as const
  readonly extension = 'html'

  render(snapshot: DebateExportSnapshot): string {
    const title = htmlEscape(snapshot.metadata.title)
    const models = snapshot.models.map((model) => `<li><strong>${htmlEscape(roleLabel(model.role))}</strong>（${htmlEscape(model.participantDisplayName)}）：${htmlEscape(model.modelDisplayName)} / <code>${htmlEscape(model.modelId)}</code> · ${htmlEscape(model.providerDisplayName)}</li>`).join('') || '<li>无模型配置记录。</li>'
    const pool = snapshot.publicPool ? `
      <section><h2>公共资源池</h2>
        <h3>辩题定义</h3><div class="content">${this.text(snapshot.publicPool.topicDefinition)}</div>
        ${this.list('时间范围', snapshot.publicPool.temporalScope ? [snapshot.publicPool.temporalScope] : [])}
        ${this.list('地域范围', snapshot.publicPool.geographicScope ? [snapshot.publicPool.geographicScope] : [])}
        ${this.list('关键概念', snapshot.publicPool.keyConcepts)}
        ${this.list('争议方向', snapshot.publicPool.controversyDirections)}
        ${this.list('事实边界', snapshot.publicPool.factBoundaries)}
        ${snapshot.publicPool.moderatorNotes ? `<h3>主持人公开说明</h3><div class="content">${this.text(snapshot.publicPool.moderatorNotes)}</div>` : ''}
      </section>` : '<section><h2>公共资源池</h2><p class="muted">没有公共资源池记录。</p></section>'
    const summaries = snapshot.roleSummaries.map((item) => `<li><strong>${htmlEscape(roleLabel(item.role))}</strong>：状态 ${htmlEscape(item.status)}；目标 ${item.goalCount}；来源 ${item.sourceCount}；资料 ${item.assetCount}；笔记 ${item.noteCount}；暂定主张 ${item.claimCount}</li>`).join('')
    const evidence = snapshot.evidence.map((item) => `
      <article class="card evidence"><h3>${htmlEscape(item.publicCode)} · ${htmlEscape(item.title)}</h3>
        <p class="meta">${htmlEscape(roleLabel(item.submitterRole))} · ${htmlEscape(item.currentStatus)} · ${htmlEscape(formatTimestamp(item.createdAt))}</p>
        ${item.sourceUrl ? `<p><strong>来源：</strong><span class="wrap">${htmlEscape(item.sourceUrl)}</span></p>` : ''}
        ${item.summary ? `<div class="content">${this.text(item.summary)}</div>` : ''}
        <details><summary>状态历史（${item.history.length}）</summary>${item.history.length ? `<ol>${item.history.map((record) => `<li>${htmlEscape(formatTimestamp(record.createdAt))} · ${htmlEscape(record.fromStatus ?? '初始')} → ${htmlEscape(record.toStatus)} · ${htmlEscape(record.changedBy)}：${htmlEscape(record.note)}</li>`).join('')}</ol>` : '<p class="muted">无状态历史。</p>'}</details>
      </article>`).join('') || '<p class="muted">没有公开证据。</p>'
    const turns = snapshot.turns.map((turn) => `
      <details class="card turn" open><summary><span>${htmlEscape(stageLabel(turn.stage))}</span><span class="role">${htmlEscape(roleLabel(turn.role))}</span></summary>
        <p class="meta">${htmlEscape(turn.participantName)} · ${htmlEscape(formatTimestamp(turn.completedAt ?? turn.createdAt))} · ${htmlEscape(turn.status)}</p>
        <div class="content">${this.text(turn.content)}</div>
      </details>`).join('') || '<p class="muted">没有可导出的正式发言。</p>'

    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${title}</title><style>${CSS}</style></head>
<body><main>
  <header><p class="eyebrow">Debate Studio 辩论归档</p><h1>${title}</h1><p class="topic">${htmlEscape(snapshot.metadata.topic)}</p>
    <dl><div><dt>创建时间</dt><dd>${htmlEscape(formatTimestamp(snapshot.metadata.createdAt))}</dd></div><div><dt>完成状态</dt><dd>${htmlEscape(snapshot.metadata.completionStatus)}</dd></div><div><dt>导出时间</dt><dd>${htmlEscape(formatTimestamp(snapshot.metadata.generatedAt))}</dd></div><div><dt>私有研究</dt><dd>${snapshot.metadata.includePrivateResearch ? '已包含，请谨慎分享' : '未包含'}</dd></div></dl>
  </header>
  ${this.optional('背景说明', snapshot.background)}${this.optional('正方立场', snapshot.affirmativePosition)}${this.optional('反方立场', snapshot.negativePosition)}
  <section><h2>使用模型摘要</h2><ul>${models}</ul></section>
  <section><h2>研究摘要</h2><ul>${summaries}</ul></section>
  ${pool}
  <section><h2>公开研究资料</h2>${this.research(snapshot.publicResearch)}</section>
  ${snapshot.metadata.includePrivateResearch ? `<section class="private"><p class="privacy">本文件包含私有研究内容，请确认接收者和分享范围。</p><h2>私有研究资料</h2>${this.research(snapshot.privateResearch ?? [])}</section>` : ''}
  <section><h2>公开证据桌</h2>${evidence}</section>
  <section><h2>正式辩论</h2>${turns}</section>
</main></body></html>`
  }

  private optional(title: string, content?: string): string {
    return content?.trim() ? `<section><h2>${htmlEscape(title)}</h2><div class="content">${this.text(content)}</div></section>` : ''
  }

  private list(title: string, items: string[]): string {
    return items.length ? `<h3>${htmlEscape(title)}</h3><ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul>` : ''
  }

  private research(items: ExportResearchItem[]): string {
    if (items.length === 0) return '<p class="muted">没有可导出的资料。</p>'
    return items.map((item) => `<details class="card"><summary>${htmlEscape(roleLabel(item.ownerRole))} · ${htmlEscape(item.title)}</summary><p class="meta">${htmlEscape(item.kind)} · ${htmlEscape(item.visibility)}</p>${item.sourceUrl ? `<p class="wrap"><strong>来源：</strong>${htmlEscape(item.sourceUrl)}</p>` : ''}${item.content ? `<div class="content">${this.text(item.content)}</div>` : ''}</details>`).join('')
  }

  private text(value: string): string { return htmlEscape(value).replace(/\r?\n/g, '<br>') }
}

const CSS = `
:root{color-scheme:light dark;--bg:#f5f6fa;--surface:#fff;--surface2:#f0f2f7;--text:#171921;--muted:#656b7a;--line:#dfe2ea;--accent:#6253dc;--private:#fff4dc}
@media(prefers-color-scheme:dark){:root{--bg:#111217;--surface:#1b1d24;--surface2:#22252e;--text:#f3f4f8;--muted:#a7adbb;--line:#353947;--accent:#9488ff;--private:#362d1d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(960px,calc(100% - 32px));margin:32px auto 80px}header,section{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:24px;margin:16px 0;box-shadow:0 8px 30px rgba(0,0,0,.05)}h1{font-size:clamp(28px,5vw,46px);line-height:1.2;margin:.15em 0}h2{margin-top:0;font-size:22px}h3{font-size:17px}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.08em}.topic{font-size:19px;color:var(--muted)}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}dl div{background:var(--surface2);padding:10px 12px;border-radius:10px}dt{font-size:12px;color:var(--muted)}dd{margin:0;font-weight:600}.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0;background:var(--surface2)}details summary{cursor:pointer;font-weight:700}.turn summary{display:flex;justify-content:space-between;gap:12px}.role{color:var(--accent)}.content{white-space:pre-wrap;overflow-wrap:anywhere}.meta,.muted{color:var(--muted);font-size:14px}.wrap{overflow-wrap:anywhere}.privacy{padding:12px;border-radius:10px;background:var(--private);font-weight:700}.private{border-color:#c99531}@media(max-width:600px){main{width:min(100% - 20px,960px);margin-top:10px}header,section{padding:18px;border-radius:14px}.turn summary{display:block}}
`
