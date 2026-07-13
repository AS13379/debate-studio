import { createRequire } from 'node:module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)

// electron-vite 3 reads Electron's path.txt without trimming trailing whitespace.
// Resolve through Electron's own entry so `npm run dev` remains reliable on macOS.
process.env.ELECTRON_EXEC_PATH ??= require('electron') as string

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
