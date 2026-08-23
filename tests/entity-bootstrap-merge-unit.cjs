'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const multiWarehouse=fs.readFileSync(path.join(root,'source/application/web/assets/js/100-multi-warehouse-v600.js'),'utf8');
const routeEngine=fs.readFileSync(path.join(root,'source/application/web/assets/js/90-route-engine.js'),'utf8');
const start=renderer.indexOf('function stableEntityValue');
const end=renderer.indexOf('async function bootstrapEntitySync');
assert(start>=0&&end>start,'server-authoritative snapshot source fragment is available');

const context={
  console,
  structuredClone,
  window:{},
  localStorage:{getItem:()=>null,setItem:()=>{}},
  desktopSession:{auth:{company:{id:'company-1'}}},
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
};
context.isTrainingEnvironment=()=>context.activeEnvironment()==='demo';
vm.createContext(context);
vm.runInContext(`const WAREHOUSE_REGISTRY_ENVIRONMENT='live';\n${renderer.slice(start,end)}\nglobalThis.__fromServer=snapshotFromServerEntities;globalThis.__fp=entityFingerprint;globalThis.__split=splitEntitySnapshot;globalThis.__seed=initialServerSeedChanges;`,context);
assert.equal(typeof context.window.JustFunServerStorageV3?.writeWarehouse,'function','browser storage export remains available in the extracted fragment');
assert(Object.isFrozen(context.window.JustFunServerStorageV3),'browser storage export remains immutable');

const snapshot=order=>({
  warehouse:{id:'warehouse-1',environment:'live',createdAt:'2026-08-01T00:00:00Z'},
  data:{warehouseId:'warehouse-1',orders:order?[order]:[],products:[],inventoryMovements:[],drivers:[],routeArchives:[],settings:{},reportingData:{},company:{},routePlans:{},routeAssignments:{},routeCatalog:{},routeDriverAssignments:{},routeLocks:{},routeOverrides:{},routeExecutions:{},warehouseReservations:{},manualRouteSequences:{}},
});
const readable=[...context.ENTITY_SINGLETON_SECTIONS,...context.ENTITY_ARRAY_SECTIONS,...context.ENTITY_MAP_SECTIONS];
const order=(name,version=1)=>({type:'orders',id:'order-1',version,payload:{id:'order-1',warehouseId:'warehouse-1',createdAt:'2026-08-01T01:00:00Z',name}});
const base=order('base');

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
      {id:'warehouse-migration',name:'Склад миграции',code:'МГР',origin:'local',status:'active'},
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
  assert.deepEqual(saved.warehouses.map(item=>item.id),['warehouse-1'],'an initialized registry must never re-import a local-only warehouse');
  assert.equal(saved.warehouses[0].origin,'server');
  assert.equal(saved.warehouses[0].revision,4,'entity_version is authoritative when the list response also contains a legacy revision');

  remoteWarehouses=[{id:'warehouse-1',name:'Новый склад',code:'НОВ',address:'Новый адрес LIVE',lat:60.01,lon:31.02,timezone:'Europe/Moscow',status:'active',entity_version:5,digest_sha256:'digest-5'}];
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'same-id active metadata change requires immediate reconciliation');
  assert.equal(syncContext.__applyTransition('warehouse-1','same-id-live-metadata'),true);
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
  assert.equal(syncContext.__applyTransition('warehouse-1','same-id-live-restart-recovery'),true);
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
  saved=null;registryInitialized=false;
  syncContext.window.TeplitsaWarehouseV600.counts=()=>({orders:0,movements:0,routes:0,executions:0,archives:0});
  assert.equal(await syncContext.__syncWarehouseRegistry(),false,'a global manager may bootstrap the first warehouse only for a never-initialized registry');
  assert.equal(saved.warehouses.length,1);
  assert.equal(saved.serverRegistryInitialized,false);

  registryState={activeWarehouseId:'stale-local',warehouses:[{id:'stale-local',name:'Старый',code:'СТР',origin:'local',status:'active'}]};
  saved=null;
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'arbitrary local data is never promoted into a new server registry');
  assert.deepEqual(saved.warehouses,[]);

  registryState={activeWarehouseId:'local-default',warehouses:[{id:'local-default',name:'Склад',code:'СКЛ',origin:'local-default',status:'active'}]};
  saved=null;syncContext.cloudUserToLocal=()=>({id:'manager-1',permissions:['warehouses.manage'],allWarehouses:false});
  assert.equal(await syncContext.__syncWarehouseRegistry(),true,'a scoped manager cannot bootstrap a company-wide first warehouse');
  assert.deepEqual(saved.warehouses,[]);

  registryState={activeWarehouseId:'local-default',warehouses:[{id:'local-default',name:'Склад',code:'СКЛ',origin:'local-default',status:'active'}]};
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
}

function verifyWarehouseLifecycleUiSource(){
  assert(multiWarehouse.includes('refreshAuthoritativeWarehouseRegistryV760'),'warehouse lifecycle operations must refresh the authoritative registry after commit');
  assert(multiWarehouse.includes("window.JustFunWarehouseRegistryV783?.refresh"),'the lifecycle UI must use the shared server registry refresh');
  assert(!multiWarehouse.includes('Object.assign(w,next);B.saveRegistry(r)'),'an edit commit must not overwrite the refreshed registry with a stale pre-request snapshot');
  assert(!multiWarehouse.includes('r.warehouses=r.warehouses.filter(x=>String(x.id)!==String(w.id));B.saveRegistry(r)'),'a delete commit must not save a stale pre-request registry');
  assert(multiWarehouse.includes("$id('warehouseCodeV600').readOnly=true"),'an existing warehouse code is read-only');
  assert(multiWarehouse.includes('Код задаётся при создании один раз и затем не изменяется.'),'the create flow explains code immutability');
  assert.doesNotMatch(multiWarehouse,/без возможности восстановления/,'warehouse deletion must not promise absolute irrecoverability');
  assert.match(multiWarehouse,/Минимальный технический аудит и резервные копии/,'warehouse deletion explains the retention boundary');
}

async function verifyWarehouseStorageIsolation(){
  const calls=[];
  let savedEntityState=0;
  const storageContext={
    console,
    structuredClone,
    window:{JustFunDesktop:{
      regVps:{writeWarehouse:async payload=>{calls.push(structuredClone(payload));return{ok:true,entities:[{type:'warehouse',id:payload.warehouseId,version:calls.length+6,digest:`digest-${calls.length}`,eventId:calls.length}]}}},
    }},
    localStorage:{getItem:()=>null,setItem:()=>{savedEntityState++}},
    cloudSyncState:{installed:false,bootstrapped:false,bootstrapPromise:null,dirty:false,serial:0,suspended:0,uploadTimer:null,pollTimer:null,inFlight:false,pollFailures:0,nextPollAt:0,scope:'',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set()},
    desktopSession:{edition:'full',auth:{offline:false,company:{id:'company-1',data_service:'https://vps.invalid'},user:{id:'owner-1',role:'owner',permissions:['*']}}},
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
  vm.runInContext(`const WAREHOUSE_REGISTRY_ENVIRONMENT='live';\n${renderer.slice(start,end)}\nglobalThis.__writeWarehouse=writeAuthoritativeWarehouse;globalThis.__cloudSyncState=cloudSyncState;globalThis.__entityScope=entityScope;globalThis.__split=splitEntitySnapshot;globalThis.__seed=initialServerSeedChanges;`,storageContext);
  storageContext.__cloudSyncState.scope=storageContext.__entityScope();

  const other={id:'warehouse-other',name:'Другой склад',code:'ДРГ',revision:0};
  const otherResult=await storageContext.__writeWarehouse(other);
  assert.equal(otherResult.version,7);
  assert.equal(calls[0].warehouseId,'warehouse-other');
  assert.equal(calls[0].warehouseCode,'ДРГ');
  assert.equal(calls[0].environment,'live','warehouse registry writes must never follow a demo data environment');
  assert.equal(calls[0].changes[0].payload.environment,'live');
  assert.equal(storageContext.__cloudSyncState.known.size,0,'writing a non-active warehouse must not overwrite the active warehouse sync state');
  assert.equal(savedEntityState,0,'a non-active warehouse write must not persist the active warehouse entity cache');

  const active={id:'warehouse-active',name:'Активный склад',code:'АКТ',revision:0};
  const activeResult=await storageContext.__writeWarehouse(active);
  assert.equal(activeResult.version,8);
  assert.equal(storageContext.__cloudSyncState.known.get('warehouse:warehouse-active').version,8,'an active warehouse write still advances its own known version');
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

Promise.all([verifyWarehouseRegistryReconciliation(),verifyWarehouseStorageIsolation(),verifyWarehouseRegistryTransitions(),verifyRouteCalculationRejectsStaleDepot(),verifyWarehouseCreateAccessExport(),verifyAuthoritativeEmptyCreateAction(),verifyWarehouseLifecycleUiSource()])
  .then(()=>console.log(JSON.stringify({ok:true,serverWins:true,staleLocalRecordsRemoved:true,serverDeletedWarehousesRemoved:true,localOnlyWarehouseReimportBlocked:true,entityVersionAuthoritative:true,activeMetadataRefreshLive:true,trainingRegistryIsolation:true,restartGapRepaired:true,dirtyStatePreserved:true,staleDepotCoordinatesRejected:true,inFlightRouteCalculationCancelled:true,scopedWarehouseCreateBlocked:true,authoritativeEmptyCreateAction:true,authoritativeAllArchivedInactive:true,postCommitRegistryRefresh:true,warehouseCodeImmutableUi:true,truthfulDeleteRetentionCopy:true,nonActiveWarehouseStateIsolated:true,atomicDeleteLeaseDelegatedToTrustedProcesses:true,demoWarehouseSeedBlocked:true,pendingDeleteBlocksWorkspace:true,guardedReloadFallbackBlocks:true,periodicRegistryTransition:true})))
  .catch(error=>{console.error(error);process.exitCode=1});
