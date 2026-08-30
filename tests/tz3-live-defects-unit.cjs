'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function functionSource(source,name){
  const start=source.indexOf(`function ${name}`);assert(start>=0,`${name} missing`);let open=-1,paramDepth=0,signatureQuote='',signatureEscape=false;
  for(let index=start;index<source.length;index++){const char=source[index];if(signatureQuote){if(signatureEscape)signatureEscape=false;else if(char==='\\')signatureEscape=true;else if(char===signatureQuote)signatureQuote='';continue}if(char==='"'||char==="'"||char==='`'){signatureQuote=char;continue}if(char==='(')paramDepth++;else if(char===')')paramDepth--;else if(char==='{'&&paramDepth===0){open=index;break}}assert(open>=0,`${name} body missing`);let depth=0,quote='',escape=false;
  for(let index=open;index<source.length;index++){const char=source[index];if(quote){if(escape)escape=false;else if(char==='\\')escape=true;else if(char===quote)quote='';continue}if(char==='"'||char==="'"||char==='`'){quote=char;continue}if(char==='{')depth++;else if(char==='}'&&--depth===0)return source.slice(start,index+1)}throw new Error(`${name} is incomplete`)
}
async function main(){
const app=read('source/application/web/assets/js/00-app-bundle-v595.js');
const unitContext=vm.createContext({});vm.runInContext(`${functionSource(app,'canonicalCargoUnit')};${functionSource(app,'intrinsicCargoMetrics')};this.unit=canonicalCargoUnit;this.metrics=intrinsicCargoMetrics`,unitContext);
assert.equal(unitContext.unit('м3'),'м³');assert.equal(unitContext.metrics('м³').volumeM3,1);assert.equal(unitContext.metrics('кг').weightKg,1);assert.equal(unitContext.metrics('г').weightKg,.001);assert.equal(unitContext.metrics('л').volumeM3,.001);
const cargoContext=vm.createContext({console});vm.runInContext(`${functionSource(app,'cargoItemBodyFit')};this.testFit=cargoItemBodyFit`,cargoContext);
const fit=cargoContext.testFit;
assert.equal(fit({name:'Ровно 4 м',lengthM:4,widthM:1,heightM:1,orientation:'fixed'},{bodyLength:4,bodyWidth:2,bodyHeight:2,bodyType:'van'}).fits,true);
const tooLong=fit({name:'Длинномер',lengthM:4.2,widthM:1,heightM:1,orientation:'fixed'},{bodyLength:4,bodyWidth:2,bodyHeight:2,bodyType:'van'});assert.equal(tooLong.fits,false);assert.match(tooLong.reason,/4\s?200/);assert.match(tooLong.reason,/Равный габарит допускается/);
assert.equal(fit({name:'Со свесом',lengthM:4.2,widthM:1,heightM:1,orientation:'fixed'},{bodyLength:4,bodyWidth:2,bodyHeight:2,bodyType:'board',allowedOverhangMm:200}).fits,true);
const gateContext=vm.createContext({asArray:value=>Array.isArray(value)?value:[]});vm.runInContext(`${functionSource(app,'directorManagementGate')};this.gate=directorManagementGate`,gateContext);
assert.equal(gateContext.gate({reliabilityScore:50,actions:[]}).tone,'bad');
assert.equal(gateContext.gate({reliabilityScore:95,actions:[{priority:'high'},{priority:'high'}]}).tone,'bad');
assert.equal(gateContext.gate({reliabilityScore:80,actions:[]}).tone,'warn');
assert.equal(gateContext.gate({reliabilityScore:95,actions:[]}).tone,'good');
const route=read('source/application/web/assets/js/90-route-engine.js'),routeContext=vm.createContext({asArray:value=>Array.isArray(value)?value:[],routeLifecycleV560:def=>({code:def.code})});vm.runInContext(`${functionSource(route,'buildOutcomeCounts')};this.counts=buildOutcomeCounts`,routeContext);
assert.deepEqual(JSON.parse(JSON.stringify(routeContext.counts([{code:'ready'},{code:'needs_action'},{code:'draft'}]))),{ready:1,problems:1,drafts:1});
const finalizeSource=functionSource(route,'calculateFinalizeV570');
assert.match(finalizeSource,/plan\.lifecycleStatus=finalization\.safe\?'ready_to_release':'needs_decision'/);
assert.match(finalizeSource,/if\(finalization\.safe\)\{freezeRouteOrders\(def\);markRouteWarehouseReserved\(def\)\}/);
async function finalizeProbe(safe){
  const calls=[],context=vm.createContext({calculateRoute:async()=>({orderedIds:['order-1']}),routeFinalizationState:()=>({safe,reasons:safe?[]:['review'],warnings:[],stockShortages:[],hardReasons:[]}),clone:value=>structuredClone(value),settings:{smartRoute:{autoSplitOverload:true}},routePlans:{},freezeRouteOrders:def=>calls.push(['freeze',def.id]),markRouteWarehouseReserved:def=>{def.orders[0].warehouseFlowStatus='reserved';calls.push(['reserve',def.id])},releaseRouteLocks:def=>calls.push(['release',def.id]),persistRoutes:()=>calls.push(['persist'])});
  vm.runInContext(`async ${finalizeSource};this.finalize=calculateFinalizeV570`,context);const def={id:'route-1',orders:[{id:'order-1',warehouseFlowStatus:'planned'}]};await context.finalize(def,false,0);return{calls,plan:context.routePlans['route-1'],order:def.orders[0]}
}
const safeFinalize=await finalizeProbe(true);assert.equal(safeFinalize.plan.lifecycleStatus,'ready_to_release');assert.match(safeFinalize.plan.lifecycleUpdatedAt,/^\d{4}-\d{2}-\d{2}T/);assert.equal(safeFinalize.order.warehouseFlowStatus,'reserved');assert.deepEqual(safeFinalize.calls,[['freeze','route-1'],['reserve','route-1'],['persist']]);
const unsafeFinalize=await finalizeProbe(false);assert.equal(unsafeFinalize.plan.lifecycleStatus,'needs_decision');assert.equal(unsafeFinalize.order.warehouseFlowStatus,'planned');assert.deepEqual(unsafeFinalize.calls,[['release','route-1'],['persist']]);
assert.match(route,/function snapshotState\(\)\{return\{orders:clone\(orders\)/);
assert.match(route,/function restoreState\(s\)\{orders=s\.orders;/);
const rollbackCalls=[],rollbackContext=vm.createContext({structuredClone,orders:[{id:'order-1',warehouseFlowStatus:'planned'}],routeAssignments:{},routeCatalog:{},routeDriverAssignments:{},routeLocks:{},routePlans:{},routeOverrides:{},clone:value=>structuredClone(value),persistOrders:()=>rollbackCalls.push('orders'),persistRouteAssignments:()=>{},persistRouteDrivers:()=>{},persistRouteLocks:()=>{},persistRoutes:()=>{},persistRouteOverrides:()=>{}});vm.runInContext(`${functionSource(route,'snapshotState')};${functionSource(route,'restoreState')};this.snapshot=snapshotState;this.restore=restoreState`,rollbackContext);const rollbackSnapshot=rollbackContext.snapshot();rollbackContext.orders[0].warehouseFlowStatus='reserved';rollbackContext.restore(rollbackSnapshot);assert.equal(rollbackContext.orders[0].warehouseFlowStatus,'planned');assert.deepEqual(rollbackCalls,['orders']);
const branding=read('source/application/web/assets/js/100-multi-warehouse-v600.js'),clarity=read('source/application/web/assets/css/140-clarity-redesign-v783.css'),preload=read('source/application/preload.js'),main=read('source/application/main.js');
const snapshotIdentifierContext=vm.createContext({});vm.runInContext(`${functionSource(main,'validateSnapshotEntityIdentifiers')};${functionSource(branding,'validateSafeSnapshotIdentifiersV783')};this.validators=[validateSnapshotEntityIdentifiers,validateSafeSnapshotIdentifiersV783]`,snapshotIdentifierContext);
for(const validateSnapshotIds of snapshotIdentifierContext.validators){
  assert.doesNotThrow(()=>validateSnapshotIds({orders:[{id:'order_safe_1',geo:{addressId:'nominatim:relation:20269374'},productId:'product_safe_1'}],routeCatalog:{route_safe_1:{id:'route_safe_1'}}}));
  assert.throws(()=>validateSnapshotIds({orders:[{id:'order:sneaky'}]}),/небезопасный идентификатор/i);
  assert.throws(()=>validateSnapshotIds({orders:[{id:'order_safe_1',productId:'product:sneaky'}]}),/небезопасный идентификатор/i);
  assert.throws(()=>validateSnapshotIds({orders:[{id:'order_safe_1',addressId:'nominatim:relation:<unsafe>'}]}),/небезопасный идентификатор/i);
  assert.throws(()=>validateSnapshotIds({orders:[{id:'order_safe_1',addressId:`nominatim:${'a'.repeat(191)}`}]}),/небезопасный идентификатор/i);
  assert.throws(()=>validateSnapshotIds({routeCatalog:{'route:sneaky':{id:'route_safe_1'}}}),/небезопасный ключ/i);
}
assert.match(branding,/logo-center-v600/);assert.match(branding,/lastBackupKind/);assert.match(branding,/safety\?\.confirmed/);assert.match(read('source/application/web/assets/js/98-smart-automation-v598.js'),/lastBackupKind:settings\.program\?\.lastBackupKind/);
assert.match(branding,/JustFunSmartProgramV783\?\.renderHealth/);assert.match(read('source/application/web/assets/js/98-smart-automation-v598.js'),/JustFunSmartProgramV783=Object\.freeze/);
assert.match(branding,/logo\.style\.setProperty\('display','none','important'\)/);assert.match(app,/Самовывоз подготовлен: товар зарезервирован на складе/);assert.match(app,/По вашему запросу ничего не найдено/);assert.match(app,/confirmManualGeoAddress/);assert.match(app,/Координаты и показанный водителю адрес будут сохранены только вместе/);assert.match(app,/aria-expanded="false">Параметры груза/);
const claritySource=read('source/application/web/assets/js/140-clarity-redesign-v783.js');assert.match(claritySource,/window\.scrollTo\(0,0\)/);assert.doesNotMatch(claritySource,/viewScrollV783/);assert.match(claritySource,/\[data-manual-unit\]'\)\.value='шт'/);
assert.match(clarity,/\.clarity-check>input\[type="checkbox"\][^{]*\{[^}]*appearance:auto/);assert.match(clarity,/accent-color:var\(--jf-color-brand-500\)/);assert.match(preload,/desktop:backup-save/);assert.match(main,/backup file verified/);
assert.match(read('source/application/web/assets/css/110-desktop-platform-v750.css'),/@media\(max-width:1320px\)\{\.nav\{grid-template-columns:1fr!important\}/);assert.match(clarity,/\.director-professional-v610 \.director-toolbar\{grid-template-columns:minmax\(0,1fr\)\}/);assert.match(clarity,/\.nav \.actions\{display:flex;flex-wrap:wrap\}/);
assert.match(preload,/previewPdf:[^\n]+desktop:document-preview-pdf/);assert.match(main,/desktop:document-preview-pdf/);assert.match(main,/event\.sender\.printToPDF/);assert.match(main,/PDF не содержит проверяемого текстового слоя/);assert.match(main,/неверная ориентация PDF/);assert.match(app,/JustFunDesktop\?\.documents\?\.previewPdf/);assert.match(app,/finally\{\$\('printArea'\)\.style\.display='none'\}/);assert.doesNotMatch(read('source/application/web/assets/js/92-route-cleanup.js'),/doPrint\s*=|window\.print/);
const desktopPlatform=read('source/application/web/assets/js/110-desktop-platform-v750.js');assert.match(preload,/desktop:audit-event/);assert.match(main,/renderer business audit/);assert.match(main,/safeRendererAuditPayload/);assert.match(desktopPlatform,/business_mutation_started/);assert.match(desktopPlatform,/business_mutation_confirmed/);assert.match(desktopPlatform,/business_mutation_rejected/);assert.match(desktopPlatform,/correlationId/);
assert.match(desktopPlatform,/buildSingleRoute:'routes\.plan'/);
const trustBootstrap=read('tools/release/bootstrap-update-trust.mjs');assert.match(trustBootstrap,/whoami\.exe/);assert.match(trustBootstrap,/icacls\.exe/);assert.match(trustBootstrap,/\*S-1-5-18:\(F\)/);assert.match(trustBootstrap,/fs\.rmSync\(privateKeyPath/);
console.log(JSON.stringify({ok:true,routeCounters:true,reportGate:true,bodyBoundary:true,backupConfirmation:true,autosaveControl:true,brandingPosition:true,cargoUnits:true,addressPairing:true,pickupLockText:true,filteredDriverState:true,viewScrollReset:true,responsiveCommandSurface:true,nativePdfPreview:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
