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
  function entityKey(change){return`${String(change?.type||'')}:${String(change?.id||'')}`}
  function entryScopeMatches(entry){return String(entry?.scope||'')===`${String(entry?.companyId||'')}:${String(entry?.environment||'')}:${String(entry?.warehouseId||'')}`}
  function pendingServerResolution(entry){return entry?.state==='confirmed'&&entry?.resolution?.strategy==='server'&&entry?.resolution?.phase==='server_apply_pending'}
  function canonicalServerResult(raw,targetType,targetId){
    const result=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:null;if(!result)throw new OutboxError('OUTBOX_CONFLICT_SERVER_RESULT_INVALID','Для восстановления выбора отсутствует подтверждённая серверная версия.');
    const type=safeEntityPart(result.type,'server_entity_type'),id=safeEntityPart(result.id,'server_entity_id');if(type!==targetType||id!==targetId)throw new OutboxError('OUTBOX_CONFLICT_SERVER_RESULT_SCOPE','Серверная версия относится к другой записи.');
    const deleted=result.deleted===true,payload=deleted?null:clone(result.payload);if(!deleted&&payload===undefined)throw new OutboxError('OUTBOX_CONFLICT_SERVER_RESULT_INVALID','Серверная версия не содержит данных записи.');
    const version=safeInteger(result.version,'server_version'),digest=String(result.digest||'');if((version>0||digest)&&!/^[a-f0-9]{64}$/i.test(digest))throw new OutboxError('OUTBOX_CONFLICT_SERVER_RESULT_INVALID','Контрольная сумма серверной версии повреждена.');
    return{type,id,version,digest,eventId:safeInteger(result.eventId||0,'server_event_id'),deleted,payload};
  }
  function pendingServerResolutionEntries(entries){
    const result=[];for(const entry of entries)if(pendingServerResolution(entry)){if(!entryScopeMatches(entry))throw new OutboxError('OUTBOX_RESOLUTION_SCOPE_MISMATCH','Журнал выбранной версии относится к другой компании, среде или складу.');const type=safeEntityPart(entry.resolution.type,'resolution_entity_type'),id=safeEntityPart(entry.resolution.id,'resolution_entity_id'),serverResult=canonicalServerResult(entry.serverResult,type,id);result.push({...clone(entry),serverResult})}return result
  }
  function conflictTargetKeys(entry){
    const changes=Array.isArray(entry?.changes)?entry.changes:[],all=[...new Set(changes.map(entityKey).filter(Boolean))];
    if(entry?.state!=='conflict')return all;
    const details=entry?.lastError?.details&&typeof entry.lastError.details==='object'&&!Array.isArray(entry.lastError.details)?entry.lastError.details:{};
    const type=String(details.entity_type||details.type||''),id=String(details.entity_id||details.id||''),declared=type&&id?`${type}:${id}`:'';
    if(declared&&all.includes(declared))return[declared];
    return all;
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
      serverResult:entry.serverResult&&typeof entry.serverResult==='object'&&!Array.isArray(entry.serverResult)?clone(entry.serverResult):null,
      resolvedAt:entry.resolvedAt?iso(entry.resolvedAt):null,
      resolution:entry.resolution&&typeof entry.resolution==='object'&&!Array.isArray(entry.resolution)?clone(entry.resolution):null,
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
  function inspect(storage,scope){
    if(!storage||typeof storage.getItem!=='function')throw new OutboxError('OUTBOX_STORAGE_UNAVAILABLE','Локальное хранилище outbox недоступно.');
    scope=requiredText(scope,'scope',500);
    const key=storageKey(scope),serialized=storage.getItem(key);
    if(!serialized)return Object.freeze({key,scope,exists:false,list:()=>[],overlayEntries:()=>[],pendingServerResolutions:()=>[]});
    let document;try{document=canonicalDocument(JSON.parse(serialized),scope)}catch(error){throw error instanceof OutboxError?error:new OutboxError('OUTBOX_CORRUPT','Локальная очередь повреждена. Автоматическая перезапись запрещена.',error)}
    const list=(states=null)=>{const allowed=states==null?null:new Set(Array.isArray(states)?states:[states]);return clone(document.entries.filter(entry=>!allowed||allowed.has(entry.state)))};
    return Object.freeze({key,scope,exists:true,list,overlayEntries:()=>list().filter(entry=>OVERLAY_STATES.has(entry.state)&&entry.preserveLocal!==false),pendingServerResolutions:()=>clone(pendingServerResolutionEntries(document.entries))});
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
    const prune=entries=>{const recovery=entries.filter(pendingServerResolution),confirmed=entries.filter(entry=>entry.state==='confirmed'&&!pendingServerResolution(entry)).sort((a,b)=>String(b.confirmedAt||b.updatedAt).localeCompare(String(a.confirmedAt||a.updatedAt))),keepConfirmed=new Set([...recovery,...confirmed.slice(0,maxHistory)].map(entry=>entry.commandId));return entries.filter(entry=>entry.state!=='confirmed'||keepConfirmed.has(entry.commandId))};
    const replace=(commandId,updater)=>{assertReady();const next=clone(document),index=next.entries.findIndex(entry=>entry.commandId===String(commandId));if(index<0)throw new OutboxError('OUTBOX_COMMAND_NOT_FOUND','Команда outbox не найдена.');next.entries[index]=canonicalEntry(updater(next.entries[index]),scope);next.entries=prune(next.entries);persist(next);return clone(next.entries[index])};
    const enqueue=input=>{
      assertReady();const now=new Date().toISOString(),entry=canonicalEntry({...input,scope,state:'pending',createdAt:input?.createdAt||now,updatedAt:now,attempts:0,nextAttemptAt:null,lastError:null,confirmedAt:null,preserveLocal:true,dataContractVersion:DATA_CONTRACT_VERSION},scope);
      const existing=document.entries.find(item=>item.commandId===entry.commandId);if(existing){if(JSON.stringify(existing.changes)!==JSON.stringify(entry.changes))throw new OutboxError('OUTBOX_COMMAND_COLLISION','Одинаковый command_id назначен разным изменениям.');return clone(existing)}
      if(document.entries.filter(item=>ACTIVE_STATES.has(item.state)||(item.state==='rejected'&&item.preserveLocal)||pendingServerResolution(item)).length>=maxActive)throw new OutboxError('OUTBOX_ACTIVE_LIMIT','Слишком много несинхронизированных изменений. Синхронизируйте или разрешите конфликты.');
      const next=clone(document);next.entries=prune([...next.entries,entry]);persist(next);return clone(entry)
    };
    const transition=(commandId,state,details={})=>replace(commandId,entry=>({...entry,state,updatedAt:new Date().toISOString(),...details}));
    const status=()=>{assertReady();const counts={pending:0,sending:0,confirmed:0,conflict:0,rejected:0};for(const entry of document.entries)counts[entry.state]++;const rejectedActive=document.entries.filter(entry=>entry.state==='rejected'&&entry.preserveLocal).length,resolutionPending=document.entries.filter(pendingServerResolution).length;return{...counts,rejectedActive,resolutionPending,active:counts.pending+counts.sending+counts.conflict+rejectedActive+resolutionPending,corrupt:false,scope,key}};
    const ready=(now,excludedEntityKeys=null)=>{assertReady();const timestamp=Number(now)||Date.now(),excluded=excludedEntityKeys instanceof Set?excludedEntityKeys:new Set(Array.isArray(excludedEntityKeys)?excludedEntityKeys:[]),found=document.entries.find(entry=>entry.state==='pending'&&(!entry.nextAttemptAt||new Date(entry.nextAttemptAt).getTime()<=timestamp)&&!entry.changes.some(change=>excluded.has(entityKey(change))));return found?clone(found):null};
    const overlayEntries=()=>list().filter(entry=>OVERLAY_STATES.has(entry.state)&&entry.preserveLocal!==false);
    const blockedEntityKeys=()=>{assertReady();const result=new Set();for(const entry of document.entries)if((entry.state==='conflict'||entry.state==='rejected')&&entry.preserveLocal!==false)for(const change of entry.changes)result.add(entityKey(change));return result};
    const conflictEntityKeys=commandId=>{assertReady();const entry=document.entries.find(item=>item.commandId===String(commandId));return entry&&entry.state==='conflict'?clone(conflictTargetKeys(entry)):[]};
    const pendingServerResolutions=()=>{assertReady();return clone(pendingServerResolutionEntries(document.entries))};
    const markResolutionApplied=commandId=>replace(commandId,entry=>{
      if(entry.state!=='confirmed'||entry.resolution?.strategy!=='server')throw new OutboxError('OUTBOX_RESOLUTION_STATE_CHANGED','Журнал серверного выбора отсутствует или уже заменён.');
      if(entry.resolution.phase==='complete')return entry;if(entry.resolution.phase!=='server_apply_pending')throw new OutboxError('OUTBOX_RESOLUTION_STATE_INVALID','Журнал серверного выбора имеет неизвестное состояние.');
      return{...entry,updatedAt:new Date().toISOString(),resolution:{...entry.resolution,phase:'complete',appliedAt:new Date().toISOString()}}
    });
    const resolveConflict=(commandId,resolution={})=>{
      assertReady();const next=clone(document),index=next.entries.findIndex(entry=>entry.commandId===String(commandId));if(index<0)throw new OutboxError('OUTBOX_COMMAND_NOT_FOUND','Конфликтная команда не найдена.');const entry=next.entries[index];if(!entryScopeMatches(entry))throw new OutboxError('OUTBOX_SCOPE_MISMATCH','Конфликтная команда относится к другой компании, среде или складу.');if(entry.state!=='conflict'||entry.preserveLocal===false)throw new OutboxError('OUTBOX_CONFLICT_STATE_CHANGED','Команда уже не находится в состоянии конфликта. Обновите список.');
      const targetType=safeEntityPart(resolution.type,'entity_type'),targetId=safeEntityPart(resolution.id,'entity_id'),targetKey=`${targetType}:${targetId}`,targets=conflictTargetKeys(entry);if(targets.length!==1||targets[0]!==targetKey)throw new OutboxError('OUTBOX_CONFLICT_AMBIGUOUS','Нельзя безопасно определить единственную конфликтную запись в команде.');
      const strategy=String(resolution.strategy||'');if(strategy!=='server'&&strategy!=='local')throw new OutboxError('OUTBOX_CONFLICT_STRATEGY_INVALID','Неизвестный способ разрешения конфликта. Локальная команда оставлена без изменений.');
      const originalKeys=entry.changes.map(entityKey),originalKeySet=new Set(originalKeys);if(originalKeySet.size!==originalKeys.length)throw new OutboxError('OUTBOX_DUPLICATE_ENTITY','Исходная конфликтная команда содержит одну запись несколько раз. Автоматическое разбиение запрещено.');
      const replacementChanges=Array.isArray(resolution.replacementChanges)?resolution.replacementChanges.map(canonicalChange):[];if(replacementChanges.length>1000)throw new OutboxError('OUTBOX_INVALID_CHANGES','Повторная команда содержит больше 1000 изменений.');const replacementKeys=replacementChanges.map(entityKey),replacementKeySet=new Set(replacementKeys);if(replacementKeySet.size!==replacementKeys.length)throw new OutboxError('OUTBOX_DUPLICATE_ENTITY','Повторная команда содержит одну запись несколько раз.');if(replacementKeys.some(key=>!originalKeySet.has(key)))throw new OutboxError('OUTBOX_CONFLICT_REPLACEMENT_SCOPE','Повторная команда содержит запись, которой не было в исходной конфликтной операции.');
      const expectedKeys=originalKeys.filter(key=>strategy==='local'||key!==targetKey);if(expectedKeys.length!==replacementKeys.length||expectedKeys.some(key=>!replacementKeySet.has(key)))throw new OutboxError('OUTBOX_CONFLICT_REPLACEMENT_INCOMPLETE','Разрешение конфликта не сохраняет все остальные изменения исходной команды. Операция остановлена.');
      const followingRebases=Array.isArray(resolution.followingRebases)?resolution.followingRebases:[],rebases=new Map();for(const raw of followingRebases){const commandId=requiredText(raw?.commandId,'rebase_command_id');if(rebases.has(commandId))throw new OutboxError('OUTBOX_REBASE_DUPLICATE_COMMAND','План повторной отправки содержит команду несколько раз.');const changes=Array.isArray(raw?.changes)?raw.changes:[],byKey=new Map();if(!changes.length)throw new OutboxError('OUTBOX_REBASE_INCOMPLETE','План повторной отправки не содержит затронутых записей.');for(const item of changes){const type=safeEntityPart(item?.type,'rebase_entity_type'),id=safeEntityPart(item?.id,'rebase_entity_id'),key=`${type}:${id}`;if(byKey.has(key))throw new OutboxError('OUTBOX_REBASE_DUPLICATE_ENTITY','План повторной отправки содержит запись несколько раз.');byKey.set(key,{type,id,baseVersion:safeInteger(item?.baseVersion,'rebase_base_version')})}rebases.set(commandId,byKey)}
      const consumed=new Set();for(let position=0;position<next.entries.length;position++){if(position===index)continue;const candidate=next.entries[position],touched=candidate.changes.filter(change=>originalKeySet.has(entityKey(change)));if(!touched.length||candidate.state==='confirmed'||candidate.state==='rejected'&&candidate.preserveLocal===false)continue;if(!entryScopeMatches(candidate)||candidate.companyId!==entry.companyId||candidate.warehouseId!==entry.warehouseId||candidate.environment!==entry.environment||candidate.authorUserId!==entry.authorUserId)throw new OutboxError('OUTBOX_REBASE_SCOPE_INVALID','Следующая команда принадлежит другой области данных или пользователю. Автоматическое разрешение остановлено.');if(position<index)throw new OutboxError('OUTBOX_REBASE_ORDER_UNSAFE','Перед конфликтом осталась более ранняя активная команда той же записи. Автоматическое разрешение остановлено.');if(candidate.state!=='pending'||candidate.preserveLocal===false||candidate.attempts!==0||candidate.lastError)throw new OutboxError('OUTBOX_REBASE_SEND_STATE_UNKNOWN','Следующая команда этой записи уже могла отправляться. Автоматическое разрешение остановлено без потери данных.');const duplicateKeys=touched.map(entityKey);if(new Set(duplicateKeys).size!==duplicateKeys.length)throw new OutboxError('OUTBOX_REBASE_DUPLICATE_ENTITY','Следующая команда содержит одну запись несколько раз.');const planned=rebases.get(candidate.commandId);if(!planned||planned.size!==touched.length||touched.some(change=>!planned.has(entityKey(change))))throw new OutboxError('OUTBOX_REBASE_INCOMPLETE','Не все последующие изменения этой записи имеют однозначный план новой версии.');candidate.changes=candidate.changes.map(change=>{const plannedChange=planned.get(entityKey(change));return plannedChange?{...change,baseVersion:plannedChange.baseVersion}:change});next.entries[position]=canonicalEntry(candidate,scope);consumed.add(candidate.commandId)}if(consumed.size!==rebases.size||[...rebases.keys()].some(commandId=>!consumed.has(commandId)))throw new OutboxError('OUTBOX_REBASE_SCOPE_INVALID','План повторной отправки относится к отсутствующей или незатронутой команде.');
      const now=new Date().toISOString(),replacementCommandId=replacementChanges.length?requiredText(resolution.replacementCommandId,'replacement_command_id'):'',serverResult=canonicalServerResult(resolution.serverResult,targetType,targetId);if(replacementChanges.length&&replacementCommandId===entry.commandId)throw new OutboxError('OUTBOX_COMMAND_COLLISION','Для повторной записи требуется новый command_id.');if(replacementCommandId&&next.entries.some(item=>item.commandId===replacementCommandId))throw new OutboxError('OUTBOX_COMMAND_COLLISION','Новый command_id уже присутствует в локальной очереди.');
      next.entries[index]=canonicalEntry({...entry,state:'confirmed',updatedAt:now,confirmedAt:now,preserveLocal:false,nextAttemptAt:null,lastError:null,resolvedAt:now,resolution:{strategy,type:targetType,id:targetId,replacementCommandId:replacementCommandId||null,phase:strategy==='server'?'server_apply_pending':'complete',appliedAt:strategy==='server'?null:now},serverResult},scope);
      let replacement=null;if(replacementChanges.length){replacement=canonicalEntry({...entry,commandId:replacementCommandId,changes:replacementChanges,state:'pending',createdAt:now,updatedAt:now,attempts:0,nextAttemptAt:null,lastError:null,confirmedAt:null,preserveLocal:true,serverResult:null,resolvedAt:null,resolution:null},scope);const activeCount=next.entries.filter(item=>ACTIVE_STATES.has(item.state)||(item.state==='rejected'&&item.preserveLocal)||pendingServerResolution(item)).length;if(activeCount>=maxActive)throw new OutboxError('OUTBOX_ACTIVE_LIMIT','Слишком много несинхронизированных изменений. Синхронизируйте или разрешите конфликты.');next.entries.splice(index+1,0,replacement)}
      next.entries=prune(next.entries);persist(next);return{resolved:clone(next.entries.find(item=>item.commandId===entry.commandId)||next.entries[index]),replacement:replacement?clone(replacement):null,rebased:[...consumed]};
    };
    const pendingOffset=(type,id)=>{assertReady();let count=0;for(const entry of document.entries)if(ACTIVE_STATES.has(entry.state))count+=entry.changes.filter(change=>change.type===String(type)&&change.id===String(id)).length;return count};
    return Object.freeze({
      key,scope,isCorrupt:()=>Boolean(corruption),corruption:()=>corruption,status,list,get,enqueue,ready,overlayEntries,blockedEntityKeys,conflictEntityKeys,pendingServerResolutions,markResolutionApplied,resolveConflict,pendingOffset,
      markSending:commandId=>replace(commandId,entry=>({...entry,state:'sending',attempts:entry.attempts+1,nextAttemptAt:null,updatedAt:new Date().toISOString()})),
      markPending:(commandId,error={},delayMs=0)=>transition(commandId,'pending',{nextAttemptAt:new Date(Date.now()+Math.max(0,Number(delayMs)||0)).toISOString(),lastError:clone(error),preserveLocal:true}),
      markConfirmed:(commandId,result=null)=>transition(commandId,'confirmed',{confirmedAt:new Date().toISOString(),nextAttemptAt:null,lastError:null,preserveLocal:false,serverResult:result?clone(result):null}),
      markConflict:(commandId,error={})=>transition(commandId,'conflict',{nextAttemptAt:null,lastError:clone(error),preserveLocal:true}),
      markRejected:(commandId,error={},preserveLocal=true)=>transition(commandId,'rejected',{nextAttemptAt:null,lastError:clone(error),preserveLocal:preserveLocal!==false}),
    });
  }

  return Object.freeze({SCHEMA_VERSION,DATA_CONTRACT_VERSION,STATES,OutboxError,storageKey,inspect,create});
});
