'use strict';
const {contextBridge, ipcRenderer} = require('electron');
const modeArg = process.argv.find(value => String(value).startsWith('--jf-telegram-mode='));
const mode = String(modeArg || '').slice('--jf-telegram-mode='.length) === 'repair' ? 'repair' : 'setup';
contextBridge.exposeInMainWorld('JustFunTelegramSetup', Object.freeze({
  mode,
  submit: payload => ipcRenderer.invoke('telegram-setup:submit', {
    cloudflareToken: String(payload?.cloudflareToken || ''),
    botToken: String(payload?.botToken || '')
  }),
  cancel: () => ipcRenderer.send('telegram-setup:cancel'),
  openOfficial: target => ipcRenderer.invoke('telegram-setup:open-official', String(target || ''))
}));
