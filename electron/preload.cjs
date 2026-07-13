const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reportAgentAI", {
  getSettings: () => ipcRenderer.invoke("ai:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("ai:save-settings", settings),
  testConnection: (settings) => ipcRenderer.invoke("ai:test-connection", settings),
  clearKey: () => ipcRenderer.invoke("ai:clear-key"),
  generateCopy: (request) => ipcRenderer.invoke("ai:generate-copy", request),
});

contextBridge.exposeInMainWorld("reportAgentXhs", {
  getStatus: () => ipcRenderer.invoke("xhs:get-status"),
  openLogin: () => ipcRenderer.invoke("xhs:open-login"),
  preparePublish: (request) => ipcRenderer.invoke("xhs:prepare-publish", request),
  submitScheduled: (request) => ipcRenderer.invoke("xhs:submit-scheduled", request),
  resolvePending: (resolution) => ipcRenderer.invoke("xhs:resolve-pending", resolution),
  disconnect: () => ipcRenderer.invoke("xhs:disconnect"),
  onProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("xhs:publish-progress", handler);
    return () => ipcRenderer.removeListener("xhs:publish-progress", handler);
  },
});
