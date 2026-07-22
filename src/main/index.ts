import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerMonitor, safeStorage, shell } from 'electron'
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
import { MacCommunityUpdatePlatform, resolveRunningAppPath } from './community-update-platform'

let desktopApplication: DebateDesktopApplication | undefined
let lanServer: LanServerManager | undefined
let disposeIpc: (() => void) | undefined
let shutdownStarted = false
let readyToQuit = false

async function closeApplicationResources(): Promise<void> {
  disposeIpc?.()
  disposeIpc = undefined
  await lanServer?.close()
  lanServer = undefined
  const result = await (desktopApplication?.close() ?? Promise.resolve({ ok: true as const, value: undefined }))
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  desktopApplication = undefined
}

async function prepareForUpdateInstall(): Promise<void> {
  if (readyToQuit) return
  shutdownStarted = true
  try {
    await closeApplicationResources()
    readyToQuit = true
  } catch (cause) {
    shutdownStarted = false
    throw cause
  }
}

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

function safeExportName(title: string): string {
  return title.normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '辩论导出'
}

if (hasSingleInstanceLock) void app.whenReady().then(async () => {
  configureDockIcon()
  const appDataDirectory = app.getPath('userData')
  const applicationUpdatePlatform = new MacCommunityUpdatePlatform({
    currentVersion: app.getVersion(),
    cacheDirectory: join(app.getPath('home'), 'Library', 'Caches', 'debate-studio-community-updater'),
    appPath: resolveRunningAppPath(process.execPath),
    quit: () => app.quit(),
    showItemInFolder: (path) => shell.showItemInFolder(path),
    openExternal: (url) => shell.openExternal(url)
  })
  // Confirm the replacement as soon as Electron itself is ready. Database and
  // application-service initialization can legitimately take longer on a large
  // local workspace and must not make the installer misdiagnose a launch failure.
  await applicationUpdatePlatform.confirmPendingStartup().catch(() => false)
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
    applicationUpdatePlatform,
    applicationUpdaterSupported: app.isPackaged && process.platform === 'darwin',
    beforeInstallUpdate: prepareForUpdateInstall,
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
  await desktopApplication.updates.initialize()
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
    updates: desktopApplication.updates,
    getAppVersion: () => app.getVersion(),
    openExternalUrl: (url) => shell.openExternal(url),
    openLanPreviewUrl: (url) => shell.openExternal(url),
    selectExportFile: async ({ debateTitle, type }) => {
      const extension = type === 'html' ? 'html' : 'md'
      const result = await dialog.showSaveDialog({
        title: type === 'html' ? '保存 HTML 辩论记录' : '保存 Markdown 辩论记录',
        defaultPath: join(app.getPath('documents'), `${safeExportName(debateTitle)}.${extension}`),
        buttonLabel: '开始导出',
        filters: [{
          name: type === 'html' ? 'HTML 文件' : 'Markdown 文件',
          extensions: [extension]
        }],
        properties: ['showOverwriteConfirmation', 'createDirectory']
      })
      return result.canceled ? undefined : result.filePath
    },
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
    },
    broadcastApplicationUpdateState: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.applicationUpdateStateChanged, state)
      }
    }
  })
  powerMonitor.on('suspend', () => { void lanServer?.suspend() })
  powerMonitor.on('resume', () => { void lanServer?.resume() })
  createWindow()
  setTimeout(() => { void desktopApplication?.updates.checkForUpdates({ automatic: true }) }, 1_500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void closeApplicationResources().finally(() => {
    readyToQuit = true
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
