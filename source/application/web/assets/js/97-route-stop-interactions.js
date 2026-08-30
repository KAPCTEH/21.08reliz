/* Teplitsa78 5.9.8 — compact route-stop details and manual stop ordering */
(function(){
  'use strict';
  const BUILD='7.8.3';
  const STORAGE_KEY=window.TeplitsaWarehouseBootstrap?.dataKey('teplitsa_route_manual_sequences_v596')||'teplitsa_route_manual_sequences_v596';
  const LONG_PRESS_MS=280;
  const MOVE_CANCEL_PX=9;
  const byId=id=>document.getElementById(id);
  const arr=value=>Array.isArray(value)?value:[];
  const clone=value=>{try{return typeof cloneValue==='function'?cloneValue(value):JSON.parse(JSON.stringify(value))}catch(_){return value}};
  const esc=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const same=(a,b)=>a.length===b.length&&a.every((value,index)=>String(value)===String(b[index]));
  let manualSequences=loadManualSequences();
  let drag=null;
  let suppressClickUntil=0;

  function loadManualSequences(){
    try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}}catch(_){return{}}
  }
  function persistManualSequences(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(manualSequences));return true}catch(error){console.error('Не удалось сохранить ручной порядок точек',error);return false}
  }
  function reloadManualSequences(){
    manualSequences=loadManualSequences();
    decorateAll();
    return clone(manualSequences)
  }
  const plans=()=>{try{return routePlans}catch(_){return window.routePlans||{}}};
  const executions=()=>{try{return routeExecutions}catch(_){return window.routeExecutions||{}}};
  const productList=()=>{try{return products}catch(_){return window.products||[]}};
  function routeDef(routeId){
    try{return routeState().allDefs.find(def=>String(def.id)===String(routeId))||null}catch(_){return null}
  }
  function routeExecutionLocked(routeId){
    const execution=executions()?.[routeId];
    return !!execution&&['in_transit','awaiting_close'].includes(execution.status);
  }
  function readyIds(def){return arr(def?.orders).map(order=>String(order.id))}
  function manualIds(def,{clean=true}={}){
    if(!def)return null;
    const stored=arr(manualSequences[def.id]?.orderIds).map(String),current=readyIds(def);
    const valid=stored.length===current.length&&new Set(stored).size===stored.length&&stored.every(id=>current.includes(id));
    if(valid)return stored;
    if(clean&&manualSequences[def.id]){delete manualSequences[def.id];persistManualSequences()}
    return null;
  }
  function setManualIds(routeId,ids){
    manualSequences[routeId]={orderIds:ids.map(String),updatedAt:new Date().toISOString(),build:BUILD};
    if(!persistManualSequences())throw new Error('Не удалось сохранить ручную последовательность точек');
  }
  function clearManualIds(routeId){
    routeId=String(routeId||'');
    if(!routeId||!manualSequences[routeId])return false;
    const previous=manualSequences[routeId];
    delete manualSequences[routeId];
    if(!persistManualSequences()){if(previous)manualSequences[routeId]=previous;throw new Error('Не удалось вернуть автоматический порядок')}
    return true
  }
  function indexSequenceFor(def,ids){
    const indexes=new Map(arr(def?.orders).map((order,index)=>[String(order.id),index+1]));
    const result=ids.map(id=>indexes.get(String(id))).filter(Number.isInteger);
    return result.length===arr(def?.orders).length?result:null
  }

  /* The route engine still performs all distance, geometry, schedule and payment calculations.
     This wrapper only supplies a user-approved order when it is valid for the current route composition. */
  const previousOptimize=window.optimizeRouteSequence;
  if(typeof previousOptimize==='function'){
    const manualAwareOptimize=function(def,matrix){
      const ids=manualIds(def),sequence=ids&&indexSequenceFor(def,ids);
      return sequence||previousOptimize.apply(this,arguments)
    };
    window.optimizeRouteSequence=manualAwareOptimize;
    try{optimizeRouteSequence=manualAwareOptimize}catch(_){ }
  }
  const previousCalculate=window.calculateRoute;
  if(typeof previousCalculate==='function'){
    const manualAwareCalculate=async function(def){
      const plan=await previousCalculate.apply(this,arguments),ids=manualIds(def);
      if(ids&&same(arr(plan?.orderedIds).map(String),ids)){
        plan.algorithm='Ручная последовательность точек';
        plan.manualOrder=true;
        plan.manualOrderUpdatedAt=manualSequences[def.id]?.updatedAt||new Date().toISOString();
      }else if(plan){delete plan.manualOrder;delete plan.manualOrderUpdatedAt}
      return plan
    };
    window.calculateRoute=manualAwareCalculate;
    try{calculateRoute=manualAwareCalculate}catch(_){ }
  }

  function orderFor(routeId,orderId){return arr(routeDef(routeId)?.orders).find(order=>String(order.id)===String(orderId))||null}
  function productName(item){
    if(item?.name)return item.name;
    const product=arr(productList()).find(entry=>String(entry.id)===String(item?.productId));
    return product?.name||'Товар'
  }
  function itemLine(item){
    const qty=Number(item?.qty||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
    const unit=item?.unit||arr(productList()).find(entry=>String(entry.id)===String(item?.productId))?.unit||'шт.';
    return `<div class="route-stop-product-v597"><b>${esc(productName(item))}</b><span>${esc(qty)} ${esc(unit)}</span></div>`
  }
  function detailsHtml(order){
    const items=arr(order?.items).filter(item=>Number(item?.qty||0)>0),shown=items.slice(0,6),more=Math.max(0,items.length-shown.length);
    return `<div class="route-stop-compact-v597" hidden>
      <div class="route-stop-simple-v597"><span>Заказ</span><b>${esc(order?.number||'—')}</b></div>
      <div class="route-stop-simple-v597"><span>Адрес</span><b>${esc(order?.deliveryAddress||'Адрес не указан')}</b></div>
      <div class="route-stop-simple-v597 route-stop-goods-v597"><span>Товар</span><div>${shown.length?shown.map(itemLine).join(''):'<b>Товар не указан</b>'}${more?`<small>Ещё позиций: ${more}</small>`:''}</div></div>
      <div class="route-stop-order-actions-v597"><button type="button" data-route-stop-move="-1">↑ Раньше</button><button type="button" data-route-stop-move="1">↓ Позже</button></div>
    </div>`
  }
  function sequenceSection(card){
    return [...card.querySelectorAll('.route-section')].find(section=>section.querySelector(':scope > .route-section-head b')?.textContent.trim()==='Последовательность точек')||null
  }
  function orderedStops(card){return [...(sequenceSection(card)?.querySelectorAll('.route-stops > .stop[data-order-id]')||[])]}
  function renumber(card){orderedStops(card).forEach((stop,index)=>{const badge=stop.querySelector('.stop-num');if(badge)badge.textContent=String(index+1)})}
  function routeIdFromCard(card){return String(card?.id||'').replace(/^routeCard-/,'')}
  function decorateCard(card){
    const routeId=routeIdFromCard(card),def=routeDef(routeId),section=sequenceSection(card),plan=plans()?.[routeId];
    if(!routeId||!def||!section)return;
    const orderIds=arr(plan?.orderedIds).map(String),stops=[...section.querySelectorAll('.route-stops > .stop')];
    stops.forEach((stop,index)=>{
      const orderId=orderIds[index];
      if(!orderId)return;
      const order=orderFor(routeId,orderId);if(!order)return;
      stop.dataset.routeId=routeId;stop.dataset.orderId=orderId;stop.dataset.routeStopV597='1';
      stop.setAttribute('role','button');stop.setAttribute('tabindex','0');stop.setAttribute('aria-expanded',stop.classList.contains('route-stop-expanded-v597')?'true':'false');
      stop.setAttribute('aria-label',`Точка ${index+1}. Заказ ${order.number||''}. Нажмите для краткой информации. Зажмите и перетащите для изменения очередности.`);
      if(!stop.querySelector('.route-stop-drag-handle-v597'))stop.insertAdjacentHTML('beforeend','<button type="button" class="route-stop-drag-handle-v597" aria-label="Переместить точку маршрута" title="Зажмите и перетащите"><span aria-hidden="true">⠿</span></button>');
      if(!stop.querySelector('.route-stop-compact-v597'))stop.insertAdjacentHTML('beforeend',detailsHtml(order));
      stop.classList.toggle('route-stop-reorder-locked-v597',routeExecutionLocked(routeId));
    });
    const head=section.querySelector(':scope > .route-section-head');
    if(head&&!head.querySelector('.route-sequence-tools-v597')){
      const original=head.querySelector(':scope > span');
      const tools=document.createElement('div');tools.className='route-sequence-tools-v597';
      if(original)tools.appendChild(original);
      tools.insertAdjacentHTML('beforeend','<span class="route-manual-badge-v597" hidden>Ручной порядок</span><button type="button" class="route-auto-order-v597" hidden>Вернуть автопорядок</button>');
      head.appendChild(tools)
    }
    let note=section.querySelector('.route-reorder-note-v597');
    if(!note){note=document.createElement('div');note.className='route-reorder-note-v597';section.querySelector('.route-stops')?.insertAdjacentElement('beforebegin',note)}
    const locked=routeExecutionLocked(routeId),isManual=!!manualIds(def);
    if(note)note.textContent=locked?'Очередность зафиксирована: машина уже выехала или ожидает закрытия рейса.':'Нажмите точку для краткой информации. Зажмите её и перетащите выше или ниже, чтобы изменить очередность.';
    head?.querySelector('.route-manual-badge-v597')?.toggleAttribute('hidden',!isManual);
    head?.querySelector('.route-auto-order-v597')?.toggleAttribute('hidden',!isManual||locked);
    renumber(card)
  }
  function decorateAll(){document.querySelectorAll('#tripsArea > .route-card').forEach(decorateCard)}
  function scheduleDecorate(){requestAnimationFrame(()=>requestAnimationFrame(decorateAll))}

  const previousRenderTrips=window.renderTripsPreview;
  if(typeof previousRenderTrips==='function'){
    const enhancedRenderTrips=function(){const result=previousRenderTrips.apply(this,arguments);scheduleDecorate();return result};
    window.renderTripsPreview=enhancedRenderTrips;
    try{renderTripsPreview=enhancedRenderTrips}catch(_){ }
  }

  function toggleStop(stop,force){
    const open=force??!stop.classList.contains('route-stop-expanded-v597'),card=stop.closest('.route-card');
    if(open)orderedStops(card).filter(other=>other!==stop).forEach(other=>toggleStop(other,false));
    stop.classList.toggle('route-stop-expanded-v597',open);stop.setAttribute('aria-expanded',String(open));
    const details=stop.querySelector('.route-stop-compact-v597');if(details)details.hidden=!open
  }
  function idsFromDom(card){return orderedStops(card).map(stop=>String(stop.dataset.orderId))}
  function updateBusy(card,busy,text='Пересчитываю маршрут, карту и время прибытия…'){
    card?.classList.toggle('route-sequence-busy-v597',busy);
    let status=card?.querySelector('.route-reorder-status-v597');
    if(busy&&!status){status=document.createElement('div');status.className='route-reorder-status-v597';status.textContent=text;sequenceSection(card)?.appendChild(status)}
    if(status){status.textContent=text;status.hidden=!busy}
  }
  async function applyManualOrder(routeId,ids){
    const def=routeDef(routeId),card=byId('routeCard-'+routeId);if(!def)throw new Error('Рейс не найден');
    if(routeExecutionLocked(routeId))throw new Error('Очередность нельзя менять после выезда машины');
    const expected=readyIds(def);if(ids.length!==expected.length||!ids.every(id=>expected.includes(String(id))))throw new Error('Состав маршрута изменился. Обновите рейс и повторите перенос.');
    const oldEntry=clone(manualSequences[routeId]),oldPlan=clone(plans()?.[routeId]);
    updateBusy(card,true);
    try{
      setManualIds(routeId,ids);
      const plan=await window.calculateRoute(def),finalization=typeof routeFinalizationState==='function'?routeFinalizationState(def,plan):null;
      if(finalization){plan.finalization=clone(finalization);plan.finalized=finalization.safe;plan.reviewReasons=arr(finalization.reasons);plan.reviewWarnings=arr(finalization.warnings)}
      if(!same(arr(plan.orderedIds).map(String),ids))throw new Error('Расчёт не применил выбранную последовательность');
      plans()[routeId]=plan;
      if(typeof persistRoutes==='function'&&persistRoutes()===false)throw new Error('Не удалось сохранить новый маршрут');
      if(typeof renderTripsPreview==='function')renderTripsPreview();
      if(typeof renderOrders==='function')renderOrders();
      if(typeof renderDrivers==='function')renderDrivers();
      if(typeof setProgress==='function')setProgress('Очередность точек сохранена. Маршрут, карта, время прибытия и оплата пересчитаны.',false,!plan.finalized);
      requestAnimationFrame(()=>{try{showRouteOnMap(routeId,false)}catch(_){ }});
    }catch(error){
      if(oldEntry)manualSequences[routeId]=oldEntry;else delete manualSequences[routeId];persistManualSequences();
      if(oldPlan)plans()[routeId]=oldPlan;
      if(typeof persistRoutes==='function')persistRoutes();
      if(typeof renderTripsPreview==='function')renderTripsPreview();
      throw error
    }finally{updateBusy(byId('routeCard-'+routeId),false)}
  }
  async function restoreAutomatic(routeId){
    const def=routeDef(routeId),card=byId('routeCard-'+routeId);if(!def)return;
    if(routeExecutionLocked(routeId)){alert('Автоматический порядок нельзя вернуть после выезда машины.');return}
    const oldEntry=clone(manualSequences[routeId]),oldPlan=clone(plans()?.[routeId]);updateBusy(card,true,'Возвращаю оптимальную автоматическую последовательность…');
    try{
      clearManualIds(routeId);
      const plan=await window.calculateRoute(def),finalization=typeof routeFinalizationState==='function'?routeFinalizationState(def,plan):null;
      if(finalization){plan.finalization=clone(finalization);plan.finalized=finalization.safe;plan.reviewReasons=arr(finalization.reasons);plan.reviewWarnings=arr(finalization.warnings)}
      plans()[routeId]=plan;if(typeof persistRoutes==='function'&&persistRoutes()===false)throw new Error('Не удалось сохранить автоматический маршрут');
      renderTripsPreview?.();renderOrders?.();renderDrivers?.();setProgress?.('Автоматическая оптимизация очередности восстановлена.',false,!plan.finalized);requestAnimationFrame(()=>{try{showRouteOnMap(routeId,false)}catch(_){}})
    }catch(error){if(oldEntry)manualSequences[routeId]=oldEntry;if(oldPlan)plans()[routeId]=oldPlan;persistManualSequences();persistRoutes?.();renderTripsPreview?.();alert('Не удалось вернуть автоматический порядок: '+(error?.message||error))}
    finally{updateBusy(byId('routeCard-'+routeId),false)}
  }

  function cancelLongPress(){if(drag?.timer){clearTimeout(drag.timer);drag.timer=null}}
  function scrollContainerFor(stop){
    let node=stop?.parentElement;
    while(node&&node!==document.body){const style=getComputedStyle(node);if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+2)return node;node=node.parentElement}
    return document.scrollingElement||document.documentElement
  }
  function autoScroll(pointerY){
    if(!drag?.started)return;
    const scroller=drag.scroller,margin=64,speed=18;
    if(scroller===document.scrollingElement||scroller===document.documentElement){
      if(pointerY<margin)window.scrollBy(0,-speed);else if(pointerY>window.innerHeight-margin)window.scrollBy(0,speed);return
    }
    const rect=scroller.getBoundingClientRect();
    if(pointerY<rect.top+margin)scroller.scrollTop-=speed;else if(pointerY>rect.bottom-margin)scroller.scrollTop+=speed
  }
  function startDrag(event){
    if(!drag||drag.started)return;const {stop,card,routeId,pointerId}=drag;
    if(routeExecutionLocked(routeId)){cancelLongPress();drag=null;return}
    drag.started=true;drag.lastY=event?.clientY??drag.startY;suppressClickUntil=Date.now()+800;
    stop.classList.add('route-stop-dragging-v597');card.classList.add('route-reordering-v597');document.body.classList.add('route-stop-drag-active-v597');
    stop.setAttribute('aria-grabbed','true');
    try{drag.captureTarget.setPointerCapture(pointerId)}catch(_){try{stop.setPointerCapture(pointerId)}catch(__){}}
    if(navigator.vibrate&&drag.pointerType==='touch')try{navigator.vibrate(25)}catch(_){ }
  }
  function reorderAt(pointerY){
    if(!drag?.started)return;
    const list=drag.stop.parentElement;
    const siblings=[...list.querySelectorAll(':scope > .stop[data-order-id]')].filter(stop=>stop!==drag.stop);
    const target=siblings.find(stop=>pointerY<stop.getBoundingClientRect().top+stop.getBoundingClientRect().height/2);
    if(target)list.insertBefore(drag.stop,target);else list.appendChild(drag.stop);
    renumber(drag.card);autoScroll(pointerY)
  }
  function finishDrag(commit=true){
    if(!drag)return;cancelLongPress();const state=drag;drag=null;
    if(!state.started)return;
    try{state.captureTarget.releasePointerCapture(state.pointerId)}catch(_){try{state.stop.releasePointerCapture(state.pointerId)}catch(__){}}
    state.stop.classList.remove('route-stop-dragging-v597');state.card.classList.remove('route-reordering-v597');document.body.classList.remove('route-stop-drag-active-v597');state.stop.removeAttribute('aria-grabbed');renumber(state.card);
    const ids=idsFromDom(state.card);suppressClickUntil=Date.now()+650;
    if(commit&&!same(ids,state.originalIds))applyManualOrder(state.routeId,ids).catch(error=>{alert('Очередность не изменена: '+(error?.message||error));renderTripsPreview?.()});
    else if(!commit&& !same(ids,state.originalIds))renderTripsPreview?.()
  }
  function onPointerDown(event){
    if(event.button!==undefined&&event.button!==0)return;
    const handle=event.target.closest('.route-stop-drag-handle-v597');
    const stop=event.target.closest('.route-stops > .stop[data-order-id]');
    if(!stop)return;
    if(!handle&&event.target.closest('button,a,input,select,textarea'))return;
    const card=stop.closest('.route-card'),routeId=stop.dataset.routeId;if(!card||routeExecutionLocked(routeId))return;
    const pointerType=event.pointerType||'mouse';
    drag={stop,card,routeId,pointerId:event.pointerId,pointerType,captureTarget:handle||stop,startX:event.clientX,startY:event.clientY,started:false,originalIds:idsFromDom(card),timer:null,scroller:scrollContainerFor(stop)};
    if(handle){event.preventDefault();event.stopPropagation();startDrag(event);return}
    if(pointerType==='touch')drag.timer=setTimeout(()=>startDrag(event),300)
  }
  function onPointerMove(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY,distance=Math.hypot(dx,dy);
    if(!drag.started){
      if(drag.pointerType==='mouse'||drag.pointerType==='pen'){
        if(distance<12)return;startDrag(event)
      }else{
        if(distance>10){cancelLongPress();drag=null}return
      }
    }
    if(event.cancelable)event.preventDefault();event.stopPropagation();drag.lastY=event.clientY;reorderAt(event.clientY)
  }
  function onPointerUp(event){if(drag&&event.pointerId===drag.pointerId)finishDrag(true)}
  function onPointerCancel(event){if(drag&&event.pointerId===drag.pointerId)finishDrag(false)}
  async function moveStopBy(stop,delta){
    const card=stop.closest('.route-card'),stops=orderedStops(card),index=stops.indexOf(stop),next=index+delta;
    if(!card||next<0||next>=stops.length||routeExecutionLocked(stop.dataset.routeId))return;
    if(delta<0)stop.parentElement.insertBefore(stop,stops[next]);else stop.parentElement.insertBefore(stops[next],stop);
    renumber(card);await applyManualOrder(stop.dataset.routeId,idsFromDom(card))
  }
  function onClick(event){
    const auto=event.target.closest('.route-auto-order-v597');if(auto){event.preventDefault();event.stopPropagation();const card=auto.closest('.route-card');restoreAutomatic(routeIdFromCard(card));return}
    const handle=event.target.closest('.route-stop-drag-handle-v597');if(handle){event.preventDefault();event.stopPropagation();return}
    const move=event.target.closest('[data-route-stop-move]');if(move){event.preventDefault();event.stopPropagation();const stop=move.closest('.stop[data-order-id]');moveStopBy(stop,Number(move.dataset.routeStopMove)).catch(error=>alert(error?.message||error));return}
    const stop=event.target.closest('.route-stops > .stop[data-order-id]');if(!stop||event.target.closest('button,a,input,select,textarea'))return;
    event.stopPropagation();if(Date.now()<suppressClickUntil)return;toggleStop(stop)
  }
  function onKeyDown(event){
    const stop=event.target.closest('.route-stops > .stop[data-order-id]');if(!stop)return;
    const card=stop.closest('.route-card'),stops=orderedStops(card),index=stops.indexOf(stop);
    if((event.key==='Enter'||event.key===' ')&&!event.altKey){event.preventDefault();event.stopPropagation();toggleStop(stop);return}
    if(event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')&&!routeExecutionLocked(stop.dataset.routeId)){
      event.preventDefault();event.stopPropagation();const next=event.key==='ArrowUp'?index-1:index+1;if(next<0||next>=stops.length)return;
      if(event.key==='ArrowUp')stop.parentElement.insertBefore(stop,stops[next]);else stop.parentElement.insertBefore(stops[next],stop);
      renumber(card);applyManualOrder(stop.dataset.routeId,idsFromDom(card)).then(()=>byId('routeCard-'+stop.dataset.routeId)?.querySelector(`[data-order-id="${CSS.escape(stop.dataset.orderId)}"]`)?.focus()).catch(error=>alert(error?.message||error))
    }
  }
  function init(){
    const host=byId('tripsArea');if(!host||host.dataset.routeStopInteractionsV597)return;
    host.dataset.routeStopInteractionsV597='1';host.addEventListener('click',onClick,true);host.addEventListener('keydown',onKeyDown,true);document.addEventListener('pointerdown',onPointerDown,true);document.addEventListener('pointermove',onPointerMove,{capture:true,passive:false});document.addEventListener('pointerup',onPointerUp,true);document.addEventListener('pointercancel',onPointerCancel,true);window.addEventListener('blur',()=>finishDrag(false));decorateAll()
  }
  window.RouteStopInteractionsV597={version:BUILD,decorate:decorateAll,reloadFromStorage:reloadManualSequences,getManualOrder:routeId=>manualIds(routeDef(routeId)),removeRoute:clearManualIds,applyManualOrder,restoreAutomatic,moveStopBy};window.RouteStopInteractionsV596=window.RouteStopInteractionsV597;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0)
})();
