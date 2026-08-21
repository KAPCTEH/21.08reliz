import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const main=read('source/application/web/assets/js/00-app-bundle-v595.js');
const warehouses=read('source/application/web/assets/js/100-multi-warehouse-v600.js');
const routeMap=read('source/application/web/assets/js/95-route-map-loading.js');
const mapReliability=read('source/application/web/assets/js/105-map-reliability-v772.js');
const smartRoutes=read('source/application/web/assets/js/98-smart-automation-v598.js');

assert(main.includes("String(active.id)===String(primary.id)&&active.catalogMode==='catalog'"));
assert(warehouses.includes("write(PRODUCTS_KEY,[])"));
assert(warehouses.includes("write(INVENTORY_MOVEMENTS_KEY,[])"));
assert(warehouses.includes("reason:'builtin_catalog_isolated_to_primary_warehouse'"));
assert(warehouses.includes('window.switchWarehouseV600=async function'));
assert(warehouses.includes('const persisted=await ordersPersistChain'));
assert(warehouses.indexOf('const persisted=await ordersPersistChain')<warehouses.indexOf('B.setActive(id);'));
assert(warehouses.includes('await window.JustFunEntitySyncV783.flushAndConfirm()'));
assert(warehouses.indexOf('await window.JustFunEntitySyncV783.flushAndConfirm()')<warehouses.indexOf('B.setActive(id);'));

assert.equal((routeMap.match(/new ResizeObserver/g)||[]).length,0);
assert.equal((mapReliability.match(/new ResizeObserver/g)||[]).length,1);

const districtFunction=main.match(/function detectDistrict\(a,display,region\)\{[\s\S]*?\n\}/)?.[0];
assert(districtFunction,'detectDistrict function is available');
const context={result:null};
vm.runInNewContext(`
  const SPB_DISTRICTS=[],LO_DISTRICTS=[];
  const normalizeText=value=>String(value||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
  const samePlace=(a,b)=>normalizeText(a)===normalizeText(b);
  ${districtFunction}
  result=detectDistrict({state:'Москва',suburb:'Останкинский район'},'ВДНХ, Останкинский район, Москва, Центральный федеральный округ','Москва');
`,context);
assert.equal(context.result,'Останкинский район');

const spbContext={result:null};
vm.runInNewContext(`
  const SPB_DISTRICTS=[],LO_DISTRICTS=[];
  const normalizeText=value=>String(value||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
  const samePlace=(a,b)=>normalizeText(a)===normalizeText(b);
  ${districtFunction}
  result=detectDistrict({state:'Санкт-Петербург',municipality:'Дворцовый округ'},'Дом Зингера, Невский проспект, 28, Дворцовый округ, Санкт-Петербург','Санкт-Петербург');
`,spbContext);
assert.equal(spbContext.result,'Дворцовый округ');

assert(!mapReliability.includes("if(!map&&visibleGeometry(el))map=ensureInstance(el.id)"));
assert(main.includes("ok=!!plan&&!conflict.busy"));
assert(main.includes("Сначала рассчитайте маршрут. После расчёта система проверит пробег, время, груз и автомобиль"));
assert(main.includes('function invalidateMutableRoutePlansV560('));
assert(main.includes('window.invalidateMutableRoutePlansV783=invalidateMutableRoutePlansV560'));
assert(main.includes("restoreAutoAssignment__implV595=function(orderId){const order=orders.find"));
assert(main.includes("resetRouteAssignments__implV595=async function(){if(activeRouteIdsV560().size)"));
assert(!main.includes('persistSettings();routePlans={};persistRoutes();renderWarehouseStatus()'));
assert(!main.includes('persistSettings();routePlans={};persistRoutes();renderSettings();ensureWarehouseMap()'));
assert(smartRoutes.includes("typeof window.invalidateMutableRoutePlansV783==='function'"));

console.log(JSON.stringify({ok:true,warehouseCatalogIsolation:true,warehouseSwitchPersistence:true,singleMapResizeObserver:true,deferredMapInitialization:true,moscowDistrictFallback:true,spbMunicipalDistrictFallback:true,driverAssignmentRequiresPlan:true,activeRoutePlanProtection:true}));
