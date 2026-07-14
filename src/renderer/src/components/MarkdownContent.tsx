import Markdown from 'react-markdown'

function normalizeBoldMarkers(line: string): string {
  const parts = line.split('**')
  if (parts.length === 1) return line

  let normalized = parts[0]
  for (let index = 1; index < parts.length; index += 2) {
    if (index + 1 >= parts.length) {
      normalized += parts[index]
      break
    }

    const boldContent = parts[index].trim()
    if (boldContent) normalized += ` **${boldContent}** `
    normalized += parts[index + 1]
  }
  return normalized
}

function normalizeModelMarkdown(content: string): string {
  return content.split('\n').map(normalizeBoldMarkers).join('\n').trim()
}

export function MarkdownContent({ content }: { content: string }) {
  return <Markdown
    skipHtml
    components={{
      h1: ({ children }) => <h3>{children}</h3>,
      h2: ({ children }) => <h3>{children}</h3>,
      h3: ({ children }) => <h4>{children}</h4>,
      a: ({ children }) => <span className="markdown-link">{children}</span>
    }}
  >{normalizeModelMarkdown(content)}</Markdown>
}
