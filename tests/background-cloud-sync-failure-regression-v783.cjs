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

function runHandler({throwFromUi=false}={}){
  const calls=[],cloudSyncState={dirty:false};
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
    console:{error:(...args)=>record('console.error',...args)}
  };
  vm.createContext(context);
  assert.doesNotThrow(()=>vm.runInContext(`${functionSource};reportCloudSyncFailure(failure)`,context));
  return{calls,cloudSyncState};
}

const result=runHandler();
assert.equal(result.cloudSyncState.dirty,true,'failed background upload must remain dirty');
assert.deepEqual(result.calls.find(call=>call.name==='badge')?.args,['jfRegBadge','Не сохранено на VPS','error']);
assert.match(result.calls.find(call=>call.name==='status')?.args[1]||'',/Не сохранено на VPS: VPS временно недоступен/);
assert.match(result.calls.find(call=>call.name==='status')?.args[1]||'',/Локальные изменения сохранены на этом компьютере/);
assert.deepEqual(result.calls.find(call=>call.name==='toast')?.args,['Не сохранено на VPS. Локальные изменения ожидают подтверждения сервера.','error']);
const auditCall=result.calls.find(call=>call.name==='audit')?.args||[];
assert.equal(auditCall[0],'background_vps_sync_failed');
assert.equal(auditCall[1]?.code,'NETWORK_ERROR');
assert.equal(auditCall[1]?.warehouseId,'warehouse-1');
assert.equal(auditCall[1]?.environment,'live');

const degraded=runHandler({throwFromUi:true});
assert.equal(degraded.cloudSyncState.dirty,true,'UI failures must not clear dirty state or reject the catch handler');

console.log(JSON.stringify({ok:true,dirtyPreserved:true,userStatus:true,auditEvent:true,handlerNeverRejects:true}));
