'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const bundle=fs.readFileSync(path.join(root,'source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const interactions=fs.readFileSync(path.join(root,'source/application/web/assets/js/97-route-stop-interactions.js'),'utf8');
const stability=fs.readFileSync(path.join(root,'source/application/web/assets/js/99-stability-v595.js'),'utf8');

const closureStart=bundle.indexOf('async function commitRouteClosureLegacyV594()');
const closureEnd=bundle.indexOf('\n\nconst renderRouteCardV5=',closureStart);
assert.ok(closureStart>=0&&closureEnd>closureStart,'route closure implementation must exist');
const closure=bundle.slice(closureStart,closureEnd);
assert.ok(closure.includes('removeManualRouteSequence(routeId)'),'route closure must remove the stored manual stop order');
assert.ok(closure.includes('delete routeOverrides[routeId]'),'route closure must remove route-specific overrides');
assert.ok(closure.includes('persistRouteOverrides()'),'route closure must persist override removal');
assert.ok(closure.indexOf('removeManualRouteSequence(routeId)')<closure.indexOf('delete routeExecutions[routeId]'),'manual cleanup must fail before active route state is destroyed');

assert.ok(stability.includes('try{add(ROUTE_OVERRIDES_KEY)}catch{}'),'critical rollback must snapshot route overrides on disk');
assert.ok(stability.includes("add('teplitsa_route_manual_sequences_v596')"),'critical rollback must snapshot manual route order on disk');
assert.ok(stability.includes('s.routeOverrides=clone(routeOverrides)'),'critical rollback must snapshot route overrides in memory');
assert.ok(stability.includes('RouteStopInteractionsV597?.reloadFromStorage?.()'),'critical rollback must reload restored manual route order');

const storageKey='scoped-manual-routes';
let stored=JSON.stringify({
  'route-1':{orderIds:['order-1'],updatedAt:'2026-08-30T00:00:00Z'},
  'route-2':{orderIds:['order-2'],updatedAt:'2026-08-30T00:00:00Z'}
});
let failWrites=false;
const context=vm.createContext({
  window:{TeplitsaWarehouseBootstrap:{dataKey:()=>storageKey}},
  localStorage:{
    getItem:key=>key===storageKey?stored:null,
    setItem:(key,value)=>{if(failWrites)throw new Error('disk full');if(key===storageKey)stored=String(value)}
  },
  document:{readyState:'loading',addEventListener(){}},
  console:{error(){}},
  structuredClone
});
vm.runInContext(interactions,context,{filename:'97-route-stop-interactions.js'});
const api=context.window.RouteStopInteractionsV597;
assert.equal(typeof api.removeRoute,'function','manual route API must expose deterministic route cleanup');
assert.equal(api.removeRoute('route-1'),true);
assert.deepEqual(JSON.parse(stored),{'route-2':{orderIds:['order-2'],updatedAt:'2026-08-30T00:00:00Z'}},'cleanup must delete only the closed route');
assert.equal(api.removeRoute('missing-route'),false,'cleanup must be idempotent when no manual order exists');

failWrites=true;
assert.throws(()=>api.removeRoute('route-2'),/Не удалось вернуть автоматический порядок/);
failWrites=false;
assert.equal(api.removeRoute('route-2'),true,'failed persistence must restore the in-memory manual route entry');
assert.deepEqual(JSON.parse(stored),{},'retry must durably remove the restored entry');

console.log(JSON.stringify({ok:true,routeClosureCleanup:true,manualSequencePersistence:true,rollbackCoverage:true}));
