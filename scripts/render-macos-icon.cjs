const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const rootDirectory = join(__dirname, '..')
const svg = readFileSync(join(rootDirectory, 'build', 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true }
  })

  const html = `<!doctype html><html><head><style>
    html, body { width: 1024px; height: 1024px; margin: 0; overflow: hidden; background: transparent; }
    svg { display: block; width: 1024px; height: 1024px; }
  </style></head><body>${svg}</body></html>`

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const normalized = image.getSize().width === 1024
    ? image
    : image.resize({ width: 1024, height: 1024, quality: 'best' })
  writeFileSync(join(rootDirectory, 'build', 'icon.png'), normalized.toPNG())
  window.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
