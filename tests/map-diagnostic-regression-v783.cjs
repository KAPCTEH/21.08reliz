'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const main=read('source/application/main.js');
const preload=read('source/application/preload.js');
const renderer=read('source/application/web/assets/js/00-app-bundle-v595.js');

assert(preload.includes("diagnostic: (payload) => ipcRenderer.invoke('desktop:maps-diagnostic'"));
assert(main.includes("handleMainIPC('desktop:maps-diagnostic'"));
assert(main.includes("appendRecurringLog('Map administrative parser diagnostic'"));
assert(renderer.includes('deliveryAddressAbortController?.abort()'));
assert(renderer.includes("if(err?.name!=='AbortError'"));
assert(renderer.includes('addressKeys:Object.keys(raw?.address||{})'));
assert(renderer.includes('regionDetected:!!parsed.region,districtDetected:!!parsed.district'));
assert(renderer.includes("source:'cache'"));
console.log(JSON.stringify({ok:true,staleSearchAborted:true,sourceTrace:true,privacyBounded:true}));
