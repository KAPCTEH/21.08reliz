'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');

function sourceBetween(startMarker,endMarker){
  const start=renderer.indexOf(startMarker),end=renderer.indexOf(endMarker,start);
  assert(start>=0&&end>start,`source fragment is available: ${startMarker}`);
  return renderer.slice(start,end);
}

const recoveryHelpers=sourceBetween('function generatedLocalWarehousePlaceholderV783(','async function migrateLocalCompanyToEmptyServerV783(');
const accessRefreshSource=sourceBetween('const LIVE_ACCESS_REFRESH_INTERVAL_MS=','function cloudResultError(');
const transitionSource=sourceBetween('function applyWarehouseRegistryTransition(','function clearWorkspaceReloadGuard(');
const retrySource=sourceBetween('async function retryWorkspaceAccess(','function addDesktopStrip(');
const startupSource=sourceBetween('async function restoreActiveWarehouseBeforeRecoveryV784(','async function installLogDiagnostics(');
const onlineGateSource=sourceBetween('function onlineEntitySyncAvailable()','function renderLocalOutboxStatus(');
const criticalRecoverySource=sourceBetween('async function recoverCriticalEntityMutation()','function refreshVisibleOrderDetailAfterRollbackV784(');
const bootstrapSource=sourceBetween('async function bootstrapEntitySync(','function scheduleCloudUpload(');

const COMPANY_ID='company-runtime-1';
const USER_ID='user-runtime-1';
const PLACEHOLDER_ID='placeholder-runtime-1';
const WAREHOUSE_W1='warehouse-runtime-w1';
const WAREHOUSE_ID='warehouse-runtime-w2';

function clone(value){return structuredClone(value)}

function memoryStorage(){
  const values=new Map();
  return{
    values,
    get length(){return values.size},
    key:index=>[...values.keys()][index]??null,
    getItem:key=>values.has(String(key))?values.get(String(key)):null,
    setItem:(key,value)=>values.set(String(key),String(value)),
    removeItem:key=>values.delete(String(key)),
  };
}

function provisionalRegistry(){
  return{
    activeWarehouseId:WAREHOUSE_ID,
    warehouses:[{id:WAREHOUSE_ID,name:'W2',code:'W2',status:'active',origin:'native-preference-provisional'}],
    serverWorkspaceId:COMPANY_ID,
    serverRegistryInitialized:false,
    serverAuthoritativeEmpty:false,
    nativeRecoveryProvisionalWarehouseId:WAREHOUSE_ID,
  };
}

function confirmedRegistry(){
  return{
    activeWarehouseId:WAREHOUSE_ID,
    warehouses:[{id:WAREHOUSE_ID,name:'W2',code:'W2',status:'active',origin:'server'}],
    serverWorkspaceId:COMPANY_ID,
    serverRegistryInitialized:true,
    serverAuthoritativeEmpty:false,
    nativeRecoveryProvisionalWarehouseId:'',
  };
}

function authoritativeW1Registry(){
  return{
    activeWarehouseId:WAREHOUSE_W1,
    warehouses:[{id:WAREHOUSE_W1,name:'W1',code:'W1',status:'active',origin:'server'}],
    serverWorkspaceId:COMPANY_ID,
    serverRegistryInitialized:true,
    serverAuthoritativeEmpty:false,
    nativeRecoveryProvisionalWarehouseId:'',
  };
}

function noAccessRegistry(){
  return{
    activeWarehouseId:'',
    warehouses:[],
    serverWorkspaceId:COMPANY_ID,
    serverRegistryInitialized:true,
    serverAuthoritativeEmpty:true,
    nativeRecoveryProvisionalWarehouseId:'',
  };
}

function cleanPlaceholderRegistry(){
  return{
    activeWarehouseId:PLACEHOLDER_ID,
    warehouses:[{id:PLACEHOLDER_ID,name:'Generated',code:'GEN',status:'active',origin:'local-default'}],
  };
}

function createScenario({
  initial='provisional',
  registryResult='confirmed',
  preferenceWarehouseId=WAREHOUSE_ID,
  authRole='owner',
  authPermissions=['*'],
  authWarehouseIds=[],
  authAllWarehouses=authRole==='owner',
  allowGuardedReload=false,
  testNoReload=true,
  initialOffline=false,
  runtimeAccessRefresh=false,
}={}){
  let registryState=initial==='clean'?cleanPlaceholderRegistry():provisionalRegistry();
  let authenticated=false;
  const localStorage=memoryStorage(),sessionStorage=memoryStorage(),events=[];
  const prefix=`teplitsa_company_${COMPANY_ID}__wh_v600__`;
  const dataKey=(key,environment='live',warehouseId=registryState.activeWarehouseId)=>`${prefix}${warehouseId}__${environment}__${String(key)}`;
  localStorage.setItem(dataKey('orders_osm_leaflet_products_v1','live',PLACEHOLDER_ID),JSON.stringify([{id:'catalog-runtime-default',catalogManaged:true}]));

  const journal={
    schemaVersion:3,
    phase:'pending_server',
    commandId:'client:runtime:pending-server',
    companyId:COMPANY_ID,
    warehouseId:WAREHOUSE_ID,
    environment:'live',
    authorUserId:USER_ID,
    intent:{kind:'pickup_collected',targetId:'order-runtime-1'},
    snapshot:{warehouse:{id:WAREHOUSE_ID},data:{}},
    postSnapshot:{warehouse:{id:WAREHOUSE_ID},data:{}},
    changes:[{type:'orders',id:'order-runtime-1',baseVersion:1,deleted:false,payload:{id:'order-runtime-1',warehouseId:WAREHOUSE_ID}}],
  };
  const recoveryApi={
    prepare:async()=>true,
    read:async warehouseId=>{events.push('recovery-read');events.push(`recovery-read:${String(warehouseId||'')}`);return clone(journal)},
    clear:async()=>{events.push('recovery-clear');return true},
  };
  const queue={get:()=>null,status:()=>({active:0}),enqueue:()=>{throw new Error('unexpected outbox enqueue')}};
  const B={
    prefix,
    raw:{get:key=>localStorage.getItem(key),set:(key,value)=>localStorage.setItem(key,value),remove:key=>localStorage.removeItem(key)},
    dataKey,
    getRegistry:()=>clone(registryState),
    saveRegistry:value=>{registryState=clone(value);events.push('save-registry');return clone(registryState)},
    setActive:id=>{registryState={...registryState,activeWarehouseId:String(id)}},
  };
  const desktopSession={edition:'full',auth:{offline:initialOffline,device_id:'device-runtime-1',company:{id:COMPANY_ID,status:'active',data_service:'https://vps.invalid'},user:{id:USER_ID,status:'active',role:authRole,permissions:[...authPermissions]}}};
  const refreshedAuth=clone({...desktopSession.auth,offline:false});
  const cloudSyncState={scope:`${COMPANY_ID}:live:${WAREHOUSE_ID}`,scopeEpoch:1,contextBlockedError:null,known:new Map(),conflicts:new Map(),bootstrapped:false,bootstrapPromise:null,bootstrapFlights:new Map(),outbox:queue,dirty:false,serial:0,suspended:0,readerUserId:USER_ID,readableTypes:new Set(),cursor:0,localBaseline:null,observedFingerprint:''};

  const context={
    console,
    structuredClone,
    window:{
      __JF_TEST_NO_RELOAD:testNoReload,
      addEventListener:()=>{},
      TeplitsaWarehouseBootstrap:B,
      TeplitsaWarehouseV600:{counts:()=>({orders:0,products:1,drivers:0,movements:0,routes:0,executions:0,archives:0})},
      JustFunLocalOutboxV783:{inspect:()=>({overlayEntries:()=>[],pendingServerResolutions:()=>[]})},
      JustFunDesktop:{
        getActiveWarehousePreference:async()=>{events.push('preference');return{ok:true,companyId:COMPANY_ID,userId:USER_ID,environment:'live',warehouseId:preferenceWarehouseId}},
        auth:{refreshContext:async()=>{events.push('auth-refresh');if(!runtimeAccessRefresh)throw new Error('the unchanged-auth refresh is mocked at the renderer boundary');return{ok:true,auth:clone(refreshedAuth)}}},
        regVps:{
          warehouses:async()=>{throw new Error('direct registry bridge call is unexpected in the extracted startup fragment')},
          bootstrapEntities:async()=>{events.push('bootstrap-entities');return{ok:true,entities:[],readableTypes:[],cursor:0}},
          syncEntities:async()=>{events.push('sync-entities');return{ok:true,replayed:false}},
        },
      },
    },
    document:{
      visibilityState:'visible',
      addEventListener:()=>{},
      documentElement:{classList:{
        remove:name=>{if(name==='jf-authenticated')authenticated=false;events.push('workspace-frozen')},
        add:name=>{if(name==='jf-authenticated')authenticated=true},
        contains:name=>name==='jf-authenticated'&&authenticated,
      }},
    },
    location:{reload:()=>events.push('reload')},
    localStorage,
    sessionStorage,
    desktopSession,
    currentUser:{id:USER_ID,role:authRole,allWarehouses:authAllWarehouses,warehouseIds:[...authWarehouseIds],permissions:[...authPermissions]},
    users:[],
    cloudSyncState,
    asArray:value=>Array.isArray(value)?value:[],
    cloudUserToLocal:(user,company)=>({id:String(user?.id||''),role:String(user?.role||''),serverRole:String(user?.role||''),allWarehouses:String(user?.role||'')==='owner'||authAllWarehouses,warehouseIds:[...authWarehouseIds],permissions:[...authPermissions],companyCode:String(company?.code||''),companyName:String(company?.name||'')}),
    exactPermissionList:value=>[...new Set(Array.isArray(value)?value.map(String):[])],
    registry:()=>clone(registryState),
    activeWarehouseId:()=>String(registryState.activeWarehouseId||''),
    activeEnvironment:()=> 'live',
    allowedWarehouseIds:()=>registryState.warehouses.filter(item=>item.status!=='archived').map(item=>String(item.id)),
    pendingWarehouseDeleteId:()=>String(registryState.pendingServerDeleteWarehouseId||''),
    isTrainingEnvironment:()=>false,
    durableEntityDirty:()=>false,
    workspaceReloadKey:()=> 'runtime-reload-guard',
    stopLiveAccessRefresh:()=>events.push('live-refresh-stopped'),
    audit:(action)=>events.push(`audit:${action}`),
    renderNoWarehouse:()=>events.push('no-warehouse'),
    renderWarehouseLoading:()=>events.push('warehouse-loading'),
    freezeWorkspaceForWarehouseTransition:()=>events.push('workspace-frozen'),
    blockWorkspaceAfterWarehouseChange:()=>events.push('workspace-blocked'),
    applyCanonicalActiveWarehouseMetadataV783:()=>events.push('metadata-applied'),
    guardedWorkspaceReload:(reason,target)=>{events.push(`guarded-reload:${String(target||'')}`);if(!allowGuardedReload)throw new Error('unexpected guarded workspace reload');return true},
    synchronizeCompanyWarehouseRegistry:async()=>{
      events.push('registry');
      registryState=registryResult==='w1'
        ?authoritativeW1Registry()
        :registryResult==='revoked'||registryResult==='no-access'
          ?noAccessRegistry()
          :confirmedRegistry();
      return true;
    },
    criticalRecoveryContext:()=>({companyId:COMPANY_ID,warehouseId:String(registryState.activeWarehouseId||''),environment:'live'}),
    criticalRecoveryApi:()=>recoveryApi,
    clearCriticalEntityRecovery:async()=>recoveryApi.clear(),
    resetEntityScope:()=>{},
    currentEntityInFlight:()=>false,
    currentEntityBootstrapInFlight:()=>0,
    ordinaryEntityFlightCount:()=>0,
    ordinaryEntityPrearmTotal:()=>0,
    criticalEntityFlightCount:()=>0,
    requireLocalOutbox:()=>queue,
    requireWritableLocalEntityChanges:()=>true,
    quarantineLocalEntityChanges:()=>{throw new Error('unchanged access must not quarantine local changes')},
    assertEntityRecoveryOwnership:()=>({ownerUserId:USER_ID,currentUserId:USER_ID}),
    rollbackLocalSnapshot:async()=>{events.push('rollback-post');return true},
    outboxError:(code,message,details={})=>Object.assign(new Error(message),{code,details}),
    blockForCriticalRecovery:error=>error,
    definitiveEntityRejection:()=>false,
    retryableEntityFailure:()=>false,
    acceptEntityBatchResult:()=>events.push('recovery-accepted'),
    asObject:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},
    cloneValue:clone,
    buildBackupPayload:()=>({warehouse:{id:WAREHOUSE_ID},data:{}}),
    ordinaryEntityChangesFromRecovery:()=>[],
    stableEntityValue:value=>value,
    persistEntityDirty:()=>true,
    renderLocalOutboxStatus:()=>{},
    localOutboxEntry:()=>{throw new Error('unexpected local outbox entry')},
    requiresAuthoritativeWarehouseRegistry:()=>false,
    confirmActiveWarehouseContext:async()=>{events.push('confirm-active');return true},
    hasEntityPermissionQuarantine:()=>false,
    mountWorkspace:()=>{authenticated=true;events.push('mount')},
    refreshLiveAccess:async()=>{events.push('access-refresh-unchanged');return true},
    q:()=>null,
    cloudResultError:result=>String(result?.error||'runtime error'),
    synchronizeWorkspaceInBackground:async()=>events.push('background-sync'),
    setTimeout:()=>{events.push('background-scheduled');return 1},
    clearTimeout:()=>{},
    clearInterval:()=>{},
  };

  vm.createContext(context);
  vm.runInContext(`
    let pendingActiveWarehouseMetadataChangeV783=null;
    let liveAccessRefreshStopped=false;
    ${runtimeAccessRefresh?'let liveAccessRefreshTimer=null;let liveAccessRefreshEventsInstalled=false;let liveAccessRefreshPromise=null;let integrationWizardBusy=false;':''}
    ${recoveryHelpers}
    ${runtimeAccessRefresh?accessRefreshSource:''}
    ${runtimeAccessRefresh?'let lastLiveAccessSignature=liveAccessSignature(desktopSession.auth);':''}
    ${transitionSource}
    ${retrySource}
    ${startupSource}
    ${onlineGateSource}
    ${criticalRecoverySource}
    ${bootstrapSource}
    globalThis.__enterWorkspace=enterWorkspace;
    globalThis.__refreshLiveAccess=refreshLiveAccess;
    globalThis.__retryWorkspaceAccess=retryWorkspaceAccess;
    globalThis.__bootstrapEntitySync=bootstrapEntitySync;
    globalThis.__provisionalNativeWarehouseIdV784=provisionalNativeWarehouseIdV784;
  `,context);

  return{context,events,getRegistry:()=>clone(registryState)};
}

function eventIndex(events,name){return events.indexOf(name)}

async function verifyCleanOnlineUsesRegistryBeforeRecovery(){
  const scenario=createScenario({initial:'clean',registryResult:'confirmed',preferenceWarehouseId:''});
  const entered=await scenario.context.__enterWorkspace();
  assert.equal(entered,false,'a changed authoritative warehouse requires the normal transition/reload path');
  assert(eventIndex(scenario.events,'preference')>=0,'the exact scoped native preference is read');
  assert(eventIndex(scenario.events,'registry')>eventIndex(scenario.events,'preference'),'an empty online preference falls through to the authoritative registry');
  assert.equal(eventIndex(scenario.events,'recovery-read'),-1,'the generated placeholder is never used to read a recovery journal before registry transition');
  assert.equal(eventIndex(scenario.events,'mount'),-1,'the generated placeholder is never mounted');
  assert.equal(scenario.getRegistry().activeWarehouseId,WAREHOUSE_ID);
}

async function verifyDeniedNativeW2UsesAuthoritativeTransition({entrypoint,registryResult}){
  const scenario=createScenario({
    initial:'clean',
    registryResult,
    preferenceWarehouseId:WAREHOUSE_ID,
    authRole:'viewer',
    authPermissions:[`jf.warehouse:${WAREHOUSE_W1}`],
    authWarehouseIds:[WAREHOUSE_W1],
    authAllWarehouses:false,
    allowGuardedReload:registryResult==='w1',
    testNoReload:false,
  });
  const entered=entrypoint==='retry'
    ?await scenario.context.__retryWorkspaceAccess()
    :await scenario.context.__enterWorkspace();
  assert.equal(entered,false,`${entrypoint} must stop at the authoritative warehouse transition`);
  const preference=eventIndex(scenario.events,'preference'),registry=eventIndex(scenario.events,'registry');
  assert(preference>=0&&registry>preference,`${entrypoint} must fetch the authoritative registry after rejecting denied native W2`);
  if(entrypoint==='retry')assert(eventIndex(scenario.events,'access-refresh-unchanged')>=0&&eventIndex(scenario.events,'access-refresh-unchanged')<preference,'unchanged auth must not bypass the denied-preference registry check on retry');
  assert.equal(eventIndex(scenario.events,'recovery-read'),-1,`${entrypoint} must not read any recovery journal while the clean placeholder is active`);
  assert.equal(eventIndex(scenario.events,`recovery-read:${PLACEHOLDER_ID}`),-1,`${entrypoint} must never recover in the generated placeholder scope`);
  assert.equal(eventIndex(scenario.events,'mount'),-1,`${entrypoint} must not mount before the authoritative transition completes`);
  const authoritative=scenario.getRegistry();
  assert.equal(authoritative.nativeRecoveryProvisionalWarehouseId,'','a denied native W2 must never become provisional');
  if(registryResult==='w1'){
    const frozen=eventIndex(scenario.events,'workspace-frozen'),loading=eventIndex(scenario.events,'warehouse-loading'),reload=eventIndex(scenario.events,`guarded-reload:${WAREHOUSE_W1}`);
    assert(registry<frozen&&frozen<loading&&loading<reload,'authoritative W1 must freeze the placeholder and request a guarded reload only after the registry response');
    assert.equal(authoritative.activeWarehouseId,WAREHOUSE_W1);
    assert.deepEqual(authoritative.warehouses.map(item=>item.id),[WAREHOUSE_W1]);
  }else{
    const blocked=eventIndex(scenario.events,'workspace-blocked');
    assert(registry<blocked,'authoritative no-access must block the placeholder only after the registry response');
    assert.equal(eventIndex(scenario.events,`guarded-reload:${WAREHOUSE_W1}`),-1,'no-access must not reload into an unassigned warehouse');
    assert.equal(authoritative.activeWarehouseId,'');
    assert.deepEqual(authoritative.warehouses,[]);
  }
}

async function verifyPendingServerConfirmsRegistryBeforeRecovery(){
  const scenario=createScenario({initial:'provisional',registryResult:'confirmed'});
  const entered=await scenario.context.__enterWorkspace();
  assert.equal(entered,true,'the confirmed same warehouse proceeds through pending-server recovery');
  const registry=eventIndex(scenario.events,'registry'),recovery=eventIndex(scenario.events,'recovery-read'),send=eventIndex(scenario.events,'sync-entities');
  assert(registry>=0&&recovery>registry&&send>recovery,'registry confirmation strictly precedes journal read and pending-server replay');
  assert(eventIndex(scenario.events,'recovery-clear')>send,'the recovery journal clears only after the server acknowledgement');
  assert(eventIndex(scenario.events,'mount')>eventIndex(scenario.events,'recovery-clear'),'workspace mounts only after recovery completes');
  assert.equal(scenario.getRegistry().nativeRecoveryProvisionalWarehouseId,'');
}

async function verifyOfflinePendingServerRefreshReentersRecoveryBeforeMount(){
  const scenario=createScenario({
    initial:'provisional',
    registryResult:'confirmed',
    initialOffline:true,
    runtimeAccessRefresh:true,
  });
  const firstEntered=await scenario.context.__enterWorkspace();
  assert.equal(firstEntered,false,'offline pending-server recovery must block the first provisional W2 entry');
  assert.equal(eventIndex(scenario.events,'registry'),-1,'offline provisional entry must not claim an authoritative registry response');
  assert(eventIndex(scenario.events,'recovery-read')>=0,'the first entry must inspect the protected W2 recovery journal');
  assert.equal(eventIndex(scenario.events,'sync-entities'),-1,'offline pending-server recovery must not contact the entity API');
  assert.equal(eventIndex(scenario.events,'recovery-clear'),-1,'offline pending-server recovery must remain durable');
  assert.equal(eventIndex(scenario.events,'mount'),-1,'offline pending-server recovery must keep the workspace closed');

  scenario.events.length=0;
  const refreshed=await scenario.context.__refreshLiveAccess('periodic');
  assert.equal(refreshed,true,'online periodic refresh must re-enter and finish the protected workspace startup');
  const registry=eventIndex(scenario.events,'registry'),recovery=eventIndex(scenario.events,'recovery-read'),send=eventIndex(scenario.events,'sync-entities'),clear=eventIndex(scenario.events,'recovery-clear'),mount=eventIndex(scenario.events,'mount');
  assert(registry>=0&&registry<recovery&&recovery<send&&send<clear&&clear<mount,'periodic refresh must confirm W2, replay and clear recovery, then mount in strict order');
  assert.equal(scenario.events.filter(event=>event==='mount').length,1,'refresh must not directly mount in addition to the recovered enterWorkspace mount');
  assert.equal(scenario.events.filter(event=>event==='recovery-read').length,1,'online refresh must perform exactly one post-registry recovery read');
  assert.equal(scenario.getRegistry().nativeRecoveryProvisionalWarehouseId,'','authoritative same-W2 refresh must clear the provisional marker before recovery');
}

async function verifyDirectBootstrapBlocksProvisionalRegistry(){
  const scenario=createScenario({initial:'provisional',registryResult:'confirmed'});
  await assert.rejects(scenario.context.__bootstrapEntitySync(),error=>error?.code==='ENTITY_REGISTRY_CONFIRMATION_REQUIRED','direct bootstrap must fail closed while the registry is provisional');
  assert.equal(eventIndex(scenario.events,'bootstrap-entities'),-1,'the provisional bootstrap guard runs before any VPS entity request');
  assert.equal(scenario.context.__provisionalNativeWarehouseIdV784(),WAREHOUSE_ID);
}

async function verifyRevokedTransitionNeverRecovers(){
  const scenario=createScenario({initial:'provisional',registryResult:'revoked'});
  const entered=await scenario.context.__enterWorkspace();
  assert.equal(entered,false,'a revoked provisional warehouse keeps the workspace closed');
  assert(eventIndex(scenario.events,'registry')>=0,'revocation is learned from the authoritative registry');
  assert(eventIndex(scenario.events,'workspace-blocked')>eventIndex(scenario.events,'registry'),'the registry transition blocks the revoked scope');
  assert.equal(eventIndex(scenario.events,'recovery-read'),-1,'a revoked warehouse journal is never read');
  assert.equal(eventIndex(scenario.events,'sync-entities'),-1,'a revoked warehouse command is never replayed');
  assert.equal(eventIndex(scenario.events,'mount'),-1,'a revoked warehouse is never mounted');
}

(async()=>{
  await verifyCleanOnlineUsesRegistryBeforeRecovery();
  await verifyDeniedNativeW2UsesAuthoritativeTransition({entrypoint:'startup',registryResult:'w1'});
  await verifyDeniedNativeW2UsesAuthoritativeTransition({entrypoint:'startup',registryResult:'no-access'});
  await verifyDeniedNativeW2UsesAuthoritativeTransition({entrypoint:'retry',registryResult:'w1'});
  await verifyDeniedNativeW2UsesAuthoritativeTransition({entrypoint:'retry',registryResult:'no-access'});
  await verifyPendingServerConfirmsRegistryBeforeRecovery();
  await verifyOfflinePendingServerRefreshReentersRecoveryBeforeMount();
  await verifyDirectBootstrapBlocksProvisionalRegistry();
  await verifyRevokedTransitionNeverRecovers();
  process.stdout.write(`${JSON.stringify({ok:true,scenarios:['clean-online-registry-first','denied-native-w2-authoritative-w1-startup','denied-native-w2-no-access-startup','denied-native-w2-authoritative-w1-unchanged-auth-retry','denied-native-w2-no-access-unchanged-auth-retry','provisional-pending-server-registry-first','offline-pending-server-periodic-refresh-reenters-recovery-before-mount','direct-bootstrap-provisional-block','revoked-transition-no-recovery']})}\n`);
})().catch(error=>{console.error(error);process.exitCode=1});
