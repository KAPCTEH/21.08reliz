'use strict';
// Release trigger: patched REG.RU TLS source commit d92afc8 is ready for Windows verification.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const Module=require('node:module');

const root=path.resolve(__dirname,'..');
const mainPath=path.join(root,'source/application/main.js');
const rendererPath=path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js');
const installPath=path.join(root,'source/application/integrations/reg-vps/server/install.sh');
const source=fs.readFileSync(mainPath,'utf8');
const renderer=fs.readFileSync(rendererPath,'utf8');
const installer=fs.readFileSync(installPath,'utf8');
const pinBlock=source.match(/function pinnedHttpsAgent[\s\S]*?function jsonRequest/)?.[0]||'';
assert(pinBlock.includes('maxCachedSessions:0'));
assert(pinBlock.includes('TLS_PIN_MISMATCH'));
assert(!pinBlock.includes('return socket;'));
assert(source.includes("function loadWorkerState(warehouseId=activeRendererWarehouseId,companyId='')"));
assert(renderer.includes("q('#jfRegCheck').onclick=()=>refreshRegVpsStatus({manual:true})"));
assert(renderer.includes('Связь подтверждена в ${checked}'));
assert(installer.includes('install -d -o root -g orderslogistics -m 0750 /opt/justfun'));
assert(installer.includes('install -o orderslogistics -g orderslogistics -m 0640'));
assert(installer.includes('rm -f /etc/nginx/conf.d/00-orders-logistics.conf'));

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'justfun-reg-tls-'));
process.env.LOCALAPPDATA=path.join(temp,'local');
process.env.PROGRAMDATA=path.join(temp,'programdata');
process.env.JF_LOG_EXE_DIR_FOR_TEST=path.join(temp,'exe');
process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST=path.join(temp,'emergency');
process.env.JF_DESKTOP_UNIT_TEST='1';
const electron={app:{getPath:name=>path.join(temp,name),setPath(){}},BrowserWindow:class{},ipcMain:{handle(){},on(){}},dialog:{},shell:{},clipboard:{},session:{},Menu:{},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString('utf8')}};
const originalLoad=Module._load;
Module._load=(request,parent,isMain)=>request==='electron'?electron:request==='ssh2'?{Client:class {}}:originalLoad(request,parent,isMain);
const main=require(mainPath);
Module._load=originalLoad;

const repaired=main.validateWorkerState({worker_name:'justfun-logistics-bot',workers_subdomain:'owner123'});
assert.equal(repaired.url.origin,'https://justfun-logistics-bot.owner123.workers.dev');
assert.equal(repaired.state.webhook_url,'https://justfun-logistics-bot.owner123.workers.dev/telegram');

const tls=require('node:tls');
const raw=Buffer.from('justfun-reg-tls-unit-certificate');
const pin=crypto.createHash('sha256').update(raw).digest('hex');
const originalConnect=tls.connect;
const socket=new EventEmitter();
socket.setTimeout=()=>socket;
socket.destroy=()=>socket;
socket.getPeerCertificate=()=>({raw});
tls.connect=()=>socket;
let callbacks=0,ready=null,error=null;
const agent=main.pinnedHttpsAgent(pin);
const returned=agent.createConnection({host:'194.67.74.79',port:443,timeout:15000},(err,value)=>{callbacks++;error=err;ready=value});
assert.equal(returned,undefined);
assert.equal(callbacks,0);
socket.emit('secureConnect');
assert.equal(callbacks,1);
assert.equal(error,null);
assert.equal(ready,socket);
tls.connect=originalConnect;

console.log(JSON.stringify({ok:true,tlsPinBeforeHttp:true,visibleStatus:true,telegramStateRepair:true,vpsInstallerRights:true,nginxDuplicateFix:true}));
