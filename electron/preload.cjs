const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openAudioDialog: () => ipcRenderer.invoke('dialog:openAudio'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  resolveSource: (info) => ipcRenderer.invoke('source:resolve', info),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  saveRecording: (data, ext) => ipcRenderer.invoke('recording:save', { data, ext }),
  writeText: (path, text) => ipcRenderer.invoke('file:writeText', { path, text }),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  saveProject: (data, path, saveAs) => ipcRenderer.invoke('project:save', { data, path, saveAs }),
  openProject: (path) => ipcRenderer.invoke('project:open', path),
  recentProjects: () => ipcRenderer.invoke('recent:list'),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  setLibrary: (list) => ipcRenderer.invoke('library:set', list),

  chooseExport: (defaultName, ext) => ipcRenderer.invoke('export:choose', { defaultName, ext }),
  streamOpen: (p) => ipcRenderer.invoke('stream:open', p),
  streamWrite: (id, data) => ipcRenderer.invoke('stream:write', { id, data }),
  streamClose: (id) => ipcRenderer.invoke('stream:close', id),

  jcardPdf: (html, defaultName) => ipcRenderer.invoke('jcard:pdf', { html, defaultName }),

  youtubeDownload: (url) => ipcRenderer.invoke('youtube:download', url),
  onYoutubeProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
});
