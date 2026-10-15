// The only bridge between Clipo's page and the desktop app. The page never sees tokens:
// it asks the main process to connect, upload and check, and gets plain results back.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipoDesktop', {
  version: '1',
  youtube: {
    getConfig: () => ipcRenderer.invoke('yt:getConfig'),
    setConfig: (c) => ipcRenderer.invoke('yt:setConfig', c),
    connect: () => ipcRenderer.invoke('yt:connect'),
    cancelConnect: () => ipcRenderer.invoke('yt:cancelConnect'),
    accounts: () => ipcRenderer.invoke('yt:accounts'),
    disconnect: (id) => ipcRenderer.invoke('yt:disconnect', id),
    upload: (req) => ipcRenderer.invoke('yt:upload', req),
    cancelUpload: (jobId) => ipcRenderer.invoke('yt:cancelUpload', jobId),
    status: (accountId, videoId) => ipcRenderer.invoke('yt:status', accountId, videoId),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('yt:progress', fn);
      return () => ipcRenderer.removeListener('yt:progress', fn);
    },
  },
});
