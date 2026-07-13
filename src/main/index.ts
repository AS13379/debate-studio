import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { initializeDebateSetupApplication, type DebateSetupApplication } from '../application'
import { createWindowOptions } from './window-options'

let debateSetupApplication: DebateSetupApplication | undefined

function createWindow(): void {
  const window = new BrowserWindow(createWindowOptions(join(__dirname, '../preload/index.js')))

  window.once('ready-to-show', () => window.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const applicationResult = initializeDebateSetupApplication({ appDataDirectory: app.getPath('userData') })
  if (!applicationResult.ok) {
    throw new Error(`${applicationResult.error.code}: ${applicationResult.error.message}`)
  }
  debateSetupApplication = applicationResult.value

  ipcMain.handle('app:get-version', () => app.getVersion())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  debateSetupApplication?.close()
  debateSetupApplication = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
