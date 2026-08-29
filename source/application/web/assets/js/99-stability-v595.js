/* Teplitsa78 5.9.5 — final local stability, transaction, accessibility and QA layer */
(function(){
'use strict';
const BUILD=String(window.JustFunDesktop?.version||(typeof APP_VERSION==='string'?APP_VERSION:'7.8.4'));
const PRODUCT_PAGE_SIZE=25;
const DRIVER_PAGE_SIZE=20;
const REPORT_BATCH_SIZE=100;
const QA_STORAGE_KEY=window.TeplitsaWarehouseBootstrap?.dataKey('orders_teplitsa_qa_v595')||'orders_teplitsa_qa_v595';
const TX_JOURNAL_KEY=window.TeplitsaWarehouseBootstrap?.dataKey('orders_teplitsa_transaction_v595')||'orders_teplitsa_transaction_v595';
let productPage=1,driverPage=1,productSignature='',driverSignature='';
let activeTransaction=null;
let lastFocusedBeforeModal=null;

function byId(id){return document.getElementById(id)}
function clone(v){try{return structuredClone(v)}catch{return JSON.parse(JSON.stringify(v))}}
function nowIso(){return new Date().toISOString()}
function announce(message){
  let box=byId('v595LiveRegion');
  if(!box){box=document.createElement('div');box.id='v595LiveRegion';box.className='v595-live-region';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box)}
  box.textContent=String(message||'');box.classList.add('show');clearTimeout(announce.timer);announce.timer=setTimeout(()=>box.classList.remove('show'),3200)
}
function safeJson(value){try{return JSON.stringify(value)}catch{return''}}
function uniqueCount(values){return new Set(values).size}
function getEntityIds(list){return Array.isArray(list)?list.map(x=>String(x&&x.id||'')).filter(Boolean):[]}
function currentStorageKey(key){try{return typeof resolveDataStorageKey==='function'?resolveDataStorageKey(key):key}catch{return key}}

/* Local Leaflet: no runtime CDN injection. Tiles/routing remain configurable network services. */
function installLocalLeaflet(){
  if(window.L&&window.L.Icon&&window.L.Icon.Default)window.L.Icon.Default.imagePath='assets/vendor/leaflet/images/';
  window.JustFunOverrides.replace('showMapUnavailable','stability-v595',function(id){
    const el=byId(id);if(!el)return;el.dataset.mapError='1';
    el.innerHTML='<div class="empty v595-offline-map-note" style="height:100%;display:flex"><span aria-hidden="true">🗺️</span><div><b>Карта не получила данные</b><div class="small muted" style="margin-top:5px">Модуль карты загружен локально. Проверьте интернет, адрес сервиса тайлов и повторите подключение. Заказы, склад и документы продолжают работать.</div><button type="button" class="btn-soft mini-btn" style="margin-top:9px" data-jf-onclick="retryRoutesMapV560()">Повторить</button></div></div>';
  });
  window.JustFunOverrides.replace('retryRoutesMapV560','stability-v595',function(){
    const el=byId('routesMap');if(el){delete el.dataset.mapError;el.innerHTML='<div class="empty">Повторное подключение локального модуля карты…</div>'}
    if(!window.L){window.showMapUnavailable('routesMap');announce('Локальный модуль карты не загрузился');return false}
    try{if(typeof routesMap!=='undefined'&&routesMap){try{routesMap.remove()}catch{}routesMap=null}if(typeof routesLayer!=='undefined')routesLayer=null;if(typeof ensureRoutesMap==='function')ensureRoutesMap();if(typeof activeRouteId!=='undefined'&&activeRouteId&&typeof showRouteOnMap==='function')showRouteOnMap(activeRouteId,false);document.dispatchEvent(new CustomEvent('leafletready'));announce('Карта переподключена');return true}catch(err){console.error('Local map retry failed',err);window.showMapUnavailable('routesMap');return false}
  });
  if(window.L)setTimeout(()=>document.dispatchEvent(new CustomEvent('leafletready')),0);
}

/* Critical operations: in-memory snapshot + raw local-storage rollback + save failure tracking. */
function transactionStorageKeys(){
  const keys=[];
  const add=value=>{if(typeof value==='string'&&value)keys.push(currentStorageKey(value))};
  try{add(STORAGE_KEY)}catch{}
  try{add(INVENTORY_MOVEMENTS_KEY)}catch{}
  try{add(ROUTE_EXECUTIONS_KEY)}catch{}
  try{add(ROUTE_ARCHIVE_KEY)}catch{}
  try{add(ROUTE_ASSIGNMENTS_KEY)}catch{}
  try{add(ROUTE_CATALOG_KEY)}catch{}
  try{add(ROUTE_LOCKS_KEY)}catch{}
  try{add(ROUTE_DRIVERS_KEY)}catch{}
  try{add(ROUTES_KEY)}catch{}
  try{add(WAREHOUSE_RESERVATIONS_KEY)}catch{}
  return [...new Set(keys)]
}
function takeMemorySnapshot(){
  const s={};
  try{s.orders=clone(orders)}catch{}
  try{s.inventoryMovements=clone(inventoryMovements)}catch{}
  try{s.routeExecutions=clone(routeExecutions)}catch{}
  try{s.routeArchives=clone(routeArchives)}catch{}
  try{s.routeAssignments=clone(routeAssignments)}catch{}
  try{s.routeCatalog=clone(routeCatalog)}catch{}
  try{s.routeLocks=clone(routeLocks)}catch{}
  try{s.routeDriverAssignments=clone(routeDriverAssignments)}catch{}
  try{s.routePlans=clone(routePlans)}catch{}
  try{s.warehouseReservations=clone(warehouseReservations)}catch{}
  return s
}
function restoreMemorySnapshot(s){
  try{if('orders'in s)orders=s.orders}catch{}
  try{if('inventoryMovements'in s)inventoryMovements=s.inventoryMovements}catch{}
  try{if('routeExecutions'in s)routeExecutions=s.routeExecutions}catch{}
  try{if('routeArchives'in s)routeArchives=s.routeArchives}catch{}
  try{if('routeAssignments'in s)routeAssignments=s.routeAssignments}catch{}
  try{if('routeCatalog'in s)routeCatalog=s.routeCatalog}catch{}
  try{if('routeLocks'in s)routeLocks=s.routeLocks}catch{}
  try{if('routeDriverAssignments'in s)routeDriverAssignments=s.routeDriverAssignments}catch{}
  try{if('routePlans'in s)routePlans=s.routePlans}catch{}
  try{if('warehouseReservations'in s)warehouseReservations=s.warehouseReservations}catch{}
}
function takeRawStorageSnapshot(){const result={};for(const key of transactionStorageKeys()){try{result[key]=localStorage.getItem(key)}catch{result[key]=null}}return result}
function restoreRawStorageSnapshot(s){for(const[key,value]of Object.entries(s||{})){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch(err){console.error('Storage rollback failed',key,err)}}}
function writeJournal(kind,status='prepared'){try{localStorage.setItem(TX_JOURNAL_KEY,JSON.stringify({version:BUILD,kind,status,at:nowIso()}))}catch{}}
function clearJournal(){try{localStorage.removeItem(TX_JOURNAL_KEY)}catch{}}
function checkInterruptedTransaction(){
  try{const raw=localStorage.getItem(TX_JOURNAL_KEY);if(!raw)return;const j=JSON.parse(raw);clearJournal();setTimeout(()=>{announce('Предыдущая критическая операция была прервана. Выполнена проверка целостности.');try{if(typeof runDataDiagnostics==='function')runDataDiagnostics(false)}catch{}},500)}catch{clearJournal()}
}
window.__teplitsaSaveHookV595=function(key,value,legacy){let ok=false;try{ok=legacy(key,value)}catch(err){if(activeTransaction)activeTransaction.failed=true;throw err}if(activeTransaction&&ok===false)activeTransaction.failed=true;return ok};
try{const persistOrdersV595Base=persistOrders;persistOrders=function(){let result;try{result=persistOrdersV595Base.apply(this,arguments)}catch(err){if(activeTransaction)activeTransaction.failed=true;throw err}if(activeTransaction&&result===false)activeTransaction.failed=true;return result}}catch{}
function runtimeCriticalError(){
  try{const ids=getEntityIds(orders);if(ids.length!==uniqueCount(ids))return'Обнаружены повторяющиеся идентификаторы заказов'}catch{}
  try{for(const p of products||[]){if(!p||!p.stockTracked)continue;const state=typeof productInventoryState==='function'?productInventoryState(p):null;if(state&&Number(state.onHand)<-1e-8)return`Отрицательный остаток: ${p.name||p.id}`}}catch{}
  return''
}
function atomicMutation(kind,action){
  if(activeTransaction){return action()}
  const memory=takeMemorySnapshot(),raw=takeRawStorageSnapshot(),nativeAlert=window.alert,alerts=[];
  activeTransaction={kind,failed:false};writeJournal(kind);document.documentElement.classList.add('v595-transaction-lock');
  window.alert=(message)=>alerts.push(String(message||''));
  const finish=(result,error=null)=>{
    if(error)activeTransaction.failed=true;
    try{const integrity=runtimeCriticalError();if(integrity){activeTransaction.failed=true;error=error||new Error(integrity)}}catch(err){activeTransaction.failed=true;error=error||err}
    const failed=activeTransaction.failed;window.alert=nativeAlert;activeTransaction=null;document.documentElement.classList.remove('v595-transaction-lock');
    if(failed){restoreMemorySnapshot(memory);restoreRawStorageSnapshot(raw);clearJournal();try{renderAll()}catch{};console.error('Критическая операция отменена',kind,error);nativeAlert(`Операция отменена: данные не были сохранены полностью. Состояние восстановлено.${error?'\n'+(error.message||error):''}`);return false}
    writeJournal(kind,'committed');clearJournal();for(const text of alerts)nativeAlert(text);return result
  };
  try{
    const result=action();
    if(result&&typeof result.then==='function')return result.then(value=>finish(value),error=>finish(false,error));
    return finish(result)
  }catch(error){return finish(false,error)}
}
window.commitRouteClosure=function(){return atomicMutation('route_closure',()=>commitRouteClosureLegacyV594())};
window.markCurrentPickupCollected=function(){return atomicMutation('pickup_collected',()=>markCurrentPickupCollectedLegacyV594())};

/* Pagination and progressive rendering. */
function pageButtons(current,total,handler){
  const points=new Set([1,total,current-1,current,current+1]);const nums=[...points].filter(x=>x>=1&&x<=total).sort((a,b)=>a-b);let html='',prev=0;
  for(const n of nums){if(prev&&n-prev>1)html+='<span aria-hidden="true">…</span>';html+=`<button type="button" class="v595-page-btn ${n===current?'active':''}" ${n===current?'aria-current="page"':''} data-jf-onclick="${handler}(${n})">${n}</button>`;prev=n}return html
}
function applyPagination(areaId,rowSelector,page,size,stateName){
  const area=byId(areaId);if(!area)return;area.querySelectorAll('.v595-pagination').forEach(x=>x.remove());const rows=[...area.querySelectorAll(rowSelector)];if(!rows.length)return;
  const totalPages=Math.max(1,Math.ceil(rows.length/size));page=Math.max(1,Math.min(page,totalPages));const start=(page-1)*size,end=Math.min(rows.length,start+size);
  rows.forEach((row,index)=>{row.hidden=index<start||index>=end});if(totalPages<=1)return;
  const box=document.createElement('nav');box.className='v595-pagination';box.setAttribute('aria-label','Навигация по списку');box.innerHTML=`<div class="v595-pagination-info">Показано ${start+1}–${end} из ${rows.length}</div><div class="v595-pagination-controls"><button type="button" class="v595-page-btn" ${page<=1?'disabled':''} data-jf-onclick="${stateName}(${page-1})" aria-label="Предыдущая страница">‹</button>${pageButtons(page,totalPages,stateName)}<button type="button" class="v595-page-btn" ${page>=totalPages?'disabled':''} data-jf-onclick="${stateName}(${page+1})" aria-label="Следующая страница">›</button></div>`;area.appendChild(box)
}
window.setProductsPageV595=function(page){productPage=Number(page)||1;window.__applyProductsPaginationV595();byId('productsArea')?.scrollIntoView({block:'start',behavior:'smooth'})};
window.setDriversPageV595=function(page){driverPage=Number(page)||1;window.__applyDriversPaginationV595();byId('driversArea')?.scrollIntoView({block:'start',behavior:'smooth'})};
window.__applyProductsPaginationV595=function(){const sig=[byId('productSearch')?.value,byId('productCategoryFilter')?.value,byId('productStockFilter')?.value,byId('productSort')?.value,document.querySelectorAll('#productsArea .warehouse-row').length].join('|');if(sig!==productSignature){productSignature=sig;productPage=1}applyPagination('productsArea','.warehouse-row',productPage,PRODUCT_PAGE_SIZE,'setProductsPageV595')};
window.__applyDriversPaginationV595=function(){const sig=[byId('driverSearch')?.value,byId('driverStatusFilter')?.value,document.querySelectorAll('#driversArea .entity-row').length].join('|');if(sig!==driverSignature){driverSignature=sig;driverPage=1}applyPagination('driversArea','.entity-row',driverPage,DRIVER_PAGE_SIZE,'setDriversPageV595')};
window.__applyReportVirtualizationV595=function(){
  const root=byId('reportsView');if(!root)return;root.querySelectorAll('.v595-table-more').forEach(x=>x.remove());
  root.querySelectorAll('table tbody').forEach((body,index)=>{const rows=[...body.children];if(rows.length<=REPORT_BATCH_SIZE)return;let shown=REPORT_BATCH_SIZE;rows.forEach((row,i)=>row.classList.toggle('v595-virtual-hidden',i>=shown));const wrap=document.createElement('div');wrap.className='v595-table-more';const btn=document.createElement('button');btn.type='button';btn.className='btn-soft';btn.textContent=`Показать ещё ${Math.min(REPORT_BATCH_SIZE,rows.length-shown)} из ${rows.length}`;btn.addEventListener('click',()=>{shown=Math.min(rows.length,shown+REPORT_BATCH_SIZE);rows.forEach((row,i)=>row.classList.toggle('v595-virtual-hidden',i>=shown));if(shown>=rows.length)wrap.remove();else btn.textContent=`Показать ещё ${Math.min(REPORT_BATCH_SIZE,rows.length-shown)} из ${rows.length}`});wrap.appendChild(btn);body.closest('table')?.insertAdjacentElement('afterend',wrap)})
};

/* Accessibility and predictable navigation. */
function installSkipLink(){if(document.querySelector('.skip-link-v595'))return;const link=document.createElement('a');link.className='skip-link-v595';link.href='#appMainV595';link.textContent='Перейти к содержимому';document.body.prepend(link);const main=document.querySelector('.container')||document.querySelector('main')||document.body.children[1];if(main){main.id=main.id||'appMainV595';main.setAttribute('tabindex','-1')}}
function installTabs(){
  const tabs=document.querySelector('.tabs');if(!tabs)return;if(!tabs.parentElement.classList.contains('tabs-shell-v595')){const shell=document.createElement('div');shell.className='tabs-shell-v595';tabs.parentNode.insertBefore(shell,tabs);shell.appendChild(tabs);const hint=document.createElement('div');hint.className='tabs-scroll-hint-v595';hint.innerHTML='<span aria-hidden="true">↔</span> Проведите в сторону, чтобы увидеть все разделы';shell.appendChild(hint)}
  tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Разделы программы');const buttons=[...tabs.querySelectorAll('.tab')];
  const sync=()=>{buttons.forEach(btn=>{const view=(btn.getAttribute('data-jf-onclick')||'').match(/showView\('([^']+)'\)/)?.[1];btn.setAttribute('role','tab');btn.setAttribute('aria-selected',String(btn.classList.contains('active')));btn.tabIndex=btn.classList.contains('active')?0:-1;if(view)btn.setAttribute('aria-controls',view+'View')});updateTabEdges()};
  buttons.forEach((btn,index)=>btn.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].focus();buttons[next].click()}));
  tabs.addEventListener('scroll',updateTabEdges,{passive:true});tabs.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)&&tabs.scrollWidth>tabs.clientWidth){tabs.scrollLeft+=event.deltaY;event.preventDefault()}},{passive:false});new MutationObserver(sync).observe(tabs,{attributes:true,subtree:true,attributeFilter:['class']});sync();window.addEventListener('resize',updateTabEdges)
}
function updateTabEdges(){const tabs=document.querySelector('.tabs'),shell=tabs?.closest('.tabs-shell-v595');if(!tabs||!shell)return;shell.classList.toggle('has-more-left',tabs.scrollLeft>4);shell.classList.toggle('has-more-right',tabs.scrollLeft+tabs.clientWidth<tabs.scrollWidth-4)}
function scopedElements(root,selector){const result=[...root.querySelectorAll(selector)];if(root instanceof Element&&root.matches(selector))result.unshift(root);return result}
function accessibleButtons(root=document){scopedElements(root,'button:not([type])').forEach(btn=>{if(!btn.closest('form'))btn.type='button';if(!btn.textContent.trim()&&!btn.getAttribute('aria-label'))btn.setAttribute('aria-label',btn.title||'Действие')})}
function controlHasAccessibleLabel(control){const id=String(control.id||''),escaped=window.CSS?.escape?window.CSS.escape(id):id.replace(/[^a-zA-Z0-9_-]/g,'\\$&'),wrapping=control.closest('label'),wrappingName=String(wrapping?.textContent||wrapping?.title||'').replace(/\s+/g,' ').trim();return Boolean(control.getAttribute('aria-label')||control.getAttribute('aria-labelledby')||wrappingName||id&&document.querySelector(`label[for="${escaped}"]`))}
function visualFieldLabel(control){
  const wrapping=control.closest('label'),wrappingName=String(wrapping?.textContent||wrapping?.title||'').replace(/\s+/g,' ').trim();if(wrappingName)return wrappingName;
  const field=control.closest('.field,.jf-auth-field,.driver-pay-rule,.driver-profile-pay-rule,.product-form-section,.settings-box');
  const candidate=field?.querySelector(':scope > label,.field > label,.driver-pay-rule-title,.product-form-section-title');
  return String(candidate?.textContent||candidate?.title||control.closest('[title]')?.title||control.placeholder||'').replace(/\s+/g,' ').trim()
}
function accessibleFields(root=document){
  scopedElements(root,'input:not([type="hidden"]),select,textarea').forEach(control=>{
    if(control.hidden||controlHasAccessibleLabel(control))return;const name=visualFieldLabel(control);if(!name)return;
    const field=control.closest('.field,.jf-auth-field'),label=field?.querySelector(':scope > label');
    if(label&&control.id&&field.querySelectorAll('input:not([type="hidden"]),select,textarea').length===1)label.htmlFor=control.id;else control.setAttribute('aria-label',name)
  })
}
function accessibleClickTargets(root=document){
  scopedElements(root,'[data-jf-onclick]').filter(element=>/\b(?:openDetails|openProductDetails|openDriverDetails)\s*\(/.test(String(element.getAttribute('data-jf-onclick')||''))).forEach(element=>{
    if(element.matches('button,a,input,select,textarea')||element.dataset.v595KeyboardTarget)return;element.dataset.v595KeyboardTarget='1';element.tabIndex=0;element.setAttribute('role','button');
    if(!element.hasAttribute('aria-label')){const text=String(element.textContent||'').replace(/\s+/g,' ').trim().slice(0,180);element.setAttribute('aria-label',text?`Открыть: ${text}`:'Открыть карточку')}
    element.addEventListener('keydown',event=>{if(event.target!==element||!['Enter',' '].includes(event.key))return;event.preventDefault();element.click()})
  })
}
function installDynamicAccessibility(){
  const pending=new Set();let queued=false;const sync=root=>{accessibleButtons(root);accessibleFields(root);accessibleClickTargets(root)};
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element)pending.add(node);if(pending.size&&!queued){queued=true;queueMicrotask(()=>{queued=false;const roots=[...pending];pending.clear();for(const root of roots)sync(root)})}}).observe(document.body,{childList:true,subtree:true});sync(document);window.__JustFunAccessibilityV595=Object.freeze({refresh:()=>sync(document)});setTimeout(()=>sync(document),1200)
}
function focusables(root){return[...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(x=>x.offsetParent!==null)}
function syncModalAccessibility(){
  const open=[...document.querySelectorAll('.modal.open')];document.querySelectorAll('.modal').forEach(modal=>{modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');const card=modal.querySelector('.modal-card');if(card)card.tabIndex=-1});
  if(open.length){const modal=open[open.length-1];if(!modal.dataset.v595Focused){lastFocusedBeforeModal=document.activeElement;modal.dataset.v595Focused='1';setTimeout(()=>{const list=focusables(modal);(list[0]||modal.querySelector('.modal-card'))?.focus()},0)}}else{document.querySelectorAll('.modal[data-v595-focused]').forEach(x=>delete x.dataset.v595Focused);if(lastFocusedBeforeModal&&document.contains(lastFocusedBeforeModal)){lastFocusedBeforeModal.focus();lastFocusedBeforeModal=null}}
}
function installModalFocus(){document.querySelectorAll('.modal').forEach(modal=>new MutationObserver(syncModalAccessibility).observe(modal,{attributes:true,attributeFilter:['class']}));document.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const open=[...document.querySelectorAll('.modal.open')].pop();if(!open)return;const list=focusables(open);if(!list.length)return;const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});syncModalAccessibility()}

/* Embedded non-destructive regression and integrity suite. */
function qaCheck(name,fn,level='fail'){try{const value=fn();if(value===true||value===undefined)return{name,status:'ok',detail:'Пройдено'};if(typeof value==='string')return{name,status:level,detail:value};return{name,status:value?'ok':level,detail:value?'Пройдено':'Проверка не пройдена'}}catch(err){return{name,status:level,detail:err&&err.message||String(err)}}}
function duplicateDomIds(){const ids=[...document.querySelectorAll('[id]')].map(x=>x.id),seen=new Set(),duplicates=[];for(const id of ids){if(seen.has(id)&&!duplicates.includes(id))duplicates.push(id);seen.add(id)}return duplicates}
function qaRun(options={}){
  const checks=[];const add=(n,f,l)=>checks.push(qaCheck(n,f,l));
  add('Основные разделы интерфейса',()=>['ordersView','productsView','tripsView','driversView','reportsView','settingsView','programSettingsView'].every(byId)||'Не найден один или несколько разделов');
  add('Ключевые функции программы',()=>[
    typeof renderAll==='function',typeof showView==='function',typeof renderProducts==='function',
    typeof renderDrivers==='function',typeof renderReport==='function',
    typeof window.commitRouteClosure==='function',typeof window.markCurrentPickupCollected==='function'
  ].every(Boolean)||'Отсутствует обязательная функция');
  add('Уникальность DOM-идентификаторов',()=>{const d=duplicateDomIds();return d.length?`Повторы: ${d.slice(0,8).join(', ')}`:true},'warn');
  add('Уникальность заказов',()=>{const ids=getEntityIds(orders);return ids.length===uniqueCount(ids)||'Есть повторяющиеся id заказов'});
  add('Уникальность товаров',()=>{const ids=getEntityIds(products);return ids.length===uniqueCount(ids)||'Есть повторяющиеся id товаров'});
  add('Уникальность водителей',()=>{const ids=getEntityIds(drivers);return ids.length===uniqueCount(ids)||'Есть повторяющиеся id водителей'});
  add('Ссылки заказов на рейсы',()=>{const orderSet=new Set(getEntityIds(orders)),bad=Object.keys(routeAssignments||{}).filter(id=>!orderSet.has(String(id)));return bad.length?`Неизвестных заказов: ${bad.length}`:true});
  add('Назначения водителей',()=>{const driverSet=new Set(getEntityIds(drivers)),bad=Object.values(routeDriverAssignments||{}).filter(id=>id&&!driverSet.has(String(id)));return bad.length?`Неизвестных водителей: ${bad.length}`:true});
  add('Активные рейсы и заказы',()=>{const orderSet=new Set(getEntityIds(orders)),bad=[];for(const[x,e]of Object.entries(routeExecutions||{}))for(const id of (e&&e.orderIds||[]))if(!orderSet.has(String(id)))bad.push(`${x}:${id}`);return bad.length?`Ошибочных ссылок: ${bad.length}`:true});
  add('Неотрицательные складские остатки',()=>runtimeCriticalError()||true);
  add('Локальный модуль Leaflet',()=>window.L&&!document.querySelector('script[src^="http"][src*="leaflet"]')||'Leaflet не загружен локально');
  add('Пагинация больших списков',()=>typeof window.__applyProductsPaginationV595==='function'&&typeof window.__applyDriversPaginationV595==='function'||'Модуль пагинации не установлен');
  add('Транзакционная защита',()=>typeof window.__teplitsaSaveHookV595==='function'&&typeof window.commitRouteClosure==='function'||'Защита критических операций не установлена');
  add('Расчёт отчётности',()=>{if(typeof calculateReport!=='function')return'Модуль отчёта не найден';const result=calculateReport();return result&&result.period?true:'Отчёт не сформирован'});
  add('Чтение и запись локального хранилища',()=>{const key='__teplitsa_qa_roundtrip_v595';localStorage.setItem(key,'ok');const ok=localStorage.getItem(key)==='ok';localStorage.removeItem(key);return ok||'Браузер запретил локальное сохранение'});
  add('Модульная архитектура JavaScript',()=>document.querySelectorAll('script[src^="assets/js/"]').length>=8||/(stabilized|smart-automation)/.test(document.querySelector('meta[name="teplitsa-build"]')?.content||'')||'Модули приложения не подтверждены','warn');
  add('Клавиатурная навигация вкладок',()=>document.querySelector('.tabs[role="tablist"]')&&document.querySelectorAll('.tab[role="tab"]').length>=7||'Роли вкладок не установлены','warn');
  const summary={total:checks.length,passed:checks.filter(x=>x.status==='ok').length,warnings:checks.filter(x=>x.status==='warn').length,failed:checks.filter(x=>x.status==='fail').length};
  const result={version:BUILD,createdAt:nowIso(),summary,checks};try{localStorage.setItem(QA_STORAGE_KEY,JSON.stringify(result))}catch{}if(options.show!==false)renderQaResult(result);return result
}
function renderQaResult(result){
  const panel=byId('v595QaPanel');if(!panel)return;const{s}= {s:result.summary};panel.querySelector('.v595-qa-body').innerHTML=`<div class="v595-qa-summary"><div class="v595-qa-metric"><span>Всего проверок</span><b>${s.total}</b></div><div class="v595-qa-metric"><span>Пройдено</span><b>${s.passed}</b></div><div class="v595-qa-metric"><span>Предупреждения</span><b>${s.warnings}</b></div><div class="v595-qa-metric"><span>Ошибки</span><b>${s.failed}</b></div></div><div class="v595-qa-list">${result.checks.map(x=>`<div class="v595-qa-item ${x.status}"><i>${x.status==='ok'?'✓':x.status==='warn'?'!':'×'}</i><div><b>${escapeForHtml(x.name)}</b><div class="small muted">${escapeForHtml(x.detail)}</div></div></div>`).join('')}</div><div class="v595-qa-actions"><button type="button" class="btn-primary" id="v595QaRunAgain">Запустить снова</button><button type="button" class="btn-soft" id="v595QaExport">Скачать результат JSON</button></div>`;panel.querySelector('.v595-qa-head span').textContent=`Последний запуск: ${(typeof formatDateTime==='function'?formatDateTime(result.createdAt):new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(result.createdAt))+' МСК')}`;byId('v595QaRunAgain')?.addEventListener('click',()=>qaRun({show:true}));byId('v595QaExport')?.addEventListener('click',()=>exportQa(result));announce(result.summary.failed?`Самопроверка: ошибок ${result.summary.failed}`:'Самопроверка завершена без критических ошибок')
}
function escapeForHtml(value){return String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function exportQa(result){const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`JustFun-QA-${BUILD}-${typeof todayISO==='function'?todayISO():new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function installQaPanel(){
  if(byId('v595QaPanel'))return;const anchor=byId('diagnosticStatus')||byId('programSettingsView');if(!anchor)return;const panel=document.createElement('section');panel.id='v595QaPanel';panel.className='v595-qa-panel';panel.innerHTML='<div class="v595-qa-head"><b>Встроенный контроль качества 7.8.3</b><span>Ещё не запускался</span></div><div class="v595-qa-body"><div class="small muted">Проверка целостности заказов, рейсов, склада, водителей, отчётности, локальной карты и сохранения данных.</div><div class="v595-qa-actions"><button type="button" class="btn-primary" id="v595QaFirstRun">Запустить полный тест</button></div></div>';anchor.insertAdjacentElement('afterend',panel);byId('v595QaFirstRun')?.addEventListener('click',()=>qaRun({show:true}));let prior=null;try{prior=JSON.parse(localStorage.getItem(QA_STORAGE_KEY)||'null')}catch{}if(prior&&prior.version===BUILD)renderQaResult(prior)
}
window.TeplitsaQA={run:qaRun,getLast(){try{return JSON.parse(localStorage.getItem(QA_STORAGE_KEY)||'null')}catch{return null}},exportLast(){const r=this.getLast();if(r)exportQa(r)}};

function install(){
  installLocalLeaflet();checkInterruptedTransaction();installSkipLink();installTabs();installDynamicAccessibility();installModalFocus();installQaPanel();
  try{if(typeof renderAll==='function')renderAll()}catch(err){console.error('Final stabilization render failed',err)}
  setTimeout(()=>{try{qaRun({show:false})}catch(err){console.error('Automatic QA failed',err)}},900)
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
