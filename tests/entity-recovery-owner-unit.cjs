'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const multiWarehouse=fs.readFileSync(path.join(root,'source/application/web/assets/js/100-multi-warehouse-v600.js'),'utf8');
const localOutbox=require(path.join(root,'source/application/web/assets/js/05-local-outbox-v783.js'));
const ownershipStart=renderer.indexOf('function stableEntityValue');
const ownershipEnd=renderer.indexOf('async function bootstrapEntitySync',ownershipStart);
assert(ownershipStart>=0&&ownershipEnd>ownershipStart,'entity recovery ownership source is available');

function sourceBetween(source,startText,endText){
  const start=source.indexOf(startText),end=source.indexOf(endText,start+startText.length);
  assert(start>=0&&end>start,`${startText} source is available`);
  return source.slice(start,end)
}
function assertBefore(source,first,second,message){
  const left=source.indexOf(first),right=source.indexOf(second);
  assert(left>=0&&right>=0&&left<right,message)
}

(async()=>{
const bootstrapSource=sourceBetween(renderer,'async function bootstrapEntitySync','function scheduleCloudUpload');
const values=new Map();
let storageWrites=0,storageRemoves=0,networkCalls=0,imports=0,indexedDbOpens=0;
const context={
  console,
  structuredClone,
  window:{JustFunLocalOutboxV783:localOutbox,JustFunDesktop:{regVps:{bootstrapEntities:async()=>{networkCalls++;return{ok:true,entities:[],readableTypes:[]}},writeWarehouse:async()=>{networkCalls++;return{ok:true}}}}},
  localStorage:{
    getItem:key=>values.get(String(key))??null,
    setItem:(key,value)=>{storageWrites++;values.set(String(key),String(value))},
    removeItem:key=>{storageRemoves++;values.delete(String(key))},
  },
  indexedDB:{open:()=>{indexedDbOpens++;throw new Error('IndexedDB must not open for a foreign recovery record')}},
  desktopSession:{edition:'full',auth:{offline:false,company:{id:'company-1',data_service:'https://vps.invalid'},user:{id:'user-a'}}},
  currentUser:{id:'user-a'},
  activeWarehouseId:()=> 'warehouse-1',
  activeEnvironment:()=> 'live',
  cloneValue:value=>structuredClone(value),
  asArray:value=>Array.isArray(value)?value:[],
  asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},
  hashString:value=>{let hash=0;for(const ch of String(value))hash=(hash*31+ch.charCodeAt(0))|0;return hash},
  ENTITY_SINGLETON_SECTIONS:['settings','reportingData','company'],
  ENTITY_ARRAY_SECTIONS:['orders','products','inventoryMovements','drivers','routeArchives'],
  ENTITY_MAP_SECTIONS:['routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','warehouseReservations','manualRouteSequences'],
  ENTITY_SETTINGS_WAREHOUSE_FIELDS:['warehouse'],
  ENTITY_SETTINGS_ROUTE_FIELDS:['routeStartTime'],
  ENTITY_SETTINGS_INTEGRATION_FIELDS:['nominatimUrl'],
  cloudSyncState:{installed:false,bootstrapped:false,bootstrapPromise:null,bootstrapFlights:new Map(),scopeEpoch:1,dirty:false,dirtyOwnerUserId:'',dirtyOwnerError:null,serial:0,suspended:0,uploadTimer:null,pollTimer:null,retryTimer:null,inFlightScopes:new Map(),criticalFlights:new Map(),ordinaryFlights:new Map(),ordinaryPrearms:new Map(),contextBlockedError:null,pollFailures:0,nextPollAt:0,scope:'company-1:live:warehouse-1',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set(),readerUserId:'',outboxes:new Map(),outbox:null,outboxError:null,localBaseline:null,observedFingerprint:''},
  q:()=>null,
  audit:()=>{},
  clearTimeout:()=>{},
  setTimeout:()=>0,
  stopLiveAccessRefresh:()=>{},
  stopTelegramPolling:()=>{},
  freezeWorkspaceForWarehouseTransition:()=>{},
  renderNoWarehouse:()=>{},
  rememberLocalEntityBaseline:()=>{},
  rememberObservedEntitySnapshot:()=>{},
  renderLocalOutboxStatus:()=>{},
  roleFor:()=> 'owner',
  hasPermission:()=>true,
  buildBackupPayload:()=>({warehouse:{id:'warehouse-1',environment:'live'},data:{warehouseId:'warehouse-1'}}),
};
context.isTrainingEnvironment=()=>false;
vm.createContext(context);
vm.runInContext(`const WAREHOUSE_REGISTRY_ENVIRONMENT='live';\n${renderer.slice(ownershipStart,ownershipEnd)}\n${bootstrapSource}\nglobalThis.__assertOwner=assertEntityRecoveryOwnership;globalThis.__persistDirty=persistEntityDirty;globalThis.__dirtyKey=entityDirtyStorageKey;globalThis.__ownerKey=entityDirtyOwnerStorageKey;globalThis.__stateKey=entityStateStorageKey;globalThis.__requireOutbox=requireLocalOutbox;globalThis.__restore=restoreLocalOutboxOverlay;globalThis.__bootstrap=bootstrapEntitySync;globalThis.__recoverWarehouse=recoverPendingWarehouseWritesUnlockedV784;`,context);

const scope='company-1:live:warehouse-1';
const dirtyKey=context.__dirtyKey(scope),ownerKey=context.__ownerKey(scope),stateKey=context.__stateKey(scope);
function setUser(id,{staleLocalId=id}={}){context.desktopSession.auth.user={id};context.currentUser={id:staleLocalId}}
function resetStorage(){values.clear();storageWrites=0;storageRemoves=0;context.cloudSyncState.scope=scope;context.cloudSyncState.outboxes=new Map();context.cloudSyncState.outbox=null;context.cloudSyncState.outboxError=null;context.cloudSyncState.contextBlockedError=null;context.cloudSyncState.dirtyOwnerError=null;context.cloudSyncState.readerUserId=''}
function setLegacyDirty(readerUserId){values.set(dirtyKey,'7');if(readerUserId!==undefined)values.set(stateKey,JSON.stringify({readerUserId}))}

resetStorage();setUser('',{staleLocalId:''});
const emptyPreAuthBefore=new Map(values),emptyPreAuth=context.__assertOwner({scope,queue:null,block:false});
assert.equal(emptyPreAuth.ownerUserId,'','a pre-auth scope without protected data has no recovery owner');
assert.equal(emptyPreAuth.currentUserId,'');assert.equal(emptyPreAuth.scope,scope);
assert.equal(context.cloudSyncState.contextBlockedError,null,'an empty pre-auth inspection must not create a sticky recovery block');
assert.deepEqual([...values],[...emptyPreAuthBefore],'an empty pre-auth inspection does not write or clear recovery storage');
context.cloudSyncState.scope='';const emptyPreAuthOutbox=context.__requireOutbox();
assert.equal(emptyPreAuthOutbox.status().active,0,'an empty outbox can initialize before the authenticated renderer context is ready');
assert.equal(context.cloudSyncState.contextBlockedError,null);

resetStorage();setUser('',{staleLocalId:''});values.set(dirtyKey,'7');const unknownDirtyBefore=new Map(values);
assert.throws(()=>context.__assertOwner({scope,queue:null,block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_UNKNOWN');
assert.deepEqual([...values],[...unknownDirtyBefore],'unknown-user dirty data remains byte-for-byte unchanged');

resetStorage();setUser('',{staleLocalId:''});const unknownProtectedQueue={overlayEntries:()=>[{commandId:'client:user-a:pre-auth',authorUserId:'user-a',preserveLocal:true,state:'pending'}]};
assert.throws(()=>context.__assertOwner({scope,queue:unknownProtectedQueue,block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_UNKNOWN');
assert.equal(storageWrites,0);assert.equal(storageRemoves,0,'unknown-user outbox recovery remains fail-closed and read-only');

resetStorage();setUser('',{staleLocalId:''});
assert.throws(()=>context.__assertOwner({scope,queue:null,journalOwnerUserId:'user-a',block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_UNKNOWN');

resetStorage();setUser('malformed user id',{staleLocalId:''});
assert.throws(()=>context.__assertOwner({scope,queue:null,block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_UNKNOWN','a malformed non-empty identity is never treated as the harmless pre-auth state');

resetStorage();setUser('',{staleLocalId:''});const multipleOwnersQueue={overlayEntries:()=>[
  {commandId:'client:user-a:pre-auth',authorUserId:'user-a',preserveLocal:true,state:'pending'},
  {commandId:'client:user-b:pre-auth',authorUserId:'user-b',preserveLocal:true,state:'pending'},
]};
assert.throws(()=>context.__assertOwner({scope,queue:multipleOwnersQueue,block:false}),error=>error?.code==='ENTITY_OUTBOX_MULTIPLE_OWNERS','multiple protected owners retain their precise fail-closed error before authentication');

resetStorage();setUser('',{staleLocalId:''});const confirmedHistory={overlayEntries:()=>[],pendingServerResolutions:()=>[]};
assert.equal(context.__assertOwner({scope,queue:confirmedHistory,block:false}).ownerUserId,'','confirmed-only history is not protected local recovery data');
assert.equal(context.cloudSyncState.contextBlockedError,null);

resetStorage();setUser('user-a');setLegacyDirty('user-a');
assert.equal(context.__assertOwner({scope,queue:null,block:false}).ownerUserId,'user-a');
assert.equal(JSON.parse(values.get(ownerKey)).ownerUserId,'user-a','a legacy marker is upgraded only for its saved reader');

resetStorage();setUser('user-b');setLegacyDirty('user-a');
const foreignBefore=new Map(values);
assert.throws(()=>context.__assertOwner({scope,queue:null,block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_MISMATCH'&&error?.details?.foreignRecovery===true);
assert.deepEqual([...values],[...foreignBefore],'a foreign legacy marker must not be adopted, cleared or rewritten');

resetStorage();setUser('user-b');setLegacyDirty(undefined);
assert.throws(()=>context.__assertOwner({scope,queue:null,block:false}),error=>error?.code==='ENTITY_LOCAL_RECOVERY_OWNER_UNKNOWN');
assert.equal(values.has(ownerKey),false,'an unknown legacy owner remains unmodified');

resetStorage();setUser('user-a');setLegacyDirty(undefined);
const ownLegacyQueue={overlayEntries:()=>[{commandId:'client:user-a:legacy-recovery',authorUserId:'user-a',preserveLocal:true,state:'pending'}]};
const legacyOwnBefore=new Map(values);
assert.equal(context.__assertOwner({scope,queue:ownLegacyQueue,block:false,adoptLegacyOwner:false}).ownerUserId,'user-a');
assert.deepEqual([...values],[...legacyOwnBefore],'the read-only preflight must not migrate a legacy owner');
assert.equal(context.__assertOwner({scope,queue:ownLegacyQueue,block:false}).ownerUserId,'user-a');
assert.equal(JSON.parse(values.get(ownerKey)).ownerUserId,'user-a','a single authenticated outbox author proves ownership of a legacy dirty marker');

resetStorage();setUser('user-b');
const foreignQueue={overlayEntries:()=>[{commandId:'client:user-a:foreign-recovery',authorUserId:'user-a',preserveLocal:true,state:'pending'}]};
assert.throws(()=>context.__assertOwner({scope,queue:foreignQueue,block:false}),error=>error?.code==='ENTITY_OUTBOX_OWNER_MISMATCH'&&error?.details?.foreignRecovery===true);
assert.equal(storageWrites,0);assert.equal(storageRemoves,0);

resetStorage();setUser('user-b');
const rawOutboxKey=localOutbox.storageKey(scope),rawOutbox=JSON.stringify({schemaVersion:1,dataContractVersion:3,scope,entries:[{commandId:'client:user-a:1234567890abcdef',scope,companyId:'company-1',warehouseId:'warehouse-1',environment:'live',intent:{kind:'test',targetId:'order-1'},changes:[{type:'orders',id:'order-1',baseVersion:0,deleted:false,payload:{id:'order-1'},_fingerprint:''}],state:'sending',createdAt:'2026-08-28T00:00:00.000Z',updatedAt:'2026-08-28T00:00:01.000Z',authorUserId:'user-a',deviceId:'device-a',dataContractVersion:3,attempts:1,nextAttemptAt:null,lastError:null,confirmedAt:null,preserveLocal:true}],createdAt:'2026-08-28T00:00:00.000Z',updatedAt:'2026-08-28T00:00:01.000Z'});
values.set(rawOutboxKey,rawOutbox);context.cloudSyncState.scope='';
assert.throws(()=>context.__requireOutbox(),error=>error?.code==='ENTITY_OUTBOX_OWNER_MISMATCH');
assert.equal(values.get(rawOutboxKey),rawOutbox,'a foreign sending entry remains byte-for-byte unchanged before outbox creation');
assert.equal(storageWrites,0);assert.equal(storageRemoves,0,'foreign outbox preflight is read-only');

resetStorage();setUser('user-b',{staleLocalId:'user-a'});setLegacyDirty('user-b');
assert.equal(context.__assertOwner({scope,queue:null,block:false}).currentUserId,'user-b','trusted desktop auth wins over a stale renderer user object');

resetStorage();setUser('user-b');
assert.equal(context.__persistDirty(true,scope),true);
assert.equal(JSON.parse(values.get(ownerKey)).ownerUserId,'user-b','a new dirty marker records its authenticated owner');
setUser('user-a');const ownedDirtyBefore=new Map(values);
assert.throws(()=>context.__persistDirty(false,scope),error=>error?.code==='ENTITY_LOCAL_RECOVERY_USER_MISMATCH');
assert.deepEqual([...values],[...ownedDirtyBefore],'a foreign user cannot clear another user\'s dirty marker');

resetStorage();setUser('user-b');context.cloudSyncState.outbox=foreignQueue;networkCalls=0;imports=0;
context.window.TeplitsaWarehouseV600={importServerSnapshot:async()=>{imports++},whenPersisted:async()=>{}};
await assert.rejects(context.__restore(),error=>error?.code==='ENTITY_OUTBOX_OWNER_MISMATCH');
assert.equal(imports,0,'foreign outbox data is blocked before local import');
await assert.rejects(context.__bootstrap(),error=>error?.code==='ENTITY_OUTBOX_OWNER_MISMATCH');
assert.equal(networkCalls,0,'foreign outbox data is blocked before the bootstrap GET');
assert.equal(storageWrites,0);assert.equal(storageRemoves,0,'blocked bootstrap and import do not mutate recovery storage');

resetStorage();setUser('user-b');networkCalls=0;indexedDbOpens=0;
values.set('jf.warehouse-lifecycle.v1.company-1.'+context.hashString('company-1'),JSON.stringify([{warehouseId:'warehouse-foreign',commandId:'client:foreign:1234567890',authorUserId:'user-a',fingerprint:'foreign',state:'ready',updatedAt:'2026-08-28T00:00:00.000Z'}]));
await assert.rejects(context.__recoverWarehouse(),error=>error?.code==='ENTITY_RECOVERY_JOURNAL_OWNER_MISMATCH');
assert.equal(indexedDbOpens,0,'foreign lifecycle ownership is checked before IndexedDB recovery');
assert.equal(networkCalls,0,'foreign lifecycle ownership is checked before VPS POST');
assert.equal(storageWrites,0);assert.equal(storageRemoves,0,'foreign lifecycle recovery does not clear its pointer');

const restoreSource=sourceBetween(renderer,'async function restoreLocalOutboxOverlay','async function bootstrapEntitySync');
assertBefore(restoreSource,'assertEntityRecoveryOwnership({queue})','importServerSnapshot','outbox ownership must be checked before import');
assertBefore(bootstrapSource,'assertEntityRecoveryOwnership({queue:requireLocalOutbox()})','bootstrapEntities({warehouseId,environment})','ownership must be checked before bootstrap GET');
const drainSource=sourceBetween(renderer,'async function drainLocalOutboxNow','function reportCloudSyncFailure');
assertBefore(drainSource,'assertEntityRecoveryOwnership({scope:expectedScope,queue})','syncEntities({','ownership must be checked before outbox POST');
const criticalSource=sourceBetween(renderer,'async function recoverCriticalEntityMutation','async function rollbackLocalSnapshot');
assertBefore(criticalSource,'assertEntityRecoveryOwnership({queue,journalOwnerUserId','rollbackLocalSnapshot','critical journal ownership must be checked before import');
assertBefore(criticalSource,'assertEntityRecoveryOwnership({queue,journalOwnerUserId','queue.enqueue','critical journal ownership must be checked before enqueue');
assertBefore(criticalSource,'assertEntityRecoveryOwnership({queue,journalOwnerUserId','syncEntities({','critical journal ownership must be checked before POST');
assertBefore(criticalSource,'assertEntityRecoveryOwnership({queue,journalOwnerUserId','clearCriticalEntityRecovery','critical journal ownership must be checked before clear');
const lifecycleRecoverySource=sourceBetween(renderer,'async function recoverPendingWarehouseWritesUnlockedV784','function serializeWarehouseLifecycleV784');
assertBefore(lifecycleRecoverySource,'assertEntityRecoveryOwnership({scope,queue:null,journalOwnerUserId:String(pointer.authorUserId','warehouseLifecycleDbOperationV784','lifecycle pointer ownership must be checked before journal recovery');
assertBefore(lifecycleRecoverySource,'assertEntityRecoveryOwnership({scope,queue:null,journalOwnerUserId:String(pointer.authorUserId','warehouseLifecycleRemovePointerV784','lifecycle pointer ownership must be checked before pointer clear');

assert(multiWarehouse.includes('suppliedSchema>3')&&multiWarehouse.includes('suppliedSchema===3&&!authorUserId'),'critical recovery schema 3 requires an author while schemas 1-2 remain readable');
assert(renderer.includes('prepare({...context,commandId,authorUserId,intent:'),'new critical recovery records persist their authenticated author');
assert(renderer.includes('schemaVersion:WAREHOUSE_LIFECYCLE_SCHEMA_V784')&&renderer.includes('commandId:newEntityCommandId(),authorUserId,changes'),'new lifecycle journals persist their authenticated author');

const logoutSource=sourceBetween(renderer,'const RECOVERY_OWNERSHIP_LOGOUT_CODES','function normalizedServerWarehouse');
function makeLogoutContext({blockCode='',blockOwnerUserId='',blockSource='dirty',currentUserId='user-b',flushFails=false}={}){
  let flushes=0,authLogouts=0,restarts=0,sessionClears=0,localTouches=0;
  const logoutContext={
    console,
    cloudSyncState:{dirty:true,scope,contextBlockedError:blockCode?Object.assign(new Error('recovery blocked'),{code:blockCode,details:{foreignRecovery:Boolean(blockOwnerUserId&&blockOwnerUserId!==currentUserId),currentUserId,ownerUserId:blockOwnerUserId,source:blockSource}}):null},
    desktopSession:{edition:'full',auth:{company:{data_service:'https://vps.invalid'},user:{id:currentUserId}}},
    currentUser:{id:currentUserId},users:[{id:currentUserId}],
    asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},
    currentEntityUserId:()=> currentUserId,validEntityRecoveryUserId:value=>/^[A-Za-z0-9_-]{1,160}$/.test(String(value||'')),
    assertEntityContextChangeAllowed:()=>{if(logoutContext.cloudSyncState.contextBlockedError)throw logoutContext.cloudSyncState.contextBlockedError},resetEntityScope:()=>{localTouches++},durableEntityDirty:()=>true,
    requireLocalOutbox:()=>{localTouches++;return{status:()=>({active:1})}},
    flushEntitySyncBeforeContextChange:async()=>{flushes++;if(flushFails)throw Object.assign(new Error('VPS unavailable'),{code:'NETWORK_ERROR'});logoutContext.cloudSyncState.dirty=false;logoutContext.durableEntityDirty=()=>false;logoutContext.requireLocalOutbox=()=>({status:()=>({active:0})})},
    outboxError:(code,message)=>Object.assign(new Error(message),{code}),toast:()=>{},audit:()=>{},stopLiveAccessRefresh:()=>{},stopTelegramPolling:()=>{},clearSession:()=>{sessionClears++},
    window:{JustFunDesktop:{auth:{logout:async()=>{authLogouts++}},restart:async()=>{restarts++}}},
  };
  vm.createContext(logoutContext);vm.runInContext(`${logoutSource}\nglobalThis.__logout=logout;`,logoutContext);
  return{context:logoutContext,counts:()=>({flushes,authLogouts,restarts,sessionClears}),localTouches:()=>localTouches}
}

{
  const test=makeLogoutContext();assert.equal(await test.context.__logout(),true);assert.deepEqual(test.counts(),{flushes:1,authLogouts:1,restarts:1,sessionClears:1},'the owner synchronizes before logout');
}
{
  const test=makeLogoutContext({flushFails:true});assert.equal(await test.context.__logout(),false);assert.deepEqual(test.counts(),{flushes:1,authLogouts:0,restarts:0,sessionClears:0},'failed owner synchronization keeps the authenticated session intact');assert.equal(test.context.currentUser.id,'user-b');
}
{
  const test=makeLogoutContext({blockCode:'ENTITY_OUTBOX_OWNER_MISMATCH',blockOwnerUserId:'user-a',blockSource:'outbox'});assert.equal(await test.context.__logout(),true);assert.deepEqual(test.counts(),{flushes:0,authLogouts:1,restarts:1,sessionClears:1},'a blocked foreign user can logout without touching protected local data');assert.equal(test.localTouches(),0);
}

for(const [blockCode,blockSource] of [['ENTITY_LOCAL_RECOVERY_OWNER_UNKNOWN','legacy-dirty'],['ENTITY_DIRTY_OWNER_CORRUPT','dirty-owner'],['ENTITY_OUTBOX_MULTIPLE_OWNERS','outbox']]){
  const test=makeLogoutContext({blockCode,blockSource});assert.equal(await test.context.__logout(),true,`${blockCode} permits a safe account change`);assert.deepEqual(test.counts(),{flushes:0,authLogouts:1,restarts:1,sessionClears:1});assert.equal(test.localTouches(),0,`${blockCode} logout must not touch recovery storage`)
}

{
  const test=makeLogoutContext({blockCode:'ENTITY_LOCAL_RECOVERY_USER_UNKNOWN',blockSource:'current-user',currentUserId:''});assert.equal(await test.context.__logout(),true,'an unconfirmed current identity can still leave the ownership-blocked session safely');assert.deepEqual(test.counts(),{flushes:0,authLogouts:1,restarts:1,sessionClears:1});assert.equal(test.localTouches(),0)
}

{
  const test=makeLogoutContext({blockCode:'CRITICAL_RECOVERY_SERVER_UNAVAILABLE',blockSource:'critical'});assert.equal(await test.context.__logout(),false,'a non-ownership context block remains enforced');assert.deepEqual(test.counts(),{flushes:0,authLogouts:0,restarts:0,sessionClears:0});assert.equal(test.localTouches(),0)
}

console.log(JSON.stringify({ok:true,dirtyOwnerBound:true,outboxOwnerBound:true,criticalOwnerBound:true,lifecycleOwnerBound:true,foreignFailClosed:true,ownerLogoutFlush:true,foreignLogoutSafe:true}));
})().catch(error=>{console.error(error);process.exitCode=1});
