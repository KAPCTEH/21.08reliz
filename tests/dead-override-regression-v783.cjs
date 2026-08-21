const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const bundle=fs.readFileSync(path.resolve(__dirname,'../source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const count=pattern=>(bundle.match(pattern)||[]).length;

assert.equal(count(/clearAll__implV595\s*=\s*async function/g),1);
assert.equal(count(/exportCSV__implV595\s*=\s*function/g),1);
assert(!bundle.includes('clearAllV5'));
assert(!bundle.includes('const printRouteV560=printRoute__implV595'));
assert.equal(count(/printRoute__implV595\s*=\s*function/g),2);
for(const alias of ['premiumBaseRunDataDiagnostics','reportingDirectorBaseDiagnostics','runDataDiagnosticsV43','runDataDiagnosticsV5','runDataDiagnosticsAuditBase'])assert(!bundle.includes(alias));
assert.equal(count(/runDataDiagnostics__implV595\s*=\s*function/g),1);
for(const alias of ['premiumBasePrintCurrentOrder','printCurrentOrderV42'])assert(!bundle.includes(alias));
assert.equal(count(/printCurrentOrder__implV595\s*=\s*function/g),1);
assert(bundle.includes('Цена строки изменена в заказе; каталог'));
assert(bundle.includes('Оплата заказа'));
for(const alias of ['premiumBaseOpenDetails','openDetailsV42','openDetailsV5'])assert(!bundle.includes(alias));
assert.equal(count(/openDetails__implV595\s*=\s*function/g),1);
for(const helper of ['applyOrderDetailCompositionV595','applyOrderDetailPaymentV595','applyOrderDetailWorkflowV595'])assert(bundle.includes(`function ${helper}`));
for(const alias of ['normalizeOrderV42','normalizeOrderV5Base','normalizeOrderV560'])assert(!bundle.includes(alias));
assert.equal(count(/normalizeOrder__implV595\s*=\s*function/g),1);
assert(bundle.includes('warehouseId:o.warehouseId||currentWarehouseIdV560()'));
for(const alias of ['driverPaymentBaseOpenDetails','openDriverDetailsV43','openDriverDetailsV55'])assert(!bundle.includes(alias));
assert.equal(count(/openDriverDetails__implV595\s*=\s*function/g),1);
assert(bundle.includes('routeReturnsToWarehouse(row.def.id)'));
for(const alias of ['normalizeDriverV55','normalizeDriverV560'])assert(!bundle.includes(alias));
assert.equal(count(/normalizeDriver__implV595\s*=\s*function/g),1);
assert(bundle.includes('warehouseId:base.warehouseId||currentWarehouseIdV560()'));
for(const alias of ['renderOrdersV42','renderOrdersV5'])assert(!bundle.includes(alias));
assert.equal(count(/renderOrders__implV595\s*=\s*function/g),1);
assert(bundle.includes("scope==='archive'?order.archived:!order.archived"));
for(const alias of ['saveOrderV42','saveOrderV5','savePickupV42','savePickupV5'])assert(!bundle.includes(alias));
assert.equal(count(/saveOrder__implV595\s*=\s*async function/g),0);
assert.equal(count(/savePickup__implV595\s*=\s*async function/g),0);
for(const helper of ['captureOrderRouteImpactV595','invalidateOrderRouteImpactV595','removeOrderRouteAssignmentV595'])assert(bundle.includes(`function ${helper}`));

assert(bundle.includes('Object.keys(routeExecutions).some(routeExecutionActive)'));
assert(bundle.includes('persistRouteExecutions();persistRouteArchives();persistWarehouseReservations();renderAll()'));
assert(bundle.includes("'Статус выполнения','Статус склада','Статус оплаты'"));
assert(bundle.includes('orders-smart-statuses-${todayISO()}.csv'));

console.log(JSON.stringify({ok:true,deadClearAllRemoved:true,deadCsvRemoved:true,deadPrintWrapperRemoved:true,diagnosticsConsolidated:true,orderPrintConsolidated:true,orderDetailsConsolidated:true,orderNormalizationConsolidated:true,driverDetailsConsolidated:true,driverNormalizationConsolidated:true,orderListConsolidated:true,orderSaveConsolidated:true,finalGuardsPreserved:true}));
