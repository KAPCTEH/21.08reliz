/* JustFun 7.8.3 — explicit registry for compatibility-layer function replacements. */
(function(){
  'use strict';
  if(window.JustFunOverrides)return;

  const history=[];
  const chains=new Map();
  const clean=value=>String(value||'').trim();

  function validate(name,owner,next){
    const functionName=clean(name),moduleOwner=clean(owner);
    if(!/^[A-Za-z_$][\w$]*$/.test(functionName))throw new TypeError('Invalid override function name');
    if(!/^[A-Za-z0-9._:-]{2,80}$/.test(moduleOwner))throw new TypeError('Invalid override owner');
    if(typeof next!=='function')throw new TypeError(`Override ${functionName} must be a function`);
    return {functionName,moduleOwner};
  }

  function install(name,owner,next,mode){
    const {functionName,moduleOwner}=validate(name,owner,next),previous=window[functionName];
    const record=Object.freeze({
      name:functionName,
      owner:moduleOwner,
      mode,
      previousOwner:clean(previous?.__jfOverrideOwner)||'base',
      installedAt:Date.now()
    });
    try{Object.defineProperty(next,'__jfOverrideOwner',{value:moduleOwner,configurable:true})}catch{}
    window[functionName]=next;
    history.push(record);
    if(!chains.has(functionName))chains.set(functionName,[]);
    chains.get(functionName).push(record);
    try{document.dispatchEvent(new CustomEvent('jf:override-installed',{detail:{...record}}))}catch{}
    return next;
  }

  function replace(name,owner,next){return install(name,owner,next,'replace')}
  function wrap(name,owner,factory){
    if(typeof factory!=='function')throw new TypeError('Override factory must be a function');
    const previous=window[clean(name)],next=factory(previous);
    return install(name,owner,next,'wrap');
  }
  function describe(name=''){
    const key=clean(name);
    if(key)return (chains.get(key)||[]).map(item=>({...item}));
    return history.map(item=>({...item}));
  }

  window.JustFunOverrides=Object.freeze({version:'7.8.3',replace,wrap,describe});
})();
