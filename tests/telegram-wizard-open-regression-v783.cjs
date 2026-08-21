const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'source','application','main.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'source','application','web','assets','js','110-desktop-platform-v750.js'),'utf8');

function assert(condition,message){if(!condition)throw new Error(message)}
function body(name,nextName){
  const start=main.indexOf(`async function ${name}`);
  const end=main.indexOf(`async function ${nextName}`,start+1);
  assert(start>=0&&end>start,`Не найдена функция ${name}`);
  return main.slice(start,end);
}

const configure=body('configureTelegram','getLocalTelegramStatus');
assert(configure.indexOf('openTelegramSetupWizard(repair)')>=0,'Мастер токенов не вызывается');
assert(configure.indexOf('openTelegramSetupWizard(repair)')<configure.indexOf('verifyCloudAuthContext()'),'Сетевая проверка снова блокирует открытие мастера');
assert(configure.includes('isTemporaryCompanyServiceError(error)'),'Нет безопасного продолжения при временном сбое сервера компании');
assert(configure.includes('companyPublishPending=true'),'Нет отложенной публикации профиля компании');
assert(configure.includes('getLocalTelegramStatus(warehouseId)'),'Нет локальной итоговой проверки Worker и webhook активного склада');

assert(main.includes("win.webContents.once('did-finish-load',()=>{if(!win.isVisible())reveal()})"),'Нет резервного показа загруженного окна');
assert(main.includes("Telegram setup wizard shown"),'Показ мастера не записывается в журнал');
assert(main.includes("Telegram company broker retry"),'Нет повторов соединения с сервером профиля компании');
assert(main.includes("company-broker-pending-v1"),'Нет состояния автономно работающего Worker');
assert(main.includes('scheduleTelegramCompanyPublishRetry'),'Нет реального планировщика повторной публикации');
assert(main.includes("desktop:telegram-company-published"),'Интерфейс не получает подтверждение успешного фонового повтора');
assert(ui.includes("Настройка не завершена"),'Интерфейс не отличает локальную работу от завершённой серверной привязки');
assert(ui.includes("Автоматический повтор не запланирован"),'Интерфейс скрывает состояние планировщика повторов');
assert(ui.includes("Следующая автоматическая попытка"),'Интерфейс не показывает время следующего повтора');

console.log(JSON.stringify({ok:true,wizardBeforeNetwork:true,windowFallback:true,networkRetry:true,offlineProvisioning:true,pendingPublication:true,honestRetryStatus:true}));
