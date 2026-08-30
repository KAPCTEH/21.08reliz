'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const acorn=require('acorn');
const walk=require('acorn-walk');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const ast=acorn.parse(renderer,{ecmaVersion:'latest',sourceType:'script'});
let declaration=null;
walk.simple(ast,{FunctionDeclaration(node){if(node.id?.name==='reportCloudSyncFailure')declaration=node}});
assert.ok(declaration,'reportCloudSyncFailure must be declared');
const functionSource=renderer.slice(declaration.start,declaration.end);

function runHandler({throwFromUi=false,initialDirty=false,outboxActive=0,durableDirty=false,repeats=1}={}){
  const calls=[],cloudSyncState={dirty:initialDirty,scope:'company-1:live:warehouse-1',outbox:{status:()=>({active:outboxActive})}};let dirtyWrites=0;
  const record=(name,...args)=>{calls.push({name,args});if(throwFromUi)throw new Error(`${name} unavailable`)};
  const context={
    cloudSyncState,
    failure:Object.assign(new Error('VPS временно недоступен'),{code:'NETWORK_ERROR'}),
    integrationBadge:(...args)=>record('badge',...args),
    integrationStatus:(...args)=>record('status',...args),
    toast:(...args)=>record('toast',...args),
    audit:(...args)=>record('audit',...args),
    activeWarehouseId:()=>{if(throwFromUi)throw new Error('warehouse unavailable');return'warehouse-1'},
    activeEnvironment:()=>{if(throwFromUi)throw new Error('environment unavailable');return'live'},
    durableEntityDirty:()=>durableDirty,
    persistEntityDirty:()=>{dirtyWrites++},
    entityScope:()=> 'company-1:live:warehouse-1',
    console:{error:(...args)=>record('console.error',...args)}
  };
  vm.createContext(context);
  assert.doesNotThrow(()=>vm.runInContext(`${functionSource};${'reportCloudSyncFailure(failure);'.repeat(repeats)}`,context));
  return{calls,cloudSyncState,dirtyWrites};
}

const result=runHandler({initialDirty:true});
assert.equal(result.cloudSyncState.dirty,true,'an existing local dirty state must survive a failed background upload');
assert.equal(result.dirtyWrites,0,'reporting an existing dirty state must not increment its durable generation');
assert.deepEqual(result.calls.find(call=>call.name==='badge')?.args,['jfRegBadge','Не сохранено на VPS','error']);
assert.match(result.calls.find(call=>call.name==='status')?.args[1]||'',/Не сохранено на VPS: VPS временно недоступен/);
assert.match(result.calls.find(call=>call.name==='status')?.args[1]||'',/Локальные изменения (?:уже )?сохранены на этом компьютере/);
assert.deepEqual(result.calls.find(call=>call.name==='toast')?.args,['Не сохранено на VPS. Локальные изменения ожидают подтверждения сервера.','error']);
const auditCall=result.calls.find(call=>call.name==='audit')?.args||[];
assert.equal(auditCall[0],'background_vps_sync_failed');
assert.equal(auditCall[1]?.code,'NETWORK_ERROR');
assert.equal(auditCall[1]?.localChanges,true);
assert.equal(auditCall[1]?.warehouseId,'warehouse-1');
assert.equal(auditCall[1]?.environment,'live');

const clean=runHandler({repeats:2});
assert.equal(clean.cloudSyncState.dirty,false,'a read/bootstrap failure with no local changes must not manufacture a dirty marker');
assert.equal(clean.dirtyWrites,0,'repeated read/bootstrap failures must not create or increment a durable dirty generation');
assert.deepEqual(clean.calls.find(call=>call.name==='badge')?.args,['jfRegBadge','Ошибка чтения VPS','error']);
assert.match(clean.calls.find(call=>call.name==='status')?.args[1]||'',/Локальных изменений для отправки нет/);
assert.equal(clean.calls.find(call=>call.name==='audit')?.args?.[1]?.localChanges,false);

const queued=runHandler({outboxActive:1});
assert.equal(queued.cloudSyncState.dirty,false,'an existing outbox remains authoritative without incrementing a generic dirty generation');
assert.equal(queued.dirtyWrites,0);
assert.deepEqual(queued.calls.find(call=>call.name==='badge')?.args,['jfRegBadge','Не сохранено на VPS','error']);

const degraded=runHandler({throwFromUi:true,initialDirty:true});
assert.equal(degraded.cloudSyncState.dirty,true,'UI failures must not clear dirty state or reject the catch handler');

console.log(JSON.stringify({ok:true,dirtyPreserved:true,cleanReadFailureStaysClean:true,outboxDoesNotIncrementDirty:true,userStatus:true,auditEvent:true,handlerNeverRejects:true}));
