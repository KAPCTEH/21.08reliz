
/* ===== PERFECT ROUTE ENGINE LOGIC v5.7.0 ===== */
(function(){
  'use strict';
  const ENGINE_VERSION='7.8.3';
  const ENGINE_KEY=window.TeplitsaWarehouseBootstrap?.dataKey('teplitsa_route_engine_v570')||'teplitsa_route_engine_v570';
  const STATUS_SUFFIX=/\s*[·—-]\s*(?:в пути|ожидает закрытия|готов к выезду|готов к выпуску|требует решения|закрыт|черновик)\s*$/i;
  const engine={version:ENGINE_VERSION,building:false,lastBuild:null,lastAudit:null,startLocks:new Set(),buildToken:0};
  try{engine.lastBuild=JSON.parse(localStorage.getItem(ENGINE_KEY)||'null')}catch(_){engine.lastBuild=null}
  window.routeEngineV570=engine;

  const clone=v=>{try{return cloneValue(v)}catch(_){return JSON.parse(JSON.stringify(v))}};
  const uniq=a=>[...new Set(a)];
  const finite=n=>Number.isFinite(Number(n));
  const activeExecution=id=>{const e=routeExecutions?.[id];return e&&['in_transit','awaiting_close'].includes(e.status)?e:null};
  const activeIds=()=>new Set(Object.entries(routeExecutions||{}).filter(([,e])=>e&&['in_transit','awaiting_close'].includes(e.status)).map(([id])=>id));
  const activeOrderIds=()=>new Set(Object.values(routeExecutions||{}).filter(e=>e&&['in_transit','awaiting_close'].includes(e.status)).flatMap(e=>asArray(e.orderIds)));
  const warehouseId=()=>{try{return currentWarehouseIdV560()}catch(_){return String(settings?.warehouse?.id||settings?.warehouse?.address||'main')};};
  const orderWarehouse=o=>{try{return entityWarehouseIdV560(o)}catch(_){return String(o?.warehouseId||warehouseId())};};
  const driverWarehouse=d=>{try{return entityWarehouseIdV560(d)}catch(_){return String(d?.warehouseId||warehouseId())};};
  const routeModeFor=def=>{try{const ov=routeOverride(def?.id);return ov?.routeMode&&ov.routeMode!=='inherit'?ov.routeMode:(settings.routeMode||'round')}catch(_){return settings.routeMode||'round'}};
  const returnsFor=def=>routeModeFor(def)!=='oneway';
  const cleanRouteTitle=text=>String(text||'').replace(STATUS_SUFFIX,'').replace(/^Сборный рейс:\s*$/i,'Сборный рейс').trim()||'Рейс';

  function validGeo(o){const lat=Number(o?.geo?.lat),lon=Number(o?.geo?.lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0)}
  function orderPlanningIssues(o){
    const issues=[];
    if(!o)return['заказ не найден'];
    if(isPickup(o))issues.push('самовывоз не участвует в районных рейсах');
    if(o.archived||isTerminalOrder(o))issues.push('заказ закрыт или архивирован');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(o.deliveryDate||'')))issues.push('не указана корректная дата доставки');
    if(!String(o.deliveryAddress||'').trim())issues.push('не указан адрес доставки');
    if(!validGeo(o))issues.push('не подтверждены координаты');
    if(!String(o?.geo?.region||'').trim())issues.push('не определена область');
    if(!String(o?.geo?.district||o?.geo?.settlement||'').trim())issues.push('не определён район или населённый пункт');
    const items=asArray(o.items).filter(i=>Number(i?.qty||0)>0);
    if(!items.length)issues.push('в заказе нет товара');
    if(orderWarehouse(o)!==warehouseId())issues.push('заказ относится к другому складу');
    return uniq(issues)
  }
  function routeEngineSignature(def){
    const ordersShape=asArray(def?.orders).map(o=>({id:o.id,u:o.updatedAt||o.createdAt||'',d:o.deliveryDate,a:o.deliveryAddress,g:[Number(o.geo?.lat||0),Number(o.geo?.lon||0),o.geo?.region||'',o.geo?.district||''],w:orderWarehouse(o),i:asArray(o.items).map(i=>[i.productId||i.name,Number(i.qty||0),Number(i.volumeM3||0),Number(i.weightKg||0),Number(i.lengthMm||0),Number(i.widthMm||0),Number(i.heightMm||0),!!i.fragile,!!i.keepDry,!!i.topLoadOnly,!!i.longLoad])})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    return hashString(JSON.stringify({engine:ENGINE_VERSION,route:def?.id||'',mode:routeModeFor(def),orders:ordersShape,warehouse:[warehouseId(),settings.warehouse?.lat,settings.warehouse?.lon],rules:[settings.maxStops,settings.maxRoundKm,settings.minRouteHours,settings.maxRouteHours,settings.serviceMinMinutes,settings.serviceMaxMinutes],loading:[settings.loadingStartTime,settings.loadingBayCount,settings.loadingMinutes,settings.loadingIntervalMinutes,settings.driverArrivalLeadMinutes,settings.arrivalWindowMinutes,settings.loadingPriority]}))
  }

  const legacyValidRoutePlan=validRoutePlan;
  validRoutePlan=function(def){
    const p=routePlans?.[def?.id];if(!p)return null;
    if(p.engineSignature)return p.engineSignature===routeEngineSignature(def)?p:null;
    return legacyValidRoutePlan(def)
  };

  function routeCost(seq,matrix,returns){let cur=0,cost=0;for(const idx of seq){const n=Number(matrix?.duration?.[cur]?.[idx]);if(!Number.isFinite(n))return 1e15;cost+=n;cur=idx}if(returns){const n=Number(matrix?.duration?.[cur]?.[0]);if(!Number.isFinite(n))return 1e15;cost+=n}return cost}
  function exactSequence(def,matrix){
    const n=def.orders.length;if(n<2)return def.orders.map((_,i)=>i+1);if(n>11)return null;
    const size=1<<n,total=size*n,dp=new Float64Array(total),parent=new Int16Array(total);dp.fill(Infinity);parent.fill(-1);
    const at=(mask,j)=>mask*n+j;
    for(let j=0;j<n;j++)dp[at(1<<j,j)]=Number(matrix.duration?.[0]?.[j+1]??Infinity);
    for(let mask=1;mask<size;mask++)for(let j=0;j<n;j++)if(mask&(1<<j)){
      const cur=dp[at(mask,j)];if(!Number.isFinite(cur))continue;
      for(let k=0;k<n;k++)if(!(mask&(1<<k))){const next=mask|(1<<k),candidate=cur+Number(matrix.duration?.[j+1]?.[k+1]??Infinity),index=at(next,k);if(candidate+1e-7<dp[index]){dp[index]=candidate;parent[index]=j}}
    }
    const full=size-1,returns=returnsFor(def);let end=-1,best=Infinity;
    for(let j=0;j<n;j++){const value=dp[at(full,j)]+(returns?Number(matrix.duration?.[j+1]?.[0]??Infinity):0);if(value+1e-7<best){best=value;end=j}}
    if(end<0||!Number.isFinite(best))return null;
    const out=[];let mask=full,j=end;while(j>=0){out.push(j+1);const prev=parent[at(mask,j)];mask^=1<<j;j=prev}return out.reverse()
  }
  const legacyOptimize=optimizeRouteSequence;
  optimizeRouteSequence=function(def,matrix){
    const exact=exactSequence(def,matrix);if(exact)return exact;
    const candidates=[];try{candidates.push(legacyOptimize(def,matrix))}catch(_){}
    const indexes=def.orders.map((_,i)=>i+1),byDistance=[...indexes].sort((a,b)=>Number(matrix.duration?.[0]?.[b]||0)-Number(matrix.duration?.[0]?.[a]||0)||a-b);
    for(const start of byDistance.slice(0,Math.min(8,byDistance.length)))candidates.push(nearestSequenceFrom(def,matrix,start));
    const bearing=def.orders.map((o,i)=>({i:i+1,b:bearingFromDepot(o.geo),d:haversine(settings.warehouse,o.geo)})).sort((a,b)=>a.b-b.b||b.d-a.d).map(x=>x.i);
    for(let shift=0;shift<Math.min(8,bearing.length);shift++){const c=[...bearing.slice(shift),...bearing.slice(0,shift)];candidates.push(c,c.slice().reverse())}
    let best=null,bestCost=Infinity;const seen=new Set();for(const raw of candidates){if(!raw||raw.length!==indexes.length)continue;const key=raw.join(',');if(seen.has(key))continue;seen.add(key);let candidate=raw;try{candidate=improve2opt(improveRelocate(improve2opt(raw,matrix),matrix),matrix)}catch(_){}const cost=routeCost(candidate,matrix,returnsFor(def));if(cost+1e-7<bestCost){bestCost=cost;best=candidate}}
    return best||indexes
  };

  fallbackMatrix=function(points){
    const n=points.length,duration=Array.from({length:n},()=>Array(n).fill(0)),distance=Array.from({length:n},()=>Array(n).fill(0));
    for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j){const air=Math.max(0,haversine(points[i],points[j])),factor=air<8?1.18:air<35?1.25:air<100?1.31:1.36,km=air*factor,speed=km<8?30:km<35?42:km<100?53:63;distance[i][j]=km*1000;duration[i][j]=km/speed*3600}
    return{duration,distance,fallback:true,confidence:64,source:'local'}
  };

  buildSchedule=function(seq,matrix,def,startTime=settings.routeStartTime){
    const start=parseTime(startTime)??parseTime(settings.routeStartTime)??540;let cur=0,now=start,totalUnload=0,knownTravel=0;const out=[];
    for(let pos=0;pos<seq.length;pos++){
      const idx=seq[pos],o=def.orders[idx-1];if(!o)continue;const raw=Number(matrix?.duration?.[cur]?.[idx]||0)/60,travel=Math.max(0,Number.isFinite(raw)?raw:0),service=Math.max(0,Number(plannedUnloadMinutes(o)||0));now+=travel;knownTravel+=travel;const etaAbs=now,departAbs=now+service;
      out.push({orderId:o.id,position:pos+1,eta:typeof routeClockLabelV560==='function'?routeClockLabelV560(etaAbs):clockText(etaAbs),depart:typeof routeClockLabelV560==='function'?routeClockLabelV560(departAbs):clockText(departAbs),etaAbsMin:etaAbs,departAbsMin:departAbs,travelMin:Math.round(travel),serviceMin:service,distance:Number(matrix?.distance?.[cur]?.[idx]||0)});now=departAbs;totalUnload+=service;cur=idx
    }
    let returnTravel=0;if(returnsFor(def)){returnTravel=Math.max(0,Number(matrix?.duration?.[cur]?.[0]||0)/60);now+=returnTravel}
    return{stops:out,finish:typeof routeClockLabelV560==='function'?routeClockLabelV560(now):clockText(now),finishAbsMin:now,returnTravelMin:Math.round(returnTravel),unloadMinutes:Math.round(totalUnload),totalWithServiceMin:Math.round(now-start),startTime:clockText(start)}
  };

  calculateRoute=async function(def){
    if(!def?.orders?.length)throw new Error('Нет заказов с подтверждёнными координатами');
    const bad=def.orders.flatMap(o=>orderPlanningIssues(o).map(issue=>`${o.number||o.id}: ${issue}`));if(bad.length)throw new Error(bad.slice(0,4).join('; ')+(bad.length>4?'…':''));
    const points=[{lat:Number(settings.warehouse.lat),lon:Number(settings.warehouse.lon)},...def.orders.map(o=>({lat:Number(o.geo.lat),lon:Number(o.geo.lon)}))];let matrix;
    try{matrix=await osrmTable(points);matrix.source='osrm-table';matrix.confidence=92}catch(err){matrix=fallbackMatrix(points);matrix.warning=err.message}
    const returns=returnsFor(def),seq=optimizeRouteSequence(def,matrix),ordered=seq.map(i=>def.orders[i-1]).filter(Boolean),routePoints=[points[0],...seq.map(i=>points[i]),...(returns?[points[0]]:[])];let route=null;
    if(!matrix.fallback){try{route=await osrmRoute(routePoints)}catch(err){matrix.warning=(matrix.warning?matrix.warning+'; ':'')+err.message}}
    const slot=routeLoadingSlot(def),schedule=buildSchedule(seq,matrix,def,slot?.departureTime||settings.routeStartTime),distance=route?.distance??sequenceMetric(seq,matrix.distance,returns),duration=route?.duration??sequenceMetric(seq,matrix.duration,returns),roundDistance=returns?distance:sequenceMetric(seq,matrix.distance,true),roundDuration=returns?duration:sequenceMetric(seq,matrix.duration,true),confidence=route?100:matrix.fallback?64:84;
    const plan={id:def.id,engineVersion:ENGINE_VERSION,engineSignature:routeEngineSignature(def),signature:routeSignature(def.orders),calculatedAt:new Date().toISOString(),algorithm:def.orders.length<=11?'Точный динамический расчёт':'Мультистарт + 2-opt + relocate',orderedIds:ordered.map(o=>o.id),routeMode:routeModeFor(def),returnsToWarehouse:returns,distance,duration,roundDistance,roundDuration,startTime:schedule.startTime,loadingSlot:slot,finish:schedule.finish,finishAbsMin:schedule.finishAbsMin,returnTravelMin:schedule.returnTravelMin,totalWithServiceMin:schedule.totalWithServiceMin,unloadMinutes:schedule.unloadMinutes,schedule:schedule.stops.map(({etaAbsMin,departAbsMin,...x})=>x),geometry:route?.geometry||null,fallback:!!matrix.fallback,confidence,warning:matrix.warning||'',source:route?'OSRM дорожная сеть':matrix.fallback?'Локальная резервная модель':'OSRM матрица + резервная геометрия'};
    const payment=driverPaymentForPlan(plan,ordered.length);plan.driverPayment=payment.total;plan.driverPaymentDetails=payment;plan.rules=routeRuleMetrics(plan,ordered.length);return plan
  };

  function quickCandidateScore(order,cluster){
    const nearest=Math.min(...cluster.map(o=>haversine(o.geo,order.geo))),same=cluster.some(o=>orderDistrict(o)===orderDistrict(order)),angles=cluster.map(o=>bearingFromDepot(o.geo)),angle=Math.min(...angles.map(a=>angleDistance(a,bearingFromDepot(order)))),radial=Math.abs(haversine(settings.warehouse,order.geo)-cluster.reduce((s,o)=>s+haversine(settings.warehouse,o.geo),0)/cluster.length);return nearest*1.7+angle*.55+radial*.28+(same?-28:12)
  }
  function deterministicScalableSplit(list,maxStops){
    const sorted=[...list].sort((a,b)=>String(orderDistrict(a)).localeCompare(String(orderDistrict(b)),'ru')||Math.floor(bearingFromDepot(a.geo)/25)-Math.floor(bearingFromDepot(b.geo)/25)||haversine(settings.warehouse,b.geo)-haversine(settings.warehouse,a.geo)||String(a.id).localeCompare(String(b.id)));const out=[];for(let i=0;i<sorted.length;i+=maxStops)out.push(sorted.slice(i,i+maxStops));return out
  }
  splitCompact=function(ordersList,maxStops){
    const list=asArray(ordersList).filter(Boolean),limit=Math.max(1,Math.round(Number(maxStops||settings.maxStops||12)));if(list.length<=1)return list.length?[list]:[];if(list.length>420)return deterministicScalableSplit(list,limit);
    const remaining=new Map(list.map(o=>[o.id,o])),clusters=[];
    while(remaining.size){const seed=[...remaining.values()].sort((a,b)=>haversine(settings.warehouse,b.geo)-haversine(settings.warehouse,a.geo)||String(a.id).localeCompare(String(b.id)))[0],cluster=[seed];remaining.delete(seed.id);
      while(cluster.length<limit&&remaining.size){const shortlist=[...remaining.values()].map(o=>({o,s:quickCandidateScore(o,cluster)})).sort((a,b)=>a.s-b.s||String(a.o.id).localeCompare(String(b.o.id))).slice(0,Math.min(28,remaining.size));let winner=null;
        for(const x of shortlist){const candidate=[...cluster,x.o],assessment=assessRouteOrders(candidate);if(assessment.hardViolation)continue;const target=(Number(settings.minRouteHours||8)+Number(settings.maxRouteHours||11))*30,gap=Math.abs(target-assessment.rules.totalMin),score=x.s+gap*.045+assessment.rules.distanceKm*.2+(assessment.vehicle.best?driverSuitabilityScore(assessment.vehicle.best.driver,assessment.vehicle.best.fit)*.12:0);if(!winner||score<winner.score)winner={o:x.o,score}}
        if(!winner)break;cluster.push(winner.o);remaining.delete(winner.o.id)
      }clusters.push(cluster)
    }
    let changed=true,guard=0;while(changed&&guard++<8){changed=false;outer:for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){if(clusters[i].length+clusters[j].length>limit)continue;const joined=[...clusters[i],...clusters[j]],assessment=assessRouteOrders(joined);if(assessment.hardViolation)continue;const before=routePlanPenalty(assessRouteOrders(clusters[i]))+routePlanPenalty(assessRouteOrders(clusters[j])),after=routePlanPenalty(assessment);if(after+8<before){clusters[i]=joined;clusters.splice(j,1);changed=true;break outer}}}
    return clusters.filter(c=>c.length)
  };

  function scheduleChronological(plan){let last=-Infinity;for(const stop of asArray(plan?.schedule)){let value=Number(stop?.position||0);const text=String(stop?.eta||'');const m=text.match(/(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)\s*дн\.\))?/);if(m)value=(Number(m[3]||0)*1440)+(Number(m[1])*60)+Number(m[2]);if(value+1e-6<last)return false;last=value}return true}
  function planOrderMatches(def,plan){const a=asArray(def?.orders).map(o=>String(o.id)).sort(),b=asArray(plan?.orderedIds).map(String).sort();return a.length===b.length&&a.every((x,i)=>x===b[i])}
  routeFinalizationState=function(def,plan){
    const rules=routeRuleMetrics(plan,def.orders.length),assessment=assessRouteOrders(def.orders),stockShortages=inventoryShortagesForOrders(def.orders),hard=[],soft=[],warnings=[],orderIssues=[];
    for(const o of asArray(def.orders))for(const issue of orderPlanningIssues(o))orderIssues.push(`${o.number||o.id}: ${issue}`);
    if(orderIssues.length)hard.push(...orderIssues);
    if(!def.date)hard.push('не указана дата рейса');
    if(new Set(def.orders.map(o=>o.deliveryDate)).size>1)hard.push('в одном рейсе смешаны разные даты доставки');
    if(new Set(def.orders.map(orderWarehouse)).size>1||def.orders.some(o=>orderWarehouse(o)!==warehouseId()))hard.push('в одном рейсе смешаны разные склады');
    if(def.orders.length>Number(settings.maxStops||12))hard.push(`больше ${settings.maxStops} точек`);
    if(!planOrderMatches(def,plan))hard.push('порядок маршрута не соответствует составу рейса');
    if(!scheduleChronological(plan))hard.push('нарушена хронология времени прибытия');
    if(assessment.vehicle.blocked)hard.push('нет подходящего автомобиля');
    if(stockShortages.length)hard.push(`недостаточно товара на складе: ${stockShortages.slice(0,3).map(x=>`${x.product.name} −${roundQty(x.missing).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${x.product.unit}`).join(', ')}${stockShortages.length>3?'…':''}`);
    if(rules?.distanceOver)soft.push('превышен допустимый пробег');if(rules?.timeOver)soft.push('превышено рабочее время');if(assessment.geographyViolation)soft.push('точки находятся в разных направлениях');
    const override=routeOverride(def.id),approved=!!override?.approved&&String(override?.approvalNote||'').trim().length>=3;
    if(plan?.fallback)warnings.push('используется локальная оценка расстояния; перед выездом рекомендуется повторить дорожный расчёт');if(rules?.short)warnings.push('рейс короче установленной рабочей нормы');if(approved&&soft.length)warnings.push(`отклонения согласованы вручную: ${override.approvalNote}`);
    const reasons=[...hard,...(!approved?soft:[])];return{safe:reasons.length===0,rules,assessment,stockShortages,reasons:uniq(reasons),hardReasons:uniq(hard),softReasons:uniq(soft),warnings:uniq(warnings),manualApproved:approved}
  };

  function forceSplit(list){if(list.length<2)return[list];let chunks=splitCompact(list,Math.max(1,Math.min(Number(settings.maxStops||12),Math.ceil(list.length/2))));if(chunks.length>1&&chunks.every(c=>c.length<list.length))return chunks;const sorted=[...list].sort((a,b)=>bearingFromDepot(a.geo)-bearingFromDepot(b.geo)||haversine(settings.warehouse,b.geo)-haversine(settings.warehouse,a.geo)),mid=Math.ceil(sorted.length/2);return[sorted.slice(0,mid),sorted.slice(mid)].filter(Boolean).filter(c=>c.length)}
  async function calculateFinalizeV570(def,allowSplit=true,depth=0){
    const plan=await calculateRoute(def),finalization=routeFinalizationState(def,plan);plan.finalization=clone(finalization);plan.finalized=finalization.safe;plan.reviewReasons=finalization.reasons;plan.reviewWarnings=finalization.warnings;
    const splittable=allowSplit&&settings.smartRoute?.autoSplitOverload!==false&&depth<8&&def.orders.length>1&&!finalization.stockShortages.length&&!finalization.hardReasons.some(x=>/дата|склад|координат|адрес|товар|хронолог|составу/.test(x));
    if(splittable&&!finalization.safe){const chunks=forceSplit(def.orders);if(chunks.length>1&&chunks.every(c=>c.length<def.orders.length)){const children=materializeRouteChunks(def,chunks),result=[];for(const child of children)result.push(...await calculateFinalizeV570(child,true,depth+1));return result}}
    routePlans[def.id]=plan;if(finalization.safe)freezeRouteOrders(def);else releaseRouteLocks(def);persistRoutes();return[def]
  }
  calculateFinalizeRoute=calculateFinalizeV570;

  const legacyAutoAssign=autoAssignBestDrivers;
  autoAssignBestDrivers=function(defs=[]){
    const state=routeState(),targets=asArray(defs).filter(d=>d&&!activeExecution(d.id)),targetIds=new Set(targets.map(d=>d.id)),active=activeIds(),reservedByDate=new Map(),previous={...routeDriverAssignments};
    for(const [routeId,driverId] of Object.entries(routeDriverAssignments)){const def=state.allDefs.find(d=>d.id===routeId);if(!def)continue;if(active.has(routeId)||!targetIds.has(routeId)){if(!reservedByDate.has(def.date))reservedByDate.set(def.date,new Set());reservedByDate.get(def.date).add(driverId)}}
    const byDate=new Map();for(const def of targets){if(!byDate.has(def.date))byDate.set(def.date,[]);byDate.get(def.date).push(def)}
    for(const [date,dateDefs] of byDate){const reserved=reservedByDate.get(date)||new Set(),preserved=new Set();
      for(const def of dateDefs){const id=previous[def.id],driver=drivers.find(d=>d.id===id),plan=validRoutePlan(def);if(!driver||!plan||!driver.active||driverWarehouse(driver)!==warehouseId()||reserved.has(driver.id))continue;const fit=driverFitForRoute(driver,def.orders);if(fit.hasData&&!fit.fits)continue;routeDriverAssignments[def.id]=driver.id;reserved.add(driver.id);preserved.add(def.id)}
      const remaining=dateDefs.filter(def=>!preserved.has(def.id)&&validRoutePlan(def)&&routeFinalizationState(def,validRoutePlan(def)).safe);for(const def of remaining)delete routeDriverAssignments[def.id];const available=drivers.filter(d=>d.active&&driverWarehouse(d)===warehouseId()&&!reserved.has(d.id));if(!remaining.length||!available.length)continue;
      const BIG=1e8,UNASSIGNED=25000,columns=available.length+remaining.length,cost=remaining.map(def=>Array.from({length:columns},(_,col)=>{if(col>=available.length)return UNASSIGNED;const driver=available[col],fit=driverFitForRoute(driver,def.orders);if(fit.hasData&&!fit.fits)return BIG;let score=driverSuitabilityScore(driver,fit);if(driverIsAggregator?.(driver))score+=900;if(previous[def.id]===driver.id)score-=350;const slot=routeLoadingSlot(def);if(!slot)score+=150;return score})),assignment=minimumCostAssignment(cost);assignment.forEach((col,row)=>{if(col>=0&&col<available.length&&cost[row][col]<BIG/2){routeDriverAssignments[remaining[row].id]=available[col].id;reserved.add(available[col].id)}})
    }
    persistRouteDrivers();return repairDriverDateConflicts()
  };

  function snapshotState(){return{routeAssignments:clone(routeAssignments),routeCatalog:clone(routeCatalog),routeDriverAssignments:clone(routeDriverAssignments),routeLocks:clone(routeLocks),routePlans:clone(routePlans),routeOverrides:clone(routeOverrides)}}
  function restoreState(s){routeAssignments=s.routeAssignments;routeCatalog=s.routeCatalog;routeDriverAssignments=s.routeDriverAssignments;routeLocks=s.routeLocks;routePlans=s.routePlans;routeOverrides=s.routeOverrides;persistRouteAssignments();persistRouteDrivers();persistRouteLocks();persistRoutes();persistRouteOverrides()}
  function activeFingerprint(){const out={};for(const id of activeIds()){const e=routeExecutions[id];out[id]=JSON.stringify({e,plan:routePlans[id],driver:routeDriverAssignments[id],orders:asArray(e?.orderIds).map(oid=>[oid,routeAssignments[oid],routeLocks[oid]])})}return out}
  function activeFingerprintEqual(before){const after=activeFingerprint(),keys=uniq([...Object.keys(before),...Object.keys(after)]);return keys.every(k=>before[k]===after[k])}
  function cleanupStale(){const referenced=new Set([...Object.values(routeAssignments).filter(x=>x&&x!=='__unassigned__'),...Object.keys(routeExecutions||{}),...asArray(routeArchives).map(x=>x.id).filter(Boolean)]);for(const id of Object.keys(routeCatalog))if(!referenced.has(id)){delete routeCatalog[id];delete routePlans[id];delete routeDriverAssignments[id];delete routeOverrides[id]}persistRouteAssignments();persistRouteDrivers();persistRoutes();persistRouteOverrides()}

  function routeAudit(deep=false){
    const state=routeState(),membership=new Map(),duplicateOrders=[],lockErrors=[],planErrors=[],scheduleErrors=[],warehouseErrors=[],driverErrors=[],activeErrors=[],dataErrors=[];
    for(const def of state.allDefs){for(const o of [...asArray(def.orders),...asArray(def.unready)]){if(membership.has(o.id)&&membership.get(o.id)!==def.id)duplicateOrders.push(o.id);else membership.set(o.id,def.id);if(orderWarehouse(o)!==warehouseId())warehouseErrors.push(`${o.number||o.id}: другой склад`)}const plan=routePlans[def.id];if(plan){if(!planOrderMatches(def,plan))planErrors.push(def.id);if(!scheduleChronological(plan))scheduleErrors.push(def.id)}const driver=assignedDriverForRoute(def.id);if(driver&&!activeExecution(def.id)){const fit=driverFitForRoute(driver,def.orders);if(!driver.active||driverWarehouse(driver)!==warehouseId()||(fit.hasData&&!fit.fits))driverErrors.push(def.id)}}
    for(const [oid,rid] of Object.entries(routeLocks)){if(routeAssignments[oid]!==rid)lockErrors.push(oid)}
    for(const [id,e] of Object.entries(routeExecutions||{}))if(['in_transit','awaiting_close'].includes(e?.status)){for(const oid of asArray(e.orderIds))if(routeAssignments[oid]!==id||routeLocks[oid]!==id)activeErrors.push(`${id}:${oid}`);if(routeDriverAssignments[id]!==e.driverId)activeErrors.push(`${id}:driver`)}
    if(deep)for(const o of orders.filter(o=>!isPickup(o)&&!o.archived&&!isTerminalOrder(o)))for(const issue of orderPlanningIssues(o))if(!/другому складу/.test(issue))dataErrors.push(`${o.number||o.id}: ${issue}`);
    const critical=duplicateOrders.length+lockErrors.length+planErrors.length+scheduleErrors.length+activeErrors.length,problems=critical+warehouseErrors.length+driverErrors.length+dataErrors.length;
    const audit={at:new Date().toISOString(),routes:state.allDefs.length,orders:membership.size,critical,problems,duplicateOrders:uniq(duplicateOrders),lockErrors:uniq(lockErrors),planErrors:uniq(planErrors),scheduleErrors:uniq(scheduleErrors),warehouseErrors:uniq(warehouseErrors),driverErrors:uniq(driverErrors),activeErrors:uniq(activeErrors),dataErrors:uniq(dataErrors)};engine.lastAudit=audit;return audit
  }
  function repairIntegrity(){
    const active=activeIds(),orderIds=new Set(orders.map(o=>o.id));let fixes=0;
    for(const oid of Object.keys(routeAssignments)){const o=orders.find(x=>x.id===oid),rid=routeAssignments[oid];if(!orderIds.has(oid)||!o||((o.archived||isTerminalOrder(o)||isPickup(o))&&!active.has(rid))){delete routeAssignments[oid];delete routeLocks[oid];fixes++}}
    for(const [oid,rid] of Object.entries(routeLocks))if(routeAssignments[oid]!==rid){if(active.has(rid))routeAssignments[oid]=rid;else delete routeLocks[oid];fixes++}
    for(const [id,e] of Object.entries(routeExecutions||{}))if(['in_transit','awaiting_close'].includes(e?.status)){routeDriverAssignments[id]=e.driverId;for(const oid of asArray(e.orderIds)){if(orderIds.has(oid)){routeAssignments[oid]=id;routeLocks[oid]=id}}}
    for(const def of routeState().allDefs){const p=routePlans[def.id];if(p&&!planOrderMatches(def,p)&&!active.has(def.id)){delete routePlans[def.id];releaseRouteLocks(def);fixes++}else if(p&&!active.has(def.id)&&!scheduleChronological(p)){repairPlanScheduleV560(def,p);fixes++}}
    cleanupStale();persistRouteAssignments();persistRouteLocks();persistRouteDrivers();persistRoutes();return fixes
  }

  window.runRouteSystemAuditV570=function(show=true){const fixes=repairIntegrity(),audit=routeAudit(true);renderTripsPreview();const message=`Проверка маршрутов завершена.\n\nРейсов: ${audit.routes}\nЗаказов в рейсах: ${audit.orders}\nКритических нарушений: ${audit.critical}\nПроблем данных: ${audit.dataErrors.length}\nБезопасно исправлено: ${fixes}`;if(show)alert(message);return{fixes,audit}};

  buildAllRoutes=async function(){
    if(engine.building){alert('Построение маршрутов уже выполняется. Дождитесь завершения.');return}
    repairIntegrity();const active=activeIds(),state=routeState(),initial=state.allDefs.filter(def=>def.orders.length&&!active.has(def.id)&&!def.orders.some(o=>activeOrderIds().has(o.id))),readyPoints=initial.reduce((s,d)=>s+d.orders.length,0),unready=state.allDefs.reduce((s,d)=>s+d.unready.length,0);
    if(!initial.length){alert(active.size?'Нет изменяемых рейсов. Активные рейсы защищены от перестроения.':'Нет заказов с подтверждёнными координатами.');return}
    if(!await jfConfirm(`Полное перестроение системы маршрутов:\n\n• рейсов для расчёта: ${initial.length}\n• готовых точек: ${readyPoints}\n• адресов требуют исправления: ${unready}\n• активных рейсов защищено: ${active.size}\n\nСистема проверит даты, склады, географию, вместимость, остатки, нормативы, порядок точек, график погрузки и водителей. Продолжить?`,{title:'Перестроить маршруты',confirmLabel:'Перестроить'}))return;
    const snapshot=snapshotState(),activeBefore=activeFingerprint(),btn=$('buildRoutesBtn'),token=++engine.buildToken;engine.building=true;document.getElementById('tripsView')?.classList.add('route-engine-busy-v570');if(btn)btn.disabled=true;let finished=[];
    try{
      for(const def of initial){releaseRouteLocks(def);delete routePlans[def.id]}
      persistRoutes();persistRouteLocks();
      for(let i=0;i<initial.length;i++){if(token!==engine.buildToken)throw new Error('Расчёт отменён новой операцией');const def=initial[i];setProgress(`Маршрутный движок ${ENGINE_VERSION}: рейс ${i+1} из ${initial.length} · ${cleanRouteTitle(def.displayDistrict)}…`,true);finished.push(...await calculateFinalizeV570(def,true,0))}
      autoAssignBestDrivers(finished);repairAllRouteSchedulesV560();cleanupStale();if(!activeFingerprintEqual(activeBefore))throw new Error('Защита активного рейса обнаружила изменение данных и отменила перестроение');const audit=routeAudit(true);if(audit.critical)throw new Error(`Проверка целостности обнаружила критические нарушения: ${audit.critical}`);
      engine.lastBuild={at:new Date().toISOString(),routes:finished.length,orders:finished.reduce((s,d)=>s+d.orders.length,0),ready:finished.filter(d=>routeReadinessV560(d).ready).length,problems:finished.filter(d=>!routeReadinessV560(d).ready).length,activeProtected:active.size,algorithm:'exact<=11 / multistart>11'};try{localStorage.setItem(ENGINE_KEY,JSON.stringify(engine.lastBuild))}catch(_){}
      persistRouteAssignments();persistRouteLocks();persistRouteDrivers();persistRoutes();persistRouteOverrides();renderTripsPreview();renderOrders();renderDrivers();setProgress(`Перестроение завершено: ${engine.lastBuild.routes} рейс(ов), ${engine.lastBuild.orders} точек. Готовы к выезду: ${engine.lastBuild.ready}. Требуют решения: ${engine.lastBuild.problems}. Активных рейсов сохранено без изменений: ${active.size}.`,false,engine.lastBuild.problems>0)
    }catch(err){console.error(err);restoreState(snapshot);renderTripsPreview();renderOrders();renderDrivers();setProgress('Перестроение отменено без потери данных: '+(err?.message||err),false,true);alert('Изменения не применены. '+(err?.message||err))}
    finally{engine.building=false;document.getElementById('tripsView')?.classList.remove('route-engine-busy-v570');if(btn)btn.disabled=false}
  };

  buildSingleRoute=async function(id){
    if(engine.building)return;const def=routeState().allDefs.find(d=>d.id===id);if(!def||!def.orders.length||activeExecution(id))return;const snapshot=snapshotState();try{setProgress(`Точный пересчёт: ${cleanRouteTitle(def.displayDistrict)}…`,true);const result=await calculateFinalizeV570(def,true,0);autoAssignBestDrivers(result);repairAllRouteSchedulesV560();const audit=routeAudit(false);if(audit.critical)throw new Error('обнаружено нарушение целостности');activeRouteId=result[0]?.id||id;renderTripsPreview();renderOrders();renderDrivers();setProgress(`Рейс пересчитан: ${result.length} маршрут(ов).`,false,result.some(d=>!routeReadinessV560(d).ready));if(activeRouteId)showRouteOnMap(activeRouteId,false)}catch(err){restoreState(snapshot);renderTripsPreview();setProgress('Пересчёт отменён: '+(err?.message||err),false,true)}
  };

  const legacyReadiness=routeReadinessV560;
  routeReadinessV560=function(def,plan=validRoutePlan(def)){
    const execution=activeExecution(def?.id),driver=assignedDriverForRoute(def?.id),checks=[],reasons=[],warnings=[];const add=(ok,label,reason='',action='')=>{ok=!!ok;checks.push({ok,label,reason:ok?'':String(reason||''),action:ok?'':String(action||'')});if(!ok&&reason)reasons.push(String(reason))};
    if(execution)return{ready:false,execution:true,status:execution.status,reasons:[],warnings:[],checks,driver:execution.driverSnapshot||driver,plan:execution.planSnapshot||plan};
    const all=asArray(def?.orders),dateSet=new Set(all.map(o=>o.deliveryDate));add(!!def?.date&&dateSet.size<=1,'Единая дата доставки',!def?.date?'не указана дата доставки':'в рейсе смешаны разные даты','Исправить состав');add(all.length>0,'В рейсе есть точки','в рейсе нет готовых точек','Изменить состав');add(!def?.unready?.length,'Все адреса подтверждены',def?.unready?.length?`${def.unready.length} заказ(ов) без координат`:'','Исправить адреса');add(all.every(o=>orderWarehouse(o)===warehouseId()),'Один склад',all.some(o=>orderWarehouse(o)!==warehouseId())?'обнаружены заказы другого склада':'','Разделить склады');add(!!plan,'Маршрут рассчитан','маршрут не рассчитан','Рассчитать');
    if(plan){const final=routeFinalizationState(def,plan),rules=routeRuleMetrics(plan,all.length);add(final.safe,'План прошёл полную проверку',final.reasons.join(', '),'Исправить маршрут');add(planOrderMatches(def,plan),'Состав и порядок синхронизированы','маршрут устарел относительно состава','Пересчитать');add(scheduleChronological(plan),'Время точек идёт по порядку','обнаружена ошибка временного графика','Пересчитать');add(!rules?.hardViolation||final.manualApproved,'Пробег и время согласованы',rules?.hardViolation?rules.label:'','Разделить или согласовать');if(plan.fallback)warnings.push('используется резервная оценка расстояния');if(Number(plan.confidence||0)<80)warnings.push(`достоверность маршрута ${Number(plan.confidence||0)}%`);warnings.push(...asArray(final.warnings))}
    const shortages=all.length?inventoryShortagesForOrders(all):[];add(!shortages.length,'Товар доступен на складе',shortages.length?`недостаточно товара: ${shortages.slice(0,2).map(x=>x.product.name).join(', ')}`:'','Проверить склад');add(!!driver,'Исполнитель назначен','водитель не назначен','Назначить водителя');if(driver){add(driver.active!==false,'Исполнитель активен',driver.active===false?'исполнитель недоступен':'','Сменить');add(driverWarehouse(driver)===warehouseId(),'Исполнитель относится к складу',driverWarehouse(driver)!==warehouseId()?'исполнитель другого склада':'','Сменить');const fit=driverFitForRoute(driver,all);add(!fit.hasData||fit.fits,'Автомобиль вмещает груз',fit.hasData&&!fit.fits?fit.reasons.join(', '):'','Сменить автомобиль');const conflict=driverConflictForRoute(driver.id,def);add(!conflict.busy,'Нет пересечения по дате',conflict.busy?`исполнитель занят: ${conflict.names}`:'','Сменить');if(driverIsAggregator(driver)){const ov=routeOverride(def.id),pay=plan?driverPaymentForDriver(plan,all.length,driver,true):null;add(!!ov.externalOrderNumber,'Заявка агрегатора подтверждена',!ov.externalOrderNumber?'не указан номер заявки':'','Внести заявку');add(!pay?.requiresQuote,'Стоимость агрегатора подтверждена',pay?.requiresQuote?'не указана фактическая стоимость':'','Внести стоимость')}}const slot=routeLoadingSlot(def);add(!!slot,'Слот подачи и погрузки назначен','не удалось назначить время подачи','Проверить настройки');return{ready:reasons.length===0,execution:false,status:'',reasons:uniq(reasons),warnings:uniq(warnings),checks,driver,plan}
  };

  const legacyChecklist=routeChecklistHtmlV560;
  routeChecklistHtmlV560=function(readiness,lifecycle){const html=legacyChecklist(readiness,lifecycle);if(readiness.execution)return html;const box=document.createElement('div');box.innerHTML=html;box.querySelectorAll('.route-check.bad').forEach((el,i)=>{const action=readiness.checks.filter(x=>!x.ok)[i]?.action;if(action)el.querySelector('span')?.insertAdjacentHTML('beforeend',`<em class="route-check-action-v570">${escapeHtml(action)}</em>`)});return box.innerHTML};

  const legacyRouteState=routeState;
  routeState=function(){const state=legacyRouteState();for(const def of state.allDefs){const title=cleanRouteTitle(routeCatalog[def.id]?.title||def.displayDistrict||def.district);def.displayDistrict=title;if(routeCatalog[def.id])routeCatalog[def.id].title=title}const priority=def=>{const ex=activeExecution(def.id);if(ex?.status==='in_transit')return 0;if(ex?.status==='awaiting_close')return 1;const p=validRoutePlan(def),d=assignedDriverForRoute(def.id);if(p&&d)return 2;if(p)return 3;return 4};state.defs.sort((a,b)=>priority(a)-priority(b)||(a.date||'').localeCompare(b.date||'')||String(a.displayDistrict).localeCompare(String(b.displayDistrict),'ru'));return state};

  function diagnosticsForCard(card){
    const id=String(card?.id||'').replace(/^routeCard-/,'');if(!id)return;const def=routeState().allDefs.find(d=>d.id===id),plan=def?validRoutePlan(def):null,details=card.querySelector('.route-detail-content-v563')||card.querySelector('.route-card-details');if(!def||!details)return;details.querySelector('.route-engine-diagnostics-v570')?.remove();if(!plan)return;
    const ordered=asArray(plan.orderedIds).map(oid=>def.orders.find(o=>o.id===oid)).filter(Boolean),loading=[...ordered].reverse(),confidence=Number(plan.confidence||0),tone=confidence>=90?'':confidence>=70?'warn':'bad',confidenceText=confidence>0?`${confidence}%`:'не рассчитана';const panel=document.createElement('div');panel.className='route-engine-diagnostics-v570';panel.innerHTML=`<div class="route-engine-diagnostics-head-v570"><b>Логика построения маршрута</b><span class="route-plan-confidence-v570 ${tone}">Достоверность: ${confidenceText}</span></div><div class="route-engine-diagnostics-grid-v570"><div class="route-engine-diagnostics-cell-v570"><span>Алгоритм</span><b>${escapeHtml(plan.algorithm||'Оптимизация маршрута')}</b></div><div class="route-engine-diagnostics-cell-v570"><span>Схема</span><b>${plan.returnsToWarehouse?'Склад → точки → склад':'Склад → точки'}</b></div><div class="route-engine-diagnostics-cell-v570"><span>Источник</span><b>${escapeHtml(plan.source|| (plan.fallback?'Резервная оценка':'Дорожная сеть'))}</b></div><div class="route-engine-diagnostics-cell-v570"><span>Завершение</span><b>${escapeHtml(plan.finish||'—')}</b></div></div><div class="route-loading-order-v570"><b>Порядок погрузки:</b> ${loading.length?loading.map((o,i)=>`${i+1}. ${escapeHtml(o.number||short(o.deliveryAddress,24))}`).join(' → '):'—'}<br><span>Первая точка доставки загружается последней и остаётся ближе к выходу из кузова.</span></div>`;const anchor=details.querySelector('.route-live-summary-v565,.route-readiness-panel,.route-lock-banner');if(anchor)anchor.insertAdjacentElement('afterend',panel);else details.insertBefore(panel,details.firstChild)
  }
  function auditPanel(){const summary=$('routeSummary');if(!summary)return;summary.querySelector('.route-engine-audit-v570')?.remove();const audit=routeAudit(false),last=engine.lastBuild,ready=routeState().defs.filter(d=>routeReadinessV560(d).ready).length,panel=document.createElement('div');panel.className='route-engine-audit-v570';panel.innerHTML=`<div class="route-engine-audit-main-v570"><b>Маршрутный движок ${ENGINE_VERSION}</b><span>${last?`Последнее перестроение: ${formatDateTime(last.at)} · ${last.routes} рейс(ов), ${last.orders} точек.`:'Система готова к полному построению и проверке целостности.'}</span></div><div class="route-engine-audit-metric-v570"><span>Рейсов</span><b>${audit.routes}</b></div><div class="route-engine-audit-metric-v570"><span>Готовы</span><b>${ready}</b></div><div class="route-engine-audit-metric-v570 ${audit.critical?'bad':''}"><span>Критические</span><b>${audit.critical}</b></div><div class="route-engine-audit-metric-v570 ${audit.problems?'warn':''}"><span>Замечания</span><b>${audit.problems}</b></div><div class="route-engine-audit-actions-v570"><button type="button" class="btn-soft" data-jf-onclick="runRouteSystemAuditV570(true)">Проверить систему</button><button type="button" class="btn-primary" data-jf-onclick="buildAllRoutes()">Перестроить всё</button></div>`;summary.appendChild(panel)}
  function decorate(){auditPanel();document.querySelectorAll('#tripsArea .route-card').forEach(diagnosticsForCard)}
  const legacyRender=renderTripsPreview;
  renderTripsPreview=function(){const result=legacyRender();decorate();return result};

  const legacyAdd=addOrderToRoute;
  addOrderToRoute=function(routeId,orderId){const def=routeState().allDefs.find(d=>d.id===routeId),o=orders.find(x=>x.id===orderId);if(!def||!o)return;if(activeExecution(routeId)){alert('Выполняемый рейс защищён от изменения состава.');return}const issues=orderPlanningIssues(o).filter(x=>!/самовывоз|закрыт/.test(x));if(issues.length){alert(`Заказ нельзя добавить в рейс:\n• ${issues.join('\n• ')}`);return}if(def.date&&def.date!==o.deliveryDate){alert('Нельзя объединять заказы с разными датами доставки.');return}if(orderWarehouse(o)!==warehouseId()){alert('Нельзя добавить заказ другого склада.');return}const assigned=assignedDriverForRoute(routeId);if(assigned){const fit=driverFitForRoute(assigned,[...def.orders,o]);if(fit.hasData&&!fit.fits){alert('После добавления заказа назначенный автомобиль не вместит груз: '+fit.reasons.join(', '));return}}return legacyAdd(routeId,orderId)};

  const legacyStart=startRoute;
  startRoute=function(routeId){if(engine.startLocks.has(routeId))return;if(activeExecution(routeId)){alert('Рейс уже находится в работе.');return}const readiness=routeReadinessV560(routeState().allDefs.find(d=>d.id===routeId));if(!readiness.ready){alert('Выезд запрещён:\n'+readiness.reasons.map(x=>'• '+x).join('\n'));renderTripsPreview();return}engine.startLocks.add(routeId);try{return legacyStart(routeId)}finally{setTimeout(()=>engine.startLocks.delete(routeId),500)}};

  const legacyDiagnostics=runDataDiagnostics;
  runDataDiagnostics=function(showResult=false){const base=legacyDiagnostics(false),routeFixes=repairIntegrity(),audit=routeAudit(true),total=base+routeFixes;const msg=total?`Проверка завершена. Исправлено проблем: ${total}. Критических ошибок маршрутов: ${audit.critical}.`:`Проверка завершена. Ошибок в базе и маршрутах не обнаружено.`;if($('diagnosticStatus'))$('diagnosticStatus').textContent=`Версия системы: ${APP_VERSION} · ${msg}`;if(showResult)alert(msg);return total};

  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{repairIntegrity();if($('tripsView')?.style.display!=='none')renderTripsPreview()},60));
  setTimeout(()=>{try{repairIntegrity();decorate()}catch(err){console.error('Route engine init',err)}},0)
})();
/* ===== END PERFECT ROUTE ENGINE LOGIC v5.7.0 ===== */
