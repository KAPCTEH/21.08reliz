'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const acorn=require('acorn');
const walk=require('acorn-walk');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const ast=acorn.parse(renderer,{ecmaVersion:'latest',sourceType:'script'}),wanted=new Set(['captureEntitySyncMetadataV784','restoreEntitySyncMetadataV784','blockRemoteEntityApplyRollbackV784','commitRemoteEntitySnapshotV784']),sources=new Map();
walk.simple(ast,{FunctionDeclaration(node){if(wanted.has(node.id?.name))sources.set(node.id.name,renderer.slice(node.start,node.end))}});
for(const name of wanted)assert.ok(sources.has(name),`${name} must be declared`);
const implementation=[...wanted].map(name=>sources.get(name)).join('\n');

function plainMetadata(state){return{known:[...state.known],conflicts:[...state.conflicts],cursor:state.cursor,readableTypes:[...state.readableTypes],readerUserId:state.readerUserId,bootstrapped:state.bootstrapped,localBaseline:state.localBaseline,observedFingerprint:state.observedFingerprint}}

function scenario({importResult=true,persistResult=true,stateSaveError=false,rollbackResult=true}={}){
  const local={value:'local'},server={value:'server'},cloudSyncState={known:new Map([['orders:one',{version:1}]]),conflicts:new Map([['orders:conflict',{remoteVersion:2}]]),cursor:4,readableTypes:new Set(['warehouse','orders']),readerUserId:'user-1',bootstrapped:true,localBaseline:{value:'baseline'},observedFingerprint:'old-fingerprint',suspended:0,scopeEpoch:9,bootstrapPromise:Promise.resolve(),contextBlockedError:null},before=structuredClone(plainMetadata(cloudSyncState)),calls={imports:0,persists:0,stateSaves:0,rollbacks:0,freeze:0,render:0};
  let localValue=structuredClone(local);
  const context={
    structuredClone,
    cloudSyncState,
    cloneValue:value=>structuredClone(value),
    outboxError:(code,message,details={})=>Object.assign(new Error(message),{code,details}),
    assertEntityScope:()=>{},
    entityScopeIsCurrent:()=>true,
    rememberLocalEntityBaseline:snapshot=>{cloudSyncState.localBaseline=structuredClone(snapshot)},
    rememberObservedEntitySnapshot:snapshot=>{cloudSyncState.observedFingerprint=JSON.stringify(snapshot)},
    saveEntitySyncState:options=>{calls.stateSaves++;assert.equal(options?.required,true,'remote metadata save is a required commit barrier');if(stateSaveError)throw Object.assign(new Error('state save failed'),{code:'ENTITY_STATE_WRITE_FAILED'});return true},
    rollbackLocalSnapshot:async snapshot=>{calls.rollbacks++;if(rollbackResult!==true)return rollbackResult;localValue=structuredClone(snapshot);cloudSyncState.localBaseline=structuredClone(snapshot);return true},
    freezeWorkspaceForWarehouseTransition:()=>{calls.freeze++},
    renderNoWarehouse:()=>{calls.render++},
    window:{__warehousePersistenceCritical:null,TeplitsaWarehouseV600:{
      importServerSnapshot:async snapshot=>{calls.imports++;localValue=structuredClone(snapshot);return importResult},
      whenPersisted:async()=>{calls.persists++;return persistResult},
    }},
  };
  vm.createContext(context);vm.runInContext(`${implementation};globalThis.commitRemote=commitRemoteEntitySnapshotV784`,context);
  const metadata={known:new Map([['orders:one',{version:2}]]),conflicts:new Map(),cursor:8,readableTypes:new Set(['warehouse','orders','products']),bootstrapped:true};
  const run=()=>context.commitRemote({snapshot:server,rollbackSnapshot:local,metadata,expectedScope:'company:live:warehouse',expectedEpoch:9,phase:'unit'});
  return{context,cloudSyncState,before,calls,local,server,metadata,run,localValue:()=>localValue};
}

async function expectRolledBack(options,expectedCode){
  const test=scenario(options);await assert.rejects(test.run(),error=>!expectedCode||error?.code===expectedCode);assert.equal(test.calls.rollbacks,1,'a started remote import must roll back the pre-import local snapshot');assert.deepEqual(test.localValue(),test.local,'the local snapshot is restored after the failed commit barrier');assert.deepEqual(structuredClone(plainMetadata(test.cloudSyncState)),test.before,'global cursor, known versions, conflicts and readable boundary remain unchanged after rollback');return test;
}

(async()=>{
  await expectRolledBack({importResult:false});
  await expectRolledBack({persistResult:false});
  const stateFailure=await expectRolledBack({stateSaveError:true},'ENTITY_STATE_WRITE_FAILED');assert.equal(stateFailure.calls.stateSaves,1,'a state-save failure occurs inside the same rollback barrier');

  const success=scenario();assert.equal(await success.run(),true);assert.equal(success.calls.rollbacks,0);assert.equal(success.calls.imports,1);assert.equal(success.calls.persists,1);assert.equal(success.calls.stateSaves,1);assert.deepEqual(success.localValue(),success.server);assert.deepEqual(JSON.parse(JSON.stringify([...success.cloudSyncState.known])),JSON.parse(JSON.stringify([...success.metadata.known])));assert.deepEqual(JSON.parse(JSON.stringify([...success.cloudSyncState.conflicts])),[]);assert.equal(success.cloudSyncState.cursor,8);assert.deepEqual(JSON.parse(JSON.stringify([...success.cloudSyncState.readableTypes])),['warehouse','orders','products']);

  const unsafe=scenario({importResult:false,rollbackResult:false});await assert.rejects(unsafe.run(),error=>error?.code==='ENTITY_REMOTE_APPLY_ROLLBACK_FAILED');assert.equal(unsafe.calls.freeze,1,'a non-durable rollback fails closed');assert.equal(unsafe.calls.render,1);assert.equal(unsafe.cloudSyncState.contextBlockedError?.code,'ENTITY_REMOTE_APPLY_ROLLBACK_FAILED');assert.equal(unsafe.cloudSyncState.bootstrapped,false);

  console.log(JSON.stringify({ok:true,importFailureRolledBack:true,persistFailureRolledBack:true,stateSaveFailureRolledBack:true,successCommitted:true,unsafeRollbackBlocked:true}));
})().catch(error=>{console.error(error);process.exitCode=1});
