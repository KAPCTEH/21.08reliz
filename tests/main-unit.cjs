'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const release = require('../source/application/release.json');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-main-unit-'));
process.env.LOCALAPPDATA = path.join(temporary, 'local');
process.env.PROGRAMDATA = path.join(temporary, 'programdata');
process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST = path.join(temporary, 'emergency');
process.env.JF_DESKTOP_UNIT_TEST = '1';

let singleInstanceAvailable = true;
let singleInstanceReleaseCount = 0;
let singleInstanceRequest = null;
let appExitCode = null;
const app = {
  getPath(name) {
    const locations = {
      userData: path.join(temporary, 'userdata'),
      documents: path.join(temporary, 'documents'),
    };
    return locations[name] || temporary;
  },
  setPath() {},
  requestSingleInstanceLock(data) { singleInstanceRequest = data; return singleInstanceAvailable; },
  releaseSingleInstanceLock() { singleInstanceReleaseCount += 1; },
  exit(code) { appExitCode = code; },
};
const electronMock = {
  app,
  BrowserWindow: class {},
  ipcMain: { handle() {}, on() {} },
  dialog: {},
  shell: {},
  clipboard: {},
  session: {},
  Menu: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value),
    decryptString: value => Buffer.from(value).toString('utf8'),
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

const mainPath = path.resolve(__dirname, '../source/application/main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const main = require(mainPath);
Module._load = originalLoad;

const primaryLog = path.join(process.env.LOCALAPPDATA, 'JustFun', 'OrdersLogistics', 'logs', 'desktop.log');
const emergencyLog = path.join(process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST, 'desktop-emergency.log');
const logWrite = main.appendLog('main unit log routing');
assert.equal(logWrite.ok, true);
assert.deepEqual(logWrite.files, [primaryLog]);
assert.equal(fs.existsSync(primaryLog), true);
assert.equal(fs.existsSync(emergencyLog), false);
assert.equal(main.logCandidates().includes(path.join(path.dirname(process.execPath), 'logs', 'desktop.log')), false);
const backupRoot=path.join(temporary,'backup-root'),backup=main.saveBackupPayload({backup:{version:'7.8.3',data:{orders:[{id:'order-1'}]}},fileName:'MAIN_WORK_backup.json',kind:'manual'},backupRoot);
assert.equal(backup.ok,true);
assert.equal(backup.kind,'manual');
assert.match(backup.sha256,/^[a-f0-9]{64}$/);
assert.deepEqual(JSON.parse(fs.readFileSync(backup.path,'utf8')).data.orders,[{id:'order-1'}]);
assert.throws(()=>main.saveBackupPayload({backup:null},backupRoot),/Резервная копия/);
const safeAudit=main.safeRendererAuditPayload({correlationId:'audit-123',action:'business_mutation_confirmed',warehouseId:'warehouse-1',environment:'live',detail:{kind:'order_payment',targetId:'order-1',commandId:'command-1',changes:1,critical:false,password:'secret',message:'personal data'}});
assert.deepEqual(safeAudit,{correlationId:'audit-123',action:'business_mutation_confirmed',warehouseId:'warehouse-1',environment:'live',detail:{kind:'order_payment',targetId:'order-1',commandId:'command-1',changes:1,critical:false}});
assert.equal(JSON.stringify(safeAudit).includes('secret'),false);
assert.equal(JSON.stringify(safeAudit).includes('personal'),false);

assert.equal(main.VERSION, release.version);
assert.match(mainSource, /directOpenStreetMapGeocode/);
assert.match(mainSource, /directOpenStreetMapRoute/);
assert.ok(mainSource.indexOf("try{const data=await directOpenStreetMapGeocode(payload)") < mainSource.indexOf("regApiRequest('POST','\/v1\/maps\/geocode'"));
assert.match(mainSource, /telegram_services:services/);
assert.equal(main.STARTUP_TIMEOUT_MS, 30000);
assert.equal(main.RENDERER_READY_TIMEOUT_MS, 90000);
const startupLoading=main.transitionRendererStartupState(null,'begin');
const startupRecovery=main.transitionRendererStartupState(startupLoading,'load-timeout',{reason:'30 seconds'});
const startupReady=main.transitionRendererStartupState(startupRecovery,'renderer-ready',{surface:'workspace-cloud'});
assert.equal(startupLoading.phase,'loading');
assert.equal(startupRecovery.phase,'recovery');
assert.equal(startupReady.phase,'ready');
assert.equal(startupReady.readyPayload.surface,'workspace-cloud');
assert.strictEqual(main.transitionRendererStartupState(startupReady,'load-timeout',{reason:'stale timeout'}),startupReady,'a stale timeout must not hide a renderer that is already ready');
const startupClosed=main.transitionRendererStartupState(startupRecovery,'window-closed');
assert.equal(main.transitionRendererStartupState(startupClosed,'renderer-ready',{surface:'stale'}).phase,'closed','a late event from a closed window must be ignored');
const startupFailed=main.transitionRendererStartupState(startupRecovery,'startup-failed',{reason:'ready timeout'});
assert.equal(startupFailed.phase,'failed');
assert.strictEqual(main.transitionRendererStartupState(startupFailed,'renderer-ready',{surface:'late'}),startupFailed,'a late ready event must not revive a terminal startup failure');
let startupShowCalls=0,startupFocusCalls=0,startupCloseCalls=0;
assert.deepEqual(main.revealRendererStartupWindows({isDestroyed:()=>false,show:()=>{startupShowCalls++},focus:()=>{startupFocusCalls++}},{isDestroyed:()=>false,close:()=>{startupCloseCalls++}}),{shown:true,splashClosed:true});
assert.deepEqual({startupShowCalls,startupFocusCalls,startupCloseCalls},{startupShowCalls:1,startupFocusCalls:1,startupCloseCalls:1});
let guardedShowCalls=0,guardedFocusCalls=0,guardedSplashCloseCalls=0;
const startupTarget={isDestroyed:()=>false,show:()=>{guardedShowCalls++},focus:()=>{guardedFocusCalls++}};
const startupSplash={isDestroyed:()=>false,close:()=>{guardedSplashCloseCalls++}};
const blockedLateReady=main.finalizeRendererStartupReady(startupFailed,{surface:'late'},startupTarget,startupSplash);
assert.equal(blockedLateReady.shown,false);
assert.deepEqual({guardedShowCalls,guardedFocusCalls,guardedSplashCloseCalls},{guardedShowCalls:0,guardedFocusCalls:0,guardedSplashCloseCalls:0},'terminal failure must block every window reveal side effect');
const firstReady=main.finalizeRendererStartupReady(startupRecovery,{surface:'workspace-cloud'},startupTarget,startupSplash);
const repeatedReady=main.finalizeRendererStartupReady(firstReady.state,{surface:'workspace-cloud'},startupTarget,startupSplash);
assert.equal(firstReady.shown,true);
assert.equal(repeatedReady.alreadyReady,true);
assert.deepEqual({guardedShowCalls,guardedFocusCalls,guardedSplashCloseCalls},{guardedShowCalls:1,guardedFocusCalls:1,guardedSplashCloseCalls:1},'repeated renderer-ready must reveal the windows exactly once');
assert.equal(main.appRendererUrl('web/index.html'), 'justfun://app/web/index.html');
assert.equal(main.isTrustedAppUrl('justfun://app/web/index.html'), true);
assert.equal(main.isTrustedAppUrl('justfun://evil/web/index.html'), false);
assert.match(main.resolveAppRendererPath('justfun://app/web/index.html'), /web[\\/]index\.html$/);
assert.throws(() => main.resolveAppRendererPath('justfun://app/%2e%2e/main.js'));
assert.throws(() => main.resolveAppRendererPath('justfun://app/web/%2e%2e/%2e%2e/secret.txt'));
singleInstanceAvailable = true;
const probeOutput = path.join(temporary, 'running-instance-probe.txt');
assert.equal(main.runRunningInstanceProbe(probeOutput), 0);
assert.deepEqual(singleInstanceRequest, { mode: 'running-instance-probe' });
assert.equal(singleInstanceReleaseCount, 1);
assert.equal(appExitCode, 0);
assert.equal(fs.readFileSync(probeOutput, 'ascii'), 'NOT_RUNNING');
singleInstanceAvailable = false;
singleInstanceReleaseCount = 0;
appExitCode = null;
assert.equal(main.runRunningInstanceProbe(probeOutput), 30);
assert.equal(singleInstanceReleaseCount, 0);
assert.equal(appExitCode, 30);
assert.equal(fs.readFileSync(probeOutput, 'ascii'), 'RUNNING');
assert.equal(mainSource.includes('if (!DESKTOP_UNIT_TEST_MODE) process.exit(exitCode)'), true);
assert.match(main.getMachineCode(), /^JF75-(?:[A-Z0-9_-]{5}-){4}[A-Z0-9_-]{5}$/);
assert.equal(main.validateWarehouseId('warehouse_01'), 'warehouse_01');
assert.throws(() => main.validateWarehouseId('../warehouse'));
assert.equal(main.validateEnvironment('LIVE'), 'live');
assert.throws(() => main.validateEnvironment('staging'));
const telegramScopeMsk = main.telegramScopeParts('cmp_one', 'warehouse_msk', 'live');
const telegramScopeSpb = main.telegramScopeParts('cmp_one', 'warehouse_spb', 'live');
const telegramScopeOtherCompany = main.telegramScopeParts('cmp_two', 'warehouse_msk', 'live');
assert.notEqual(main.telegramScopeRoot(telegramScopeMsk), main.telegramScopeRoot(telegramScopeSpb));
assert.notEqual(main.telegramScopeRoot(telegramScopeMsk), main.telegramScopeRoot(telegramScopeOtherCompany));
assert.match(main.telegramScopeRoot(telegramScopeMsk), /company-cmp_one[\\/]warehouse-live-warehouse_msk$/);
assert.throws(() => main.telegramScopeParts('', 'warehouse_msk', 'live'), /определить компанию/);
assert.throws(
  () => main.validateDeliveredTelegramNotification({ ok: true, notification: { status: 'sent' } }),
  error => error.code === 'TELEGRAM_DELIVERY_NOT_CONFIRMED',
);
assert.equal(main.validateDeliveredTelegramNotification({
  ok: true,
  notification: { id: 'nt_12345678', message_id: 42, status: 'sent' },
}).message_id, 42);
assert.equal(main.normalizeFingerprint('AA:BB:CC'), 'AABBCC');
assert.doesNotThrow(() => main.validateSnapshotEntityIdentifiers({
  orders: [{ id: 'order_safe_1', items: [{ productId: 'product_safe_1' }], childOrderIds: ['order_safe_2'] }],
  routeCatalog: { route_safe_1: { id: 'route_safe_1' } },
}));
assert.throws(
  () => main.validateSnapshotEntityIdentifiers({ orders: [{ id: "order');globalThis.pwned=true;//" }] }),
  /небезопасный идентификатор/,
);

const config = main.readInstallConfig();
assert.equal(config.app_version, release.version);
assert.equal(config.mode, 'demo');
assert.ok(path.isAbsolute(config.data_dir));
main.persistInstallConfig({ ...config, mode: 'full' });
assert.equal(main.readInstallConfig().mode, 'full');
const nativeConfigPath = path.join(process.env.LOCALAPPDATA, 'JustFun', 'OrdersLogistics', 'install.json');
const nativeConfig = JSON.stringify({ ...config, mode: 'demo', data_dir: path.join(temporary, 'native-data') });
fs.writeFileSync(nativeConfigPath, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(nativeConfig, 'utf16le')]));
assert.equal(main.readInstallConfig().mode, 'demo');
assert.equal(main.readInstallConfig().data_dir, path.join(temporary, 'native-data'));

const dataDir = path.join(temporary, 'data');
const state = main.normalizeDemoState(dataDir);
assert.equal(main.validSignedObject(state.state), true);
assert.ok(main.remainingDemoMs(state.state) > 71 * 60 * 60 * 1000);
assert.ok(main.remainingDemoMs(state.state) <= main.DEMO_DURATION_MS);

// DEMO anchors must merge conservatively: earliest start/expiry and latest
// observation win, so reinstalling into a different data folder or rolling the
// clock back cannot extend the trial.
const demoNow = Date.now();
const signedDemo = (started, expires, seen) => {
  const base = {
    schema: main.DEMO_SCHEMA,
    machine_code: main.getMachineCode(),
    first_started_at: new Date(started).toISOString(),
    expires_at: new Date(expires).toISOString(),
    last_seen_at: new Date(seen).toISOString(),
    version_created: main.VERSION,
  };
  return { ...base, signature: main.signObject(base) };
};
const demoPaths = main.demoLocations(dataDir);
const older = signedDemo(demoNow - 60_000, demoNow + 60 * 60_000, demoNow - 30_000);
const newer = signedDemo(demoNow, demoNow + 72 * 60 * 60_000, demoNow + 10_000);
fs.mkdirSync(path.dirname(demoPaths[0]), { recursive: true });
fs.writeFileSync(demoPaths[0], JSON.stringify(newer), 'utf8');
fs.mkdirSync(path.dirname(demoPaths[1]), { recursive: true });
fs.writeFileSync(demoPaths[1], JSON.stringify(older), 'utf8');
const mergedDemo = main.normalizeDemoState(dataDir);
assert.equal(Date.parse(mergedDemo.state.first_started_at), demoNow - 60_000);
assert.equal(Date.parse(mergedDemo.state.expires_at), demoNow + 60 * 60_000);
assert.equal(Date.parse(mergedDemo.state.last_seen_at), demoNow + 10_000);
assert.equal(main.validSignedObject(mergedDemo.state), true);

// Present but corrupted current anchors fail closed while offline. A valid
// Cloudflare answer can repair that state without creating a second trial.
for (const demoPath of demoPaths) {
  fs.mkdirSync(path.dirname(demoPath), { recursive: true });
  fs.writeFileSync(demoPath, '{"corrupted":true}', 'utf8');
}
const corruptedDemo = main.normalizeDemoState(dataDir);
assert.equal(corruptedDemo.recovery, true);
assert.equal(main.remainingDemoMs(corruptedDemo.state), 0);
const serverExpiry = demoNow + 40 * 60_000;
const recoveredDemo = main.reconcileDemoStateWithCloud(corruptedDemo.state, {
  first_started_at: new Date(demoNow - 30 * 60_000).toISOString(),
  expires_at: new Date(serverExpiry).toISOString(),
  server_time: new Date(demoNow).toISOString(),
}, { recovery: true });
assert.equal(Date.parse(recoveredDemo.expires_at), serverExpiry);
assert.equal(main.validSignedObject(recoveredDemo), true);

// A late first connection to Cloudflare must not turn 72 offline hours into a
// second 72-hour window. The earlier trustworthy expiry always wins.
const localWindow = signedDemo(demoNow, demoNow + 60 * 60_000, demoNow);
const noExtension = main.reconcileDemoStateWithCloud(localWindow, {
  first_started_at: new Date(demoNow + 30 * 60_000).toISOString(),
  expires_at: new Date(demoNow + 72 * 60 * 60_000).toISOString(),
  server_time: new Date(demoNow + 30 * 60_000).toISOString(),
});
assert.equal(Date.parse(noExtension.expires_at), demoNow + 60 * 60_000);
assert.equal(main.validSignedObject(noExtension), true);
const earlierServerExpiry = main.reconcileDemoStateWithCloud(localWindow, {
  first_started_at: new Date(demoNow - 10 * 60_000).toISOString(),
  expires_at: new Date(demoNow + 20 * 60_000).toISOString(),
  server_time: new Date(demoNow + 5 * 60_000).toISOString(),
});
assert.equal(Date.parse(earlierServerExpiry.expires_at), demoNow + 20 * 60_000);

// Persisting a reconciled state must update the in-memory signature too.
const mutableDemo = { ...localWindow, expires_at: new Date(demoNow + 15 * 60_000).toISOString() };
main.persistDemoState(dataDir, mutableDemo);
assert.equal(main.validSignedObject(mutableDemo), true);



const jwt = claims => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'justfun-license-api',typ:'access',exp:Math.floor(Date.now()/1000)+900,...claims})}.signature`;
};
const oldServerResult = {
  access_token: jwt({sub:'usr_owner_1234567890',cid:'cmp_company_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*'],user_status:'active',company_status:'active',auth_context_version:2}),
  offline_token: jwt({typ:'offline',sub:'usr_owner_1234567890',cid:'cmp_company_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*'],user_status:'active',company_status:'active',auth_context_version:2}),
  refresh_token: 'refresh-token',
  user_id: 'usr_owner_1234567890',
  company_id: 'cmp_company_1234567890',
  device_id: 'dev_pc_1234567890',
  role: 'owner',
  permissions: ['*'],
  auth_context_version: 2,
  session_binding_contract: 0,
  user: {id:'usr_owner_1234567890',full_name:'Владелец',login:'admin',role:'owner',permissions:['*'],status:'active'},
  company: {id:'cmp_company_1234567890',code:'JFWD4H54',name:'Компания',status:'active'}
};
const repaired = main.saveCloudSession(oldServerResult);
assert.equal(repaired.company.id,'cmp_company_1234567890');
assert.equal(repaired.user.id,'usr_owner_1234567890');
assert.equal(repaired.device_id,'dev_pc_1234567890');
assert.equal(repaired.user.role,'owner');
assert.equal(main.publicCloudAuth(repaired).company.id,'cmp_company_1234567890');
assert.equal(main.cloudSessionComplete(repaired),true);
assert.equal(main.companyWorkspaceId(repaired),'cmp_company_1234567890');
const reorderedOwnerPermissions={...repaired,auth_context_verified:true,user:{...repaired.user,permissions:['inventory.read','orders.read']},permissions:['inventory.read','orders.read']};
const sameReorderedOwnerPermissions={...reorderedOwnerPermissions,user:{...reorderedOwnerPermissions.user,permissions:['orders.read','inventory.read']},permissions:['orders.read','inventory.read']};
const reducedOwnerPermissions={...reorderedOwnerPermissions,user:{...reorderedOwnerPermissions.user,permissions:['orders.read']},permissions:['orders.read']};
assert.equal(main.cloudAuthorizationSignature(reorderedOwnerPermissions),main.cloudAuthorizationSignature(sameReorderedOwnerPermissions));
assert.notEqual(main.cloudAuthorizationSignature(reorderedOwnerPermissions),main.cloudAuthorizationSignature(reducedOwnerPermissions));
const nativeSecretPath=path.join(main.localRoot(),'integrations','native-secrets.json');
const protectedSessionBefore=fs.readFileSync(nativeSecretPath);
const originalDecryptString=electronMock.safeStorage.decryptString;
let failDecryptOnce=true;
electronMock.safeStorage.decryptString=value=>{if(failDecryptOnce){failDecryptOnce=false;const error=new Error('temporary DPAPI failure');error.code='DPAPI_TEMPORARY';throw error}return originalDecryptString(value)};
assert.equal(main.readCloudAuthState(),null,'a temporary decrypt failure must request a normal login');
assert.equal(fs.readFileSync(nativeSecretPath).equals(protectedSessionBefore),true,'temporary decrypt failure must preserve encrypted session bytes');
electronMock.safeStorage.decryptString=originalDecryptString;
assert.equal(main.readCloudAuthState().company.id,'cmp_company_1234567890','the same encrypted session must be readable after DPAPI recovers');
assert.equal(main.canConfigureCompanyServer(repaired),true);
assert.equal(main.canConfigureCompanyServer({user:{role:'manager',permissions:['integrations.manage']}}),true);
assert.equal(main.canConfigureCompanyServer({user:{role:'manager',permissions:['users.read']}}),false);
assert.equal(main.canManageCompanyWarehouses(repaired),true);
assert.equal(main.canManageCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage']}}),true);
assert.equal(main.canManageCompanyWarehouses({user:{role:'manager',permissions:['warehouses.*']}}),true);
assert.equal(main.canManageCompanyWarehouses({user:{role:'manager',permissions:['integrations.manage']}}),false);
assert.equal(main.canManageCompanyWarehouses({user:{role:'manager',permissions:['company.update']}}),false);
assert.equal(main.canManageCompanyWarehouses({user:{role:'manager',permissions:['users.read']}}),false);
assert.equal(main.canCreateCompanyWarehouses(repaired),true);
assert.equal(main.canCreateCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage','jf.warehouse:*']}}),true);
assert.equal(main.canCreateCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage','jf.warehouse:warehouse_1234567890']}}),false);
assert.equal(main.canCreateCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage']}}),false);
assert.equal(main.canImportLocalMigration({user:{role:'owner',permissions:['*']}}),true);
assert.equal(main.canImportLocalMigration({user:{role:'owner',permissions:['warehouses.manage','jf.warehouse:*']}}),true);
assert.equal(main.canImportLocalMigration({user:{role:'manager',permissions:['*']}}),false);
assert.equal(main.canImportLocalMigration({user:{role:'owner',permissions:['warehouses.manage']}}),false);
const migrationWarehouse='warehouse_1234567890',migrationChanges=[
  {type:'routeExecutions',id:'route-1',baseVersion:0,deleted:false,payload:{id:'route-1',warehouseId:migrationWarehouse}},
  {type:'routeArchives',id:'archive-1',baseVersion:0,deleted:false,payload:{id:'archive-1',warehouseId:migrationWarehouse}},
  {type:'warehouseReservations',id:'reservation-1',baseVersion:0,deleted:false,payload:{id:'reservation-1',warehouseId:migrationWarehouse}},
],migrationPayload={
  commandId:'client:migrate-v783:entities:warehouse_1234567890:0',
  changes:migrationChanges,
  intent:{kind:'local_migration_import',targetId:migrationWarehouse,snapshotFingerprint:'1a2b3c:4d5e6f:12345',chunkIndex:0,chunkCount:1},
};
const migrationBatch=main.validateRegEntityBatch(migrationPayload,migrationWarehouse,'live');
assert.deepEqual(migrationBatch.intent,{kind:'local_migration_import',target_id:migrationWarehouse,metadata:{snapshot_fingerprint:'1a2b3c:4d5e6f:12345',chunk_index:0,chunk_count:1}});
assert.deepEqual(migrationBatch.changes.map(item=>item.type),['routeExecutions','routeArchives','warehouseReservations']);
const migrationAck=migrationBatch.changes.map((item,index)=>({type:item.type,id:item.id,version:1,eventId:index+1,digest:'a'.repeat(64),deleted:false,unchanged:false}));
assert.equal(main.validateRegEntityBatchAck(migrationAck,3,migrationBatch),true);
assert.throws(()=>main.validateRegEntityBatchAck(migrationAck.slice(0,2),3,migrationBatch),error=>error.code==='REG_ENTITY_ACK_INCOMPLETE');
assert.throws(()=>main.validateRegEntityBatchAck(migrationAck.map((item,index)=>index?item:{...item,version:2}),3,migrationBatch),error=>error.code==='REG_ENTITY_ACK_INVALID');
assert.throws(()=>main.validateRegEntityBatchAck(migrationAck.map((item,index)=>index?item:{...item,digest:'bad'}),3,migrationBatch),error=>error.code==='REG_ENTITY_ACK_INVALID');
assert.throws(()=>main.validateRegEntityBatchAck(migrationAck,2,migrationBatch),error=>error.code==='REG_ENTITY_ACK_INCOMPLETE');
assert.deepEqual(main.regWriteFailureContract(Object.assign(new Error('permission denied'),{code:'warehouse_access_denied'}),{requestAttempted:false}),{writeOutcome:'definitive_rejection',failureOrigin:'client_preflight',retrySameCommand:false});
assert.deepEqual(main.regWriteFailureContract(Object.assign(new Error('version conflict'),{code:'entity_version_conflict',status:409}),{requestAttempted:true}),{writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false});
assert.deepEqual(main.regWriteFailureContract(Object.assign(new Error('lost response'),{code:'NETWORK_TIMEOUT'}),{requestAttempted:true}),{writeOutcome:'uncertain',failureOrigin:'transport_or_response',retrySameCommand:true});
assert.deepEqual(main.regWriteFailureContract(Object.assign(new Error('malformed acknowledgement'),{code:'REG_ENTITY_ACK_INVALID',regWritePhase:'ack_validation'}),{requestAttempted:true}),{writeOutcome:'uncertain',failureOrigin:'ack_validation',retrySameCommand:true});
assert.throws(()=>main.validateRegEntityBatch({...migrationPayload,intent:{...migrationPayload.intent,targetId:'warehouse_other'}},migrationWarehouse,'live'),error=>error.code==='LOCAL_MIGRATION_METADATA_INVALID');
assert.throws(()=>main.validateRegEntityBatch({...migrationPayload,intent:{...migrationPayload.intent,snapshotFingerprint:'INVALID'}},migrationWarehouse,'live'),error=>error.code==='LOCAL_MIGRATION_METADATA_INVALID');
assert.throws(()=>main.validateRegEntityBatch({...migrationPayload,intent:{...migrationPayload.intent,chunkIndex:1}},migrationWarehouse,'live'),error=>error.code==='LOCAL_MIGRATION_METADATA_INVALID');
assert.throws(()=>main.validateRegEntityBatch(migrationPayload,migrationWarehouse,'demo'),error=>error.code==='LOCAL_MIGRATION_METADATA_INVALID');
assert.throws(()=>main.validateRegEntityBatch({...migrationPayload,changes:[{...migrationChanges[0],baseVersion:1}]},migrationWarehouse,'live'),error=>error.code==='LOCAL_MIGRATION_METADATA_INVALID');
assert.equal(main.canDeleteCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage','jf.warehouse:*']}}),true);
assert.equal(main.canDeleteCompanyWarehouses({user:{role:'manager',permissions:['warehouses.manage','jf.warehouse:warehouse_1234567890']}}),false);
assert.equal(main.validateWarehouseCode('СПБ'),'СПБ');
assert.throws(()=>main.validateWarehouseCode('spb'),error=>error?.code==='WAREHOUSE_CODE_INVALID');
const validDeleteLease={ok:true,active:true,prepared:false,status:'active',lease:{id:'wdl_1234567890abcdef',company_id:'cmp_company_1234567890',warehouse_id:'warehouse_1234567890',warehouse_code:'СПБ',status:'active',expires_at:new Date(Date.now()+120_000).toISOString()},lease_token:`jfdl_${'a'.repeat(43)}`,remaining_seconds:120};
assert.equal(main.validateWarehouseDeleteLease(validDeleteLease,'warehouse_1234567890','СПБ',repaired).token,validDeleteLease.lease_token);
const recoveredPreparedDeleteLease={...validDeleteLease,prepared:true,status:'prepared',recovered:true,lease:{...validDeleteLease.lease,status:'prepared',expires_at:null},remaining_seconds:null};
assert.deepEqual(main.validateWarehouseDeleteLease(recoveredPreparedDeleteLease,'warehouse_1234567890','СПБ',repaired),{token:validDeleteLease.lease_token,leaseId:'wdl_1234567890abcdef',expiresAt:null,remainingSeconds:null,status:'prepared',prepared:true});
assert.throws(()=>main.validateWarehouseDeleteLease({...recoveredPreparedDeleteLease,remaining_seconds:0},'warehouse_1234567890','СПБ',repaired),error=>error?.code==='WAREHOUSE_DELETE_LEASE_INVALID');
assert.throws(()=>main.validateWarehouseDeleteLease({...validDeleteLease,lease:{...validDeleteLease.lease,company_id:'cmp_other_1234567890'}},'warehouse_1234567890','СПБ',repaired),error=>error?.code==='WAREHOUSE_DELETE_LEASE_INVALID');
assert.throws(()=>main.validateWarehouseDeleteLease({...validDeleteLease,remaining_seconds:10},'warehouse_1234567890','СПБ',repaired),error=>error?.code==='WAREHOUSE_DELETE_LEASE_INVALID');
assert.match(main.warehouseDeleteLeaseSecretName('cmp_company_1234567890','warehouse_1234567890','usr_owner_1234567890'),/^warehouseDeleteLease:[0-9a-f]{32}$/);
assert.notEqual(main.warehouseDeleteLeaseSecretName('cmp_company_1234567890','warehouse_1234567890','usr_owner_1234567890'),main.warehouseDeleteLeaseSecretName('cmp_company_1234567890','warehouse_1234567890','usr_other_1234567890'));
assert.equal(main.warehouseDeletePrepareFailureAction('WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED','confirmed'),'reacquire');
assert.equal(main.warehouseDeletePrepareFailureAction('WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED','vps_prepared'),'superseded');
assert.equal(main.warehouseDeletePrepareFailureAction('warehouse_delete_lease_superseded','confirmed'),'superseded');
assert.equal(main.warehouseDeletePrepareFailureAction('entity_version_conflict','confirmed'),'propagate');
assert.equal(main.regVpsAttestationSecretName('cmp_company_1234567890'),'regVpsAttestation:cmp_company_1234567890');
assert.equal(main.regWarehouseDeletePreparePath({workspace_id:'cmp_company_1234567890'},'warehouse_1234567890'),'/v1/workspaces/cmp_company_1234567890/warehouses/warehouse_1234567890/delete-prepare');
const validTelegramDeprovision={ok:true,deprovisioned:true,company_id:'cmp_company_1234567890',warehouse_id:'warehouse_1234567890',installation_id:'tg_installation_1234567890',already_deprovisioned:false};
assert.equal(main.validateTelegramDeprovisionResult(validTelegramDeprovision,'warehouse_1234567890',{installationId:'tg_installation_1234567890'}).installationId,'tg_installation_1234567890');
assert.throws(()=>main.validateTelegramDeprovisionResult({...validTelegramDeprovision,warehouse_id:'warehouse_other_1234567890'},'warehouse_1234567890'),error=>error?.code==='TELEGRAM_DEPROVISION_UNCONFIRMED');
assert.throws(()=>main.validateTelegramDeprovisionResult({...validTelegramDeprovision,installation_id:'tg_other_1234567890'},'warehouse_1234567890',{installationId:'tg_installation_1234567890'}),error=>error?.code==='TELEGRAM_DEPROVISION_UNCONFIRMED');
assert.throws(()=>main.validateTelegramDeprovisionResult({...validTelegramDeprovision,company_id:'cmp_other_1234567890'},'warehouse_1234567890',{expectedCompanyId:'cmp_company_1234567890'}),error=>error?.code==='TELEGRAM_DEPROVISION_UNCONFIRMED');
const proofBoundTelegramDeprovision={...validTelegramDeprovision,warehouse_code:'СПБ',delete_command_id:'client:test:warehouse:delete:proof',delete_base_version:2};
assert.equal(main.validateTelegramDeprovisionResult(proofBoundTelegramDeprovision,'warehouse_1234567890',{expectedWarehouseCode:'СПБ',expectedDeleteCommandId:'client:test:warehouse:delete:proof',expectedDeleteBaseVersion:2}).warehouseId,'warehouse_1234567890');
assert.throws(()=>main.validateTelegramDeprovisionResult({...proofBoundTelegramDeprovision,delete_base_version:3},'warehouse_1234567890',{expectedWarehouseCode:'СПБ',expectedDeleteCommandId:'client:test:warehouse:delete:proof',expectedDeleteBaseVersion:2}),error=>error?.code==='TELEGRAM_DEPROVISION_UNCONFIRMED');
const storedDeleteBatch=main.normalizeWarehouseDeleteBatch({command_id:'client:test:warehouse:delete:journal',changes:[{type:'warehouse',id:'warehouse_1234567890',base_version:2,deleted:true,payload:null}],intent:null},'warehouse_1234567890');
assert.equal(storedDeleteBatch.command_id,'client:test:warehouse:delete:journal');
assert.equal(storedDeleteBatch.changes[0].base_version,2);
assert.equal(storedDeleteBatch.changes[0].deleted,true);
assert.equal(main.normalizeCloudUser({id:'usr_custom_role_1234',role:'Старший кладовщик',permissions:['inventory.read']},{},{},{auth_context_verified:true,user_id:'usr_custom_role_1234'}).role,'Старший кладовщик');
assert.equal(main.regDiagnosticStage({code:'ENOTFOUND'}),'dns');
assert.equal(main.regDiagnosticStage({code:'ECONNRESET'}),'connection');
assert.equal(main.regDiagnosticStage({code:'TLS_PIN_MISMATCH'}),'tls');
assert.equal(main.regDiagnosticStage({code:'HTTP_401'}),'authorization');
assert.equal(main.regDiagnosticStage({code:'DATABASE_NOT_READY'}),'database');
assert.equal(main.selectRegState(repaired,{workspace_id:'cmp_foreign_1234567890',address:'203.0.113.1'},'full'),null);
assert.equal(main.selectRegState(repaired,{workspace_id:'cmp_company_1234567890',address:'203.0.113.1'},'full').address,'203.0.113.1');
assert.notEqual(main.regStatePath('cmp_company_1234567890'),main.regStatePath('cmp_foreign_1234567890'));
fs.mkdirSync(path.dirname(main.regStatePath()),{recursive:true});
fs.writeFileSync(main.regStatePath(),JSON.stringify({workspace_id:'cmp_company_1234567890',address:'203.0.113.1'}),'utf8');
assert.equal(main.readLocalRegState(repaired,'full').workspace_id,'cmp_company_1234567890');
assert.equal(fs.existsSync(main.regStatePath('cmp_company_1234567890')),true);
assert.equal(main.regApiSecretName('cmp_company_1234567890'),'regApiKey:cmp_company_1234567890');
assert.throws(()=>main.normalizeCloudAuthState({...repaired,company:{...repaired.company,id:'cmp_other_1234567890'}}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
assert.throws(()=>main.normalizeCloudAuthState({...repaired,offline_token:jwt({typ:'offline',sub:'usr_owner_1234567890',cid:'cmp_other_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*']})}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
assert.throws(()=>main.normalizeCloudAuthState({...repaired,auth_context_verified:false,role:'admin',user:{...repaired.user,role:'admin'}}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
assert.throws(()=>main.normalizeCloudAuthState({...repaired,auth_context_verified:false,permissions:['orders.read'],user:{...repaired.user,permissions:['orders.read']}}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
const invalidIssuer=jwt({iss:'other-server',sub:'usr_owner_1234567890',cid:'cmp_company_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*']});
assert.throws(()=>main.normalizeCloudAuthState({...repaired,access_token:invalidIssuer}),error=>error?.code==='AUTH_TOKEN_INVALID');

const source = fs.readFileSync(mainPath, 'utf8');
assert.equal(source.includes("return {edition:'full', authorized:Boolean(cloudAuth)"), true);
assert.equal(source.includes('activation.html'), false);
assert.equal(source.includes('activation-preload.js'), false);
assert.equal(source.includes('verifyLicenseToken'), false);
const registerHandler = source.match(/desktop:auth-register-owner[\s\S]*?desktop:auth-login/)?.[0] || '';
assert.equal(registerHandler.includes('/v1/license/check'), false);
assert.equal(registerHandler.includes('/v1/owner/register'), true);
assert.equal(source.includes('--jf-company-id='), true);
assert.equal(source.includes('/v1/warehouses?environment='), true);
assert.equal(source.includes("typeof result.registry_initialized==='boolean'?result.registry_initialized:null"), true);
assert.equal(source.includes("cloudAuthenticatedRequest('PUT','/v1/company/data-service'"), true);
assert.equal(source.includes('desktop:auth-user-access'), true);
assert.equal((source.match(/cloudRequest\('POST','\/v1\/auth\/refresh'/g)||[]).length,1);
assert.equal(source.includes("handleMainIPC('desktop:auth-refresh-context'"), true);
assert.equal(source.includes('coordinateRendererStartup(mainWindow.loadURL'),true);
assert.equal(source.includes('onLoadTimeout:enterRendererStartupRecovery'),true);
assert.equal(source.includes('const shown=confirmRendererStartupReady(safePayload)'),true);
assert.equal(source.includes("'RENDERER_LOAD_TIMEOUT'"),true);
assert.equal(source.includes("if (response === 2) app.quit();"),true);
assert.equal(source.includes('renderer ready ignored after terminal startup state'),true);
assert.equal(source.includes('/access`'), true);
assert.equal(source.includes("setTimeout(()=>{app.relaunch();app.exit(0)},150)"), true);
assert.equal(source.includes("setTimeout(()=>app.quit(),150)"), true);
let unloadPrevented=0;
const unloadEvent={preventDefault(){unloadPrevented+=1}};
assert.equal(main.allowRendererUnloadAfterAcceptedQuit(unloadEvent,false),false);
assert.equal(unloadPrevented,0,'an ordinary window close must preserve the renderer unload veto');
assert.equal(main.allowRendererUnloadAfterAcceptedQuit(unloadEvent,true),true);
assert.equal(unloadPrevented,1,'an accepted application quit must bypass the renderer unload veto exactly once');
assert.equal(source.includes("mainWindow.webContents.on('will-prevent-unload'"),true);
assert.match(source,/if \(!allowRendererUnloadAfterAcceptedQuit\(event,applicationQuitAccepted\)\) return;/);
const beforeQuitHandler=source.match(/app\.on\('before-quit',[\s\S]*?process\.on\('uncaughtException'/)?.[0]||'';
assert.match(beforeQuitHandler,/if \(controller\.shouldApplyOnClose\(\)\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;[\s\S]*?applicationQuitAccepted=true;/,'accepted-quit flag must be set only after the deferred-update veto branch');
assert.equal(source.includes("appendLog('uncaughtException', diagnosticError(error))"), true);
assert.equal(source.includes("function sendWindowMessage(target,channel,payload)"), true);
assert.equal(source.includes("appendRecurringLog('Telegram event poll failed'"), true);
assert.equal(source.includes("flushRecurringLogs(); appendLog('application exiting')"), true);
assert.match(source, /token=await ensureCloudAccessToken\(authOperation\)/);
assert.equal(main.isRetryableCloudNetworkError({code:'ECONNRESET'}),true);
assert.equal(main.isRetryableCloudNetworkError({code:'INVALID_CREDENTIALS'}),false);
assert.equal(main.isTemporaryCompanyServiceError({code:'TELEGRAM_WORKER_ROUTING_BLOCKED',status:503}),true);
assert.equal(main.telegramCompanyPublishRetryDelay(0),15_000);
assert.equal(main.telegramCompanyPublishRetryDelay(1),30_000);
assert.equal(main.telegramCompanyPublishRetryDelay(99),300_000);
assert.match(main.telegramCompanyPublishPendingMessage('TELEGRAM_WORKER_ROUTING_BLOCKED',true),/1042/);
assert.match(main.telegramCompanyPublishPendingMessage('TELEGRAM_UPSTREAM_INVALID',false),/не запланирован/);
assert.match(main.friendlyCloudNetworkError({code:'ECONNRESET',message:'socket reset'}).message,/сетью или VPN/);

(async()=>{
const startupEvents=[];
const lateReadyPayload={surface:'workspace-cloud',readyState:'complete'};
const coordinatedStartup=await main.coordinateRendererStartup(Promise.resolve(),{then(resolve){startupEvents.push('ready');resolve(lateReadyPayload)}},{
  wait:async(promise,_timeout,_message,code)=>{if(code==='RENDERER_LOAD_TIMEOUT')throw Object.assign(new Error('slow load'),{code});return promise},
  onLoadTimeout:()=>{startupEvents.push('recovery')}
});
assert.equal(coordinatedStartup.recovered,true);
assert.deepEqual(coordinatedStartup.readyPayload,lateReadyPayload);
assert.deepEqual(startupEvents,['recovery','ready'],'late renderer readiness must be consumed after the recoverable 30-second timeout');
await assert.rejects(main.coordinateRendererStartup(Promise.resolve(),Promise.resolve(lateReadyPayload),{
  wait:async(_promise,_timeout,_message,code)=>{if(code==='RENDERER_LOAD_TIMEOUT')throw Object.assign(new Error('load failed'),{code:'ERR_FILE_NOT_FOUND'});return lateReadyPayload},
  onLoadTimeout:()=>{throw new Error('fatal load failure must not enter timeout recovery')}
}),error=>error.code==='ERR_FILE_NOT_FOUND');
let rejectLateLoad;
const lateLoad=new Promise((_,reject)=>{rejectLateLoad=reject});
const lateLoadStartup=main.coordinateRendererStartup(lateLoad,new Promise(()=>{}),{
  wait:async(promise,_timeout,_message,code)=>{if(code==='RENDERER_LOAD_TIMEOUT')throw Object.assign(new Error('slow load'),{code});return promise},
  onLoadTimeout:()=>{}
});
await new Promise(resolve=>setImmediate(resolve));
const lateLoadError=Object.assign(new Error('main frame failed after timeout'),{code:'ERR_FILE_NOT_FOUND'});
rejectLateLoad(lateLoadError);
await assert.rejects(lateLoadStartup,error=>error===lateLoadError,'a real loadURL failure after the recoverable timeout must remain terminal and preserve its exact error');
let rejectWindowClosed;
const windowClosed=new Promise((_,reject)=>{rejectWindowClosed=reject});
const closedStartup=main.coordinateRendererStartup(Promise.resolve(),new Promise(()=>{}),{
  wait:async promise=>promise,
  windowClosed
});
await new Promise(resolve=>setImmediate(resolve));
const windowClosedError=Object.assign(new Error('window closed'),{code:'RENDERER_WINDOW_CLOSED'});
rejectWindowClosed(windowClosedError);
await assert.rejects(closedStartup,error=>error===windowClosedError,'closing the startup window must abort immediately instead of waiting for the 90-second timeout');
let unlockFirstDelete;
const deleteLockEvents=[];
const firstDelete=main.withWarehouseDeleteOperationLock('cmp_company_1234567890','warehouse_1234567890',async()=>{
  deleteLockEvents.push('first:start');
  await new Promise(resolve=>{unlockFirstDelete=resolve});
  deleteLockEvents.push('first:end');
  return'first';
});
await new Promise(resolve=>setImmediate(resolve));
const secondDelete=main.withWarehouseDeleteOperationLock('cmp_company_1234567890','warehouse_1234567890',async()=>{deleteLockEvents.push('second:start');return'second'});
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(deleteLockEvents,['first:start']);
unlockFirstDelete();
assert.deepEqual(await Promise.all([firstDelete,secondDelete]),['first','second']);
assert.deepEqual(deleteLockEvents,['first:start','first:end','second:start']);
let retryCalls=0,retryEvents=0;
const retryResult=await main.withCloudNetworkRetry(async()=>{
  retryCalls++;
  if(retryCalls<3)throw Object.assign(new Error('reset'),{code:'ECONNRESET'});
  return'ok';
},{attempts:3,sleep:async()=>{},onRetry:()=>{retryEvents++}});
assert.equal(retryResult,'ok');
assert.equal(retryCalls,3);
assert.equal(retryEvents,2);
let permanentCalls=0;
await assert.rejects(main.withCloudNetworkRetry(async()=>{permanentCalls++;throw Object.assign(new Error('bad password'),{code:'INVALID_CREDENTIALS'})},{attempts:3,sleep:async()=>{}}),error=>error.code==='INVALID_CREDENTIALS');
assert.equal(permanentCalls,1);
let mapFallbackCalls=0;
const directMapResult=await main.resolveDesktopMapGeocode(
  {requestId:'map-direct-1',mode:'search',query:'ВДНХ, Москва',limit:5},
  {configured:true,direct:async()=>[{display_name:'ВДНХ'}],fallback:async()=>{mapFallbackCalls++;return[]}},
);
assert.equal(directMapResult.ok,true);
assert.equal(directMapResult.source,'direct-openstreetmap');
assert.equal(mapFallbackCalls,0);
const fallbackMapResult=await main.resolveDesktopMapGeocode(
  {requestId:'map-fallback-1',mode:'search',query:'ВДНХ, Москва',limit:5},
  {configured:true,direct:async()=>{throw Object.assign(new Error('public unavailable'),{code:'ETIMEDOUT'})},fallback:async payload=>{mapFallbackCalls++;assert.equal(payload.query,'ВДНХ, Москва');return[{display_name:'ВДНХ'}]}},
);
assert.equal(fallbackMapResult.ok,true);
assert.equal(fallbackMapResult.source,'company-vps');
assert.equal(fallbackMapResult.degraded,true);
assert.equal(mapFallbackCalls,1);
const failedMapResult=await main.resolveDesktopMapGeocode(
  {requestId:'map-failed-1',mode:'search',query:'ВДНХ, Москва',limit:5},
  {configured:true,direct:async()=>{throw Object.assign(new Error('public unavailable'),{code:'ETIMEDOUT'})},fallback:async()=>{throw Object.assign(new Error('VPS unavailable'),{code:'NETWORK_TIMEOUT'})}},
);
assert.equal(failedMapResult.ok,false);
assert.equal(failedMapResult.code,'NETWORK_TIMEOUT');
assert.match(failedMapResult.error,/OpenStreetMap: Error: public unavailable; VPS: Error: VPS unavailable/);
const addressState={workspace_id:'cmp_company_1234567890'};
assert.throws(()=>main.validateDesktopAddressSearchPayload({query:'Всеволожск',warehouseId:'warehouse_msk',interaction:'explicit'}),/Идентификатор адресного запроса повреждён/);
let publicAddressCalls=0;
const indexedAddressResult=await main.resolveDesktopAddressSearch(
  {requestId:'address-request-1',query:'Всеволжск Лен обл',warehouseId:'warehouse_msk',interaction:'autocomplete'},
  {state:addressState,server:async(input,state)=>({
    ok:true,workspace_id:state.workspace_id,warehouse_id:input.warehouseId,environment:input.environment,
    request_id:input.requestId,address_contract:1,normalized_query:'всеволжск ленинградская область',
    provider:{name:'dadata',api_version:'4_1',reference:'gar-fias',queried_at:'2026-08-23T00:00:00Z',cache_ttl_seconds:900},
    results:[{id:'dadata:1',display_name:'Всеволожск, Ленинградская область',components:{region:'Ленинградская область',district:'Всеволожский район',settlement:'Всеволожск'},object_type:'город',coordinates:{lat:60.02,lon:30.64,accuracy:'settlement'},fias_id:'f26b876b-6857-4951-b060-ec6559f04a9a',provider_ids:{dadata:'1'},confidence:'high',match_score:.94,match_reason:['Точное текстовое совпадение'],warnings:[],source:{name:'dadata',version:'suggestions-api-4_1',date:'2026-08-23'}}]
  }),direct:async()=>{publicAddressCalls++;return[]},publicFallbackAllowed:true},
);
assert.equal(indexedAddressResult.ok,true);
assert.equal(indexedAddressResult.source,'company-address-provider');
assert.equal(indexedAddressResult.data.length,1);
assert.equal(indexedAddressResult.data[0].__jfCanonicalAddress.fiasId,'f26b876b-6857-4951-b060-ec6559f04a9a');
assert.equal(indexedAddressResult.data[0].__jfCanonicalAddress.originalInput,'Всеволжск Лен обл');
assert.equal(publicAddressCalls,0);
await assert.rejects(
  main.resolveDesktopAddressSearch(
    {requestId:'address-request-bad-provider',query:'Всеволжск Лен обл',warehouseId:'warehouse_msk',interaction:'explicit'},
    {state:addressState,server:async(input,state)=>({ok:true,workspace_id:state.workspace_id,warehouse_id:input.warehouseId,environment:input.environment,request_id:input.requestId,address_contract:1,normalized_query:'всеволжск',provider:{name:'dadata',api_version:'4_1',reference:'gar-fias',queried_at:'not-a-date',cache_ttl_seconds:900},results:[]}),publicFallbackAllowed:false},
  ).then(result=>{if(result.ok===false)throw Object.assign(new Error(result.error),{code:result.code});return result}),
  /источник адресного поиска/,
);
const developmentAddressFallback=await main.resolveDesktopAddressSearch(
  {requestId:'address-request-2',query:'Всеволжск Лен обл',warehouseId:'warehouse_msk',interaction:'explicit'},
  {state:addressState,server:async()=>{throw Object.assign(new Error('provider unavailable'),{code:'ADDRESS_PROVIDER_UNAVAILABLE'})},direct:async payload=>{publicAddressCalls++;assert.equal(payload.limit,10);return[{display_name:'Всеволожск',lat:'60',lon:'30'}]},publicFallbackAllowed:true},
);
assert.equal(developmentAddressFallback.ok,true);
assert.equal(developmentAddressFallback.source,'development-public-nominatim');
assert.equal(developmentAddressFallback.degraded,true);
assert.equal(publicAddressCalls,1);
const typoAddressFallback=await main.resolveDesktopAddressSearch(
  {requestId:'address-request-typo',query:'санкт петербуг невский 28',warehouseId:'warehouse_msk',interaction:'explicit'},
  {state:null,direct:async payload=>{publicAddressCalls++;assert.equal(payload.query,'санкт петербург невский 28');return[{display_name:'28, Невский проспект, Санкт-Петербург',lat:'59.9351',lon:'30.3255'}]},publicFallbackAllowed:true},
);
assert.equal(typoAddressFallback.ok,true);
assert.equal(typoAddressFallback.data.length,1);
assert.equal(publicAddressCalls,2);
const autocompleteWithoutProvider=await main.resolveDesktopAddressSearch(
  {requestId:'address-request-auto-3',query:'Всеволжск Лен обл',warehouseId:'warehouse_msk',interaction:'autocomplete'},
  {state:addressState,server:async()=>{throw Object.assign(new Error('autocomplete not configured'),{code:'address_autocomplete_not_configured'})},direct:async()=>{publicAddressCalls++;return[]},publicFallbackAllowed:true},
);
assert.equal(autocompleteWithoutProvider.ok,false);
assert.equal(autocompleteWithoutProvider.code,'address_autocomplete_not_configured');
assert.equal(publicAddressCalls,2);
const releasedAddressWithoutVps=await main.resolveDesktopAddressSearch(
  {requestId:'address-request-3',query:'Всеволжск Лен обл',warehouseId:'warehouse_msk',interaction:'explicit'},
  {state:null,direct:async()=>{throw new Error('must not run')},publicFallbackAllowed:false},
);
assert.equal(releasedAddressWithoutVps.ok,false);
assert.equal(releasedAddressWithoutVps.code,'ADDRESS_VPS_REQUIRED');
console.log(JSON.stringify({
  ok: true,
  version: main.VERSION,
  demoStateSigned: true,
  installConfigRoundTrip: true,
  staleActivationRemoved: true,
  ownerRegistrationSingleOperation: true,
  companyScopedDesktop: true,
  sharedWarehouseRegistry: true,
  editableServerAccess: true,
  accountTokenForCompanyData: true,
  companyIdRecoveredFromSignedToken: true,
  foreignRegStateRejected: true,
  transientLoginRetry: true,
  slowNetworkStartupWindow: true,
  mapLookupDirectFirst: true,
  addressProviderServerFirst: true,
  autocompleteDoesNotUsePublicNominatim: true,
  releasedAddressRequiresVps: true,
  warehouseDeleteJournalReplay: true,
  telegramDeprovisionValidation: true,
}));
})().catch(error=>{console.error(error);process.exitCode=1});
