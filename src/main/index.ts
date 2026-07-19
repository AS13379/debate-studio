import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, safeStorage, shell } from 'electron'
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
import { LanServerManager } from '../lan'

let desktopApplication: DebateDesktopApplication | undefined
let lanServer: LanServerManager | undefined
let disposeIpc: (() => void) | undefined
let shutdownStarted = false
let readyToQuit = false

app.setPath('userData', resolveAppDataDirectory(app.getPath('appData')))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
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

function configureDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) app.dock.setIcon(icon)
}

if (hasSingleInstanceLock) void app.whenReady().then(async () => {
  configureDockIcon()
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
    createImageThumbnail: (bytes) => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      if (image.isEmpty()) return undefined
      const size = image.getSize()
      const width = Math.min(360, size.width)
      return image.resize({ width, quality: 'good' }).toPNG()
    },
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
  lanServer = new LanServerManager({
    application: desktopApplication.lanWeb,
    webRoot: join(__dirname, '../lan-renderer'),
    appVersion: app.getVersion(),
    logger: desktopApplication.logger
  })
  const lanInitialization = await lanServer.initialize()
  if (!lanInitialization.ok) {
    desktopApplication.logger.warn('局域网服务自动启动失败', {
      source: 'lan-server',
      metadata: { code: lanInitialization.error.code }
    })
  }

  disposeIpc = registerDebateIpc({
    ipcMain,
    configuration: desktopApplication.configuration,
    planner: desktopApplication.planner,
    onboarding: desktopApplication.onboarding,
    modelRouting: desktopApplication.modelRouting,
    costs: desktopApplication.costs,
    promptStudio: desktopApplication.promptStudio,
    quality: desktopApplication.quality,
    history: desktopApplication.history,
    run: desktopApplication.run,
    research: desktopApplication.research,
    diagnostics: desktopApplication.diagnostics,
    dataManagement: desktopApplication.dataManagement,
    exports: desktopApplication.exports,
    logger: desktopApplication.logger,
    errorCenter: desktopApplication.errorCenter,
    lanServer,
    getAppVersion: () => app.getVersion(),
    openExternalUrl: (url) => shell.openExternal(url),
    openLanPreviewUrl: (url) => shell.openExternal(url),
    broadcastRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.runEvent, event)
      }
    },
    broadcastPlannerProgress: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.plannerProgress, event)
      }
    },
    broadcastLanStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.lanStatusChanged, status)
      }
    }
  })
  powerMonitor.on('suspend', () => { void lanServer?.suspend() })
  powerMonitor.on('resume', () => { void lanServer?.resume() })
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
  const closing = (async () => {
    await lanServer?.close()
    lanServer = undefined
    return desktopApplication?.close() ?? { ok: true as const, value: undefined }
  })()
  void closing.finally(() => {
    desktopApplication = undefined
    readyToQuit = true
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
