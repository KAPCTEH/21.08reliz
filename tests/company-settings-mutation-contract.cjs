'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'../source/application/web/assets/js/100-multi-warehouse-v600.js'),'utf8');
const platform=fs.readFileSync(path.resolve(__dirname,'../source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const save=between('window.saveCompanySettingsV600=function(){','window.chooseCompanyLogoV600=');
const load=between('window.loadCompanyLogoV600=function(event){','window.removeCompanyLogoV600=');
const remove=between('window.removeCompanyLogoV600=function(){','let warehouseEditorMapV600=');

assert.match(source,/function persistCompanySettingsV600\(\)\{[\s\S]*?persistSettings\(\)===false[\s\S]*?applyBranding\(\);renderCompanySettings\(\);return true/,'company persistence must fail closed before reporting a successful mutation');
assert.match(save,/settings\.company=\{[\s\S]*?persistCompanySettingsV600\(\)/,'company form mutation must persist inside its guarded function');
assert.match(load,/return new Promise\(\(resolve,reject\)=>\{/,'logo loading must keep the entity guard open until asynchronous work completes');
const readerLoad=load.indexOf('reader.onload=()=>{'),imageLoad=load.indexOf('img.onload=()=>{'),mutation=load.indexOf('settings.company.logoDataUrl=encoded'),persist=load.indexOf('persistCompanySettingsV600()'),resolved=load.indexOf('resolve(true)');
assert.ok(readerLoad>=0&&imageLoad>readerLoad&&mutation>imageLoad&&persist>mutation&&resolved>persist,'FileReader and image decoding must complete before mutation, persistence and guard resolution');
assert.ok(load.indexOf('reader.readAsDataURL(file)')>load.indexOf('return new Promise'),'file reading must start inside the Promise observed by the entity guard');
assert.match(remove,/settings\.company\.logoDataUrl='';persistCompanySettingsV600\(\);return true/,'logo removal must persist inside its guarded function');
for(const name of ['saveCompanySettingsV600','loadCompanyLogoV600','removeCompanyLogoV600']){
  assert.match(platform,new RegExp(`${name}:'company\\.update'`),`${name} must require company.update`);
  assert.match(platform,new RegExp(`${name}:\\{kind:'company_`),`${name} must run through the durable entity command guard`);
}

console.log(JSON.stringify({ok:true,companySettingsGuarded:true,logoReaderAwaited:true}));
