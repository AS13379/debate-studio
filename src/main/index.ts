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
import { resolveAppDataDirectory } from './app-paths'

let desktopApplication: DebateDesktopApplication | undefined
let disposeIpc: (() => void) | undefined
let shutdownStarted = false
let readyToQuit = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.setPath('userData', resolveAppDataDirectory(app.getPath('appData')))
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

function createWindow(): void {
  const window = new BrowserWindow(createWindowOptions(join(__dirname, '../preload/index.js')))

  window.once('ready-to-show', () => window.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (hasSingleInstanceLock) void app.whenReady().then(() => {
  const appDataDirectory = app.getPath('userData')
  const credentialStore = new EncryptedFileCredentialStore({
    filePath: join(appDataDirectory, 'security', 'credentials.bin'),
    cipher: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value)
    }
  })
  const applicationResult = initializeDebateDesktopApplication({
    appDataDirectory,
    credentialStore,
    appVersion: app.getVersion(),
    onDatabaseRestoreCompleted: () => {
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 750)
    },
    systemInfo: {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node
    }
  })
  if (!applicationResult.ok) {
    throw new Error(`${applicationResult.error.code}: ${applicationResult.error.message}`)
  }
  desktopApplication = applicationResult.value

  disposeIpc = registerDebateIpc({
    ipcMain,
    configuration: desktopApplication.configuration,
    history: desktopApplication.history,
    run: desktopApplication.run,
    research: desktopApplication.research,
    diagnostics: desktopApplication.diagnostics,
    dataManagement: desktopApplication.dataManagement,
    exports: desktopApplication.exports,
    logger: desktopApplication.logger,
    errorCenter: desktopApplication.errorCenter,
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
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
