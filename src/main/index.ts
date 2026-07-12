import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { initializePersistence, type PersistenceContext } from '../persistence'
import { createWindowOptions } from './window-options'

let persistence: PersistenceContext | undefined

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
  const persistenceResult = initializePersistence({ appDataDirectory: app.getPath('userData') })
  if (!persistenceResult.ok) {
    throw new Error(`${persistenceResult.error.code}: ${persistenceResult.error.message}`)
  }
  persistence = persistenceResult.value

  ipcMain.handle('app:get-version', () => app.getVersion())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  persistence?.database.close()
  persistence = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
