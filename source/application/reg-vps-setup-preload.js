'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('JustFunRegVpsSetup', Object.freeze({
  submit: password => ipcRenderer.invoke('reg-vps-setup:submit', { password: String(password || '') }),
  cancel: () => ipcRenderer.send('reg-vps-setup:cancel')
}));
