/* JustFun Orders & Logistics 7.8.3 — regression recovery, feature-preservation gates and safer interaction states */
(()=>{
'use strict';
const BUILD=String(window.JustFunDesktop?.version||(typeof APP_VERSION==='string'?APP_VERSION:'7.8.4'));
const byId=id=>document.getElementById(id);
const q=(sel,root=document)=>root.querySelector(sel);
const qa=(sel,root=document)=>[...root.querySelectorAll(sel)];
const num=v=>Number.isFinite(Number(v))?Number(v):0;

/* ---------- Product workspace: remove misleading duplicate action ---------- */
function repairProductActionsV611(){
  qa('#productsArea button').forEach(button=>{
    const text=button.textContent.trim();
    if(text==='Настроить учёт'||text==='Настроить учет'){button.remove();return;}
    if(text==='Изменить'||text==='Редактировать')button.textContent='Редактировать товар';
  });
  qa('.product-card-v610 footer').forEach(footer=>footer.dataset.actions=String(footer.querySelectorAll('button').length));
}
try{const base=renderProducts__implV595;renderProducts__implV595=function(){const result=base.apply(this,arguments);repairProductActionsV611();return result;};}catch{}

/* ---------- Individual driver payment belongs only to the driver card ---------- */
function hideLegacyDriverPaymentSettingsV611(){
  qa('.driver-payment-settings-box,.driver-payment-moved-box').forEach(box=>{box.hidden=true;box.dataset.hiddenByV611='1';});
}
function assignedDriverV611(routeId){try{return typeof assignedDriverForRoute==='function'?assignedDriverForRoute(routeId):null}catch{return null}}
function manualPaymentRequiredV611(driver){return !!driver&&driver.workerType!=='aggregator'&&driver.paymentProfile?.enabled===false;}
try{
  const base=driverPaymentForDriver;
  driverPaymentForDriver=function(plan,stopCount,driver,respectOverride=true){
    const result=base.apply(this,arguments),override=plan?.id&&respectOverride&&typeof routeOverride==='function'?routeOverride(plan.id):null;
    if(manualPaymentRequiredV611(driver)&&override?.driverPaymentMode!=='manual')return{...result,total:0,items:[],activeRuleCount:0,requiresManual:true,summary:'Для этого водителя сумма вводится вручную в каждом рейсе'};
    return result;
  };
}catch{}
function enforceRoutePaymentUiV611(){
  const routeId=byId('routeEditId')?.value,driver=assignedDriverV611(routeId),required=manualPaymentRequiredV611(driver),auto=q('[name="routeDriverPayMode"][value="auto"]'),manual=q('[name="routeDriverPayMode"][value="manual"]');
  if(auto){auto.disabled=required;auto.closest('label')?.classList.toggle('disabled-option-v611',required);}
  if(required&&manual){manual.checked=true;const field=byId('routeManualPayField');if(field)field.style.display='block';const preview=byId('routeAutoPayPreview');if(preview)preview.innerHTML=`<b>Автоматический расчёт выключен в карточке водителя.</b><br>Укажите фактическую оплату для этого рейса.`;const title=byId('routePaySectionTitle');if(title)title.textContent='Оплата водителю — ручной ввод';}
}
try{const base=openRouteEditModal__implV595;openRouteEditModal__implV595=function(){const result=base.apply(this,arguments);enforceRoutePaymentUiV611();return result;};}catch{}
try{const base=syncRouteEditPayMode__implV595;syncRouteEditPayMode__implV595=function(){const result=base.apply(this,arguments);enforceRoutePaymentUiV611();return result;};}catch{}
try{const base=saveRouteEditSettings__implV595;saveRouteEditSettings__implV595=async function(){const routeId=byId('routeEditId')?.value,driver=assignedDriverV611(routeId),required=manualPaymentRequiredV611(driver),manual=q('[name="routeDriverPayMode"]:checked')?.value==='manual',amount=num(byId('routeManualDriverPay')?.value);if(required&&(!manual||amount<=0)){alert('Для этого водителя автоматический расчёт выключен. Укажите фактическую оплату за рейс.');enforceRoutePaymentUiV611();byId('routeManualDriverPay')?.focus();return}return base.apply(this,arguments);};}catch{}
try{const base=startRoute__implV595;startRoute__implV595=function(routeId){const driver=assignedDriverV611(routeId),override=typeof routeOverride==='function'?routeOverride(routeId):{},required=manualPaymentRequiredV611(driver);if(required&&(override.driverPaymentMode!=='manual'||num(override.manualDriverPayment)<=0)){alert('Перед выездом укажите фактическую оплату водителю в разделе «Изменить рейс».');openRouteEditModal(routeId);return}return base.apply(this,arguments);};}catch{}

/* ---------- Settings accordions: preserve every original action and control ---------- */
function repairSettingsActionsV611(){
  hideLegacyDriverPaymentSettingsV611();
  qa('.settings-accordion-v610').forEach(box=>{
    if(box.hidden)return;const body=q(':scope > .settings-accordion-body-v610',box);if(!body)return;
    qa(':scope > .warehouse-section-head,:scope > .demo-settings-head,:scope > .driver-payment-head',body).forEach(head=>{
      head.classList.add('settings-actions-head-v611');const copy=head.querySelector(':scope > div:first-child,.demo-settings-title');if(copy)copy.classList.add('settings-actions-copy-v611');
    });
    if(box.classList.contains('company-settings-box')){
      const saveButton=q('.warehouse-section-head button[data-jf-onclick*="saveCompanySettingsV600"]',body);
      if(saveButton&&saveButton.textContent.trim()!=='Сохранить оформление')saveButton.textContent='Сохранить оформление';
    }
  });
}
function openAccordionForV611(selector){
  const target=q(selector);if(!target)return false;const box=target.classList.contains('settings-accordion-v610')?target:target.closest('.settings-accordion-v610');if(!box)return false;const toggle=q(':scope > .settings-accordion-toggle-v610',box),body=q(':scope > .settings-accordion-body-v610',box);if(!box.classList.contains('open'))toggle?.click();setTimeout(()=>box.scrollIntoView({behavior:'smooth',block:'start'}),80);return true;
}
window.openProgramSettingsSectionV611=function(selector){showView('programSettings');setTimeout(()=>openAccordionForV611(selector),80);};
function repairWarehouseChipV611(){const chip=byId('activeWarehouseChip');if(chip)chip.onclick=()=>window.openProgramSettingsSectionV611('.warehouse-manager-box');}
function repairDemoChipV611(){const chip=byId('demoModeChip');if(chip)chip.onclick=()=>window.openProgramSettingsSectionV611('.demo-settings-box');}

/* ---------- Version and feature-preservation status ---------- */
function updateVersionV611(){
  const title=`JustFun Логистика · ${BUILD}`;if(document.title!==title)document.title=title;
  const status=byId('diagnosticStatus'),text=`Версия системы: ${BUILD} · складская изоляция, LIVE/DEMO, ручная оплата рейса и сохранность действий интерфейса проверяются при запуске.`;if(status&&status.textContent!==text)status.textContent=text;
}
function repairAllV611(){repairProductActionsV611();repairSettingsActionsV611();repairWarehouseChipV611();repairDemoChipV611();hideLegacyDriverPaymentSettingsV611();updateVersionV611();}
function initV611(){repairAllV611();let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;repairAllV611();});});observer.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(initV611,30),{once:true});else setTimeout(initV611,30);
window.TeplitsaRegressionRecoveryV611=Object.freeze({version:BUILD,refresh:repairAllV611,openSettings:openAccordionForV611});
})();
