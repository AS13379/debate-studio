import type { BrowserWindowConstructorOptions } from 'electron'

export function createWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}
