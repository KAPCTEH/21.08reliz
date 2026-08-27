import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'source/application/web/assets/js/00-warehouse-bootstrap-v600.js'),
  'utf8',
);
const values = new Map();
const localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
};

function loadCompany(companyId, storage=localStorage, edition='full') {
  let warehouseSerial=0;
  const window = {
    JustFunDesktop: {
      bootstrapEdition: edition,
      bootstrapCompanyId: companyId,
      startupStage() {},
    },
  };
  const context = {
    window,
    localStorage: storage,
    crypto: { randomUUID: () => `${companyId}-warehouse-${++warehouseSerial}` },
    console,
    Date,
    JSON,
    Math,
  };
  vm.runInNewContext(source, context, { filename: '00-warehouse-bootstrap-v600.js' });
  return window.TeplitsaWarehouseBootstrap;
}

const companyA = loadCompany('cmp_company_a_12345');
const keyA = companyA.dataKey('orders');
companyA.raw.set(keyA, JSON.stringify([{ id: 'order-a' }]));
assert.match(keyA, /^teplitsa_company_cmp_company_a_12345__/);
const primaryA=companyA.activeWarehouse();
const secondA=companyA.createWarehouseRecord({name:'Москва',code:'МСК'});
assert.equal(primaryA.catalogMode,'catalog');
assert.equal(secondA.catalogMode,'empty');
const registryA=companyA.getRegistry();
registryA.warehouses.push(secondA);
companyA.saveRegistry(registryA);
const primaryProductsKey=companyA.dataKey('products','live',primaryA.id);
const secondProductsKey=companyA.dataKey('products','live',secondA.id);
companyA.raw.set(primaryProductsKey,JSON.stringify([{id:'spb-product'}]));
companyA.raw.set(secondProductsKey,JSON.stringify([]));
assert.notEqual(primaryProductsKey,secondProductsKey);
assert.equal(companyA.raw.get(primaryProductsKey),JSON.stringify([{id:'spb-product'}]));
assert.equal(companyA.raw.get(secondProductsKey),JSON.stringify([]));

const companyB = loadCompany('cmp_company_b_12345');
const keyB = companyB.dataKey('orders');
assert.match(keyB, /^teplitsa_company_cmp_company_b_12345__/);
assert.notEqual(keyA, keyB);
assert.equal(companyB.raw.get(keyB), null);
assert.equal(companyB.raw.get(keyA), JSON.stringify([{ id: 'order-a' }]));
assert.equal(companyA.companyScope, 'cmp_company_a_12345');
assert.equal(companyB.companyScope, 'cmp_company_b_12345');

const pendingRegistry=companyB.getRegistry();
pendingRegistry.pendingServerDeleteWarehouseId=pendingRegistry.activeWarehouseId;
pendingRegistry.serverWorkspaceId='cmp_company_b_12345';
companyB.saveRegistry(pendingRegistry);
const companyBPendingReloaded=loadCompany('cmp_company_b_12345');
assert.equal(
  companyBPendingReloaded.getRegistry().pendingServerDeleteWarehouseId,
  pendingRegistry.activeWarehouseId,
  'a server-delete marker must survive restart until the authoritative warehouse list clears it',
);

const archivedRegistry=companyB.getRegistry();
archivedRegistry.warehouses=[
  {id:'warehouse-archived-1',name:'Архив 1',code:'А01',status:'archived',origin:'server'},
  {id:'warehouse-archived-2',name:'Архив 2',code:'А02',status:'archived',origin:'server'},
];
archivedRegistry.activeWarehouseId='warehouse-archived-1';
archivedRegistry.pendingServerDeleteWarehouseId='';
archivedRegistry.serverRegistryInitialized=true;
archivedRegistry.serverAuthoritativeEmpty=false;
companyB.saveRegistry(archivedRegistry);
assert.equal(companyB.getRegistry().activeWarehouseId,'','an authoritative all-archived registry must not activate an archived warehouse');
assert.deepEqual(companyB.getRegistry().warehouses.map(item=>item.status),['archived','archived']);
assert.equal(companyB.activeWarehouse(),null);
const companyBArchivedReloaded=loadCompany('cmp_company_b_12345');
assert.equal(companyBArchivedReloaded.getRegistry().activeWarehouseId,'','all-archived authoritative state must survive restart');
assert.deepEqual(companyBArchivedReloaded.getRegistry().warehouses.map(item=>item.status),['archived','archived']);

const emptyRegistry=companyB.getRegistry();
emptyRegistry.warehouses=[];
emptyRegistry.activeWarehouseId='';
emptyRegistry.pendingServerDeleteWarehouseId='';
emptyRegistry.serverAuthoritativeEmpty=false;
emptyRegistry.serverWorkspaceId='cmp_company_b_12345';
companyB.saveRegistry(emptyRegistry);
assert.deepEqual(companyB.getRegistry().warehouses,[]);
assert.equal(companyB.activeWarehouse(),null);
const companyBReloaded=loadCompany('cmp_company_b_12345');
assert.deepEqual(companyBReloaded.getRegistry().warehouses,[],'server-confirmed empty access must survive restart without creating a local warehouse');
assert.equal(companyBReloaded.getRegistry().serverAuthoritativeEmpty,true);

for(let failAt=1;failAt<=7;failAt+=1){
  const companyId=`cmp_migration_resume_${failAt}`,warehouseId='legacy-warehouse-1',legacyRegistry=JSON.stringify({version:2,activeWarehouseId:warehouseId,warehouses:[{id:warehouseId,name:'Старый склад',code:'СТР',status:'active',origin:'local'}]}),backing=new Map([
    ['teplitsa_warehouses_registry_v600',legacyRegistry],
    ['teplitsa_warehouses_migration_v600',JSON.stringify({completed:true,activeWarehouseId:warehouseId})],
    [`teplitsa_wh_v600__${warehouseId}__live__orders_2gis_tms_v1`,JSON.stringify([{id:`legacy-order-${failAt}`}])],
    [`teplitsa_wh_v600__${warehouseId}__live__orders_osm_leaflet_products_v1`,JSON.stringify([{id:`legacy-product-${failAt}`}])],
  ]),makeStorage=limit=>{let writes=0;return{get length(){return backing.size},key:index=>[...backing.keys()][index]??null,getItem:key=>backing.has(String(key))?backing.get(String(key)):null,setItem(key,value){writes+=1;if(writes===limit)throw new Error(`simulated migration crash ${limit}`);backing.set(String(key),String(value))},removeItem:key=>backing.delete(String(key))}};
  try{loadCompany(companyId,makeStorage(failAt))}catch(error){assert.match(String(error?.message||error),/simulated migration crash/)}
  const resumed=loadCompany(companyId,makeStorage(Number.POSITIVE_INFINITY)),prefix=`teplitsa_company_${companyId}__`,dataPrefix=`${prefix}wh_v600__${warehouseId}__live__`;
  assert.equal(resumed.raw.get('teplitsa_company_scope_claimed_v783'),companyId,`claim must survive crash point ${failAt}`);
  assert.equal(JSON.parse(resumed.raw.get(`${prefix}company_scope_migration_v783`)).state,'completed',`migration must complete after crash point ${failAt}`);
  const resumedRegistry=JSON.parse(resumed.raw.get(`${prefix}warehouses_registry_v600`));assert.equal(resumedRegistry.activeWarehouseId,warehouseId,`registry must resume after crash point ${failAt}`);assert.equal(resumedRegistry.warehouses[0].name,'Старый склад');
  assert.equal(JSON.parse(resumed.raw.get(`${dataPrefix}orders_2gis_tms_v1`))[0].id,`legacy-order-${failAt}`);
  assert.equal(JSON.parse(resumed.raw.get(`${dataPrefix}orders_osm_leaflet_products_v1`))[0].id,`legacy-product-${failAt}`);
  resumed.raw.remove(`${dataPrefix}orders_osm_leaflet_products_v1`);const completedReload=loadCompany(companyId,makeStorage(Number.POSITIVE_INFINITY));assert.equal(completedReload.raw.get(`${dataPrefix}orders_osm_leaflet_products_v1`),null,`completed migration must not resurrect deleted data after crash point ${failAt}`);
}

const completedCompanyId='cmp_completed_legacy_marker',completedWarehouseId='completed-warehouse',completedPrefix=`teplitsa_company_${completedCompanyId}__`,completedBacking=new Map([
  ['teplitsa_company_scope_claimed_v783',completedCompanyId],
  [`${completedPrefix}warehouses_registry_v600`,JSON.stringify({version:2,activeWarehouseId:completedWarehouseId,warehouses:[{id:completedWarehouseId,name:'Перенесённый склад',code:'ПРН',status:'active',origin:'local'}]})],
  [`${completedPrefix}warehouses_migration_v600`,JSON.stringify({completed:true,activeWarehouseId:completedWarehouseId})],
  ['orders_osm_leaflet_drivers_v1',JSON.stringify([{id:'must-not-resurrect'}])],
]),completedStorage={get length(){return completedBacking.size},key:index=>[...completedBacking.keys()][index]??null,getItem:key=>completedBacking.has(String(key))?completedBacking.get(String(key)):null,setItem:(key,value)=>completedBacking.set(String(key),String(value)),removeItem:key=>completedBacking.delete(String(key))};
const completedCompany=loadCompany(completedCompanyId,completedStorage),completedTarget=completedCompany.dataKey('orders_osm_leaflet_drivers_v1','live',completedWarehouseId),upgradedCompletedMarker=JSON.parse(completedCompany.raw.get(`${completedPrefix}warehouses_migration_v600`));
assert.equal(completedCompany.raw.get(completedTarget),null,'an already completed legacy migration must never resurrect a deliberately deleted scoped value');
assert.equal(upgradedCompletedMarker.companyId,completedCompanyId);
assert.equal(upgradedCompletedMarker.scopeVersion,2);

const globalBacking=new Map([
  ['orders_osm_leaflet_drivers_v1',JSON.stringify([{id:'legacy-secret-driver',name:'Секрет старой компании'}])],
  ['orders_osm_leaflet_settings_v1',JSON.stringify({warehouse:{address:'Секретный адрес старой компании'}})],
  ['orders_teplitsa_demonstration_mode_v1','0'],
]);
const globalStorage={get length(){return globalBacking.size},key:index=>[...globalBacking.keys()][index]??null,getItem:key=>globalBacking.has(String(key))?globalBacking.get(String(key)):null,setItem:(key,value)=>globalBacking.set(String(key),String(value)),removeItem:key=>globalBacking.delete(String(key))};
const legacyGlobalsBefore=new Map(globalBacking);
const legacyOwner=loadCompany('cmp_global_legacy_owner',globalStorage),legacyOwnerWarehouse=legacyOwner.activeWarehouse();
assert.equal(JSON.parse(legacyOwner.raw.get(legacyOwner.dataKey('orders_osm_leaflet_drivers_v1','live',legacyOwnerWarehouse.id)))[0].id,'legacy-secret-driver');
assert.equal(legacyOwner.raw.get('teplitsa_company_scope_claimed_v783'),'cmp_global_legacy_owner');
assert.equal(legacyOwner.raw.get(legacyOwner.systemKey('demo_mode',legacyOwnerWarehouse.id)),'0','legacy live mode must be copied into company-scoped state');
assert.equal(legacyOwner.raw.get('orders_teplitsa_demonstration_mode_v1'),'0','company migration must preserve the global legacy mode flag');
const otherCompany=loadCompany('cmp_global_legacy_other',globalStorage),otherWarehouse=otherCompany.activeWarehouse();
assert.equal(otherCompany.raw.get(otherCompany.dataKey('orders_osm_leaflet_drivers_v1','live',otherWarehouse.id)),null,'a second company must not import globally claimed legacy data');
assert.notEqual(otherWarehouse.address,'Секретный адрес старой компании','a second company must not derive its default warehouse from claimed global settings');
otherCompany.setDemo(true,otherWarehouse.id);otherCompany.setDemo(false,otherWarehouse.id);
assert.equal(otherCompany.raw.get(otherCompany.systemKey('demo_mode',otherWarehouse.id)),'0','the second company must persist its own live mode in its scoped key');
for(const [key,value] of legacyGlobalsBefore)assert.equal(globalBacking.get(key),value,`company-scoped demo changes must preserve global legacy key ${key}`);
const signedOut=loadCompany('',globalStorage),signedOutWarehouse=signedOut.activeWarehouse();
assert.equal(signedOut.raw.get(signedOut.dataKey('orders_osm_leaflet_drivers_v1','live',signedOutWarehouse.id)),null,'signed-out bootstrap must not import global legacy data');
const demo=loadCompany('',globalStorage,'demo'),demoWarehouse=demo.activeWarehouse();
assert.equal(demo.raw.get(demo.dataKey('orders_osm_leaflet_drivers_v1','demo',demoWarehouse.id)),null,'demo bootstrap must not import live global legacy data');

console.log(JSON.stringify({
  ok: true,
  companyA: companyA.companyScope,
  companyB: companyB.companyScope,
  isolatedStorageKeys: true,
  isolatedWarehouseCatalogs: true,
  pendingServerDeleteSurvivesRestart: true,
  authoritativeAllArchivedInactive: true,
  globalLegacyClaimIsolation: true,
  globalLegacyPreservedAcrossCompanies: true,
  completedLegacyMigrationDoesNotResurrect: true,
  authoritativeEmptyRegistry: true,
  legacyMigrationCrashResumePoints: 7,
}));
