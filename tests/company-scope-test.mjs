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

console.log(JSON.stringify({
  ok: true,
  companyA: companyA.companyScope,
  companyB: companyB.companyScope,
  isolatedStorageKeys: true,
  isolatedWarehouseCatalogs: true,
}));
