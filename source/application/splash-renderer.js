'use strict';

const stage=document.getElementById('stage');
const detail=document.getElementById('detail');
const fill=document.getElementById('fill');
window.SplashAPI.onStatus(status=>{
  stage.textContent=status.stage||'';
  detail.textContent=status.detail||'';
  fill.style.width=`${Math.max(5,Math.min(100,status.progress||0))}%`;
});
