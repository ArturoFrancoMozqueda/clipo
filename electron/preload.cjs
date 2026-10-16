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
    // req: { jobId, accountId, mime, metadata, thumbnail?, and either bytes (whole video, up to 2 GiB)
    // or fileId (from uploadBegin/uploadAppend, any size) }.
    upload: (req) => ipcRenderer.invoke('yt:upload', req),
    // Chunked transfer, so a multi-GB video is never held whole in memory:
    //   const { fileId, chunkLimit } = await uploadBegin(file.size, file.type);
    //   for each slice of ≤ chunkLimit bytes, in order: await uploadAppend(fileId, await slice.arrayBuffer());
    //   await upload({ ...req, fileId });   // the temp file is removed after success
    //   uploadDiscard(fileId) when the user gives up (it is also removed when the app quits).
    chunkedUpload: true,
    uploadBegin: (total, mime) => ipcRenderer.invoke('yt:uploadBegin', total, mime),
    uploadAppend: (fileId, bytes) => ipcRenderer.invoke('yt:uploadAppend', fileId, bytes),
    uploadDiscard: (fileId) => ipcRenderer.invoke('yt:uploadDiscard', fileId),
    cancelUpload: (jobId) => ipcRenderer.invoke('yt:cancelUpload', jobId),
    status: (accountId, videoId) => ipcRenderer.invoke('yt:status', accountId, videoId),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('yt:progress', fn);
      return () => ipcRenderer.removeListener('yt:progress', fn);
    },
  },
  // Facebook Pages and Instagram Reels (electron/publish/meta.cjs). Same chunked transfer as YouTube:
  // uploadBegin → uploadAppend… → upload({ jobId, accountId, network, fileId, mime, text, publishAt?, published?, thumbnail? }).
  meta: {
    getConfig: () => ipcRenderer.invoke('meta:getConfig'),
    setConfig: (c) => ipcRenderer.invoke('meta:setConfig', c),
    connect: () => ipcRenderer.invoke('meta:connect'),
    cancelConnect: () => ipcRenderer.invoke('meta:cancelConnect'),
    accounts: () => ipcRenderer.invoke('meta:accounts'),
    disconnect: (id) => ipcRenderer.invoke('meta:disconnect', id),
    upload: (req) => ipcRenderer.invoke('meta:upload', req),
    uploadBegin: (total, mime) => ipcRenderer.invoke('meta:uploadBegin', total, mime),
    uploadAppend: (fileId, bytes) => ipcRenderer.invoke('meta:uploadAppend', fileId, bytes),
    uploadDiscard: (fileId) => ipcRenderer.invoke('meta:uploadDiscard', fileId),
    cancelUpload: (jobId) => ipcRenderer.invoke('meta:cancelUpload', jobId),
    status: (accountId, remoteId) => ipcRenderer.invoke('meta:status', accountId, remoteId),
    onProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('meta:progress', fn);
      return () => ipcRenderer.removeListener('meta:progress', fn);
    },
  },
});
