
(function(){
  'use strict';
  const overrides=window.JustFunOverrides;
  if(!overrides)throw new Error('JustFunOverrides is not loaded');
  const byId=id=>document.getElementById(id);
  const nowIso=()=>new Date().toISOString();
  const explicitRouteTarget=order=>String(routeAssignments?.[order?.id]||routeLocks?.[order?.id]||'');
  const currentWarehouse=()=>typeof currentWarehouseIdV560==='function'?String(currentWarehouseIdV560()):String(settings?.warehouse?.id||settings?.warehouseId||'default');
  const orderWarehousePublic=order=>typeof entityWarehouseIdV560==='function'?String(entityWarehouseIdV560(order)):String(order?.warehouseId||order?.warehouseKey||currentWarehouse());
  const validGeoPublic=order=>{const lat=Number(order?.geo?.lat),lon=Number(order?.geo?.lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0)};
  function planningIssuesPublic(order){const issues=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(String(order?.deliveryDate||'')))issues.push('не указана корректная дата доставки');if(!String(order?.deliveryAddress||'').trim())issues.push('не указан адрес доставки');if(!validGeoPublic(order))issues.push('не подтверждены координаты');if(!String(order?.geo?.region||'').trim())issues.push('не определена область');if(!String(order?.geo?.district||order?.geo?.settlement||'').trim())issues.push('не определён район или населённый пункт');if(!asArray(order?.items).some(item=>Number(item?.qty||0)>0))issues.push('в заказе нет товара');return [...new Set(issues)]}
  const mutableStatus=order=>{
    if(!order||order.archived||isTerminalOrder(order))return false;
    return !['in_transit','awaiting_close','delivered','pickup_collected','not_relevant'].includes(String(order.fulfillmentStatus||'active'));
  };
  function currentDef(routeId){return routeState().allDefs.find(def=>def.id===routeId)||null}
  function freezeCurrentComposition(def){
    if(!def)return;
    const meta=routeCatalog[def.id]||{};
    routeCatalog[def.id]={...meta,id:def.id,key:meta.key||def.key||def.id,date:def.date||meta.date||'',region:def.region||meta.region||'Сборный рейс',district:def.district||meta.district||def.displayDistrict||'Рейс',title:meta.title||def.displayDistrict||def.district||'Рейс',custom:true,part:1,parts:1,updatedAt:nowIso()};
    for(const order of [...asArray(def.orders),...asArray(def.unready)]){
      const target=explicitRouteTarget(order);
      if(!target||target==='__unassigned__'||target===def.id)routeAssignments[order.id]=def.id;
    }
  }
  function composerReasons(order,def){
    const reasons=[];
    if(orderWarehousePublic(order)!==currentWarehouse())reasons.push('другой склад');
    if(def.date&&String(order.deliveryDate||'')!==String(def.date))reasons.push(`другая дата: ${formatDateOnly(order.deliveryDate)}`);
    if(!mutableStatus(order))reasons.push('заказ закрыт или выполняется');
    for(const issue of planningIssuesPublic(order)){
      if(/самовывоз|закрыт или архивирован|другого склада/.test(issue))continue;
      if(!reasons.includes(issue))reasons.push(issue);
    }
    return [...new Set(reasons)];
  }
  function composerPool(def,q=''){
    const currentIds=new Set([...asArray(def.orders),...asArray(def.unready)].map(o=>o.id));
    const compatible=[],attention=[];let assignedElsewhere=0,inactive=0;
    const needle=String(q||'').toLowerCase().trim();
    for(const order of asArray(orders)){
      if(!order||isPickup(order)||currentIds.has(order.id))continue;
      const target=explicitRouteTarget(order);
      if(target&&target!=='__unassigned__'&&target!==def.id){assignedElsewhere++;continue}
      if(!mutableStatus(order)){inactive++;continue}
      const hay=[order.number,order.deliveryAddress,order.contactName,order.contactMethod,orderRegion(order),orderDistrict(order),order.deliveryDate].join(' ').toLowerCase();
      if(needle&&!hay.includes(needle))continue;
      const reasons=composerReasons(order,def),entry={order,reasons,km:nearestDistanceToRoute(order,def)};
      (reasons.length?attention:compatible).push(entry);
    }
    const sorter=(a,b)=>(Number.isFinite(a.km)?a.km:1e12)-(Number.isFinite(b.km)?b.km:1e12)||String(a.order.deliveryDate||'').localeCompare(String(b.order.deliveryDate||''))||String(a.order.number||'').localeCompare(String(b.order.number||''),'ru');
    compatible.sort(sorter);attention.sort(sorter);return{compatible,attention,assignedElsewhere,inactive,currentIds};
  }
  function orderCard(entry,def,canAdd){
    const order=entry.order,km=entry.km,reasons=entry.reasons||[],incompatible=reasons.length>0;
    return `<div class="compose-order ${incompatible?'compose-order-incompatible-v592':''}"><div><div class="compose-order-title">${escapeHtml(order.number)} · ${escapeHtml(order.deliveryAddress||'Адрес не указан')}</div><div class="compose-order-meta">${formatDateOnly(order.deliveryDate)} · ${escapeHtml(orderDistrict(order))} · ${escapeHtml(order.contactName||'Контакт не указан')}</div><div class="compatibility">${Number.isFinite(km)?`Ближайшая точка ≈ ${km.toFixed(1)} км · `:''}разгрузка ≈ ${plannedUnloadMinutes(order)} мин</div>${reasons.length?`<div class="compose-order-reasons-v592">${reasons.map(reason=>`<span class="compose-order-reason-v592">${escapeHtml(reason)}</span>`).join('')}</div>`:''}</div><div class="compose-order-action-v592"><button class="btn-soft mini-btn" ${canAdd?'':`disabled title="${escapeAttr(reasons.join('; '))}"`} data-jf-onclick="addOrderToRoute('${escapeInlineJsString(def.id)}','${escapeInlineJsString(order.id)}')">${canAdd?'Добавить':'Недоступен'}</button></div></div>`;
  }
  overrides.replace('renderRouteComposer','route-composer-map-v592',function(){
    if(!currentComposeRouteId)return;
    const def=currentDef(currentComposeRouteId);if(!def){closeRouteComposer();return}
    const current=[...previewOrderedOrders(def),...asArray(def.unready)],q=byId('routeOrderSearch')?.value||'',pool=composerPool(def,q),estimate=def.orders.length?estimateRouteForOrders(def.orders):null,rules=estimate?routeRuleMetrics(estimate,def.orders.length):null,vehicle=routeVehicleAssessment(def.orders),issue=current.length>Number(settings.maxStops||12)||rules?.hardViolation||vehicle.blocked;
    byId('routeComposeTitle').textContent='Состав рейса';
    byId('routeComposeHint').textContent=`${formatDateOnly(def.date)} · свободные заказы больше не скрываются автоматическими предварительными группами`;
    byId('routeCustomTitle').value=routeCatalog[def.id]?.title||def.displayDistrict||'Рейс';
    const status=byId('routeComposeStatus');status.className=`notice ${issue?'notice-danger':rules?.short?'notice-warn':'notice-info'}`;
    status.innerHTML=`<b>Редактор показывает фактическую доступность.</b> Автоматическая предварительная группировка не считается назначением. Несовместимые свободные заказы видны отдельно с точной причиной.`;
    const currentHtml=current.length?current.map((order,index)=>`<div class="compose-order ${isOrderLocked(order.id)?'order-locked-row':''}"><div><div class="compose-order-title">${isOrderLocked(order.id)?'🔒 ':''}${index+1}. ${escapeHtml(order.number)} · ${escapeHtml(order.deliveryAddress||'Адрес не указан')}</div><div class="compose-order-meta">${formatDateOnly(order.deliveryDate)} · ${escapeHtml(orderDistrict(order))} · ${escapeHtml(order.contactName||'Контакт не указан')} · ${orderReady(order)?`разгрузка ≈ ${plannedUnloadMinutes(order)} мин`:'нет подтверждённых координат'}</div></div><button class="btn-danger mini-btn" data-jf-onclick="removeOrderFromRoute('${escapeInlineJsString(def.id)}','${escapeInlineJsString(order.id)}')">Убрать</button></div>`).join(''):'<div class="empty" style="padding:24px 12px">Рейс пока пуст.</div>';
    const availableHtml=pool.compatible.length?pool.compatible.map(entry=>orderCard(entry,def,true)).join(''):'<div class="empty" style="padding:24px 12px">Совместимых свободных заказов по текущему поиску нет.</div>';
    const attentionHtml=pool.attention.length?`<div class="compose-column" style="grid-column:1/-1"><div class="compose-column-head"><div><b>Свободные, но требуют исправления</b><div class="compose-section-note-v592">Эти заказы не скрыты. После исправления даты, адреса или склада они станут доступны для добавления.</div></div><span class="badge badge-warn">${pool.attention.length}</span></div><div class="compose-list">${pool.attention.map(entry=>orderCard(entry,def,false)).join('')}</div></div>`:'';
    byId('routeComposeBody').innerHTML=`<div class="route-compose-summary-v592"><div class="route-compose-metric-v592"><span>В рейсе</span><b>${current.length}</b></div><div class="route-compose-metric-v592"><span>Можно добавить</span><b>${pool.compatible.length}</b></div><div class="route-compose-metric-v592"><span>Требуют исправления</span><b>${pool.attention.length}</b></div><div class="route-compose-metric-v592"><span>Назначены в другие рейсы</span><b>${pool.assignedElsewhere}</b></div></div><div class="compose-columns"><div class="compose-column"><div class="compose-column-head"><b>В этом рейсе</b><span class="badge badge-green">${current.length}</span></div><div class="compose-list">${currentHtml}</div></div><div class="compose-column"><div class="compose-column-head"><div><b>Свободные заказы</b><div class="compose-section-note-v592">Включая заказы из автоматических предварительных групп, если они ещё не закреплены.</div></div><span class="badge badge-blue">${pool.compatible.length}</span></div><div class="compose-list">${availableHtml}</div></div>${attentionHtml}</div>`;
  });
  overrides.replace('addOrderToRoute','route-composer-map-v592',async function(routeId,orderId){
    if(typeof routeMutableV560==='function'&&!routeMutableV560(routeId))return;
    const def=currentDef(routeId),order=orders.find(item=>item.id===orderId);if(!def||!order)return;
    const target=explicitRouteTarget(order);
    if(target&&target!=='__unassigned__'&&target!==routeId){alert(`Заказ ${order.number} уже закреплён в другом рейсе. Сначала уберите его оттуда.`);return}
    const reasons=composerReasons(order,def);if(reasons.length){alert(`Заказ пока нельзя добавить:\n• ${reasons.join('\n• ')}`);return}
    const candidate=[...asArray(def.orders),order],assessment=assessRouteOrders(candidate),shortages=inventoryShortagesForOrders(candidate);
    if(assessment.vehicle.blocked){alert('Заказ не добавлен: груз не помещается ни в один активный автомобиль.');return}
    if(shortages.length){alert(`Заказ не добавлен: недостаточно товара на складе (${shortages.slice(0,3).map(x=>x.product?.name||'товар').join(', ')}${shortages.length>3?'…':''}).`);return}
    if(assessment.hardViolation&&!await jfConfirm(`Состав отклоняется от правил (${assessment.rules?.label||'ограничения маршрута'}). Добавить заказ для последующего ручного решения?`,{title:'Отклонение от правил',confirmLabel:'Добавить'}))return;
    freezeCurrentComposition(def);routeAssignments[orderId]=routeId;delete routeLocks[orderId];delete routePlans[routeId];persistRouteAssignments();persistRouteLocks();persistRoutes();renderTripsPreview();renderOrders();currentComposeRouteId=routeId;renderRouteComposer();
  });
  overrides.replace('removeOrderFromRoute','route-composer-map-v592',async function(routeId,orderId){
    if(typeof routeMutableV560==='function'&&!routeMutableV560(routeId))return;
    const def=currentDef(routeId),order=orders.find(item=>item.id===orderId);if(!def||!order)return;
    if(!await jfConfirm(`Убрать заказ ${order.number} из рейса? Он останется свободным и сразу появится в редакторах других рейсов.`,{title:'Изменить состав рейса',confirmLabel:'Убрать заказ'}))return;
    freezeCurrentComposition(def);delete routeLocks[orderId];routeAssignments[orderId]='__unassigned__';delete routePlans[routeId];
    const remaining=[...asArray(def.orders),...asArray(def.unready)].filter(item=>item.id!==orderId);
    if(!remaining.length){delete routeCatalog[routeId];delete routeDriverAssignments[routeId];delete routePlans[routeId]}
    if(order.warehouseFlowStatus==='reserved')order.warehouseFlowStatus='planned';
    persistOrders();persistRouteAssignments();persistRouteLocks();persistRouteDrivers();persistRoutes();renderTripsPreview();renderOrders();
    if(currentComposeRouteId===routeId&&remaining.length)renderRouteComposer();else if(currentComposeRouteId===routeId)closeRouteComposer();
  });
  overrides.wrap('openRouteComposer','route-composer-map-v592',previousOpen=>function(routeId){
    if(typeof routeMutableV560==='function'&&!routeMutableV560(routeId))return;
    currentComposeRouteId=routeId;if(byId('routeOrderSearch'))byId('routeOrderSearch').value='';renderRouteComposer();byId('routeComposeModal')?.classList.add('open');
  });
  // Map docking and refresh are owned by the stability layer. This module
  // changes route composition only and no longer wraps global rendering.
})();
