import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import {
  initializeDebateDesktopApplication,
  type DebateDesktopApplication
} from '../application'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { EncryptedFileCredentialStore } from '../security'
import { registerDebateIpc } from './ipc-handlers'
import { createWindowOptions } from './window-options'

let desktopApplication: DebateDesktopApplication | undefined
let disposeIpc: (() => void) | undefined
let shutdownStarted = false
let readyToQuit = false

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
  const appDataDirectory = app.getPath('userData')
  const credentialStore = new EncryptedFileCredentialStore({
    filePath: join(appDataDirectory, 'security', 'credentials.bin'),
    cipher: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value)
    }
  })
  const applicationResult = initializeDebateDesktopApplication({ appDataDirectory, credentialStore })
  if (!applicationResult.ok) {
    throw new Error(`${applicationResult.error.code}: ${applicationResult.error.message}`)
  }
  desktopApplication = applicationResult.value

  disposeIpc = registerDebateIpc({
    ipcMain,
    configuration: desktopApplication.configuration,
    run: desktopApplication.run,
    getAppVersion: () => app.getVersion(),
    broadcastRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.runEvent, event)
      }
    }
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  disposeIpc?.()
  disposeIpc = undefined
  const closing = desktopApplication?.close() ?? Promise.resolve({ ok: true as const, value: undefined })
  void closing.finally(() => {
    desktopApplication = undefined
    readyToQuit = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
