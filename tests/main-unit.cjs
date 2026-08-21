'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-main-unit-'));
process.env.LOCALAPPDATA = path.join(temporary, 'local');
process.env.PROGRAMDATA = path.join(temporary, 'programdata');
process.env.JF_LOG_EXE_DIR_FOR_TEST = path.join(temporary, 'exe');
process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST = path.join(temporary, 'emergency');
process.env.JF_DESKTOP_UNIT_TEST = '1';

const app = {
  getPath(name) {
    const locations = {
      userData: path.join(temporary, 'userdata'),
      documents: path.join(temporary, 'documents'),
    };
    return locations[name] || temporary;
  },
  setPath() {},
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

assert.equal(main.VERSION, '7.8.3');
assert.match(mainSource, /directOpenStreetMapGeocode/);
assert.match(mainSource, /directOpenStreetMapRoute/);
assert.ok(mainSource.indexOf("try{const data=await directOpenStreetMapGeocode(payload)") < mainSource.indexOf("regApiRequest('POST','\/v1\/maps\/geocode'"));
assert.match(mainSource, /telegram_services:services/);
assert.equal(main.RENDERER_READY_TIMEOUT_MS, 90000);
assert.equal(main.appRendererUrl('web/index.html'), 'justfun://app/web/index.html');
assert.equal(main.isTrustedAppUrl('justfun://app/web/index.html'), true);
assert.equal(main.isTrustedAppUrl('justfun://evil/web/index.html'), false);
assert.match(main.resolveAppRendererPath('justfun://app/web/index.html'), /web[\\/]index\.html$/);
assert.throws(() => main.resolveAppRendererPath('justfun://app/%2e%2e/main.js'));
assert.throws(() => main.resolveAppRendererPath('justfun://app/web/%2e%2e/%2e%2e/secret.txt'));
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
assert.equal(config.app_version, '7.8.3');
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
  access_token: jwt({sub:'usr_owner_1234567890',cid:'cmp_company_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*']}),
  offline_token: jwt({typ:'offline',sub:'usr_owner_1234567890',cid:'cmp_company_1234567890',did:'dev_pc_1234567890',role:'owner',permissions:['*']}),
  refresh_token: 'refresh-token',
  user: {full_name:'Владелец',login:'admin',role:'owner',permissions:['*']},
  company: {code:'JFWD4H54',name:'Компания'}
};
const repaired = main.saveCloudSession(oldServerResult);
assert.equal(repaired.company.id,'cmp_company_1234567890');
assert.equal(repaired.user.id,'usr_owner_1234567890');
assert.equal(repaired.device_id,'dev_pc_1234567890');
assert.equal(repaired.user.role,'owner');
assert.equal(main.publicCloudAuth(repaired).company.id,'cmp_company_1234567890');
assert.equal(main.cloudSessionComplete(repaired),true);
assert.equal(main.companyWorkspaceId(repaired),'cmp_company_1234567890');
assert.equal(main.canConfigureCompanyServer(repaired),true);
assert.equal(main.canConfigureCompanyServer({user:{role:'manager',permissions:['integrations.manage']}}),true);
assert.equal(main.canConfigureCompanyServer({user:{role:'manager',permissions:['users.read']}}),false);
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
assert.throws(()=>main.normalizeCloudAuthState({...repaired,user:{...repaired.user,role:'admin'}}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
assert.throws(()=>main.normalizeCloudAuthState({...repaired,user:{...repaired.user,permissions:['orders.read']}}),error=>error?.code==='AUTH_CONTEXT_MISMATCH');
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
assert.equal(source.includes("cloudAuthenticatedRequest('PUT','/v1/company/data-service'"), true);
assert.equal(source.includes('desktop:auth-user-access'), true);
assert.equal(source.includes('/access`'), true);
assert.equal(source.includes("setTimeout(()=>{app.relaunch();app.exit(0)},150)"), true);
assert.equal(source.includes("setTimeout(()=>app.quit(),150)"), true);
assert.equal(source.includes("appendLog('uncaughtException', diagnosticError(error))"), true);
assert.equal(source.includes("function sendWindowMessage(target,channel,payload)"), true);
assert.equal(source.includes("appendRecurringLog('Telegram event poll failed'"), true);
assert.equal(source.includes("flushRecurringLogs(); appendLog('application exiting')"), true);
assert.match(source, /token=await ensureCloudAccessToken\(\)/);
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
}));
})().catch(error=>{console.error(error);process.exitCode=1});
