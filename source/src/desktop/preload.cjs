"use strict";
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('relay', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  action: message => ipcRenderer.invoke('action', message),
  onStatus: callback => ipcRenderer.on('status', (_, state) => callback(state)),
  onError: callback => ipcRenderer.on('ui-error', (_, text) => callback(text)),
});
