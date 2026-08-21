'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('SplashAPI', Object.freeze({
  onStatus(handler) {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('splash-status', (_event, payload) => handler(payload));
  }
}));
