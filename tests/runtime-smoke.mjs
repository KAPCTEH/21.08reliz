import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const webRoot = path.resolve(process.argv[2]);
const mode = process.argv[3] || 'load';
const testEdition = process.env.JF_TEST_EDITION === 'full' || (!process.env.JF_TEST_EDITION && mode === 'entity-ack-validation') ? 'full' : 'demo';
const clickButtons = mode === 'click' || mode === 'click-all';
const clickDynamicButtons = mode === 'click-all';
const listButtons = mode === 'list-buttons';
const stress5000 = mode === 'stress5000';
const cloudSync = mode === 'cloud-sync';
const atomicMutation = mode === 'atomic-mutation';
const localFirstRetry = mode === 'local-first-retry';
const localFirstOffline = mode === 'local-first-offline';
const bootstrapVersionConflict = mode === 'bootstrap-version-conflict';
const bootstrapScopeIsolation = mode === 'bootstrap-scope-isolation';
const backgroundScopeRace = mode === 'background-scope-race';
const outboxAbaRace = mode === 'outbox-aba-race';
const criticalScopeGuard = mode === 'critical-scope-guard';
const criticalCrashRecovery = mode === 'critical-crash-recovery';
const ordinaryCrashRecovery = mode === 'ordinary-crash-recovery';
const criticalStorageFailover = mode === 'critical-storage-failover';
const entityAckValidation = mode === 'entity-ack-validation';
const localMutationDurability = mode === 'local-mutation-durability';
const syncBusyGuard = mode === 'sync-busy-guard';
const localWarehouse = mode === 'local-warehouse';
const localToServerMigrationResume = mode === 'local-to-server-migration-resume';
const localToServerMigration = mode === 'local-to-server-migration'||localToServerMigrationResume;
const deepBusiness = mode === 'deep-business';
const orderPrintMode = mode === 'order-print';
const orderSaveIntegrityMode = mode === 'order-save-integrity';
// Local business integrity runs without VPS guards; atomic-mutation owns that path.
const runtimeEdition = orderSaveIntegrityMode || deepBusiness ? 'demo' : testEdition;
const roleMatrixMode = mode === 'role-matrix';
const securityFuzzMode = mode === 'security-fuzz';
const accessibilityMode = mode === 'accessibility';
const runtimeTraceLines = [];
const runtimeTrace = (...parts) => {
  if (process.env.JF_RUNTIME_TRACE !== '1') return;
  if (runtimeTraceLines.length >= 240) return;
  const line = `[runtime-trace] ${parts.map(String).join(' ')}`;
  runtimeTraceLines.push(line);
  process.stderr.write(`${line}\n`);
  if (process.env.JF_RUNTIME_TRACE_PATH) fs.writeFileSync(process.env.JF_RUNTIME_TRACE_PATH, `${runtimeTraceLines.join('\n')}\n`, 'utf8');
};
const testServerRole = ['owner', 'admin', 'manager', 'logistician', 'warehouse', 'viewer'].includes(process.env.JF_TEST_ROLE)
  ? process.env.JF_TEST_ROLE
  : 'owner';
const rolePermissions = {
  owner: ['*'],
  admin: ['orders.*', 'routes.*', 'inventory.*', 'drivers.*', 'reports.*', 'company.update', 'users.read', 'users.create', 'users.update', 'devices.manage', 'jf.warehouse:*'],
  manager: ['orders.*', 'routes.read', 'routes.plan', 'routes.approve', 'routes.pick', 'routes.start', 'routes.return', 'routes.close', 'routes.cancel', 'routes.settings', 'inventory.read', 'drivers.read', 'reports.read', 'jf.warehouse:*'],
  logistician: ['orders.read', 'orders.update', 'routes.*', 'drivers.*', 'inventory.read', 'jf.warehouse:*'],
  warehouse: ['orders.read', 'orders.update', 'inventory.*', 'routes.read', 'jf.warehouse:*'],
  viewer: ['orders.read', 'routes.read', 'inventory.read', 'drivers.read', 'reports.read', 'jf.warehouse:*']
};
const htmlPath = path.join(webRoot, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const htmlWithoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
const skippedScriptPattern = String(process.env.JF_SKIP_SCRIPT_PATTERN || '').trim();
const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(match => match[1])
  .filter(src => !src.includes('leaflet.js'))
  .filter(src => !skippedScriptPattern || !src.includes(skippedScriptPattern));

const errors = [];
const virtualConsole = new VirtualConsole();
for (const level of ['error', 'warn']) {
  virtualConsole.on(level, (...args) => {
    const text = args.map(item => item instanceof Error ? item.stack : String(item)).join(' ');
    errors.push({ phase: 'console', level, text });
  });
}
virtualConsole.on('jsdomError', error => errors.push({ phase: 'jsdom', level: 'error', text: error.stack || String(error) }));

const dom = new JSDOM(htmlWithoutScripts, {
  url: 'https://justfun.local/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole
});
const { window } = dom;
// Electron/Chromium exposes structuredClone; jsdom does not currently mirror it on Window.
window.structuredClone = value => structuredClone(value);
window.__JF_RUNTIME_TEST__ = true;
window.__JF_RUNTIME_TRACE__ = runtimeTrace;
const interactiveSelector = 'button,input:not([type="hidden"]),select,textarea,a[href],area[href],summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[tabindex]:not([tabindex="-1"]),[data-jf-onclick]:not(button)';
const originalButtons = new Set(window.document.querySelectorAll('button'));
const originalControls = listButtons ? new Set(window.document.querySelectorAll(interactiveSelector)) : new Set();

window.alert = message => { window.__alerts.push(String(message)); };
window.confirm = message => { window.__confirms.push(String(message)); return false; };
window.prompt = () => null;
window.open = () => null;
window.print = () => {};
window.__alerts = [];
window.__confirms = [];
window.__bridgeCalls = [];
window.__entitySyncPayloads = [];
window.__rejectEntitySync = false;
window.__entitySyncNetworkDown = false;
window.__dropEntitySyncResponseAfterCommitFor = '';
window.__holdEntityBootstrap = false;
window.__holdEntityBootstrapFor = '';
window.__entityBootstrapStarted = false;
window.__entityBootstrapStartedWarehouse = '';
window.__releaseEntityBootstrap = null;
window.__enforceEntityVersions = false;
window.__suppressEntitySync = false;
window.__replayedEntityCommands = [];
window.__holdEntitySyncFor = '';
window.__entitySyncStartedWarehouse = '';
window.__releaseEntitySync = null;
window.__entitySyncActiveByWarehouse = new Map();
window.__entitySyncMaxByWarehouse = new Map();
window.__serverEntityMap = new Map();
window.__serverCursor = 0;
window.__serverRegistryInitialized = false;
window.__activeRendererWarehouse = '';
window.__processedEntityCommands = new Map();
window.__processedEntityCommandPayloads = new Map();
window.__entityCommandAttempts = [];
window.__warehouseReplayFaultMode = '';
window.__warehouseReplayFaultsRemaining = 0;
window.__addressSearchPayloads = [];
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLFormElement.prototype.requestSubmit = function () {
  this.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.URL.createObjectURL = () => 'blob:justfun-test';
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {
  window.__bridgeCalls.push(`download:${this.download || 'link'}`);
};
window.HTMLCanvasElement.prototype.getContext = () => ({
  clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
  arc() {}, closePath() {}, drawImage() {}, save() {}, restore() {}, translate() {}, scale() {},
  setTransform() {}, measureText(text) { return { width: String(text).length * 8 }; },
  createLinearGradient() { return { addColorStop() {} }; },
  createPattern() { return null; }
});
window.L = null;
{
  const databases=new Map();window.__fakeIndexedDbFailNextWrite=false;window.__fakeIndexedDbFailNextRead=false;window.__fakeIndexedDbRecords=databases;
  const nativeStorageSet=window.Storage.prototype.setItem;window.__fakeLocalStorageRejectLarge=false;window.Storage.prototype.setItem=function(key,value){if(window.__fakeLocalStorageRejectLarge&&String(key).includes('justfun_critical_recovery')&&String(value).length>1000)throw Object.assign(new Error('simulated localStorage quota'),{name:'QuotaExceededError'});return nativeStorageSet.call(this,key,value)};
  window.indexedDB={open(name){const request={result:null,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};setTimeout(()=>{let state=databases.get(String(name)),created=false;if(!state){state={created:false,record:null};databases.set(String(name),state);created=true}const db={objectStoreNames:{contains:()=>state.created},createObjectStore:()=>{state.created=true},close(){},transaction(_store,mode,options){if(mode==='readwrite'&&options?.durability!=='strict')throw new Error('strict durability required');const tx={oncomplete:null,onerror:null,onabort:null,error:null},store={put(value){return operation('put',value)},get(){return operation('get')},delete(){return operation('delete')}};function operation(kind,value){const op={result:null,error:null,onsuccess:null,onerror:null};setTimeout(()=>{if(kind==='get'&&window.__fakeIndexedDbFailNextRead){window.__fakeIndexedDbFailNextRead=false;op.error=Object.assign(new Error('simulated IndexedDB read failure'),{code:'SIMULATED_IDB_READ_FAILURE'});tx.error=op.error;op.onerror?.();tx.onerror?.();return}if(mode==='readwrite'&&window.__fakeIndexedDbFailNextWrite){window.__fakeIndexedDbFailNextWrite=false;op.error=Object.assign(new Error('simulated IndexedDB write failure'),{code:'SIMULATED_IDB_FAILURE'});tx.error=op.error;op.onerror?.();tx.onerror?.();return}if(kind==='put')state.record=JSON.parse(JSON.stringify(value));if(kind==='delete')state.record=null;if(kind==='get')op.result=state.record?JSON.parse(JSON.stringify(state.record)):null;op.onsuccess?.();tx.oncomplete?.()},0);return op}return{...tx,objectStore:()=>store,get oncomplete(){return tx.oncomplete},set oncomplete(value){tx.oncomplete=value},get onerror(){return tx.onerror},set onerror(value){tx.onerror=value},get onabort(){return tx.onabort},set onabort(value){tx.onabort=value},get error(){return tx.error}}}};request.result=db;if(created)request.onupgradeneeded?.();request.onsuccess?.()},0);return request}};
}

const goodResponse = data => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: () => 'application/json' },
  json: async () => data,
  text: async () => JSON.stringify(data)
});
window.fetch = async url => {
  const target = String(url);
  if (target.includes('/route/v1/')) {
    return goodResponse({ code: 'Ok', routes: [{ distance: 1000, duration: 600, geometry: { coordinates: [] } }] });
  }
  if (target.includes('nominatim') || target.includes('/search')) return goodResponse([]);
  return goodResponse({ ok: true });
};

window.JustFunDesktop = {
  version: '7.8.3',
  platform: 'win32',
  bootstrapEdition: runtimeEdition,
  bootstrapCompanyId: runtimeEdition === 'full' ? 'cmp_company_test_12345' : '',
  startupStage(stage, detail) { runtimeTrace('stage', stage, detail || ''); },
  startupReady: async payload => { runtimeTrace('ready', payload?.surface || 'unknown'); window.__startupReadySurface = payload?.surface || 'unknown'; return { ok: true }; },
  getSession: async () => runtimeEdition === 'demo'
    ? ({ edition: 'demo', demoRemainingMs: 60 * 60 * 1000 })
    : ({
        edition: 'full',
        auth: {
          user: { id: `usr_${testServerRole}_test`, full_name: `Тест роли ${testServerRole}`, login: testServerRole, role: testServerRole, permissions: rolePermissions[testServerRole], status: 'active' },
          company: {
            id: 'cmp_company_test_12345',
            code: 'JFTEST01',
            name: 'Тестовая компания',
            data_service: process.env.JF_TEST_DATA_SERVICE_DISABLED === '1'
              ? null
              : { address: '203.0.113.10', api_port: 443, tls_sha256: 'A'.repeat(64) }
          },
          device_id: 'dev_test_pc',
          offline: false
        }
      }),
  getAppInfo: async () => ({ version: '7.8.3', logFile: 'C:\\test\\desktop.log' }),
  openLogFolder: async () => ({ ok: true }),
  copyText: async () => true,
  openSupport: async () => true,
  backups: { save: async () => ({ ok: true, confirmed: true, path: 'C:\\test\\Экспорт\\justfun-backup.json', bytes: 1024, sha256: 'A'.repeat(64), kind: 'manual', at: new Date().toISOString() }) },
  audit: { event: async payload => { window.__bridgeCalls.push(`audit:${String(payload?.action||'')}:${String(payload?.correlationId||'')}`); return {ok:true,correlationId:String(payload?.correlationId||'')}; } },
  setActiveWarehouse: async payload => { window.__activeRendererWarehouse=String(payload?.warehouseId||''); return {ok:true,warehouseId:window.__activeRendererWarehouse,environment:String(payload?.environment||'live')}; },
  maps: {
    addressSearch: async payload => { window.__addressSearchPayloads.push(JSON.parse(JSON.stringify(payload||{}))); return { ok:false, configured:false }; },
    geocode: async () => ({ ok:false, configured:false }),
    route: async () => ({ ok:false, configured:false }),
    diagnostic: async () => ({ ok:true })
  },
  auth: {
    checkLicense: async () => ({ ok: false }),
    registerOwner: async () => ({ ok: true }),
    login: async () => ({ ok: true }),
    acceptInvitation: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    users: async () => ({ ok: true, users: [] }),
    invitations: async () => ({ ok: true, invitations: [] }),
    invite: async () => ({ ok: true }),
    revokeInvitation: async () => ({ ok: true }),
    setUserStatus: async () => ({ ok: true }),
    setUserAccess: async () => ({ ok: true }),
    devices: async () => ({ ok: true, devices: [] }),
    setDeviceStatus: async () => ({ ok: true })
  },
  regVps: {
    status: async () => ({ configured: false }),
    warehouses: async () => {
      const migratedWarehouses=[...window.__serverEntityMap.values()].filter(item=>item.type==='warehouse').map(item=>({...JSON.parse(JSON.stringify(item.payload)),entity_version:item.version,digest_sha256:item.digest_sha256,updated_at:new Date().toISOString()}));
      if(localToServerMigration||migratedWarehouses.length||window.__serverRegistryInitialized)return{ok:true,configured:true,registryInitialized:window.__serverRegistryInitialized,warehouses:migratedWarehouses};
      const keepRuntimeWarehouse=atomicMutation||localFirstRetry||localFirstOffline||roleMatrixMode,active=keepRuntimeWarehouse?window.TeplitsaWarehouseBootstrap?.activeWarehouse?.():null;
      return{ok:true,configured:true,registryInitialized:Boolean(active),warehouses:active?[{...JSON.parse(JSON.stringify(active)),status:'active',entity_version:1,digest_sha256:'A'.repeat(64)}]:[]}
    },
    configure: async () => ({ canceled: true }),
    syncWarehouse: async payload => {
      window.__bridgeCalls.push(`reg.sync:${payload?.warehouseId || ''}:${payload?.environment || ''}`);
      return { ok: true, revision: 1, digest: 'A'.repeat(64) };
    },
    fetchWarehouse: async () => ({ ok: false, code: 'snapshot_not_found' }),
    writeWarehouse: async payload => {
      const commandKey=`warehouse:${payload?.warehouseId}:${payload?.commandId}`,commandPayload=JSON.stringify(payload?.changes||[]),injectFault=result=>{if(Number(window.__warehouseReplayFaultsRemaining||0)<=0)return null;window.__warehouseReplayFaultsRemaining--;const mode=String(window.__warehouseReplayFaultMode||'');if(mode==='partial')return{ok:false,code:'REG_ENTITY_ACK_INCOMPLETE',error:'Тестовое неполное ACK склада после commit',writeOutcome:'uncertain',failureOrigin:'ack_validation',retrySameCommand:true};if(mode==='lost')return{ok:false,code:'NETWORK_ERROR',error:'Тестовая потеря ответа склада после commit',writeOutcome:'uncertain',failureOrigin:'transport_or_response',retrySameCommand:true};return null};window.__entityCommandAttempts.push(commandKey);if(window.__processedEntityCommands.has(commandKey)){if(window.__processedEntityCommandPayloads.get(commandKey)!==commandPayload)return{ok:false,code:'command_id_collision',error:'Одинаковый command_id использован для другой операции склада.',writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false};window.__replayedEntityCommands.push(commandKey);const replay=JSON.parse(JSON.stringify(window.__processedEntityCommands.get(commandKey)));replay.replayed=true;return injectFault(replay)||replay}window.__serverRegistryInitialized=true;const entities=(payload?.changes||[]).map(item=>{const key=localToServerMigration?`${payload?.warehouseId}:${item.type}:${item.id}`:`${item.type}:${item.id}`,eventId=++window.__serverCursor,entity={type:item.type,id:item.id,warehouseId:String(payload?.warehouseId||''),version:Number(item.baseVersion||0)+1,event_id:eventId,eventId,digest_sha256:'A'.repeat(64),digest:'A'.repeat(64),payload:item.deleted?null:JSON.parse(JSON.stringify(item.payload)),deleted:item.deleted===true};if(item.deleted)window.__serverEntityMap.delete(key);else window.__serverEntityMap.set(key,entity);return{type:item.type,id:item.id,version:entity.version,eventId,digest:'A'.repeat(64),deleted:item.deleted===true}}),result={ok:true,commandId:payload?.commandId||'',entities,cursor:window.__serverCursor};window.__processedEntityCommandPayloads.set(commandKey,commandPayload);window.__processedEntityCommands.set(commandKey,JSON.parse(JSON.stringify(result)));const injected=injectFault(result);if(injected)return injected;if(window.__warehouseAckFault){const fault=String(window.__warehouseAckFault);window.__warehouseAckFault='';if(fault==='partial')return{ok:true,commandId:payload?.commandId||'',entities:[],cursor:window.__serverCursor};if(fault==='wrong-command')return{...JSON.parse(JSON.stringify(result)),commandId:'wrong-warehouse-command'}}if(window.__dropWarehouseWriteResponseAfterCommit){window.__dropWarehouseWriteResponseAfterCommit=false;throw Object.assign(new Error('Тестовая потеря ответа склада после commit'),{code:'NETWORK_ERROR'})}return result;
    },
    bootstrapEntities: async payload => {
      runtimeTrace('reg.bootstrap', payload?.warehouseId || '', payload?.environment || '');
      window.__bridgeCalls.push(`reg.entityBootstrap:${payload?.warehouseId || ''}:${payload?.environment || ''}`);
      if(window.__holdEntityBootstrap&&(!window.__holdEntityBootstrapFor||window.__holdEntityBootstrapFor===String(payload?.warehouseId||''))){window.__entityBootstrapStarted=true;window.__entityBootstrapStartedWarehouse=String(payload?.warehouseId||'');await new Promise(resolve=>{window.__releaseEntityBootstrap=resolve});window.__holdEntityBootstrap=false;window.__holdEntityBootstrapFor='';window.__releaseEntityBootstrap=null}
      return { ok: true, cursor: window.__serverCursor, entities: [...window.__serverEntityMap.values()].filter(item=>String(item.warehouseId||'')===String(payload?.warehouseId||'')).map(item=>JSON.parse(JSON.stringify(item))), readableTypes: ['warehouse','orders','products','inventoryMovements','drivers','settings','reportingData','company','routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','routeArchives','warehouseReservations','manualRouteSequences'] };
    },
    syncEntities: async payload => {
      const syncWarehouse=String(payload?.warehouseId||''),active=(window.__entitySyncActiveByWarehouse.get(syncWarehouse)||0)+1;window.__entitySyncActiveByWarehouse.set(syncWarehouse,active);window.__entitySyncMaxByWarehouse.set(syncWarehouse,Math.max(active,window.__entitySyncMaxByWarehouse.get(syncWarehouse)||0));
      try{
        runtimeTrace('reg.sync', syncWarehouse, (payload?.changes || []).length, payload?.intent?.kind || 'background');
        window.__bridgeCalls.push(`reg.entitySync:${syncWarehouse}:${payload?.environment || ''}:${payload?.intent?.kind || 'background'}`);
        window.__entitySyncPayloads.push(JSON.parse(JSON.stringify(payload || {})));
        const processedKey=`${syncWarehouse}:${payload?.commandId}`,processedPayload=JSON.stringify({changes:payload?.changes||[],intent:payload?.intent||null});window.__entityCommandAttempts.push(processedKey);if(window.__processedEntityCommands.has(processedKey)){if(window.__processedEntityCommandPayloads.get(processedKey)!==processedPayload)return{ok:false,code:'command_id_collision',error:'Одинаковый command_id использован для другого пакета.',writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false};window.__replayedEntityCommands.push(processedKey);const replay=JSON.parse(JSON.stringify(window.__processedEntityCommands.get(processedKey)));replay.replayed=true;return replay}
        let heldEntitySync=false;if(window.__holdEntitySyncFor&&window.__holdEntitySyncFor===syncWarehouse){heldEntitySync=true;window.__holdEntitySyncFor='';window.__entitySyncStartedWarehouse=syncWarehouse;await new Promise(resolve=>{window.__releaseEntitySync=resolve});window.__releaseEntitySync=null}
        if (window.__entitySyncNetworkDown) throw Object.assign(new Error('Тестовый обрыв сети'), { code: 'NETWORK_ERROR' });
        if (window.__rejectEntitySync) return { ok: false, code: 'TEST_REJECT', error: 'Тестовый отказ VPS', writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false };
        if(entityAckValidation){const protectedChange=(payload?.changes||[]).some(item=>['routeExecutions','routeArchives','warehouseReservations'].includes(String(item?.type||''))&&!String(item?.id||'').startsWith('ack-pickup-intent-')),serverKinds=new Set(['route_approve','route_picking','route_cancel','route_start','route_return','route_close','pickup_ready','pickup_collected','local_migration_import']),intentKind=String(payload?.intent?.kind||'');if(protectedChange&&!serverKinds.has(intentKind))return{ok:false,code:'server_intent_required',error:'Тест: защищённая сущность требует server intent.',writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false};if(payload?.intent&&!serverKinds.has(intentKind))return{ok:false,code:'invalid_intent',error:'Тест: локальный audit intent нельзя отправлять как server intent.',writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false}}
        if(window.__entityAckFault){const fault=String(window.__entityAckFault);window.__entityAckFault='';if(fault==='partial')return{ok:true,cursor:window.__serverCursor,commandId:payload?.commandId||'',entities:[]};if(fault==='wrong-command'){const entities=(payload?.changes||[]).map(item=>({type:item.type,id:item.id,version:Number(item.baseVersion||0)+1,eventId:++window.__serverCursor,digest:'A'.repeat(64),deleted:item.deleted===true}));return{ok:true,cursor:window.__serverCursor,commandId:'wrong-command-id',entities}}}
        if(window.__suppressEntitySync){const entities=(payload?.changes||[]).map(item=>({type:item.type,id:item.id,version:Number(item.baseVersion||0)+1,eventId:++window.__serverCursor,digest:'A'.repeat(64),deleted:item.deleted===true}));return{ok:true,cursor:window.__serverCursor,commandId:payload?.commandId||'',entities}}
        const prepared=(payload?.changes||[]).map(item=>{const key=localToServerMigration?`${syncWarehouse}:${item.type}:${item.id}`:`${item.type}:${item.id}`,current=window.__serverEntityMap.get(key),serverVersion=Number(current?.version||0);return{item,key,current,serverVersion}}),conflict=window.__enforceEntityVersions?prepared.find(({item,serverVersion})=>Number(item.baseVersion||0)!==serverVersion):null;
        if(conflict)return{ok:false,code:'entity_version_conflict',error:'Тестовый конфликт версии',details:{type:conflict.item.type,id:conflict.item.id,expectedVersion:conflict.serverVersion,receivedVersion:Number(conflict.item.baseVersion||0)},writeOutcome:'definitive_rejection',failureOrigin:'server_rejection',retrySameCommand:false};
        const entities=prepared.map(({item,key,serverVersion})=>{const version=window.__enforceEntityVersions?serverVersion+1:Number(item.baseVersion||0)+1,eventId=++window.__serverCursor,result={type:item.type,id:item.id,version,eventId,digest:'A'.repeat(64),deleted:item.deleted===true};if(item.deleted===true)window.__serverEntityMap.delete(key);else window.__serverEntityMap.set(key,{type:item.type,id:item.id,warehouseId:syncWarehouse,version,event_id:eventId,digest_sha256:'A'.repeat(64),payload:JSON.parse(JSON.stringify(item.payload))});return result});
        const result={ ok: true, cursor: window.__serverCursor, commandId: payload?.commandId || '', entities };window.__processedEntityCommandPayloads.set(processedKey,processedPayload);window.__processedEntityCommands.set(processedKey,JSON.parse(JSON.stringify(result)));if(window.__entityPostCommitFaultFor===String(payload?.commandId||'')){const fault=String(window.__entityPostCommitFaultMode||'malformed-ack');window.__entityPostCommitFaultFor='';return{ok:false,code:fault==='lost'?'NETWORK_ERROR':'REG_ENTITY_ACK_INVALID',error:fault==='lost'?'Тестовая потеря ответа после commit':'Тестовый malformed ACK после commit',writeOutcome:'uncertain',failureOrigin:fault==='lost'?'transport_or_response':'ack_validation',retrySameCommand:true}}if(window.__dropEntitySyncResponseAfterCommitFor===String(payload?.commandId||'')){window.__dropEntitySyncResponseAfterCommitFor='';throw Object.assign(new Error('Тестовая потеря ответа после commit'),{code:'NETWORK_ERROR'})}return result;
      }finally{const left=(window.__entitySyncActiveByWarehouse.get(syncWarehouse)||1)-1;if(left>0)window.__entitySyncActiveByWarehouse.set(syncWarehouse,left);else window.__entitySyncActiveByWarehouse.delete(syncWarehouse)}
    },
    entityChanges: async payload => { runtimeTrace('reg.changes', payload?.warehouseId || '', payload?.afterEventId || 0); return { ok: true, cursor: Number(payload?.afterEventId||0), events: [], readableTypes: ['warehouse','orders','products','inventoryMovements','drivers','settings','reportingData','company','routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','routeArchives','warehouseReservations','manualRouteSequences'], hasMore: false }; }
  },
  telegramCloudflare: {
    status: async () => { window.__bridgeCalls.push('telegram.status'); return { configured: false }; },
    configure: async reconnect => { window.__bridgeCalls.push(`telegram.configure:${Boolean(reconnect)}`); return { canceled: true }; },
    createLink: async () => ({ ok: true, deepLink: 'https://t.me/example?start=test' }),
    sendNotification: async () => ({ ok: true }),
    pollEvents: async () => ({ ok: true, events: [] }),
    bindings: async () => ({ ok: true, bindings: [] }),
    onProgress: () => () => {}
  },
  saveTextFile: async () => ({ ok: true }),
  selectFile: async () => null,
  selectFolder: async () => null,
  restart: async () => ({ ok: true }),
  quit: async () => ({ ok: true }),
  onDemoTick: () => () => {},
  onAppEvent: () => () => {}
};

window.addEventListener('error', event => {
  errors.push({ phase: 'window', level: 'error', text: event.error?.stack || event.message });
});
window.addEventListener('unhandledrejection', event => {
  errors.push({ phase: 'promise', level: 'error', text: event.reason?.stack || String(event.reason) });
});

if(localToServerMigration){
  const scope='teplitsa_company_cmp_company_test_12345__',prefix=`${scope}wh_v600__`,first='warehouse-local-a',second='warehouse-local-b',now='2026-08-24T00:00:00.000Z';
  const warehouses=[
    {id:first,name:'Локальный склад А',code:'СПБ',address:'Санкт-Петербург, Невский проспект, 28',lat:59.9351,lon:30.3255,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',origin:'local-default',createdAt:now,updatedAt:now},
    {id:second,name:'Локальный склад Б',code:'МСК',address:'Москва, Тверская улица, 1',lat:55.7578,lon:37.6156,timezone:'Europe/Moscow',status:'active',catalogMode:'empty',origin:'local',createdAt:now,updatedAt:now}
  ];
  window.localStorage.setItem(`${scope}warehouses_registry_v600`,JSON.stringify({version:2,activeWarehouseId:first,warehouses,createdAt:now,updatedAt:now}));
  window.__migrationSourceRegistry={version:2,activeWarehouseId:first,warehouses:JSON.parse(JSON.stringify(warehouses)),createdAt:now,updatedAt:now};
  const write=(warehouseId,key,value)=>window.localStorage.setItem(`${prefix}${warehouseId}__live__${key}`,JSON.stringify(value));
  for(const warehouse of warehouses){write(warehouse.id,'orders_2gis_tms_v1',[]);write(warehouse.id,'orders_osm_leaflet_products_v1',[]);write(warehouse.id,'orders_osm_leaflet_inventory_movements_v1',[]);write(warehouse.id,'orders_osm_leaflet_drivers_v1',[]);write(warehouse.id,'orders_osm_leaflet_settings_v1',{warehouse:{address:warehouse.address,lat:warehouse.lat,lon:warehouse.lon},warehouseProfile:{id:warehouse.id,code:warehouse.code,name:warehouse.name},company:{shortName:'Тест миграции'}})}
  const storedOrder={id:'migration-order-1',number:'MIG-1',warehouseId:first,orderType:'pickup',createdAt:now,updatedAt:now,items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'};
  write(first,'orders_2gis_tms_v1',[storedOrder]);
  write(second,'orders_osm_leaflet_products_v1',[{id:'migration-product-1',warehouseId:second,name:'Товар второго склада',article:'MIG-P1',purchasePrice:10,salePrice:20}]);
  const outboxScope=`cmp_company_test_12345:live:${first}`,scopeHash=value=>{let hash=2166136261;for(const ch of String(value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(16).padStart(8,'0')},safeScope=outboxScope.replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,120),outboxKey=`jf.local-outbox.v1.${safeScope}.${scopeHash(outboxScope)}`,pendingCommandId='client:migration-pending:order-1',pendingOrder={...storedOrder,updatedAt:'2026-08-24T00:05:00.000Z',status:'not_relevant',fulfillmentStatus:'not_relevant',archived:true};
  window.localStorage.setItem(outboxKey,JSON.stringify({schemaVersion:1,dataContractVersion:3,scope:outboxScope,createdAt:now,updatedAt:now,entries:[{commandId:pendingCommandId,scope:outboxScope,companyId:'cmp_company_test_12345',warehouseId:first,environment:'live',intent:{kind:'order_not_relevant',targetId:storedOrder.id},changes:[{type:'orders',id:storedOrder.id,baseVersion:0,deleted:false,payload:pendingOrder}],state:'pending',createdAt:now,updatedAt:now,authorUserId:'usr_owner_test_12345',deviceId:'desktop:migration-test',dataContractVersion:3,attempts:0,nextAttemptAt:null,lastError:null,confirmedAt:null,preserveLocal:true}]}));
  window.__migrationPendingOutbox={scope:outboxScope,commandId:pendingCommandId};
  if(localToServerMigrationResume)window.__dropEntitySyncResponseAfterCommitFor='client:migrate-v783:entities:warehouse-local-a:0';
}

const scriptResults = [];
for (const src of scriptPaths) {
  const file = path.resolve(webRoot, src);
  const before = errors.length;
  try {
    const source = fs.readFileSync(file, 'utf8');
    const script = window.document.createElement('script');
    script.textContent = `${source}\n//# sourceURL=${file.replaceAll('\\', '/')}`;
    window.document.body.append(script);
    await new Promise(resolve => setTimeout(resolve, 0));
    const added = errors.slice(before).filter(item => item.level === 'error');
    scriptResults.push({ src, ok: added.length === 0, errors: added });
  } catch (error) {
    errors.push({ phase: 'script', level: 'error', src, text: error.stack || String(error) });
    scriptResults.push({ src, ok: false, error: error.message });
  }
}

window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
for (let attempt = 0; attempt < 60 && !window.__startupReadySurface; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
// The desktop layer installs its first bootstrap/outbox pass after 250 ms.
// Wait for that pass before deterministic race tests manipulate the active scope.
await new Promise(resolve => setTimeout(resolve, 400));
if(roleMatrixMode){for(let attempt=0;attempt<100&&!window.document.documentElement.classList.contains('jf-authenticated');attempt+=1)await new Promise(resolve=>setTimeout(resolve,50))}
if (cloudSync) {
  window.persistOrders();
  await new Promise(resolve => setTimeout(resolve, 3000));
  const uploads = window.__bridgeCalls.filter(item => item.startsWith('reg.entitySync:'));
  if (testEdition !== 'full') {
    errors.push({ phase: 'cloud-sync', level: 'error', text: 'Cloud sync verification must run in full edition.' });
  } else if (uploads.length !== 1) {
    errors.push({ phase: 'cloud-sync', level: 'error', text: `Expected exactly one row-level VPS upload, got ${uploads.length}.` });
  }
}
let localFirstResult = null;
if (localFirstRetry || localFirstOffline) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'local-first', level: 'error', text: 'Local-first verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      if(!window.JustFunEntitySyncV783?.status?.().installed)throw new Error('Desktop persistence guards не установлены.');
      const localFirstScript = window.document.createElement('script');
      localFirstScript.textContent = `window.__localFirstPromise = (async () => {
        const previousConfirm=jfConfirm;jfConfirm=async()=>true;
        try{
          const id='local-first-order',makeOrder=()=>normalizeOrder({id,number:id,orderType:'delivery',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deliveryDate:todayISO(),contactName:'Проверка local-first',contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});
          await window.JustFunEntitySyncV783.flushAndConfirm();window.__holdEntityBootstrap=${localFirstOffline};window.__entityBootstrapStarted=false;const bootstrapInterleaving=${localFirstOffline}?window.__JustFunEntitySyncTestV783.bootstrap(true):null;if(${localFirstOffline}){for(let attempt=0;attempt<100&&!window.__entityBootstrapStarted;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(!window.__entityBootstrapStarted)throw new Error('Управляемый bootstrap interleaving не запустился.')}
          orders=orders.filter(item=>item.id!==id);orders.unshift(makeOrder());const persistWrapped=String(window.persistOrders).includes('scheduleCloudUpload');window.persistOrders();const statusAfterPersist=window.JustFunEntitySyncV783.status();if(${localFirstOffline}){window.__releaseEntityBootstrap?.();await bootstrapInterleaving}await new Promise(resolve=>setTimeout(resolve,250));
          if(${localFirstRetry})await window.JustFunEntitySyncV783.flushAndConfirm();const statusAfterBaseline=window.JustFunEntitySyncV783.status(),baselineLocalPresent=orders.some(item=>item.id===id),baselineServerPresent=window.__serverEntityMap.has('orders:'+id);
          window.__entitySyncPayloads.length=0;window.__entitySyncNetworkDown=${localFirstRetry||localFirstOffline};
          const deleteResult=await window.deleteOrder(id),removed=!orders.some(item=>item.id===id),before=window.JustFunEntitySyncV783.status(),queue=window.JustFunLocalOutboxV783.create(localStorage,before.scope),allAfterDelete=queue.list(),pending=allAfterDelete.filter(entry=>entry.state==='pending'||entry.state==='sending').at(-1)||null,restarted=window.JustFunLocalOutboxV783.create(localStorage,before.scope),restartPreserved=Boolean(pending&&restarted.get(pending.commandId)?.state==='pending'),simulatedServer=buildBackupPayload();simulatedServer.data.orders.push(makeOrder());const overlaid=window.__JustFunEntitySyncTestV783.overlaySnapshot(simulatedServer),bootstrapOverlayPreserved=!overlaid.data.orders.some(item=>item.id===id);
          let criticalResult=null,criticalPreserved=null,retrySameCommand=null,confirmedAfterRetry=null;
          if(${localFirstOffline}){const count=orders.length;criticalResult=await window.clearAll();criticalPreserved=orders.length===count}
          if(${localFirstRetry}){window.__entitySyncNetworkDown=false;await window.JustFunEntitySyncV783.flushAndConfirm();const attempts=window.__entitySyncPayloads.filter(payload=>payload.commandId===pending?.commandId);retrySameCommand=attempts.length===2&&attempts.every(payload=>payload.commandId===pending.commandId);confirmedAfterRetry=window.JustFunLocalOutboxV783.create(localStorage,before.scope).get(pending?.commandId)?.state==='confirmed'}
          return{persistWrapped,statusAfterPersist,statusAfterBaseline,baselineLocalPresent,baselineServerPresent,deleteResult,removed,outboxAfterDelete:before.outbox,allAfterDelete:allAfterDelete.map(entry=>({commandId:entry.commandId,state:entry.state,attempts:entry.attempts,nextAttemptAt:entry.nextAttemptAt,lastError:entry.lastError})),pendingSaved:Boolean(pending),restartPreserved,bootstrapOverlayPreserved,criticalResult,criticalPreserved,retrySameCommand,confirmedAfterRetry,syncAttempts:window.__entitySyncPayloads.length};
        }finally{jfConfirm=previousConfirm;window.__entitySyncNetworkDown=false;window.__holdEntityBootstrap=false;window.__releaseEntityBootstrap?.();window.__releaseEntityBootstrap=null}
      })();`;
      window.document.body.append(localFirstScript);
      localFirstResult = await window.__localFirstPromise;
      const expected = localFirstRetry
        ? localFirstResult.baselineLocalPresent&&localFirstResult.deleteResult===true&&localFirstResult.removed&&localFirstResult.pendingSaved&&localFirstResult.restartPreserved&&localFirstResult.bootstrapOverlayPreserved&&localFirstResult.retrySameCommand&&localFirstResult.confirmedAfterRetry
        : localFirstResult.baselineLocalPresent&&localFirstResult.deleteResult===true&&localFirstResult.removed&&localFirstResult.pendingSaved&&localFirstResult.restartPreserved&&localFirstResult.bootstrapOverlayPreserved&&localFirstResult.criticalResult===false&&localFirstResult.criticalPreserved;
      if (!expected) errors.push({ phase: 'local-first', level: 'error', text: JSON.stringify(localFirstResult) });
    } catch (error) {
      errors.push({ phase: 'local-first', level: 'error', text: error.stack || String(error) });
    }
  }
}
let bootstrapVersionConflictResult = null;
if (bootstrapVersionConflict) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'bootstrap-version-conflict', level: 'error', text: 'Version-conflict verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script = window.document.createElement('script');
      script.textContent = `window.__bootstrapVersionConflictPromise=(async()=>{
        const id='bootstrap-conflict-order',warehouseId=String(window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.id||''),key='orders:'+id,makeOrder=contactName=>normalizeOrder({id,number:id,warehouseId,orderType:'delivery',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deliveryDate:todayISO(),contactName,contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});
        try{
          await window.JustFunEntitySyncV783.flushAndConfirm();const base=makeOrder('Базовая версия');window.__serverEntityMap.set(key,{type:'orders',id,warehouseId,version:1,event_id:++window.__serverCursor,digest_sha256:'A'.repeat(64),payload:cloneValue(base)});await window.__JustFunEntitySyncTestV783.bootstrap(true);
          window.__holdEntityBootstrap=true;window.__holdEntityBootstrapFor=warehouseId;window.__entityBootstrapStarted=false;const pendingBootstrap=window.__JustFunEntitySyncTestV783.bootstrap(true);for(let attempt=0;attempt<100&&!window.__entityBootstrapStarted;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(!window.__entityBootstrapStarted)throw new Error('Управляемый version bootstrap не запустился.');
          orders=orders.filter(item=>item.id!==id);orders.unshift(makeOrder('Локальная версия'));window.persistOrders();await window.TeplitsaWarehouseV600?.whenPersisted?.();const remote=makeOrder('Удалённая версия');window.__serverEntityMap.set(key,{type:'orders',id,warehouseId,version:2,event_id:++window.__serverCursor,digest_sha256:'B'.repeat(64),payload:cloneValue(remote)});window.__enforceEntityVersions=true;window.__releaseEntityBootstrap?.();await pendingBootstrap;
          for(let attempt=0;attempt<100;attempt++){const state=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope).status();if(state.conflict)break;await new Promise(resolve=>setTimeout(resolve,25))}
          const scope=window.JustFunEntitySyncV783.status().scope,queue=window.JustFunLocalOutboxV783.create(localStorage,scope),entry=queue.list().find(item=>item.changes.some(change=>change.type==='orders'&&change.id===id)),localPreserved=orders.find(item=>item.id===id)?.contactName==='Локальная версия',serverPreserved=window.__serverEntityMap.get(key)?.payload?.contactName==='Удалённая версия',oldBaseVersion=entry?.changes.find(change=>change.type==='orders'&&change.id===id)?.baseVersion===1,conflictSaved=entry?.state==='conflict';
          orders=orders.map(item=>item.id===id?{...item,contactName:'Локальная версия 2',updatedAt:new Date().toISOString()}:item);window.persistOrders();await window.TeplitsaWarehouseV600?.whenPersisted?.();const beforeCount=queue.list().length,previousAccess=window.__JustFunEntitySyncTestV783.access();let blockedCode='';window.__JustFunEntitySyncTestV783.setAccess({role:'viewer',permissions:[]});try{await window.__JustFunEntitySyncTestV783.bootstrap(true)}catch(error){blockedCode=String(error?.code||'')}finally{window.__JustFunEntitySyncTestV783.setAccess(previousAccess)}const afterQueue=window.JustFunLocalOutboxV783.create(localStorage,scope),afterCount=afterQueue.list().length,latestLocalPreserved=orders.find(item=>item.id===id)?.contactName==='Локальная версия 2';
          return{warehouseId,localPreserved,serverPreserved,oldBaseVersion,conflictSaved,blockedCode,permissionRevokedBlocked:blockedCode==='OUTBOX_ENTITY_BLOCKED',noSecondCommand:beforeCount===afterCount,latestLocalPreserved,outbox:afterQueue.status()};
        }finally{window.__enforceEntityVersions=false;window.__holdEntityBootstrap=false;window.__holdEntityBootstrapFor='';window.__releaseEntityBootstrap?.();window.__releaseEntityBootstrap=null}
      })();`;
      window.document.body.append(script);
      bootstrapVersionConflictResult = await window.__bootstrapVersionConflictPromise;
      if(!bootstrapVersionConflictResult.localPreserved||!bootstrapVersionConflictResult.serverPreserved||!bootstrapVersionConflictResult.oldBaseVersion||!bootstrapVersionConflictResult.conflictSaved||bootstrapVersionConflictResult.blockedCode!=='OUTBOX_ENTITY_BLOCKED'||!bootstrapVersionConflictResult.permissionRevokedBlocked||!bootstrapVersionConflictResult.noSecondCommand||!bootstrapVersionConflictResult.latestLocalPreserved)errors.push({phase:'bootstrap-version-conflict',level:'error',text:JSON.stringify(bootstrapVersionConflictResult)});
    } catch (error) {
      errors.push({ phase: 'bootstrap-version-conflict', level: 'error', text: error.stack || String(error) });
    }
  }
}
let bootstrapScopeIsolationResult = null;
if (bootstrapScopeIsolation) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'bootstrap-scope-isolation', level: 'error', text: 'Scope-isolation verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script = window.document.createElement('script');
      script.textContent = `window.__bootstrapScopeIsolationPromise=(async()=>{
        await window.JustFunEntitySyncV783.flushAndConfirm();window.__suppressEntitySync=true;const B=window.TeplitsaWarehouseBootstrap,registry=B.getRegistry(),warehouseA=String(registry.activeWarehouseId),warehouseB='bootstrap-scope-b',now=new Date().toISOString(),baseWarehouse=registry.warehouses.find(item=>String(item.id)===warehouseA)||{};if(!warehouseA)throw new Error('Активный склад A не найден.');if(!registry.warehouses.some(item=>item.id===warehouseB))registry.warehouses.push({...baseWarehouse,id:warehouseB,code:'SCOPE-B',name:'Склад B',status:'active',createdAt:now,updatedAt:now});B.saveRegistry(registry);
        const order=(id,warehouseId,label)=>({id,number:id,warehouseId,orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:label,contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'}),orderA=order('scope-order-a',warehouseA,'Склад A'),orderB=order('scope-order-b',warehouseB,'Склад B');window.__serverEntityMap.clear();window.__serverEntityMap.set('orders:'+orderA.id,{type:'orders',id:orderA.id,warehouseId:warehouseA,version:1,event_id:++window.__serverCursor,digest_sha256:'A'.repeat(64),payload:cloneValue(orderA)});window.__serverEntityMap.set('orders:'+orderB.id,{type:'orders',id:orderB.id,warehouseId:warehouseB,version:1,event_id:++window.__serverCursor,digest_sha256:'B'.repeat(64),payload:cloneValue(orderB)});
        try{
          B.setActive(warehouseA);window.JustFunEntitySyncV783.status();window.__holdEntityBootstrap=true;window.__holdEntityBootstrapFor=warehouseA;window.__entityBootstrapStarted=false;const bootstrapA=window.__JustFunEntitySyncTestV783.bootstrap(true);for(let attempt=0;attempt<100&&!window.__entityBootstrapStarted;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entityBootstrapStartedWarehouse!==warehouseA)throw new Error('Bootstrap склада A не задержан.');
          B.setActive(warehouseB);const storedBOnFirstSwitch=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseB,'live');await window.TeplitsaWarehouseV600.importServerSnapshot(storedBOnFirstSwitch);const statusAfterSwitch=window.JustFunEntitySyncV783.status();const bootstrapBResult=await window.__JustFunEntitySyncTestV783.bootstrap(true),statusAfterB=window.JustFunEntitySyncV783.status(),bPresent=orders.some(item=>item.id===orderB.id),aAbsent=!orders.some(item=>item.id===orderA.id),uploadsBefore=window.__entitySyncPayloads.length;orders.unshift(order('scope-order-b-local',warehouseB,'Локально на складе B'));window.persistOrders();await window.JustFunEntitySyncV783.flushAndConfirm();const bUploadBeforeARelease=window.__entitySyncPayloads.slice(uploadsBefore).some(payload=>String(payload.warehouseId)===warehouseB);window.__releaseEntityBootstrap?.();const bootstrapAResult=await bootstrapA,statusAfterA=window.JustFunEntitySyncV783.status();
          B.setActive(warehouseA);const storedABeforeStale=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseA,'live');if(storedABeforeStale)window.TeplitsaWarehouseV600.importServerSnapshot(storedABeforeStale);window.JustFunEntitySyncV783.status();await window.__JustFunEntitySyncTestV783.bootstrap(true);window.__suppressEntitySync=false;const scopeA=window.JustFunEntitySyncV783.status().scope,staleOrder=order('scope-outbox-a',warehouseA,'Ответ склада A');window.__holdEntitySyncFor=warehouseA;window.__entitySyncStartedWarehouse='';orders.unshift(staleOrder);window.persistOrders();for(let attempt=0;attempt<200&&window.__entitySyncStartedWarehouse!==warehouseA;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entitySyncStartedWarehouse!==warehouseA)throw new Error('Outbox-запрос склада A не задержан.');
          B.setActive(warehouseB);const storedBBeforeStale=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseB,'live');await window.TeplitsaWarehouseV600.importServerSnapshot(storedBBeforeStale);window.JustFunEntitySyncV783.status();await window.__JustFunEntitySyncTestV783.bootstrap(true);window.__JustFunEntitySyncTestV783.pausePolling();const statusBeforeStale=window.JustFunEntitySyncV783.status();window.__releaseEntitySync?.();let staleEntry=null;for(let attempt=0;attempt<200;attempt++){staleEntry=window.JustFunLocalOutboxV783.create(localStorage,scopeA).list().find(entry=>entry.changes.some(change=>change.type==='orders'&&change.id===staleOrder.id));if(staleEntry?.state==='pending')break;await new Promise(resolve=>setTimeout(resolve,10))}await new Promise(resolve=>setTimeout(resolve,25));const statusAfterStale=window.JustFunEntitySyncV783.status(),staleScopeStable=statusAfterStale.scope===statusBeforeStale.scope,staleCursorStable=statusAfterStale.cursor===statusBeforeStale.cursor,staleOrderAbsent=!orders.some(item=>item.id===staleOrder.id),staleResponseIgnored=staleScopeStable&&staleCursorStable&&staleOrderAbsent,staleOutboxDeferred=staleEntry?.state==='pending',staleCommandId=String(staleEntry?.commandId||''),crossServerA=[...window.__serverEntityMap.values()].filter(item=>String(item.warehouseId||'')===warehouseA&&item.payload?.warehouseId&&String(item.payload.warehouseId)!==warehouseA),crossServerB=[...window.__serverEntityMap.values()].filter(item=>String(item.warehouseId||'')===warehouseB&&item.payload?.warehouseId&&String(item.payload.warehouseId)!==warehouseB);if(crossServerA.length||crossServerB.length)throw new Error('Тестовый VPS получил cross-scope payload: '+JSON.stringify({entities:[...crossServerA,...crossServerB].map(item=>({type:item.type,id:item.id,serverWarehouseId:item.warehouseId,payloadWarehouseId:item.payload?.warehouseId})),payloads:window.__entitySyncPayloads.filter(payload=>payload.changes?.some(change=>[...crossServerA,...crossServerB].some(item=>item.type===change.type&&item.id===change.id)))}));B.setActive(warehouseA);const storedAForReplay=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseA,'live');if(storedAForReplay)await window.TeplitsaWarehouseV600.importServerSnapshot(storedAForReplay);window.JustFunEntitySyncV783.status();await window.__JustFunEntitySyncTestV783.bootstrap(true);await window.__JustFunEntitySyncTestV783.drain({targetCommandId:staleCommandId,force:true});const staleConfirmed=window.JustFunLocalOutboxV783.create(localStorage,scopeA).get(staleCommandId),staleOutboxConfirmedAfterReturn=staleConfirmed?.state==='confirmed',staleReplayObserved=window.__replayedEntityCommands.includes(warehouseA+':'+staleCommandId);B.setActive(warehouseB);const storedBAfterReplay=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseB,'live');await window.TeplitsaWarehouseV600.importServerSnapshot(storedBAfterReplay);window.JustFunEntitySyncV783.status();
          return{warehouseA,warehouseB,bootstrapAResult,bootstrapBResult,bPresent,aAbsent,currentNotBlocked:statusAfterB.inFlight===false,bUploadBeforeARelease,scopeAfterSwitch:statusAfterSwitch.scope,scopeAfterB:statusAfterB.scope,scopeAfterA:statusAfterA.scope,scopePreserved:statusAfterA.scope.endsWith(':'+warehouseB),epochStable:statusAfterB.scopeEpoch===statusAfterSwitch.scopeEpoch,staleOutboxDeferred,staleOutboxConfirmedAfterReturn,staleReplayObserved,staleScopeStable,staleCursorStable,staleOrderAbsent,staleResponseIgnored};
        }finally{window.__suppressEntitySync=false;window.__holdEntityBootstrap=false;window.__holdEntityBootstrapFor='';window.__releaseEntityBootstrap?.();window.__releaseEntityBootstrap=null;window.__holdEntitySyncFor='';window.__releaseEntitySync?.();window.__releaseEntitySync=null}
      })();`;
      window.document.body.append(script);
      bootstrapScopeIsolationResult = await window.__bootstrapScopeIsolationPromise;
      if(bootstrapScopeIsolationResult.bootstrapAResult!==false||bootstrapScopeIsolationResult.bootstrapBResult!==true||!bootstrapScopeIsolationResult.bPresent||!bootstrapScopeIsolationResult.aAbsent||!bootstrapScopeIsolationResult.currentNotBlocked||!bootstrapScopeIsolationResult.bUploadBeforeARelease||!bootstrapScopeIsolationResult.scopePreserved||!bootstrapScopeIsolationResult.epochStable||!bootstrapScopeIsolationResult.staleOutboxDeferred||!bootstrapScopeIsolationResult.staleOutboxConfirmedAfterReturn||!bootstrapScopeIsolationResult.staleReplayObserved||!bootstrapScopeIsolationResult.staleResponseIgnored)errors.push({phase:'bootstrap-scope-isolation',level:'error',text:JSON.stringify(bootstrapScopeIsolationResult)});
    } catch (error) {
      errors.push({ phase: 'bootstrap-scope-isolation', level: 'error', text: error.stack || String(error) });
    }
  }
}
let backgroundScopeRaceResult = null;
if (backgroundScopeRace) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'background-scope-race', level: 'error', text: 'Background scope-race verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script=window.document.createElement('script');
      script.textContent=`window.__backgroundScopeRacePromise=(async()=>{
        const B=window.TeplitsaWarehouseBootstrap;await window.JustFunEntitySyncV783.flushAndConfirm();const registry=B.getRegistry(),warehouseA=String(registry.activeWarehouseId),warehouseB='background-race-b',now=new Date().toISOString(),base=registry.warehouses.find(item=>String(item.id)===warehouseA)||{};if(!warehouseA)throw new Error('Активный склад A не найден.');if(!registry.warehouses.some(item=>item.id===warehouseB))registry.warehouses.push({...base,id:warehouseB,code:'BGR',name:'Фоновый склад B',status:'active',createdAt:now,updatedAt:now});B.saveRegistry(registry);B.setActive(warehouseA);const scopeA=window.JustFunEntitySyncV783.status().scope,order=(id,warehouseId,label)=>normalizeOrder({id,number:id,warehouseId,orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:label,contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});
        orders=orders.filter(item=>item.id!=='background-race-a');orders.unshift(order('background-race-a',warehouseA,'Данные A'));window.persistOrders();await window.TeplitsaWarehouseV600.whenPersisted();window.__JustFunEntitySyncTestV783.pausePolling();let releasePersist;ordersPersistChain=new Promise(resolve=>{releasePersist=resolve});window.__JustFunEntitySyncTestV783.markDirty();const pending=window.__JustFunEntitySyncTestV783.background({force:true});await Promise.resolve();B.setActive(warehouseB);const scopeB=window.JustFunEntitySyncV783.status().scope;orders=[order('background-race-b',warehouseB,'Данные B')];window.__JustFunEntitySyncTestV783.markDirty();const before=window.JustFunEntitySyncV783.status();releasePersist(true);const outcome=await pending;ordersPersistChain=Promise.resolve(true);const after=window.JustFunEntitySyncV783.status(),queueA=window.JustFunLocalOutboxV783.create(localStorage,scopeA),queueB=window.JustFunLocalOutboxV783.create(localStorage,scopeB),aHasB=queueA.list().some(entry=>entry.warehouseId===warehouseB||entry.changes.some(change=>change.id==='background-race-b')),bChanged=queueB.status().active!==before.outbox.active,queuedBeforeReturn=queueA.status();B.setActive(warehouseA);window.JustFunEntitySyncV783.status();const storedA=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseA,'live');await window.TeplitsaWarehouseV600.importServerSnapshot(storedA);await window.TeplitsaWarehouseV600.whenPersisted();const drained=await window.__JustFunEntitySyncTestV783.drain({force:true});await window.__JustFunEntitySyncTestV783.bootstrap(true);const aQueueAfter=window.JustFunLocalOutboxV783.create(localStorage,scopeA).status(),converged=orders.some(item=>item.id==='background-race-a');
        return{warehouseA,warehouseB,outcome,scopeA,scopeB,currentScopePreserved:after.scope===before.scope&&after.scope===scopeB,currentStatePreserved:after.serial===before.serial&&after.dirty===before.dirty,aHasB,bChanged,queuedBeforeReturn,drainState:drained?.state||'',converged,aQueueAfter,bQueue:queueB.status()}
      })();`;
      window.document.body.append(script);
      backgroundScopeRaceResult=await window.__backgroundScopeRacePromise;
      if(backgroundScopeRaceResult.outcome?.state!=='stale-scope-captured'||backgroundScopeRaceResult.outcome?.captured<1||!backgroundScopeRaceResult.currentScopePreserved||!backgroundScopeRaceResult.currentStatePreserved||backgroundScopeRaceResult.aHasB||backgroundScopeRaceResult.bChanged||backgroundScopeRaceResult.queuedBeforeReturn?.active<1||backgroundScopeRaceResult.drainState!=='confirmed'||!backgroundScopeRaceResult.converged||backgroundScopeRaceResult.aQueueAfter?.active!==0)errors.push({phase:'background-scope-race',level:'error',text:JSON.stringify(backgroundScopeRaceResult)});
    } catch (error) {
      errors.push({ phase: 'background-scope-race', level: 'error', text: error.stack || String(error) });
    }
  }
}
let outboxAbaRaceResult = null;
if (outboxAbaRace) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'outbox-aba-race', level: 'error', text: 'Outbox A-B-A verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script=window.document.createElement('script');
      script.textContent=`window.__outboxAbaRacePromise=(async()=>{
        const B=window.TeplitsaWarehouseBootstrap;await window.JustFunEntitySyncV783.flushAndConfirm();const registry=B.getRegistry(),warehouseA=String(registry.activeWarehouseId),warehouseB='outbox-aba-b',now=new Date().toISOString(),base=registry.warehouses.find(item=>String(item.id)===warehouseA)||{};if(!warehouseA)throw new Error('Активный склад A не найден.');if(!registry.warehouses.some(item=>item.id===warehouseB))registry.warehouses.push({...base,id:warehouseB,code:'ABA',name:'Склад ABA B',status:'active',createdAt:now,updatedAt:now});B.saveRegistry(registry);B.setActive(warehouseA);const scopeA=window.JustFunEntitySyncV783.status().scope,change=id=>({type:'orders',id,baseVersion:0,deleted:false,payload:{id,warehouseId:warehouseA,number:id,contactName:id},_fingerprint:id});window.__entitySyncPayloads.length=0;window.__entitySyncMaxByWarehouse.clear();window.__suppressEntitySync=true;
        const first=window.__JustFunEntitySyncTestV783.enqueue({kind:'aba-first',targetId:'aba-command-1'},[change('aba-order-1')]);window.__holdEntitySyncFor=warehouseA;window.__entitySyncStartedWarehouse='';const firstDrain=window.__JustFunEntitySyncTestV783.drain({targetCommandId:first.commandId,force:true});for(let attempt=0;attempt<200&&window.__entitySyncStartedWarehouse!==warehouseA;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entitySyncStartedWarehouse!==warehouseA)throw new Error('Первый drain склада A не задержан.');B.setActive(warehouseB);window.JustFunEntitySyncV783.status();B.setActive(warehouseA);window.JustFunEntitySyncV783.status();const second=window.__JustFunEntitySyncTestV783.enqueue({kind:'aba-second',targetId:'aba-command-2'},[change('aba-order-2')]),secondDrain=window.__JustFunEntitySyncTestV783.drain({targetCommandId:second.commandId,force:true});await new Promise(resolve=>setTimeout(resolve,100));const secondStartedBeforeRelease=window.__entitySyncPayloads.some(payload=>payload.commandId===second.commandId);window.__releaseEntitySync?.();const results=await Promise.all([firstDrain,secondDrain]);let queue=window.JustFunLocalOutboxV783.create(localStorage,scopeA),firstSaved=queue.get(first.commandId),secondSaved=queue.get(second.commandId),maxConcurrent=window.__entitySyncMaxByWarehouse.get(warehouseA)||0;window.__suppressEntitySync=false;const third=window.__JustFunEntitySyncTestV783.enqueue({kind:'stale-ack',targetId:'stale-ack-command'},[change('aba-order-stale-ack')]);window.__holdEntitySyncFor=warehouseA;window.__entitySyncStartedWarehouse='';const thirdDrain=window.__JustFunEntitySyncTestV783.drain({targetCommandId:third.commandId,force:true});for(let attempt=0;attempt<200&&window.__entitySyncStartedWarehouse!==warehouseA;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entitySyncStartedWarehouse!==warehouseA)throw new Error('Третий drain склада A не задержан.');B.setActive(warehouseB);window.JustFunEntitySyncV783.status();window.__releaseEntitySync?.();const thirdResult=await thirdDrain,thirdAttemptsBeforeReturn=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+third.commandId)).length,queueAfterStaleAck=window.JustFunLocalOutboxV783.create(localStorage,scopeA).status();B.setActive(warehouseA);const statusAfterReturn=window.JustFunEntitySyncV783.status();await window.__JustFunEntitySyncTestV783.bootstrap(true);await window.__JustFunEntitySyncTestV783.drain({targetCommandId:third.commandId,force:true});queue=window.JustFunLocalOutboxV783.create(localStorage,scopeA);const thirdAttemptsAfterBootstrap=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+third.commandId)).length,replayObserved=window.__replayedEntityCommands.includes(warehouseA+':'+third.commandId),sameCommandReplay=thirdAttemptsBeforeReturn===1&&thirdAttemptsAfterBootstrap===2&&replayObserved&&queue.status().active===0&&window.JustFunEntitySyncV783.status().conflicts===0;
        return{warehouseA,warehouseB,secondStartedBeforeRelease,maxConcurrent,firstState:firstSaved?.state||'',secondState:secondSaved?.state||'',bothPreserved:Boolean(firstSaved&&secondSaved),results,thirdState:queue.get(third.commandId)?.state||'',thirdResult:thirdResult?.state||'',queueAfterStaleAck,dirtyAfterReturn:statusAfterReturn.dirty,thirdAttemptsBeforeReturn,thirdAttemptsAfterBootstrap,replayObserved,finalActive:queue.status().active,finalConflicts:window.JustFunEntitySyncV783.status().conflicts,sameCommandReplay}
      })().finally(()=>{window.__suppressEntitySync=false;window.__holdEntitySyncFor='';window.__releaseEntitySync?.();window.__releaseEntitySync=null});`;
      window.document.body.append(script);
      outboxAbaRaceResult=await window.__outboxAbaRacePromise;
      if(outboxAbaRaceResult.secondStartedBeforeRelease||outboxAbaRaceResult.maxConcurrent!==1||!outboxAbaRaceResult.bothPreserved||outboxAbaRaceResult.firstState!=='confirmed'||outboxAbaRaceResult.secondState!=='confirmed'||outboxAbaRaceResult.thirdState!=='confirmed'||outboxAbaRaceResult.thirdResult!=='pending'||outboxAbaRaceResult.queueAfterStaleAck?.active!==1||!outboxAbaRaceResult.dirtyAfterReturn||!outboxAbaRaceResult.sameCommandReplay)errors.push({phase:'outbox-aba-race',level:'error',text:JSON.stringify(outboxAbaRaceResult)});
    } catch (error) {
      errors.push({ phase: 'outbox-aba-race', level: 'error', text: error.stack || String(error) });
    }
  }
}
let criticalScopeGuardResult = null;
if (criticalScopeGuard) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'critical-scope-guard', level: 'error', text: 'Critical scope-guard verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script=window.document.createElement('script');
      script.textContent=`window.__criticalScopeGuardPromise=(async()=>{
        const previousConfirm=jfConfirm;jfConfirm=async()=>true;const B=window.TeplitsaWarehouseBootstrap,registry=B.getRegistry(),warehouseA=String(registry.activeWarehouseId),warehouseB='critical-guard-b',now=new Date().toISOString(),base=registry.warehouses.find(item=>String(item.id)===warehouseA)||{};if(!warehouseA)throw new Error('Активный склад A не найден.');if(!registry.warehouses.some(item=>item.id===warehouseB))registry.warehouses.push({...base,id:warehouseB,code:'CRG',name:'Критический склад B',status:'active',createdAt:now,updatedAt:now});B.saveRegistry(registry);B.setActive(warehouseA);window.JustFunEntitySyncV783.status();const id='critical-guard-order',order=normalizeOrder({id,number:id,warehouseId:warehouseA,orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:'Критический откат',contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});
        try{orders=orders.filter(item=>item.id!==id);orders.unshift(order);window.persistOrders();await window.TeplitsaWarehouseV600.whenPersisted();await window.JustFunEntitySyncV783.flushAndConfirm();window.__entitySyncPayloads.length=0;window.__holdEntitySyncFor=warehouseA;window.__entitySyncStartedWarehouse='';const pending=window.clearAll();for(let attempt=0;attempt<200&&window.__entitySyncStartedWarehouse!==warehouseA;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entitySyncStartedWarehouse!==warehouseA)throw new Error('Критический запрос не задержан.');const codes={};try{B.setActive(warehouseB)}catch(error){codes.setActive=String(error?.code||'')}try{const next=B.getRegistry();next.activeWarehouseId=warehouseB;B.saveRegistry(next)}catch(error){codes.saveRegistry=String(error?.code||'')}try{B.setDemo(true,warehouseA)}catch(error){codes.setDemo=String(error?.code||'')}const unloadEvent=new Event('beforeunload',{cancelable:true}),unloadAllowed=window.dispatchEvent(unloadEvent),logoutResult=await window.__JustFunEntitySyncTestV783.logout(),reloadResult=window.__JustFunEntitySyncTestV783.reload('critical-test',warehouseB),activeWhileHeld=String(B.activeWarehouse()?.id||''),liveWhileHeld=B.isDemo(warehouseA)===false,criticalWhileHeld=window.JustFunEntitySyncV783.status().criticalInFlight;window.__rejectEntitySync=true;window.__releaseEntitySync?.();const mutationResult=await pending;await window.TeplitsaWarehouseV600.whenPersisted();const stored=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseA,'live'),localRestored=orders.some(item=>item.id===id),storedRestored=stored.data.orders.some(item=>item.id===id),lockReleased=window.JustFunEntitySyncV783.canChangeContext();window.__rejectEntitySync=false;B.setActive(warehouseB);const switchAfterRelease=String(B.activeWarehouse()?.id||'')===warehouseB;return{codes,unloadBlocked:unloadAllowed===false||unloadEvent.defaultPrevented,logoutBlocked:logoutResult===false,reloadBlocked:reloadResult===false,activeWhileHeld,liveWhileHeld,criticalWhileHeld,mutationResult,localRestored,storedRestored,lockReleased,switchAfterRelease}}
        finally{jfConfirm=previousConfirm;window.__rejectEntitySync=false;window.__holdEntitySyncFor='';window.__releaseEntitySync?.();window.__releaseEntitySync=null}
      })();`;
      window.document.body.append(script);
      criticalScopeGuardResult=await window.__criticalScopeGuardPromise;
      const guardCode='ENTITY_CRITICAL_OPERATION_IN_FLIGHT',codes=criticalScopeGuardResult.codes||{};
      if(codes.setActive!==guardCode||codes.saveRegistry!==guardCode||codes.setDemo!==guardCode||!criticalScopeGuardResult.unloadBlocked||!criticalScopeGuardResult.logoutBlocked||!criticalScopeGuardResult.reloadBlocked||!criticalScopeGuardResult.liveWhileHeld||criticalScopeGuardResult.criticalWhileHeld<1||criticalScopeGuardResult.mutationResult!==false||!criticalScopeGuardResult.localRestored||!criticalScopeGuardResult.storedRestored||!criticalScopeGuardResult.lockReleased||!criticalScopeGuardResult.switchAfterRelease)errors.push({phase:'critical-scope-guard',level:'error',text:JSON.stringify(criticalScopeGuardResult)});
    } catch (error) {
      errors.push({ phase: 'critical-scope-guard', level: 'error', text: error.stack || String(error) });
    }
  }
}
let criticalCrashRecoveryResult = null;
if (criticalCrashRecovery) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'critical-crash-recovery', level: 'error', text: 'Critical crash-recovery verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      const script=window.document.createElement('script');
      script.textContent=`window.__criticalCrashRecoveryPromise=(async()=>{
        const B=window.TeplitsaWarehouseBootstrap,test=window.__JustFunEntitySyncTestV783;await window.JustFunEntitySyncV783.flushAndConfirm();const warehouseId=String(B.activeWarehouse()?.id||''),now=new Date().toISOString(),id='critical-crash-order',order=normalizeOrder({id,number:id,warehouseId,orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:'Аварийное восстановление',contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});orders=orders.filter(item=>item.id!==id);orders.unshift(order);window.persistOrders();await window.TeplitsaWarehouseV600.whenPersisted();await window.JustFunEntitySyncV783.flushAndConfirm();const rollbackSnapshot=cloneValue(buildBackupPayload());await test.prepareCriticalRecovery(rollbackSnapshot,{kind:'runtime_crash_simulation',targetId:id});const journalBefore=await test.readCriticalRecovery();orders=orders.filter(item=>item.id!==id);window.persistOrders();await window.TeplitsaWarehouseV600.whenPersisted();const missingBeforeRecovery=!orders.some(item=>item.id===id);test.simulateRestart();const recoveredPrepared=await test.recoverCritical(),preparedJournalAfter=await test.readCriticalRecovery(),preparedStored=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseId,'live'),preparedLocalRestored=orders.some(item=>item.id===id),preparedStoredRestored=preparedStored.data.orders.some(item=>item.id===id);await test.bootstrap(true);await test.drain({force:true});const staged=await test.simulateCriticalPending(async()=>{orders=orders.filter(item=>item.id!==id);window.persistOrders()},{kind:'order_delete',targetId:id}),pendingJournal=await test.readCriticalRecovery();test.simulateRestart();test.setOffline(true);let offlineCode='';try{await test.recoverCritical()}catch(error){offlineCode=String(error?.code||'')}const journalAfterOffline=await test.readCriticalRecovery(),postPreservedOffline=!orders.some(item=>item.id===id);test.setOffline(false);window.__entityPostCommitFaultFor=staged.commandId;window.__entityPostCommitFaultMode='lost';let lostResponseCode='';try{await test.recoverCritical()}catch(error){lostResponseCode=String(error?.code||'')}const journalAfterLost=await test.readCriticalRecovery(),serverCursorAfterLost=window.__serverCursor,attemptsAfterLost=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+staged.commandId)).length;test.simulateRestart();const recoveredPending=await test.recoverCritical(),pendingJournalAfter=await test.readCriticalRecovery(),pendingStored=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseId,'live'),attemptsAfterReplay=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+staged.commandId)).length,serverConverged=!window.__serverEntityMap.has('orders:'+id),localPostPreserved=!orders.some(item=>item.id===id),storedPostPreserved=!pendingStored.data.orders.some(item=>item.id===id),idempotentReplay=attemptsAfterLost===1&&attemptsAfterReplay===2&&window.__serverCursor===serverCursorAfterLost,malformedId='critical-malformed-ack-order',malformedOrder=normalizeOrder({...cloneValue(order),id:malformedId,number:malformedId,contactName:'Malformed ACK',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),malformed=await test.simulateCriticalPending(async()=>{orders=orders.filter(item=>item.id!==malformedId);orders.unshift(malformedOrder);window.persistOrders()},{kind:'order_save',targetId:malformedId});test.simulateRestart();window.__entityPostCommitFaultFor=malformed.commandId;window.__entityPostCommitFaultMode='malformed-ack';let malformedAckCode='';try{await test.recoverCritical()}catch(error){malformedAckCode=String(error?.code||'')}const malformedJournalRetained=Boolean(await test.readCriticalRecovery()),malformedPostPreserved=orders.some(item=>item.id===malformedId),malformedServerCommitted=window.__serverEntityMap.has('orders:'+malformedId),malformedCursor=window.__serverCursor,malformedAttemptsFirst=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+malformed.commandId)).length;test.simulateRestart();const malformedRecovered=await test.recoverCritical(),malformedJournalCleared=(await test.readCriticalRecovery())===null,malformedAttemptsReplay=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+malformed.commandId)).length,malformedReplayStable=malformedAttemptsFirst===1&&malformedAttemptsReplay===2&&window.__serverCursor===malformedCursor&&window.__replayedEntityCommands.some(value=>value.endsWith(':'+malformed.commandId));return{warehouseId,journalPrepared:Boolean(journalBefore),missingBeforeRecovery,recoveredPrepared,preparedJournalCleared:preparedJournalAfter===null,preparedLocalRestored,preparedStoredRestored,pendingPhase:pendingJournal?.phase||'',offlineCode,journalRetainedOffline:Boolean(journalAfterOffline),postPreservedOffline,lostResponseCode,journalRetainedAfterLost:Boolean(journalAfterLost),recoveredPending,pendingJournalCleared:pendingJournalAfter===null,serverConverged,localPostPreserved,storedPostPreserved,idempotentReplay,attemptsAfterLost,attemptsAfterReplay,malformedAckCode,malformedJournalRetained,malformedPostPreserved,malformedServerCommitted,malformedRecovered,malformedJournalCleared,malformedReplayStable}
      })();`;
      window.document.body.append(script);
      criticalCrashRecoveryResult=await window.__criticalCrashRecoveryPromise;
      if(!criticalCrashRecoveryResult.journalPrepared||!criticalCrashRecoveryResult.missingBeforeRecovery||criticalCrashRecoveryResult.recoveredPrepared!==true||!criticalCrashRecoveryResult.preparedJournalCleared||!criticalCrashRecoveryResult.preparedLocalRestored||!criticalCrashRecoveryResult.preparedStoredRestored||criticalCrashRecoveryResult.pendingPhase!=='pending_server'||criticalCrashRecoveryResult.offlineCode!=='CRITICAL_RECOVERY_SERVER_UNAVAILABLE'||!criticalCrashRecoveryResult.journalRetainedOffline||!criticalCrashRecoveryResult.postPreservedOffline||criticalCrashRecoveryResult.lostResponseCode!=='NETWORK_ERROR'||!criticalCrashRecoveryResult.journalRetainedAfterLost||criticalCrashRecoveryResult.recoveredPending!==true||!criticalCrashRecoveryResult.pendingJournalCleared||!criticalCrashRecoveryResult.serverConverged||!criticalCrashRecoveryResult.localPostPreserved||!criticalCrashRecoveryResult.storedPostPreserved||!criticalCrashRecoveryResult.idempotentReplay||criticalCrashRecoveryResult.malformedAckCode!=='REG_ENTITY_ACK_INVALID'||!criticalCrashRecoveryResult.malformedJournalRetained||!criticalCrashRecoveryResult.malformedPostPreserved||!criticalCrashRecoveryResult.malformedServerCommitted||criticalCrashRecoveryResult.malformedRecovered!==true||!criticalCrashRecoveryResult.malformedJournalCleared||!criticalCrashRecoveryResult.malformedReplayStable)errors.push({phase:'critical-crash-recovery',level:'error',text:JSON.stringify(criticalCrashRecoveryResult)});
    } catch (error) {
      errors.push({ phase: 'critical-crash-recovery', level: 'error', text: error.stack || String(error) });
    }
  }
}
let criticalStorageFailoverResult = null;
if(criticalStorageFailover){
  if(testEdition!=='full')errors.push({phase:'critical-storage-failover',level:'error',text:'Critical storage failover verification must run in full edition.'});
  else{
    try{
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();window.__JustFunEntitySyncTestV783.pausePolling();const script=window.document.createElement('script');
      script.textContent=`window.__criticalStorageFailoverPromise=(async()=>{
        const api=window.TeplitsaWarehouseV600.criticalRecovery,test=window.__JustFunEntitySyncTestV783,warehouseId=String(window.TeplitsaWarehouseBootstrap.activeWarehouse()?.id||''),companyId=String(window.JustFunDesktop.bootstrapCompanyId||''),environment='live',before=cloneValue(buildBackupPayload()),after=cloneValue(before),id='critical-storage-order',criticalDb=()=>[...window.__fakeIndexedDbRecords.entries()].find(([name])=>String(name).includes('justfun_critical_recovery'))?.[1]||null;
        after.data.orders=[...(after.data.orders||[]),{id,warehouseId,number:id,contactName:'Storage failover'}];const change={type:'orders',id,baseVersion:0,deleted:false,payload:after.data.orders.find(item=>item.id===id),_fingerprint:'storage-failover'},commandId='client:critical-storage-failover:0001',base={companyId,warehouseId,environment,commandId,intent:{kind:'order_save',targetId:id},snapshot:before,createdAt:new Date().toISOString()};
        const wrongEnvironmentSnapshot=cloneValue(before);wrongEnvironmentSnapshot.warehouse={...(wrongEnvironmentSnapshot.warehouse||{}),id:warehouseId,environment:'demo'};let environmentMismatchCode='';try{await api.prepare({...base,snapshot:wrongEnvironmentSnapshot,phase:'prepared'})}catch(error){environmentMismatchCode=String(error?.code||'')}
        await api.prepare({...base,phase:'prepared'});const fallbackKey=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).find(key=>String(key||'').includes('justfun_critical_recovery')),originalEnvelope=String(localStorage.getItem(fallbackKey)||'');if(!fallbackKey||!originalEnvelope)throw new Error('Fallback аварийного журнала не найден.');const originalParsed=JSON.parse(originalEnvelope),legacyRecord=cloneValue(originalParsed.record),legacyFingerprint=value=>{let hash=2166136261;for(const ch of String(value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)}return((hash>>>0).toString(16).padStart(8,'0'))+':'+String(value).length};legacyRecord.schemaVersion=1;delete legacyRecord.storageGeneration;const legacySerialized=JSON.stringify(legacyRecord),legacyEnvelope={storageProtocol:2,kind:'record',external:false,companyId,warehouseId,environment,commandId,phase:'prepared',fingerprint:legacyFingerprint(legacySerialized),record:legacyRecord,writtenAt:new Date().toISOString()};criticalDb().record=cloneValue(legacyRecord);localStorage.setItem(fallbackKey,JSON.stringify(legacyEnvelope));const protocol2Inline=await api.read(warehouseId,environment,companyId);localStorage.setItem(fallbackKey,JSON.stringify({...legacyEnvelope,external:true,record:null}));const protocol2External=await api.read(warehouseId,environment,companyId);criticalDb().record=cloneValue(originalParsed.record);localStorage.setItem(fallbackKey,originalEnvelope);
        let unknownPhaseCode='',futureSchemaCode='',wrongTombstoneCode='';const unknownPhaseEnvelope=JSON.parse(originalEnvelope);unknownPhaseEnvelope.record.phase='future_phase';localStorage.setItem(fallbackKey,JSON.stringify(unknownPhaseEnvelope));try{await api.read(warehouseId,environment,companyId)}catch(error){unknownPhaseCode=String(error?.code||'')}localStorage.setItem(fallbackKey,originalEnvelope);
        const futureSchemaEnvelope=JSON.parse(originalEnvelope);futureSchemaEnvelope.record.schemaVersion=99;localStorage.setItem(fallbackKey,JSON.stringify(futureSchemaEnvelope));try{await api.read(warehouseId,environment,companyId)}catch(error){futureSchemaCode=String(error?.code||'')}localStorage.setItem(fallbackKey,originalEnvelope);
        localStorage.setItem(fallbackKey,JSON.stringify({storageProtocol:2,kind:'cleared',companyId,warehouseId,environment:'demo',clearedAt:new Date().toISOString()}));try{await api.read(warehouseId,environment,companyId)}catch(error){wrongTombstoneCode=String(error?.code||'')}localStorage.setItem(fallbackKey,originalEnvelope);
        await api.prepare({...base,phase:'pending_server',changes:[change],postSnapshot:after,updatedAt:new Date().toISOString()});const pendingEnvelope=String(localStorage.getItem(fallbackKey)||''),idbPendingGeneration=Number(criticalDb()?.record?.storageGeneration||0);localStorage.setItem(fallbackKey,originalEnvelope);const newerIdbPending=await api.read(warehouseId,environment,companyId);await window.TeplitsaWarehouseV600.importServerSnapshot(after);await window.TeplitsaWarehouseV600.whenPersisted();window.__fakeIndexedDbFailNextRead=true;let failedReadRecoveryCode='';try{await test.recoverCritical()}catch(error){failedReadRecoveryCode=String(error?.code||'')}const idbAfterFailedRead=cloneValue(criticalDb()?.record),postLocalPreservedAfterReadFailure=orders.some(item=>item.id===id);test.simulateRestart();localStorage.setItem(fallbackKey,pendingEnvelope);const pendingAfterReadFailure=await api.read(warehouseId,environment,companyId);
        window.__fakeIndexedDbFailNextWrite=true;await api.prepare({...base,phase:'pending_server',changes:[change],postSnapshot:after,updatedAt:new Date().toISOString()});const pending=await api.read(warehouseId,environment,companyId),idbBeforeClear=criticalDb()?.record;let failedClearCode='';window.__fakeIndexedDbFailNextWrite=true;try{await api.clear(warehouseId,environment,companyId,commandId)}catch(error){failedClearCode=String(error?.code||'')}const afterFailedDelete=await api.read(warehouseId,environment,companyId),idbAfterFailedDelete=criticalDb()?.record,staleClearedEnvelope=String(localStorage.getItem(fallbackKey)||''),newerCommand='client:critical-storage-newer:0002';await api.prepare({...base,commandId:newerCommand,phase:'prepared',updatedAt:new Date().toISOString()});const newerEnvelope=String(localStorage.getItem(fallbackKey)||'');localStorage.setItem(fallbackKey,staleClearedEnvelope);const newerIdbCommand=(await api.read(warehouseId,environment,companyId))?.commandId||'';localStorage.setItem(fallbackKey,newerEnvelope);await api.clear(warehouseId,environment,companyId,newerCommand);
        window.__fakeLocalStorageRejectLarge=true;const quotaCommand='client:critical-storage-quota:0003';await api.prepare({...base,commandId:quotaCommand,phase:'prepared',updatedAt:new Date().toISOString()});const quotaRead=await api.read(warehouseId,environment,companyId);let envelope=null;for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key&&key.includes('justfun_critical_recovery'))envelope=JSON.parse(localStorage.getItem(key)||'null')}await api.clear(warehouseId,environment,companyId,quotaCommand);let mutationCalled=0;window.__fakeIndexedDbFailNextWrite=true;const initialFailureResult=await window.__JustFunEntitySyncTestV783.commitMutation({kind:'order_delete',targetId:id},async()=>{mutationCalled+=1});const afterInitialFailure=await api.read(warehouseId,environment,companyId);window.__fakeLocalStorageRejectLarge=false;
        return{environmentMismatchCode,protocol2InlineCommand:protocol2Inline?.commandId||'',protocol2InlineSchema:Number(protocol2Inline?.schemaVersion||0),protocol2ExternalCommand:protocol2External?.commandId||'',protocol2ExternalSchema:Number(protocol2External?.schemaVersion||0),unknownPhaseCode,futureSchemaCode,wrongTombstoneCode,pendingPhase:pending?.phase||'',pendingCommand:pending?.commandId||'',newerIdbPendingPhase:newerIdbPending?.phase||'',newerIdbPendingGeneration:Number(newerIdbPending?.storageGeneration||0),idbPendingGeneration,failedReadRecoveryCode,idbPendingPreservedAfterReadFailure:idbAfterFailedRead?.phase==='pending_server'&&idbAfterFailedRead?.commandId===commandId,idbPostSnapshotPreservedAfterReadFailure:idbAfterFailedRead?.postSnapshot?.data?.orders?.some(item=>item.id===id)===true,postLocalPreservedAfterReadFailure,pendingAfterReadFailurePhase:pendingAfterReadFailure?.phase||'',pendingAfterReadFailureCommand:pendingAfterReadFailure?.commandId||'',idbStayedPending:idbBeforeClear?.phase==='pending_server',failedClearCode,tombstoneMasksStale:afterFailedDelete===null,idbWriteActuallyFailed:idbAfterFailedDelete?.phase==='pending_server',newerIdbCommand,quotaPointer:envelope?.storageProtocol===3&&envelope?.kind==='record'&&envelope?.external===true&&envelope?.record===null,quotaReadCommand:quotaRead?.commandId||'',initialFailureResult,initialFailureMutationSkipped:mutationCalled===0,initialFailureCleared:afterInitialFailure===null}
      })();`;
      window.document.body.append(script);criticalStorageFailoverResult=await window.__criticalStorageFailoverPromise;if(criticalStorageFailoverResult.environmentMismatchCode!=='CRITICAL_RECOVERY_SCOPE_MISMATCH'||criticalStorageFailoverResult.protocol2InlineCommand!=='client:critical-storage-failover:0001'||criticalStorageFailoverResult.protocol2InlineSchema!==2||criticalStorageFailoverResult.protocol2ExternalCommand!=='client:critical-storage-failover:0001'||criticalStorageFailoverResult.protocol2ExternalSchema!==2||criticalStorageFailoverResult.unknownPhaseCode!=='CRITICAL_RECOVERY_UNSUPPORTED'||criticalStorageFailoverResult.futureSchemaCode!=='CRITICAL_RECOVERY_UNSUPPORTED'||criticalStorageFailoverResult.wrongTombstoneCode!=='CRITICAL_RECOVERY_CORRUPT'||criticalStorageFailoverResult.pendingPhase!=='pending_server'||criticalStorageFailoverResult.pendingCommand!=='client:critical-storage-failover:0001'||criticalStorageFailoverResult.newerIdbPendingPhase!=='pending_server'||criticalStorageFailoverResult.newerIdbPendingGeneration!==criticalStorageFailoverResult.idbPendingGeneration||criticalStorageFailoverResult.failedReadRecoveryCode!=='CRITICAL_RECOVERY_READ_FAILED'||!criticalStorageFailoverResult.idbPendingPreservedAfterReadFailure||!criticalStorageFailoverResult.idbPostSnapshotPreservedAfterReadFailure||!criticalStorageFailoverResult.postLocalPreservedAfterReadFailure||criticalStorageFailoverResult.pendingAfterReadFailurePhase!=='pending_server'||criticalStorageFailoverResult.pendingAfterReadFailureCommand!=='client:critical-storage-failover:0001'||!criticalStorageFailoverResult.idbStayedPending||criticalStorageFailoverResult.failedClearCode!=='CRITICAL_RECOVERY_CLEAR_FAILED'||!criticalStorageFailoverResult.tombstoneMasksStale||!criticalStorageFailoverResult.idbWriteActuallyFailed||criticalStorageFailoverResult.newerIdbCommand!=='client:critical-storage-newer:0002'||!criticalStorageFailoverResult.quotaPointer||criticalStorageFailoverResult.quotaReadCommand!=='client:critical-storage-quota:0003'||criticalStorageFailoverResult.initialFailureResult!==false||!criticalStorageFailoverResult.initialFailureMutationSkipped||!criticalStorageFailoverResult.initialFailureCleared)errors.push({phase:'critical-storage-failover',level:'error',text:JSON.stringify(criticalStorageFailoverResult)});
    }catch(error){errors.push({phase:'critical-storage-failover',level:'error',text:error.stack||String(error)})}
  }
}
let ordinaryCrashRecoveryResult = null;
if(ordinaryCrashRecovery){
  if(testEdition!=='full')errors.push({phase:'ordinary-crash-recovery',level:'error',text:'Ordinary crash-recovery verification must run in full edition.'});
  else{
    try{
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();window.__JustFunEntitySyncTestV783.pausePolling();const script=window.document.createElement('script');
      script.textContent=`window.__ordinaryCrashRecoveryPromise=(async()=>{
        const B=window.TeplitsaWarehouseBootstrap,test=window.__JustFunEntitySyncTestV783;await window.JustFunEntitySyncV783.flushAndConfirm();
        const warehouseId=String(B.activeWarehouse()?.id||''),now=new Date().toISOString(),id='ordinary-crash-order',oldId='ordinary-old-drain-order',makeOrder=(orderId,name)=>normalizeOrder({id:orderId,number:orderId,warehouseId,orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:name,contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'}),order=makeOrder(id,'Обычная аварийная запись'),old=test.enqueue({kind:'ordinary-old-drain',targetId:oldId},[{type:'orders',id:oldId,baseVersion:0,deleted:false,payload:{id:oldId,warehouseId,number:oldId,contactName:'Старая очередь'},_fingerprint:oldId}]);
        window.__holdEntitySyncFor=warehouseId;window.__entitySyncStartedWarehouse='';const oldDrain=test.drain({targetCommandId:old.commandId,force:true});for(let attempt=0;attempt<200&&window.__entitySyncStartedWarehouse!==warehouseId;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(window.__entitySyncStartedWarehouse!==warehouseId)throw new Error('Старый drain не задержан.');
        const crash=await test.simulateOrdinaryCrash(async()=>{orders=orders.filter(item=>item.id!==id);orders.unshift(order);window.persistOrders()},async()=>{window.__releaseEntitySync?.();const oldResult=await oldDrain;return{oldState:oldResult?.state||'',markerAfterOldDrain:test.dirtyGeneration()}},{intent:{kind:'order_save',targetId:id}}),queueAfterCrash=window.JustFunEntitySyncV783.status().outbox,dirtyAfterCrash=window.JustFunEntitySyncV783.status().dirty,localAfterCrash=orders.some(item=>item.id===id),recoveredUpsert=await test.recoverCritical(),queueAfterRecovery=window.JustFunEntitySyncV783.status().outbox;
        await test.bootstrap(true);await test.drain({force:true});const statusAfterDrain=window.JustFunEntitySyncV783.status(),stored=await window.TeplitsaWarehouseV600.storedSnapshot(warehouseId,'live'),serverConverged=window.__serverEntityMap.has('orders:'+id),payload=window.__entitySyncPayloads.find(item=>item.changes?.some(change=>change.id===id)),attempts=payload?window.__entityCommandAttempts.filter(value=>value.endsWith(':'+payload.commandId)).length:0;
        const previousAccess=test.access(),deleteCrash=await test.simulateOrdinaryCrash(async()=>{orders=orders.filter(item=>item.id!==id);window.persistOrders()},()=>{const stateKey=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).find(key=>String(key||'').startsWith('jf.reg-entity-state.v2.'));if(stateKey)localStorage.setItem(stateKey,'{corrupt');test.setAccess({role:'viewer',permissions:[]});test.setOffline(true)},{intent:{kind:'order_delete',targetId:id}}),recoveredDelete=await test.recoverCritical(),deleteJournalCleared=(await test.readCriticalRecovery())===null,deleteQueue=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope),deleteEntry=deleteQueue.get(deleteCrash.commandId),deleteLocalPreserved=!orders.some(item=>item.id===id),deleteQueued=deleteEntry?.changes?.some(change=>change.type==='orders'&&change.id===id&&change.deleted===true)===true,deletePermissionRevokedQueued=deleteQueued&&test.access().role==='viewer';
        test.setAccess(previousAccess);test.setOffline(false);await test.bootstrap(true);await test.drain({force:true});const deleteServerConverged=!window.__serverEntityMap.has('orders:'+id),deleteStatus=window.JustFunEntitySyncV783.status();
        const postId='ordinary-post-enqueue-order',postOrder=makeOrder(postId,'После записи outbox'),postCrash=await test.simulateOrdinaryCrash(async()=>{orders=orders.filter(item=>item.id!==postId);orders.unshift(postOrder);window.persistOrders()},null,{intent:{kind:'order_save',targetId:postId},enqueueBeforeRestart:true}),recoveredPostEnqueue=await test.recoverCritical(),postJournalCleared=(await test.readCriticalRecovery())===null,postQueue=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope),postCommandCount=postQueue.list().filter(entry=>entry.commandId===postCrash.commandId).length;
        await test.bootstrap(true);await test.drain({force:true});const postServerConverged=window.__serverEntityMap.has('orders:'+postId);
        const collisionId='ordinary-collision-order',collisionOrder=makeOrder(collisionId,'Проверка коллизии'),collisionCrash=await test.simulateOrdinaryCrash(async()=>{orders=orders.filter(item=>item.id!==collisionId);orders.unshift(collisionOrder);window.persistOrders()},ctx=>{const key=window.JustFunLocalOutboxV783.storageKey(window.JustFunEntitySyncV783.status().scope),document=JSON.parse(localStorage.getItem(key)||'null'),entry=document?.entries?.find(item=>item.commandId===ctx.commandId);if(!entry)throw new Error('Команда коллизии не найдена в outbox.');entry.changes[0].payload={...(entry.changes[0].payload||{}),contactName:'Подменённая команда'};entry.changes[0]._fingerprint='tampered-fingerprint';localStorage.setItem(key,JSON.stringify(document));return{key}},{intent:{kind:'order_save',targetId:collisionId},enqueueBeforeRestart:true});let collisionCode='';try{await test.recoverCritical()}catch(error){collisionCode=String(error?.code||'')}const collisionJournalRetained=Boolean(await test.readCriticalRecovery()),collisionDocument=JSON.parse(localStorage.getItem(collisionCrash.hookResult.key)||'null'),collisionEntry=collisionDocument?.entries?.find(item=>item.commandId===collisionCrash.commandId);if(!collisionEntry)throw new Error('Команда коллизии потеряна после отказа восстановления.');collisionEntry.changes=collisionCrash.stagedEntry.changes;localStorage.setItem(collisionCrash.hookResult.key,JSON.stringify(collisionDocument));test.simulateRestart();const collisionRecovered=await test.recoverCritical(),collisionJournalCleared=(await test.readCriticalRecovery())===null,collisionQueue=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope),collisionCommandCount=collisionQueue.list().filter(entry=>entry.commandId===collisionCrash.commandId).length;await test.bootstrap(true);await test.drain({force:true});const collisionServerConverged=window.__serverEntityMap.has('orders:'+collisionId);
        const raceId='ordinary-context-race-order',raceOrder=makeOrder(raceId,'Локальная версия во время операции');let releaseRace;const raceGate=new Promise(resolve=>{releaseRace=resolve});window.__ordinaryRaceEntered=false;const racePromise=test.commitMutation({kind:'order_save',targetId:raceId,critical:false},async()=>{orders=orders.filter(item=>item.id!==raceId);orders.unshift(raceOrder);window.persistOrders();window.__ordinaryRaceEntered=true;await raceGate;return true});for(let attempt=0;attempt<200&&!window.__ordinaryRaceEntered;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(!window.__ordinaryRaceEntered)throw new Error('Обычная операция не вошла в управляемую паузу.');const raceStatusDuring=window.JustFunEntitySyncV783.status();window.__serverEntityMap.set('orders:'+raceId,{type:'orders',id:raceId,warehouseId,version:1,event_id:++window.__serverCursor,digest_sha256:'C'.repeat(64),payload:cloneValue(makeOrder(raceId,'Удалённая версия во время операции'))});let raceContextCode='',raceBootstrapCode='';try{window.JustFunEntitySyncV783.assertContextChangeAllowed({kind:'ordinary-context-race'})}catch(error){raceContextCode=String(error?.code||'')}try{await test.bootstrap(true)}catch(error){raceBootstrapCode=String(error?.code||'')}await test.poll();const raceLocalPreservedDuring=orders.find(item=>item.id===raceId)?.contactName===raceOrder.contactName,raceContextBlocked=window.JustFunEntitySyncV783.canChangeContext()===false;releaseRace();const raceCommitted=await racePromise;await test.drain({force:true});const raceServerConverged=window.__serverEntityMap.get('orders:'+raceId)?.payload?.contactName===raceOrder.contactName,raceStatusAfter=window.JustFunEntitySyncV783.status();
        return{warehouseId,prearmGeneration:crash.prearm.armedGeneration,generationBeforeRestart:crash.generationBeforeRestart,oldDrainState:crash.hookResult?.oldState||'',markerAfterOldDrain:crash.hookResult?.markerAfterOldDrain||0,queueAfterCrash,dirtyAfterCrash,localAfterCrash,recoveredUpsert,queueAfterRecovery,statusAfterDrain,storedPreserved:stored.data.orders.some(item=>item.id===id),serverConverged,attempts,recoveredDelete,deleteJournalCleared,deleteLocalPreserved,deleteQueued,deletePermissionRevokedQueued,deleteServerConverged,deleteStatus,recoveredPostEnqueue,postJournalCleared,postCommandCount,postServerConverged,collisionCode,collisionJournalRetained,collisionRecovered,collisionJournalCleared,collisionCommandCount,collisionServerConverged,raceStatusDuring,raceContextCode,raceBootstrapCode,raceLocalPreservedDuring,raceContextBlocked,raceCommitted,raceServerConverged,raceStatusAfter}
      })();`;
      window.document.body.append(script);ordinaryCrashRecoveryResult=await window.__ordinaryCrashRecoveryPromise;if(!ordinaryCrashRecoveryResult.prearmGeneration||!ordinaryCrashRecoveryResult.generationBeforeRestart||ordinaryCrashRecoveryResult.oldDrainState!=='confirmed'||!ordinaryCrashRecoveryResult.markerAfterOldDrain||ordinaryCrashRecoveryResult.queueAfterCrash?.active!==0||!ordinaryCrashRecoveryResult.dirtyAfterCrash||!ordinaryCrashRecoveryResult.localAfterCrash||ordinaryCrashRecoveryResult.recoveredUpsert!==true||ordinaryCrashRecoveryResult.queueAfterRecovery?.active<1||ordinaryCrashRecoveryResult.statusAfterDrain?.outbox?.active!==0||ordinaryCrashRecoveryResult.statusAfterDrain?.dirty||!ordinaryCrashRecoveryResult.storedPreserved||!ordinaryCrashRecoveryResult.serverConverged||ordinaryCrashRecoveryResult.attempts!==1||ordinaryCrashRecoveryResult.recoveredDelete!==true||!ordinaryCrashRecoveryResult.deleteJournalCleared||!ordinaryCrashRecoveryResult.deleteLocalPreserved||!ordinaryCrashRecoveryResult.deleteQueued||!ordinaryCrashRecoveryResult.deletePermissionRevokedQueued||!ordinaryCrashRecoveryResult.deleteServerConverged||ordinaryCrashRecoveryResult.deleteStatus?.outbox?.active!==0||ordinaryCrashRecoveryResult.recoveredPostEnqueue!==true||!ordinaryCrashRecoveryResult.postJournalCleared||ordinaryCrashRecoveryResult.postCommandCount!==1||!ordinaryCrashRecoveryResult.postServerConverged||ordinaryCrashRecoveryResult.collisionCode!=='ORDINARY_RECOVERY_COMMAND_COLLISION'||!ordinaryCrashRecoveryResult.collisionJournalRetained||ordinaryCrashRecoveryResult.collisionRecovered!==true||!ordinaryCrashRecoveryResult.collisionJournalCleared||ordinaryCrashRecoveryResult.collisionCommandCount!==1||!ordinaryCrashRecoveryResult.collisionServerConverged||ordinaryCrashRecoveryResult.raceStatusDuring?.ordinaryInFlight<1||ordinaryCrashRecoveryResult.raceContextCode!=='ENTITY_ORDINARY_OPERATION_IN_FLIGHT'||ordinaryCrashRecoveryResult.raceBootstrapCode!=='ENTITY_ORDINARY_MUTATION_IN_FLIGHT'||!ordinaryCrashRecoveryResult.raceLocalPreservedDuring||!ordinaryCrashRecoveryResult.raceContextBlocked||ordinaryCrashRecoveryResult.raceCommitted!==true||!ordinaryCrashRecoveryResult.raceServerConverged||ordinaryCrashRecoveryResult.raceStatusAfter?.ordinaryInFlight!==0||ordinaryCrashRecoveryResult.raceStatusAfter?.outbox?.active!==0)errors.push({phase:'ordinary-crash-recovery',level:'error',text:JSON.stringify(ordinaryCrashRecoveryResult)});
    }catch(error){errors.push({phase:'ordinary-crash-recovery',level:'error',text:error.stack||String(error)})}
  }
}

let syncBusyGuardResult = null;
if (syncBusyGuard) {
  if (testEdition !== 'full') {
    errors.push({phase:'sync-busy-guard',level:'error',text:'Тест защиты от медленной синхронизации требует full edition.'});
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      window.__JustFunEntitySyncTestV783.pausePolling();
      await window.JustFunEntitySyncV783.flushAndConfirm();
      window.__entitySyncIdleTimeoutMs=500;window.__holdEntityBootstrap=true;window.__holdEntityBootstrapFor=String(window.TeplitsaWarehouseBootstrap.activeWarehouse()?.id||'');window.__entityBootstrapStarted=false;
      const pendingBootstrap=window.__JustFunEntitySyncTestV783.bootstrap(true);
      for(let attempt=0;attempt<200&&!window.__entityBootstrapStarted;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      if(!window.__entityBootstrapStarted)throw new Error('Управляемая медленная загрузка VPS не запустилась.');
      let mutationCalls=0;const startedAt=Date.now();
      const mutationResult=await window.__JustFunEntitySyncTestV783.commitMutation({kind:'order_save',targetId:'sync-busy-guard-order',critical:false},async()=>{mutationCalls++;return true});
      const statusWhileHeld=window.JustFunEntitySyncV783.status();
      syncBusyGuardResult={mutationResult,mutationCalls,elapsedMs:Date.now()-startedAt,bootstrapStillInFlight:statusWhileHeld.bootstrapInFlight>0};
      if(mutationResult!==false||mutationCalls!==0||!syncBusyGuardResult.bootstrapStillInFlight)errors.push({phase:'sync-busy-guard',level:'error',text:JSON.stringify(syncBusyGuardResult)});
      window.__releaseEntityBootstrap?.();await pendingBootstrap;
    } catch (error) {
      errors.push({phase:'sync-busy-guard',level:'error',text:error.stack||String(error)});
    } finally {
      window.__entitySyncIdleTimeoutMs=undefined;window.__holdEntityBootstrap=false;window.__holdEntityBootstrapFor='';window.__releaseEntityBootstrap?.();window.__releaseEntityBootstrap=null;
    }
  }
}
let entityAckValidationResult = null;
if(entityAckValidation){
  if(testEdition!=='full')errors.push({phase:'entity-ack-validation',level:'error',text:'Entity ACK validation requires the full edition.'});
  else{
    try{
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();window.__JustFunEntitySyncTestV783.pausePolling();await window.JustFunEntitySyncV783.flushAndConfirm();const script=window.document.createElement('script');
      script.textContent=`window.__entityAckValidationPromise=(async()=>{const test=window.__JustFunEntitySyncTestV783,warehouseId=String(window.TeplitsaWarehouseBootstrap.activeWarehouse()?.id||''),change=id=>({type:'orders',id,baseVersion:0,deleted:false,payload:{id,warehouseId,number:id,contactName:id},_fingerprint:id}),exercise=async(fault,id)=>{const entry=test.enqueue({kind:'ack-validation',targetId:id},[change(id)]);window.__entityAckFault=fault;let firstCode='';try{await test.drain({targetCommandId:entry.commandId,force:true})}catch(error){firstCode=String(error?.code||'')}const queue=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope),afterInvalid=queue.get(entry.commandId),attemptsAfterInvalid=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+entry.commandId)).length;const retry=await test.drain({targetCommandId:entry.commandId,force:true}),afterRetry=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope).get(entry.commandId),attemptsAfterRetry=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+entry.commandId)).length;return{commandId:entry.commandId,firstCode,stateAfterInvalid:afterInvalid?.state||'',sameCommandAfterInvalid:afterInvalid?.commandId===entry.commandId,attemptsAfterInvalid,retryState:retry?.state||'',stateAfterRetry:afterRetry?.state||'',attemptsAfterRetry,serverConverged:window.__serverEntityMap.has('orders:'+id)}};const postCommitExercise=async(fault,id)=>{const entry=test.enqueue({kind:'post-commit-ack',targetId:id},[change(id)]);window.__entityPostCommitFaultMode=fault;window.__entityPostCommitFaultFor=entry.commandId;const first=await test.drain({targetCommandId:entry.commandId,force:true}),cursorAfterCommit=window.__serverCursor,queue=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope),afterFirst=queue.get(entry.commandId),attemptsAfterFirst=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+entry.commandId)).length,serverCommittedBeforeAck=window.__serverEntityMap.has('orders:'+id),retry=await test.drain({targetCommandId:entry.commandId,force:true}),afterRetry=window.JustFunLocalOutboxV783.create(localStorage,window.JustFunEntitySyncV783.status().scope).get(entry.commandId),attemptsAfterRetry=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+entry.commandId)).length;return{commandId:entry.commandId,firstState:first?.state||'',firstCode:String(afterFirst?.lastError?.code||''),stateAfterFirst:afterFirst?.state||'',sameCommand:afterFirst?.commandId===entry.commandId,attemptsAfterFirst,serverCommittedBeforeAck,retryState:retry?.state||'',stateAfterRetry:afterRetry?.state||'',attemptsAfterRetry,cursorStable:window.__serverCursor===cursorAfterCommit,replayed:window.__replayedEntityCommands.some(value=>value.endsWith(':'+entry.commandId))}};const partial=await exercise('partial','ack-partial-order'),wrong=await exercise('wrong-command','ack-wrong-command-order'),postCommit={malformed:await postCommitExercise('malformed-ack','ack-post-commit-malformed'),lost:await postCommitExercise('lost','ack-post-commit-lost')},pickupId='ack-pickup-intent-order',pickupEntry=test.enqueue({kind:'pickup_ready',targetId:pickupId},[change(pickupId),{type:'warehouseReservations',id:pickupId,baseVersion:0,deleted:false,payload:{id:pickupId,orderId:pickupId,warehouseId},_fingerprint:'pickup-reservation'}]),pickupDrain=await test.drain({targetCommandId:pickupEntry.commandId,force:true}),pickupPayload=window.__entitySyncPayloads.find(item=>item.commandId===pickupEntry.commandId),normalId='ack-normal-intent-order',normalEntry=test.enqueue({kind:'order_save',targetId:normalId},[change(normalId)]),normalDrain=await test.drain({targetCommandId:normalEntry.commandId,force:true}),normalPayload=window.__entitySyncPayloads.find(item=>item.commandId===normalEntry.commandId),intentForwarding={pickupConfirmed:pickupDrain?.state==='confirmed',pickupKind:pickupPayload?.intent?.kind||'',pickupTarget:pickupPayload?.intent?.targetId||'',normalConfirmed:normalDrain?.state==='confirmed',normalIntentOmitted:!Object.prototype.hasOwnProperty.call(normalPayload||{},'intent')},revokeId='permission-revoked-dirty-order',serverPayload={...change(revokeId).payload,contactName:'Серверная версия'};window.__serverEntityMap.set('orders:'+revokeId,{type:'orders',id:revokeId,warehouseId,version:1,event_id:++window.__serverCursor,digest_sha256:'D'.repeat(64),payload:cloneValue(serverPayload)});await test.bootstrap(true);const localPayload={...serverPayload,contactName:'Локальная несинхронизированная версия'};orders=orders.filter(item=>item.id!==revokeId);orders.unshift(localPayload);window.persistOrders();await window.TeplitsaWarehouseV600.whenPersisted();test.markDirty();test.pausePolling();test.simulateRestart();const previousAccess=test.access();test.setAccess({role:'viewer',allWarehouses:false,permissions:[]});let permissionCode='';try{await test.bootstrap(true)}catch(error){permissionCode=String(error?.code||'')}const localPreserved=orders.find(item=>item.id===revokeId)?.contactName===localPayload.contactName,quarantineRecorded=Array.from({length:localStorage.length},(_,index)=>String(localStorage.key(index)||'')).some(key=>key.startsWith('jf.entity-permission-quarantine.v1.')),workspaceBlocked=!document.documentElement.classList.contains('jf-authenticated'),exportAvailable=Boolean(document.querySelector('#jfExportQuarantine'));test.setAccess(previousAccess);await test.bootstrap(true);await test.drain({force:true});const serverRecovered=window.__serverEntityMap.get('orders:'+revokeId)?.payload?.contactName===localPayload.contactName,quarantineCleared=!Array.from({length:localStorage.length},(_,index)=>String(localStorage.key(index)||'')).some(key=>key.startsWith('jf.entity-permission-quarantine.v1.')),migrationAccessBefore=test.access();test.setAccess({role:'admin',allWarehouses:true,permissions:['*']});const adminDenied=test.canImportLocalMigration()===false;test.setAccess({role:'owner',allWarehouses:false,permissions:['*']});const restrictedOwnerDenied=test.canImportLocalMigration()===false;test.setAccess({role:'owner',allWarehouses:true,permissions:['*']});const ownerAllowed=test.canImportLocalMigration()===true;test.setAccess(migrationAccessBefore);return{partial,wrong,postCommit,intentForwarding,migrationAccess:{adminDenied,restrictedOwnerDenied,ownerAllowed},permissionRevocation:{permissionCode,localPreserved,quarantineRecorded,workspaceBlocked,exportAvailable,serverRecovered,quarantineCleared,outbox:window.JustFunEntitySyncV783.status().outbox}}})()`;
      window.document.body.append(script);entityAckValidationResult=await window.__entityAckValidationPromise;const valid=item=>item.sameCommandAfterInvalid&&item.stateAfterInvalid==='pending'&&item.attemptsAfterInvalid===1&&item.retryState==='confirmed'&&item.stateAfterRetry==='confirmed'&&item.attemptsAfterRetry===2&&item.serverConverged,validPostCommit=(item,code)=>item.firstState==='pending'&&item.firstCode===code&&item.stateAfterFirst==='pending'&&item.sameCommand&&item.attemptsAfterFirst===1&&item.serverCommittedBeforeAck&&item.retryState==='confirmed'&&item.stateAfterRetry==='confirmed'&&item.attemptsAfterRetry===2&&item.cursorStable&&item.replayed,permission=entityAckValidationResult.permissionRevocation,intent=entityAckValidationResult.intentForwarding,migrationAccess=entityAckValidationResult.migrationAccess;if(entityAckValidationResult.partial.firstCode!=='ENTITY_ACK_INCOMPLETE'||entityAckValidationResult.wrong.firstCode!=='ENTITY_ACK_COMMAND_MISMATCH'||!valid(entityAckValidationResult.partial)||!valid(entityAckValidationResult.wrong)||!validPostCommit(entityAckValidationResult.postCommit.malformed,'REG_ENTITY_ACK_INVALID')||!validPostCommit(entityAckValidationResult.postCommit.lost,'NETWORK_ERROR')||!intent.pickupConfirmed||intent.pickupKind!=='pickup_ready'||intent.pickupTarget!=='ack-pickup-intent-order'||!intent.normalConfirmed||!intent.normalIntentOmitted||!migrationAccess.adminDenied||!migrationAccess.restrictedOwnerDenied||!migrationAccess.ownerAllowed||permission.permissionCode!=='ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED'||!permission.localPreserved||!permission.quarantineRecorded||!permission.workspaceBlocked||!permission.exportAvailable||!permission.serverRecovered||!permission.quarantineCleared||permission.outbox?.active!==0)errors.push({phase:'entity-ack-validation',level:'error',text:JSON.stringify(entityAckValidationResult)});
      const lifecyclePointers=()=>Array.from({length:window.localStorage.length},(_,index)=>String(window.localStorage.key(index)||'')).filter(key=>key.startsWith('jf.warehouse-lifecycle.v1.')).flatMap(key=>{try{return JSON.parse(window.localStorage.getItem(key)||'[]')}catch{return[]}});
      const exerciseWarehouseLifecycle=async(faultMode,warehouseId)=>{const record={id:warehouseId,name:`Тест ${faultMode}`,code:faultMode==='partial'?'ЧСТ':'ПОТ',address:'Санкт-Петербург',lat:59.9,lon:30.3,timezone:'Europe/Moscow',status:'active',catalogMode:'empty',origin:'local'};window.__warehouseReplayFaultMode=faultMode;window.__warehouseReplayFaultsRemaining=2;let firstCode='';try{await window.JustFunServerStorageV3.writeWarehouse(record,{baseVersion:0})}catch(error){firstCode=String(error?.code||'')}const pointerBefore=lifecyclePointers().some(item=>item.warehouseId===warehouseId),second=await window.JustFunServerStorageV3.writeWarehouse(record,{baseVersion:0}),pointerAfter=lifecyclePointers().some(item=>item.warehouseId===warehouseId),attempts=window.__entityCommandAttempts.filter(value=>value.startsWith(`warehouse:${warehouseId}:`));return{firstCode,pointerBefore,secondOk:second?.ok===true,pointerAfter,attempts:attempts.length,uniqueCommands:new Set(attempts).size,serverRecord:window.__serverEntityMap.has('warehouse:'+warehouseId)}};
      const warehouseLifecycle={partial:await exerciseWarehouseLifecycle('partial','warehouse-lifecycle-partial'),lost:await exerciseWarehouseLifecycle('lost','warehouse-lifecycle-lost')};entityAckValidationResult.warehouseLifecycle=warehouseLifecycle;const validLifecycle=item=>item.firstCode==='WAREHOUSE_WRITE_UNCERTAIN'&&item.pointerBefore&&item.secondOk&&!item.pointerAfter&&item.attempts===3&&item.uniqueCommands===1&&item.serverRecord;if(!validLifecycle(warehouseLifecycle.partial)||!validLifecycle(warehouseLifecycle.lost))errors.push({phase:'warehouse-lifecycle-recovery',level:'error',text:JSON.stringify(warehouseLifecycle)});
    }catch(error){errors.push({phase:'entity-ack-validation',level:'error',text:error.stack||String(error)})}
  }
}
let localMutationDurabilityResult = null;
if (localMutationDurability) {
  if (testEdition !== 'full' || process.env.JF_TEST_DATA_SERVICE_DISABLED !== '1') {
    errors.push({ phase: 'local-mutation-durability', level: 'error', text: 'Durability verification requires full edition with the data service disabled.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      const durabilityScript=window.document.createElement('script');
      durabilityScript.textContent=`window.__localMutationDurabilityPromise=(async()=>{
        const previousConfirm=jfConfirm;jfConfirm=async()=>true;
        try{
          renderProgramSettings();const beforeBackupAt=String(settings.program?.lastBackupAt||''),beforeBackupHealth=String(document.querySelector('#smartProgramHealth')?.textContent||'');const backupResult=await exportBackup({kind:'manual'}),afterBackupHealth=String(document.querySelector('#smartProgramHealth')?.textContent||''),backupRefresh=backupResult?.confirmed===true&&String(settings.program?.lastBackupAt||'')!==beforeBackupAt&&afterBackupHealth!==beforeBackupHealth&&afterBackupHealth.includes('ручная');
          const id='durable-payment-order',now=new Date().toISOString(),order=normalizeOrder({id,number:'DURABLE-001',orderType:'delivery',createdAt:now,updatedAt:now,deliveryDate:todayISO(),contactName:'Проверка долговечности',contactMethod:'',deliveryAddress:'Москва, Тверская улица, 1',geo:{lat:55.7578,lon:37.6156,region:'Москва',district:'Тверской район'},items:[],total:100,goodsTotal:100,deliveryCost:0,grandTotal:100,paymentStatus:'pending',fulfillmentStatus:'active',warehouseFlowStatus:'planned'});
          orders=orders.filter(item=>item.id!==id);orders.unshift(order);persistOrders();
          const before=window.JustFunEntitySyncV783.status(),queue=window.JustFunLocalOutboxV783.create(localStorage,before.scope),beforeActive=queue.status().active;
          openDetails(id);const result=await window.toggleCurrentOrderPayment(),afterQueue=window.JustFunLocalOutboxV783.create(localStorage,before.scope),entries=afterQueue.list(),paymentEntry=entries.find(entry=>entry.intent?.kind==='order_payment'&&entry.intent?.targetId===id),stored=JSON.parse(localStorage.getItem(resolveDataStorageKey(STORAGE_KEY))||'[]').find(item=>item.id===id),restarted=window.JustFunLocalOutboxV783.create(localStorage,before.scope);
          await new Promise(resolve=>setTimeout(resolve,0));const auditRows=window.__bridgeCalls.filter(item=>item.startsWith('audit:business_mutation_')),auditIds=auditRows.map(item=>item.split(':').at(-1)).filter(Boolean);return{result,backupRefresh,paid:order.paymentStatus==='paid',storedPaid:stored?.paymentStatus==='paid',outboxIncrement:afterQueue.status().active===beforeActive+1,paymentCommand:Boolean(paymentEntry),restartPreserved:Boolean(paymentEntry&&restarted.get(paymentEntry.commandId)?.state==='pending'),changedEntity:paymentEntry?.changes?.some(change=>change.type==='orders'&&change.id===id&&change.payload?.paymentStatus==='paid')||false,auditStarted:auditRows.some(item=>item.includes('audit:business_mutation_started:')),auditPending:auditRows.some(item=>item.includes('audit:business_mutation_pending:')),auditCorrelation:auditIds.length>=2&&new Set(auditIds).size===1};
        }finally{jfConfirm=previousConfirm}
      })();`;
      window.document.body.append(durabilityScript);
      localMutationDurabilityResult=await window.__localMutationDurabilityPromise;
      if(!localMutationDurabilityResult.backupRefresh||!localMutationDurabilityResult.paid||!localMutationDurabilityResult.storedPaid||!localMutationDurabilityResult.outboxIncrement||!localMutationDurabilityResult.paymentCommand||!localMutationDurabilityResult.restartPreserved||!localMutationDurabilityResult.changedEntity||!localMutationDurabilityResult.auditStarted||!localMutationDurabilityResult.auditPending||!localMutationDurabilityResult.auditCorrelation)errors.push({phase:'local-mutation-durability',level:'error',text:JSON.stringify(localMutationDurabilityResult)});
    } catch (error) {
      errors.push({ phase: 'local-mutation-durability', level: 'error', text: error.stack || String(error) });
    }
  }
}
let localWarehouseResult = null;
if (localWarehouse) {
  if (testEdition !== 'full' || process.env.JF_TEST_DATA_SERVICE_DISABLED !== '1') {
    errors.push({ phase: 'local-warehouse', level: 'error', text: 'Local warehouse verification requires full edition with the data service disabled.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783.install();
      await window.JustFunEntitySyncV783.flushAndConfirm();
      window.persistSettings();
      await new Promise(resolve=>setTimeout(resolve,350));
      const outboxBefore=window.JustFunEntitySyncV783.status().outbox.active;
      window.persistSettings();
      await new Promise(resolve=>setTimeout(resolve,350));
      const outboxAfter=window.JustFunEntitySyncV783.status().outbox.active;
      const addressResults=await window.geocodeSearch('Санкт-Петербург Невский 28');
      const addressPayload=window.__addressSearchPayloads.at(-1)||null;
      const beforeRegistry=window.TeplitsaWarehouseBootstrap.getRegistry();
      window.__JF_TEST_NO_RELOAD=true;
      window.openWarehouseCreatorV600();
      window.document.getElementById('warehouseNameV600').value='Локальный тестовый склад';
      window.document.getElementById('warehouseCodeV600').value='ЛТС';
      window.document.getElementById('warehouseAddressV600').value='Санкт-Петербург, Невский проспект, 28';
      window.document.getElementById('warehouseLatV600').value='59.9351';
      window.document.getElementById('warehouseLonV600').value='30.3255';
      const created=await window.saveWarehouseEditorV600(new window.Event('submit',{cancelable:true}));
      const afterRegistry=window.TeplitsaWarehouseBootstrap.getRegistry(),createdWarehouse=afterRegistry.warehouses.find(item=>item.name==='Локальный тестовый склад');
      const emptyOrders=createdWarehouse?JSON.parse(window.TeplitsaWarehouseBootstrap.raw.get(window.TeplitsaWarehouseBootstrap.dataKey('orders_2gis_tms_v1','live',createdWarehouse.id))||'null'):null;
      localWarehouseResult={
        localFlush:true,
        noOpOutboxStable:outboxBefore===outboxAfter,
        generatedRequestId:Boolean(addressPayload&&/^[A-Za-z0-9_-]{8,80}$/.test(String(addressPayload.requestId||''))),
        addressResults:Array.isArray(addressResults)?addressResults.length:null,
        created,
        warehouseCountBefore:beforeRegistry.warehouses.length,
        warehouseCountAfter:afterRegistry.warehouses.length,
        activeWarehouseId:afterRegistry.activeWarehouseId,
        createdWarehouseId:createdWarehouse?.id||null,
        emptyOrders:Array.isArray(emptyOrders)&&emptyOrders.length===0,
        telegramNotForced:window.sessionStorage.getItem('jfTelegramSetupWarehouseV783')===null
      };
      if(!localWarehouseResult.noOpOutboxStable||!localWarehouseResult.generatedRequestId||created!==true||afterRegistry.warehouses.length!==beforeRegistry.warehouses.length+1||afterRegistry.activeWarehouseId!==createdWarehouse?.id||!localWarehouseResult.emptyOrders||!localWarehouseResult.telegramNotForced)errors.push({phase:'local-warehouse',level:'error',text:JSON.stringify(localWarehouseResult)});
    } catch (error) {
      errors.push({ phase: 'local-warehouse', level: 'error', text: error.stack || String(error) });
    }
  }
}
let localToServerMigrationResult = null;
if(localToServerMigration){
  try{
    const B=window.TeplitsaWarehouseBootstrap,migrationKey=String(B.registryKey).replace(/warehouses_registry_v600$/,'local_to_server_migration_v783');let journal=null;
    const initialExpected=localToServerMigrationResume?'failed':'complete';for(let attempt=0;attempt<200;attempt++){try{journal=JSON.parse(B.raw.get(migrationKey)||'null')}catch{}if(journal?.state===initialExpected)break;await new Promise(resolve=>setTimeout(resolve,50))}
    let resumeReplay=null;if(localToServerMigrationResume){const lostCommand='client:migrate-v783:entities:warehouse-local-a:0',processedBefore=window.__processedEntityCommands.size,attemptsBefore=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+lostCommand)).length;await window.JustFunWarehouseRegistryV783.refresh();for(let attempt=0;attempt<200;attempt++){try{journal=JSON.parse(B.raw.get(migrationKey)||'null')}catch{}if(journal?.state==='complete')break;await new Promise(resolve=>setTimeout(resolve,50))}const attemptsAfter=window.__entityCommandAttempts.filter(value=>value.endsWith(':'+lostCommand)).length;resumeReplay={state:journal?.state||null,processedBefore,processedAfter:window.__processedEntityCommands.size,attemptsBefore,attemptsAfter,replayed:window.__replayedEntityCommands.some(value=>value.endsWith(':'+lostCommand))}}
    window.__JustFunEntitySyncTestV783?.pausePolling?.();let registry=B.getRegistry();const serverWarehouses=[...window.__serverEntityMap.values()].filter(item=>item.type==='warehouse'),order=window.__serverEntityMap.get('warehouse-local-a:orders:migration-order-1'),product=window.__serverEntityMap.get('warehouse-local-b:products:migration-product-1'),pendingQueue=window.JustFunLocalOutboxV783.create(window.localStorage,window.__migrationPendingOutbox.scope),pendingEntry=pendingQueue.get(window.__migrationPendingOutbox.commandId),journalWarehouse=journal?.warehouses?.find(item=>item.id==='warehouse-local-a');
    localToServerMigrationResult={journalState:journal?.state||null,warehouses:serverWarehouses.length,orderMigrated:Boolean(order),pendingOverlayMigrated:order?.payload?.fulfillmentStatus==='not_relevant'&&order?.payload?.archived===true,pendingOutboxConfirmed:pendingEntry?.state==='confirmed'&&pendingEntry?.preserveLocal===false,pendingOutboxState:pendingEntry?.state||null,pendingOutboxPreserveLocal:pendingEntry?.preserveLocal??null,pendingCommandJournaled:journalWarehouse?.outboxCommandIds?.includes(window.__migrationPendingOutbox.commandId)===true,productMigrated:Boolean(product),registryServerOwned:registry.warehouses.length===2&&registry.warehouses.every(item=>item.origin==='server'),activeWarehousePreserved:registry.activeWarehouseId==='warehouse-local-a',secondCatalogMode:registry.warehouses.find(item=>item.id==='warehouse-local-b')?.catalogMode||null,resumeReplay};
    const resumeOk=!localToServerMigrationResume||(resumeReplay?.state==='complete'&&resumeReplay.attemptsBefore===1&&resumeReplay.attemptsAfter===2&&resumeReplay.replayed===true&&resumeReplay.processedAfter>=resumeReplay.processedBefore);
    if(localToServerMigrationResume&&resumeOk){for(let index=errors.length-1;index>=0;index-=1){const item=errors[index];if(item?.phase==='console'&&item?.level==='warn'&&String(item?.text||'').includes('Тестовая потеря ответа после commit'))errors.splice(index,1)}}
    if(localToServerMigrationResult.journalState!=='complete'||localToServerMigrationResult.warehouses!==2||!localToServerMigrationResult.orderMigrated||!localToServerMigrationResult.pendingOverlayMigrated||!localToServerMigrationResult.pendingOutboxConfirmed||!localToServerMigrationResult.pendingCommandJournaled||!localToServerMigrationResult.productMigrated||!localToServerMigrationResult.registryServerOwned||!localToServerMigrationResult.activeWarehousePreserved||localToServerMigrationResult.secondCatalogMode!=='empty'||!resumeOk)errors.push({phase:'local-to-server-migration',level:'error',text:JSON.stringify(localToServerMigrationResult)});
  }catch(error){errors.push({phase:'local-to-server-migration',level:'error',text:error.stack||String(error)})}
}
if (atomicMutation) {
  if (testEdition !== 'full') {
    errors.push({ phase: 'atomic-mutation', level: 'error', text: 'Atomic mutation verification must run in full edition.' });
  } else {
    try {
      if(!window.JustFunEntitySyncV783?.status?.().installed)window.__JustFunEntitySyncTestV783?.install?.();
      const atomicScript = window.document.createElement('script');
      atomicScript.textContent = `window.__atomicMutationPromise = (async () => {
        const previousConfirm=jfConfirm;jfConfirm=async()=>true;
        try{
        const makeOrder = id => normalizeOrder({id,number:id,orderType:'delivery',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deliveryDate:todayISO(),contactName:'Проверка атомарности',contactMethod:'',deliveryAddress:'Тестовый адрес',geo:{lat:55.75,lon:37.61,region:'Москва',district:'Тверской район'},items:[],total:0,goodsTotal:0,deliveryCost:0,grandTotal:0,status:'new',fulfillmentStatus:'active'});
        const first=makeOrder('atomic-order-success'),second=makeOrder('atomic-order-reject');
        orders=orders.filter(item=>![first.id,second.id].includes(item.id));orders.unshift(first,second);delete routeAssignments[first.id];delete routeAssignments[second.id];delete routeLocks[first.id];delete routeLocks[second.id];window.persistOrders();
        await window.JustFunEntitySyncV783.flushAndConfirm();window.__entitySyncPayloads.length=0;
        const successResult=await window.deleteOrder(first.id),successRemoved=!orders.some(item=>item.id===first.id),successPayload=window.__entitySyncPayloads.at(-1)||null;
        window.__entitySyncPayloads.length=0;window.__rejectEntitySync=true;const rejectResult=await window.deleteOrder(second.id);window.__rejectEntitySync=false;
        return{successResult,successRemoved,successPayloadHasNoIntent:successPayload&&!Object.prototype.hasOwnProperty.call(successPayload,'intent'),successPayloadDeletesOrder:Boolean(successPayload?.changes?.some(item=>item.type==='orders'&&item.id===first.id&&item.deleted===true)),rejectResult,rollbackRestored:orders.some(item=>item.id===second.id)};
        }finally{jfConfirm=previousConfirm;window.__rejectEntitySync=false}
      })();`;
      window.document.body.append(atomicScript);
      const result = await window.__atomicMutationPromise;
      if (!result.successRemoved || !result.successPayloadHasNoIntent || !result.successPayloadDeletesOrder || result.rejectResult !== false || !result.rollbackRestored) {
        errors.push({ phase: 'atomic-mutation', level: 'error', text: JSON.stringify(result) });
      }
      window.__atomicMutationResult = result;
    } catch (error) {
      errors.push({ phase: 'atomic-mutation', level: 'error', text: error.stack || String(error) });
    }
  }
}

let stressResult = null;
if (stress5000) {
  try {
    const stressScript = window.document.createElement('script');
    stressScript.textContent = `window.__stressResult = (() => {
      const seed = orders[0] ? JSON.parse(JSON.stringify(orders[0])) : {
        id:'seed', number:'JF-1', createdAt:new Date().toISOString(),
        deliveryDate:new Date().toISOString().slice(0,10), status:'new',
        contactName:'Тест', deliveryAddress:'Москва', items:[], total:0
      };
      orders = Array.from({length:5000}, (_,index) => ({
        ...JSON.parse(JSON.stringify(seed)),
        id:'stress-'+index,
        number:'JF-STRESS-'+String(index+1).padStart(5,'0'),
        contactName:'Клиент '+(index+1),
        updatedAt:new Date(1700000000000+index*1000).toISOString()
      }));
      ordersPage = 1;
      for (const id of ['searchInput','orderRegionFilter','orderDistrictFilter','orderDateFilter','orderStatusFilter']) {
        const field=document.getElementById(id); if(field)field.value='';
      }
      const archive=document.getElementById('orderArchiveFilter'); if(archive)archive.value='all';
      const started = performance.now();
      renderOrders();
      const elapsed = performance.now()-started;
      return {
        orders:orders.length,
        renderedRows:document.querySelectorAll('#ordersArea tbody tr').length,
        elapsedMs:Math.round(elapsed*100)/100,
        bodyTextLength:document.body.textContent.length,
        ordersAreaLength:document.getElementById('ordersArea')?.innerHTML.length||0,
        ordersAreaPreview:(document.getElementById('ordersArea')?.textContent||'').replace(/\\s+/g,' ').slice(0,240)
      };
    })();`;
    window.document.body.append(stressScript);
    stressResult = window.__stressResult;
  } catch (error) {
    errors.push({ phase: 'stress5000', level: 'error', text: error.stack || String(error) });
  }
}

let deepBusinessResult = null;
if (deepBusiness) {
  try {
    const deepScript = window.document.createElement('script');
    deepScript.textContent = `window.__deepBusinessPromise = (async () => {
      const checks = [];
      const details = {};
      const phase = name => { window.__deepBusinessPhase = name; details.lastPhase = name; };
      const check = (name, condition, detail = '') => {
        const ok = Boolean(condition);
        checks.push({ name, ok, detail: ok ? String(detail || 'Пройдено') : String(detail || 'Проверка не пройдена') });
        return ok;
      };
      const cleanDocument = (name, html, required = []) => {
        const plain = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        check(name + ': документ создан', plain.length > 250, 'Символов: ' + plain.length);
        check(name + ': обязательные разделы', required.every(text => plain.includes(text)), required.filter(text => !plain.includes(text)).join(', '));
        check(name + ': нет служебных значений', !/(?:undefined|NaN|\\[object Object\\])/i.test(plain), plain.match(/(?:undefined|NaN|\\[object Object\\])/i)?.[0] || '');
        check(name + ': нет старой марки', !/ТЕПЛИЦА78/i.test(plain), 'Использована марка активной компании');
        return plain;
      };
      const copy = value => JSON.parse(JSON.stringify(value));
      const createIsolatedBusinessFixture = () => createDemonstrationScenario({ showMessage: false, isolatedFixture: true });
      const memory = {
        orders: copy(orders), products: copy(products), inventoryMovements: copy(inventoryMovements),
        drivers: copy(drivers), settings: copy(settings), routePlans: copy(routePlans),
        routeAssignments: copy(routeAssignments), routeCatalog: copy(routeCatalog),
        routeDriverAssignments: copy(routeDriverAssignments), routeLocks: copy(routeLocks),
        routeOverrides: copy(routeOverrides), routeExecutions: copy(routeExecutions),
        routeArchives: copy(routeArchives), warehouseReservations: copy(warehouseReservations),
        reportingData: copy(reportingData)
      };
      const raw = {};
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key) raw[key] = localStorage.getItem(key);
      }
      const nativeConfirm = window.confirm;
      const nativeJfConfirm = jfConfirm;
      const nativeDownload = downloadBlob;
      const downloads = [];
      window.confirm = () => true;
      jfConfirm = async () => true;
      downloadBlob = (content, name, type) => {
        downloads.push({ content: String(content ?? ''), name: String(name || ''), type: String(type || '') });
      };
      try {
        phase('fixture');
        createIsolatedBusinessFixture();
        const audit = auditDemonstrationScenario();
        details.demoAudit = audit;
        check('Учебная база проходит встроенную проверку', audit?.ok === true, (audit?.errors || []).join('; '));
        check('Учебная база содержит заказы', orders.length >= 40, 'Заказов: ' + orders.length);
        check('Учебная база содержит товары', products.length >= 20, 'Товаров: ' + products.length);
        check('Учебная база содержит водителей', drivers.length >= 10, 'Водителей: ' + drivers.length);
        check('Идентификаторы заказов уникальны', new Set(orders.map(x => x.id)).size === orders.length);
        check('Идентификаторы товаров уникальны', new Set(products.map(x => x.id)).size === products.length);
        check('Идентификаторы водителей уникальны', new Set(drivers.map(x => x.id)).size === drivers.length);

        const requiredStatuses = ['active','picking','pickup_ready','in_transit','awaiting_close','delivered','partial','not_delivered','pickup_collected','not_relevant'];
        const statusCounts = Object.fromEntries(requiredStatuses.map(status => [status, orders.filter(order => order.fulfillmentStatus === status).length]));
        details.statusCounts = statusCounts;
        check('Представлены все статусы выполнения', requiredStatuses.every(status => statusCounts[status] > 0), JSON.stringify(statusCounts));
        check('Все суммы заказов корректны', orders.every(order => {
          const values = [goodsTotalOf(order), deliveryCostOf(order), orderGrandTotal(order)];
          return values.every(value => Number.isFinite(value) && value >= 0);
        }));
        check('Все строки заказов имеют товар и количество', orders.every(order => asArray(order.items).length && asArray(order.items).every(item => item.name && Number(item.qty) > 0)));
        check('Все рабочие заказы имеют историю', orders.every(order => asArray(order.statusHistory).length > 0));

        const orderIds = new Set(orders.map(order => String(order.id)));
        const productIds = new Set(products.map(product => String(product.id)));
        const driverIds = new Set(drivers.map(driver => String(driver.id)));
        check('Назначения рейсов ссылаются на существующие заказы', Object.keys(routeAssignments).every(id => orderIds.has(String(id))));
        check('Маршрутные листы не содержат чужих заказов', Object.values(routePlans).every(plan => asArray(plan?.orderedIds).every(id => orderIds.has(String(id)))));
        check('Назначения водителей существуют', Object.values(routeDriverAssignments).every(id => !id || driverIds.has(String(id))));
        check('Блокировки заказов согласованы с рейсами', Object.entries(routeLocks).every(([orderId, routeId]) => orderIds.has(String(orderId)) && routeAssignments[orderId] === routeId));
        check('Активные рейсы ссылаются на существующие заказы', Object.values(routeExecutions).every(execution => asArray(execution?.orderIds).length && asArray(execution.orderIds).every(id => orderIds.has(String(id)))));
        const operationalRouteIds = Object.keys(routePlans).filter(id => /^demo-route-/.test(id));
        const routeAssignmentsByDate = operationalRouteIds.reduce((result, routeId) => {
          const date = String(routeCatalog[routeId]?.date || '');
          (result[date] ||= []).push(routeDriverAssignments[routeId]);
          return result;
        }, {});
        check('Пересекающиеся учебные рейсы не назначены одному водителю', Object.values(routeAssignmentsByDate).every(ids => ids.every(Boolean) && new Set(ids).size === ids.length), JSON.stringify(routeAssignmentsByDate));
        check('Автомобиль каждого учебного рейса подходит грузу', operationalRouteIds.every(routeId => {
          const driver = drivers.find(item => item.id === routeDriverAssignments[routeId]);
          const routeOrders = asArray(routePlans[routeId]?.orderedIds).map(id => orders.find(order => order.id === id)).filter(Boolean);
          const fit = driver && driverFitForRoute(driver, routeOrders);
          return Boolean(driver && routeOrders.length && (!fit.hasData || fit.fits));
        }), operationalRouteIds.join(', '));
        check('Складские движения ссылаются на товары', inventoryMovements.every(movement => productIds.has(String(movement.productId))));
        check('Складские количества конечны', products.every(product => {
          const state = productInventoryState(product);
          return !state.tracked || [state.onHand, state.reserved, state.available, state.openDemand].every(Number.isFinite);
        }));
        check('Доступный остаток равен физическому минус резерв', products.every(product => {
          const state = productInventoryState(product);
          return !state.tracked || Math.abs(roundQty(state.onHand - state.reserved) - state.available) < 0.001;
        }));

        phase('backup-roundtrip');
        const payload = buildBackupPayload();
        const serialized = JSON.stringify(payload);
        const backupSections = ['orders','products','inventoryMovements','drivers','settings','routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','routeArchives','warehouseReservations','reportingData'];
        details.backup = { bytes: serialized.length, sections: Object.keys(payload.data || {}) };
        check('Резервная копия содержит все рабочие разделы', backupSections.every(key => Object.prototype.hasOwnProperty.call(payload.data || {}, key)), backupSections.filter(key => !Object.prototype.hasOwnProperty.call(payload.data || {}, key)).join(', '));
        check('Резервная копия относится к активному складу', String(payload.data?.warehouseId || '') === String(TeplitsaWarehouseBootstrap.activeWarehouse()?.id || ''));
        check('Резервная копия сериализуется без потерь', serialized.length > 1000 && !/(?:undefined|NaN)/.test(serialized), 'Байт: ' + serialized.length);

        const expectedBackupCounts = {
          orders: payload.data.orders.length, products: payload.data.products.length,
          movements: payload.data.inventoryMovements.length, drivers: payload.data.drivers.length,
          plans: Object.keys(payload.data.routePlans || {}).length, executions: Object.keys(payload.data.routeExecutions || {}).length,
          archives: payload.data.routeArchives.length, reservations: Object.keys(payload.data.warehouseReservations || {}).length
        };
        orders = []; products = []; inventoryMovements = []; drivers = []; routePlans = {}; routeAssignments = {};
        routeCatalog = {}; routeDriverAssignments = {}; routeLocks = {}; routeOverrides = {}; routeExecutions = {};
        routeArchives = []; warehouseReservations = {}; reportingData = normalizeReportingData({});
        const importEvent = text => ({ target: { files: [{ name: 'deep-business-backup.json', text: async () => text }], value: 'selected' } });
        const validImportEvent = importEvent(serialized);
        await importBackupFile(validImportEvent);
        const restoredBackupCounts = {
          orders: orders.length, products: products.length, movements: inventoryMovements.length, drivers: drivers.length,
          plans: Object.keys(routePlans || {}).length, executions: Object.keys(routeExecutions || {}).length,
          archives: routeArchives.length, reservations: Object.keys(warehouseReservations || {}).length
        };
        details.backupRoundTrip = { expected: expectedBackupCounts, restored: restoredBackupCounts };
        check('Импорт очищает поле выбора файла', validImportEvent.target.value === '');
        check('Полная резервная копия восстанавливается обратно', JSON.stringify(restoredBackupCounts) === JSON.stringify(expectedBackupCounts), JSON.stringify(restoredBackupCounts));
        check('После восстановления сохранены идентификаторы заказов', orders[0]?.id === payload.data.orders[0]?.id && orders.at(-1)?.id === payload.data.orders.at(-1)?.id);
        check('После восстановления база проходит диагностику', asArray(runDataDiagnostics(false)).every(item => item?.severity !== 'critical'));

        const stateFingerprint = () => JSON.stringify({
          orderIds: orders.map(item => item.id), productIds: products.map(item => item.id), driverIds: drivers.map(item => item.id),
          movements: inventoryMovements.length, plans: Object.keys(routePlans || {}), executions: Object.keys(routeExecutions || {}),
          archives: routeArchives.map(item => item.id), reservations: Object.keys(warehouseReservations || {})
        });
        const restoredFingerprint = stateFingerprint();
        const foreignWarehouse = copy(payload);
        foreignWarehouse.warehouse.id = 'foreign-warehouse';
        foreignWarehouse.data.warehouseId = 'foreign-warehouse';
        await importBackupFile(importEvent(JSON.stringify(foreignWarehouse)));
        check('Копия другого склада отклоняется без изменения базы', stateFingerprint() === restoredFingerprint);
        const wrongEnvironment = copy(payload);
        wrongEnvironment.warehouse.environment = wrongEnvironment.warehouse.environment === 'demo' ? 'live' : 'demo';
        await importBackupFile(importEvent(JSON.stringify(wrongEnvironment)));
        check('Копия другой среды отклоняется без изменения базы', stateFingerprint() === restoredFingerprint);
        await importBackupFile(importEvent(JSON.stringify({ app: payload.app, data: { orders: [] } })));
        check('Неполная копия отклоняется без изменения базы', stateFingerprint() === restoredFingerprint);
        await importBackupFile(importEvent('{повреждённый json'));
        check('Повреждённый JSON отклоняется без изменения базы', stateFingerprint() === restoredFingerprint);

        phase('documents-and-exports');
        const deliveryOrder = orders.find(order => !isPickup(order) && asArray(order.items).length);
        openDetails(deliveryOrder.id);
        printCurrentOrder();
        const deliveryPrint = document.getElementById('printArea')?.innerHTML || '';
        details.printOrderLength = deliveryPrint.length;
        cleanDocument('Печать заказа с доставкой', deliveryPrint, ['Счёт №', deliveryOrder.number, 'Оплата заказа', 'Получатель принял']);

        const pickupOrder = orders.find(order => isPickup(order) && asArray(order.items).length);
        openDetails(pickupOrder.id);
        printCurrentOrder();
        const pickupPrint = document.getElementById('printArea')?.innerHTML || '';
        details.printPickupLength = pickupPrint.length;
        cleanDocument('Печать самовывоза', pickupPrint, ['Лист выдачи', pickupOrder.number, 'Пункт выдачи', 'Получил']);

        const printableRouteId = Object.keys(routePlans).find(routeId => asArray(routePlans[routeId]?.orderedIds).length);
        printRoute(printableRouteId);
        const routePrint = document.getElementById('printArea')?.innerHTML || '';
        details.printRouteLength = routePrint.length;
        const routePlain = cleanDocument('Печать маршрутного листа', routePrint, ['Маршрутный лист', 'Водитель', 'Склад', 'Последовательность точек доставки']);
        check('Маршрутный лист не раскрывает внутренний расчёт оплаты', !/Состав начисления|Расч[её]т оплаты водителя/i.test(routePlain));

        printReport();
        const reportPrint = document.getElementById('printArea')?.innerHTML || '';
        details.printReportLength = reportPrint.length;
        cleanDocument('Печать отчёта директора', reportPrint, ['ОТЧЁТ ДИРЕКТОРА', 'Выручка', 'Чистая прибыль', 'Достоверность']);

        exportCSV();
        exportReportCSV();
        const ordersCsv = downloads.find(item => /orders/i.test(item.name));
        const reportCsv = downloads.find(item => /director_report/i.test(item.name));
        details.downloads = downloads.map(item => ({ name: item.name, bytes: item.content.length, type: item.type }));
        check('Экспорт заказов CSV создан', ordersCsv?.content.includes('Статус оплаты') && ordersCsv.content.split('\\n').length > orders.length, ordersCsv?.name || '');
        check('Отчёт директора CSV создан', reportCsv?.content.includes('КЛЮЧЕВЫЕ ОТВЕТЫ') && reportCsv.content.includes('ПРОВЕРКА ДОСТОВЕРНОСТИ'), reportCsv?.name || '');
        check('CSV использует марку активной компании', reportCsv && !/ТЕПЛИЦА78/i.test(reportCsv.content), reportCsv?.content.slice(0, 100) || '');

        phase('embedded-qa');
        const qa = window.TeplitsaQA.run({ show: false });
        details.embeddedQa = { summary: qa.summary, issues: qa.checks.filter(item => item.status !== 'ok') };
        const embeddedCritical = qa.checks.filter(item => item.status === 'fail' && item.name !== 'Локальный модуль Leaflet');
        check('Встроенная самопроверка без критических ошибок', embeddedCritical.length === 0, JSON.stringify(embeddedCritical));

        phase('order-statuses');
        const pickupActive = orders.find(order => isPickup(order) && order.fulfillmentStatus === 'active');
        const movementsBeforePickup = inventoryMovements.length;
        openDetails(pickupActive.id);
        await markCurrentPickupReady();
        check('Самовывоз резервируется при готовности', pickupActive.fulfillmentStatus === 'pickup_ready' && pickupActive.warehouseFlowStatus === 'reserved' && Boolean(warehouseReservations[pickupActive.id]));
        await window.markCurrentPickupCollected();
        check('Выдача самовывоза списывает товар', pickupActive.fulfillmentStatus === 'pickup_collected' && pickupActive.warehouseFlowStatus === 'shipped' && inventoryMovements.length > movementsBeforePickup);
        if (pickupActive.paymentStatus !== 'paid') await toggleCurrentOrderPayment();
        check('Оплаченный выданный самовывоз архивируется', pickupActive.paymentStatus === 'paid' && pickupActive.archived === true);

        const cancellation = orders.find(order => !order.archived && order.fulfillmentStatus === 'active' && !['in_transit','awaiting_close'].includes(getOrderWorkflowStatus(order).code));
        openDetails(cancellation.id);
        if (cancellation.paymentStatus !== 'paid') toggleCurrentOrderPayment();
        openNotRelevantModal();
        document.getElementById('notRelevantReason').value = 'Клиент отменил заказ';
        document.getElementById('notRelevantNote').value = 'Автоматическая приёмочная проверка';
        await confirmNotRelevant();
        check('Отмена оплаченного заказа создаёт задачу возврата', cancellation.fulfillmentStatus === 'not_relevant' && cancellation.paymentStatus === 'refund_required' && cancellation.requiresAction === 'refund' && !cancellation.archived);
        openDetails(cancellation.id);
        await toggleCurrentOrderPayment();
        check('После возврата денег отменённый заказ архивируется', cancellation.paymentStatus === 'refunded' && cancellation.archived === true);

        const retryOrder = orders.find(order => order.fulfillmentStatus === 'not_delivered' && !order.archived);
        openDetails(retryOrder.id);
        await retryCurrentDelivery();
        check('Недоставленный заказ возвращается в распределение', retryOrder.fulfillmentStatus === 'active' && retryOrder.warehouseFlowStatus === 'planned' && !retryOrder.requiresAction);

        const partialOrder = orders.find(order => order.fulfillmentStatus === 'partial' && !order.fulfillmentResult?.resolution && asArray(order.fulfillmentResult?.remainingItems).length);
        const countBeforeContinuation = orders.length;
        openDetails(partialOrder.id);
        await resolveCurrentPartial('pickup');
        const child = orders.find(order => order.parentOrderId === partialOrder.id);
        check('Частичный заказ создаёт продолжение для остатка', orders.length === countBeforeContinuation + 1 && child && isPickup(child) && child.paymentStatus === 'paid' && orderGrandTotal(child) === 0);
        check('Родитель частичного заказа хранит связь с продолжением', partialOrder.fulfillmentResult?.resolution === 'remainder_pickup' && partialOrder.childOrderIds.includes(child.id));

        phase('route-lifecycle');
        createIsolatedBusinessFixture();
        details.routeReadiness = routeState().allDefs.map(def => {
          const readiness = routeReadinessV560(def);
          return { id: def.id, title: def.displayDistrict, executing: Boolean(routeExecutions[def.id]), ready: readiness.ready, reasons: readiness.reasons };
        });
        const readyRouteId = details.routeReadiness.find(item => !item.executing && item.ready)?.id;
        check('Учебная база содержит готовый к выезду рейс', Boolean(readyRouteId), readyRouteId || 'Подходящий рейс не найден');
        const readyDef = routeState().allDefs.find(item => item.id === readyRouteId);
        if (!readyDef) throw new Error('Не найден готовый рейс для проверки полного цикла');
        details.readyRoute = { id: readyRouteId, readiness: routeReadinessV560(readyDef) };
        const routeOrderIds = readyDef.orders.map(order => order.id);
        const archiveCountBefore = routeArchives.length;
        const movementsBeforeRoute = inventoryMovements.length;
        await startRoutePicking(readyRouteId);
        check('Комплектация переводит рейс и заказы в погрузку', routePlans[readyRouteId]?.lifecycleStatus === 'loading' && routeOrderIds.every(id => orders.find(order => order.id === id)?.fulfillmentStatus === 'picking'));
        const postPickingDef = routeState().allDefs.find(item => item.id === readyRouteId);
        const postPickingReadiness = postPickingDef ? routeReadinessV560(postPickingDef) : null;
        await startRoute(readyRouteId);
        const routeStarted = routeExecutions[readyRouteId]?.status === 'in_transit' && routeOrderIds.every(id => orders.find(order => order.id === id)?.fulfillmentStatus === 'in_transit');
        check('Выезд переводит рейс и заказы в путь', routeStarted, JSON.stringify({
          execution: routeExecutions[readyRouteId] || null,
          lifecycleStatus: routePlans[readyRouteId]?.lifecycleStatus || null,
          postPickingReadiness: postPickingReadiness ? { ready: postPickingReadiness.ready, reasons: postPickingReadiness.reasons, checks: postPickingReadiness.checks } : null,
          driver: typeof assignedDriverForRoute === 'function' ? assignedDriverForRoute(readyRouteId) : null,
          override: typeof routeOverride === 'function' ? routeOverride(readyRouteId) : null,
          orderStatuses: routeOrderIds.map(id => ({ id, status: orders.find(order => order.id === id)?.fulfillmentStatus || null })),
          alerts: window.__alerts.slice(-5),
          toasts: [...document.querySelectorAll('#jfToastStack .jf-toast')].slice(-5).map(item => item.textContent)
        }));
        await openRouteClosure(readyRouteId);
        for (const orderId of routeOrderIds) {
          setRouteOrderOutcome(orderId, 'delivered');
          updateRouteOutcomePaid(orderId, true);
        }
        document.getElementById('routeActualKm').value = String(Math.max(1, Number(routePlans[readyRouteId]?.distance || 1000) / 1000));
        await window.commitRouteClosure();
        check('Закрытие удаляет рейс из активных', !routeExecutions[readyRouteId] && !routePlans[readyRouteId]);
        check('Закрытие переносит рейс в архив', routeArchives.length === archiveCountBefore + 1 && routeArchives[0]?.id === readyRouteId);
        check('Доставленные и оплаченные заказы закрыты', routeOrderIds.every(id => {
          const order = orders.find(item => item.id === id);
          return order?.fulfillmentStatus === 'delivered' && order.warehouseFlowStatus === 'shipped' && order.paymentStatus === 'paid' && order.archived;
        }));
        check('Закрытие рейса проводит складской расход', inventoryMovements.length > movementsBeforeRoute);
        check('После закрытия нет зависших маршрутных ссылок', routeOrderIds.every(id => !routeAssignments[id] && !routeLocks[id]));
        phase('complete');
      } catch (error) {
        checks.push({ name: 'Глубокий бизнес-сценарий выполнился без исключения', ok: false, detail: error?.stack || String(error) });
      } finally {
        phase('restore');
        downloadBlob = nativeDownload;
        window.confirm = nativeConfirm;
        jfConfirm = nativeJfConfirm;
        orders = memory.orders;
        products = memory.products;
        inventoryMovements = memory.inventoryMovements;
        drivers = memory.drivers;
        settings = memory.settings;
        routePlans = memory.routePlans;
        routeAssignments = memory.routeAssignments;
        routeCatalog = memory.routeCatalog;
        routeDriverAssignments = memory.routeDriverAssignments;
        routeLocks = memory.routeLocks;
        routeOverrides = memory.routeOverrides;
        routeExecutions = memory.routeExecutions;
        routeArchives = memory.routeArchives;
        warehouseReservations = memory.warehouseReservations;
        reportingData = memory.reportingData;
        localStorage.clear();
        for (const [key, value] of Object.entries(raw)) localStorage.setItem(key, value);
        try { renderAll(); } catch {}
      }
      return {
        summary: {
          total: checks.length,
          passed: checks.filter(item => item.ok).length,
          failed: checks.filter(item => !item.ok).length
        },
        checks,
        details
      };
    })();`;
    window.document.body.append(deepScript);
    let deepTimer;
    try {
      deepBusinessResult = await Promise.race([
        window.__deepBusinessPromise,
        new Promise((_, reject) => {
          deepTimer = setTimeout(() => reject(new Error(`Deep business timeout at phase: ${window.__deepBusinessPhase || 'initialization'}`)), 120000);
        })
      ]);
    } finally {
      clearTimeout(deepTimer);
    }
  } catch (error) {
    errors.push({ phase: 'deep-business', level: 'error', text: error.stack || String(error) });
  }
}

let orderPrintResult = null;
if (orderPrintMode) {
  try {
    const printScript = window.document.createElement('script');
    printScript.textContent = `window.__orderPrintResult = (() => {
      const previousOrders=orders,previousDrivers=drivers,previousDetailId=currentDetailId,now=new Date().toISOString(),date=todayISO();
      const item={id:'print-item',productId:'print-product',article:'PRINT-1',name:'Проверочный товар',unit:'шт',qty:2,price:1250,catalogPrice:1100,priceOverridden:true,total:2500,volumeM3:0.05,weightKg:12,composition:[{name:'Комплектующая',qty:2,unit:'шт',note:'проверить'}]};
      const common={createdAt:now,updatedAt:now,deliveryDate:date,contactName:'Иван Петров',contactMethod:'+7 900 000-00-00',items:[item],goodsTotal:2500,total:2500,grandTotal:2500,status:'new',fulfillmentStatus:'active',paymentMethod:'cash',paymentStatus:'pending'};
      const delivery=normalizeOrder({...common,id:'print-delivery',number:'PRINT-DELIVERY',orderType:'delivery',deliveryAddress:'Москва, тестовый адрес',deliveryCost:500,grandTotal:3000,deliveryDistanceKm:5,deliveryRate:100});
      const pickup=normalizeOrder({...common,id:'print-pickup',number:'PRINT-PICKUP',orderType:'pickup',deliveryAddress:''});
      const archived=normalizeOrder({...common,id:'print-archive',number:'PRINT-ARCHIVE',orderType:'delivery',deliveryAddress:'Архивный адрес',fulfillmentStatus:'delivered',warehouseFlowStatus:'shipped',paymentStatus:'paid',archived:true,archivedAt:now});
      const refund=normalizeOrder({...common,id:'print-refund',number:'PRINT-REFUND',paymentMethod:'invoice',paymentStatus:'refund_required',fulfillmentStatus:'not_relevant',warehouseFlowStatus:'released',requiresAction:'refund'}),nullSafe=normalizeOrder(null),activeWarehouseId=String(TeplitsaWarehouseBootstrap.activeWarehouse()?.id||'');
      const aggregator=normalizeDriver({id:'driver-details-aggregator',name:'Проверочная служба доставки',phone:'+7 900 000-00-01',active:true,workerType:'aggregator',providerCode:'other',providerName:'Проверочный агрегатор',providerAccount:'ACCOUNT-1',providerContact:'Поддержка',multiBookingAllowed:true,paymentProfile:{mode:'aggregator',pricingMode:'quote'},brand:'Фургон',model:'XL',bodyLength:4,bodyWidth:2,bodyHeight:2,payloadKg:1500,createdAt:now,updatedAt:now}),nullSafeDriver=normalizeDriver(null);
      const inspectPrint=(order,required)=>{currentDetailId=order.id;printCurrentOrder();const html=document.getElementById('printArea')?.innerHTML||'',plain=html.replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim();return{ok:required.every(text=>plain.includes(text))&&!/(?:undefined|NaN|\\[object Object\\]|ТЕПЛИЦА78)/i.test(plain),length:plain.length,missing:required.filter(text=>!plain.includes(text)),forbidden:plain.match(/(?:undefined|NaN|\\[object Object\\]|ТЕПЛИЦА78)/i)?.[0]||'',hasComposition:plain.includes('Комплектующая'),hasManualPrice:plain.includes('Цена строки изменена в заказе'),hasPayment:plain.includes('Оплата заказа')};};
      const inspectDetails=(order,required)=>{openDetails(order.id);const body=document.getElementById('detailBody'),plain=String(body?.textContent||'').replace(/\\s+/g,' ').trim(),missing=required.filter(text=>!plain.includes(text));return{ok:Boolean(body)&&missing.length===0&&!/(?:undefined|NaN|\\[object Object\\])/i.test(plain),length:plain.length,missing,hasComposition:plain.includes('Комплектующая'),hasLoadingPlan:plain.includes('План погрузки и контроль автомобиля'),hasPayment:plain.includes('Вид оплаты')&&plain.includes('Статус оплаты'),hasWorkflow:plain.includes('Выполнение')&&plain.includes('История статусов'),deleteHidden:document.getElementById('deleteOrderBtn')?.style.display==='none'};};
      const inspectDriver=driver=>{openDriverDetails(driver.id);const plain=String(document.getElementById('driverDetailBody')?.textContent||'').replace(/\\s+/g,' ').trim(),required=['Профиль службы доставки','Проверочный агрегатор','Учёт стоимости','Расчёт оплаты по рейсам','Начисления появятся после расчёта назначенных рейсов'];return{ok:required.every(text=>plain.includes(text))&&!/(?:undefined|NaN|\\[object Object\\])/i.test(plain),missing:required.filter(text=>!plain.includes(text)),length:plain.length};};
      const inspectOrderList=()=>{for(const id of ['searchInput','orderRegionFilter','orderDistrictFilter','orderDateFilter','orderStatusFilter']){const field=document.getElementById(id);if(field)field.value='';}const filter=document.getElementById('orderArchiveFilter');if(!filter)return{ok:false,reason:'Нет фильтра архива'};filter.value='active';renderOrders();const activeText=document.getElementById('ordersArea')?.textContent||'',activeBadges=document.querySelectorAll('#ordersArea .payment-pill').length;filter.value='archive';renderOrders();const archiveText=document.getElementById('ordersArea')?.textContent||'';filter.value='all';renderOrders();const allText=document.getElementById('ordersArea')?.textContent||'';filter.value='active';return{ok:activeText.includes('PRINT-DELIVERY')&&!activeText.includes('PRINT-ARCHIVE')&&archiveText.includes('PRINT-ARCHIVE')&&!archiveText.includes('PRINT-DELIVERY')&&allText.includes('PRINT-DELIVERY')&&allText.includes('PRINT-ARCHIVE')&&activeBadges>0,activeBadges};};
      try{orders=[delivery,pickup,archived,...previousOrders];drivers=[aggregator,...previousDrivers];const orderList=inspectOrderList(),deliveryDetails=inspectDetails(delivery,['Выполнение','Вид оплаты','План погрузки и контроль автомобиля','Комплектующая','История статусов']),pickupDetails=inspectDetails(pickup,['Выполнение','Вид оплаты','Самовывоз со склада','Комплектующая','История статусов']),driverDetails=inspectDriver(aggregator),deliveryResult=inspectPrint(delivery,['Заказ на доставку','PRINT-DELIVERY','Оплата заказа','Получатель принял']),pickupResult=inspectPrint(pickup,['Лист выдачи','PRINT-PICKUP','Оплата заказа','Пункт выдачи','Получил']),normalization={ok:delivery.warehouseId===activeWarehouseId&&pickup.warehouseId===activeWarehouseId&&refund.warehouseId===activeWarehouseId&&aggregator.warehouseId===activeWarehouseId&&aggregator.workerType==='aggregator'&&aggregator.paymentProfile.pricingMode==='quote'&&Boolean(nullSafeDriver?.id)&&nullSafeDriver.warehouseId===activeWarehouseId&&refund.paymentMethod==='invoice'&&refund.paymentStatus==='refund_required'&&refund.fulfillmentStatus==='not_relevant'&&refund.warehouseFlowStatus==='released'&&refund.requiresAction==='refund'&&refund.statusHistory.length>0&&Boolean(nullSafe?.id)&&nullSafe.warehouseId===activeWarehouseId,deliveryWarehouseId:delivery.warehouseId,driverWarehouseId:aggregator.warehouseId,refund:{paymentMethod:refund.paymentMethod,paymentStatus:refund.paymentStatus,fulfillmentStatus:refund.fulfillmentStatus,warehouseFlowStatus:refund.warehouseFlowStatus,requiresAction:refund.requiresAction},nullSafe:Boolean(nullSafe?.id),nullSafeDriver:Boolean(nullSafeDriver?.id)};return{ok:normalization.ok&&orderList.ok&&deliveryDetails.ok&&pickupDetails.ok&&driverDetails.ok&&deliveryDetails.hasComposition&&deliveryDetails.hasLoadingPlan&&deliveryDetails.hasPayment&&deliveryDetails.hasWorkflow&&deliveryDetails.deleteHidden&&pickupDetails.deleteHidden&&deliveryResult.ok&&pickupResult.ok&&deliveryResult.hasComposition&&deliveryResult.hasManualPrice&&deliveryResult.hasPayment&&pickupResult.hasPayment,normalization,orderList,deliveryDetails,pickupDetails,driverDetails,delivery:deliveryResult,pickup:pickupResult};}
      finally{orders=previousOrders;drivers=previousDrivers;currentDetailId=previousDetailId;}
    })();`;
    window.document.body.append(printScript);
    orderPrintResult = window.__orderPrintResult;
    if (!orderPrintResult?.ok) errors.push({ phase:'order-print', level:'error', text:JSON.stringify(orderPrintResult) });
  } catch (error) {
    errors.push({ phase:'order-print', level:'error', text:error.stack || String(error) });
  }
}

let orderSaveIntegrityResult = null;
if (orderSaveIntegrityMode) {
  try {
    const saveScript = window.document.createElement('script');
    saveScript.textContent = `window.__orderSaveIntegrityPromise = (async () => {
      for(let attempt=0;attempt<100&&ordersHydrationPending&&!ordersHydrationDone;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
      if(ordersHydrationPending&&!ordersHydrationDone)throw new Error('order-save integrity requires completed order hydration');
      const snapshot={orders:cloneValue(orders),routePlans:cloneValue(routePlans),routeAssignments:cloneValue(routeAssignments),routeCatalog:cloneValue(routeCatalog),routeDriverAssignments:cloneValue(routeDriverAssignments),routeLocks:cloneValue(routeLocks),routeOverrides:cloneValue(routeOverrides),routeExecutions:cloneValue(routeExecutions),currentDetailId,selectedGeo:cloneValue(selectedGeo),geoDirty,deliveryCalculation:cloneValue(deliveryCalculation)},previousConfirm=jfConfirm;
      const now=new Date().toISOString(),wid=currentWarehouseIdV560(),item={id:'save-item',name:'Проверочный груз',article:'SAVE-1',unit:'шт',qty:1,price:1000,total:1000,volumeM3:.1,weightKg:10};
      const makeOrder=(id,number,date,region,district)=>normalizeOrder({id,number,orderType:'delivery',createdAt:now,updatedAt:now,contactName:'Получатель',contactMethod:'+7 900 000-00-00',deliveryDate:date,driverNote:'',deliveryAddress:district,geo:{lat:55.7,lon:37.6,displayName:district,region,district,settlement:district,source:'test'},items:[item],goodsTotal:1000,total:1000,deliveryDistanceKm:10,deliveryRate:100,deliveryCost:1000,deliveryAutoCost:1000,deliveryStandaloneCost:1000,grandTotal:2000,paymentMethod:'cash',paymentStatus:'pending',warehouseId:wid});
      const affected=makeOrder('save-affected','SAVE-A','2026-09-01','Москва','ЦАО'),unrelated=makeOrder('save-unrelated','SAVE-B','2026-09-02','Тверская область','Тверь'),active=makeOrder('save-active','SAVE-C','2026-09-03','Москва','САО');
      const configureForm=(editingId,date,region,district)=>{$('editingOrderId').value=editingId;$('contactName').value='Новый получатель';$('contactMethod').value='+7 999 000-00-00';$('deliveryDate').value=date;$('driverNote').value='Проверка целостности';$('deliveryAddress').value=district;$('manualRegion').value=region;$('manualDistrict').value=district;if($('paymentMethod'))$('paymentMethod').value='transfer';if($('paymentStatus'))$('paymentStatus').value='paid';$('items').innerHTML='';addItem(item);selectedGeo={lat:55.75,lon:37.62,displayName:district,region,district,settlement:district,road:'',house:'',postcode:'',source:'test'};geoDirty=false;deliveryCalculation={distanceKm:12,cost:1200,autoCost:1200,source:'Проверочный расчёт',calculating:false,error:'',manual:false,manualMode:'auto',pricingMode:'per_km',radiusKm:8};deliveryCalcPromise=Promise.resolve()};
      try{
        orders=[affected,unrelated,active];routeAssignments={[active.id]:'route-active'};routeLocks={[active.id]:'route-active'};routeCatalog={'route-active':{id:'route-active',key:'route-active',date:active.deliveryDate,region:'Москва',district:'САО',title:'Активный рейс',custom:true}};routeDriverAssignments={'route-active':'driver-active'};routeOverrides={'route-active':{routeMode:'round'}};routeExecutions={'route-active':{id:'route-active',status:'in_transit',orderIds:[active.id],driverId:'driver-active'}};
        const initial=routeState().allDefs,affectedDef=initial.find(def=>def.orders.some(order=>order.id===affected.id)),unrelatedDef=initial.find(def=>def.orders.some(order=>order.id===unrelated.id));
        routePlans={[affectedDef.id]:{orderedIds:[affected.id],signature:routeSignature([affected]),marker:'affected'},[unrelatedDef.id]:{orderedIds:[unrelated.id],signature:routeSignature([unrelated]),marker:'unrelated'},'route-active':{orderedIds:[active.id],signature:routeSignature([active]),marker:'active'}};
        const beforeIds=new Set(orders.map(order=>order.id));configureForm('','2026-09-01','Москва','ЦАО');const created=await saveOrder({preventDefault(){}}),createdOrder=created||orders.find(order=>!beforeIds.has(order.id));
        const createChecks={affectedInvalidated:!routePlans[affectedDef.id],unrelatedPreserved:routePlans[unrelatedDef.id]?.marker==='unrelated',activePreserved:routePlans['route-active']?.marker==='active',activeExecutionPreserved:routeExecutions['route-active']?.status==='in_transit',activeAssignmentPreserved:routeAssignments[active.id]==='route-active'&&routeLocks[active.id]==='route-active',savedMetadata:createdOrder?.warehouseId===wid&&createdOrder?.paymentMethod==='transfer'&&createdOrder?.paymentStatus==='paid'&&createdOrder?.paidAt&&createdOrder?.deliveryStandaloneCost===1200&&createdOrder?.fulfillmentStatus==='active'};
        const editable=makeOrder('save-edit','SAVE-D','2026-09-04','Москва','ЮАО');editable.statusHistory=[{id:'history-edit',at:now,type:'created',label:'Исходная история',note:'',meta:{}}];orders=[editable,unrelated,active,createdOrder];routeAssignments[editable.id]='route-edit';routeCatalog['route-edit']={id:'route-edit',key:'route-edit',date:editable.deliveryDate,region:'Москва',district:'ЮАО',title:'Редактируемый рейс',custom:true};routeDriverAssignments['route-edit']='driver-edit';routeOverrides['route-edit']={routeMode:'oneway'};routePlans['route-edit']={orderedIds:[editable.id],signature:routeSignature([editable]),marker:'editable'};configureForm(editable.id,'2026-09-05','Калужская область','Обнинск');const edited=await saveOrder({preventDefault(){}});
        const editChecks={detached:!Object.prototype.hasOwnProperty.call(routeAssignments,editable.id),oldPlanInvalidated:!routePlans['route-edit'],orphanRouteRemoved:!routeCatalog['route-edit']&&!routeDriverAssignments['route-edit']&&!routeOverrides['route-edit'],unrelatedStillPreserved:routePlans[unrelatedDef.id]?.marker==='unrelated',activeStillPreserved:routePlans['route-active']?.marker==='active'&&routeExecutions['route-active']?.status==='in_transit',historyPreserved:edited?.statusHistory?.some(entry=>entry.id==='history-edit'),warehousePreserved:edited?.warehouseId===wid};
        $('editingPickupId').value='';$('pickupItems').innerHTML='';if($('pickupPaymentMethod'))$('pickupPaymentMethod').value='cash';if($('pickupPaymentStatus'))$('pickupPaymentStatus').value='pending';addPickupItem(item);const pickup=await savePickup({preventDefault(){}}),pickupChecks={unrelatedPreserved:routePlans[unrelatedDef.id]?.marker==='unrelated',activePreserved:routePlans['route-active']?.marker==='active'&&routeExecutions['route-active']?.status==='in_transit',saved:pickup?.orderType==='pickup'&&pickup?.warehouseId===wid};
        const deletable=makeOrder('save-delete','SAVE-E','2026-09-06','Ярославская область','Ярославль');orders.push(deletable);const deleteDef=routeState().allDefs.find(def=>def.orders.some(order=>order.id===deletable.id));routePlans[deleteDef.id]={orderedIds:[deletable.id],signature:routeSignature([deletable]),marker:'delete-target'};jfConfirm=async()=>true;const deleteResult=await deleteOrder(deletable.id),deleteChecks={removed:deleteResult===true&&!orders.some(order=>order.id===deletable.id),targetInvalidated:!routePlans[deleteDef.id],unrelatedPreserved:routePlans[unrelatedDef.id]?.marker==='unrelated',activePreserved:routePlans['route-active']?.marker==='active'&&routeExecutions['route-active']?.status==='in_transit'};
        const unassigned=makeOrder('save-unassigned','SAVE-F','2026-09-07','Москва','ЗАО');orders.push(unassigned);routeAssignments[unassigned.id]='__unassigned__';routePlans['restore-stale']={orderedIds:[unassigned.id],signature:'stale',marker:'restore-stale'};const restoreResult=restoreAutoAssignment(unassigned.id),restoreChecks={assignmentRemoved:restoreResult===true&&!Object.prototype.hasOwnProperty.call(routeAssignments,unassigned.id),stalePlanInvalidated:!routePlans['restore-stale'],activePreserved:routePlans['route-active']?.marker==='active'&&routeExecutions['route-active']?.status==='in_transit'};
        const invalidated=invalidateMutableRoutePlansV560(),globalChecks={mutableRemoved:invalidated.includes(unrelatedDef.id)&&!routePlans[unrelatedDef.id],activePreserved:routePlans['route-active']?.marker==='active'&&routeExecutions['route-active']?.status==='in_transit'};
        const checks={...Object.fromEntries(Object.entries(createChecks).map(([key,value])=>['create.'+key,Boolean(value)])),...Object.fromEntries(Object.entries(editChecks).map(([key,value])=>['edit.'+key,Boolean(value)])),...Object.fromEntries(Object.entries(pickupChecks).map(([key,value])=>['pickup.'+key,Boolean(value)])),...Object.fromEntries(Object.entries(deleteChecks).map(([key,value])=>['delete.'+key,Boolean(value)])),...Object.fromEntries(Object.entries(restoreChecks).map(([key,value])=>['restore.'+key,Boolean(value)])),...Object.fromEntries(Object.entries(globalChecks).map(([key,value])=>['global.'+key,Boolean(value)]))};return{ok:Object.values(checks).every(Boolean),checks,createdId:createdOrder?.id||'',editedId:edited?.id||'',pickupId:pickup?.id||''};
      }finally{jfConfirm=previousConfirm;orders=snapshot.orders;routePlans=snapshot.routePlans;routeAssignments=snapshot.routeAssignments;routeCatalog=snapshot.routeCatalog;routeDriverAssignments=snapshot.routeDriverAssignments;routeLocks=snapshot.routeLocks;routeOverrides=snapshot.routeOverrides;routeExecutions=snapshot.routeExecutions;currentDetailId=snapshot.currentDetailId;selectedGeo=snapshot.selectedGeo;geoDirty=snapshot.geoDirty;deliveryCalculation=snapshot.deliveryCalculation;try{renderAll()}catch{}}
    })();`;
    window.document.body.append(saveScript);
    orderSaveIntegrityResult = await window.__orderSaveIntegrityPromise;
    if (!orderSaveIntegrityResult?.ok) errors.push({ phase:'order-save-integrity', level:'error', text:JSON.stringify(orderSaveIntegrityResult) });
  } catch (error) {
    errors.push({ phase:'order-save-integrity', level:'error', text:error.stack || String(error) });
  }
}

let roleMatrixResult = null;
if (roleMatrixMode) {
  const testHasPermission = permission => {
    const list = rolePermissions[testServerRole] || [];
    const domain = String(permission).split('.')[0];
    return testServerRole === 'owner' || list.includes('*') || list.includes(permission) || list.includes(`${domain}.*`);
  };
  const tabMap = {
    orders: 'tabOrders', trips: 'tabTrips', products: 'tabProducts', drivers: 'tabDrivers',
    reports: 'tabReports', settings: 'tabSettings', programSettings: 'tabProgramSettings'
  };
  const visibleTabs = Object.entries(tabMap)
    .filter(([, id]) => !window.document.getElementById(id)?.classList.contains('jf-role-hidden'))
    .map(([tab]) => tab);
  const expectedTabs = testServerRole === 'owner'
    ? Object.keys(tabMap)
    : [
        testHasPermission('orders.read') && 'orders',
        testHasPermission('routes.read') && 'trips',
        testHasPermission('inventory.read') && 'products',
        testHasPermission('drivers.read') && 'drivers',
        testHasPermission('reports.read') && 'reports',
        testHasPermission('routes.settings') && 'settings',
        (testHasPermission('users.read') || testHasPermission('devices.manage')) && 'programSettings'
      ].filter(Boolean);
  const tabClasses = Object.fromEntries(Object.entries(tabMap).map(([tab, id]) => [tab, window.document.getElementById(id)?.className || null]));
  const controlSelectors = {
    orderCreate: ['button[data-jf-onclick="openOrderModal()"]', 'orders.create'],
    pickupCreate: ['button[data-jf-onclick="openPickupModal()"]', 'orders.create'],
    inventoryUpdate: ['button[data-jf-onclick="openProductModal()"]', 'inventory.catalog'],
    driverUpdate: ['button[data-jf-onclick="openDriverModal()"]', 'drivers.update'],
    routeSettings: ['button[data-jf-onclick="saveSettingsFromForm()"]', 'routes.settings']
  };
  const controls = {};
  for (const [name, [selector, permission]] of Object.entries(controlSelectors)) {
    const control = window.document.querySelector(selector);
    controls[name] = {
      found: Boolean(control),
      hidden: Boolean(control?.classList.contains('jf-role-hidden')),
      permission,
      expectedAllowed: testHasPermission(permission)
    };
  }
  const probes = [];
  const probeMap = {
    openOrderModal: 'orders.create',
    openDriverModal: 'drivers.update',
    openProductModal: 'inventory.catalog',
    saveSettingsFromForm: 'routes.settings',
    saveCompanySettingsV600: 'company.update'
  };
  for (const [name, permission] of Object.entries(probeMap)) {
    const fn = window[name];
    if (typeof fn !== 'function') {
      probes.push({ name, permission, found: false });
      continue;
    }
    const before = JSON.parse(window.localStorage.getItem('jf_auth_audit_v750') || '[]').map(item => item.id);
    let invocationError = '';
    try {
      const returned = fn();
      if (returned && typeof returned.then === 'function') await returned;
    } catch (error) {
      invocationError = error?.stack || String(error);
    }
    const after = JSON.parse(window.localStorage.getItem('jf_auth_audit_v750') || '[]');
    const denied = after.some(item => !before.includes(item.id) && item.action === 'forbidden_action' && item.detail?.action === name);
    probes.push({ name, permission, found: true, denied, expectedDenied: !testHasPermission(permission), invocationError });
    try { window.closeOrderModal?.(); } catch {}
    try { window.closeDriverModal?.(); } catch {}
    try { window.closeProductModal?.(); } catch {}
  }
  const failures = [
    ...((visibleTabs.length !== expectedTabs.length || visibleTabs.some((tab, index) => tab !== expectedTabs[index]))
      ? [{ type: 'tabs', visibleTabs, expectedTabs }]
      : []),
    ...Object.entries(controls).filter(([, item]) => !item.found || item.hidden === item.expectedAllowed).map(([name, item]) => ({ type: 'control', name, ...item })),
    ...probes.filter(item => !item.found || item.denied !== item.expectedDenied || item.invocationError).map(item => ({ type: 'probe', ...item }))
  ];
  if (failures.length) errors.push({ phase: 'role-matrix', level: 'error', text: JSON.stringify(failures) });
  roleMatrixResult = { role: testServerRole, accessSnapshot: window.__JustFunRoleTest?.snapshot?.() || null, visibleTabs, expectedTabs, tabClasses, controls, probes, failures };
}

let securityFuzzResult = null;
if (securityFuzzMode) {
  try {
    const fuzzScript = window.document.createElement('script');
    fuzzScript.textContent = `window.__securityFuzzResult = (() => {
      const htmlPayload = '\"><img src=x data-jf-xss-probe=html onerror=window.__JF_XSS_EXECUTED=true>';
      const inlinePayload = "');window.__JF_XSS_EXECUTED=true;//";
      const payload = htmlPayload + inlinePayload;
      const findings = [];
      let everExecuted = false;
      window.__JF_XSS_EXECUTED = false;
      const snapshot = {
        orders: JSON.parse(JSON.stringify(orders)),
        products: JSON.parse(JSON.stringify(products)),
        drivers: JSON.parse(JSON.stringify(drivers)),
        routePlans: JSON.parse(JSON.stringify(routePlans)),
        routeOverrides: JSON.parse(JSON.stringify(routeOverrides)),
        reportingData: JSON.parse(JSON.stringify(reportingData)),
        settings: JSON.parse(JSON.stringify(settings))
      };
      const probe = surface => {
        const dangerous = [...document.querySelectorAll('*')].filter(node =>
          node.hasAttribute('data-jf-xss-probe')
          || [...node.attributes].some(attr => /^on/i.test(attr.name) && /__JF_XSS_EXECUTED|data-jf-xss-probe/i.test(attr.value))
        );
        for (const node of dangerous) {
          for (const attr of [...node.attributes]) {
            const match = attr.name.match(/^on(.+)/i);
            if (match) {
              try { node.dispatchEvent(new Event(match[1], { bubbles:true, cancelable:true })); } catch {}
            }
          }
        }
        const executed=Boolean(window.__JF_XSS_EXECUTED);everExecuted=everExecuted||executed;
        findings.push({ surface, dangerousAttributes:dangerous.map(node => ({
          node:node.outerHTML.slice(0,500),
          parent:node.parentElement?.outerHTML.slice(0,1200) || '',
          id:node.id || '',
          className:String(node.className || '')
        })), executed });
        window.__JF_XSS_EXECUTED=false;
      };
      const safeCall = (surface, fn) => {
        try { fn(); probe(surface); }
        catch (error) { findings.push({ surface, runtimeError:error?.stack || String(error), executed:Boolean(window.__JF_XSS_EXECUTED) }); }
      };
      try {
        const productSeed = products[0] || {};
        const driverSeed = drivers[0] || {};
        const orderSeed = orders[0] || {};
        const productId = 'product-security-fuzz';
        const driverId = 'driver-security-fuzz';
        const orderId = 'order-security-fuzz';
        products.push({
          ...JSON.parse(JSON.stringify(productSeed)), id:productId, name:payload, article:payload,
          category:payload, supplier:payload, binLocation:payload, barcode:payload, notes:payload,
          unit:payload, price:100, purchasePrice:50, stockTracked:true, stockQty:10, reservedQty:0
        });
        drivers.push({
          ...JSON.parse(JSON.stringify(driverSeed)), id:driverId, name:payload, phone:payload,
          contactNote:payload, brand:payload, model:payload, plate:payload, active:true,
          bodyLength:3, bodyWidth:2, bodyHeight:2, payloadKg:1500,
          createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
        });
        orders.push({
          ...JSON.parse(JSON.stringify(orderSeed)), id:orderId, number:'SEC-FUZZ-1', contactName:payload,
          contactPhone:payload, deliveryAddress:payload, comment:payload, clientNote:payload,
          driverNote:payload, deliveryDate:new Date().toISOString().slice(0,10), status:'new',
          items:[{ id:'item-security-fuzz', productId, name:payload, unit:payload, qty:1, price:100, volumeM3:1, weightKg:1 }],
          total:100, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
        });
        reportingData.employees.push({ id:'employee-security-fuzz', name:payload, position:payload, monthlySalary:1000, activeFrom:'2026-01-01', activeTo:'' });
        reportingData.expenses.push({ id:'expense-security-fuzz', name:payload, category:payload, note:payload, amount:100, mode:'one_time', date:'2026-01-01' });
        settings.company = { ...(settings.company || {}), programName:payload, shortName:payload, legalName:payload,
          contactPerson:payload, phone:payload, email:payload, website:payload, legalAddress:payload,
          actualAddress:payload, promoTitle:payload, promoText:payload, promoBenefits:[payload], promoCta:payload,
          logoDataUrl:'x' + payload, showLogoInProgram:true, showLogoInDocuments:true };
        settings.warehouse = { ...(settings.warehouse || {}), name:payload, address:payload };
        safeCall('orders-list', () => renderOrders());
        safeCall('order-details', () => openDetails(orderId));
        safeCall('order-print', () => printCurrentOrder());
        safeCall('products-list', () => renderProducts());
        safeCall('product-details', () => openProductDetails(productId));
        safeCall('drivers-list', () => renderDrivers());
        safeCall('driver-details', () => openDriverDetails(driverId));
        safeCall('report-settings', () => { renderReportEmployees(); renderReportExpenses(); });
        safeCall('report-dashboard', () => renderReport());
        safeCall('report-print', () => printReport());
        safeCall('company-and-warehouse', () => { renderAll(); window.TeplitsaWarehouseV600?.render?.(); });
        safeCall('program-logo', () => window.TeplitsaWarehouseV600?.applyIdentity?.());
      } finally {
        orders = snapshot.orders;
        products = snapshot.products;
        drivers = snapshot.drivers;
        routePlans = snapshot.routePlans;
        routeOverrides = snapshot.routeOverrides;
        reportingData = snapshot.reportingData;
        settings = snapshot.settings;
        try { renderAll(); } catch {}
      }
      return {
        ok: !everExecuted && findings.every(item => !item.runtimeError && item.dangerousAttributes?.length === 0),
        executed:everExecuted,
        surfaces:findings.length,
        findings
      };
    })();`;
    window.document.body.append(fuzzScript);
    securityFuzzResult = window.__securityFuzzResult;
    if (!securityFuzzResult?.ok) errors.push({ phase:'security-fuzz', level:'error', text:JSON.stringify(securityFuzzResult) });
  } catch (error) {
    errors.push({ phase:'security-fuzz', level:'error', text:error.stack || String(error) });
  }
}

let accessibilityResult = null;
if (accessibilityMode) {
  const finding = (code, element, detail = '') => ({
    code,
    element: element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}` : '',
    detail
  });
  const findings = [];
  const doc = window.document;
  window.__JustFunAccessibilityV595?.refresh?.();
  const ids = [...doc.querySelectorAll('[id]')].map(element => element.id).filter(Boolean);
  for (const id of new Set(ids)) if (ids.filter(value => value === id).length > 1) findings.push(finding('duplicate-id', doc.getElementById(id), id));
  const explicitLabels = new Map();
  for (const label of doc.querySelectorAll('label[for]')) {
    const target = label.getAttribute('for');
    if (!target) continue;
    explicitLabels.set(target, `${explicitLabels.get(target) || ''} ${label.textContent || ''}`.trim());
  }
  const labelText = element => `${explicitLabels.get(element.id) || ''} ${element.closest('label')?.textContent || ''} ${element.closest('label')?.title || ''}`.replace(/\s+/g, ' ').trim();
  const labelledText = element => {
    const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)?.textContent || '').join(' ');
    const buttonValue = element.matches('input[type="button"],input[type="submit"],input[type="reset"]') ? element.value : '';
    return [element.getAttribute('aria-label'), labelledBy, labelText(element), element.textContent, element.getAttribute('title'), buttonValue].map(value => String(value || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  };
  for (const control of doc.querySelectorAll('button,input:not([type="hidden"]):not([hidden]),select:not([hidden]),textarea:not([hidden]),a[href]')) {
    if(control.style?.display==='none'||control.style?.visibility==='hidden')continue;
    if (!labelledText(control)) findings.push(finding('control-without-accessible-name', control));
    if (control.matches('input:not([type="button"]):not([type="submit"]):not([type="reset"]),select,textarea') && !(labelText(control) || control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby'))) findings.push(finding('field-without-label', control, control.getAttribute('placeholder') || ''));
  }
  for (const image of doc.querySelectorAll('img')) if (!image.hasAttribute('alt')) findings.push(finding('image-without-alt', image, image.getAttribute('src') || ''));
  for (const interactive of doc.querySelectorAll('[data-jf-onclick]:not(button):not(a):not(input):not(select):not(textarea)')) {
    const action=String(interactive.getAttribute('data-jf-onclick') || '');if(!/\b(?:open|edit|show|select|toggle)[A-Z\w]*\s*\(/.test(action))continue;
    if (!interactive.hasAttribute('tabindex') || !interactive.hasAttribute('role')) findings.push(finding('mouse-only-interaction', interactive, action.slice(0,120)));
  }
  const dialogTests = [];
  const testDialog = async (name, opener, selector) => {
    if (!opener) { dialogTests.push({ name, ok:false, reason:'opener missing' }); return; }
    opener.focus(); opener.click(); await new Promise(resolve => setTimeout(resolve, 30));
    const modal = doc.querySelector(selector);
    const open = Boolean(modal?.classList.contains('open'));
    const role = modal?.getAttribute('role') === 'dialog';
    const ariaModal = modal?.getAttribute('aria-modal') === 'true';
    const labelled = Boolean(modal?.getAttribute('aria-label') || modal?.getAttribute('aria-labelledby'));
    const focusInside = Boolean(modal?.contains(doc.activeElement));
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const closed = !modal?.classList.contains('open');
    const restored = doc.activeElement === opener;
    const item = { name, open, role, ariaModal, labelled, focusInside, closed, restored, ok:open && role && ariaModal && labelled && focusInside && closed && restored };
    dialogTests.push(item);
    if (!item.ok) findings.push(finding('dialog-keyboard-contract', modal, JSON.stringify(item)));
  };
  await testDialog('profile', doc.querySelector('#jfProfileBtn'), '#jfProfileModal');
  window.showView?.('programSettings');
  await new Promise(resolve => setTimeout(resolve, 30));
  const integrationBox=doc.querySelector('#jfRegIntegrationsBox'),integrationToggle=integrationBox?.querySelector(':scope > .settings-accordion-toggle-v610');if(integrationBox&&!integrationBox.classList.contains('open'))integrationToggle?.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const integrationActions=[...doc.querySelectorAll('#jfRegIntegrationsBox [data-jf-integration-action],#jfTelegramIntegrationsBox [data-jf-integration-action]')],integrationBody=integrationBox?.querySelector(':scope > .settings-accordion-body-v610');
  const integrationTraining={toggleEnabled:Boolean(integrationToggle&&!integrationToggle.disabled),opened:Boolean(integrationBox?.classList.contains('open')&&!integrationBody?.hidden),actions:integrationActions.length,actionsDisabled:integrationActions.length===8&&integrationActions.every(button=>button.disabled)};
  integrationTraining.ok=integrationTraining.toggleEnabled&&integrationTraining.opened&&integrationTraining.actionsDisabled;
  if(!integrationTraining.ok)findings.push(finding('training-integration-readonly-contract',integrationBox,JSON.stringify(integrationTraining)));
  const helpButton = doc.querySelector('#jfRegIntegrationsBox .jf-instruction-btn') || doc.querySelector('#programSettingsView .jf-instruction-btn');
  await testDialog('help', helpButton, '#jfHelpModal');
  window.showView?.('trips');
  window.JustFunTelegramRoutesV783?.decorate?.();
  await new Promise(resolve => setTimeout(resolve, 30));
  const routeTelegram=doc.querySelector('#tripsArea .jf-route-telegram'),routeTelegramActions=[...doc.querySelectorAll('#tripsArea [data-route-tg]')];
  window.showView?.('drivers');
  window.eval("(()=>{const driver=(typeof drivers!=='undefined'?drivers:[]).find(item=>!(typeof driverIsAggregator==='function'&&driverIsAggregator(item)));if(driver)openDriverDetails(driver.id)})()");
  await new Promise(resolve => setTimeout(resolve, 30));
  const driverTelegram=doc.querySelector('.jf-telegram-driver'),driverTelegramActions=[...driverTelegram?.querySelectorAll('button')||[]];
  const telegramTraining={routeVisible:Boolean(routeTelegram),routeActions:routeTelegramActions.length,routeDisabledCount:routeTelegramActions.filter(button=>button.disabled).length,routeDisabled:routeTelegramActions.length>=2&&routeTelegramActions.every(button=>button.disabled),driverVisible:Boolean(driverTelegram),driverActions:driverTelegramActions.length,driverDisabled:driverTelegramActions.length===2&&driverTelegramActions.every(button=>button.disabled)};
  telegramTraining.ok=telegramTraining.routeVisible&&telegramTraining.routeDisabled&&telegramTraining.driverVisible&&telegramTraining.driverDisabled;
  if(!telegramTraining.ok)findings.push(finding('training-telegram-readonly-contract',routeTelegram||driverTelegram,JSON.stringify(telegramTraining)));
  window.closeDriverDetailModal?.();
  window.showView?.('programSettings');
  window.openWarehouseEditorV600?.();
  await new Promise(resolve => setTimeout(resolve, 100));
  const warehouseModal=doc.querySelector('#warehouseEditorModalV600'),warehouseMap=warehouseModal?.querySelector('#warehouseLocationMapV600'),warehouseSave=warehouseModal?.querySelector('button[type="submit"]');
  const warehouseTraining={opened:Boolean(warehouseModal?.classList.contains('open')),mapVisible:Boolean(warehouseMap),saveBlocked:Boolean(warehouseSave?.classList.contains('jf-role-hidden')&&warehouseSave?.getAttribute('aria-hidden')==='true')};
  warehouseTraining.ok=warehouseTraining.opened&&warehouseTraining.mapVisible&&warehouseTraining.saveBlocked;
  if(!warehouseTraining.ok)findings.push(finding('training-warehouse-readonly-contract',warehouseModal,JSON.stringify(warehouseTraining)));
  window.closeWarehouseEditorV600?.();
  accessibilityResult = { ok: findings.length === 0 && dialogTests.every(item => item.ok), controls:doc.querySelectorAll('button,input,select,textarea,a[href]').length, fields:doc.querySelectorAll('input:not([type="hidden"]),select,textarea').length, images:doc.querySelectorAll('img').length, dialogs:dialogTests, integrationTraining, telegramTraining, warehouseTraining, findings };
  if (!accessibilityResult.ok) errors.push({ phase:'accessibility', level:'error', text:JSON.stringify(accessibilityResult) });
}

const buttonResults = [];
const buttons = [...window.document.querySelectorAll('button')];
const unsafeButtonPattern = /удалить|сформировать|пересчит|рассчитать|построить|сбросить|очистить|закрыть рейс|запустить|восстановить|вернуть стандартные|убрать назначение|провести операцию|применить к заказам|повторить доставку|\b(?:delete|remove|clear|reset|restore|recalculate|calculate|build|commit|cancel|archive|start|mark|resolve|apply|import|configure|bind|sync|retry)[A-Z0-9_$]*\s*\(/i;
const seenButtonHooks = new Set();
const normalizedButtonHook = button => {
  const inline = String(button.getAttribute('data-jf-onclick') || button.getAttribute('onclick') || '').trim();
  if (inline) return inline
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, '$1<value>$1')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<number>')
    .replace(/\s+/g, ' ');
  return button.id || button.textContent.replace(/\s+/g, ' ').trim();
};
const unsafeButton = button => unsafeButtonPattern.test(`${button.textContent.replace(/\s+/g, ' ').trim()} ${normalizedButtonHook(button)} ${button.id || ''}`);
const allClickCandidates = buttons.filter(button => {
  if (!clickButtons && !listButtons) return false;
  if (!clickDynamicButtons && !listButtons && !originalButtons.has(button)) return false;
  const label = button.textContent.replace(/\s+/g, ' ').trim();
  const hasStableHook = Boolean(button.id || button.getAttribute('data-jf-onclick') || button.getAttribute('onclick'));
  const hook = normalizedButtonHook(button) || label;
  if (seenButtonHooks.has(hook)) return false;
  seenButtonHooks.add(hook);
  return hasStableHook && !unsafeButton(button);
});
const safeCandidateButtons = new Set(allClickCandidates);
const inventoryScope = element => {
  const scope = element.closest('[role="dialog"],dialog,.modal,[id$="View"],[id$="Modal"],main,nav,header,footer,section');
  return scope ? {
    tag: scope.tagName.toLowerCase(),
    id: scope.id || null,
    role: scope.getAttribute('role') || null
  } : null;
};
const inventoryContainerId = element => element.parentElement?.closest('[id]')?.id || null;
const buttonInventory = listButtons ? buttons.map((button, index) => {
  const label = button.textContent.replace(/\s+/g, ' ').trim();
  return {
    index,
    id: button.id || null,
    label,
    hook: normalizedButtonHook(button),
    type: button.getAttribute('type') || 'submit',
    dynamic: !originalButtons.has(button),
    safeCandidate: safeCandidateButtons.has(button),
    destructiveOrExpensive: unsafeButton(button),
    disabled: button.disabled,
    hidden: button.hidden,
    display: button.style.display || null,
    ariaLabel: button.getAttribute('aria-label') || null,
    title: button.getAttribute('title') || null,
    scope: inventoryScope(button),
    containerId: inventoryContainerId(button)
  };
}) : [];
const controls = listButtons ? [...window.document.querySelectorAll(interactiveSelector)] : [];
const labelsByControlId = listButtons ? new Map(
  [...window.document.querySelectorAll('label[for]')]
    .map(label => [label.getAttribute('for'), String(label.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)])
    .filter(([id]) => Boolean(id))
) : new Map();
const controlInventory = listButtons ? controls.map((control, index) => {
  const inlineHook = ['data-jf-onclick', 'onclick', 'onchange', 'oninput', 'onsubmit']
    .map(attribute => String(control.getAttribute(attribute) || '').trim())
    .find(Boolean) || null;
  const label = String(
    control.getAttribute('aria-label')
      || labelsByControlId.get(control.id)
      || control.getAttribute('placeholder')
      || control.getAttribute('title')
      || (['BUTTON', 'A'].includes(control.tagName) ? control.textContent : '')
      || control.getAttribute('name')
      || control.id
      || ''
  ).replace(/\s+/g, ' ').trim().slice(0, 240);
  return {
    index,
    tag: control.tagName.toLowerCase(),
    type: String(control.type || control.tagName || '').toLowerCase() || null,
    id: control.id || null,
    name: control.getAttribute('name') || null,
    label,
    hook: inlineHook || control.id || control.getAttribute('name') || null,
    href: control.tagName === 'A' ? control.getAttribute('href') : null,
    dynamic: !originalControls.has(control),
    disabled: Boolean(control.disabled),
    required: Boolean(control.required),
    hidden: Boolean(control.hidden),
    display: control.style.display || null,
    optionCount: control.tagName === 'SELECT' ? control.options.length : null,
    scope: inventoryScope(control),
    containerId: inventoryContainerId(control)
  };
}) : [];
const clickOffset = Math.max(0, Number(process.env.JF_CLICK_OFFSET) || 0);
const clickLimit = Math.max(1, Number(process.env.JF_CLICK_LIMIT) || allClickCandidates.length || 1);
const clickCandidates = listButtons ? [] : allClickCandidates.slice(clickOffset, clickOffset + clickLimit);
for (const button of clickCandidates) {
  const before = errors.length;
  const label = button.textContent.replace(/\s+/g, ' ').trim();
  const item = {
    id: button.id || null,
    label,
    disabled: button.disabled,
    hidden: button.hidden,
    display: button.style.display || null
  };
  if (!button.disabled && !button.hidden) {
    try {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await new Promise(resolve => setTimeout(resolve, 0));
      item.clicked = true;
    } catch (error) {
      item.clicked = false;
      item.error = error.stack || String(error);
    }
  } else {
    item.clicked = false;
    item.skipped = true;
  }
  item.newRuntimeErrors = errors.slice(before);
  buttonResults.push(item);
}

await new Promise(resolve => setTimeout(resolve, 300));

const normalizedErrors = [];
const seen = new Set();
for (const error of errors) {
  const key = `${error.phase}|${error.level}|${error.text}`;
  if (!seen.has(key)) {
    seen.add(key);
    normalizedErrors.push(error);
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  scriptResults,
  summary: {
    scripts: scriptResults.length,
    scriptsFailed: scriptResults.filter(item => !item.ok).length,
    buttons: buttons.length,
    controls: controls.length,
    buttonCandidates: allClickCandidates.length,
    buttonBatchOffset: clickOffset,
    buttonBatchLimit: clickLimit,
    buttonsClicked: buttonResults.filter(item => item.clicked).length,
    buttonClickFailures: buttonResults.filter(item => item.error || item.newRuntimeErrors.length).length,
    alerts: window.__alerts.length,
    confirms: window.__confirms.length,
    uniqueRuntimeErrors: normalizedErrors.length,
  cloudSyncUploads: window.__bridgeCalls.filter(item => item.startsWith('reg.entitySync:')).length,
    atomicMutation: window.__atomicMutationResult || null,
    activeWarehouse: window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.name || null,
    demoMode: window.TeplitsaWarehouseBootstrap?.isDemo?.() ?? null
  },
  errors: normalizedErrors,
  buttonFailures: buttonResults.filter(item => item.error || item.newRuntimeErrors.length),
  buttonCandidates: allClickCandidates.map((button, index) => ({
    index,
    id: button.id || null,
    label: button.textContent.replace(/\s+/g, ' ').trim(),
    hook: normalizedButtonHook(button),
    dynamic: !originalButtons.has(button),
    disabled: button.disabled,
    hidden: button.hidden
  })),
  buttonInventory,
  controlInventory,
  buttons: buttonResults,
  stress5000: stressResult,
  deepBusiness: deepBusinessResult,
  orderPrint: orderPrintResult,
  orderSaveIntegrity: orderSaveIntegrityResult,
  roleMatrix: roleMatrixResult,
  securityFuzz: securityFuzzResult,
  accessibility: accessibilityResult,
  localFirst: localFirstResult,
  bootstrapVersionConflict: bootstrapVersionConflictResult,
  bootstrapScopeIsolation: bootstrapScopeIsolationResult,
  backgroundScopeRace: backgroundScopeRaceResult,
  outboxAbaRace: outboxAbaRaceResult,
  criticalScopeGuard: criticalScopeGuardResult,
  criticalCrashRecovery: criticalCrashRecoveryResult,
  criticalStorageFailover: criticalStorageFailoverResult,
  ordinaryCrashRecovery: ordinaryCrashRecoveryResult,
  syncBusyGuard: syncBusyGuardResult,
  entityAckValidation: entityAckValidationResult,
  localMutationDurability: localMutationDurabilityResult,
  localWarehouse: localWarehouseResult,
  localToServerMigration: localToServerMigrationResult,
  bridgeCalls: window.__bridgeCalls
};

fs.writeFileSync(1, JSON.stringify(result, null, 2));
const failed = normalizedErrors.length > 0
  || buttonResults.some(item => item.error || item.newRuntimeErrors.length)
  || Number(deepBusinessResult?.summary?.failed || 0) > 0
  || Number(roleMatrixResult?.failures?.length || 0) > 0
  || accessibilityResult?.ok === false;
process.exit(failed ? 1 : 0);
