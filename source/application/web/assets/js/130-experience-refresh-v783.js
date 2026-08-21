/* JustFun 7.8.3 — guided demonstration and final interaction polish */
(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const steps=[
  {id:'orders',view:'orders',title:'Заказы, оплата и жизненный цикл',text:'Откройте несколько учебных заказов. В базе показаны доставка и самовывоз, ожидание оплаты, частичная доставка, повторная попытка, отмена, выдача и архив.',check:'Проверьте фильтры статусов, карточку заказа, историю изменений и расчёт итоговой суммы.'},
  {id:'products',view:'products',title:'Склад, товары и комплектация',text:'Сравните физический остаток, резерв и доступное количество. Откройте товар, движения склада и подбор позиции в новом заказе.',check:'Проверьте поступление, расход, списание, минимальный остаток и предупреждение о нехватке.'},
  {id:'trips',view:'trips',title:'Рейсы от планирования до закрытия',text:'В учебной базе есть готовый рейс, рейс в пути и рейс, ожидающий закрытия. Система подбирает подходящий автомобиль по весу и объёму.',check:'Откройте состав рейса, карту, водителя, расчёт доставки и форму фактического результата каждой точки.'},
  {id:'drivers',view:'drivers',title:'Водители, автомобили и оплата',text:'Показаны собственные водители, разные кузова и внешние агрегаторы. Для каждого профиля доступны ограничения транспорта и правила оплаты.',check:'Сверьте грузоподъёмность, объём кузова, индивидуальный тариф и привязку Telegram.'},
  {id:'reports',view:'reports',title:'Финансы и отчёт руководителя',text:'Учебный месяц включает продажи, себестоимость, доставку, зарплаты, налоги и постоянные/разовые расходы.',check:'Меняйте период и фильтры, сравните прибыль, проблемные заказы и экспорт отчёта.'},
  {id:'documents',view:'orders',title:'Документы, логотип и печать',text:'Открыта учебная карточка заказа. Проверьте счёт, печатную форму заказа, маршрутный лист и сохранение фирменного оформления.',check:'Логотип и реквизиты должны быть читаемы в предварительном просмотре; отмена печати не изменяет данные.'}
];
let current=0,completed=new Set();
function demoActive(){try{return typeof isDemonstrationMode==='function'&&isDemonstrationMode()}catch{return document.body.classList.contains('demo-mode')}}
function tourKey(){let warehouse='default';try{warehouse=window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.id||warehouse}catch{}return`jf.demo-tour.v783.${warehouse}`}
function loadProgress(){try{const raw=JSON.parse(localStorage.getItem(tourKey())||'{}');current=Math.max(0,Math.min(steps.length-1,Number(raw.current)||0));completed=new Set(Array.isArray(raw.completed)?raw.completed:[])}catch{current=0;completed=new Set()}}
function saveProgress(){try{localStorage.setItem(tourKey(),JSON.stringify({current,completed:[...completed],updatedAt:new Date().toISOString()}))}catch{}}
function counts(){try{return{orders:Array.isArray(orders)?orders.length:0,products:Array.isArray(products)?products.length:0,drivers:Array.isArray(drivers)?drivers.length:0,routes:routeCatalog&&typeof routeCatalog==='object'?Object.keys(routeCatalog).length:0,archives:Array.isArray(routeArchives)?routeArchives.length:0}}catch{return{orders:0,products:0,drivers:0,routes:0,archives:0}}}
function runAudit(showDetails=false){
  const badge=byId('demoAuditBadge'),card=byId('demoGuideCard');if(!badge)return null;
  if(!demoActive()){badge.className='demo-audit-badge';badge.textContent='DEMO выключен';return null}
  let audit;try{audit=typeof auditDemonstrationScenario==='function'?auditDemonstrationScenario():null}catch(error){audit={ok:false,errors:[String(error?.message||error)]}}
  const c=counts(),ok=!!audit?.ok;badge.className=`demo-audit-badge ${ok?'ok':'error'}`;badge.textContent=ok?`Проверено: ${c.orders} заказов · ${c.products} товаров`:`Найдены ошибки: ${audit?.errors?.length||1}`;
  if(showDetails&&card){card.hidden=false;card.innerHTML=ok?`<b>Учебная база прошла полную самопроверку</b><p>${c.orders} заказов, ${c.products} товаров, ${c.drivers} водителей, ${c.routes} рабочих рейсов и ${c.archives} закрытых рейсов. Проверены идентификаторы, связи заказов с рейсами и водителями, все ключевые статусы, остатки и складские движения.</p>`:`<b>Учебную базу нужно пересоздать</b><p>${(audit?.errors||['Неизвестная ошибка']).map(String).join(' · ')}</p><div class="inline-actions"><button class="btn-warn" type="button" data-demo-repair>Пересоздать DEMO</button></div>`;card.querySelector('[data-demo-repair]')?.addEventListener('click',()=>window.restartDemonstrationScenario?.())}
  return audit
}
function renderTour(){
  const root=byId('demoScenarioCenter');if(!root)return;const active=demoActive();root.querySelectorAll('[data-demo-step]').forEach((button,index)=>{button.classList.toggle('active',active&&index===current);button.classList.toggle('done',completed.has(steps[index].id));button.setAttribute('aria-current',active&&index===current?'step':'false')});
  const pct=active?Math.round(completed.size/steps.length*100):0,bar=byId('demoScenarioProgress');if(bar)bar.style.width=`${pct}%`;const cont=byId('demoTourContinue');if(cont)cont.textContent=completed.size?`Продолжить: шаг ${current+1} из ${steps.length}`:'Продолжить с текущего шага';runAudit(false)
}
function showStep(index,{completePrevious=false}={}){
  if(!demoActive()){const toggle=byId('demoModeToggle');if(toggle)toggle.checked=true;window.requestDemonstrationMode?.(true);setTimeout(()=>{if(demoActive())showStep(index)},120);return}
  if(completePrevious&&steps[current])completed.add(steps[current].id);current=Math.max(0,Math.min(steps.length-1,index));const step=steps[current];saveProgress();window.showView?.(step.view);
  if(step.id==='documents'){try{const sample=Array.isArray(orders)?orders.find(order=>order&&!order.archived)||orders[0]:null;if(sample&&typeof openDetails==='function')setTimeout(()=>openDetails(sample.id),80)}catch{}}
  const card=byId('demoGuideCard');if(card){card.hidden=false;card.innerHTML=`<b>Шаг ${current+1} из ${steps.length}: ${step.title}</b><p>${step.text}</p><p><strong>Что проверить:</strong> ${step.check}</p><div class="inline-actions"><button class="btn-primary" type="button" data-demo-next>${current===steps.length-1?'Завершить экскурсию':'Готово, следующий шаг'}</button><button class="btn-gray" type="button" data-demo-back ${current===0?'disabled':''}>Предыдущий шаг</button></div>`;card.querySelector('[data-demo-next]')?.addEventListener('click',()=>{completed.add(step.id);if(current===steps.length-1){saveProgress();renderTour();runAudit(true);card.scrollIntoView({behavior:'smooth',block:'nearest'});return}showStep(current+1)});card.querySelector('[data-demo-back]')?.addEventListener('click',()=>showStep(current-1))}
  renderTour();document.querySelector(`[data-demo-step="${step.id}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'})
}
function installTour(){
  const root=byId('demoScenarioCenter');if(!root||root.dataset.bound==='1')return;root.dataset.bound='1';loadProgress();root.querySelectorAll('[data-demo-step]').forEach((button,index)=>button.addEventListener('click',()=>showStep(index)));byId('demoTourStart')?.addEventListener('click',()=>{completed.clear();showStep(0)});byId('demoTourContinue')?.addEventListener('click',()=>showStep(current));byId('demoRunAudit')?.addEventListener('click',()=>runAudit(true));renderTour()
}
window.JustFunOverrides.wrap('syncDemonstrationModeUI','experience-refresh-v783',baseSync=>function(){const result=baseSync?.apply(this,arguments);queueMicrotask(()=>{loadProgress();renderTour()});return result});
window.JustFunOverrides.wrap('restartDemonstrationScenario','experience-refresh-v783',baseRestart=>function(){const result=baseRestart?.apply(this,arguments);setTimeout(()=>{completed.clear();current=0;saveProgress();renderTour();runAudit(true)},80);return result});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installTour,{once:true});else installTour();
window.JustFunExperienceV783=Object.freeze({version:'7.8.3',steps:steps.map(item=>({...item})),audit:runAudit,openStep:showStep});
})();
