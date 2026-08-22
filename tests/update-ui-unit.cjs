'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'source/application/web/index.html'),'utf8');
const source=fs.readFileSync(path.join(root,'source/application/web/assets/js/111-update-center-v783.js'),'utf8');
const css=fs.readFileSync(path.join(root,'source/application/web/assets/css/130-experience-refresh-v783.css'),'utf8');
const mainSource=fs.readFileSync(path.join(root,'source/application/main.js'),'utf8');
let checks=0;
const checked=fn=>{fn();checks+=1};

async function main(){
  checked(()=>assert(index.includes('id="jfUpdateCenter"')));
  checked(()=>assert(index.includes('id="jfUpdateCheck"')));
  checked(()=>assert(index.includes('id="jfUpdateDownload"')));
  checked(()=>assert(index.includes('id="jfUpdateApply"')));
  checked(()=>assert(index.includes('assets/js/111-update-center-v783.js')));
  checked(()=>assert(index.includes('assets/css/130-experience-refresh-v783.css')));
  checked(()=>assert(source.includes("typeof window.jfConfirm!=='function'")));
  checked(()=>assert(source.includes('UPDATE_SIGNATURE_INVALID')));
  checked(()=>assert(source.includes("root.dataset.updateReady='1'")));
  checked(()=>assert(css.includes('@media(max-width:720px)')));
  checked(()=>assert(mainSource.includes("const box=document.querySelector('#jfUpdateCenter');const toggle=box?.querySelector(':scope > .settings-accordion-toggle-v610')")));
  checked(()=>assert(mainSource.includes("#jfUpdateCenter[data-update-ready=\\\"1\\\"]')?.classList.contains('open')")));

  const fixture=`<!doctype html><html><body><section id="jfUpdateCenter"><span id="jfUpdateBadge"></span><b id="jfUpdateCurrentVersion"></b><b id="jfUpdateTargetVersion"></b><b id="jfUpdateChannel"></b><div id="jfUpdateStatus"></div><div id="jfUpdateProgress" hidden><span id="jfUpdateProgressText"></span><b id="jfUpdateProgressPercent"></b><div id="jfUpdateProgressTrack"><i id="jfUpdateProgressBar"></i></div></div><button id="jfUpdateCheck"></button><button id="jfUpdateDownload"></button><button id="jfUpdateApply"></button></section></body></html>`;
  const dom=new JSDOM(fixture,{runScripts:'outside-only',url:'https://justfun.local/web/index.html'}),{window}=dom;
  let status={enabled:true,channel:'stable',currentVersion:'7.8.3',state:'IDLE',targetVersion:null,error:null,rollback:null};
  let statusHandler=null,confirmationCount=0,applyCount=0;
  window.JustFunDesktop={updates:{
    status:async()=>({ok:true,...status}),
    check:async()=>{status={...status,state:'UPDATE_AVAILABLE',targetVersion:'7.9.0'};return{ok:true,updateAvailable:true,version:'7.9.0',status}},
    download:async()=>{status={...status,state:'READY_TO_APPLY'};return{ok:true,version:'7.9.0',status}},
    apply:async()=>{applyCount+=1;status={...status,state:'APPLYING'};return{ok:true,scheduled:true,status}},
    onStatus:handler=>{statusHandler=handler;return()=>{statusHandler=null}}
  }};
  window.jfConfirm=async()=>{confirmationCount+=1;return true};
  window.eval(source);
  const center=window.JustFunUpdateCenterV783;
  await center.install();
  const byId=id=>window.document.getElementById(id);
  checked(()=>assert.equal(byId('jfUpdateCurrentVersion').textContent,'7.8.3'));
  checked(()=>assert.equal(byId('jfUpdateChannel').textContent,'Стабильный'));
  checked(()=>assert.equal(byId('jfUpdateCheck').disabled,false));
  checked(()=>assert.equal(byId('jfUpdateDownload').disabled,true));
  checked(()=>assert.equal(byId('jfUpdateApply').disabled,true));
  checked(()=>assert.equal(typeof statusHandler,'function'));

  const available=await center.check();
  checked(()=>assert.equal(available.updateAvailable,true));
  checked(()=>assert.equal(byId('jfUpdateTargetVersion').textContent,'7.9.0'));
  checked(()=>assert.equal(byId('jfUpdateDownload').disabled,false));
  checked(()=>assert.match(byId('jfUpdateStatus').textContent,/Найдена версия 7\.9\.0/));

  statusHandler({...status,state:'DOWNLOADING',progress:{receivedBytes:5242880,totalBytes:10485760}});
  checked(()=>assert.equal(byId('jfUpdateProgress').hidden,false));
  checked(()=>assert.equal(byId('jfUpdateProgressPercent').textContent,'50%'));
  checked(()=>assert.equal(byId('jfUpdateProgressTrack').getAttribute('aria-valuenow'),'50'));
  checked(()=>assert.equal(byId('jfUpdateProgressBar').style.width,'50%'));
  checked(()=>assert.equal(byId('jfUpdateCheck').disabled,true));

  const downloaded=await center.download();
  checked(()=>assert.equal(downloaded.ok,true));
  checked(()=>assert.equal(byId('jfUpdateApply').disabled,false));
  checked(()=>assert.match(byId('jfUpdateStatus').textContent,/полностью проверена/));

  const applied=await center.apply();
  checked(()=>assert.equal(applied.scheduled,true));
  checked(()=>assert.equal(confirmationCount,1));
  checked(()=>assert.equal(applyCount,1));
  checked(()=>assert.equal(byId('jfUpdateBadge').textContent,'Установка'));

  center.render({enabled:true,channel:'stable',currentVersion:'7.8.3',state:'FAILED',error:{code:'UPDATE_SIGNATURE_INVALID',message:'raw internal text'}},'');
  checked(()=>assert.match(byId('jfUpdateStatus').textContent,/Цифровая подпись/));
  checked(()=>assert.doesNotMatch(byId('jfUpdateStatus').textContent,/raw internal text/));
  center.render({enabled:false,channel:'stable',currentVersion:'7.8.3',state:'IDLE'},'');
  checked(()=>assert.equal(byId('jfUpdateBadge').textContent,'Не подключено'));
  checked(()=>assert.equal(byId('jfUpdateCheck').disabled,true));
  checked(()=>assert.match(byId('jfUpdateStatus').textContent,/ещё не подключены/));
  center.dispose();dom.window.close();
  console.log(JSON.stringify({ok:true,checks,states:true,progress:true,confirmation:true,failClosed:true,accessibleStatus:true}));
}

main().catch(error=>{console.error(error);process.exitCode=1});
