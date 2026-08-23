(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.JustFunLocalOutboxV783=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCHEMA_VERSION=1;
  const DATA_CONTRACT_VERSION=3;
  const STATES=Object.freeze(['pending','sending','confirmed','conflict','rejected']);
  const ACTIVE_STATES=new Set(['pending','sending','conflict']);
  const OVERLAY_STATES=new Set(['pending','sending','conflict','rejected']);

  class OutboxError extends Error{
    constructor(code,message,cause){super(message);this.name='JustFunOutboxError';this.code=code;if(cause)this.cause=cause}
  }

  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
  function iso(value){const date=value?new Date(value):new Date();if(!Number.isFinite(date.getTime()))throw new OutboxError('OUTBOX_INVALID_DATE','Очередь содержит некорректную дату.');return date.toISOString()}
  function requiredText(value,label,max=240){const text=String(value||'').trim();if(!text||text.length>max)throw new OutboxError('OUTBOX_INVALID_FIELD',`${label}: значение отсутствует или превышает ${max} символов.`);return text}
  function safeEntityPart(value,label){const text=requiredText(value,label,160);if(!/^[A-Za-z0-9_-]+$/.test(text))throw new OutboxError('OUTBOX_INVALID_ENTITY',`${label}: недопустимый идентификатор.`);return text}
  function safeInteger(value,label){const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new OutboxError('OUTBOX_INVALID_VERSION',`${label}: требуется целое неотрицательное число.`);return number}
  function scopeHash(value){let hash=2166136261;for(const ch of String(value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(16).padStart(8,'0')}
  function storageKey(scope){const text=requiredText(scope,'scope',500),safe=text.replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,120);return`jf.local-outbox.v1.${safe}.${scopeHash(text)}`}
  function blankDocument(scope){return{schemaVersion:SCHEMA_VERSION,dataContractVersion:DATA_CONTRACT_VERSION,scope,entries:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}
  function canonicalChange(raw){
    const change=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const deleted=change.deleted===true;
    return{type:safeEntityPart(change.type,'entity_type'),id:safeEntityPart(change.id,'entity_id'),baseVersion:safeInteger(change.baseVersion,'base_version'),deleted,payload:deleted?null:clone(change.payload),_fingerprint:deleted?'':String(change._fingerprint||'')};
  }
  function canonicalEntry(raw,scope){
    const entry=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const state=String(entry.state||'');if(!STATES.includes(state))throw new OutboxError('OUTBOX_INVALID_STATE','Очередь содержит неизвестное состояние команды.');
    const changes=Array.isArray(entry.changes)?entry.changes.map(canonicalChange):[];if(!changes.length||changes.length>1000)throw new OutboxError('OUTBOX_INVALID_CHANGES','Команда outbox должна содержать от 1 до 1000 изменений.');
    return{
      commandId:requiredText(entry.commandId,'command_id'),scope,
      companyId:requiredText(entry.companyId,'company_id',160),warehouseId:safeEntityPart(entry.warehouseId,'warehouse_id'),environment:requiredText(entry.environment,'environment',20),
      intent:entry.intent&&typeof entry.intent==='object'&&!Array.isArray(entry.intent)?clone(entry.intent):null,
      changes,state,createdAt:iso(entry.createdAt),updatedAt:iso(entry.updatedAt),
      authorUserId:requiredText(entry.authorUserId,'author_user_id',160),deviceId:requiredText(entry.deviceId,'device_id',200),dataContractVersion:safeInteger(entry.dataContractVersion??DATA_CONTRACT_VERSION,'data_contract_version'),
      attempts:safeInteger(entry.attempts||0,'attempts'),nextAttemptAt:entry.nextAttemptAt?iso(entry.nextAttemptAt):null,
      lastError:entry.lastError&&typeof entry.lastError==='object'&&!Array.isArray(entry.lastError)?clone(entry.lastError):null,
      confirmedAt:entry.confirmedAt?iso(entry.confirmedAt):null,preserveLocal:entry.preserveLocal!==false,
    };
  }
  function canonicalDocument(raw,scope){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new OutboxError('OUTBOX_CORRUPT','Документ outbox имеет неверный формат.');
    if(Number(raw.schemaVersion)!==SCHEMA_VERSION)throw new OutboxError('OUTBOX_SCHEMA_UNSUPPORTED',`Версия формата outbox ${raw.schemaVersion} не поддерживается.`);
    if(Number(raw.dataContractVersion)!==DATA_CONTRACT_VERSION)throw new OutboxError('OUTBOX_CONTRACT_UNSUPPORTED',`Версия данных outbox ${raw.dataContractVersion} не поддерживается.`);
    if(String(raw.scope||'')!==scope)throw new OutboxError('OUTBOX_SCOPE_MISMATCH','Очередь принадлежит другой компании, среде или складу.');
    const entries=Array.isArray(raw.entries)?raw.entries.map(item=>canonicalEntry(item,scope)):null;if(!entries)throw new OutboxError('OUTBOX_CORRUPT','В документе outbox отсутствует список команд.');
    const ids=new Set();for(const entry of entries){if(ids.has(entry.commandId))throw new OutboxError('OUTBOX_DUPLICATE_COMMAND','Очередь содержит повторяющийся command_id.');ids.add(entry.commandId)}
    return{schemaVersion:SCHEMA_VERSION,dataContractVersion:DATA_CONTRACT_VERSION,scope,entries,createdAt:iso(raw.createdAt),updatedAt:iso(raw.updatedAt)};
  }
  function create(storage,scope,options={}){
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw new OutboxError('OUTBOX_STORAGE_UNAVAILABLE','Локальное хранилище outbox недоступно.');
    scope=requiredText(scope,'scope',500);
    const key=storageKey(scope),maxActive=Number(options.maxActive)||500,maxHistory=Number(options.maxHistory)||100,maxBytes=Number(options.maxBytes)||4*1024*1024;
    let document=blankDocument(scope),corruption=null;
    const persist=next=>{
      if(corruption)throw corruption;
      next.updatedAt=new Date().toISOString();
      const serialized=JSON.stringify(next);if(serialized.length>maxBytes)throw new OutboxError('OUTBOX_CAPACITY_EXCEEDED','Локальная очередь переполнена. Синхронизируйте данные перед продолжением работы.');
      try{storage.setItem(key,serialized)}catch(error){throw new OutboxError('OUTBOX_WRITE_FAILED','Не удалось надёжно записать локальную очередь. Изменение отменено.',error)}
      document=next;
    };
    try{
      const serialized=storage.getItem(key);
      if(serialized){document=canonicalDocument(JSON.parse(serialized),scope);let recovered=false;const next=clone(document);for(const entry of next.entries)if(entry.state==='sending'){entry.state='pending';entry.nextAttemptAt=null;entry.updatedAt=new Date().toISOString();entry.lastError={code:'OUTBOX_RESTART_RECOVERY',message:'Отправка была прервана перезапуском и будет повторена с тем же command_id.'};recovered=true}if(recovered)persist(next)}
    }catch(error){corruption=error instanceof OutboxError?error:new OutboxError('OUTBOX_CORRUPT','Локальная очередь повреждена. Автоматическая перезапись запрещена.',error)}
    const assertReady=()=>{if(corruption)throw corruption};
    const list=(states=null)=>{assertReady();const allowed=states==null?null:new Set(Array.isArray(states)?states:[states]);return clone(document.entries.filter(entry=>!allowed||allowed.has(entry.state)))};
    const get=commandId=>{assertReady();const found=document.entries.find(entry=>entry.commandId===String(commandId));return found?clone(found):null};
    const prune=entries=>{const confirmed=entries.filter(entry=>entry.state==='confirmed').sort((a,b)=>String(b.confirmedAt||b.updatedAt).localeCompare(String(a.confirmedAt||a.updatedAt))),keepConfirmed=new Set(confirmed.slice(0,maxHistory).map(entry=>entry.commandId));return entries.filter(entry=>entry.state!=='confirmed'||keepConfirmed.has(entry.commandId))};
    const replace=(commandId,updater)=>{assertReady();const next=clone(document),index=next.entries.findIndex(entry=>entry.commandId===String(commandId));if(index<0)throw new OutboxError('OUTBOX_COMMAND_NOT_FOUND','Команда outbox не найдена.');next.entries[index]=canonicalEntry(updater(next.entries[index]),scope);next.entries=prune(next.entries);persist(next);return clone(next.entries[index])};
    const enqueue=input=>{
      assertReady();const now=new Date().toISOString(),entry=canonicalEntry({...input,scope,state:'pending',createdAt:input?.createdAt||now,updatedAt:now,attempts:0,nextAttemptAt:null,lastError:null,confirmedAt:null,preserveLocal:true,dataContractVersion:DATA_CONTRACT_VERSION},scope);
      const existing=document.entries.find(item=>item.commandId===entry.commandId);if(existing){if(JSON.stringify(existing.changes)!==JSON.stringify(entry.changes))throw new OutboxError('OUTBOX_COMMAND_COLLISION','Одинаковый command_id назначен разным изменениям.');return clone(existing)}
      if(document.entries.filter(item=>ACTIVE_STATES.has(item.state)||(item.state==='rejected'&&item.preserveLocal)).length>=maxActive)throw new OutboxError('OUTBOX_ACTIVE_LIMIT','Слишком много несинхронизированных изменений. Синхронизируйте или разрешите конфликты.');
      const next=clone(document);next.entries=prune([...next.entries,entry]);persist(next);return clone(entry)
    };
    const transition=(commandId,state,details={})=>replace(commandId,entry=>({...entry,state,updatedAt:new Date().toISOString(),...details}));
    const status=()=>{assertReady();const counts={pending:0,sending:0,confirmed:0,conflict:0,rejected:0};for(const entry of document.entries)counts[entry.state]++;const rejectedActive=document.entries.filter(entry=>entry.state==='rejected'&&entry.preserveLocal).length;return{...counts,rejectedActive,active:counts.pending+counts.sending+counts.conflict+rejectedActive,corrupt:false,scope,key}};
    const ready=now=>{assertReady();const timestamp=Number(now)||Date.now(),found=document.entries.find(entry=>entry.state==='pending'&&(!entry.nextAttemptAt||new Date(entry.nextAttemptAt).getTime()<=timestamp));return found?clone(found):null};
    const overlayEntries=()=>list().filter(entry=>OVERLAY_STATES.has(entry.state)&&entry.preserveLocal!==false);
    const blockedEntityKeys=()=>{assertReady();const result=new Set();for(const entry of document.entries)if((entry.state==='conflict'||entry.state==='rejected')&&entry.preserveLocal!==false)for(const change of entry.changes)result.add(`${change.type}:${change.id}`);return result};
    const pendingOffset=(type,id)=>{assertReady();let count=0;for(const entry of document.entries)if(ACTIVE_STATES.has(entry.state))count+=entry.changes.filter(change=>change.type===String(type)&&change.id===String(id)).length;return count};
    return Object.freeze({
      key,scope,isCorrupt:()=>Boolean(corruption),corruption:()=>corruption,status,list,get,enqueue,ready,overlayEntries,blockedEntityKeys,pendingOffset,
      markSending:commandId=>replace(commandId,entry=>({...entry,state:'sending',attempts:entry.attempts+1,nextAttemptAt:null,updatedAt:new Date().toISOString()})),
      markPending:(commandId,error={},delayMs=0)=>transition(commandId,'pending',{nextAttemptAt:new Date(Date.now()+Math.max(0,Number(delayMs)||0)).toISOString(),lastError:clone(error),preserveLocal:true}),
      markConfirmed:(commandId,result=null)=>transition(commandId,'confirmed',{confirmedAt:new Date().toISOString(),nextAttemptAt:null,lastError:null,preserveLocal:false,serverResult:result?clone(result):null}),
      markConflict:(commandId,error={})=>transition(commandId,'conflict',{nextAttemptAt:null,lastError:clone(error),preserveLocal:true}),
      markRejected:(commandId,error={},preserveLocal=true)=>transition(commandId,'rejected',{nextAttemptAt:null,lastError:clone(error),preserveLocal:preserveLocal!==false}),
    });
  }

  return Object.freeze({SCHEMA_VERSION,DATA_CONTRACT_VERSION,STATES,OutboxError,storageKey,create});
});
