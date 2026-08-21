
(function(){
  'use strict';
  const state={raf:0,generation:0,tileLayer:null,tileErrors:0,lastRoute:'',lastSize:'',deferBase:false};
  const byId=id=>document.getElementById(id);
  const mapElement=()=>byId('routesMap');
  function visibleSize(el){
    if(!el||!el.isConnected)return null;
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    if(style.display==='none'||style.visibility==='hidden'||rect.width<240||rect.height<220)return null;
    return{width:Math.round(rect.width),height:Math.round(rect.height)};
  }
  function destroyRoutesMap(){
    cancelAnimationFrame(state.raf);
    try{routesMap?.off?.()}catch(_){ }
    try{routesMap?.remove?.()}catch(_){ }
    routesMap=null;routesLayer=null;state.tileLayer=null;state.tileErrors=0;
    const el=mapElement();if(el){el.innerHTML='';delete el.dataset.mapError;el.classList.remove('route-map-loading-v594')}
  }
  function attachTiles(map){
    const reliableLayer=window.JustFunMapReliabilityV772?.createLayer?.(map,{mapId:'routesMap'});
    if(reliableLayer){state.tileLayer=reliableLayer;return reliableLayer}
    const url=(settings?.tileUrl||DEFAULTS?.tileUrl||'https://tile.openstreetmap.org/{z}/{x}/{y}.png').trim();
    const layer=L.tileLayer(url,{maxZoom:19,minZoom:2,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:3,reuseTiles:true,attribution:''});
    state.tileErrors=0;
    layer.on('tileerror',()=>{state.tileErrors++});
    layer.addTo(map);state.tileLayer=layer;return layer;
  }
  const legacyEnsureRoutesMap=window.ensureRoutesMap;
  window.ensureRoutesMap=ensureRoutesMap=function(){
    const el=mapElement();if(!el||state.deferBase)return false;
    if(!window.L){showMapUnavailable('routesMap');return false}
    const size=visibleSize(el);if(!size)return false;
    if(routesMap){
      const known=routesMap.getSize?.();
      if((known?.x||0)>=200&&(known?.y||0)>=180)return true;
      destroyRoutesMap();
    }
    el.innerHTML='';delete el.dataset.mapError;el.classList.remove('route-map-loading-v594');
    routesMap=L.map(el,{attributionControl:false,zoomControl:true,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false,preferCanvas:true});
    attachTiles(routesMap);
    routesLayer=L.layerGroup().addTo(routesMap);
    state.lastSize=`${size.width}x${size.height}`;
    return true;
  };
  function routeData(id){
    const def=routeState().allDefs.find(d=>String(d.id)===String(id));if(!def)return null;
    const plan=validRoutePlan(def),ordered=plan?.orderedIds?.map(oid=>def.orders.find(o=>o.id===oid)).filter(Boolean)||previewOrderedOrders(def),rules=plan?routeRuleMetrics(plan,ordered.length):null,driver=assignedDriverForRoute(def.id);
    return{def,plan,ordered,rules,driver};
  }
  function drawRoute(id){
    const data=routeData(id);if(!data||!ensureRoutesMap())return false;
    const{def,plan,ordered,rules,driver}=data,title=byId('routeMapTitle'),meta=byId('routeMapMeta');
    if(title)title.textContent=def.displayDistrict||def.district||'Выбранный рейс';
    if(meta)meta.textContent=plan?`${ordered.length} точек · ${formatKm(plan.distance)} · ${formatDuration(rules.totalMin)}${driver?` · ${driver.name}`:''}`:`${ordered.length} точек · ожидает дорожного расчёта`;
    routesLayer.clearLayers();
    const depot=[Number(settings.warehouse.lat),Number(settings.warehouse.lon)],bounds=[depot];
    L.marker(depot,{icon:numberedIcon('С','depot-marker')}).bindPopup(`<b>Склад</b><br>${escapeHtml(settings.warehouse.address)}`).addTo(routesLayer);
    ordered.forEach((o,i)=>{const lat=Number(o.geo?.lat),lon=Number(o.geo?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;const point=[lat,lon];bounds.push(point);L.marker(point,{icon:numberedIcon(i+1)}).bindPopup(`<b>${i+1}. ${escapeHtml(o.number)}</b><br>${escapeHtml(o.deliveryAddress)}<br>${escapeHtml(o.contactName)} · ${escapeHtml(o.contactMethod)}`).addTo(routesLayer)});
    if(plan?.geometry){L.geoJSON(plan.geometry,{style:{weight:5,opacity:.82}}).addTo(routesLayer)}else if(bounds.length>1)L.polyline(routeReturnsToWarehouse()?[...bounds,depot]:bounds,{weight:3,dashArray:'8,8',opacity:.6}).addTo(routesLayer);
    routesMap.invalidateSize({pan:false,animate:false,debounceMoveend:true});
    if(bounds.length>1)routesMap.fitBounds(L.latLngBounds(bounds),{padding:[30,30],animate:false,maxZoom:13});else routesMap.setView(depot,12,{animate:false});
    return true;
  }
  function waitStable(id,generation,last='',stable=0,frames=0){
    if(generation!==state.generation)return;
    const el=mapElement(),size=visibleSize(el);if(!size){if(frames<40)state.raf=requestAnimationFrame(()=>waitStable(id,generation,last,0,frames+1));return}
    const key=size.width+'x'+size.height,nextStable=key===last?stable+1:0;
    if(nextStable>=2||frames>=40){drawRoute(id);requestAnimationFrame(()=>{if(generation===state.generation)routesMap?.invalidateSize?.({pan:false,animate:false,debounceMoveend:true})});return}
    state.raf=requestAnimationFrame(()=>waitStable(id,generation,key,nextStable,frames+1));
  }
  function scheduleRouteMapV594(id,reset=true){
    id=String(id||'');if(!id)return;
    state.lastRoute=id;if(reset)state.generation++;
    cancelAnimationFrame(state.raf);const generation=state.generation;
    state.raf=requestAnimationFrame(()=>waitStable(id,generation));
  }
  window.scheduleRouteMapV594=scheduleRouteMapV594;
  window.runStableRouteMapUpdateV594=function(id,update){
    let result;state.deferBase=true;
    try{result=typeof update==='function'?update():undefined}finally{state.deferBase=false}
    scheduleRouteMapV594(id,true);return result;
  };
  document.addEventListener('jf:route-opened',event=>{const id=String(event.detail?.routeId||'');if(id&&id!==state.lastRoute)scheduleRouteMapV594(id,true)});
  window.JustFunOverrides.wrap('clearRoutesMap','route-map-loading-v594',previousClear=>function(){if(!visibleSize(mapElement()))return;return previousClear?.apply(this,arguments)});
  function init(){const id=String(activeRouteId||window.activeRouteId||'');if(routesMap&&!visibleSize(mapElement()))destroyRoutesMap();if(id)scheduleRouteMapV594(id,true)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
