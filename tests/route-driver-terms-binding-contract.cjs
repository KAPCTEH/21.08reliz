'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'../source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const platform=fs.readFileSync(path.resolve(__dirname,'../source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const between=(start,end)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from,`source block not found: ${start}`);
  return source.slice(from,to);
};

const assign=between('const assignDriverToRouteV55=','const clearRouteDriverV55=');
const clear=between('const clearRouteDriverV55=','const deleteDriverV55=');
for(const [name,block,delegate] of [['assign',assign,'assignDriverToRouteV55(routeId,driverId)'],['clear',clear,'clearRouteDriverV55()']]){
  assert.ok(block.includes(`return ${delegate}`),`${name} must delegate only to the route-driver assignment implementation`);
  for(const forbidden of ['resetRouteExecutorTerms(','recalculateRoutePayment(','persistRoutes('])assert.ok(!block.includes(forbidden),`${name} must not call ${forbidden}`);
}

const override=between('routeOverride__implV595=function(routeId){','const openRouteEditModalV55=');
assert.ok(override.includes("currentDriverId=String(routeDriverAssignments[routeId]||'')"),'override terms must use the currently assigned driver id');
assert.ok(override.includes("executorDriverId=String(raw.executorDriverId||providerSnapshot.driverId||'')"),'legacy providerSnapshot.driverId must remain a valid executor binding');
assert.ok(override.includes('executorMatches=Boolean(currentDriverId&&executorDriverId===currentDriverId)'),'empty or mismatched executor bindings must be rejected');
assert.ok(override.includes("driverPaymentMode:executorMatches?base.driverPaymentMode:'auto'"),'mismatched manual payment must fall back to auto');
assert.ok(override.includes('manualDriverPayment:executorMatches?base.manualDriverPayment:0'),'mismatched manual amount must fall back to zero');
for(const field of ['externalOrderNumber','externalTrackingUrl','externalNote'])assert.ok(override.includes(`${field}:executorMatches?String(raw.${field}||''):''`),`mismatched ${field} must be empty`);
assert.ok(override.includes('providerSnapshot:executorMatches?providerSnapshot:{}'),'mismatched provider snapshot must be empty');

const save=between('saveRouteEditSettings__implV595=async function(){','const startRouteV55=');
assert.ok(save.includes("executorDriverId:driver?.id||''"),'saved manual and external terms must bind to the current driver');
assert.match(platform,/assignDriverToRoute:\{kind:'route_driver_assign',critical:false,target:args=>args\[0\]\}/,'driver assignment must use one ordinary durable transaction keyed by route id');
assert.match(platform,/clearRouteDriver:\{kind:'route_driver_clear',critical:false,target:currentDriverRoute\}/,'driver removal must use one ordinary durable transaction keyed by route id');

console.log(JSON.stringify({ok:true,assignmentOnly:true,driverBoundTerms:true,legacyProviderBinding:true}));
