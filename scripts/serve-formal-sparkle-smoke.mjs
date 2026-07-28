import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

const generatedRoot = resolve(
  process.env.DST_FORMAL_SPARKLE_SMOKE_ROOT
    ?? join(tmpdir(), 'debate-studio-formal-sparkle-smoke')
)
const feedRoot = join(generatedRoot, 'feed')
const types = new Map([
  ['.xml', 'application/xml; charset=utf-8'],
  ['.zip', 'application/zip']
])

const server = createServer((request, response) => {
  const requested = new URL(
    request.url ?? '/',
    'http://127.0.0.1'
  ).pathname
  const name = requested === '/'
    ? 'appcast.xml'
    : decodeURIComponent(requested.slice(1))
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    response.writeHead(400).end('invalid path')
    return
  }
  const file = join(feedRoot, name)
  try {
    const stats = statSync(file)
    response.writeHead(200, {
      'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-store'
    })
    if (extname(file) === '.zip') createReadStream(file).pipe(response)
    else response.end(readFileSync(file))
    process.stdout.write(
      `${new Date().toISOString()} ${request.method} ${requested} 200 ${stats.size}\n`
    )
  } catch {
    response.writeHead(404).end('not found')
  }
})

server.listen(27892, '127.0.0.1', () => {
  process.stdout.write(
    'Formal Sparkle smoke feed: http://127.0.0.1:27892/appcast.xml\n'
  )
})
