(function installJustFunIconSystem(global){
  'use strict';

  const NS='http://www.w3.org/2000/svg';
  const ICONS=Object.freeze({
    '📦':[['path',{d:'M21 8l-9-5-9 5 9 5 9-5Z'}],['path',{d:'M3 8v8l9 5 9-5V8'}],['path',{d:'M12 13v8'}]],
    '🗑':[['path',{d:'M3 6h18'}],['path',{d:'M8 6V4h8v2'}],['path',{d:'M19 6l-1 14H6L5 6'}],['path',{d:'M10 11v5M14 11v5'}]],
    '🔎':[['circle',{cx:'11',cy:'11',r:'7'}],['path',{d:'m20 20-4-4'}]],
    '✦':[['path',{d:'m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z'}]],
    '⚙':[['circle',{cx:'12',cy:'12',r:'3'}],['path',{d:'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z'}]],
    '🚚':[['path',{d:'M3 6h11v10H3z'}],['path',{d:'M14 10h4l3 3v3h-7z'}],['circle',{cx:'7',cy:'18',r:'2'}],['circle',{cx:'18',cy:'18',r:'2'}]],
    '✎':[['path',{d:'m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z'}],['path',{d:'m13.5 7 3.5 3.5'}]],
    '✏':[['path',{d:'m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z'}],['path',{d:'m13.5 7 3.5 3.5'}]],
    '🔒':[['rect',{x:'5',y:'10',width:'14',height:'11',rx:'2'}],['path',{d:'M8 10V7a4 4 0 0 1 8 0v3'}]],
    '📍':[['path',{d:'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z'}],['circle',{cx:'12',cy:'10',r:'2.5'}]],
    '🧭':[['circle',{cx:'12',cy:'12',r:'9'}],['path',{d:'m15.5 8.5-2 5-5 2 2-5 5-2Z'}]],
    '🧺':[['path',{d:'M4 10h16l-2 10H6L4 10Z'}],['path',{d:'m8 10 4-7 4 7M9 13l1 4M15 13l-1 4'}]],
    '⚠':[['path',{d:'M12 3 2 21h20L12 3Z'}],['path',{d:'M12 9v5M12 18h.01'}]],
    '✅':[['circle',{cx:'12',cy:'12',r:'9'}],['path',{d:'m8 12 3 3 5-6'}]],
    '✓':[['path',{d:'m5 12 4 4L19 6'}]],
    '📋':[['rect',{x:'5',y:'4',width:'14',height:'17',rx:'2'}],['path',{d:'M9 4V2h6v2M9 10h6M9 14h6M9 18h4'}]],
    '🗺':[['path',{d:'m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z'}],['path',{d:'M9 3v15M15 6v15'}]],
    '📞':[['path',{d:'M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-2-2 2c-3.8-1.7-6.3-4.2-8-8l2-2-2-4Z'}]],
    '☂':[['path',{d:'M4 12a8 8 0 0 1 16 0c-2-1.5-4-1.5-6 0-2-1.5-4-1.5-6 0-1.3-1-2.7-1.3-4 0ZM12 12v7a2 2 0 0 0 4 0'}]],
    '⛓':[['path',{d:'m10 13-1.5 1.5a3.5 3.5 0 0 1-5-5L7 6a3.5 3.5 0 0 1 5 0'}],['path',{d:'m14 11 1.5-1.5a3.5 3.5 0 0 1 5 5L17 18a3.5 3.5 0 0 1-5 0'}],['path',{d:'m8 16 8-8'}]]
  });
  const TOKEN=/[📦🗑🔎✦⚙🚚✎✏🔒📍🧭🧺⚠✅✓📋🗺📞☂⛓]\uFE0F?/gu;

  function makeIcon(token){
    const definition=ICONS[token];
    if(!definition)return null;
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('class','jf-ui-icon');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    for(const [tag,attributes] of definition){
      const node=document.createElementNS(NS,tag);
      for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
      svg.append(node);
    }
    return svg;
  }

  function replaceTextNode(node){
    const value=node.nodeValue||'';
    if(!TOKEN.test(value))return;
    TOKEN.lastIndex=0;
    const fragment=document.createDocumentFragment();
    let cursor=0;
    for(const match of value.matchAll(TOKEN)){
      if(match.index>cursor)fragment.append(document.createTextNode(value.slice(cursor,match.index)));
      const token=match[0].replace('\uFE0F','');
      fragment.append(makeIcon(token)||document.createTextNode(match[0]));
      cursor=match.index+match[0].length;
    }
    if(cursor<value.length)fragment.append(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  }

  function normalize(root=document.body){
    if(!root)return;
    if(root.nodeType===Node.TEXT_NODE){
      if(!root.parentElement?.closest('script,style,textarea,input,option,[contenteditable="true"]'))replaceTextNode(root);
      return;
    }
    if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const pending=[];
    while(walker.nextNode())pending.push(walker.currentNode);
    for(const node of pending){
      if(!node.parentElement?.closest('script,style,textarea,input,option,[contenteditable="true"]'))replaceTextNode(node);
    }
  }

  let queued=false;
  const roots=new Set();
  function flush(){
    queued=false;
    const pending=[...roots];
    roots.clear();
    for(const root of pending)normalize(root);
  }
  function schedule(root){
    roots.add(root);
    if(queued)return;
    queued=true;
    queueMicrotask(flush);
  }

  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='characterData')schedule(record.target);
      for(const node of record.addedNodes)if(node.nodeType===Node.TEXT_NODE||node.nodeType===Node.ELEMENT_NODE)schedule(node);
    }
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>normalize(document.body),{once:true});
  else normalize(document.body);

  global.JustFunIcons=Object.freeze({normalize,makeIcon,tokens:Object.freeze(Object.keys(ICONS))});
})(window);
