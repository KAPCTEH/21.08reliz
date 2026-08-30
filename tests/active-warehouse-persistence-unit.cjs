'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'justfun-active-warehouse-'));
process.env.LOCALAPPDATA=path.join(temporary,'local');
process.env.PROGRAMDATA=path.join(temporary,'programdata');
process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST=path.join(temporary,'emergency');
process.env.JF_DESKTOP_UNIT_TEST='1';

const electronMock={
  app:{getPath:()=>temporary,setPath(){},requestSingleInstanceLock:()=>true,releaseSingleInstanceLock(){},exit(){}},
  BrowserWindow:class{},ipcMain:{handle(){},on(){}},dialog:{},shell:{},clipboard:{},session:{},Menu:{},
  safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString('utf8')}
};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){if(request==='electron')return electronMock;return originalLoad.call(this,request,parent,isMain)};
const mainPath=path.resolve(__dirname,'../source/application/main.js'),main=require(mainPath);
Module._load=originalLoad;

const jwt=(type,claims)=>{const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return`${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'justfun-license-api',typ:type,exp:Math.floor(Date.now()/1000)+900,...claims})}.signature`};
const auth=(companyId,userId)=>{const claims={sub:userId,cid:companyId,did:'device_test_01',role:'owner',permissions:['*'],user_status:'active',company_status:'active',auth_context_version:2};return main.normalizeCloudAuthState({
  access_token:jwt('access',claims),offline_token:jwt('offline',claims),
  company:{id:companyId,code:'TEST',name:'Test',status:'active'},
  user:{id:userId,full_name:'Test User',login:userId,role:'owner',permissions:['*'],status:'active'},
  device_id:'device_test_01',auth_context_version:2
})};
const owner=auth('cmp_active_warehouse_01','usr_active_owner_01');
const colleague=auth('cmp_active_warehouse_01','usr_active_colleague_01');
const foreign=auth('cmp_active_warehouse_02','usr_active_owner_01');
const w1={id:'warehouse-w1',name:'W1',status:'active'},w2={id:'warehouse-w2',name:'W2',status:'active'};

assert.equal(main.readConfirmedActiveWarehousePreference(owner,'live'),'');
assert.equal(main.persistConfirmedActiveWarehousePreference(w2.id,owner,'live'),w2.id);
assert.equal(main.readConfirmedActiveWarehousePreference(owner,'live'),w2.id);
assert.equal(main.readConfirmedActiveWarehousePreference(colleague,'live'),'','another user must not inherit the owner selection');
assert.equal(main.readConfirmedActiveWarehousePreference(foreign,'live'),'','another company must not inherit the selection');
assert.equal(main.readConfirmedActiveWarehousePreference(owner,'demo'),'','LIVE and DEMO selections must remain separate');

const allowed=main.resolveAllowedActiveWarehousePreference([w1,w2],owner,'live','');
assert.equal(allowed.preferredWarehouseId,w2.id);
assert.deepEqual(allowed.warehouses.map(item=>item.id),[w1.id,w2.id],'the native preference must not silently reorder the server registry');
const revoked=main.resolveAllowedActiveWarehousePreference([w1],owner,'live','');
assert.equal(revoked.preferredWarehouseId,'','a revoked warehouse must never be restored from disk');
assert.deepEqual(revoked.warehouses.map(item=>item.id),[w1.id]);

main.rememberConfirmedWarehouseRegistry([w1],owner,'live');
assert.equal(main.persistRendererWarehousePreferenceIfConfirmed(w2.id,owner,'live'),false,'an unconfirmed renderer id must not reach durable storage');
assert.equal(main.persistRendererWarehousePreferenceIfConfirmed(w1.id,colleague,'live'),false,'a registry cache from another user must not authorize persistence');
assert.equal(main.persistRendererWarehousePreferenceIfConfirmed(w1.id,owner,'live'),true);
assert.equal(main.readConfirmedActiveWarehousePreference(owner,'live'),w1.id);

const source=fs.readFileSync(mainPath,'utf8'),preload=fs.readFileSync(path.resolve(__dirname,'../source/application/preload.js'),'utf8');
assert.doesNotMatch(source,/jf-active-warehouse-id|bootstrapActiveWarehouseId/,'the fallback must travel through the explicit trusted registry response, not an unused renderer argument');
assert.doesNotMatch(preload,/bootstrapActiveWarehouseId/);
assert.match(source,/preferredWarehouseId:preferred\.preferredWarehouseId/);
assert.doesNotMatch(source,/localStorage/,'the main-process fallback must not depend on Chromium Local Storage');

const contextPath=path.join(process.env.LOCALAPPDATA,'JustFun','OrdersLogistics','active-warehouse-context-v784.json');
fs.rmSync(contextPath,{force:true});
fs.mkdirSync(contextPath,{recursive:true});
assert.equal(main.persistConfirmedActiveWarehousePreference(w1.id,owner,'live'),false,'an unwritable preference target must be best-effort');
assert.equal(main.persistRendererWarehousePreferenceIfConfirmed(w1.id,owner,'live'),false,'renderer confirmation must remain non-fatal when the preference cannot be written');
assert.equal(main.readConfirmedActiveWarehousePreference(owner,'live'),'','an unreadable preference must fall back to no native selection');

console.log('Active warehouse persistence unit tests: PASS');
