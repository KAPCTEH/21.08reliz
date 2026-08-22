'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const start=renderer.indexOf('function stableEntityValue');
const end=renderer.indexOf('function initialServerSeedChanges');
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
};
vm.createContext(context);
vm.runInContext(`${renderer.slice(start,end)}\nglobalThis.__fromServer=snapshotFromServerEntities;globalThis.__fp=entityFingerprint;`,context);
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

console.log(JSON.stringify({ok:true,serverWins:true,staleLocalRecordsRemoved:true}));
