const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mahatDesktop', {
  isDesktop: true,
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('mahat:get-info'),
  toggleFullscreen: () => ipcRenderer.invoke('mahat:toggle-fullscreen'),
  openPlaylistsFolder: () => ipcRenderer.invoke('mahat:open-playlists-folder')
});
