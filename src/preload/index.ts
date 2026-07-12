import { contextBridge, ipcRenderer } from 'electron'

const debateStudioApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
}

contextBridge.exposeInMainWorld('debateStudio', debateStudioApi)

