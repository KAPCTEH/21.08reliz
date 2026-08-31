'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const outbox=require('../source/application/web/assets/js/05-local-outbox-v783.js');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');

function sourceBetween(startMarker,endMarker){
  const start=renderer.indexOf(startMarker),end=renderer.indexOf(endMarker,start);
  assert(start>=0&&end>start,`source fragment is available: ${startMarker}`);
  return renderer.slice(start,end);
}

const settleSource=sourceBetween('function settleEntityDirty(','function outboxError(');
const restoreSource=sourceBetween('async function restoreLocalOutboxOverlay(','async function bootstrapEntitySync(');
const bootstrapSource=sourceBetween('async function bootstrapEntitySync(','function scheduleCloudUpload(');
const installSource=sourceBetween('function installAutomaticCloudSync(','function latestQueuedEntityChanges(');

function memoryStorage(){
  const values=new Map();
  return{
    values,
    getItem:key=>values.has(String(key))?values.get(String(key)):null,
    setItem:(key,value)=>values.set(String(key),String(value)),
    removeItem:key=>values.delete(String(key)),
  };
}

function pendingWarehouseCommand(commandId){
  return{
    commandId,
    companyId:'company-1',
    warehouseId:'warehouse-1',
    environment:'live',
    authorUserId:'owner-1',
    deviceId:'device-1',
    intent:{kind:'warehouse_seed',targetId:'warehouse-1'},
    changes:[{
      type:'warehouse',
      id:'warehouse-1',
      baseVersion:0,
      deleted:false,
      payload:{id:'warehouse-1',environment:'live',name:'Склад 1',code:'С01'},
      _fingerprint:'warehouse-fingerprint',
    }],
  };
}

function createScenario({online}){
  const scope='company-1:live:warehouse-1',storage=memoryStorage(),queue=outbox.create(storage,scope),commandId=`client:${online?'online':'offline'}`;
  queue.enqueue(pendingWarehouseCommand(commandId));
  const dirtyKey=`jf.reg-entity-dirty.v1.${scope}`;
  storage.setItem(dirtyKey,'1');

  const counters={vpsBootstraps:0,serverImports:0,standaloneRestoreImports:0,standaloneOverlays:0,serverOverlays:0,scheduledDrains:0,failures:[]};
  const startupTimers=[];
  let releaseServer;
  const serverGate=new Promise(resolve=>{releaseServer=resolve});
  const localSnapshot={kind:'local',warehouse:{id:'warehouse-1'},data:{orders:[]}};
  const cloudSyncState={
    installed:false,bootstrapped:false,bootstrapPromise:null,bootstrapFlights:new Map(),scopeEpoch:1,scope,
    dirty:true,serial:0,suspended:0,uploadTimer:null,pollTimer:null,retryTimer:null,inFlightScopes:new Map(),
    criticalFlights:new Map(),ordinaryFlights:new Map(),ordinaryPrearms:new Map(),contextBlockedError:null,
    pollFailures:0,nextPollAt:0,cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set(),
    readerUserId:'owner-1',outboxes:new Map([[scope,queue]]),outbox:queue,outboxError:null,
    localBaseline:structuredClone(localSnapshot),observedFingerprint:'',
  };

  const context={
    console,
    structuredClone,
    window:{
      addEventListener:()=>{},
      JustFunDesktop:{regVps:{
        syncEntities:async()=>({ok:true}),
        bootstrapEntities:async()=>{
          counters.vpsBootstraps++;
          await serverGate;
          const pending=queue.get(commandId);
          if(pending?.state!=='confirmed')queue.markConfirmed(commandId,{test:'server-confirmed-during-bootstrap'});
          return{
            ok:true,
            cursor:1,
            readableTypes:['warehouse'],
            entities:[{type:'warehouse',id:'warehouse-1',version:1,digest_sha256:'a'.repeat(64),event_id:1,deleted:false,payload:{id:'warehouse-1',environment:'live',name:'Склад 1',code:'С01'}}],
          };
        },
      }},
      TeplitsaWarehouseV600:{
        importServerSnapshot:async snapshot=>{
          if(snapshot?.kind==='server')counters.serverImports++;
          else counters.standaloneRestoreImports++;
          return true;
        },
        whenPersisted:async()=>true,
      },
    },
    desktopSession:{edition:'full',auth:{offline:!online,company:{id:'company-1',data_service:online?'https://vps.invalid':null},user:{id:'owner-1'}}},
    currentUser:{id:'owner-1'},
    cloudSyncState,
    localStorage:storage,
    clearTimeout:()=>{},
    setTimeout:callback=>{startupTimers.push(callback);return startupTimers.length},
    setInterval:()=>1,
    isTrainingEnvironment:()=>false,
    onlineEntitySyncAvailable:()=>online,
    resetEntityScope:()=>{},
    renderLocalOutboxStatus:()=>{},
    criticalEntityFlightCount:()=>0,
    ordinaryEntityFlightCount:()=>0,
    ordinaryEntityPrearmTotal:()=>0,
    ordinaryEntityPrearmCount:()=>0,
    requireLocalOutbox:()=>queue,
    assertEntityRecoveryOwnership:()=>({ownerUserId:'owner-1',currentUserId:'owner-1',scope}),
    buildBackupPayload:()=>structuredClone(localSnapshot),
    cloneValue:value=>structuredClone(value),
    overlayLocalOutbox:(snapshot,targetQueue=queue)=>{
      const entries=targetQueue.overlayEntries(),applied=entries.reduce((sum,entry)=>sum+entry.changes.length,0);
      if(snapshot?.kind==='server')counters.serverOverlays++;
      else{counters.standaloneOverlays++;snapshot.kind='local-overlay'}
      return applied;
    },
    rememberLocalEntityBaseline:()=>{},
    rememberObservedEntitySnapshot:()=>{},
    activeWarehouseId:()=> 'warehouse-1',
    activeEnvironment:()=> 'live',
    audit:()=>{},
    entityDirtyGeneration:()=>{
      const value=Number(storage.getItem(dirtyKey)||0);
      return Number.isSafeInteger(value)&&value>0?value:0;
    },
    durableEntityDirty:()=>storage.getItem(dirtyKey)!==null,
    persistEntityDirty:value=>{
      if(value){const current=Number(storage.getItem(dirtyKey)||0);storage.setItem(dirtyKey,String(current+1))}
      else storage.removeItem(dirtyKey);
      return true;
    },
    beginEntityBootstrapFlight:()=>{},
    endEntityBootstrapFlight:()=>{},
    assertEntityScope:()=>{},
    entityScopeIsCurrent:()=>true,
    asArray:value=>Array.isArray(value)?value:[],
    canonicalServerEntity:value=>structuredClone(value),
    canWriteEntity:()=>false,
    initialServerSeedChanges:()=>[],
    newEntityCommandId:()=> 'client:unexpected-seed',
    snapshotFromServerEntities:()=>({kind:'server',warehouse:{id:'warehouse-1'},data:{orders:[]}}),
    planRejectedOrderNormalizationRecoveryV784:()=>null,
    finalizeRejectedOrderNormalizationRecoveryV784:()=>0,
    reconcileServerEquivalentWarehouseOutboxV784:()=>0,
    entityKey:(type,id)=>`${type}:${id}`,
    entityFingerprint:value=>JSON.stringify(value),
    semanticEntityFingerprintV784:(_type,_id,payload)=>JSON.stringify(payload),
    recoveryKnownEntitiesFromServer:(_local,_server,known)=>known,
    buildPendingEntityChanges:()=>[],
    localOutboxEntry:()=>{throw new Error('no recovery command expected')},
    capturePreBootstrapLocalIntent:()=>0,
    applyPendingResolutionMetadata:()=>{},
    finalizePendingServerResolutions:()=>0,
    commitRemoteEntitySnapshotV784:async({snapshot,metadata})=>{
      const imported=await context.window.TeplitsaWarehouseV600.importServerSnapshot(snapshot),persisted=await context.window.TeplitsaWarehouseV600.whenPersisted();
      if(imported===false||persisted===false)throw new Error('test import is not durable');
      cloudSyncState.known=new Map(metadata.known);cloudSyncState.conflicts=new Map(metadata.conflicts);cloudSyncState.cursor=metadata.cursor;cloudSyncState.readableTypes=new Set(metadata.readableTypes);cloudSyncState.bootstrapped=true;return true;
    },
    saveEntitySyncState:()=>true,
    integrationBadge:()=>{},
    integrationStatus:()=>{},
    scheduleOutboxDrain:()=>{counters.scheduledDrains++},
    reportCloudSyncFailure:error=>{counters.failures.push(error)},
    q:()=>null,
  };

  vm.createContext(context);
  vm.runInContext(`
    const WAREHOUSE_REGISTRY_ENVIRONMENT='live';
    ${settleSource}
    ${restoreSource}
    ${bootstrapSource}
    ${installSource}
    globalThis.__installAutomaticCloudSync=installAutomaticCloudSync;
    globalThis.__bootstrapEntitySync=bootstrapEntitySync;
  `,context);

  return{context,queue,commandId,dirtyKey,storage,counters,startupTimers,releaseServer};
}

async function spinUntil(predicate,label){
  for(let attempt=0;attempt<100&&!predicate();attempt++)await Promise.resolve();
  assert(predicate(),label);
}

async function verifyOnlineStartupUsesOnlyAuthoritativeBootstrap(){
  const scenario=createScenario({online:true});
  scenario.context.__installAutomaticCloudSync();
  assert.equal(scenario.startupTimers.length,1,'startup schedules one synchronization task');
  assert.match(String(scenario.startupTimers[0]),/onlineEntitySyncAvailable/,'the captured timer is the source startup synchronization task');
  const startup=scenario.startupTimers.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  await spinUntil(()=>scenario.counters.vpsBootstraps===1,`the scheduled online startup reaches the VPS bootstrap: ${JSON.stringify({...scenario.counters,failures:scenario.counters.failures.map(error=>error?.stack||String(error))})}`);
  const forced=scenario.context.__bootstrapEntitySync(true);
  assert.equal(scenario.counters.vpsBootstraps,1,'a concurrent forced bootstrap reuses the startup bootstrap promise');
  scenario.releaseServer();
  await Promise.all([startup,forced]);

  assert.deepEqual(scenario.counters.failures,[],'online startup completes without a hidden failure');
  assert.equal(scenario.counters.vpsBootstraps,1,'online startup performs exactly one VPS bootstrap');
  assert.equal(scenario.counters.serverImports,1,'online startup imports exactly one authoritative server snapshot');
  assert.equal(scenario.counters.standaloneRestoreImports,0,'online startup never imports a standalone local overlay');
  assert.equal(scenario.counters.standaloneOverlays,0,'online startup never builds a standalone local overlay');
  assert.equal(scenario.queue.status().active,0,'the command confirmed during bootstrap is no longer active');
  assert.equal(scenario.context.cloudSyncState.dirty,false,'final queue state clears the runtime dirty flag');
  assert.equal(scenario.storage.getItem(scenario.dirtyKey),null,'final queue state clears the durable dirty marker');
}

async function verifyOfflineStartupRestoresOnlyDurableOverlay(){
  const scenario=createScenario({online:false});
  scenario.context.__installAutomaticCloudSync();
  assert.equal(scenario.startupTimers.length,1,'offline startup schedules one synchronization task');
  await scenario.startupTimers.shift()();

  assert.deepEqual(scenario.counters.failures,[],'offline startup completes without a hidden failure');
  assert.equal(scenario.counters.vpsBootstraps,0,'offline startup never contacts the VPS');
  assert.equal(scenario.counters.serverImports,0,'offline startup never imports a server snapshot');
  assert.equal(scenario.counters.standaloneRestoreImports,1,'offline startup imports the durable local overlay exactly once');
  assert.equal(scenario.counters.standaloneOverlays,1,'offline startup builds the durable local overlay exactly once');
  assert.equal(scenario.queue.status().active,1,'offline command remains active for a later VPS retry');
  assert.equal(scenario.context.cloudSyncState.dirty,true,'offline startup keeps the runtime dirty flag');
  assert.notEqual(scenario.storage.getItem(scenario.dirtyKey),null,'offline startup keeps the durable dirty marker');
}

(async()=>{
  await verifyOnlineStartupUsesOnlyAuthoritativeBootstrap();
  await verifyOfflineStartupRestoresOnlyDurableOverlay();
  process.stdout.write(`${JSON.stringify({ok:true,online:{vpsBootstraps:1,serverImports:1,standaloneRestoreImports:0,active:0,dirty:false},offline:{vpsBootstraps:0,standaloneRestoreImports:1,active:1,dirty:true}})}\n`);
})().catch(error=>{console.error(error);process.exitCode=1});
