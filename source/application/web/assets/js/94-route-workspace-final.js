
(function(){
  'use strict';
  const PER_PAGE=10;
  let page=1;
  const byId=id=>document.getElementById(id);
  const cards=()=>[...document.querySelectorAll('#tripsArea > .route-card')];
  function mapWrap(){return document.querySelector('#tripsView .route-map-wrap')}
  function parkMap(){
    const wrap=mapWrap(),home=byId('routeMapHomeV590');if(wrap&&home&&wrap.parentElement!==home)home.appendChild(wrap);
    home?.classList.remove('route-map-home-empty-v590');
  }
  function collapseHiddenActive(visibleSet){
    const active=document.querySelector('#tripsArea > .route-card.active');
    if(active&&!visibleSet.has(active)){
      active.classList.remove('active');active.querySelector(':scope > .route-head')?.setAttribute('aria-expanded','false');
      try{activeRouteId=null}catch(_){ } try{window.activeRouteId=null}catch(_){ }
      parkMap();
    }
  }
  function pageButtons(current,total){
    const items=[];
    const add=n=>items.push(`<button type="button" class="${n===current?'active':''}" aria-current="${n===current?'page':'false'}" data-jf-onclick="setRoutePageV593(${n})">${n}</button>`);
    if(total<=7){for(let n=1;n<=total;n++)add(n)}else{add(1);if(current>4)items.push('<span>…</span>');for(let n=Math.max(2,current-1);n<=Math.min(total-1,current+1);n++)add(n);if(current<total-3)items.push('<span>…</span>');add(total)}
    return items.join('');
  }
  function ensurePager(){
    let el=byId('routePaginationV593');
    if(!el){el=document.createElement('div');el.id='routePaginationV593';el.className='route-pagination-v593';const area=byId('tripsArea');area?.insertAdjacentElement('afterend',el)}
    return el;
  }
  function applyPagination({keepActive=true}={}){
    const list=cards(),totalPages=Math.max(1,Math.ceil(list.length/PER_PAGE));
    if(keepActive){const active=list.find(card=>card.classList.contains('active'));if(active){const idx=list.indexOf(active);if(idx>=0)page=Math.floor(idx/PER_PAGE)+1}}
    page=Math.min(Math.max(1,page),totalPages);
    const start=(page-1)*PER_PAGE,end=start+PER_PAGE,visible=new Set();
    list.forEach((card,index)=>{const show=index>=start&&index<end;card.hidden=!show;if(show)visible.add(card)});
    collapseHiddenActive(visible);
    const pager=ensurePager();if(!pager)return;
    pager.hidden=list.length<=PER_PAGE;
    pager.innerHTML=`<div class="route-pagination-info-v593">Показано <b>${list.length?start+1:0}–${Math.min(end,list.length)}</b> из <b>${list.length}</b> рейсов · по 10 на странице</div><div class="route-pagination-buttons-v593"><button type="button" ${page<=1?'disabled':''} data-jf-onclick="setRoutePageV593(${page-1})">←</button>${pageButtons(page,totalPages)}<button type="button" ${page>=totalPages?'disabled':''} data-jf-onclick="setRoutePageV593(${page+1})">→</button></div>`;
  }
  window.setRoutePageV593=function(next){page=Number(next)||1;applyPagination({keepActive:false});byId('tripsArea')?.scrollIntoView({block:'start',behavior:'auto'})};
  function afterRouteInteraction(event){
    const head=event.target.closest('#tripsArea > .route-card > .route-head');if(!head)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>applyPagination({keepActive:true})));
  }
  document.addEventListener('jf:routes-rendered',()=>{window.cleanupRouteUiV591?.();applyPagination({keepActive:true})});
  document.addEventListener('jf:route-opened',()=>applyPagination({keepActive:true}));
  function init(){const host=byId('tripsArea');if(host&&!host.dataset.routeWorkspaceV593){host.dataset.routeWorkspaceV593='1';host.addEventListener('click',afterRouteInteraction,true);host.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')afterRouteInteraction(event)},true)}window.cleanupRouteUiV591?.();applyPagination({keepActive:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
