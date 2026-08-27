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
const desktopPlatform=read('source/application/web/assets/js/110-desktop-platform-v750.js');
const routeWorkspace=read('source/application/web/assets/js/94-route-workspace-final.js');
const windowsWorkflow=read('.github/workflows/windows-native-783.yml');
const localReleaseBuilder=read('tools/build-audited-rc.ps1');
const windowsInstallerBuilder=read('source/installer/build_windows.py');
const testCatalog=JSON.parse(read('release/test-catalog.json'));
const normalizedWindowsWorkflow=windowsWorkflow.replaceAll('\r\n','\n');

assert(
  fs.readFileSync(path.join(root,'.github/workflows/windows-native-783.yml')).equals(
    fs.readFileSync(path.join(root,'tests/fixtures/windows-native-783.yml'))
  ),
  'the Windows workflow fixture must be byte-identical to the executable workflow'
);
const catalogIds=new Set(),catalogPaths=new Set(),catalogCommands=new Set();
for(const test of testCatalog.tests||[]){
  assert(!catalogIds.has(test.id),`duplicate test catalog id: ${test.id}`);
  catalogIds.add(test.id);
  catalogPaths.add(String(test.path||'').replaceAll('\\','/'));
  catalogCommands.add(String(test.command||''));
}
const runnableTestFiles=fs.readdirSync(path.join(root,'tests'),{withFileTypes:true})
  .filter(entry=>entry.isFile()&&['.cjs','.mjs','.ps1','.py'].includes(path.extname(entry.name)))
  .map(entry=>`tests/${entry.name}`)
  .sort();
for(const testPath of runnableTestFiles){
  assert(catalogPaths.has(testPath),`runnable test is missing from release/test-catalog.json: ${testPath}`);
}

const requiredGateCommands=[
  'node tests/audit-tools-unit.mjs',
  'node tests/security-manifest-unit.cjs',
  'node tests/security-regression-v783.mjs',
  'node tests/action-dispatch-unit.cjs',
  'node tests/startup-auth-regression.cjs',
  'node tests/tz3-live-defects-unit.cjs',
  'python tests/license-custom-role-migration-test.py',
  'python tests/license-exact-permission-migration-test.py',
  'python tests/license-granular-permission-migration-test.py',
  'python tests/reg-legacy-migration-unit.py',
  'python tests/reg-legacy-migration-integration.py',
  'node tests/company-scope-test.mjs',
  'node tests/local-outbox-v783-unit.cjs',
  'node tests/atomic-mutation-async-regression-v783.cjs',
  'python tests/installer-builder-unit.py',
  'python tests/reg-api-contract-test.py',
  'python tests/reg-entity-protocol-test.py',
  'python tests/reg-map-proxy-test.py',
  'node tests/reg-native-ssh-unit.cjs',
  'node tests/reg-tls-source-test.cjs',
  'python tests/company-telegram-broker-schema-test.py',
  'node tests/company-telegram-broker-unit.mjs',
  'node tests/telegram-scope-regression-v783.cjs',
  'node tests/telegram-shared-d1-schema.cjs',
  'node tests/telegram-system-proxy-transport-unit.cjs',
  'node tests/telegram-wizard-open-regression-v783.cjs',
  'node tests/telegram-worker-unit.mjs',
  'node tests/dead-override-regression-v783.cjs',
  'node tests/deep-business-fixture-regression-v783.cjs',
  'node tests/desktop-dialog-regression-v783.cjs',
  'node tests/error-boundary-regression-v783.cjs',
  'node tests/icon-system-regression-v783.cjs',
  'python tests/logo-transparency-test.py',
  'node tests/map-diagnostic-regression-v783.cjs',
  'node tests/route-stage-pagination-unit.cjs',
  'node tests/runtime-overrides-regression-v783.cjs',
  'node tests/role-matrix-all.mjs',
  'node tests/runtime-smoke.mjs source/application/web entity-ack-validation'
];
for(const command of requiredGateCommands){
  assert(windowsWorkflow.includes(command),`Windows workflow is missing mandatory safe test: ${command}`);
  const [runtime,...argumentsList]=command.split(' ');
  const builderInvocation=`Invoke-Checked '${runtime==='python'?'python':'node'}' @(${argumentsList.map(value=>`'${value}'`).join(', ')})`;
  assert(localReleaseBuilder.includes(builderInvocation),`local release builder is missing mandatory safe test: ${command}`);
}
assert(normalizedWindowsWorkflow.includes("npm run check\n            if ($LASTEXITCODE -ne 0) { throw 'Update catalog service check failed.' }"));
assert(windowsWorkflow.includes('source/update-catalog-service/package-lock.json'));
assert(windowsWorkflow.includes("'source/update-catalog-service','tests'"));
assert(localReleaseBuilder.includes("Invoke-Checked 'npm.cmd' @('run', 'check') (Join-Path $repo 'source/update-catalog-service')"));
assert(localReleaseBuilder.includes("'source/update-catalog-service',\n      'tests'".replaceAll('\n','\r\n'))||localReleaseBuilder.includes("'source/update-catalog-service',\n      'tests'"));
for(const command of [
  'node tests/local-outbox-v783-unit.cjs',
  'python tests/reg-legacy-migration-integration.py',
  'python tests/reg-legacy-migration-unit.py',
  'node tests/role-matrix-all.mjs',
  'node tests/route-stage-pagination-unit.cjs',
  'node tests/tz3-live-defects-unit.cjs',
  'node tests/verify-pe-icon.mjs <executable> <icon>',
  'node tests/runtime-smoke.mjs source/application/web entity-ack-validation'
]) assert(catalogCommands.has(command),`mandatory release catalog command is missing: ${command}`);
assert(localReleaseBuilder.includes("'source/installer/build_windows.py'"),'local release builder must invoke the hardened Windows installer builder');
for(const requiredInstallerGate of [
  'verify_pe_resources.mjs',
  'installer-crash-recovery-test.ps1',
  'PE-RESOURCE-QA.json',
  'INSTALLER-CRASH-RECOVERY-QA.json'
]) assert(windowsInstallerBuilder.includes(requiredInstallerGate),`hardened installer builder is missing ${requiredInstallerGate}`);

assert(main.includes("String(active.id)===String(primary.id)&&active.catalogMode==='catalog'"));
assert(warehouses.includes("write(PRODUCTS_KEY,[])"));
assert(warehouses.includes("write(INVENTORY_MOVEMENTS_KEY,[])"));
assert(warehouses.includes("reason:'builtin_catalog_isolated_to_primary_warehouse'"));
assert(warehouses.includes('window.switchWarehouseV600=async function'));
assert(warehouses.includes('const persisted=await ordersPersistChain'));
assert(warehouses.indexOf('const persisted=await ordersPersistChain')<warehouses.indexOf('B.setActive(id);'));
assert(warehouses.includes('await window.JustFunEntitySyncV783.flushAndConfirm()'));
assert(warehouses.indexOf('await window.JustFunEntitySyncV783.flushAndConfirm()')<warehouses.indexOf('B.setActive(id);'));

const saveWarehouseBlock=warehouses.slice(warehouses.indexOf('window.saveWarehouseEditorV600=async function'),warehouses.indexOf('window.switchWarehouseV600=async function'));
const archiveWarehouseBlock=warehouses.slice(warehouses.indexOf('window.toggleWarehouseArchiveV600=async function'),warehouses.indexOf('window.deleteWarehouseV760=async function'));
const deleteWarehouseBlock=warehouses.slice(warehouses.indexOf('window.deleteWarehouseV760=async function'),warehouses.indexOf('function decoratePrintedDocument'));
assert(warehouses.includes('let warehouseLifecycleBusyV760=false'));
assert(warehouses.includes('function canCreateWarehouseV760()'));
assert(warehouses.includes("if(!id&&!canCreateWarehouseV760())"));
assert(warehouses.includes('async function withWarehouseLifecycleLockV760(action)'));
assert(warehouses.includes('warehouseLifecycleBusyV760=true'));
assert(warehouses.includes('finally{warehouseLifecycleBusyV760=false}'));
assert(saveWarehouseBlock.includes('withWarehouseLifecycleLockV760(async()=>'));
assert(archiveWarehouseBlock.includes('withWarehouseLifecycleLockV760(async()=>'));
assert(deleteWarehouseBlock.includes('withWarehouseLifecycleLockV760(async()=>'));
assert(saveWarehouseBlock.includes('await persistWarehouseRegistryV760(next)'));
assert(saveWarehouseBlock.includes('serverWrite=await persistWarehouseRegistryV760(w,{initialSettings,initialCompany:initialSettings.company})'));
assert(saveWarehouseBlock.indexOf('await persistWarehouseRegistryV760(next)')<saveWarehouseBlock.indexOf("refreshAuthoritativeWarehouseRegistryV760('изменение склада'"));
assert(saveWarehouseBlock.includes("committed=result?.skipped!==true"));
assert(saveWarehouseBlock.includes('else{Object.assign(w,next);B.saveRegistry(r);canonical=next}'));
assert(saveWarehouseBlock.indexOf('serverWrite=await persistWarehouseRegistryV760(w,{initialSettings,initialCompany:initialSettings.company})')<saveWarehouseBlock.indexOf("refreshAuthoritativeWarehouseRegistryV760('создание склада'"));
assert(saveWarehouseBlock.indexOf("refreshAuthoritativeWarehouseRegistryV760('создание склада'")<saveWarehouseBlock.indexOf('B.setActive(w.id)'));
assert(!saveWarehouseBlock.includes("const rollbackWarehouse={...w,status:'archived'}"));
assert(archiveWarehouseBlock.indexOf('await persistWarehouseRegistryV760(next)')<archiveWarehouseBlock.indexOf('refreshAuthoritativeWarehouseRegistryV760(action'));
assert(archiveWarehouseBlock.includes("committed=result?.skipped!==true"));
assert(archiveWarehouseBlock.includes('else{Object.assign(w,next);B.saveRegistry(r)}'));
assert(!deleteWarehouseBlock.includes('assertWarehouseDeletionAssignments'));
assert(deleteWarehouseBlock.indexOf('await persistWarehouseRegistryV760(w,{deleted:true})')<deleteWarehouseBlock.indexOf('B.raw.remove(key)'));
assert(deleteWarehouseBlock.indexOf("refreshAuthoritativeWarehouseRegistryV760('удаление склада'")<deleteWarehouseBlock.indexOf('B.raw.remove(key)'));
assert(!deleteWarehouseBlock.includes('B.saveRegistry(r)'));
assert(!desktopPlatform.includes("!byId.has(String(item.id))&&String(item.origin||'local')!=='server'"));
assert(desktopPlatform.includes('revision:Number(item?.entity_version??item?.revision)||0'));
assert(desktopPlatform.includes("activeEnvironment()===WAREHOUSE_REGISTRY_ENVIRONMENT&&id===activeWarehouseId()&&entityScopeIsCurrent(expectedScope,expectedEpoch)"));
assert(desktopPlatform.includes("if(environment===WAREHOUSE_REGISTRY_ENVIRONMENT)add('warehouse',warehouseId,warehouse)"));
assert(desktopPlatform.includes("warehouses?.({environment:'live'})"));
assert(desktopPlatform.includes("environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:newEntityCommandId(),changes"));
assert(desktopPlatform.includes("const WAREHOUSE_REGISTRY_ENVIRONMENT='live'"));
assert(desktopPlatform.includes("nextWarehouseRegistryRefreshAtV783=now+30000"));
assert(desktopPlatform.includes("blockWorkspaceAfterWarehouseChange('Список складов изменился, но безопасная автоматическая перезагрузка была остановлена."));
assert(desktopPlatform.includes("function isTrainingEnvironment(){return desktopSession?.edition==='demo'||window.TeplitsaWarehouseBootstrap?.isDemo?.()===true}"));
assert(desktopPlatform.includes("if(isTrainingEnvironment())return Promise.resolve().then(mutation)"));
assert(desktopPlatform.includes("if(!desktopSession?.auth?.company?.data_service){if(deleted)throw new Error"));
assert(desktopPlatform.includes("startRoutePicking:{kind:'route_picking',critical:false"));
assert(desktopPlatform.includes("markCurrentPickupReady:{kind:'pickup_ready',critical:false"));
assert(desktopPlatform.includes("if(!onlineEntitySyncAvailable()){if(!desktopSession?.auth?.company?.data_service)"));
assert(desktopPlatform.includes("LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783=2"));
assert(desktopPlatform.includes("LOCAL_MIGRATION_REMOTE_NOT_EMPTY"));
assert(desktopPlatform.includes("LOCAL_MIGRATION_SOURCE_CHANGED"));
assert(desktopPlatform.includes("LOCAL_MIGRATION_OUTBOX_BLOCKED"));
assert(desktopPlatform.includes("applyEntityToSnapshot(snapshot,change,change.deleted===true)"));
assert(desktopPlatform.includes("includedInSnapshot:true"));
assert(desktopPlatform.includes("pendingMigration.state==='complete'"));
assert(desktopPlatform.includes("item?.catalog_mode==='empty'||item?.catalogMode==='empty'"));
assert(warehouses.includes('storedSnapshot:(warehouseId,environment=\'live\')'));
assert(main.includes('const requestId=String(context.requestId||mapRequestId())'));
assert(warehouses.includes('const address=String(point.address||\'\').trim(),lat='));
assert(warehouses.includes("telegramSetupRequired:false,storageMode:serverCommitted?'server':'local'"));
assert(!warehouses.includes("sessionStorage.setItem('jfTelegramSetupWarehouseV783'"));
assert(desktopPlatform.includes("canCreate:()=>!isTrainingEnvironment()"));
assert(desktopPlatform.includes("if(isTrainingEnvironment()){boxes.forEach"));
assert(desktopPlatform.includes("function telegramEnvironment(){return activeEnvironment()}"));
assert(desktopPlatform.includes("if(typeof window.TeplitsaWarehouseV600?.applyBranding==='function')"));
assert(warehouses.includes('criticalRecovery:Object.freeze({prepare:prepareCriticalRecoveryV783,read:readCriticalRecoveryV783,clear:clearCriticalRecoveryV783})'));
assert(warehouses.includes("CRITICAL_RECOVERY_FALLBACK_MAX=1500000"));
assert(desktopPlatform.includes('await prepareCriticalEntityRecovery(rollbackSnapshot,operationContext,criticalCommandId,intent)'));
assert(desktopPlatform.includes('async function recoverCriticalEntityMutation()'));
assert(desktopPlatform.includes("try{await recoverCriticalEntityMutation()}catch(error){audit('critical_recovery_startup_blocked'"));
assert(desktopPlatform.includes('setTimeout(async()=>{try{await restoreLocalOutboxOverlay();'));
assert(desktopPlatform.includes("state:'stale-scope-captured',captured"));
assert(desktopPlatform.includes('dirtyGenerationAtStart=entityDirtyGeneration(expectedScope)'));
assert.match(windowsWorkflow,/node tests\/runtime-smoke\.mjs source\/application\/web critical-scope-guard\r?\n\s+if \(\$LASTEXITCODE -ne 0\) \{ throw 'Critical scope-guard regression failed\.' \}/);
assert.match(windowsWorkflow,/node tests\/runtime-smoke\.mjs source\/application\/web critical-crash-recovery\r?\n\s+if \(\$LASTEXITCODE -ne 0\) \{ throw 'Critical crash-recovery regression failed\.' \}/);
assert(desktopPlatform.includes("resultBox.textContent=userVisibleError(error,'Ссылка не создана')"));
assert(desktopPlatform.includes('if(!telegramProgressActive)return;'));
assert(desktopPlatform.includes('function clearTelegramProgress(){telegramProgressActive=false;'));
assert(routeWorkspace.includes("const filteredCards=()=>cards().filter"));
assert(routeWorkspace.includes("all.forEach(card=>{card.hidden=true})"));
assert(routeWorkspace.includes("jf:route-stage-filter-changed"));
assert(main.includes("document.dispatchEvent(new CustomEvent('jf:route-stage-filter-changed'))"));

const lifecycleLockSource=warehouses.match(/let warehouseLifecycleBusyV760=false;[\s\S]*?async function withWarehouseLifecycleLockV760\(action\)\{[\s\S]*?\n\}/)?.[0];
assert(lifecycleLockSource,'warehouse lifecycle lock source is available');
let lockAlerts=0;
const lockContext={alert(){lockAlerts++}};
vm.createContext(lockContext);
vm.runInContext(`${lifecycleLockSource}\nglobalThis.__withWarehouseLifecycleLock=withWarehouseLifecycleLockV760;`,lockContext);
let releaseFirst,actions=0;
const firstWarehouseAction=lockContext.__withWarehouseLifecycleLock(async()=>{actions++;return new Promise(resolve=>{releaseFirst=resolve})});
assert.equal(await lockContext.__withWarehouseLifecycleLock(async()=>{actions++;return'overlap'}),false);
assert.equal(actions,1,'a second warehouse mutation must not start while the first one is pending');
assert.equal(lockAlerts,1);
releaseFirst('confirmed');
assert.equal(await firstWarehouseAction,'confirmed');
await assert.rejects(lockContext.__withWarehouseLifecycleLock(async()=>{throw new Error('expected failure')}),/expected failure/);
assert.equal(await lockContext.__withWarehouseLifecycleLock(async()=>{actions++;return'next'}),'next','the lifecycle lock must always reset after success or failure');

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

console.log(JSON.stringify({ok:true,warehouseCatalogIsolation:true,warehouseSwitchPersistence:true,warehouseDualStorageMutations:true,serverDeletedWarehousesNotMerged:true,singleMapResizeObserver:true,deferredMapInitialization:true,moscowDistrictFallback:true,spbMunicipalDistrictFallback:true,driverAssignmentRequiresPlan:true,activeRoutePlanProtection:true}));
