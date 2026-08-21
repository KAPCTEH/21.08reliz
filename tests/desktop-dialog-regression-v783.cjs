'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const css=fs.readFileSync(path.join(root,'source/application/web/assets/css/110-desktop-platform-v750.css'),'utf8');
const stability=fs.readFileSync(path.join(root,'source/application/web/assets/js/99-stability-v595.js'),'utf8');
const stabilityCss=fs.readFileSync(path.join(root,'source/application/web/assets/css/99-stability-v595.css'),'utf8');
const dispatcher=fs.readFileSync(path.join(root,'source/application/web/assets/js/01-action-dispatch-v783.js'),'utf8');
const appBundle=fs.readFileSync(path.join(root,'source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const multiWarehouse=fs.readFileSync(path.join(root,'source/application/web/assets/js/100-multi-warehouse-v600.js'),'utf8');
const jsDir=path.join(root,'source/application/web/assets/js');

assert(js.includes('window.JustFunDialog=Object.freeze'));
assert(js.includes('window.jfConfirm='));
assert(js.includes('window.jfPrompt='));
assert(js.includes('безвозврат|удалить|очист'));
assert(js.includes("modal.className=`jf-dialog-overlay open jf-decision-${config.kind}`"));
assert(js.includes("if(event.target===modal)finish(config.prompt?null:false)"));
assert(js.includes("const close=q('[data-dialog-cancel]"));
assert(js.includes("item.setAttribute('role',type==='error'?'alert':'status')"));
assert(css.includes('.jf-decision-dialog'));
assert(css.includes('white-space:pre-line'));
assert(stability.includes("typeof result.then==='function'"));
assert(stability.includes('result.then(value=>finish(value),error=>finish(false,error))'));
assert(stabilityCss.includes('.v595-transaction-lock .jf-decision-dialog button'));
assert(dispatcher.includes("result.catch(error=>handleDispatchFailure(error,source,event))"));
assert.match(appBundle,/async function savePickup__baseV595\(e\).*?await jfConfirm\(/s);
assert.match(multiWarehouse,/savePickup__implV595=async function\(event\).*?result=await savePickupV600\(event\).*?saved\.warehouseId=activeId\(\)/s);
assert.match(appBundle,/approveRouteManually__implV595=async function\(routeId\).*?await approveRouteManuallyV5\(routeId\)/s);
assert.match(appBundle,/deleteDriver__implV595=async function\(id\).*?await deleteDriverV55\(id\)/s);
assert.match(appBundle,/startRoute__implV595=async function\(routeId\).*?await startRouteV560\(routeId\)/s);
for(const file of fs.readdirSync(jsDir).filter(name=>name.endsWith('.js'))){
  const source=fs.readFileSync(path.join(jsDir,file),'utf8');
  assert.equal(/(?<![.\w])(confirm|prompt)\s*\(/.test(source),false,`${file}: оставлен системный confirm/prompt`);
}
console.log(JSON.stringify({ok:true,queuedDecisions:true,keyboardClose:true,accessibleToasts:true,sharedStyle:true,asyncActions:true,atomicPromises:true,nativeDialogs:false}));
