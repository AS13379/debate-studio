const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sparkleTest", {
  snapshot: () => ipcRenderer.invoke("sparkle:snapshot"),
  check: () => ipcRenderer.invoke("sparkle:check"),
  installNow: () => ipcRenderer.invoke("sparkle:install-now"),
  cancel: () => ipcRenderer.invoke("sparkle:cancel"),
  setAutomaticChecks: (enabled) => ipcRenderer.invoke("sparkle:auto", enabled),
});
