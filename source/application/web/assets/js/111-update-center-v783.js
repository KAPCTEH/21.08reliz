(function(){
  'use strict';

  const q=selector=>document.querySelector(selector);
  const busyStates=new Set(['CHECKING','DOWNLOADING','VERIFYING','APPLYING','AWAITING_HEALTH_CONFIRMATION','ROLLING_BACK']);
  const channelLabels={stable:'Стабильный',staging:'Тестовый',internal:'Внутренний'};
  const statePresentation={
    IDLE:{badge:'Готово',kind:'ready',message:'Автоматическая проверка готова. Нажмите «Проверить обновление».'},
    CHECKING:{badge:'Проверка',kind:'busy',message:'Проверяем наличие новой подписанной версии…'},
    UPDATE_AVAILABLE:{badge:'Доступно',kind:'available',message:'Найдена новая версия. Сначала скачайте и проверьте её.'},
    DOWNLOADING:{badge:'Скачивание',kind:'busy',message:'Скачиваем обновление. Программу можно продолжать использовать.'},
    VERIFYING:{badge:'Проверка файла',kind:'busy',message:'Проверяем размер, состав, контрольную сумму и цифровую подпись обновления.'},
    READY_TO_APPLY:{badge:'Готово к установке',kind:'available',message:'Обновление проверено и готово. Сохраните текущую работу и запустите установку.'},
    APPLYING:{badge:'Установка',kind:'busy',message:'Обновление устанавливается. Программа будет перезапущена автоматически.'},
    AWAITING_HEALTH_CONFIRMATION:{badge:'Проверка запуска',kind:'busy',message:'Новая версия запущена и проходит контроль работоспособности.'},
    CONFIRMED:{badge:'Обновлено',kind:'ready',message:'Новая версия успешно установлена и подтверждена.'},
    ROLLING_BACK:{badge:'Восстановление',kind:'busy',message:'Новая версия не прошла проверку. Восстанавливается предыдущая рабочая версия.'},
    ROLLED_BACK:{badge:'Версия восстановлена',kind:'error',message:'Предыдущая рабочая версия восстановлена автоматически. Данные не удалены.'},
    FAILED:{badge:'Требуется внимание',kind:'error',message:'Обновление остановлено без изменения рабочих данных.'}
  };
  const codeMessages={
    UPDATE_DISABLED:'Автоматические обновления ещё не подключены к этому проверочному выпуску.',
    UPDATE_ENDPOINT_MISSING:'Адрес сервера обновлений ещё не настроен.',
    UPDATE_DOWNLOAD_NETWORK:'Сервер обновлений временно недоступен. Повторите позже.',
    UPDATE_DOWNLOAD_TIMEOUT:'Скачивание заняло слишком много времени. Повторите проверку.',
    UPDATE_NOT_AVAILABLE:'Сначала проверьте наличие обновления.',
    UPDATE_NOT_READY:'Обновление ещё не готово к установке.',
    UPDATE_SIGNATURE_INVALID:'Цифровая подпись обновления не подтверждена. Установка заблокирована.',
    UPDATE_KEY_UNKNOWN:'Издатель обновления не подтверждён. Установка заблокирована.',
    UPDATE_KEY_REVOKED:'Ключ этого обновления отозван. Установка заблокирована.',
    UPDATE_DOWNLOAD_HASH:'Скачанный файл повреждён или изменён. Установка заблокирована.',
    UPDATE_CATALOG_EXPIRED:'Описание обновления устарело. Повторите проверку позже.',
    UPDATE_WITHDRAWN:'Эта версия отозвана. Скачанный файл не будет установлен.',
    UPDATE_DEFER_NOT_AVAILABLE:'Сначала скачайте и проверьте обновление.'
  };
  let installed=false,actionBusy=false,lastStatus=null,lastMessage='',unsubscribe=null;

  function safeState(value){return /^[A-Z_]{2,40}$/.test(String(value||''))?String(value):'IDLE'}
  function failureMessage(result){
    const code=String(result?.code||result?.error?.code||'');if(codeMessages[code])return codeMessages[code];
    if(/^UPDATE_(?:SIGNATURE|KEY|CATALOG|PRODUCT|CHANNEL|SEQUENCE|COMMIT|CONTRACT|DOWNGRADE|URL)/.test(code))return'Проверка безопасности обновления не пройдена. Установка заблокирована.';
    if(/^UPDATE_DOWNLOAD/.test(code))return'Не удалось безопасно скачать обновление. Проверьте интернет и повторите позже.';
    if(/^UPDATE_(?:STATE|JOURNAL|HELPER|ROLLBACK|RECOVERY)/.test(code))return'Система обновления остановила операцию. Рабочие данные не изменены; откройте журналы запуска для поддержки.';
    const fallback=String(result?.message||result?.error?.message||'');return/[А-Яа-яЁё]/.test(fallback)?fallback.slice(0,500):'Не удалось выполнить операцию обновления. Повторите позже.';
  }
  function resultMessage(kind,result){
    if(!result?.ok)return failureMessage(result);
    if(kind==='check'&&result.rollbackRecommended)return`Для версии ${result.status?.currentVersion||''} рекомендован безопасный откат до ${result.version||result.status?.targetVersion||'предыдущей рабочей версии'}.`.replace('  ',' ');
    if(kind==='check'&&result.updateAvailable)return`Найдена версия ${result.version||result.status?.targetVersion||'новее установленной'}. Нажмите «Скачать обновление».`;
    if(kind==='check'&&result.reason==='rollout')return'Новая версия выпускается постепенно и пока не назначена этому компьютеру.';
    if(kind==='check'&&['halt','withdrawn'].includes(result.reason))return'Выпуск этой версии остановлен. Ранее скачанный файл не будет установлен.';
    if(kind==='check'&&result.reason==='superseded')return'Ранее подготовленное обновление отменено: опубликован новый подписанный выпуск.';
    if(kind==='check')return'Установлена последняя доступная версия.';
    if(kind==='download')return`Версия ${result.version||result.status?.targetVersion||''} скачана и полностью проверена. Можно установить её сейчас.`.replace('  ',' ');
    if(kind==='apply')return'Установка запущена. Программа закроется и откроется снова автоматически.';
    if(kind==='afterClose')return'Обновление загружено и будет установлено после закрытия программы.';
    if(kind==='remindLater')return`Напоминание отложено${result.remindAfter?` до ${formatDate(result.remindAfter)}`:''}.`;
    return'';
  }
  function formatDate(value){if(!value)return'Ещё не выполнялась';const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(date)}
  function formatBytes(value){const bytes=Number(value||0);if(!(bytes>0))return'—';return bytes>=1073741824?`${(bytes/1073741824).toFixed(1)} ГБ`:`${(bytes/1048576).toFixed(bytes>=104857600?0:1)} МБ`}
  function historyText(value){if(!value)return'Истории обновлений пока нет';const labels={CONFIRMED:'Успешно установлена',ROLLED_BACK:'Восстановлена предыдущая версия',FAILED:'Операция остановлена'};return`${labels[value.state]||'Последняя операция'}${value.toVersion?` · ${value.toVersion}`:''}${value.updatedAt?` · ${formatDate(value.updatedAt)}`:''}`}
  function render(input={},message){
    const root=q('#jfUpdateCenter');if(!root)return null;
    lastStatus={...(lastStatus||{}),...(input&&typeof input==='object'?input:{})};if(message!==undefined)lastMessage=String(message||'');
    const status=lastStatus,state=safeState(status.state),enabled=status.enabled===true,presentation=statePresentation[state]||statePresentation.IDLE;
    const badge=q('#jfUpdateBadge'),statusBox=q('#jfUpdateStatus'),current=q('#jfUpdateCurrentVersion'),target=q('#jfUpdateTargetVersion'),channel=q('#jfUpdateChannel'),lastChecked=q('#jfUpdateLastChecked'),payloadSize=q('#jfUpdatePayloadSize'),summary=q('#jfUpdateReleaseSummary'),history=q('#jfUpdateHistory'),diagnostic=q('#jfUpdateDiagnostic');
    if(current)current.textContent=String(status.currentVersion||'—');if(target)target.textContent=String(status.targetVersion||'—');if(channel)channel.textContent=channelLabels[status.channel]||String(status.channel||'—');
    if(lastChecked)lastChecked.textContent=formatDate(status.lastCheckedAt);if(payloadSize)payloadSize.textContent=formatBytes(status.payloadBytes);if(summary){summary.textContent=String(status.releaseSummary||status.directiveMessage||'');summary.hidden=!summary.textContent}if(history)history.textContent=historyText(status.lastOperation);if(diagnostic)diagnostic.textContent=String(status.diagnosticId||'—');
    let badgeText=presentation.badge,badgeKind=presentation.kind,statusText=lastMessage||presentation.message,statusKind='';
    if(!enabled){badgeText='Не подключено';badgeKind='error';statusText=lastMessage||codeMessages.UPDATE_DISABLED;statusKind='error'}
    else if(status.error){statusText=lastMessage||failureMessage(status.error);statusKind='error'}
    else if(!lastMessage&&state==='READY_TO_APPLY'&&status.installTiming==='after_close'){statusText='Обновление загружено и будет установлено после закрытия программы.';statusKind='ok'}
    else if(!lastMessage&&status.installTiming==='remind_later'&&status.remindAfter){statusText=`Напоминание отложено до ${formatDate(status.remindAfter)}.`}
    else if(!lastMessage&&status.rollbackRecommended){statusText=status.directiveMessage||'Для установленной версии рекомендован безопасный откат.'}
    else if(['CONFIRMED','IDLE'].includes(state)&&lastMessage){statusKind='ok'}
    if(state==='ROLLED_BACK'||state==='FAILED')statusKind='error';
    if(badge){badge.textContent=badgeText;badge.className=`jf-update-badge ${badgeKind}`}
    if(statusBox){statusBox.textContent=statusText;statusBox.className=`jf-update-status${statusKind?` ${statusKind}`:''}`}
    const progress=status.progress&&typeof status.progress==='object'?status.progress:null,received=Number(progress?.receivedBytes||0),total=Number(progress?.totalBytes||0),percent=total>0?Math.max(0,Math.min(100,Math.round(received/total*100))):0,showProgress=state==='DOWNLOADING'||Boolean(progress);
    const progressBox=q('#jfUpdateProgress'),progressText=q('#jfUpdateProgressText'),progressPercent=q('#jfUpdateProgressPercent'),progressTrack=q('#jfUpdateProgressTrack'),progressBar=q('#jfUpdateProgressBar');
    if(progressBox)progressBox.hidden=!showProgress;if(progressText)progressText.textContent=total>0?`${(received/1048576).toFixed(1)} из ${(total/1048576).toFixed(1)} МБ`:'Скачивание обновления';if(progressPercent)progressPercent.textContent=`${percent}%`;if(progressTrack)progressTrack.setAttribute('aria-valuenow',String(percent));if(progressBar)progressBar.style.width=`${percent}%`;
    const check=q('#jfUpdateCheck'),download=q('#jfUpdateDownload'),apply=q('#jfUpdateApply'),afterClose=q('#jfUpdateAfterClose'),remindLater=q('#jfUpdateRemindLater'),copyDiagnostic=q('#jfUpdateCopyDiagnostic'),locked=actionBusy||busyStates.has(state);
    if(check)check.disabled=!enabled||locked;if(download)download.disabled=!enabled||actionBusy||state!=='UPDATE_AVAILABLE';if(apply)apply.disabled=!enabled||actionBusy||state!=='READY_TO_APPLY';if(afterClose)afterClose.disabled=!enabled||actionBusy||state!=='READY_TO_APPLY';if(remindLater)remindLater.disabled=!enabled||actionBusy||!['UPDATE_AVAILABLE','READY_TO_APPLY'].includes(state);if(copyDiagnostic)copyDiagnostic.disabled=!status.diagnosticId;
    root.setAttribute('aria-busy',locked?'true':'false');root.dataset.updateReady='1';return status;
  }
  async function refresh(){
    const api=window.JustFunDesktop?.updates;if(typeof api?.status!=='function')return render({enabled:false,state:'FAILED',currentVersion:'—' },'Обновления доступны только в установленном Windows-приложении.');
    try{const result=await api.status();return render(result)}catch(error){return render({enabled:false,state:'FAILED'},failureMessage(error))}
  }
  async function run(kind){
    const api=window.JustFunDesktop?.updates,operation=api?.[kind];if(typeof operation!=='function')return{ok:false,code:'UPDATE_API_MISSING'};
    if(actionBusy)return{ok:false,code:'UPDATE_BUSY'};actionBusy=true;lastMessage=kind==='check'?'Проверяем наличие обновления…':(kind==='download'?'Скачиваем и проверяем обновление…':(kind==='apply'?'Запускаем безопасную установку…':'Сохраняем выбранное время установки…'));render(lastStatus||{},lastMessage);
    try{const result=await operation.call(api);lastStatus=result?.status||lastStatus||{};lastMessage=resultMessage(kind,result);render(lastStatus,lastMessage);return result}
    catch(error){const result={ok:false,code:error?.code,message:error?.message};lastMessage=failureMessage(result);render(lastStatus||{enabled:true,state:'FAILED'},lastMessage);return result}
    finally{actionBusy=false;render(lastStatus||{},lastMessage)}
  }
  async function apply(){
    if(typeof window.jfConfirm!=='function'){lastMessage='Безопасное окно подтверждения недоступно. Установка не запущена.';render(lastStatus||{},lastMessage);return{ok:false,code:'UPDATE_CONFIRMATION_MISSING'}}
    const accepted=await window.jfConfirm('Сохраните незавершённую работу. Программа закроется, установит проверенное обновление и запустится снова. Продолжить?',{title:'Установить обновление',confirmLabel:'Установить и перезапустить',kind:'warning'});
    return accepted?run('apply'):{ok:false,canceled:true};
  }
  async function copyDiagnostic(){const value=String(lastStatus?.diagnosticId||'');if(!value)return{ok:false,code:'UPDATE_DIAGNOSTIC_MISSING'};try{await window.JustFunDesktop?.copyText?.(value);lastMessage='Код для поддержки скопирован.';render(lastStatus,lastMessage);return{ok:true,value}}catch{return{ok:false,code:'UPDATE_DIAGNOSTIC_COPY_FAILED'}}}
  async function install(){
    const root=q('#jfUpdateCenter');if(!root)return false;
    if(!installed){installed=true;q('#jfUpdateCheck')?.addEventListener('click',()=>run('check'));q('#jfUpdateDownload')?.addEventListener('click',()=>run('download'));q('#jfUpdateApply')?.addEventListener('click',()=>apply());q('#jfUpdateAfterClose')?.addEventListener('click',()=>run('afterClose'));q('#jfUpdateRemindLater')?.addEventListener('click',()=>run('remindLater'));q('#jfUpdateCopyDiagnostic')?.addEventListener('click',()=>copyDiagnostic());const api=window.JustFunDesktop?.updates;if(typeof api?.onStatus==='function')unsubscribe=api.onStatus(status=>{lastMessage='';render(status)})}
    await refresh();return true;
  }
  window.JustFunUpdateCenterV783=Object.freeze({install,refresh,render,check:()=>run('check'),download:()=>run('download'),apply,afterClose:()=>run('afterClose'),remindLater:()=>run('remindLater'),copyDiagnostic,status:()=>lastStatus,dispose:()=>{unsubscribe?.();unsubscribe=null}});
  const start=()=>install().catch(error=>render({enabled:false,state:'FAILED'},failureMessage(error)));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
