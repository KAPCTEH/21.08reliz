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

function loadCompany(companyId) {
  let warehouseSerial=0;
  const window = {
    JustFunDesktop: {
      bootstrapEdition: 'full',
      bootstrapCompanyId: companyId,
      startupStage() {},
    },
  };
  const context = {
    window,
    localStorage,
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

console.log(JSON.stringify({
  ok: true,
  companyA: companyA.companyScope,
  companyB: companyB.companyScope,
  isolatedStorageKeys: true,
  isolatedWarehouseCatalogs: true,
  pendingServerDeleteSurvivesRestart: true,
  authoritativeAllArchivedInactive: true,
  authoritativeEmptyRegistry: true,
}));
