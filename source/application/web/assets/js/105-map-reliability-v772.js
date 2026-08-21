/* JustFun Orders & Logistics 7.8.3 — one tile service and stable Leaflet lifecycle */
(()=>{
'use strict';
const VERSION='7.8.3';
const MAP_IDS=['warehouseMap','orderMap','routesMap'];
const DEFAULT_TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const mapLayers=new WeakMap(),mapState=new WeakMap(),observed=new WeakSet(),pendingRefreshTimers=new WeakMap();
let resizeObserver=null,initialized=false;
let disposed=false;

function elementOf(target){
  if(typeof target==='string')return globalThis.document?.getElementById(target)||null;
  if(target?.getContainer)return target.getContainer();
  return target?.nodeType===1?target:null;
}
function instanceOf(id){
  try{
    if(id==='warehouseMap'&&typeof warehouseMap!=='undefined')return warehouseMap;
    if(id==='orderMap'&&typeof orderMap!=='undefined')return orderMap;
    if(id==='routesMap'&&typeof routesMap!=='undefined')return routesMap;
  }catch(error){console.error(`[map:${id}] instance lookup failed`,error)}
  return null;
}
function ensureInstance(id){
  if(disposed||!globalThis.document)return null;
  let map=instanceOf(id);if(map)return map;
  try{
    if(id==='warehouseMap'&&typeof ensureWarehouseMap==='function')ensureWarehouseMap();
    else if(id==='orderMap'&&document.getElementById('orderModal')?.classList.contains('open')&&typeof ensureOrderMap==='function')ensureOrderMap();
    else if(id==='routesMap'&&typeof ensureRoutesMap==='function')ensureRoutesMap();
  }catch(error){console.error(`[map:${id}] initialization failed`,error)}
  return instanceOf(id);
}
function visibleGeometry(el){
  if(!el||!el.isConnected||el.closest('[hidden]'))return null;
  const style=getComputedStyle(el),rect=el.getBoundingClientRect();
  if(style.display==='none'||style.visibility==='hidden'||rect.width<80||rect.height<80)return null;
  return{width:Math.round(rect.width),height:Math.round(rect.height)};
}
function configuredTileUrl(){
  let configured='';
  try{configured=(typeof settings!=='undefined'&&settings?.tileUrl)||(typeof DEFAULTS!=='undefined'&&DEFAULTS?.tileUrl)||''}catch{}
  const candidate=String(configured||DEFAULT_TILE_URL).trim();
  try{
    const probe=new URL(candidate.replace('{z}','1').replace('{x}','1').replace('{y}','1'));
    if(probe.protocol==='https:'&&candidate.includes('{z}')&&candidate.includes('{x}')&&candidate.includes('{y}'))return candidate;
  }catch{}
  console.error('[map] Invalid tile URL; using the built-in HTTPS endpoint');
  return DEFAULT_TILE_URL;
}
function endpointName(url){try{return new URL(url.replace('{z}','1').replace('{x}','1').replace('{y}','1')).hostname}catch{return'неизвестный сервер'}}
function removeOverlay(el){el?.querySelector(':scope > .jf-map-error-v772')?.remove();el?.classList.remove('jf-map-error-visible-v772')}
function showOverlay(map,message){
  const el=elementOf(map);if(!el||el.querySelector(':scope > .jf-map-error-v772'))return;
  const panel=document.createElement('div');panel.className='jf-map-error-v772';panel.setAttribute('role','alert');
  const text=document.createElement('div');text.innerHTML='<b>Карта не загрузилась</b><span></span>';text.querySelector('span').textContent=message;
  const retry=document.createElement('button');retry.type='button';retry.className='btn-soft';retry.textContent='Повторить загрузку';
  retry.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();removeOverlay(el);retryLayer(map)});
  panel.append(text,retry);el.append(panel);el.classList.add('jf-map-error-visible-v772');
}
function stateFor(map){
  let state=mapState.get(map);
  if(!state){
    state={loaded:0,errors:0,reported:false,timer:null,lastGeometry:'',refreshTimer:null,stableCenter:null,stableZoom:null,refreshing:false};
    mapState.set(map,state);
    const rememberView=()=>{
      if(state.refreshing)return;
      try{const center=map.getCenter(),zoom=map.getZoom();state.stableCenter={lat:center.lat,lng:center.lng};state.stableZoom=zoom}catch{}
    };
    rememberView();
    map.on?.('moveend zoomend',rememberView);
  }
  return state;
}
function startWatch(map,url){
  const state=stateFor(map);clearTimeout(state.timer);state.loaded=0;state.errors=0;state.reported=false;
  const el=elementOf(map);el?.classList.add('jf-map-loading-v772');removeOverlay(el);
  state.timer=setTimeout(()=>{
    if(state.loaded===0)showOverlay(map,`Нет ответа от ${endpointName(url)}. Проверьте интернет, VPN/антивирус и нажмите «Повторить загрузку».`);
  },12000);
}
function reportFailure(map,url,error){
  const state=stateFor(map);if(state.reported)return;state.reported=true;
  const id=elementOf(map)?.id||'unknown';
  console.error(`[map:${id}] tile service unavailable`,{host:endpointName(url),error:String(error?.message||error||'tileerror')});
}
function monitorLayer(map,layer,url){
  layer.on('loading',()=>startWatch(map,url));
  layer.on('tileload',()=>{const state=stateFor(map);state.loaded++;if(state.loaded===1){clearTimeout(state.timer);removeOverlay(elementOf(map))}});
  layer.on('tileerror',event=>{
    const state=stateFor(map);state.errors++;
    if(state.errors>=4&&state.loaded===0){clearTimeout(state.timer);reportFailure(map,url,event?.error);showOverlay(map,`Тайлы с ${endpointName(url)} не получены. Проверьте интернет или адрес сервиса карты в настройках программы.`)}
  });
  layer.on('load',()=>{const state=stateFor(map);clearTimeout(state.timer);elementOf(map)?.classList.remove('jf-map-loading-v772');if(state.loaded>0)removeOverlay(elementOf(map));else if(state.errors)showOverlay(map,`Сервис ${endpointName(url)} не вернул ни одного тайла.`)});
  return layer;
}
function createLayer(map,options={}){
  if(!map||!globalThis.L)return null;
  const existing=mapLayers.get(map);if(existing&&map.hasLayer?.(existing))return existing;
  const url=configuredTileUrl();
  const layer=L.tileLayer(url,{
    maxZoom:19,minZoom:2,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2,
    attribution:'',
    ...options.tileOptions
  });
  monitorLayer(map,layer,url);layer.addTo(map);mapLayers.set(map,layer);return layer;
}
function retryLayer(map){
  const layer=mapLayers.get(map);if(!layer)return;
  const state=stateFor(map);state.loaded=0;state.errors=0;state.reported=false;
  try{map.invalidateSize({pan:false,animate:false,debounceMoveend:true});layer.redraw()}catch(error){reportFailure(map,configuredTileUrl(),error)}
}
function refreshNow(target){
  const el=elementOf(target);if(!el||!MAP_IDS.includes(el.id))return false;
  const geometry=visibleGeometry(el);if(!geometry)return false;
  const map=ensureInstance(el.id);if(!map)return false;
  const state=stateFor(map),key=`${geometry.width}x${geometry.height}`;
  state.refreshing=true;
  try{
    map.invalidateSize({pan:false,animate:false,debounceMoveend:true});
    state.lastGeometry=key;
    return true;
  }catch(error){console.error(`[map:${el.id}] geometry refresh failed`,error);return false}
  finally{state.refreshing=false}
}
function schedule(target,delay=80){
  if(disposed||!globalThis.document)return false;
  const el=elementOf(target);if(!el||!MAP_IDS.includes(el.id))return false;
  if(!visibleGeometry(el))return false;
  const map=instanceOf(el.id),state=map?stateFor(map):null,previous=state?.refreshTimer||pendingRefreshTimers.get(el);clearTimeout(previous);
  const timer=setTimeout(()=>{
    pendingRefreshTimers.delete(el);
    if(disposed||!globalThis.document)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!disposed&&globalThis.document)refreshNow(el)}));
  },Math.max(0,delay));
  if(state)state.refreshTimer=timer;else pendingRefreshTimers.set(el,timer);
  return true;
}
function observeMaps(){
  if(disposed||!globalThis.document)return;
  if(!resizeObserver&&typeof ResizeObserver==='function')resizeObserver=new ResizeObserver(entries=>{
    for(const entry of entries){const el=entry.target,geometry=visibleGeometry(el);if(!geometry)continue;const map=instanceOf(el.id);const previous=map?stateFor(map).lastGeometry:'';const next=`${geometry.width}x${geometry.height}`;if(previous!==next)schedule(el,40)}
  });
  for(const id of MAP_IDS){const el=globalThis.document.getElementById(id);if(!el||observed.has(el))continue;observed.add(el);resizeObserver?.observe(el)}
}
function scheduleVisibleMaps(){
  if(disposed||!globalThis.document)return;
  observeMaps();for(const id of MAP_IDS)if(visibleGeometry(globalThis.document.getElementById(id)))schedule(id,100)
}
function dispose(){
  if(disposed)return;disposed=true;
  resizeObserver?.disconnect();
  for(const id of MAP_IDS){const el=globalThis.document?.getElementById(id);if(el)clearTimeout(pendingRefreshTimers.get(el));const map=instanceOf(id);if(!map)continue;const state=mapState.get(map);if(state){clearTimeout(state.timer);clearTimeout(state.refreshTimer)}}
}
function init(){
  if(initialized||!globalThis.document)return;initialized=true;disposed=false;observeMaps();
  document.addEventListener('click',event=>{if(event.target.closest('.settings-accordion-toggle-v610,[data-map-refresh]'))setTimeout(scheduleVisibleMaps,0)},true);
  window.addEventListener('resize',scheduleVisibleMaps,{passive:true});
  window.addEventListener('pagehide',dispose,{once:true});
  window.addEventListener('unload',dispose,{once:true});
  scheduleVisibleMaps();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.JustFunMapReliabilityV772=Object.freeze({version:VERSION,createLayer,schedule,refresh:refreshNow,dispose,retry:target=>{const el=elementOf(target);const map=el?.id?instanceOf(el.id):target;return map?retryLayer(map):false},status:target=>{const el=elementOf(target);const map=el?.id?instanceOf(el.id):target;return map?{...stateFor(map),layer:!!mapLayers.get(map)}:null}});
})();
