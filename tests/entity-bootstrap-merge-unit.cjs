'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const appBundle=fs.readFileSync(path.join(root,'source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const multiWarehouse=fs.readFileSync(path.join(root,'source/application/web/assets/js/100-multi-warehouse-v600.js'),'utf8');
const routeEngine=fs.readFileSync(path.join(root,'source/application/web/assets/js/90-route-engine.js'),'utf8');
const warehousePayloadStart=renderer.indexOf('function serverWarehouseEntityPayloadV784');
const warehousePayloadEnd=renderer.indexOf('function activeWarehouseSettingsMatchV783',warehousePayloadStart);
const accessCaptureStart=renderer.indexOf('async function captureDirtyLocalChangesBeforeAccessRefresh');
const accessCaptureEnd=renderer.indexOf('function blockTerminalLiveAccess',accessCaptureStart);
const updatePermissionStart=renderer.indexOf('const ENTITY_UPDATE_PERMISSION=');
const updatePermissionEnd=renderer.indexOf('const cloudSyncState=',updatePermissionStart);
const start=renderer.indexOf('function stableEntityValue');
const end=renderer.indexOf('async function bootstrapEntitySync');
const entityChangesStart=renderer.indexOf('function nextLocalBaseVersion');
const entityChangesEnd=renderer.indexOf('function ordinaryEntityRecoverySnapshot',entityChangesStart);
const pendingChangesStart=renderer.indexOf('function latestQueuedEntityChanges');
const pendingChangesEnd=renderer.indexOf('function validateEntityBatchAck',pendingChangesStart);
const localOutboxEntryStart=renderer.indexOf('function localOutboxEntry');
const localOutboxEntryEnd=renderer.indexOf('const SERVER_ENTITY_INTENTS_V783',localOutboxEntryStart);
const validateAckStart=renderer.indexOf('function validateEntityBatchAck');
const validateAckEnd=renderer.indexOf('function acceptEntityBatchResult',validateAckStart);
assert(warehousePayloadStart>=0&&warehousePayloadEnd>warehousePayloadStart,'warehouse payload source fragment is available');
assert(accessCaptureStart>=0&&accessCaptureEnd>accessCaptureStart,'access refresh local capture source fragment is available');
assert(updatePermissionStart>=0&&updatePermissionEnd>updatePermissionStart,'entity update permission source is available');
assert(start>=0&&end>start,'server-authoritative snapshot source fragment is available');
assert(entityChangesStart>=0&&entityChangesEnd>entityChangesStart,'entity comparison source fragment is available');
assert(pendingChangesStart>=0&&pendingChangesEnd>pendingChangesStart,'pending entity recovery source fragment is available');
assert(localOutboxEntryStart>=0&&localOutboxEntryEnd>localOutboxEntryStart,'local outbox entry source fragment is available');
assert(validateAckStart>=0&&validateAckEnd>validateAckStart,'exact entity acknowledgement validator source is available');
const validateAckSource=renderer.slice(validateAckStart,validateAckEnd);

function createMemoryIndexedDb(){
  const databases=new Map();
  return{open(name){
    const request={result:null,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
    queueMicrotask(()=>{
      let state=databases.get(String(name)),created=false;
      if(!state){state={stores:new Map()};databases.set(String(name),state);created=true}
      const db={
        objectStoreNames:{contains:storeName=>state.stores.has(String(storeName))},
        createObjectStore(storeName){const key=String(storeName);if(!state.stores.has(key))state.stores.set(key,new Map());return{}},
        close(){},
        transaction(storeName,mode,options){
          if(mode==='readwrite'&&options?.durability!=='strict')throw new Error('strict durability required');
          const records=state.stores.get(String(storeName));if(!records)throw new Error('object store is missing');
          const tx={oncomplete:null,onerror:null,onabort:null,error:null,objectStore:()=>store};
          const operation=action=>{const result={result:null,error:null,onsuccess:null,onerror:null};queueMicrotask(()=>{try{result.result=action();result.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.())}catch(error){result.error=error;tx.error=error;result.onerror?.();tx.onerror?.()}});return result};
          const store={
            put:value=>operation(()=>{records.set(String(value.id),structuredClone(value));return value.id}),
            get:key=>operation(()=>records.has(String(key))?structuredClone(records.get(String(key))):undefined),
            delete:key=>operation(()=>{records.delete(String(key))}),
          };
          return tx
        },
      };
      request.result=db;if(created)request.onupgradeneeded?.();queueMicrotask(()=>request.onsuccess?.())
    });
    return request
  }}
}

const context={
  console,
  structuredClone,
  window:{},
  localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  desktopSession:{auth:{company:{id:'company-1'},user:{id:'employee-1'}}},
  currentUser:{id:'employee-1'},
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
  cloudSyncState:{installed:false,bootstrapped:false,bootstrapPromise:null,bootstrapFlights:new Map(),scopeEpoch:0,dirty:false,serial:0,suspended:0,uploadTimer:null,pollTimer:null,retryTimer:null,inFlightScopes:new Map(),criticalFlights:new Map(),ordinaryFlights:new Map(),ordinaryPrearms:new Map(),contextBlockedError:null,pollFailures:0,nextPollAt:0,scope:'',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set(),readerUserId:'employee-1',outboxes:new Map(),outbox:null,outboxError:null,localBaseline:null},
  q:()=>null,
  resetEntityScope:()=>{},
  audit:()=>{},
  blockWorkspaceForEntityPermissionQuarantine:()=>{},
  clearTimeout:()=>{},
  roleFor:()=> 'owner',
  hasPermission:()=>true,
};
context.isTrainingEnvironment=()=>context.activeEnvironment()==='demo';
vm.createContext(context);
vm.runInContext(`const WAREHOUSE_REGISTRY_ENVIRONMENT='live';\n${renderer.slice(updatePermissionStart,updatePermissionEnd)}\n${renderer.slice(warehousePayloadStart,warehousePayloadEnd)}\n${renderer.slice(accessCaptureStart,accessCaptureEnd)}\n${renderer.slice(start,end)}\n${renderer.slice(entityChangesStart,entityChangesEnd)}\n${renderer.slice(pendingChangesStart,pendingChangesEnd)}\n${renderer.slice(localOutboxEntryStart,localOutboxEntryEnd)}\nglobalThis.__fromServer=snapshotFromServerEntities;globalThis.__fp=entityFingerprint;globalThis.__semanticFp=semanticEntityFingerprintV784;globalThis.__split=splitEntitySnapshot;globalThis.__seed=initialServerSeedChanges;globalThis.__captureDirtyBeforeAccessRefresh=captureDirtyLocalChangesBeforeAccessRefresh;globalThis.__capturePreBootstrapLocalIntent=capturePreBootstrapLocalIntent;globalThis.__recoveryKnownEntitiesFromServer=recoveryKnownEntitiesFromServer;globalThis.__buildPendingEntityChanges=buildPendingEntityChanges;globalThis.__reconcileWarehouseOutbox=reconcileServerEquivalentWarehouseOutboxV784;globalThis.__planRejectedOrderRecovery=planRejectedOrderNormalizationRecoveryV784;globalThis.__finalizeRejectedOrderRecovery=finalizeRejectedOrderNormalizationRecoveryV784;globalThis.__overlayLocalOutbox=overlayLocalOutbox;`,context);
assert.equal(typeof context.window.JustFunServerStorageV3?.writeWarehouse,'function','browser storage export remains available in the extracted fragment');
assert(Object.isFrozen(context.window.JustFunServerStorageV3),'browser storage export remains immutable');

const snapshot=order=>({
  warehouse:{id:'warehouse-1',environment:'live',createdAt:'2026-08-01T00:00:00Z'},
  data:{warehouseId:'warehouse-1',orders:order?[order]:[],products:[],inventoryMovements:[],drivers:[],routeArchives:[],settings:{},reportingData:{},company:{},routePlans:{},routeAssignments:{},routeCatalog:{},routeDriverAssignments:{},routeLocks:{},routeOverrides:{},routeExecutions:{},warehouseReservations:{},manualRouteSequences:{}},
});
const readable=[...context.ENTITY_SINGLETON_SECTIONS,...context.ENTITY_ARRAY_SECTIONS,...context.ENTITY_MAP_SECTIONS];
const order=(name,version=1)=>({type:'orders',id:'order-1',version,payload:{id:'order-1',warehouseId:'warehouse-1',createdAt:'2026-08-01T01:00:00Z',name}});
const base=order('base');

async function verifyOfflineOutboxStartupOverlay(){
  let imported=null,active=1,dirtyCleared=0;
  context.q=()=>null;
  context.audit=()=>{};
  context.currentUser={id:'employee-1'};
  context.localStorage.removeItem=key=>{if(String(key).includes('jf.reg-entity-dirty.v1.'))dirtyCleared++};
  context.buildBackupPayload=()=>snapshot(base.payload);
  context.window.TeplitsaWarehouseV600={
    importServerSnapshot:async value=>{imported=structuredClone(value)},
    whenPersisted:async()=>{},
  };
  const queue={
    isCorrupt:()=>false,
    status:()=>({active}),
    overlayEntries:()=>active?[{commandId:'client:offline',state:'pending',updatedAt:'2026-08-25T00:00:00Z',authorUserId:'employee-1',preserveLocal:true,changes:[{type:'orders',id:'order-1',deleted:false,payload:{...base.payload,name:'offline-pending'}}]}]:[],
  };
  context.window.JustFunLocalOutboxV783={inspect:()=>queue,create:()=>queue};
  vm.runInContext('globalThis.__restoreLocalOutboxOverlay=restoreLocalOutboxOverlay',context);
  assert.equal(await context.__restoreLocalOutboxOverlay(),true,'an active durable outbox must be restored without a VPS');
  assert.equal(imported.data.orders[0].name,'offline-pending','the restarted UI must contain the pending local mutation');
  assert.equal(context.cloudSyncState.dirty,true,'the restored command remains pending for later server delivery');

  active=1;dirtyCleared=0;context.cloudSyncState.dirty=true;
  context.window.TeplitsaWarehouseV600.importServerSnapshot=async value=>{imported=structuredClone(value);active=0};
  assert.equal(await context.__restoreLocalOutboxOverlay(),true,'a command confirmed while its overlay is being restored must complete safely');
  assert.equal(context.cloudSyncState.dirty,false,'a concurrently confirmed command must not leave a false dirty blocker');
  assert.equal(dirtyCleared,1,'the durable dirty marker must be cleared after the last active command is confirmed');
}

{
  const local={...base.payload,name:'local'};
  const result=context.__fromServer(snapshot(local),[base],readable);
  assert.equal(result.data.orders[0].name,'base');
}

{
  const remote=order('remote',2);
  const result=context.__fromServer(snapshot(base.payload),[remote],readable);
  assert.equal(result.data.orders[0].name,'remote');
}
{
  const result=context.__fromServer(snapshot({...base.payload,name:'local'}),[],readable);
  assert.equal(result.data.orders.length,0);
}

function verifyUnreadableSingletonDefaultsAreNotLocalIntent(){
  const baseline=snapshot(base.payload),current=structuredClone(baseline),enqueued=[];
  current.data.settings={warehouse:{address:'Локальное значение по умолчанию'}};
  current.data.reportingData={method:'cash'};
  current.data.company={name:'Локальное значение по умолчанию'};
  context.cloudSyncState.readableTypes=new Set(['warehouse','orders','products','inventoryMovements','warehouseReservations']);
  const queue={overlayEntries:()=>[],blockedEntityKeys:()=>new Set(),list:()=>[],enqueue:value=>{enqueued.push(value);return value}};
  const previousRoleFor=context.roleFor,previousHasPermission=context.hasPermission;
  context.roleFor=()=> 'warehouse';context.hasPermission=permission=>['orders.read','orders.update','inventory.stock'].includes(permission);
  const captured=context.__capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities:new Map(),context:{companyId:'company-1',warehouseId:'warehouse-1',environment:'live'}});
  context.roleFor=previousRoleFor;context.hasPermission=previousHasPermission;
  assert.equal(captured,0,'defaults in previously unreadable singleton sections are server-owned, not employee local intent');
  assert.equal(enqueued.length,0,'unreadable defaults must never be uploaded or quarantined');
}

function verifyWritableFirstBootstrapChangeIsPreserved(){
  const digest='c'.repeat(64),baseline={warehouse:{id:'warehouse-1',name:'Склад 1',code:'СКЛ',address:'Адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',revision:1,digest},data:{}},current=structuredClone(baseline),enqueued=[];
  current.data.orders=[{id:'order-local',warehouseId:'warehouse-1',name:'Локальный заказ'}];
  const queue={overlayEntries:()=>[],blockedEntityKeys:()=>new Set(),list:()=>[],enqueue:value=>{enqueued.push(value);return value}};
  const previousRoleFor=context.roleFor,previousHasPermission=context.hasPermission;
  const previousReaderUserId=context.cloudSyncState.readerUserId;
  context.cloudSyncState.readableTypes=new Set();context.cloudSyncState.readerUserId='';context.roleFor=()=> 'warehouse';context.hasPermission=permission=>permission==='orders.update';
  const captured=context.__capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities:new Map(),context:{companyId:'company-1',warehouseId:'warehouse-1',environment:'live'}});
  context.roleFor=previousRoleFor;context.hasPermission=previousHasPermission;context.cloudSyncState.readerUserId=previousReaderUserId;
  assert.equal(captured,1,'a writable local change must survive first bootstrap even before readableTypes are cached');
  assert.equal(enqueued[0]?.changes?.[0]?.type,'orders','the preserved first-bootstrap command must contain the writable entity');
}

function verifyGenericDirtyRecoveryCannotInventServerDelete(){
  const known=new Map([['orders:order-1',{version:7,digest:'a'.repeat(64),fingerprint:'server-order',deleted:false,eventId:21}]]),scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},entries=[],queue={overlayEntries:()=>entries,list:()=>entries},suppressed=[];
  const protectedChanges=context.__buildPendingEntityChanges({snapshot:snapshot(null),knownEntities:known,conflicts:new Map(),queue,context:scope,allowInferredDeletes:false,suppressedDeletes:suppressed});
  assert.deepEqual(JSON.parse(JSON.stringify(protectedChanges.filter(change=>change.type==='orders'))),[],'a generic durable dirty marker must not infer deletion of a known server record missing from the local cache');
  assert.deepEqual(JSON.parse(JSON.stringify(suppressed)),[{type:'orders',id:'order-1',version:7}],'the suppressed ambiguous deletion remains observable for audit');
  const explicit=context.__buildPendingEntityChanges({snapshot:snapshot(null),knownEntities:known,conflicts:new Map(),queue,context:scope});
  const explicitOrder=explicit.find(change=>change.type==='orders'&&change.id==='order-1');assert.ok(explicitOrder,'callers with an explicit trusted mutation path retain the normal deletion diff');
  assert.equal(explicitOrder.deleted,true);
  entries.push({commandId:'client:explicit-delete',state:'pending',changes:[{type:'orders',id:'order-1',baseVersion:7,deleted:true,payload:null,_fingerprint:''}]});
  const withJournal=context.__buildPendingEntityChanges({snapshot:snapshot(null),knownEntities:known,conflicts:new Map(),queue,context:scope,allowInferredDeletes:false,suppressedDeletes:[]});
  assert.equal(withJournal.some(change=>change.type==='orders'&&change.id==='order-1'),false,'an exact durable outbox delete is preserved in the queue and never duplicated by generic recovery');
  assert.equal(entries[0].changes[0].deleted,true,'the explicit durable delete command is not removed or rewritten');
}

function verifyCleanEmployeeServerWarehouseNormalizationDoesNotQuarantine(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},baseline={warehouse:{id:'warehouse-1',name:'Склад',code:'СКЛ',address:'',lat:null,lon:null,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live'},data:{}},current={warehouse:{id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live',origin:'server',revision:4,digest:'a'.repeat(64)},data:{}},serverEntities=[{type:'warehouse',id:'warehouse-1',version:4,event_id:17,digest_sha256:'a'.repeat(64),deleted:false,payload:{id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live',createdAt:'2026-08-30T00:00:00Z'}}],enqueued=[];
  const queue={overlayEntries:()=>[],pendingServerResolutions:()=>[],blockedEntityKeys:()=>new Set(),list:()=>[],enqueue:value=>{enqueued.push(value);return value}};
  const previousRoleFor=context.roleFor,previousHasPermission=context.hasPermission,previousStorage=context.localStorage,previousDirty=context.cloudSyncState.dirty,previousSerial=context.cloudSyncState.serial,quarantineWrites=[];
  context.roleFor=()=> 'warehouse';context.hasPermission=permission=>['orders.read','inventory.read'].includes(permission);context.localStorage={getItem:()=>null,removeItem:()=>{},setItem:(key,value)=>quarantineWrites.push({key,value})};
  const captured=context.__capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities:new Map(),context:scope,serverEntities});
  assert.equal(captured,0,'clean employee server-normalized warehouse metadata must not become a local write');
  assert.equal(enqueued.length,0,'clean employee must keep an empty outbox after warehouse normalization');
  assert.equal(quarantineWrites.some(item=>String(item.key).includes('jf.entity-permission-quarantine')),false,'server-equivalent warehouse metadata must not quarantine a clean employee');
  context.roleFor=()=> 'owner';context.hasPermission=()=>true;current.warehouse.address='Реально изменённый локальный адрес';
  const ownerCaptured=context.__capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities:new Map(),context:scope,serverEntities});
  assert.equal(ownerCaptured,1,'a real owner warehouse edit that differs from VPS must remain pending');
  assert.equal(enqueued[0]?.changes?.[0]?.type,'warehouse');
  context.roleFor=previousRoleFor;context.hasPermission=previousHasPermission;context.localStorage=previousStorage;context.cloudSyncState.dirty=previousDirty;context.cloudSyncState.serial=previousSerial;
}

function verifyOfflineOrderRecoveryIgnoresRegularDriverProviderNormalization(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},warehouse={id:'warehouse-1',name:'Склад',code:'СК',address:'',lat:null,lon:null,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live'},serverDriver={id:'driver-1',warehouseId:'warehouse-1',workerType:'driver',name:'Водитель',phone:'+70000000000',providerCode:'yandex',providerName:'Яндекс',providerAccount:'account-a',providerContact:'contact-a',multiBookingAllowed:false,paymentProfile:{mode:'rules',enabled:true},vehicle:{model:'Газель'}},localDriver={...serverDriver,providerCode:'other',providerName:'Другой',providerAccount:'account-b',providerContact:'contact-b'},serverOrder={id:'order-1',warehouseId:'warehouse-1',contactName:'Серверная версия'},localOrder={...serverOrder,contactName:'W2-OFFLINE-1'},baseline={warehouse,data:{drivers:[serverDriver],orders:[serverOrder]}},current={warehouse,data:{drivers:[localDriver],orders:[localOrder]}},enqueued=[];
  const offlineEntry={commandId:'offline-order',state:'pending',preserveLocal:true,changes:[{type:'orders',id:'order-1',baseVersion:1,deleted:false,payload:localOrder,_fingerprint:context.__fp(localOrder)}]};
  const queue={overlayEntries:()=>[offlineEntry],pendingServerResolutions:()=>[],blockedEntityKeys:()=>new Set(),list:()=>[offlineEntry],enqueue:value=>{enqueued.push(value);return value}};
  const previousRoleFor=context.roleFor,previousHasPermission=context.hasPermission,previousStorage=context.localStorage,quarantineWrites=[];
  context.roleFor=()=> 'warehouse';context.hasPermission=permission=>['orders.read','orders.update','drivers.read'].includes(permission);context.localStorage={getItem:()=>null,removeItem:()=>{},setItem:(key,value)=>quarantineWrites.push({key,value})};
  assert.equal(context.__semanticFp('drivers','driver-1',serverDriver,scope),context.__semanticFp('drivers','driver-1',localDriver,scope),'provider defaults are semantically irrelevant for a staff driver');
  assert.equal(context.__split(baseline,scope).get('drivers:driver-1').fingerprint,context.__split(current,scope).get('drivers:driver-1').fingerprint,'local snapshot splitting must use the same driver semantic fingerprint as VPS metadata');
  const captured=context.__capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities:new Map(),context:scope,serverEntities:[]});
  assert.equal(captured,0,'an unrelated offline order must not turn regular-driver provider normalization into a local driver command');
  assert.equal(enqueued.length,0,'no phantom driver command may be added beside the durable offline order');
  assert.equal(queue.list().some(item=>item.commandId==='offline-order'&&item.state==='pending'),true,'the original offline order must remain durable while provider normalization noise is ignored');
  assert.equal(quarantineWrites.some(item=>String(item.key).includes('jf.entity-permission-quarantine')),false,'drivers.read without drivers.update must not be quarantined for provider normalization noise');
  const legacyDriver={...serverDriver};delete legacyDriver.workerType;
  assert.equal(context.__semanticFp('drivers','driver-1',legacyDriver,scope),context.__semanticFp('drivers','driver-1',serverDriver,scope),'legacy drivers without workerType must be treated as staff drivers');
  const aggregator={...serverDriver,workerType:'aggregator'};
  assert.notEqual(context.__semanticFp('drivers','driver-1',serverDriver,scope),context.__semanticFp('drivers','driver-1',aggregator,scope),'changing a staff driver into an aggregator remains a business change');
  for(const field of ['providerCode','providerName','providerAccount','providerContact'])assert.notEqual(context.__semanticFp('drivers','driver-1',aggregator,scope),context.__semanticFp('drivers','driver-1',{...aggregator,[field]:`${field}-changed`},scope),`${field} remains business data for an external delivery service`);
  for(const [field,value] of [['name','Другой водитель'],['phone','+71111111111'],['paymentProfile',{mode:'fixed',enabled:true}],['vehicle',{model:'Фургон'}]])assert.notEqual(context.__semanticFp('drivers','driver-1',serverDriver,scope),context.__semanticFp('drivers','driver-1',{...serverDriver,[field]:value},scope),`real staff-driver ${field} edits must remain detectable`);
  context.roleFor=previousRoleFor;context.hasPermission=previousHasPermission;context.localStorage=previousStorage;
}

function verifyConflictResolutionRecoveryIgnoresOnlyServerEquivalentWarehouseMetadata(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},serverWarehouse={type:'warehouse',id:'warehouse-1',version:8,event_id:31,digest_sha256:'b'.repeat(64),deleted:false,payload:{id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',environment:'live',createdAt:'2026-08-30T00:00:00Z'}},current=snapshot({...base.payload,name:'Локальная версия после конфликта'});
  current.warehouse={id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live',origin:'server',revision:8,digest:'b'.repeat(64)};
  const pendingOrder={type:'orders',id:'order-1',baseVersion:1,deleted:false,payload:{...base.payload,name:'Локальная конфликтная версия'},_fingerprint:context.__fp({...base.payload,name:'Локальная конфликтная версия'})},entry={commandId:'client:conflict-order',state:'conflict',preserveLocal:true,changes:[pendingOrder]},queue={overlayEntries:()=>[entry],list:()=>[entry]},known=new Map([
    ['warehouse:warehouse-1',{version:8,digest:'b'.repeat(64),fingerprint:context.__fp(serverWarehouse.payload),deleted:false,eventId:31}],
    ['orders:order-1',{version:2,digest:'c'.repeat(64),fingerprint:context.__fp(base.payload),deleted:false,eventId:32}],
  ]),quarantineWrites=[];
  const previousRoleFor=context.roleFor,previousHasPermission=context.hasPermission,previousStorage=context.localStorage;
  context.roleFor=()=> 'warehouse';context.hasPermission=permission=>['orders.read','orders.update'].includes(permission);context.localStorage={getItem:()=>null,removeItem:()=>{},setItem:(key,value)=>quarantineWrites.push({key,value})};
  assert.equal(context.__semanticFp('warehouse','warehouse-1',serverWarehouse.payload,scope),context.__semanticFp('warehouse','warehouse-1',current.warehouse,scope),'raw VPS createdAt fields and projected local warehouse metadata must share one semantic fingerprint');
  const employeeChanges=context.__buildPendingEntityChanges({snapshot:current,knownEntities:known,conflicts:new Map(),queue,context:scope,serverEntities:[serverWarehouse]});
  assert.equal(employeeChanges.map(change=>change.type).join(','),'orders','conflict recovery must retain the employee order change without inventing a warehouse write');
  assert.equal(quarantineWrites.some(item=>String(item.key).includes('jf.entity-permission-quarantine')),false,'server-equivalent warehouse metadata must not quarantine the employee while keeping the local conflict choice');
  current.warehouse.address='Расходящийся адрес без права склада';let denied=null;try{context.__buildPendingEntityChanges({snapshot:current,knownEntities:known,conflicts:new Map(),queue,context:scope,serverEntities:[serverWarehouse],reason:'conflict_resolution_local_capture'})}catch(error){denied=error}
  assert.equal(denied?.code,'ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED','an unauthorized divergent warehouse edit must still enter fail-closed quarantine');
  assert.equal(denied?.details?.reason,'conflict_resolution_local_capture','quarantine must preserve the exact capture path instead of reporting generic dirty recovery');
  const quarantineRecord=quarantineWrites.find(item=>String(item.key).includes('jf.entity-permission-quarantine'));assert.equal(JSON.parse(quarantineRecord?.value||'{}').reason,'conflict_resolution_local_capture','the durable quarantine record must retain the exact conflict capture reason');
  context.cloudSyncState.contextBlockedError=null;context.roleFor=()=> 'owner';context.hasPermission=()=>true;current.warehouse.address='Реально изменённый владельцем адрес';
  const ownerChanges=context.__buildPendingEntityChanges({snapshot:current,knownEntities:known,conflicts:new Map(),queue,context:scope,serverEntities:[serverWarehouse]});
  assert.equal(ownerChanges.some(change=>change.type==='warehouse'&&change.payload.address==='Реально изменённый владельцем адрес'),true,'a real owner warehouse edit must remain recoverable during the same conflict path');
  context.roleFor=previousRoleFor;context.hasPermission=previousHasPermission;context.localStorage=previousStorage;
}

function verifyRestartPreservesCompletePersistedOrder(){
  const initialLoad=appBundle.indexOf("let orders=asArray(loadOrders()).filter(value=>value&&typeof value==='object'&&!Array.isArray(value)).map(cloneValue);"),fullNormalizer=appBundle.indexOf('normalizeOrder__implV595=function(raw={}){'),normalizerEnd=appBundle.indexOf('function addOrderHistory',fullNormalizer),immediateNormalization=appBundle.indexOf('orders=orders.map(normalizeOrder).filter(Boolean);',fullNormalizer);
  assert.ok(initialLoad>=0&&initialLoad<fullNormalizer&&immediateNormalization>fullNormalizer&&immediateNormalization<normalizerEnd,'persisted orders must remain lossless clones until the complete workflow normalizer is installed and then normalize immediately');assert.equal(appBundle.indexOf('orders=orders.map(normalizeOrder).filter(Boolean);',immediateNormalization+1),-1,'startup orders must pass through the complete normalizer exactly once');let generatedIds=0;const runtime={
    structuredClone,normalizeOrder__implV595:null,normalizeOrder__baseV595:raw=>({id:raw.id,createdAt:raw.createdAt,updatedAt:raw.updatedAt,orderType:raw.orderType,warehouseId:raw.warehouseId,paymentStatus:raw.paymentStatus}),
    asArray:value=>Array.isArray(value)?value:[],asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},cloneValue:value=>structuredClone(value),uuid:()=>`generated-${++generatedIds}`,isPickup:order=>order?.orderType==='pickup',currentWarehouseIdV560:()=> 'warehouse-1',FULFILLMENT_STATUSES:new Set(['active','picking','delivered']),WAREHOUSE_FLOW_STATUSES:new Set(['planned','picking','shipped']),PAYMENT_STATUSES:new Set(['pending','paid','refund_required','refunded']),
  };vm.createContext(runtime);vm.runInContext(`${appBundle.slice(fullNormalizer,immediateNormalization)}\nglobalThis.__normalizeComplete=normalizeOrder__implV595;`,runtime);
  const persisted={id:'order-restart',number:'ORD-2026-0001',createdAt:'2026-08-30T00:00:00.000Z',updatedAt:'2026-08-30T00:05:00.000Z',orderType:'delivery',warehouseId:'warehouse-1',paymentStatus:'refunded',paidAt:'2026-08-30T00:04:00.000Z',refundedAt:'2026-08-30T00:05:00.000Z',fulfillmentStatus:'delivered',warehouseFlowStatus:'shipped',archived:true,archivedAt:'2026-08-30T00:06:00.000Z',closedAt:'2026-08-30T00:05:30.000Z',requiresAction:'',invoiceNumber:'СПБ-300826',documentSnapshot:{version:1,capturedAt:'2026-08-30T00:00:01.000Z',warehouse:{id:'warehouse-1',code:'СПБ'},company:{name:'Компания'}},statusHistory:[{id:'history-stable',at:'2026-08-30T00:03:00.000Z',type:'fulfillment',label:'Доставлен',note:'Передан клиенту',meta:{source:'live'}}],deliveryAttempts:[{id:'attempt-stable',routeId:'route-1',outcome:'delivered'}],fulfillmentResult:{outcome:'delivered',closedAt:'2026-08-30T00:05:30.000Z'},parentOrderId:'order-parent',childOrderIds:['order-child'],archiveReason:'Доставка завершена',isFulfillmentContinuation:true},startup=structuredClone(persisted),reloaded=runtime.__normalizeComplete(startup);
  assert.equal(reloaded.invoiceNumber,persisted.invoiceNumber,'restart must preserve the assigned invoice number');assert.deepEqual(structuredClone(reloaded.documentSnapshot),persisted.documentSnapshot,'restart must preserve the exact document snapshot and capturedAt');assert.deepEqual(structuredClone(reloaded.statusHistory),persisted.statusHistory,'restart must preserve status history IDs and workflow data');assert.equal(reloaded.paymentStatus,'refunded','restart must preserve refund workflow state');assert.equal(reloaded.paidAt,persisted.paidAt,'refund state must retain the original payment time');assert.equal(reloaded.refundedAt,persisted.refundedAt);assert.equal(reloaded.archivedAt,persisted.archivedAt);assert.equal(reloaded.closedAt,persisted.closedAt);assert.equal(reloaded.requiresAction,persisted.requiresAction);assert.deepEqual(structuredClone(reloaded.deliveryAttempts),persisted.deliveryAttempts);assert.deepEqual(structuredClone(reloaded.fulfillmentResult),persisted.fulfillmentResult);assert.equal(reloaded.parentOrderId,persisted.parentOrderId);assert.deepEqual(structuredClone(reloaded.childOrderIds),persisted.childOrderIds);assert.equal(generatedIds,0,'complete persisted records must not receive replacement UUIDs during restart normalization');
}

function verifyRejectedOrderNormalizationRecoveryIsStrict(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},serverPayload={...base.payload,id:'order-1',warehouseId:'warehouse-1',contactName:'Версия сервера',documentSnapshot:{version:1,capturedAt:'2026-08-30T00:00:00.000Z',warehouse:{id:'warehouse-1'},company:{name:'Компания'}},statusHistory:[{id:'server-history-id',at:'2026-08-30T00:00:00.000Z',type:'created',label:'Заказ создан',note:'Доставка клиенту',meta:{}}]},server={type:'orders',id:'order-1',version:4,event_id:47,digest_sha256:'e'.repeat(64),deleted:false,payload:serverPayload};
  const run=({mutateCandidate=()=>{},mutateLocal=()=>{},mutateEntry=()=>{},extraActive=false}={})=>{const candidate=structuredClone(serverPayload),local=structuredClone(serverPayload);candidate.documentSnapshot.capturedAt='2026-08-30T00:00:05.000Z';candidate.statusHistory[0].id='generated-candidate-id';local.documentSnapshot.capturedAt='2026-08-30T00:00:09.000Z';local.statusHistory[0].id='generated-local-id';mutateCandidate(candidate);mutateLocal(local);const entry={commandId:'client:normalization-rejected',scope:'company-1:live:warehouse-1',companyId:'company-1',warehouseId:'warehouse-1',environment:'live',intent:{kind:'conflict_resolution_local_capture',targetId:'warehouse-1'},state:'rejected',preserveLocal:true,lastError:{code:'entity_field_access_denied',details:{entity_type:'orders',fields:['documentSnapshot','statusHistory'],required_permissions:['orders.status']}},changes:[{type:'orders',id:'order-1',baseVersion:4,deleted:false,payload:candidate,_fingerprint:context.__fp(candidate)}]};mutateEntry(entry);const entries=[entry];if(extraActive)entries.push({...structuredClone(entry),commandId:'client:later-change',state:'pending',lastError:null});let confirmed=null;const queue={list:(states=null)=>{const allowed=states==null?null:new Set(Array.isArray(states)?states:[states]);return entries.filter(item=>!allowed||allowed.has(item.state))},get:commandId=>entries.find(item=>item.commandId===commandId)||null,overlayEntries:()=>entries.filter(item=>['pending','sending','conflict','rejected'].includes(item.state)&&item.preserveLocal!==false),blockedEntityKeys:()=>new Set(entries.filter(item=>(item.state==='conflict'||item.state==='rejected')&&item.preserveLocal!==false).flatMap(item=>item.changes.map(change=>`${change.type}:${change.id}`))),enqueue:value=>{entries.push({...structuredClone(value),state:'pending',preserveLocal:true});return value},markConfirmed:(commandId,result)=>{confirmed={commandId,result};const target=entries.find(item=>item.commandId===commandId);target.state='confirmed';target.preserveLocal=false}},conflicts=new Map([['orders:order-1',{state:'rejected'}]]),plan=context.__planRejectedOrderRecovery(queue,[structuredClone(server)],scope,snapshot(local));return{plan,confirmed:()=>confirmed,conflicts,entry,entries,queue,local}};
  const safe=run();assert.ok(safe.plan,'the exact live restart-normalization rejection must produce an atomic recovery plan even when the server omits entity_id');assert.equal(safe.confirmed(),null,'planning must not discard the rejected command before the VPS snapshot is durably imported');assert.equal(safe.entry.preserveLocal,true);assert.equal(context.__finalizeRejectedOrderRecovery(safe.queue,safe.plan,{conflicts:safe.conflicts}),1);assert.equal(safe.confirmed()?.result?.reconciled,'restart-order-normalization-noise');assert.equal(safe.entry.preserveLocal,false);assert.equal(safe.conflicts.has('orders:order-1'),false,'the rejected conflict clears only after explicit post-import finalization');assert.equal(context.__planRejectedOrderRecovery(safe.queue,[structuredClone(server)],scope,snapshot(safe.local)),null,'confirmed recovery is not planned twice');
  assert.equal(Boolean(run({mutateCandidate:value=>{value.contactName='Новая деловая правка'}}).plan),false,'a real queued business edit must never be discarded as normalization noise');assert.equal(Boolean(run({mutateLocal:value=>{value.contactMethod='+7 900 111-22-33'}}).plan),false,'an unqueued newer local edit must block server overwrite');assert.equal(Boolean(run({mutateEntry:value=>{value.changes[0].baseVersion=3}}).plan),false,'recovery requires the rejected command base to equal the current server version');assert.equal(Boolean(run({mutateEntry:value=>{value.lastError.details.fields.push('contactName')}}).plan),false,'recovery rejects any server denial involving a business field');assert.equal(Boolean(run({mutateEntry:value=>{value.lastError.details.entity_id='other-order'}}).plan),false,'a present mismatching entity_id must fail closed');assert.equal(Boolean(run({extraActive:true}).plan),false,'recovery requires the normalization command to be the only active local command when planned');

  const duringFetch=run(),serverBaseline=snapshot(serverPayload),unchangedCurrent=snapshot(duringFetch.local),suppressed=vm.runInContext('new Map()',context);suppressed.set(duringFetch.plan.key,duringFetch.plan.localFingerprint);const captureOptions={queue:duringFetch.queue,knownEntities:new Map(),context:scope,serverEntities:[server],suppressedEntityFingerprints:suppressed,ignoredCommandIds:[duringFetch.plan.commandId]};
  assert.equal(context.__capturePreBootstrapLocalIntent(serverBaseline,unchangedCurrent,captureOptions),0,'the one proven restart-only fingerprint is suppressed while its rejected command is recovered');assert.equal(duringFetch.entries.length,1,'restart noise is not duplicated into another command');
  const editedCurrent=structuredClone(unchangedCurrent);editedCurrent.data.orders[0].contactName='Изменено сотрудником во время загрузки';assert.equal(context.__capturePreBootstrapLocalIntent(serverBaseline,editedCurrent,captureOptions),1,'a later business edit with a different fingerprint is captured while recovery is in flight');assert.equal(duringFetch.entries.length,2);assert.equal(duringFetch.entries[1].changes[0].payload.contactName,'Изменено сотрудником во время загрузки');
  const overlaid=snapshot(serverPayload);context.__overlayLocalOutbox(overlaid,duringFetch.queue,{ignoredCommandIds:[duringFetch.plan.commandId],conflicts:new Map()});assert.equal(overlaid.data.orders[0].contactName,'Изменено сотрудником во время загрузки','the new edit overlays the authoritative server snapshot while only the rejected noise command is ignored');
  const suppressedKeys=vm.runInContext('new Set()',context);suppressedKeys.add(duringFetch.plan.key);const pendingWithoutSuppression=context.__buildPendingEntityChanges({snapshot:unchangedCurrent,knownEntities:new Map(),conflicts:new Map(),queue:{overlayEntries:()=>[],list:()=>[]},context:scope}),pendingWithSuppression=context.__buildPendingEntityChanges({snapshot:unchangedCurrent,knownEntities:new Map(),conflicts:new Map(),queue:{overlayEntries:()=>[],list:()=>[]},context:scope,suppressedEntityKeys:suppressedKeys});assert.equal(pendingWithoutSuppression.some(change=>change.type==='orders'),true);assert.equal(pendingWithSuppression.some(change=>change.type==='orders'),false,'fixed startup dirty recovery suppresses only the validated order key');

  const planCall=renderer.indexOf('const orderRecoveryPlan=planRejectedOrderNormalizationRecoveryV784'),commitCall=renderer.indexOf('await commitRemoteEntitySnapshotV784({snapshot:serverSnapshot',planCall),finalizeCall=renderer.indexOf('finalizeRejectedOrderNormalizationRecoveryV784(queue,orderRecoveryPlan',planCall);assert.ok(planCall>=0&&commitCall>planCall&&finalizeCall>commitCall,'the rejected command is finalized only after durable authoritative import');
}

async function verifyQuarantinedLegacyKnownSelfHealsThroughCurrentServerWarehouse(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},serverWarehouse={type:'warehouse',id:'warehouse-1',version:8,event_id:31,digest_sha256:'b'.repeat(64),payload:{id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',environment:'live',createdAt:'2026-08-30T00:00:00Z'}},current=snapshot({...base.payload,name:'Локальная версия после конфликта'});
  current.warehouse={id:'warehouse-1',name:'Склад 1',code:'С1',address:'Серверный адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live',origin:'server',revision:8,digest:'b'.repeat(64)};
  const pendingOrder={type:'orders',id:'order-1',baseVersion:1,deleted:false,payload:{...base.payload,name:'Локальная конфликтная версия'},_fingerprint:context.__fp({...base.payload,name:'Локальная конфликтная версия'})},entry={commandId:'client:conflict-order',state:'conflict',preserveLocal:true,changes:[pendingOrder]},queue={overlayEntries:()=>[entry],list:()=>[entry]},known=new Map([
    ['warehouse:warehouse-1',{version:8,digest:'b'.repeat(64),fingerprint:context.__fp(serverWarehouse.payload),deleted:false,eventId:31}],
    ['orders:order-1',{version:2,digest:'c'.repeat(64),fingerprint:context.__fp(base.payload),deleted:false,eventId:32}],
  ]),removed=[],captured=[],previous={roleFor:context.roleFor,hasPermission:context.hasPermission,localStorage:context.localStorage,buildBackupPayload:context.buildBackupPayload,liveAccessRefreshBusy:context.liveAccessRefreshBusy,enqueueBackgroundSnapshot:context.enqueueBackgroundSnapshot,desktop:context.window.JustFunDesktop,warehouse:context.window.TeplitsaWarehouseV600,dirty:context.cloudSyncState.dirty,scope:context.cloudSyncState.scope,known:context.cloudSyncState.known,conflicts:context.cloudSyncState.conflicts};
  context.roleFor=()=> 'warehouse';context.hasPermission=permission=>['orders.read','orders.update'].includes(permission);context.localStorage={getItem:key=>String(key).includes('jf.entity-permission-quarantine')?'{}':null,setItem:()=>{},removeItem:key=>removed.push(String(key))};context.buildBackupPayload=()=>structuredClone(current);context.liveAccessRefreshBusy=()=>false;context.cloudSyncState.dirty=true;context.cloudSyncState.scope='company-1:live:warehouse-1';context.cloudSyncState.known=known;context.cloudSyncState.conflicts=new Map();context.window.TeplitsaWarehouseV600={whenPersisted:async()=>true};let bootstraps=0;context.window.JustFunDesktop={regVps:{bootstrapEntities:async()=>{bootstraps++;return{ok:true,entities:[structuredClone(serverWarehouse)]}}}};
  context.enqueueBackgroundSnapshot=(targetQueue,targetSnapshot,options)=>{captured.push(options);return context.__buildPendingEntityChanges({snapshot:targetSnapshot,knownEntities:options.knownEntities,conflicts:options.conflicts,queue:targetQueue,context:options.context,serverEntities:options.serverEntities,reason:options.kind}).length};
  await context.__captureDirtyBeforeAccessRefresh(scope,queue);
  assert.equal(bootstraps,1,'retrying an existing permission quarantine must obtain the current VPS warehouse before local capture');
  assert.equal(captured[0]?.serverEntities?.length,1,'the current VPS entity must reach dirty recovery instead of trusting the legacy raw fingerprint');
  assert.equal(removed.some(key=>key.includes('jf.entity-permission-quarantine')),true,'an equivalent projected warehouse must clear the stale quarantine without deleting all local storage');
  assert.equal(context.cloudSyncState.known.get('warehouse:warehouse-1')?.fingerprint,context.__semanticFp('warehouse','warehouse-1',serverWarehouse.payload,scope),'the verified VPS warehouse must replace the persisted legacy raw fingerprint before the workspace reopens');
  const legacyFingerprint=context.__fp(serverWarehouse.payload);context.cloudSyncState.known=new Map([
    ['warehouse:warehouse-1',{version:8,digest:'b'.repeat(64),fingerprint:legacyFingerprint,deleted:false,eventId:31}],
    ['orders:order-1',{version:2,digest:'c'.repeat(64),fingerprint:context.__fp(base.payload),deleted:false,eventId:32}],
  ]);removed.length=0;captured.length=0;context.window.JustFunDesktop={regVps:{bootstrapEntities:async()=>({ok:true,entities:[{...structuredClone(serverWarehouse),digest_sha256:'invalid'}]})}};let invalidError=null;try{await context.__captureDirtyBeforeAccessRefresh(scope,queue)}catch(error){invalidError=error}
  assert.equal(invalidError?.code,'ENTITY_QUARANTINE_WAREHOUSE_STATE_INVALID','an invalid VPS warehouse proof must fail closed before local capture');
  assert.equal(captured.length,0,'invalid VPS warehouse metadata must not reach a capture that could clear quarantine');
  assert.equal(removed.length,0,'invalid VPS warehouse metadata must keep the quarantine marker');
  assert.equal(context.cloudSyncState.known.get('warehouse:warehouse-1')?.fingerprint,legacyFingerprint,'invalid VPS warehouse metadata must not replace persisted known state');
  context.roleFor=previous.roleFor;context.hasPermission=previous.hasPermission;context.localStorage=previous.localStorage;context.buildBackupPayload=previous.buildBackupPayload;context.liveAccessRefreshBusy=previous.liveAccessRefreshBusy;context.enqueueBackgroundSnapshot=previous.enqueueBackgroundSnapshot;context.window.JustFunDesktop=previous.desktop;context.window.TeplitsaWarehouseV600=previous.warehouse;context.cloudSyncState.dirty=previous.dirty;context.cloudSyncState.scope=previous.scope;context.cloudSyncState.known=previous.known;context.cloudSyncState.conflicts=previous.conflicts;
}

function verifyServerEquivalentWarehouseReconcilesFingerprintMigration(){
  const digest='a'.repeat(64),local={warehouse:{id:'warehouse-1',name:'Склад 1',code:'СКЛ',address:'Адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',origin:'server',revision:1,digest},data:{}},server={warehouse:{id:'warehouse-1',name:'Склад 1',code:'СКЛ',address:'Адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',origin:'legacy-server',createdAt:'2026-08-01T00:00:00Z',environment:'live'},data:{}},queue={overlayEntries:()=>[],list:()=>[]},knownAtStart=new Map([['warehouse:warehouse-1',{version:1,digest,fingerprint:'legacy-fingerprint',deleted:false}]]),serverKnown=new Map([['warehouse:warehouse-1',{version:1,digest,fingerprint:'server-raw-fingerprint',deleted:false}]]),scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'};
  context.cloudSyncState.readableTypes=new Set(['warehouse']);context.cloudSyncState.readerUserId='employee-1';
  const recovery=context.__recoveryKnownEntitiesFromServer(local,server,knownAtStart,serverKnown,scope),reconciled=context.__buildPendingEntityChanges({snapshot:local,knownEntities:recovery,conflicts:new Map(),queue,context:scope});
  assert.equal(reconciled.length,0,'a warehouse equal to the live server payload must survive a local fingerprint schema migration');
  local.warehouse.address='Локально изменённый адрес';
  const changedRecovery=context.__recoveryKnownEntitiesFromServer(local,server,knownAtStart,serverKnown,scope),changed=context.__buildPendingEntityChanges({snapshot:local,knownEntities:changedRecovery,conflicts:new Map(),queue,context:scope});
  assert.equal(changed.length,1,'a local warehouse payload change must remain visible even when embedded digest and revision are unchanged');
}

function verifySafeWarehouseOutboxPrefixReconciliation(){
  const scope={companyId:'company-1',warehouseId:'warehouse-1',environment:'live'},scopeKey='company-1:live:warehouse-1',payload={id:'warehouse-1',name:'Склад 1',code:'СКЛ',address:'Адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',environment:'live'},server={type:'warehouse',id:'warehouse-1',version:3,event_id:17,digest_sha256:'d'.repeat(64),deleted:false,payload};
  let sequence=0;
  const entry=(overrides={})=>{
    const base={commandId:`client:reconcile:${++sequence}`,scope:scopeKey,companyId:'company-1',warehouseId:'warehouse-1',environment:'live',state:'pending',preserveLocal:true,changes:[{type:'warehouse',id:'warehouse-1',baseVersion:2,deleted:false,payload:structuredClone(payload)}]};
    return{...base,...overrides,changes:overrides.changes===undefined?base.changes:overrides.changes}
  };
  const run=(entries,{serverEntities=[server],withConflict=true}={})=>{
    const data=structuredClone(entries),confirmed=[];context.cloudSyncState.conflicts=withConflict?new Map([['warehouse:warehouse-1',{state:'conflict'}]]):new Map();
    const queue={list:(states=null)=>{const allowed=states==null?null:new Set(Array.isArray(states)?states:[states]);return structuredClone(data.filter(item=>!allowed||allowed.has(item.state)))},markConfirmed:(commandId,result)=>{const item=data.find(candidate=>candidate.commandId===commandId);assert(item,'confirmed command exists');item.state='confirmed';item.preserveLocal=false;item.serverResult=structuredClone(result);confirmed.push(commandId);return structuredClone(item)}};
    const count=context.__reconcileWarehouseOutbox(queue,structuredClone(serverEntities),scope);
    return{count,confirmed,data,conflict:context.cloudSyncState.conflicts.has('warehouse:warehouse-1')}
  };

  let result=run([entry()]);assert.equal(result.count,1,'pending equivalent warehouse command is reconciled');assert.equal(result.conflict,false);
  result=run([entry({state:'conflict'})]);assert.equal(result.count,1,'conflict equivalent warehouse command is reconciled');assert.equal(result.conflict,false);
  result=run([entry({state:'rejected',preserveLocal:true})]);assert.equal(result.count,1,'preserved rejected equivalent warehouse command is reconciled');
  result=run([entry({state:'sending'})]);assert.equal(result.count,0,'sending command is never reconciled');
  result=run([entry({state:'confirmed',preserveLocal:false})]);assert.equal(result.count,0,'confirmed history is never reconciled again');
  result=run([entry({state:'rejected',preserveLocal:false})]);assert.equal(result.count,0,'non-preserved rejection is never reconciled');
  const orderBlocker=entry({changes:[{type:'orders',id:'order-1',baseVersion:0,deleted:false,payload:{id:'order-1'}}]});result=run([orderBlocker,entry()]);assert.equal(result.count,0,'an equivalent later command cannot jump over an earlier different active command');assert.equal(result.confirmed.length,0);
  result=run([entry({changes:[{type:'warehouse',id:'warehouse-1',baseVersion:2,deleted:false,payload:structuredClone(payload)},{type:'settings',id:'settings',baseVersion:1,deleted:false,payload:{}}]})]);assert.equal(result.count,0,'a multi-change command is not reconciled');
  result=run([entry({changes:[{type:'warehouse',id:'warehouse-1',baseVersion:2,deleted:true,payload:null}]})]);assert.equal(result.count,0,'a delete command is not reconciled');
  result=run([entry({scope:'company-other:live:warehouse-1',companyId:'company-other'})]);assert.equal(result.count,0,'a command from another company scope is not reconciled');
  result=run([entry({changes:[{type:'warehouse',id:'warehouse-1',baseVersion:4,deleted:false,payload:structuredClone(payload)}]})]);assert.equal(result.count,0,'a command newer than the server entity is not reconciled');
  result=run([entry({changes:[{type:'warehouse',id:'warehouse-1',baseVersion:2,deleted:false,payload:{...payload,address:'Другой адрес'}}]})]);assert.equal(result.count,0,'unequal normalized metadata is not reconciled');
  const first=entry(),second=entry();result=run([first,second]);assert.equal(result.count,2,'two contiguous equivalent commands are reconciled as one leading prefix');assert.deepEqual(result.confirmed,[first.commandId,second.commandId]);
  const equalConflict=entry({state:'conflict'}),unequalConflict=entry({state:'conflict',changes:[{type:'warehouse',id:'warehouse-1',baseVersion:2,deleted:false,payload:{...payload,address:'Не совпадает'}}]});result=run([equalConflict,unequalConflict]);assert.equal(result.count,1,'reconciliation stops at the first non-equivalent active command');assert.equal(result.conflict,true,'warehouse conflict remains while a blocking warehouse entry remains');
  result=run([entry()],{serverEntities:[{...server,digest_sha256:'invalid'}]});assert.equal(result.count,0,'an invalid server entity cannot confirm a local command');

  const bootstrapStart=renderer.indexOf('async function bootstrapEntitySync'),bootstrapEnd=renderer.indexOf('function scheduleCloudUpload',bootstrapStart),bootstrap=renderer.slice(bootstrapStart,bootstrapEnd),durableRecovery=bootstrap.indexOf('if(cloudSyncState.dirty&&!pendingResolutionsAtStart.length)'),capture=bootstrap.indexOf('capturePreBootstrapLocalIntent('),reconcile=bootstrap.indexOf('reconcileServerEquivalentWarehouseOutboxV784('),overlay=bootstrap.indexOf('const overlaid=overlayLocalOutbox');
  assert(durableRecovery>=0&&durableRecovery<capture&&capture<reconcile&&reconcile<overlay,'bootstrap reconciles only after durable recovery and local-intent capture, before overlay/import');
}

async function verifyWarehouseRegistryReconciliation(){
  const syncStart=renderer.indexOf('let pendingActiveWarehouseMetadataChangeV783=null;');
  const syncEnd=renderer.indexOf('function requiresAuthoritativeWarehouseRegistry');
  assert(syncStart>=0&&syncEnd>syncStart,'warehouse registry synchronization fragment is available');
  let activeEnvironmentValue='live';
  let registryState={
    activeWarehouseId:'warehouse-1',
    serverWorkspaceId:'company-1',
    warehouses:[
      {id:'warehouse-1',name:'Склад 1',code:'С1',address:'Старый адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',origin:'server',status:'active',catalogMode:'catalog',revision:4,digest:'digest-4'},
      {id:'warehouse-deleted',name:'Удалённый склад',code:'УДЛ',origin:'server',status:'archived'},
    ],
  };
  let saved=null,brandingCalls=0,settingsWrites=[],registryInitialized=true,registryConfigured=true;
  let settings={warehouse:{address:'Старый адрес',lat:59.1,lon:30.1},warehouseProfile:{id:'warehouse-1',code:'С1',name:'Склад 1',custom:'preserved'}};
  let remoteWarehouses=[{id:'warehouse-1',name:'Склад 1',code:'С1',address:'Старый адрес',lat:59.1,lon:30.1,timezone:'Europe/Moscow',status:'active',revision:0,entity_version:4,digest_sha256:'digest-4'}];
  const syncContext={
    console,
    structuredClone,
    window:{
      TeplitsaWarehouseBootstrap:{getRegistry:()=>structuredClone(registryState),saveRegistry:value=>{saved=structuredClone(value);registryState=structuredClone(value)}},
      TeplitsaWarehouseV600:{counts:()=>({orders:1,movements:0,routes:0,executions:0,archives:0}),applyBranding:()=>{brandingCalls++}},
      JustFunDesktop:{regVps:{warehouses:async()=>({ok:true,configured:registryConfigured,warehouses:structuredClone(remoteWarehouses),registryInitialized})}},
      __JF_TEST_NO_RELOAD:true,
    },
    desktopSession:{edition:'full',auth:{offline:false,company:{id:'company-1',data_service:'https://vps.invalid'},user:{id:'owner-1'}}},
    activeEnvironment:()=>activeEnvironmentValue,
    activeWarehouseId:()=>String(registryState.activeWarehouseId||''),
    allowedWarehouseIds:()=>registryState.warehouses.filter(item=>item.status!=='archived').map(item=>String(item.id)),
    registry:()=>structuredClone(registryState),
    settings,
    cloudSyncState:{dirty:true,serial:9,uploadTimer:null,pollTimer:null},
    cloneValue:value=>structuredClone(value),
    asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},
    safeSaveJson:(key,value)=>{settingsWrites.push({key,environment:activeEnvironmentValue,value:structuredClone(value)});return true},
    SETTINGS_KEY:'settings-key',
    clearTimeout:()=>{},
    clearInterval:()=>{},
    document:{documentElement:{classList:{remove:()=>{}}}},
    renderNoWarehouse:()=>{},
    recoverPendingWarehouseWritesV784:async()=>{},
    audit:()=>{},
    cloudUserToLocal:()=>({id:'owner-1',permissions:['*','warehouses.manage'],allWarehouses:true}),
    hasPermission:()=>true,
    currentUser:null,
    users:[],
  };
  syncContext.isTrainingEnvironment=()=>syncContext.desktopSession.edition==='demo'||activeEnvironmentValue==='demo';
  vm.createContext(syncContext);
  vm.runInContext(`${renderer.slice(syncStart,syncEnd)}\nglobalThis.__syncWarehouseRegistry=synchronizeCompanyWarehouseRegistry;globalThis.__applyTransition=applyWarehouseRegistryTransition;globalThis.__routingDepot=()=>[settings.warehouse.lat,settings.warehouse.lon];globalThis.__pendingMetadata=()=>pendingActiveWarehouseMetadataChangeV783;`,syncContext);
  assert.equal(await syncContext.__syncWarehouseRegistry(),false,'active warehouse remains unchanged');
  assert(saved,'reconciled registry is persisted');
  assert.deepEqual(saved.warehouses.map(item=>item.id),['warehouse-1'],'an initialized registry removes a server-deleted warehouse');
  assert.equal(saved.warehouses[0].origin,'server');
  assert.equal(saved.warehouses[0].revision,4,'entity_version is authoritative when the list response also contains a legacy revision');

  registryState.warehouses.push({id:'warehouse-migration',name:'Самостоятельный локальный склад',code:'МГР',origin:'local',status:'active'});
  await assert.rejects(syncContext.__syncWarehouseRegistry(),error=>error?.code==='LOCAL_MIGRATION_REMOTE_NOT_EMPTY','independent local data must not be silently hidden or merged into an already populated VPS');
  registryState.warehouses=registryState.warehouses.filter(item=>item.id!=='warehouse-migration');

  remoteWarehouses=[{id:'warehouse-1',name:'Новый склад',code:'НОВ',address:'Новый адрес LIVE',lat:60.01,lon:31.02,timezone:'Europe/Moscow',status:'active',entity_version:5,digest_sha256:'digest-5'}];
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'same-id active metadata change requires immediate reconciliation');
  assert.equal(syncContext.__applyTransition('warehouse-1','same-id-live-metadata'),false,'same-id metadata is applied in place without a workspace reload');
  assert.deepEqual(Array.from(syncContext.__routingDepot()),[60.01,31.02],'routing reads the new canonical depot coordinates immediately');
  assert.equal(syncContext.settings.warehouse.address,'Новый адрес LIVE');
  assert.deepEqual({...syncContext.settings.warehouseProfile},{id:'warehouse-1',code:'НОВ',name:'Новый склад',custom:'preserved',timezone:'Europe/Moscow',routeStartConfigured:true});
  assert.equal(settingsWrites.at(-1).environment,'live');
  assert.equal(syncContext.cloudSyncState.dirty,true,'canonical metadata refresh must preserve pending local business changes');
  assert.equal(syncContext.cloudSyncState.serial,9,'canonical metadata refresh must not consume the local mutation serial');
  assert.equal(syncContext.window.__jfWarehouseMetadataEpochV783,1,'active route calculations are invalidated after a depot metadata change');
  assert.equal(brandingCalls,1);
  assert.equal(syncContext.__pendingMetadata(),null);

  activeEnvironmentValue='demo';
  syncContext.settings.warehouse={address:'Старый адрес DEMO',lat:55.5,lon:37.5};
  remoteWarehouses=[{id:'warehouse-1',name:'Новый склад DEMO',code:'ДМО',address:'Новый адрес DEMO',lat:61.03,lon:32.04,timezone:'Europe/Moscow',status:'active',entity_version:6,digest_sha256:'digest-6'}];
  assert.equal(await syncContext.__syncWarehouseRegistry(),false,'an open training workspace must not read or mutate the live warehouse registry');
  assert.deepEqual(Array.from(syncContext.__routingDepot()),[55.5,37.5],'training routing keeps its isolated local depot coordinates');
  assert.equal(syncContext.settings.warehouse.address,'Старый адрес DEMO');
  assert.equal(syncContext.cloudSyncState.dirty,true);

  activeEnvironmentValue='live';
  syncContext.settings.warehouse={address:'Прерванное старое значение',lat:1,lon:2};
  syncContext.settings.warehouseProfile={id:'warehouse-1',code:'СТР',name:'Старое имя',timezone:'Europe/Moscow'};
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'a restart gap with an already-current registry still repairs stale active settings');
  assert.equal(syncContext.__applyTransition('warehouse-1','same-id-live-restart-recovery'),false,'restart metadata repair is applied in place without a workspace reload');
  assert.deepEqual(Array.from(syncContext.__routingDepot()),[61.03,32.04]);
  assert.equal(syncContext.settings.warehouseProfile.code,'ДМО');
  assert.equal(settingsWrites.at(-1).environment,'live');
  assert.equal(syncContext.window.__jfWarehouseMetadataEpochV783,2);

  remoteWarehouses=[
    {id:'warehouse-1',name:'Архив 1',code:'А01',status:'archived',entity_version:7,digest_sha256:'digest-7'},
    {id:'warehouse-2',name:'Архив 2',code:'А02',status:'archived',entity_version:3,digest_sha256:'digest-3'},
  ];
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'moving the last active warehouse to archive changes the active context');
  assert.equal(saved.activeWarehouseId,'','an authoritative all-archived registry must not activate the first archived warehouse');
  assert.deepEqual(saved.warehouses.map(item=>item.status),['archived','archived']);

  remoteWarehouses=[];
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'revoking the last server warehouse changes the active context');
  assert.deepEqual(saved.warehouses,[],'an authoritative empty server list removes cached warehouse access, including local migration records');
  assert.equal(saved.activeWarehouseId,'');
  assert.equal(saved.serverAuthoritativeEmpty,true);
  assert.equal(saved.serverRegistryInitialized,true,'a previously initialized empty registry is authoritative on every computer');

  registryState={activeWarehouseId:'local-default',warehouses:[{id:'local-default',name:'Склад',code:'СКЛ',origin:'local-default',status:'active'}]};
  syncContext.window.TeplitsaWarehouseV600.counts=()=>({orders:0,movements:0,routes:0,executions:0,archives:0});
  remoteWarehouses=[{id:'warehouse-w2',name:'Склад W2',code:'W2',address:'Адрес W2',lat:59.9,lon:30.3,timezone:'Europe/Moscow',status:'active',entity_version:1,digest_sha256:'w2-digest'}];
  registryInitialized=true;registryConfigured=true;syncContext.desktopSession.auth.user={id:'employee-w2',permissions:['orders.read','jf.warehouse:warehouse-w2']};
  syncContext.cloudUserToLocal=()=>({id:'employee-w2',permissions:['orders.read','jf.warehouse:warehouse-w2'],allWarehouses:false,warehouseIds:['warehouse-w2']});saved=null;
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'a restricted invited user replaces an empty generated local placeholder with the authoritative assigned warehouse');
  assert(saved,'the invited-user registry is persisted');
  assert.equal(saved.activeWarehouseId,'warehouse-w2');
  assert.deepEqual(saved.warehouses.map(item=>item.id),['warehouse-w2']);
  assert.equal(saved.warehouses[0].origin,'server');

  registryState={activeWarehouseId:'local-default',warehouses:[{id:'local-default',name:'Склад',code:'СКЛ',origin:'local-default',status:'active'}]};
  remoteWarehouses=[];
  registryInitialized=null;registryConfigured=true;
  await assert.rejects(syncContext.__syncWarehouseRegistry(),error=>error?.code==='WAREHOUSE_REGISTRY_CONTRACT_MISMATCH','an ambiguous empty response must never open a local warehouse on a fresh computer');
  registryInitialized=false;registryConfigured=false;
  await assert.rejects(syncContext.__syncWarehouseRegistry(),error=>error?.code==='WAREHOUSE_REGISTRY_UNAVAILABLE','an unconfigured VPS bridge must fail closed before local data is mounted');
}

async function verifyRouteCalculationRejectsStaleDepot(){
  const calculationStart=routeEngine.indexOf('calculateRoute=async function(def){');
  const calculationEnd=routeEngine.indexOf('function quickCandidateScore',calculationStart);
  assert(calculationStart>=0&&calculationEnd>calculationStart,'route calculation source fragment is available');
  let resolveMatrix=null;
  const routeContext={
    window:{__jfWarehouseMetadataEpochV783:0},
    settings:{warehouse:{lat:59.1,lon:30.1}},
    calculateRoute:null,
    orderPlanningIssues:()=>[],
    osrmTable:()=>new Promise(resolve=>{resolveMatrix=resolve}),
    fallbackMatrix:()=>({fallback:true,distance:[],duration:[]}),
  };
  vm.createContext(routeContext);
  vm.runInContext(`${routeEngine.slice(calculationStart,calculationEnd)}\nglobalThis.__calculateRoute=calculateRoute;`,routeContext);
  const pending=routeContext.__calculateRoute({id:'route-1',orders:[{id:'order-1',number:'1',geo:{lat:60,lon:31}}]});
  assert.equal(typeof resolveMatrix,'function');
  routeContext.window.__jfWarehouseMetadataEpochV783=1;
  resolveMatrix({fallback:true,distance:[],duration:[]});
  await assert.rejects(pending,error=>/координаты склада изменились/i.test(String(error?.message)),'a route request started with stale depot coordinates must be rejected');
}

function verifyWarehouseCreateAccessExport(){
  const accessStart=renderer.indexOf('function roleFor(user=currentUser)');
  const accessEnd=renderer.indexOf('function resolvedFunctionPermission',accessStart);
  assert(accessStart>=0&&accessEnd>accessStart,'warehouse access source fragment is available');
  const accessContext={
    window:{TeplitsaWarehouseBootstrap:{isDemo:()=>false}},
    currentUser:{role:'manager',serverRole:'manager',permissions:['warehouses.manage'],allWarehouses:false},
    desktopSession:{edition:'full'},
    LEGACY_PERMISSION_EXPANSIONS:{},
    LOCAL_ROLE_PERMISSIONS:{manager:[]},
  };
  accessContext.isTrainingEnvironment=()=>accessContext.desktopSession.edition==='demo'||accessContext.window.TeplitsaWarehouseBootstrap.isDemo()===true;
  vm.createContext(accessContext);
  vm.runInContext(renderer.slice(accessStart,accessEnd),accessContext);
  assert(Object.isFrozen(accessContext.window.JustFunWarehouseAccessV783));
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canCreate(),false,'a warehouse-scoped manager must not create a new warehouse');
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canDelete(),false,'a warehouse-scoped manager must not delete a company warehouse');
  accessContext.currentUser.allWarehouses=true;
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canCreate(),true,'warehouse management plus all-warehouse scope permits creation');
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canDelete(),true,'warehouse management plus all-warehouse scope permits deletion');
  accessContext.window.TeplitsaWarehouseBootstrap.isDemo=()=>true;
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canCreate(),false,'the training data environment must not expose live warehouse creation');
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canDelete(),false,'the training data environment must not expose live warehouse deletion');
  accessContext.window.TeplitsaWarehouseBootstrap.isDemo=()=>false;
  accessContext.currentUser.permissions=[];
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canCreate(),false,'all-warehouse scope alone is not a warehouse management permission');
  assert.equal(accessContext.window.JustFunWarehouseAccessV783.canDelete(),false,'all-warehouse scope alone is not a warehouse deletion permission');
}

function verifyAuthoritativeEmptyCreateAction(){
  const noWarehouseStart=renderer.indexOf('function canCreateWarehouseFromNoAccessV783');
  const noWarehouseEnd=renderer.indexOf('function renderWarehouseLoading',noWarehouseStart);
  assert(noWarehouseStart>=0&&noWarehouseEnd>noWarehouseStart,'no-warehouse screen source fragment is available');
  const controls=new Map(),frames=[];let createCalls=0,registryState={activeWarehouseId:'',warehouses:[],serverAuthoritativeEmpty:true};
  const uiContext={
    window:{openWarehouseCreatorV600:()=>{createCalls++;return true}},
    currentUser:{permissions:['warehouses.manage'],allWarehouses:true},
    activeWarehouseId:()=>'',
    hasPermission:name=>name==='warehouses.manage',
    hasEntityPermissionQuarantine:()=>false,
    registry:()=>structuredClone(registryState),
    authFrame:(html,subtitle)=>{frames.push({html,subtitle})},
    esc:value=>String(value),
    q:selector=>{if(!controls.has(selector))controls.set(selector,{});return controls.get(selector)},
    retryWorkspaceAccess:()=>{},
    logout:()=>{},
  };
  vm.createContext(uiContext);
  vm.runInContext(`${renderer.slice(noWarehouseStart,noWarehouseEnd)}\nglobalThis.__renderNoWarehouse=renderNoWarehouse;`,uiContext);
  uiContext.__renderNoWarehouse();
  assert.match(frames.at(-1).html,/id="jfCreateFirstWarehouse">Создать первый склад</,'an authorized global warehouse manager sees the first-warehouse action');
  controls.get('#jfCreateFirstWarehouse').onclick();
  assert.equal(createCalls,1,'the empty-state action opens the existing warehouse creator');
  registryState={activeWarehouseId:'',warehouses:[{id:'archived-1',status:'archived'}],serverAuthoritativeEmpty:false};
  uiContext.__renderNoWarehouse();
  assert.match(frames.at(-1).html,/Создать новый склад/,'an all-archived registry also has a safe path to a new active warehouse');
  uiContext.currentUser.allWarehouses=false;
  uiContext.__renderNoWarehouse();
  assert.doesNotMatch(frames.at(-1).html,/jfCreateFirstWarehouse/,'a warehouse-scoped manager cannot create a company-wide warehouse from the empty state');
  uiContext.hasEntityPermissionQuarantine=()=>true;
  uiContext.__renderNoWarehouse('Локальная очередь сохранена.');
  assert.match(frames.at(-1).html,/Локальные изменения защищены/,'a permission quarantine must not claim that the assigned warehouse is missing');
  assert.doesNotMatch(frames.at(-1).html,/>Склад не назначен</,'the quarantine title must describe protected data, not warehouse assignment');
}

function verifyWarehouseLifecycleUiSource(){
  assert(multiWarehouse.includes('refreshAuthoritativeWarehouseRegistryV760'),'warehouse lifecycle operations must refresh the authoritative registry after commit');
  assert(multiWarehouse.includes("window.JustFunWarehouseRegistryV783?.refresh"),'the lifecycle UI must use the shared server registry refresh');
  assert(multiWarehouse.includes("committed=result?.skipped!==true"),'warehouse lifecycle operations must distinguish server-confirmed and autonomous local storage');
  assert(multiWarehouse.includes('if(committed)canonical=(await refreshAuthoritativeWarehouseRegistryV760'),'a server-confirmed edit must refresh the authoritative registry before updating UI state');
  assert(multiWarehouse.includes('else{Object.assign(w,next);B.saveRegistry(r);canonical=next}'),'an autonomous local edit must update only the local registry');
  assert(!multiWarehouse.includes('r.warehouses=r.warehouses.filter(x=>String(x.id)!==String(w.id));B.saveRegistry(r)'),'a delete commit must not save a stale pre-request registry');
  assert(multiWarehouse.includes("$id('warehouseCodeV600').readOnly=true"),'an existing warehouse code is read-only');
  assert(multiWarehouse.includes('Код задаётся при создании один раз и затем не изменяется.'),'the create flow explains code immutability');
  assert.doesNotMatch(multiWarehouse,/без возможности восстановления/,'warehouse deletion must not promise absolute irrecoverability');
  assert.match(multiWarehouse,/Минимальный технический аудит и резервные копии/,'warehouse deletion explains the retention boundary');
}

async function verifyWarehouseStorageIsolation(){
  const calls=[];
  let savedEntityState=0;const storageValues=new Map();
  const storageContext={
    console,
    structuredClone,
    window:{JustFunDesktop:{
      regVps:{writeWarehouse:async payload=>{calls.push(structuredClone(payload));const change=payload.changes[0];return{ok:true,commandId:payload.commandId,cursor:calls.length,entities:[{type:'warehouse',id:payload.warehouseId,version:Number(change.baseVersion)+1,digest:'a'.repeat(64),eventId:calls.length,deleted:change.deleted===true}]}}},
    }},
    indexedDB:createMemoryIndexedDb(),
    localStorage:{getItem:key=>storageValues.get(String(key))??null,setItem:(key,value)=>{const name=String(key);storageValues.set(name,String(value));if(name.startsWith('jf.reg-entity-state.v2.'))savedEntityState++},removeItem:key=>storageValues.delete(String(key))},
    cloudSyncState:{installed:false,bootstrapped:false,bootstrapPromise:null,dirty:false,serial:0,suspended:0,uploadTimer:null,pollTimer:null,inFlight:false,pollFailures:0,nextPollAt:0,scope:'',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set()},
    desktopSession:{edition:'full',auth:{offline:false,company:{id:'company-1',data_service:'https://vps.invalid'},user:{id:'owner-1',role:'owner',permissions:['*']}}},
    currentUser:{id:'owner-1'},
    activeWarehouseId:()=> 'warehouse-active',
    activeEnvironment:()=> 'live',
    cloneValue:value=>structuredClone(value),
    asArray:value=>Array.isArray(value)?value:[],
    asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},
    hashString:value=>{let hash=0;for(const ch of String(value))hash=(hash*31+ch.charCodeAt(0))|0;return hash},
    hasPermission:permission=>permission==='*',
    roleFor:()=> 'owner',
    ENTITY_SINGLETON_SECTIONS:['settings','reportingData','company'],
    ENTITY_ARRAY_SECTIONS:['orders','products','inventoryMovements','drivers','routeArchives'],
    ENTITY_MAP_SECTIONS:['routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','warehouseReservations','manualRouteSequences'],
    ENTITY_SETTINGS_WAREHOUSE_FIELDS:['warehouse'],
    ENTITY_SETTINGS_ROUTE_FIELDS:['routeStartTime'],
    ENTITY_SETTINGS_INTEGRATION_FIELDS:['nominatimUrl'],
  };
  storageContext.isTrainingEnvironment=()=>storageContext.desktopSession.edition==='demo'||storageContext.activeEnvironment()==='demo';
  vm.createContext(storageContext);
  vm.runInContext(`const WAREHOUSE_REGISTRY_ENVIRONMENT='live';\n${renderer.slice(warehousePayloadStart,warehousePayloadEnd)}\n${renderer.slice(start,end)}\n${validateAckSource}\nglobalThis.__writeWarehouse=writeAuthoritativeWarehouse;globalThis.__cloudSyncState=cloudSyncState;globalThis.__entityScope=entityScope;globalThis.__split=splitEntitySnapshot;globalThis.__seed=initialServerSeedChanges;`,storageContext);
  storageContext.__cloudSyncState.scope=storageContext.__entityScope();

  const other={id:'warehouse-other',name:'Другой склад',code:'ДРГ',revision:0};
  const otherResult=await storageContext.__writeWarehouse(other);
  assert.equal(otherResult.version,1);
  assert.equal(calls[0].warehouseId,'warehouse-other');
  assert.equal(calls[0].warehouseCode,'ДРГ');
  assert.equal(calls[0].environment,'live','warehouse registry writes must never follow a demo data environment');
  assert.equal(calls[0].changes[0].payload.environment,'live');
  assert.equal(storageContext.__cloudSyncState.known.size,0,'writing a non-active warehouse must not overwrite the active warehouse sync state');
  assert.equal(savedEntityState,0,'a non-active warehouse write must not persist the active warehouse entity cache');

  const active={id:'warehouse-active',name:'Активный склад',code:'АКТ',revision:0};
  const activeResult=await storageContext.__writeWarehouse(active);
  assert.equal(activeResult.version,1);
  assert.equal(storageContext.__cloudSyncState.known.get('warehouse:warehouse-active').version,1,'an active warehouse write still advances its own known version');
  assert.equal(savedEntityState,1);

  storageContext.activeEnvironment=()=> 'demo';
  const demoSnapshot=snapshot({id:'order-demo',warehouseId:'warehouse-active',name:'demo'});
  const demoRecords=storageContext.__split(demoSnapshot);
  assert.equal(demoRecords.has('warehouse:warehouse-active'),false,'a demo snapshot must not contain the canonical live warehouse registry entity');
  assert.equal(storageContext.__seed(demoSnapshot).some(entity=>entity.type==='warehouse'),false,'demo bootstrap seeding must not create a live warehouse entity');
  storageContext.desktopSession.edition='demo';
  const callCountBeforeDemoWrite=calls.length;
  const skippedDemoWrite=await storageContext.__writeWarehouse({id:'warehouse-demo',code:'ДМО'});
  assert.equal(skippedDemoWrite.skipped,true);
  assert.equal(calls.length,callCountBeforeDemoWrite,'demo warehouse writes must not reach the live VPS registry');
}

async function verifyWarehouseRegistryTransitions(){
  const transitionStart=renderer.indexOf('function workspaceReloadKey');
  const transitionEnd=renderer.indexOf('function clearWorkspaceReloadGuard');
  const requiresStart=renderer.indexOf('function requiresAuthoritativeWarehouseRegistry');
  const requiresEnd=renderer.indexOf('async function restoreFreshComputerWorkspace');
  const periodicStart=renderer.indexOf('let nextWarehouseRegistryRefreshAtV783=0;');
  const periodicEnd=renderer.indexOf('async function pollCloudRevision');
  assert(transitionStart>=0&&transitionEnd>transitionStart,'warehouse transition source fragment is available');
  assert(requiresStart>=0&&requiresEnd>requiresStart,'authoritative registry gate source fragment is available');
  assert(periodicStart>=0&&periodicEnd>periodicStart,'periodic registry refresh source fragment is available');

  let currentWarehouseId='warehouse-old',allowed=['warehouse-old'];
  let registryState={
    activeWarehouseId:'warehouse-old',
    pendingServerDeleteWarehouseId:'warehouse-old',
    serverWorkspaceId:'company-1',
    warehouses:[{id:'warehouse-old',origin:'server',status:'active'}],
  };
  let renderState='',syncCalls=0,reloads=0;
  const classes=new Set(['jf-authenticated']);
  const sessionValues=new Map();
  const transitionContext={
    console,
    structuredClone,
    window:{TeplitsaWarehouseBootstrap:{getRegistry:()=>structuredClone(registryState),saveRegistry:value=>{registryState=structuredClone(value)}},__JF_TEST_NO_RELOAD:false},
    desktopSession:{edition:'full',auth:{offline:false,company:{id:'company-1',data_service:'https://vps.invalid'}}},
    registry:()=>structuredClone(registryState),
    activeWarehouseId:()=>currentWarehouseId,
    allowedWarehouseIds:()=>[...allowed],
    cloudSyncState:{uploadTimer:1,pollTimer:2,dirty:true},
    document:{documentElement:{classList:{remove:value=>classes.delete(value)}}},
    sessionStorage:{getItem:key=>sessionValues.get(key)||null,setItem:(key,value)=>sessionValues.set(key,String(value))},
    clearTimeout:()=>{},
    clearInterval:()=>{},
    setTimeout:callback=>{callback();return 1},
    location:{reload:()=>{reloads++}},
    setSession:()=>{},
    currentUser:{id:'owner-1'},
    audit:()=>{},
    renderNoWarehouse:message=>{renderState=`blocked:${message}`},
    renderWarehouseLoading:()=>{renderState='loading'},
    synchronizeCompanyWarehouseRegistry:async()=>{syncCalls++},
  };
  transitionContext.isTrainingEnvironment=()=>transitionContext.desktopSession.edition==='demo';
  vm.createContext(transitionContext);
  vm.runInContext(`${renderer.slice(transitionStart,transitionEnd)}\n${renderer.slice(requiresStart,requiresEnd)}\n${renderer.slice(periodicStart,periodicEnd)}\nglobalThis.__applyTransition=applyWarehouseRegistryTransition;globalThis.__requiresRegistry=requiresAuthoritativeWarehouseRegistry;globalThis.__refreshRegistry=refreshWarehouseRegistryDuringPollingV783;globalThis.__reloadKey=workspaceReloadKey;`,transitionContext);

  assert.equal(transitionContext.__requiresRegistry(),true,'a pending server-delete marker must block startup even when the warehouse remains in the local registry');
  assert.equal(transitionContext.__applyTransition('warehouse-old','pending-delete'),true);
  assert.match(renderState,/^blocked:Открытый склад удалён/);
  assert.equal(classes.has('jf-authenticated'),false,'a pending deletion must immediately close the authenticated workspace');
  assert.equal(transitionContext.cloudSyncState.dirty,false,'blocked local data must not remain queued for upload');

  registryState.pendingServerDeleteWarehouseId='';
  currentWarehouseId='warehouse-new';
  allowed=['warehouse-new'];
  classes.add('jf-authenticated');
  renderState='workspace-open';
  const duplicateReason='remote-replacement';
  sessionValues.set(transitionContext.__reloadKey(),JSON.stringify({reason:duplicateReason,targetWarehouseId:'warehouse-new',at:Date.now()}));
  assert.equal(transitionContext.__applyTransition('warehouse-old',duplicateReason),true);
  assert.equal(reloads,0,'the loop guard must reject a duplicate reload');
  assert.match(renderState,/^blocked:Список складов изменился/,'a rejected guarded reload must end on the blocking screen, not on an open or loading workspace');
  assert.equal(classes.has('jf-authenticated'),false);

  transitionContext.window.__JF_TEST_NO_RELOAD=true;
  transitionContext.synchronizeCompanyWarehouseRegistry=async()=>{syncCalls++;currentWarehouseId='warehouse-periodic';allowed=['warehouse-periodic'];registryState.activeWarehouseId='warehouse-periodic'};
  currentWarehouseId='warehouse-new';allowed=['warehouse-new'];renderState='workspace-open';classes.add('jf-authenticated');
  assert.equal(await transitionContext.__refreshRegistry(false,'periodic-switch'),true);
  assert.equal(syncCalls,1);
  assert.equal(transitionContext.window.__jfRemoteWarehouseReplacementV783,'warehouse-periodic','periodic reconciliation must select the replacement warehouse before any business polling continues');
  assert.equal(classes.has('jf-authenticated'),false);
  assert.equal(await transitionContext.__refreshRegistry(false,'periodic-switch'),false,'the periodic registry request is rate-limited to one request per 30 seconds');
  assert.equal(syncCalls,1);

  transitionContext.synchronizeCompanyWarehouseRegistry=async()=>{syncCalls++;currentWarehouseId='';allowed=[];registryState={...registryState,activeWarehouseId:'',warehouses:[],serverAuthoritativeEmpty:true}};
  renderState='workspace-open';classes.add('jf-authenticated');
  assert.equal(await transitionContext.__refreshRegistry(true,'periodic-empty'),true);
  assert.match(renderState,/^blocked:Доступ к открытому складу отозван/,'an authoritative empty registry must block the workspace during periodic reconciliation');
  assert.equal(classes.has('jf-authenticated'),false);
}

verifyUnreadableSingletonDefaultsAreNotLocalIntent();
verifyWritableFirstBootstrapChangeIsPreserved();
verifyGenericDirtyRecoveryCannotInventServerDelete();
verifyCleanEmployeeServerWarehouseNormalizationDoesNotQuarantine();
verifyOfflineOrderRecoveryIgnoresRegularDriverProviderNormalization();
verifyConflictResolutionRecoveryIgnoresOnlyServerEquivalentWarehouseMetadata();
verifyRestartPreservesCompletePersistedOrder();
verifyRejectedOrderNormalizationRecoveryIsStrict();
verifyServerEquivalentWarehouseReconcilesFingerprintMigration();
verifySafeWarehouseOutboxPrefixReconciliation();
verifyQuarantinedLegacyKnownSelfHealsThroughCurrentServerWarehouse().then(()=>Promise.all([verifyOfflineOutboxStartupOverlay(),verifyWarehouseRegistryReconciliation(),verifyWarehouseStorageIsolation(),verifyWarehouseRegistryTransitions(),verifyRouteCalculationRejectsStaleDepot(),verifyWarehouseCreateAccessExport(),verifyAuthoritativeEmptyCreateAction(),verifyWarehouseLifecycleUiSource()]))
  .then(()=>console.log(JSON.stringify({ok:true,serverWins:true,staleLocalRecordsRemoved:true,serverDeletedWarehousesRemoved:true,localOnlyWarehouseReimportBlocked:true,entityVersionAuthoritative:true,activeMetadataRefreshLive:true,trainingRegistryIsolation:true,restartGapRepaired:true,dirtyStatePreserved:true,staleDepotCoordinatesRejected:true,inFlightRouteCalculationCancelled:true,scopedWarehouseCreateBlocked:true,authoritativeEmptyCreateAction:true,authoritativeAllArchivedInactive:true,postCommitRegistryRefresh:true,warehouseCodeImmutableUi:true,truthfulDeleteRetentionCopy:true,nonActiveWarehouseStateIsolated:true,atomicDeleteLeaseDelegatedToTrustedProcesses:true,demoWarehouseSeedBlocked:true,pendingDeleteBlocksWorkspace:true,guardedReloadFallbackBlocks:true,periodicRegistryTransition:true,unreadableDefaultsIgnored:true,writableFirstBootstrapPreserved:true,genericDirtyDeleteSuppressed:true,explicitDeleteJournalPreserved:true,cleanEmployeeWarehouseNormalizationIgnored:true,regularDriverProviderNormalizationIgnored:true,conflictResolutionWarehouseNormalizationIgnored:true,restartOrderWorkflowPreserved:true,restartDocumentSnapshotPreserved:true,rejectedOrderNormalizationRecovered:true,rejectedOrderBusinessEditProtected:true,unqueuedLaterOrderEditProtected:true,quarantinedLegacyWarehouseSelfHeal:true,serverEquivalentWarehouseMigration:true,safeWarehouseOutboxPrefix:true,quarantineTitleTruthful:true})))
  .catch(error=>{console.error(error);process.exitCode=1});
