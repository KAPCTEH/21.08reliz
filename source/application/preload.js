'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const editionArg = process.argv.find(value => String(value).startsWith('--jf-edition='));
const bootstrapEdition = String(editionArg || '').slice('--jf-edition='.length) === 'demo' ? 'demo' : 'full';
const companyArg = process.argv.find(value => String(value).startsWith('--jf-company-id='));
const bootstrapCompanyId = String(companyArg || '').slice('--jf-company-id='.length).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const versionArg = process.argv.find(value => String(value).startsWith('--jf-version='));
const bootstrapVersion = String(versionArg || '').slice('--jf-version='.length);
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(bootstrapVersion)) {
  throw new Error('Canonical JustFun version is missing from the protected preload arguments.');
}
ipcRenderer.send('desktop:startup-stage', {stage:'preload-loaded', detail:`edition=${bootstrapEdition}`});
contextBridge.exposeInMainWorld('JustFunDesktop', Object.freeze({
  version: bootstrapVersion,
  platform: process.platform,
  bootstrapEdition,
  bootstrapCompanyId,
  startupStage: (stage, detail='') => ipcRenderer.send('desktop:startup-stage', {stage:String(stage || ''), detail:String(detail || '')}),
  startupReady: (payload={}) => ipcRenderer.invoke('desktop:renderer-ready', payload),
  setActiveWarehouse: (payload={}) => ipcRenderer.invoke('desktop:set-active-warehouse', payload),
  getSession: () => ipcRenderer.invoke('desktop:get-session'),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  openLogFolder: () => ipcRenderer.invoke('desktop:open-log-folder'),
  copyText: (text) => ipcRenderer.invoke('desktop:copy-text', String(text ?? '')),
  openSupport: (channel) => ipcRenderer.invoke('desktop:open-support', channel),
  updates: Object.freeze({
    status: () => ipcRenderer.invoke('desktop:update-status'),
    check: () => ipcRenderer.invoke('desktop:update-check'),
    download: () => ipcRenderer.invoke('desktop:update-download'),
    apply: () => ipcRenderer.invoke('desktop:update-apply'),
    onStatus: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('desktop:update-status', listener);
      return () => ipcRenderer.removeListener('desktop:update-status', listener);
    }
  }),
  auth: Object.freeze({
    checkLicense: (licenseKey) => ipcRenderer.invoke('desktop:auth-license-check', {licenseKey:String(licenseKey||'')}),
    registerOwner: (payload) => ipcRenderer.invoke('desktop:auth-register-owner', payload||{}),
    login: (payload) => ipcRenderer.invoke('desktop:auth-login', payload||{}),
    acceptInvitation: (payload) => ipcRenderer.invoke('desktop:auth-accept-invitation', payload||{}),
    logout: () => ipcRenderer.invoke('desktop:auth-logout'),
    users: () => ipcRenderer.invoke('desktop:auth-users'),
    invite: (payload) => ipcRenderer.invoke('desktop:auth-invite', payload||{}),
    setUserStatus: (payload) => ipcRenderer.invoke('desktop:auth-user-status', payload||{}),
    setUserAccess: (payload) => ipcRenderer.invoke('desktop:auth-user-access', payload||{}),
    devices: () => ipcRenderer.invoke('desktop:auth-devices'),
    setDeviceStatus: (payload) => ipcRenderer.invoke('desktop:auth-device-status', payload||{})
  }),
  regVps: Object.freeze({
    status: () => ipcRenderer.invoke('desktop:reg-status'),
    warehouses: (payload) => ipcRenderer.invoke('desktop:reg-warehouses', payload||{}),
    configure: (payload) => ipcRenderer.invoke('desktop:reg-configure', payload),
    bootstrapEntities: (payload) => ipcRenderer.invoke('desktop:reg-entity-bootstrap', payload||{}),
    syncEntities: (payload) => ipcRenderer.invoke('desktop:reg-entity-sync', payload||{}),
    entityChanges: (payload) => ipcRenderer.invoke('desktop:reg-entity-changes', payload||{}),
    writeWarehouse: (payload) => ipcRenderer.invoke('desktop:reg-warehouse-write', payload||{})
  }),
  maps: Object.freeze({
    geocode: (payload) => ipcRenderer.invoke('desktop:maps-geocode', payload||{}),
    route: (payload) => ipcRenderer.invoke('desktop:maps-route', payload||{}),
    diagnostic: (payload) => ipcRenderer.invoke('desktop:maps-diagnostic', payload||{})
  }),
  telegramCloudflare: Object.freeze({
    status: (payload={}) => ipcRenderer.invoke('desktop:telegram-status', payload),
    configure: (reconnect=false, warehouseId='') => ipcRenderer.invoke('desktop:telegram-configure', {reconnect:!!reconnect, warehouseId:String(warehouseId||'')}),
    createLink: (payload) => ipcRenderer.invoke('desktop:telegram-create-link', payload),
    sendNotification: (payload) => ipcRenderer.invoke('desktop:telegram-send', payload),
    pollEvents: (payload) => ipcRenderer.invoke('desktop:telegram-poll-events', payload),
    bindings: (payload) => ipcRenderer.invoke('desktop:telegram-bindings', payload),
    onProgress: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('desktop:telegram-progress', listener);
      return () => ipcRenderer.removeListener('desktop:telegram-progress', listener);
    },
    onCompanyPublished: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('desktop:telegram-company-published', listener);
      return () => ipcRenderer.removeListener('desktop:telegram-company-published', listener);
    }
  }),
  saveTextFile: (name, content) => ipcRenderer.invoke('desktop:save-text-file', {name, content}),
  selectFile: (filters) => ipcRenderer.invoke('desktop:select-file', filters),
  selectFolder: () => ipcRenderer.invoke('desktop:select-folder'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onDemoTick: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('desktop:demo-tick', listener);
    return () => ipcRenderer.removeListener('desktop:demo-tick', listener);
  },
  onAppEvent: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('desktop:app-event', listener);
    return () => ipcRenderer.removeListener('desktop:app-event', listener);
  }
}));
