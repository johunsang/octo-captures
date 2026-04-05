const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  saveVideo: (buffer) => ipcRenderer.invoke('save-video', buffer),
  saveWebcam: (buffer) => ipcRenderer.invoke('save-webcam', buffer),
  saveVideoDialog: (name) => ipcRenderer.invoke('save-video-dialog', name),
  saveImageDialog: (name) => ipcRenderer.invoke('save-image-dialog', name),
  selectFolderDialog: () => ipcRenderer.invoke('select-folder-dialog'),
  writeFile: (data) => ipcRenderer.invoke('write-file', data),
  startCursorTracking: (options) => ipcRenderer.send('start-cursor-tracking', options),
  stopCursorTracking: () => ipcRenderer.send('stop-cursor-tracking'),
  onCursorData: (callback) => ipcRenderer.on('cursor-data', (event, data) => callback(data)),
  convertToMp4: (data) => ipcRenderer.invoke('convert-to-mp4', data),
  convertVideo: (data) => ipcRenderer.invoke('convert-video', data),
  openPreview: (data) => ipcRenderer.send('open-preview', data),
  onToggleRecording: (callback) => ipcRenderer.on('toggle-recording', callback),
  onLoadVideo: (callback) => ipcRenderer.on('load-video', (event, data) => callback(data)),
  openScreenSettings: () => ipcRenderer.send('open-screen-settings'),
  openCameraSettings: () => ipcRenderer.send('open-camera-settings'),
  // Auto-mouse control for script replay
  autoMouseMove: (pos) => ipcRenderer.send('auto-mouse-move', pos),
  autoMouseClick: (pos) => ipcRenderer.send('auto-mouse-click', pos),
  autoMouseScroll: (pos) => ipcRenderer.send('auto-mouse-scroll', pos),
  getMousePosition: () => ipcRenderer.invoke('get-mouse-position'),
});
