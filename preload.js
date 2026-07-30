const { contextBridge, ipcRenderer } = require('electron');

// Expose a single safe API to the renderer.
// The renderer cannot access Node/Electron APIs directly (contextIsolation: true),
// so we bridge only what it needs.
contextBridge.exposeInMainWorld('electronAPI', {
  onChunkData: (callback) => {
    ipcRenderer.on('chunk-data', (_event, data) => callback(data));
  },
  fetchChunkData: (url) => ipcRenderer.invoke('fetch-chunk-data', url),
});
