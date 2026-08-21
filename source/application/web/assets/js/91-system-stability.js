
(function(){
  'use strict';
  const overrides=window.JustFunOverrides;
  if(!overrides)throw new Error('JustFunOverrides is not loaded');
  const state={active:'',rendering:false,pending:'',raf:0,bound:false,operation:0};
  const legacyRenderTrips=window.renderTripsPreview;
  const legacyRenderCard=window.renderRouteCard;
  const legacyShowMap=window.showRouteOnMap;
  const $id=id=>document.getElementById(id);
  const area=()=>$id('tripsArea');
  const mapWrap=()=>document.querySelector('#tripsView .route-map-wrap');
  const cardFor=id=>$id('routeCard-'+id);
  const routeIdFromCard=card=>String(card?.id||'').replace(/^routeCard-/,'');
  const notify=(name,detail={})=>document.dispatchEvent(new CustomEvent(name,{detail}));
  function setActiveValue(id){
    const value=id?String(id):null;
    state.active=value||'';
    try{activeRouteId=value}catch(_){ }
    try{window.activeRouteId=value}catch(_){ }
  }
  function ensureMapHome(){
    let home=$id('routeMapHomeV590');
    const wrap=mapWrap();
    if(!home){
      home=document.createElement('div');home.id='routeMapHomeV590';home.className='route-map-home-v590';
      if(wrap?.parentNode)wrap.parentNode.insertBefore(home,wrap);
    }
    if(wrap&&wrap.parentElement!==home&&!wrap.closest('.route-map-slot-v590'))home.appendChild(wrap);
    home.classList.toggle('route-map-home-empty-v590',wrap?.parentElement!==home);
    return home;
  }
  function prepareDetails(card){
    const details=card?.querySelector(':scope > .route-card-details');
    if(!details)return null;
    let grid=details.querySelector(':scope > .route-details-grid-v590');
    if(!grid){
      grid=document.createElement('div');grid.className='route-details-grid-v590';
      const main=document.createElement('div');main.className='route-details-main-v590';
      while(details.firstChild)main.appendChild(details.firstChild);
      grid.append(main);details.appendChild(grid);
    }
    let slot=grid.querySelector(':scope > .route-map-slot-v590');
    if(!slot){
      slot=document.createElement('aside');
      slot.className='route-map-slot-v590';
      slot.setAttribute('aria-label','Карта выбранного рейса');
      grid.appendChild(slot);
    }
    return slot;
  }
  function normalizeCard(card){
    if(!card)return;
    const id=routeIdFromCard(card);if(!id)return;
    card.removeAttribute('data-jf-onclick');card.dataset.routeId=id;
    const head=card.querySelector(':scope > .route-head');
    if(head){head.setAttribute('role','button');head.setAttribute('tabindex','0');head.setAttribute('aria-controls',card.id+'-details-v590');head.setAttribute('aria-expanded',card.classList.contains('active')?'true':'false')}
    const details=card.querySelector(':scope > .route-card-details');if(details)details.id=card.id+'-details-v590';
  }
  function normalizeCards(){document.querySelectorAll('#tripsArea .route-card').forEach(normalizeCard)}
  function parkMap(){
    const wrap=mapWrap(),home=ensureMapHome();if(!wrap||!home)return;
    if(wrap.parentElement!==home){wrap.classList.add('route-map-moving-v590');home.appendChild(wrap);wrap.classList.remove('route-map-moving-v590')}
    home.classList.remove('route-map-home-empty-v590');
  }
  function dockMap(card){
    const wrap=mapWrap(),slot=prepareDetails(card),home=ensureMapHome();if(!wrap||!slot)return;
    if(wrap.parentElement!==slot){wrap.classList.add('route-map-moving-v590');slot.appendChild(wrap);wrap.classList.remove('route-map-moving-v590')}
    home?.classList.add('route-map-home-empty-v590');
  }
  function invalidateMapOnce(token){
    cancelAnimationFrame(state.raf);
    state.raf=requestAnimationFrame(()=>{
      if(token!==state.operation)return;
      try{window.routesMap?.invalidateSize?.({pan:false,animate:false})}catch(_){try{window.routesMap?.invalidateSize?.()}catch(__){ }}
    });
  }
  function collapseAll(except=null){
    document.querySelectorAll('#tripsArea .route-card.active').forEach(card=>{if(card===except)return;card.classList.remove('active','route-switch-target-v590');card.querySelector(':scope > .route-head')?.setAttribute('aria-expanded','false')});
  }
  function currentActive(){return state.active||String((typeof activeRouteId!=='undefined'&&activeRouteId)||window.activeRouteId||'')}
  function anchorTop(card){return card?.querySelector(':scope > .route-head')?.getBoundingClientRect().top??null}
  function preserveAnchor(card,before){if(before==null||!card)return;const after=anchorTop(card);if(after==null)return;const delta=after-before;if(Math.abs(delta)>.5)window.scrollBy({left:0,top:delta,behavior:'auto'})}
  function openRoute(id,{toggle=true,updateMap=true,preserve=true}={}){
    id=String(id||'');const card=cardFor(id);if(!card)return;
    const already=card.classList.contains('active')&&currentActive()===id;
    if(toggle&&already){closeRoute(id,preserve);return}
    const token=++state.operation,before=preserve?anchorTop(card):null;
    document.documentElement.classList.add('route-ui-transaction-v590');
    collapseAll(card);card.classList.add('active','route-switch-target-v590');card.querySelector(':scope > .route-head')?.setAttribute('aria-expanded','true');
    setActiveValue(id);dockMap(card);
    if(updateMap){
      try{
        const update=()=>legacyShowMap?.(id,false);
        if(typeof window.runStableRouteMapUpdateV594==='function')window.runStableRouteMapUpdateV594(id,update);
        else update();
      }catch(err){console.error('Route map update',err)}
    }
    preserveAnchor(card,before);invalidateMapOnce(token);
    card.classList.remove('route-switch-target-v590');document.documentElement.classList.remove('route-ui-transaction-v590');
    notify('jf:route-opened',{routeId:id});
  }
  function closeRoute(id,preserve=true){
    const card=cardFor(id),before=preserve?anchorTop(card):null;state.operation++;
    document.documentElement.classList.add('route-ui-transaction-v590');
    card?.classList.remove('active','route-switch-target-v590');card?.querySelector(':scope > .route-head')?.setAttribute('aria-expanded','false');
    setActiveValue('');parkMap();preserveAnchor(card,before);
    const title=$id('routeMapTitle'),meta=$id('routeMapMeta');if(title)title.textContent='Выберите рейс';if(meta)meta.textContent='Карта откроется внутри выбранного рейса';
    document.documentElement.classList.remove('route-ui-transaction-v590');
  }
  overrides.replace('renderRouteCard','system-stability-v590',function(def,plan,arrivalSlots=null){
    let html=legacyRenderCard(def,plan,arrivalSlots);
    html=html.replace(/\s+data-jf-onclick="showRouteOnMap\('[^']+'\)"/,'');
    return html;
  });
  overrides.replace('showRouteOnMap','system-stability-v590',function(id,scroll=true){
    if(state.rendering){state.pending=String(id||'');return legacyShowMap?.(id,false)}
    return openRoute(id,{toggle:false,updateMap:true,preserve:!!scroll});
  });
  window.toggleRouteRowV590=id=>openRoute(id,{toggle:true,updateMap:true,preserve:true});
  window.toggleRouteRowV581=window.toggleRouteRowV590;window.toggleRouteRowV570=window.toggleRouteRowV590;window.toggleRouteRowV564=window.toggleRouteRowV590;window.toggleRouteRowV563=window.toggleRouteRowV590;
  overrides.replace('renderTripsPreview','system-stability-v590',function(){
    const desired=currentActive();parkMap();state.rendering=true;state.pending='';let result;
    try{result=legacyRenderTrips?.()}finally{state.rendering=false}
    normalizeCards();ensureMapHome();
    const target=state.pending||desired;
    if(target&&cardFor(target)){openRoute(target,{toggle:false,updateMap:false,preserve:false})}else{setActiveValue('');collapseAll();parkMap()}
    notify('jf:routes-rendered',{activeRouteId:currentActive()});
    return result;
  });
  function bind(){
    const host=area();if(!host||host.dataset.routeStableBoundV590==='1')return;
    host.dataset.routeStableBoundV590='1';
    host.addEventListener('click',event=>{
      const head=event.target.closest('.route-card > .route-head');if(!head||!host.contains(head))return;
      if(event.target.closest('button,a,input,select,textarea,label,summary,details'))return;
      event.preventDefault();event.stopPropagation();openRoute(routeIdFromCard(head.parentElement),{toggle:true,updateMap:true,preserve:true});
    },true);
    host.addEventListener('keydown',event=>{
      const head=event.target.closest('.route-card > .route-head');if(!head||!host.contains(head)||!['Enter',' '].includes(event.key))return;
      event.preventDefault();event.stopPropagation();openRoute(routeIdFromCard(head.parentElement),{toggle:true,updateMap:true,preserve:true});
    },true);
    state.bound=true;
  }
  function hardenModals(){
    document.querySelectorAll('.modal').forEach(modal=>{if(modal.dataset.outsideClickGuardV590==='1')return;modal.dataset.outsideClickGuardV590='1';modal.addEventListener('click',event=>{if(event.target===modal){event.preventDefault();event.stopPropagation()}},true)});
  }
  function hardenForms(){
    let sequence=0;document.querySelectorAll('.field').forEach(field=>{const label=field.querySelector(':scope > label');const control=field.querySelector(':scope > input,:scope > select,:scope > textarea');if(!label||!control)return;if(!control.id)control.id='fieldAutoV590-'+(++sequence);if(!label.htmlFor)label.htmlFor=control.id});
  }
  function init(){ensureMapHome();bind();hardenModals();hardenForms();normalizeCards();const current=currentActive();if(current&&cardFor(current))openRoute(current,{toggle:false,updateMap:false,preserve:false});else parkMap()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  setTimeout(()=>{try{window.runDataDiagnostics?.(false)}catch(err){console.error('Startup diagnostics',err)}},0);
})();
