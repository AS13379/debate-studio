import { contextBridge, ipcRenderer } from 'electron'
import { createDebateStudioApi } from './api'

const debateStudioApi = createDebateStudioApi(ipcRenderer)

contextBridge.exposeInMainWorld('debateStudio', debateStudioApi)
