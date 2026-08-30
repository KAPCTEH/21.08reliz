/* JustFun Desktop Platform 7.8.4 */
(function(){
'use strict';
const VERSION=String(window.JustFunDesktop?.version||(typeof APP_VERSION==='string'?APP_VERSION:'7.8.4')), AUDIT_KEY='jf_auth_audit_v750', SESSION_KEY='jf_session_v750';
const ROLE_LABELS={owner:'Владелец',admin:'Администратор',director:'Директор',manager:'Менеджер',logistic:'Логист',warehouse:'Кладовщик',accountant:'Бухгалтер',viewer:'Только просмотр'};
const ROLE_TABS={
  owner:['orders','trips','products','drivers','reports','settings','programSettings'],admin:['orders','trips','products','drivers','reports','settings','programSettings'],
  director:['orders','trips','products','drivers','reports'],manager:['orders','trips','products','drivers','reports'],logistic:['orders','trips','drivers','settings'],
  warehouse:['orders','products'],accountant:['orders','reports'],viewer:['orders','trips','products','drivers','reports']
};
const TAB_ID={orders:'tabOrders',trips:'tabTrips',products:'tabProducts',drivers:'tabDrivers',reports:'tabReports',settings:'tabSettings',programSettings:'tabProgramSettings'};
const WRITE_ROLES=new Set(['owner','admin','director','manager','logistic','warehouse','accountant']);
const ROUTE_MANAGER_PERMISSIONS=['routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel','routes.settings'];
const LEGACY_PERMISSION_EXPANSIONS=Object.freeze({
  'orders.update':['orders.create','orders.status','orders.payment','orders.pricing','orders.delete'],
  'routes.update':['routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel','routes.settings'],
  'inventory.update':['inventory.catalog','inventory.stock','inventory.pricing','inventory.pick','inventory.delete'],
  'drivers.update':['drivers.assign','drivers.delete'],
  'reports.update':['reports.settings','reports.expenses']
});
const LOCAL_ROLE_PERMISSIONS={
  owner:['*'],admin:['*'],
  director:['orders.read','routes.read','inventory.read','drivers.read','reports.*'],
  manager:['orders.*','routes.read',...ROUTE_MANAGER_PERMISSIONS,'inventory.read','drivers.read','reports.read'],
  logistic:['orders.read','orders.update','routes.*','drivers.*','inventory.read'],
  warehouse:['orders.read','orders.update','inventory.*','routes.read'],
  accountant:['orders.read','reports.*'],
  viewer:['orders.read','routes.read','inventory.read','drivers.read','reports.read']
};
const FUNCTION_PERMISSIONS={
  openOrderModal:'orders.create',saveOrder:'orders.update',openPickupModal:'orders.create',savePickup:'orders.update',editCurrentOrder:'orders.update',
  toggleCurrentOrderPayment:'orders.payment',markCurrentPickupReady:'inventory.pick',markCurrentPickupCollected:'inventory.pick',
  retryCurrentDelivery:'orders.status',resolveCurrentPartial:'orders.status',confirmNotRelevant:'orders.status',
  setOrderFulfillment:'orders.status',setRouteOrderOutcome:'orders.status',archiveOrder:'orders.status',
  deleteOrder:'orders.delete',
  buildAllRoutes:'routes.plan',buildSingleRoute:'routes.plan',createManualRoute:'routes.plan',resetRouteAssignments:'routes.plan',
  openRouteComposer:'routes.plan',addOrderToRoute:'routes.plan',removeOrderFromRoute:'routes.plan',
  assignDriverToRoute:'drivers.assign',clearRouteDriver:'drivers.assign',approveRouteManually:'routes.approve',
  restoreAllUnassigned:'routes.plan',restoreAutoAssignment:'routes.plan',clearRoutePlans:'routes.plan',
  startRoutePicking:'routes.pick',cancelRouteBeforeStart:'routes.cancel',startRoute:'routes.start',openRouteClosure:'routes.return',commitRouteClosure:'routes.close',
  saveRouteTitle:'routes.plan',saveRouteEditSettings:'routes.settings',applyRoutePricingProposal:'orders.pricing',
  restoreRouteStandalonePricing:'orders.pricing',saveSettingsFromForm:'routes.settings',
  saveDriverPaymentSettings:'routes.settings',saveDeliveryPricingSettings:'routes.settings',
  openDriverModal:'drivers.update',saveDriver:'drivers.update',deleteDriver:'drivers.delete',deleteCurrentDriver:'drivers.delete',
  openProductModal:'inventory.catalog',saveProduct:'inventory.catalog',deleteProduct:'inventory.delete',deleteCurrentProduct:'inventory.delete',
  openInventoryMovementModal:'inventory.stock',openMovementForCurrentProduct:'inventory.stock',saveInventoryMovement:'inventory.stock',reverseInventoryMovement:'inventory.stock',
  importProductsFromOrders:'inventory.catalog',
  saveReportCalculationSettings:'reports.settings',saveReportEmployee:'reports.expenses',deleteReportEmployee:'reports.expenses',
  saveReportExpense:'reports.expenses',deleteReportExpense:'reports.expenses',
  openWarehouseCreatorV600:'warehouses.manage',openWarehouseEditorV600:'warehouses.manage',saveWarehouseEditorV600:'warehouses.manage',
  toggleWarehouseArchiveV600:'warehouses.manage',deleteWarehouseV760:'warehouses.manage',saveCompanySettingsV600:'company.update',
  loadCompanyLogoV600:'company.update',removeCompanyLogoV600:'company.update',saveServiceSettings:'integrations.manage',resetServiceSettings:'integrations.manage',
  chooseBackupFile:'company.update',importBackupFile:'company.update',clearAll:'company.update',restartDemonstrationScenario:'company.update'
};
const FUNCTION_ADDITIONAL_PERMISSIONS=Object.freeze({buildAllRoutes:['orders.status'],buildSingleRoute:['orders.status']});
const FORM_PERMISSIONS={orderForm:'orders.update',pickupForm:'orders.update',driverForm:'drivers.update',productForm:'inventory.catalog',inventoryMovementForm:'inventory.stock',reportEmployeeForm:'reports.expenses',reportExpenseForm:'reports.expenses'};
const CONTROL_PERMISSIONS={
  toggleOrderPaymentBtn:'orders.payment',editOrderBtn:'orders.update',orderNotRelevantBtn:'orders.status',
  pickupReadyBtn:'inventory.pick',pickupCollectedBtn:'inventory.pick',retryDeliveryBtn:'orders.status',
  partialRepeatBtn:'orders.status',partialPickupBtn:'orders.status',partialCloseBtn:'orders.status',deleteOrderBtn:'orders.delete',
  deleteDriverBtn:'drivers.delete',deleteProductBtn:'inventory.delete',restartDemoButton:'company.update'
};
const DEMO_CLOUD_ADMIN_FUNCTIONS=new Set(['openWarehouseCreatorV600','saveWarehouseEditorV600','toggleWarehouseArchiveV600','deleteWarehouseV760']);
const DEMO_CLOUD_CONTROL_IDS=new Set(['jfAddUser','jfRegConfigure','jfRegCheck','jfRegSync','jfRegRestore','jfTelegramConfigure','jfTelegramReconnect','jfTelegramCheck','jfTelegramWarehouse']);
const CLOUD_ID_RE=/^[A-Za-z0-9_-]{16,80}$/;
let desktopSession=null,currentUser=null,users=[],guardInstalled=false,entityCommandGuardsInstalled=false,permissionEventsInstalled=false,permissionObserverInstalled=false,memorySession=null,startupReadySent=false,integrationWizardBusy=false,backgroundWorkspaceSyncStarted=false;
let liveAccessRefreshTimer=null,liveAccessRefreshPromise=null,liveAccessRefreshEventsInstalled=false,liveAccessRefreshStopped=true,lastLiveAccessSignature='';
let telegramBindings=new Map(),telegramRouteState={},telegramRouteScope='',telegramPollTimer=null,telegramPollFailures=0,telegramPollingConfigured=null,lastTelegramStatus=null,telegramRouteGuardInstalled=false;
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function id(){return crypto.randomUUID?crypto.randomUUID():'u-'+Date.now().toString(36)+Math.random().toString(36).slice(2)}
function audit(action,detail={},correlationId=''){const eventId=String(correlationId||id());try{const warehouseId=activeWarehouseId(),event={id:eventId,at:new Date().toISOString(),userId:currentUser?.id||null,login:currentUser?.login||'',warehouseId,action,detail};const a=JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]');a.unshift(event);localStorage.setItem(AUDIT_KEY,JSON.stringify(a.slice(0,3000)));window.JustFunDesktop?.audit?.event?.({correlationId:eventId,action,warehouseId,environment:activeEnvironment(),detail})?.catch?.(()=>{})}catch{}return eventId}
function registry(){return window.TeplitsaWarehouseBootstrap?.getRegistry?.()||{activeWarehouseId:'',warehouses:[]}}
function activeWarehouseId(){return String(window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.id||'')}
function allowedWarehouseIds(user=currentUser){if(!user)return[];const all=registry().warehouses.filter(w=>w.status!=='archived').map(w=>String(w.id));return user.allWarehouses?all:(user.warehouseIds||[]).map(String).filter(x=>all.includes(x))}
function roleFor(user=currentUser){return user?.role||'viewer'}
function exactPermissionList(value){const result=[];for(const permission of Array.isArray(value)?value.map(String):[])if(permission&&!result.includes(permission))result.push(permission);return result}
function normalizePermissionList(value){const result=exactPermissionList(value);for(const permission of [...result])for(const expanded of LEGACY_PERMISSION_EXPANSIONS[permission]||[])if(!result.includes(expanded))result.push(expanded);return result}
function permissionList(user=currentUser){if(!user)return[];if(isTrainingEnvironment()||!user.serverRole)return normalizePermissionList(LOCAL_ROLE_PERMISSIONS[roleFor(user)]||LOCAL_ROLE_PERMISSIONS.viewer);return exactPermissionList(user.permissions)}
function hasPermission(name,user=currentUser){const list=permissionList(user);if(user?.role==='owner'||list.includes('*'))return true;const domain=String(name||'').split('.')[0];return list.includes(name)||list.includes(domain+'.*')}
function permissionRequirements(value){return[...new Set((Array.isArray(value)?value:[value]).map(String).filter(Boolean))]}
function functionPermissionRequirements(name,fallback,args=[]){return permissionRequirements([resolvedFunctionPermission(name,fallback,args),...(FUNCTION_ADDITIONAL_PERMISSIONS[name]||[])])}
function missingPermissions(value,user=currentUser){return permissionRequirements(value).filter(permission=>!hasPermission(permission,user))}
function hasPermissions(value,user=currentUser){return missingPermissions(value,user).length===0}
window.JustFunPermissionAccessV783=Object.freeze({has:permission=>hasPermission(permission),hasAll:permissions=>hasPermissions(permissions),missing:permissions=>missingPermissions(permissions)});
window.JustFunWarehouseAccessV783=Object.freeze({canCreate:()=>!isTrainingEnvironment()&&hasPermission('warehouses.manage')&&currentUser?.allWarehouses===true,canDelete:()=>!isTrainingEnvironment()&&hasPermission('warehouses.manage')&&currentUser?.allWarehouses===true});
function resolvedFunctionPermission(name,fallback,args=[]){
  if(name==='openOrderModal'||name==='openPickupModal')return args[0]?'orders.update':'orders.create';
  if(name==='saveOrder')return q('#editingOrderId')?.value?'orders.update':'orders.create';
  if(name==='savePickup')return q('#editingPickupId')?.value?'orders.update':'orders.create';
  return fallback
}
function formPermission(form){if(!form)return'';if(form.id==='orderForm')return q('#editingOrderId')?.value?'orders.update':'orders.create';if(form.id==='pickupForm')return q('#editingPickupId')?.value?'orders.update':'orders.create';return FORM_PERMISSIONS[form.id]||''}
function allowedTabs(user=currentUser){
  if(!user)return[];
  if(isTrainingEnvironment()||!user.serverRole)return ROLE_TABS[roleFor(user)]||ROLE_TABS.viewer;
  if(user.role==='owner'||hasPermission('*',user))return ROLE_TABS.owner;
  const tabs=[];
  if(hasPermission('orders.read',user))tabs.push('orders');
  if(hasPermission('routes.read',user))tabs.push('trips');
  if(hasPermission('inventory.read',user))tabs.push('products');
  if(hasPermission('drivers.read',user))tabs.push('drivers');
  if(hasPermission('reports.read',user))tabs.push('reports');
  if(hasPermission('routes.settings',user))tabs.push('settings');
  if(['warehouses.manage','company.update','integrations.manage','users.read','users.create','users.update','devices.manage'].some(permission=>hasPermission(permission,user)))tabs.push('programSettings');
  return [...new Set(tabs)];
}
function setSession(user){memorySession={userId:user.id,startedAt:new Date().toISOString()};try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(memorySession))}catch{}}
function clearSession(){memorySession=null;try{sessionStorage.removeItem(SESSION_KEY)}catch{}}
function passwordValid(p){return typeof p==='string'&&p.length>=10&&/[A-Za-zА-Яа-яЁё]/.test(p)&&/\d/.test(p)}
const SERVER_ROLE_TO_APP={owner:'owner'};
const CLOUD_PERMISSION_GROUPS=[
  {title:'Заказы',items:[['orders.read','Просматривать'],['orders.create','Создавать'],['orders.update','Изменять данные'],['orders.status','Менять состояние работы'],['orders.payment','Отмечать оплату'],['orders.pricing','Менять цены доставки'],['orders.delete','Удалять']]},
  {title:'Рейсы',items:[['routes.read','Просматривать'],['routes.plan','Составлять и пересчитывать'],['routes.approve','Согласовывать предупреждения'],['routes.pick','Начинать комплектацию'],['routes.start','Подтверждать выезд'],['routes.return','Подтверждать возврат'],['routes.close','Закрывать рейс'],['routes.cancel','Отменять до выезда'],['routes.settings','Менять правила маршрутов']]},
  {title:'Товары и склад',items:[['inventory.read','Просматривать'],['inventory.catalog','Вести каталог'],['inventory.stock','Приход, корректировки и списания'],['inventory.pricing','Менять закупочные и продажные цены'],['inventory.pick','Комплектовать и выдавать'],['inventory.delete','Удалять товары']]},
  {title:'Водители',items:[['drivers.read','Просматривать'],['drivers.update','Изменять карточки'],['drivers.assign','Назначать на рейс'],['drivers.delete','Удалять']]},
  {title:'Отчётность',items:[['reports.read','Просматривать'],['reports.settings','Настраивать методику'],['reports.expenses','Вести сотрудников и расходы']]},
  {title:'Управление',items:[['company.update','Реквизиты компании'],['warehouses.manage','Создавать и настраивать склады'],['integrations.manage','Настраивать VPS и подключения'],['users.read','Просматривать сотрудников'],['users.create','Приглашать сотрудников'],['users.update','Изменять их доступ'],['devices.manage','Блокировать компьютеры']]},
];
const CLOUD_PERMISSION_HELP={
  'orders.read':'Видит список, карточки и состав заказов.','orders.create':'Создаёт новые доставки и самовывозы.','orders.update':'Исправляет контакты, адрес, дату и состав.','orders.status':'Переводит заказ между рабочими состояниями.','orders.payment':'Отмечает поступление или отмену оплаты.','orders.pricing':'Меняет стоимость доставки и её способ расчёта.','orders.delete':'Удаляет только незаблокированные заказы.',
  'routes.read':'Видит рейсы, точки, карты и маршрутные листы.','routes.plan':'Создаёт рейсы, меняет состав и пересчитывает маршрут.','routes.approve':'Принимает обоснованное решение по предупреждениям.','routes.pick':'Запускает складскую комплектацию и резерв.','routes.start':'Подтверждает выпуск автомобиля со склада.','routes.return':'Фиксирует возвращение автомобиля.','routes.close':'Закрывает результат рейса и складские операции.','routes.cancel':'Отменяет рейс до выезда и освобождает резерв.','routes.settings':'Меняет алгоритмы, ограничения и оплату водителей.',
  'inventory.read':'Видит каталог, остаток, резерв и доступное количество.','inventory.catalog':'Создаёт и редактирует карточки товаров.','inventory.stock':'Оформляет приход, корректировку и списание.','inventory.pricing':'Изменяет закупочные и продажные цены.','inventory.pick':'Комплектует, выдаёт и подтверждает складские операции.','inventory.delete':'Удаляет товар только при допустимом состоянии.',
  'drivers.read':'Видит водителей, автомобили и доступность.','drivers.update':'Создаёт и изменяет карточки водителей и машин.','drivers.assign':'Назначает водителя и автомобиль на рейс.','drivers.delete':'Удаляет незадействованные карточки.',
  'reports.read':'Открывает отчёт директора и рабочие показатели.','reports.settings':'Меняет методику признания доходов и расходов.','reports.expenses':'Ведёт зарплаты, постоянные и разовые расходы.',
  'company.update':'Меняет реквизиты, логотип и данные документов.','warehouses.manage':'Создаёт склады, адреса и складские настройки.','integrations.manage':'Настраивает VPS, Telegram и служебные подключения.','users.read':'Видит сотрудников, их роли, права и склады.','users.create':'Создаёт одноразовые приглашения.','users.update':'Меняет роль, разрешения и доступные склады.','devices.manage':'Блокирует и разблокирует подключённые компьютеры.'
};
let cloudDevices=[];
function cloudWarehouseScope(permissions=[],role='viewer'){
  const list=Array.isArray(permissions)?permissions.map(String):[];
  if(role==='owner'||list.includes('*')||list.includes('jf.warehouse:*'))return{allWarehouses:true,warehouseIds:[]};
  const directIds=list.filter(x=>x.startsWith('jf.warehouse:')&&!x.startsWith('jf.warehouse-code:')).map(x=>x.slice('jf.warehouse:'.length)).filter(Boolean);
  const codes=list.filter(x=>x.startsWith('jf.warehouse-code:')).map(x=>x.slice('jf.warehouse-code:'.length).toUpperCase()).filter(Boolean);
  const byCode=(registry().warehouses||[]).filter(w=>codes.includes(String(w.code||'').toUpperCase())).map(w=>String(w.id));
  const warehouseIds=[...new Set([...directIds,...byCode])];
  return warehouseIds.length?{allWarehouses:false,warehouseIds}:{allWarehouses:false,warehouseIds:[]};
}
function cloudUserToLocal(user,company={},auth={}){
  const serverRole=String(user?.role||'viewer'),scope=cloudWarehouseScope(user?.permissions,serverRole);
  return{id:String(user?.id||''),fullName:String(user?.full_name||user?.fullName||user?.login||'Пользователь'),login:String(user?.login||''),role:SERVER_ROLE_TO_APP[serverRole]||serverRole,serverRole,permissions:Array.isArray(user?.permissions)?user.permissions:[],status:String(user?.status||'active'),companyCode:String(company?.code||''),companyName:String(company?.name||''),deviceId:String(auth?.device_id||''),...scope};
}
function cloudPermissions(selectedPermissions,allWarehouses,warehouseIds){
  const ids=[...new Set((warehouseIds||[]).map(String).filter(id=>/^[A-Za-z0-9_-]{1,120}$/.test(id)))];
  return[...new Set([...(selectedPermissions||[]),...(allWarehouses?['jf.warehouse:*']:ids.map(id=>'jf.warehouse:'+id))])];
}
function grantableCloudPermissions(){
  const all=CLOUD_PERMISSION_GROUPS.flatMap(group=>group.items.map(item=>item[0]));
  return currentUser?.role==='owner'||hasPermission('*')?all:all.filter(permission=>hasPermission(permission));
}
function cloudPermissionPicker(name,selected=[]){
  const allowed=new Set(grantableCloudPermissions()),checked=new Set(selected);
  return CLOUD_PERMISSION_GROUPS.map(group=>{const items=group.items.filter(([permission])=>allowed.has(permission));if(!items.length)return'';return`<fieldset class="jf-permission-group" data-permission-group><legend>${esc(group.title)}</legend><div class="jf-permission-group-actions"><button type="button" data-permission-select="all">Выбрать всё</button><button type="button" data-permission-select="none">Очистить</button></div>${items.map(([permission,label])=>`<label data-permission-label><input type="checkbox" name="${name}" value="${permission}" ${checked.has(permission)?'checked':''}> <span><b>${esc(label)}</b><small>${esc(CLOUD_PERMISSION_HELP[permission]||'Разрешает это действие в назначенных складах.')}</small></span></label>`).join('')}</fieldset>`}).join('');
}
function cloudPermissionTools(name){return`<div class="jf-permission-tools"><label><span>Найти право</span><input type="search" data-permission-search placeholder="Например: оплата, склад, рейс"></label><div><b data-permission-count>Выбрано: 0</b><span>Действия применяются только к назначенным ниже складам.</span></div></div>`}
function prepareCloudPermissionEditor(modal,name){
  const inputs=()=>qa(`input[name="${name}"]`,modal),count=q('[data-permission-count]',modal),search=q('[data-permission-search]',modal),refresh=()=>{if(count)count.textContent=`Выбрано: ${inputs().filter(input=>input.checked).length}`};
  qa('[data-permission-select]',modal).forEach(button=>button.onclick=()=>{qa(`input[name="${name}"]`,button.closest('[data-permission-group]')).forEach(input=>input.checked=button.dataset.permissionSelect==='all');refresh()});
  inputs().forEach(input=>input.onchange=()=>{if(input.checked&&!input.value.endsWith('.read')){const domain=input.value.split('.')[0],read=inputs().find(candidate=>candidate.value===`${domain}.read`);if(read)read.checked=true}refresh()});
  if(search)search.oninput=()=>{const query=search.value.trim().toLocaleLowerCase('ru-RU');qa('[data-permission-label]',modal).forEach(label=>label.hidden=!!query&&!label.textContent.toLocaleLowerCase('ru-RU').includes(query));qa('[data-permission-group]',modal).forEach(group=>group.hidden=!qa('[data-permission-label]',group).some(label=>!label.hidden))};
  refresh()
}
async function applyCloudAuth(auth){
  desktopSession.auth=auth;
  const companyId=String(auth?.company?.id||'');
  if(!CLOUD_ID_RE.test(companyId)||!String(auth?.user?.id||'')){
    await window.JustFunDesktop?.auth?.logout?.();
    desktopSession.auth=null;currentUser=null;users=[];
    renderCloudWelcome('Сервер лицензий не подтвердил идентификатор компании. Сессия очищена — выполните вход повторно.');
    return false;
  }
  if(String(window.JustFunDesktop?.bootstrapCompanyId||'')!==companyId){
    await window.JustFunDesktop?.restart?.();
    return false;
  }
  currentUser=cloudUserToLocal(auth?.user,auth?.company,auth);users=[currentUser];lastLiveAccessSignature=liveAccessSignature(auth);startLiveAccessRefresh();audit('cloud_login_success',{company:currentUser.companyCode,companyId,offline:!!auth?.offline});return await enterWorkspace()
}
const LIVE_ACCESS_REFRESH_INTERVAL_MS=15000;
const TERMINAL_LIVE_ACCESS_ERRORS=new Set(['AUTH_REQUIRED','AUTH_CONTEXT_INCOMPLETE','AUTH_CONTEXT_MISMATCH','INVALID_TOKEN','INVALID_SESSION','SESSION_UPGRADE_REQUIRED','LICENSE_BLOCKED','USER_BLOCKED','DEVICE_BLOCKED']);
function liveAccessSignature(auth){
  const permissions=[...new Set(asArray(auth?.user?.permissions).map(String))].sort();
  return JSON.stringify({user:{id:String(auth?.user?.id||''),role:String(auth?.user?.role||''),status:String(auth?.user?.status||''),permissions},company:{id:String(auth?.company?.id||''),code:String(auth?.company?.code||''),name:String(auth?.company?.name||''),status:String(auth?.company?.status||''),dataService:auth?.company?.data_service||null,telegramService:auth?.company?.telegram_service||null},deviceId:String(auth?.device_id||''),offline:!!auth?.offline})
}
function liveAccessRefreshBusy(){return integrationWizardBusy||Number(cloudSyncState?.suspended)>0||currentEntityInFlight()||currentEntityBootstrapInFlight()>0||ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0||criticalEntityFlightCount()>0}
function scheduleLiveAccessRefresh(delay=LIVE_ACCESS_REFRESH_INTERVAL_MS){
  if(liveAccessRefreshStopped||desktopSession?.edition==='demo'||!desktopSession?.auth?.user)return;
  clearTimeout(liveAccessRefreshTimer);liveAccessRefreshTimer=setTimeout(()=>refreshLiveAccess('periodic').catch(error=>console.warn('Не удалось обновить активные права',error)),Math.max(250,Number(delay)||LIVE_ACCESS_REFRESH_INTERVAL_MS))
}
function stopLiveAccessRefresh(){liveAccessRefreshStopped=true;clearTimeout(liveAccessRefreshTimer);liveAccessRefreshTimer=null}
function startLiveAccessRefresh(){
  if(desktopSession?.edition==='demo'||!desktopSession?.auth?.user)return;
  liveAccessRefreshStopped=false;
  if(!liveAccessRefreshEventsInstalled){
    liveAccessRefreshEventsInstalled=true;
    window.addEventListener('focus',()=>{if(!liveAccessRefreshStopped)scheduleLiveAccessRefresh(250)});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!liveAccessRefreshStopped)scheduleLiveAccessRefresh(250)})
  }
  scheduleLiveAccessRefresh()
}
function protectedLocalEntityChanges(queue){return asArray(queue?.overlayEntries?.()).flatMap(entry=>asArray(entry?.changes))}
async function captureDirtyLocalChangesBeforeAccessRefresh(context,queue){
  if(!cloudSyncState.dirty)return;
  await window.TeplitsaWarehouseV600?.whenPersisted?.();
  if(liveAccessRefreshBusy())throw outboxError('LIVE_ACCESS_REFRESH_DEFERRED','Проверка прав отложена до завершения текущего изменения.');
  let serverEntities=[];if(hasEntityPermissionQuarantine(context)){const result=await window.JustFunDesktop?.regVps?.bootstrapEntities?.({warehouseId:String(context.warehouseId),environment:String(context.environment)});if(!result?.ok)throw outboxError(String(result?.code||'ENTITY_QUARANTINE_RECHECK_FAILED'),String(result?.error||'VPS не вернул актуальные записи для безопасной повторной проверки локальных изменений.'));serverEntities=asArray(result.entities).map(canonicalServerEntity);const matching=serverEntities.filter(entity=>entity?.type==='warehouse'&&String(entity?.id||'')===String(context.warehouseId)&&entity?.deleted!==true&&entity?.operation!=='delete');if(matching.length!==1)throw outboxError('ENTITY_QUARANTINE_WAREHOUSE_STATE_INVALID','VPS не вернул единственную подтверждённую карточку текущего склада. Локальная блокировка сохранена.');const warehouse=matching[0],version=Number(warehouse.version),eventId=Number(warehouse.event_id??warehouse.eventId),digest=String(warehouse.digest_sha256||warehouse.digest||''),previous=cloudSyncState.known.get(entityKey('warehouse',context.warehouseId));if(!Number.isSafeInteger(version)||version<Number(previous?.version||0)||!Number.isSafeInteger(eventId)||eventId<0||!/^[a-f0-9]{64}$/i.test(digest))throw outboxError('ENTITY_QUARANTINE_WAREHOUSE_STATE_INVALID','VPS вернул некорректное служебное состояние склада для повторной проверки. Локальная блокировка сохранена.');cloudSyncState.known.set(entityKey('warehouse',context.warehouseId),{version,digest,fingerprint:semanticEntityFingerprintV784('warehouse',context.warehouseId,warehouse.payload,context),deleted:false,eventId});saveEntitySyncState({required:true})}
  enqueueBackgroundSnapshot(queue,cloneValue(buildBackupPayload()),{knownEntities:new Map(cloudSyncState.known),conflicts:new Map(cloudSyncState.conflicts),context,kind:'access_refresh_local_capture',serverEntities});renderLocalOutboxStatus()
}
function blockTerminalLiveAccess(code,message){
  stopLiveAccessRefresh();stopTelegramPolling();const text=({LICENSE_BLOCKED:'Лицензия или компания заблокирована сервером.',USER_BLOCKED:'Учётная запись сотрудника заблокирована владельцем.',DEVICE_BLOCKED:'Этот компьютер заблокирован владельцем.',INVALID_SESSION:'Сессия завершена. Выполните вход повторно.',INVALID_TOKEN:'Сессия завершена. Выполните вход повторно.',SESSION_UPGRADE_REQUIRED:'Сессия требует безопасного обновления. Выполните вход повторно.'})[code]||message||'Сервер остановил текущую сессию.';let protectedDirty=true;try{protectedDirty=Boolean(cloudSyncState?.dirty||cloudSyncState?.outbox?.status?.().active||durableEntityDirty(cloudSyncState?.scope||entityScope()))}catch{}const blocked=outboxError('ENTITY_LIVE_ACCESS_TERMINATED',`${text} Локальные данные не удалены.`,{serverCode:String(code||'')});if(cloudSyncState){cloudSyncState.contextBlockedError=blocked;cloudSyncState.scopeEpoch++;cloudSyncState.bootstrapPromise=null;cloudSyncState.bootstrapped=false}audit('live_access_terminal_block',{code});freezeWorkspaceForWarehouseTransition();if(cloudSyncState)cloudSyncState.dirty=protectedDirty;renderNoWarehouse(`${text} Локальные данные не удалены. Нажмите «Выйти» и выполните вход повторно.`)
}
async function refreshLiveAccess(reason='periodic'){
  if(liveAccessRefreshStopped||desktopSession?.edition==='demo'||!desktopSession?.auth?.user||typeof window.JustFunDesktop?.auth?.refreshContext!=='function')return false;
  if(liveAccessRefreshPromise)return liveAccessRefreshPromise;
  if(liveAccessRefreshBusy()){scheduleLiveAccessRefresh(1000);return false}
  liveAccessRefreshPromise=(async()=>{
    const result=await window.JustFunDesktop.auth.refreshContext();
    if(!result?.ok){const code=String(result?.error||'NETWORK_ERROR');if(TERMINAL_LIVE_ACCESS_ERRORS.has(code))blockTerminalLiveAccess(code,String(result?.message||''));return false}
    const nextAuth=result.auth,previousAuth=desktopSession.auth;
    if(!nextAuth?.user?.id||!nextAuth?.company?.id||String(nextAuth.user.id)!==String(previousAuth?.user?.id||'')||String(nextAuth.company.id)!==String(previousAuth?.company?.id||'')){blockTerminalLiveAccess('AUTH_CONTEXT_MISMATCH','Сервер вернул другую область доступа.');return false}
    const nextSignature=liveAccessSignature(nextAuth);desktopSession.auth=nextAuth;
    if(nextSignature===lastLiveAccessSignature&&!hasEntityPermissionQuarantine()&&cloudSyncState.contextBlockedError?.code!=='ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED')return true;
    if(cloudSyncState.contextBlockedError&&cloudSyncState.contextBlockedError.code!=='ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED'){currentUser=cloudUserToLocal(nextAuth.user,nextAuth.company,nextAuth);users=[currentUser];lastLiveAccessSignature=nextSignature;addDesktopStrip();applyPermissions();audit('live_access_updated_while_recovery_blocked',{reason,code:String(cloudSyncState.contextBlockedError.code||'ENTITY_CONTEXT_BLOCKED')});return false}
    if(liveAccessRefreshBusy()){desktopSession.auth=previousAuth;scheduleLiveAccessRefresh(1000);return false}
    resetEntityScope();const previousWarehouseId=activeWarehouseId(),context={companyId:String(previousAuth?.company?.id||''),warehouseId:previousWarehouseId,environment:activeEnvironment()},queue=requireLocalOutbox();
    await captureDirtyLocalChangesBeforeAccessRefresh(context,queue);
    if(liveAccessRefreshBusy()){desktopSession.auth=previousAuth;scheduleLiveAccessRefresh(1000);return false}
    const previousPermissions=new Set(asArray(previousAuth?.user?.permissions).map(String));currentUser=cloudUserToLocal(nextAuth.user,nextAuth.company,nextAuth);users=[currentUser];
    const nextPermissions=new Set(asArray(nextAuth?.user?.permissions).map(String)),lostPermissions=[...previousPermissions].filter(permission=>!nextPermissions.has(permission)),protectedChanges=protectedLocalEntityChanges(queue),stillAssigned=currentUser.allWarehouses===true||asArray(currentUser.warehouseIds).map(String).includes(previousWarehouseId);
    lastLiveAccessSignature=nextSignature;
    if(protectedChanges.length&&!stillAssigned)quarantineLocalEntityChanges(protectedChanges,context,'warehouse_access_revoked','Доступ к открытому складу отозван, пока на компьютере есть несинхронизированные изменения. Они сохранены локально, не отправлены на VPS и требуют входа пользователя с подходящими правами либо экспорта резервной копии.');
    if(protectedChanges.length&&lostPermissions.length)quarantineLocalEntityChanges(protectedChanges,context,'permission_set_reduced','Владелец уменьшил права, пока на компьютере есть несинхронизированные изменения. Вся локальная очередь сохранена без отправки на VPS, чтобы ни одна операция не была потеряна или выполнена без нового разрешения.');
    requireWritableLocalEntityChanges(protectedChanges,context,'entity_write_permission_revoked');
    try{await synchronizeCompanyWarehouseRegistry()}catch(error){audit('live_access_registry_refresh_failed',{reason,code:String(error?.code||''),error:String(error?.message||error)})}
    const allowed=allowedWarehouseIds();if(!allowed.includes(activeWarehouseId())&&allowed[0])window.TeplitsaWarehouseBootstrap?.setActive?.(allowed[0]);
    if(applyWarehouseRegistryTransition(previousWarehouseId,'live-access-refresh'))return true;
    if(!document.documentElement.classList.contains('jf-authenticated')&&allowed.length)return enterWorkspace();
    await confirmActiveWarehouseContext();addDesktopStrip();applyPermissions();installUserManagement();if(q('#jfUsersBox'))renderUsersPanel().catch(()=>{});window.renderAll?.()
    audit('live_access_refreshed',{reason,warehouseId:activeWarehouseId(),role:String(currentUser?.serverRole||currentUser?.role||''),permissions:permissionList().length});toast('Права и доступные склады обновлены.','ok');return true
  })();
  try{return await liveAccessRefreshPromise}finally{liveAccessRefreshPromise=null;scheduleLiveAccessRefresh()}
}
function cloudResultError(result,fallback='Операция не выполнена.'){
  const code=String(result?.error||'');
  const known={LOGIN_ALREADY_EXISTS:'В этой компании уже есть сотрудник с таким логином. Укажите другой логин.',INVITATION_ALREADY_EXISTS:'Для этого логина уже действует приглашение. Используйте его или дождитесь окончания срока.',INVITATION_INVALID_OR_EXPIRED:'Приглашение не найдено, отозвано, уже использовано или просрочено.',INVITATION_NOT_FOUND:'Приглашение больше не найдено.',INVITATION_ALREADY_USED:'Приглашение уже принято сотрудником и не может быть отозвано.',INVITATION_ALREADY_EXPIRED:'Срок приглашения уже истёк.',INVITATION_STATE_CHANGED:'Состояние приглашения изменилось на другом компьютере. Обновите список.',INVALID_ROLE_NAME:'Название роли должно содержать от 2 до 50 букв или цифр; роль «owner» зарезервирована.',REQUIRED_FIELDS_MISSING:'Сервер отклонил заполнение одного из полей. Проверьте ФИО и логин.',CANNOT_GRANT_PERMISSION:'Нельзя выдать сотруднику право, которого нет у вашей учётной записи.',ACCESS_BLOCKED:'У вашей учётной записи нет права выполнять это действие.',USER_NOT_FOUND:'Сотрудник больше не найден в этой компании.',CANNOT_CHANGE_SELF:'Нельзя изменять собственные права из этого окна.',OWNER_CANNOT_BE_CHANGED_HERE:'Права владельца нельзя изменить как права сотрудника.'};
  return known[code]||String(result?.message||code||fallback)
}
function renderCloudWelcome(message=''){
  authFrame(`<div id="jfCloudWelcome"><h2>Вход в JustFun</h2><div class="muted">Выберите способ подключения. Доступ к компании, роли и складам подтверждается защищённым сервером.</div><div class="jf-auth-choice-grid"><button class="jf-auth-choice" id="jfCloudActivate"><b>Активировать новую компанию</b><span>Первая установка владельца после покупки</span></button><button class="jf-auth-choice" id="jfCloudLogin"><b>Войти по логину</b><span>Для владельца и созданных сотрудников</span></button><button class="jf-auth-choice" id="jfCloudInvite"><b>Принять приглашение</b><span>Подключение сотрудника на новом компьютере</span></button></div></div>`,'Безопасный доступ');if(message)status(message,true);q('#jfCloudActivate').onclick=renderCloudLicense;q('#jfCloudLogin').onclick=renderCloudLogin;q('#jfCloudInvite').onclick=renderCloudInvitation;
}
function cloudBackButton(){return'<button class="jf-auth-button secondary" type="button" id="jfCloudBack">Назад</button>'}
function renderCloudLicense(){authFrame(`<h2>Активация новой компании</h2><div class="muted">Введите ключ, который вы получили после покупки. Создание владельца разрешается только один раз.</div><form id="jfCloudLicenseForm"><div class="jf-auth-grid"><div class="jf-auth-field span-2"><label>Лицензионный ключ</label><input id="jfCloudLicenseKey" autocomplete="off" spellcheck="false" placeholder="JF-XXXX-XXXX-XXXX-XXXX" required></div></div><div class="jf-auth-actions">${cloudBackButton()}<button class="jf-auth-button" type="submit">Проверить ключ</button></div></form>`,'Первичная активация');q('#jfCloudBack').onclick=()=>renderCloudWelcome();q('#jfCloudLicenseForm').onsubmit=async e=>{e.preventDefault();const key=q('#jfCloudLicenseKey').value.trim();status('Проверяем лицензию…');const r=await window.JustFunDesktop.auth.checkLicense(key);if(!r?.ok)return status(cloudResultError(r),true);if(r.owner_created||!r.can_create_owner)return status('Владелец этой компании уже создан. Нажмите «Назад» и используйте обычный вход.',true);renderCloudOwner(key,r.company||{})}}
function renderCloudOwner(licenseKey,company){authFrame(`<h2>Создание владельца</h2><div class="muted">Компания: <b>${esc(company.name||company.code||'—')}</b>. После сохранения второго владельца создать нельзя.</div><form id="jfOwnerForm"><div class="jf-auth-grid"><div class="jf-auth-field span-2"><label>ФИО владельца</label><input id="jfOwnerName" maxlength="100" required></div><div class="jf-auth-field span-2"><label>Логин</label><input id="jfOwnerLogin" maxlength="40" autocomplete="username" required></div><div class="jf-auth-field"><label>Пароль</label><input id="jfOwnerPassword" type="password" autocomplete="new-password" required></div><div class="jf-auth-field"><label>Повтор пароля</label><input id="jfOwnerPassword2" type="password" autocomplete="new-password" required></div></div><div class="jf-auth-actions">${cloudBackButton()}<button class="jf-auth-button" type="submit">Создать владельца</button></div></form>`,'Первичная активация');q('#jfCloudBack').onclick=renderCloudLicense;q('#jfOwnerForm').onsubmit=async e=>{e.preventDefault();const fullName=q('#jfOwnerName').value.trim(),login=q('#jfOwnerLogin').value.trim(),password=q('#jfOwnerPassword').value,p2=q('#jfOwnerPassword2').value;if(!fullName||login.length<3)return status('Заполните ФИО и логин.',true);if(!passwordValid(password))return status('Пароль: минимум 10 символов, буквы и цифры.',true);if(password!==p2)return status('Пароли не совпадают.',true);status('Создаём владельца на сервере…');const r=await window.JustFunDesktop.auth.registerOwner({licenseKey,fullName,login,password});if(!r?.ok)return status(cloudResultError(r),true);await applyCloudAuth(r.auth)}}
function renderCloudLogin(){authFrame(`<h2>Вход в компанию</h2><div class="muted">Введите код компании, логин и пароль. Код компании указан в профиле владельца.</div><form id="jfLoginForm"><div class="jf-auth-grid"><div class="jf-auth-field span-2"><label for="jfCompanyCode">Код компании</label><input id="jfCompanyCode" autocomplete="organization" placeholder="Например, JFXXXXXX" required></div><div class="jf-auth-field span-2"><label for="jfLogin">Логин</label><input id="jfLogin" autocomplete="username" placeholder="Ваш логин" required></div><div class="jf-auth-field span-2"><label for="jfPassword">Пароль</label><input id="jfPassword" type="password" autocomplete="current-password" placeholder="Ваш пароль" required></div></div><div class="jf-auth-actions">${cloudBackButton()}<button class="jf-auth-button" type="submit">Войти</button></div></form>`,'Безопасный доступ');q('#jfCloudBack').onclick=()=>renderCloudWelcome();q('#jfLoginForm').onsubmit=async e=>{e.preventDefault();status('Проверяем пользователя и компьютер…');const r=await window.JustFunDesktop.auth.login({companyCode:q('#jfCompanyCode').value.trim(),login:q('#jfLogin').value.trim(),password:q('#jfPassword').value});if(!r?.ok)return status(cloudResultError(r),true);await applyCloudAuth(r.auth)}}
function renderCloudInvitation(){authFrame(`<h2>Подключение сотрудника</h2><div class="muted">Введите одноразовый код приглашения, созданный владельцем. Пароль придумывает сам сотрудник.</div><form id="jfInvitationForm"><div class="jf-auth-grid"><div class="jf-auth-field span-2"><label>Код приглашения</label><input id="jfInvitationCode" autocomplete="off" spellcheck="false" placeholder="JFI-XXXX-XXXX-XXXX" required></div><div class="jf-auth-field"><label>Новый пароль</label><input id="jfInvitationPassword" type="password" autocomplete="new-password" required></div><div class="jf-auth-field"><label>Повтор пароля</label><input id="jfInvitationPassword2" type="password" autocomplete="new-password" required></div></div><div class="jf-auth-actions">${cloudBackButton()}<button class="jf-auth-button" type="submit">Подключиться</button></div></form>`,'Одноразовое приглашение');q('#jfCloudBack').onclick=()=>renderCloudWelcome();q('#jfInvitationForm').onsubmit=async e=>{e.preventDefault();const password=q('#jfInvitationPassword').value,p2=q('#jfInvitationPassword2').value;if(!passwordValid(password))return status('Пароль: минимум 10 символов, буквы и цифры.',true);if(password!==p2)return status('Пароли не совпадают.',true);status('Проверяем приглашение…');const r=await window.JustFunDesktop.auth.acceptInvitation({invitationCode:q('#jfInvitationCode').value.trim(),password});if(!r?.ok)return status(cloudResultError(r),true);await applyCloudAuth(r.auth)}}
function createAuthRoot(){let root=q('#jfAuthRoot');if(root)return root;root=document.createElement('div');root.id='jfAuthRoot';document.body.prepend(root);return root}
function status(text,error=false){const el=q('#jfAuthStatus');if(el){el.textContent=text||'';el.className='jf-auth-status'+(error?' error':'')}}
function authFrame(content,subtitle='Безопасный доступ'){createAuthRoot().innerHTML=`<section class="jf-auth-card"><aside class="jf-auth-brand"><div><div class="jf-auth-logo" role="img" aria-label="Официальный логотип JustFun"></div><h1>JustFun</h1><p>Заказы, склады и маршруты в едином рабочем пространстве.</p></div><div class="jf-auth-meta"><b>${esc(subtitle)}</b><br>Лицензия и права проверяются сервером.<br>Telegram: @KAPCTEH<br>VK: k_a_p_c_t_e_n<br>Email: pw-fanat@mail.ru<br>JustFun Логистика · ${VERSION}</div></aside><main class="jf-auth-main">${content}<div class="jf-auth-status" id="jfAuthStatus" aria-live="polite"></div></main></section>`}
function canCreateWarehouseFromNoAccessV783(){return !activeWarehouseId()&&currentUser?.allWarehouses===true&&hasPermission('warehouses.manage')}
function renderNoWarehouse(message='Для вашей учётной записи не назначено ни одного доступного склада. Обратитесь к владельцу или администратору.'){
  const canCreate=canCreateWarehouseFromNoAccessV783(),first=registry().serverAuthoritativeEmpty===true,createLabel=first?'Создать первый склад':'Создать новый склад',quarantined=hasEntityPermissionQuarantine(),title=quarantined?'Локальные изменения защищены':canCreate?(first?'Складов пока нет':'Нет активного склада'):'Склад не назначен';
  authFrame(`<div class="jf-no-access"><h2>${title}</h2><p id="jfNoWarehouseMessage">${esc(canCreate?(first?'Сервер подтвердил пустой реестр компании. Создайте первый склад — локальный склад по умолчанию восстановлен не будет.':'Все склады сейчас находятся в архиве. Создайте новый склад или обратитесь к владельцу.'):message)}</p></div><div class="jf-auth-actions">${canCreate?`<button class="jf-auth-button" id="jfCreateFirstWarehouse">${createLabel}</button>`:''}${quarantined?'<button class="jf-auth-button secondary" id="jfExportQuarantine">Экспортировать локальную копию</button>':''}<button class="jf-auth-button secondary" id="jfRetry">Повторить проверку</button><button class="jf-auth-button${canCreate?' secondary':''}" id="jfLogout">Выйти</button></div>`,'Доступ ограничен');
  if(canCreate)q('#jfCreateFirstWarehouse').onclick=()=>window.openWarehouseCreatorV600?.();if(quarantined)q('#jfExportQuarantine').onclick=async()=>{try{const result=await exportBackup({kind:'permission-quarantine'});if(!result?.confirmed)throw new Error('Windows не подтвердил создание копии.')}catch(error){const message=q('#jfNoWarehouseMessage');if(message)message.textContent=`Копия не создана: ${error?.message||error}`}};q('#jfRetry').onclick=retryWorkspaceAccess;q('#jfLogout').onclick=logout
}
function renderWarehouseLoading(){authFrame('<div class="jf-no-access"><h2>Подготавливаем рабочее пространство</h2><p>Получаем разрешённые склады и выбираем активный склад. Заказы, Telegram и синхронизация ещё не запущены.</p></div>','Безопасный запуск')}
function workspaceReloadKey(){return`jf_workspace_reload_guard_v783:${String(desktopSession?.auth?.company?.id||'unknown')}`}
let pendingActiveWarehouseMetadataChangeV783=null;
function canonicalWarehouseMetadataV783(item){
  const lat=item?.lat==null?null:Number(item.lat),lon=item?.lon==null?null:Number(item.lon);
  return{id:String(item?.id||''),name:String(item?.name||'Склад'),code:String(item?.code||'СКЛ'),address:String(item?.address||''),lat:Number.isFinite(lat)?lat:null,lon:Number.isFinite(lon)?lon:null,timezone:String(item?.timezone||'Europe/Moscow'),status:item?.status==='archived'?'archived':'active',revision:Number(item?.revision)||0,digest:String(item?.digest||'')}
}
function canonicalWarehouseMetadataSignatureV783(item){return JSON.stringify(canonicalWarehouseMetadataV783(item))}
function serverWarehouseEntityPayloadV784(item,{warehouseId='',environment='live'}={}){
  const source=asObject(item),lat=source.lat==null?null:Number(source.lat),lon=source.lon==null?null:Number(source.lon);
  return{id:String(warehouseId||source.id||''),name:String(source.name||'Склад').slice(0,160),code:String(source.code||'СКЛ').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)||'СКЛ',address:String(source.address||'').slice(0,500),lat:Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,lon:Number.isFinite(lon)&&lon>=-180&&lon<=180?lon:null,timezone:String(source.timezone||'Europe/Moscow').slice(0,80),status:source.status==='archived'?'archived':'active',catalogMode:source.catalogMode==='empty'||source.catalog_mode==='empty'?'empty':'catalog',environment:String(environment||'live').toLowerCase()==='demo'?'demo':'live'}
}
function semanticDriverEntityPayloadV784(value){
  const payload=cloneValue(asObject(value)),workerType=payload.workerType==='aggregator'?'aggregator':'driver';payload.workerType=workerType;
  // Provider fields describe an external delivery service and have no business
  // meaning for a staff driver.  Older/local normalizers legitimately replace
  // such stale values with defaults; that must not look like an unauthorized
  // driver edit while an unrelated offline order is waiting in the outbox.
  if(workerType!=='aggregator'){delete payload.providerCode;delete payload.providerName;delete payload.providerAccount;delete payload.providerContact}
  return payload
}
function semanticEntityFingerprintV784(type,id,payload,context={}){
  type=String(type||'');id=String(id||'');if(type==='drivers')return entityFingerprint(semanticDriverEntityPayloadV784(payload));if(type!=='warehouse')return entityFingerprint(payload);const environment=String(context?.environment||payload?.environment||activeEnvironment()||'live').toLowerCase();return entityFingerprint(serverWarehouseEntityPayloadV784(payload,{warehouseId:id||String(context?.warehouseId||''),environment}))
}
function activeWarehouseSettingsMatchV783(item){
  const canonical=canonicalWarehouseMetadataV783(item),point=asObject(settings?.warehouse),profile=asObject(settings?.warehouseProfile),lat=point.lat==null?null:Number(point.lat),lon=point.lon==null?null:Number(point.lon);
  return String(point.address||'')===canonical.address&&(Number.isFinite(lat)?lat:null)===canonical.lat&&(Number.isFinite(lon)?lon:null)===canonical.lon&&String(profile.id||'')===canonical.id&&String(profile.code||'')===canonical.code&&String(profile.name||'')===canonical.name&&String(profile.timezone||'Europe/Moscow')===canonical.timezone
}
function stageActiveWarehouseMetadataChangeV783(before,after){pendingActiveWarehouseMetadataChangeV783={warehouseId:String(after?.id||''),before:canonicalWarehouseMetadataV783(before),after:canonicalWarehouseMetadataV783(after),detectedAt:new Date().toISOString()}}
function suspendWorkspaceForWarehouseMetadataFailureV783(message){
  clearTimeout(cloudSyncState?.uploadTimer);clearInterval(cloudSyncState?.pollTimer);if(cloudSyncState){cloudSyncState.uploadTimer=null;cloudSyncState.pollTimer=null}document.documentElement.classList.remove('jf-authenticated');renderNoWarehouse(message)
}
function applyCanonicalActiveWarehouseMetadataV783(){
  const change=pendingActiveWarehouseMetadataChangeV783,current=activeWarehouseId();if(!change||String(change.warehouseId)!==current)return false;
  const record=registry().warehouses.find(item=>String(item.id)===current);if(!record)return false;
  const previousSettings=cloneValue(settings),previousDirty=cloudSyncState.dirty,previousSerial=cloudSyncState.serial,canonical=canonicalWarehouseMetadataV783(record),point={address:canonical.address,lat:canonical.lat,lon:canonical.lon};
  try{
    settings.warehouse=point;settings.warehouseProfile={...asObject(settings.warehouseProfile),id:canonical.id,code:canonical.code,name:canonical.name,timezone:canonical.timezone,routeStartConfigured:Boolean(point.address.trim())&&Number.isFinite(point.lat)&&point.lat>=-90&&point.lat<=90&&Number.isFinite(point.lon)&&point.lon>=-180&&point.lon<=180};
    if(!safeSaveJson(SETTINGS_KEY,settings))throw new Error('Не удалось сохранить канонические настройки активного склада.');
    cloudSyncState.dirty=previousDirty;cloudSyncState.serial=previousSerial;pendingActiveWarehouseMetadataChangeV783=null;
    window.__jfWarehouseMetadataEpochV783=Number(window.__jfWarehouseMetadataEpochV783||0)+1;
    if(window.__JF_TEST_NO_RELOAD)window.__jfActiveWarehouseMetadataV783={warehouseId:canonical.id,environment:activeEnvironment(),address:point.address,lat:point.lat,lon:point.lon,revision:canonical.revision,digest:canonical.digest};
  }catch(error){
    settings=previousSettings;cloudSyncState.dirty=previousDirty;cloudSyncState.serial=previousSerial;audit('active_warehouse_metadata_refresh_failed',{warehouseId:current,error:String(error?.message||error)});suspendWorkspaceForWarehouseMetadataFailureV783('Сервер изменил адрес или координаты открытого склада, но локальные настройки не удалось безопасно обновить. Рабочее пространство заблокировано; повторите проверку.');return false
  }
  try{window.TeplitsaWarehouseV600?.applyBranding?.()}catch(error){console.error('Не удалось обновить подписи активного склада',error)}audit('active_warehouse_metadata_refreshed',{warehouseId:canonical.id,environment:activeEnvironment(),revision:canonical.revision,digest:canonical.digest});return true
}
function guardedWorkspaceReload(reason,targetWarehouseId=''){
  try{assertEntityContextChangeAllowed({kind:'workspace-reload',reason:String(reason||''),targetWarehouseId:String(targetWarehouseId||'')})}catch(error){audit('workspace_reload_blocked_critical_operation',{reason,targetWarehouseId,code:error?.code||''});return false}
  const key=workspaceReloadKey(),now=Date.now();let previous={};try{previous=JSON.parse(sessionStorage.getItem(key)||'{}')}catch{}
  const same=String(previous.targetWarehouseId||'')===String(targetWarehouseId||'')&&String(previous.reason||'')===String(reason||'');
  if(same&&now-Number(previous.at||0)<60000){audit('workspace_reload_loop_blocked',{reason,targetWarehouseId,previousAt:previous.at});return false}
  try{sessionStorage.setItem(key,JSON.stringify({reason:String(reason||''),targetWarehouseId:String(targetWarehouseId||''),at:now}))}catch{}
  setSession(currentUser);setTimeout(()=>location.reload(),350);return true
}
function pendingWarehouseDeleteId(){return String(registry().pendingServerDeleteWarehouseId||'')}
function markPendingWarehouseDelete(warehouseId){const B=window.TeplitsaWarehouseBootstrap;if(!B)return;const next=B.getRegistry();next.pendingServerDeleteWarehouseId=String(warehouseId||'');B.saveRegistry(next)}
function freezeWorkspaceForWarehouseTransition(){clearTimeout(cloudSyncState?.uploadTimer);clearTimeout(cloudSyncState?.retryTimer);clearInterval(cloudSyncState?.pollTimer);if(cloudSyncState){cloudSyncState.uploadTimer=null;cloudSyncState.retryTimer=null;cloudSyncState.pollTimer=null;cloudSyncState.dirty=false}document.documentElement.classList.remove('jf-authenticated')}
function blockWorkspaceAfterWarehouseChange(message){freezeWorkspaceForWarehouseTransition();renderNoWarehouse(message)}
function blockWorkspaceForEntityPermissionQuarantine(message){stopLiveAccessRefresh();stopTelegramPolling();freezeWorkspaceForWarehouseTransition();if(cloudSyncState){cloudSyncState.dirty=true;try{persistEntityDirty(true)}catch{}}renderNoWarehouse(message)}
function applyWarehouseRegistryTransition(previousWarehouseId,reason){
  const current=activeWarehouseId(),allowed=allowedWarehouseIds(),pending=pendingWarehouseDeleteId();
  if(current===previousWarehouseId&&allowed.includes(previousWarehouseId)&&!pending&&pendingActiveWarehouseMetadataChangeV783?.warehouseId===current){applyCanonicalActiveWarehouseMetadataV783();return false}
  if(current===previousWarehouseId&&allowed.includes(previousWarehouseId)&&!pending)return false;
  if(current&&current!==previousWarehouseId&&allowed.includes(current)&&!pending){freezeWorkspaceForWarehouseTransition();renderWarehouseLoading();if(window.__JF_TEST_NO_RELOAD){window.__jfRemoteWarehouseReplacementV783=current;return true}if(guardedWorkspaceReload(reason,current))return true;blockWorkspaceAfterWarehouseChange('Список складов изменился, но безопасная автоматическая перезагрузка была остановлена. Нажмите «Повторить проверку».');return true}
  blockWorkspaceAfterWarehouseChange(pending?'Открытый склад удалён на другом компьютере. Локальный кэш заблокирован до подтверждения нового списка складов.':'Доступ к открытому складу отозван. Локальный кэш заблокирован и не будет отправлен на сервер.');return true
}
function clearWorkspaceReloadGuard(){try{sessionStorage.removeItem(workspaceReloadKey())}catch{}}
async function retryWorkspaceAccess(){
  const button=q('#jfRetry'),message=q('#jfNoWarehouseMessage');if(button)button.disabled=true;if(message)message.textContent='Проверяем назначения складов на сервере…';
  try{const beforeAccessRefresh=activeWarehouseId();if(desktopSession?.auth?.user&&typeof window.JustFunDesktop?.auth?.refreshContext==='function'){liveAccessRefreshStopped=false;const accessReady=await refreshLiveAccess('manual-retry');if(!accessReady||cloudSyncState?.contextBlockedError?.code==='ENTITY_LIVE_ACCESS_TERMINATED'){if(message&&cloudSyncState?.contextBlockedError?.code!=='ENTITY_LIVE_ACCESS_TERMINATED')message.textContent='Сервер не подтвердил активную сессию. Рабочее пространство не открыто.';return false}if(activeWarehouseId()!==beforeAccessRefresh)return false}if(await restoreActiveWarehouseBeforeRecoveryV784())return false;if(!await confirmProvisionalWarehouseBeforeRecoveryV784())return false;await recoverCriticalEntityMutation();const before=activeWarehouseId();await synchronizeCompanyWarehouseRegistry();const allowed=allowedWarehouseIds();if(pendingWarehouseDeleteId()){if(message)message.textContent='Сервер ещё не подтвердил новый список после удаления склада.';return false}if(!allowed.length){if(message)message.textContent='Сервер подтвердил: вашей учётной записи пока не назначен склад.';return false}const target=allowed.includes(activeWarehouseId())?activeWarehouseId():allowed[0];if(target!==activeWarehouseId())window.TeplitsaWarehouseBootstrap.setActive(target);if(applyWarehouseRegistryTransition(before,'warehouse-assignment-retry'))return true;await confirmActiveWarehouseContext();if(hasEntityPermissionQuarantine())await bootstrapEntitySync(true);mountWorkspace();return true}catch(error){if(message)message.textContent=`Проверка не выполнена: ${cloudResultError({error:error?.message||String(error)})}`;return false}finally{if(button)button.disabled=false}
}
function addDesktopStrip(){let strip=q('#jfDesktopStrip');if(!strip){strip=document.createElement('div');strip.id='jfDesktopStrip';strip.className='jf-desktop-strip';document.body.prepend(strip)}const role=ROLE_LABELS[roleFor()]||'Пользователь',wh=window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.name||'Склад',demo=isTrainingEnvironment(),offline=!!desktopSession?.auth?.offline;strip.innerHTML=`<div class="jf-license-banner">${demo?'<span class="jf-edition demo">УЧЕБНЫЙ РЕЖИМ</span>':''}${offline?'<span class="jf-license-time">Автономный доступ</span>':''}${desktopSession?.edition==='demo'?`<span class="jf-license-time" id="jfDemoTime"></span>`:''}${demo?'':'<span class="jf-outbox-state ready" id="jfOutboxState">Локальные данные сохранены</span>'}</div><div class="jf-userbar"><span>${esc(currentUser.fullName)} · ${esc(role)} · ${esc(wh)}</span><button id="jfProfileBtn">Профиль</button><button id="jfLogoutBtn">Выйти</button></div>`;q('#jfProfileBtn').onclick=openProfile;q('#jfLogoutBtn').onclick=logout;updateDemoTime(desktopSession?.demoRemainingMs);renderLocalOutboxStatus()}
function updateDemoTime(ms){const el=q('#jfDemoTime');if(!el||ms==null)return;const s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);el.textContent=`Осталось ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function applyBrand(){document.body.classList.add('jf-default-brand');if(typeof window.TeplitsaWarehouseV600?.applyBranding==='function')window.TeplitsaWarehouseV600.applyBranding();else{document.title=`JustFun Логистика · ${VERSION}`;const title=q('.brand-title');if(title)title.textContent='JustFun Логистика';const sub=q('.brand-sub');if(sub)sub.textContent='Заказы · склады · маршруты'}const logo=q('.company-brand .logo');if(logo)logo.setAttribute('aria-label','Логотип программы')}
function trainingAdminActionForControl(control){
  if(!isTrainingEnvironment()||!control)return'';
  if(DEMO_CLOUD_CONTROL_IDS.has(String(control.id||'')))return String(control.id);
  const inline=String(control.getAttribute?.('data-jf-onclick')||control.closest?.('form')?.getAttribute?.('data-jf-onsubmit')||'');
  for(const name of DEMO_CLOUD_ADMIN_FUNCTIONS)if(new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\s*\\(`).test(inline))return name;
  return''
}
function rejectTrainingAdmin(action){const message='В учебном режиме реальные склады, сотрудники, VPS и Telegram не изменяются. Переключитесь в рабочий режим.';toast(message,'error');audit('training_cloud_admin_blocked',{action});return false}
function permissionForControl(control){
  if(!control)return'';
  if(CONTROL_PERMISSIONS[control.id])return CONTROL_PERMISSIONS[control.id];
  const form=control.closest?.('form'),submitPermission=formPermission(form);
  if(submitPermission&&String(control.type||'').toLowerCase()==='submit')return submitPermission;
  const inline=String(control.getAttribute?.('data-jf-onclick')||'');
  for(const[name,permission]of Object.entries(FUNCTION_PERMISSIONS))if(new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\s*\\(`).test(inline))return functionPermissionRequirements(name,permission);
  return'';
}
function rejectPermission(permission,action){const missing=missingPermissions(permission),primary=missing[0]||permissionRequirements(permission)[0]||'';toast('Недостаточно прав для этого действия.','error');audit('forbidden_action',{action,permission:primary,permissions:missing,role:roleFor()})}
function applyActionPermissions(root=document){
  qa('button,input[type="submit"],input[type="button"]',root).forEach(control=>{
    const permission=permissionForControl(control),trainingAction=trainingAdminActionForControl(control);if(!permission&&!trainingAction)return;
    const denied=Boolean(trainingAction)||(permission&&!hasPermissions(permission));
    control.classList.toggle('jf-role-hidden',!!denied);
    if(denied){control.setAttribute('aria-hidden','true');control.tabIndex=-1}else{control.removeAttribute('aria-hidden');if(control.tabIndex===-1)control.removeAttribute('tabindex')}
  })
}
function installPermissionEvents(){
  if(permissionEventsInstalled)return;permissionEventsInstalled=true;
  document.addEventListener('click',event=>{const control=event.target?.closest?.('button,input[type="submit"],input[type="button"]'),trainingAction=trainingAdminActionForControl(control),permission=permissionForControl(control);if(trainingAction){event.preventDefault();event.stopImmediatePropagation();rejectTrainingAdmin(trainingAction);return}if(permission&&!hasPermissions(permission)){event.preventDefault();event.stopImmediatePropagation();rejectPermission(permission,control?.id||control?.textContent?.trim()||'button')}},true);
  document.addEventListener('submit',event=>{const trainingAction=trainingAdminActionForControl(event.target?.querySelector?.('[type="submit"]')||event.target),permission=formPermission(event.target);if(trainingAction){event.preventDefault();event.stopImmediatePropagation();rejectTrainingAdmin(trainingAction);return}if(permission&&!hasPermission(permission)){event.preventDefault();event.stopImmediatePropagation();rejectPermission(permission,event.target?.id||'form')}},true);
  if(!permissionObserverInstalled&&document.body){permissionObserverInstalled=true;new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))queueMicrotask(()=>applyActionPermissions())}).observe(document.body,{childList:true,subtree:true})}
}
function applyPermissions(){const tabs=new Set(allowedTabs());for(const [view,elementId] of Object.entries(TAB_ID)){q('#'+elementId)?.classList.toggle('jf-role-hidden',!tabs.has(view))}const canWrite=permissionList().some(permission=>permission==='*'||(!permission.endsWith('.read')&&!permission.startsWith('jf.warehouse')));document.body.classList.toggle('jf-readonly',!canWrite);const first=[...tabs][0]||'orders';const active=q('.tabs .tab.active');if(active&&active.classList.contains('jf-role-hidden'))window.showView?.(first);applyActionPermissions();installPermissionEvents()}
function installGuards(){
  if(guardInstalled)return;
  guardInstalled=true;
  const overrides=window.JustFunOverrides;
  if(!overrides)throw new Error('JustFunOverrides is not loaded');
  if(typeof window.showView==='function')overrides.wrap('showView','desktop-permissions-v750',originalShow=>function(view){
    if(!allowedTabs().includes(view)){toast('Этот раздел недоступен для вашей роли.','error');audit('forbidden_view',{view});return originalShow(allowedTabs()[0]||'orders')}
    return originalShow.apply(this,arguments)
  });
  if(typeof window.switchWarehouseV600==='function')overrides.wrap('switchWarehouseV600','desktop-permissions-v750',originalSwitch=>function(target){
    if(!allowedWarehouseIds().includes(String(target))){toast('Этот склад не назначен вашей учётной записи.','error');audit('forbidden_warehouse',{target});return}
    return originalSwitch.apply(this,arguments)
  });
  for(const[name,permission]of Object.entries(FUNCTION_PERMISSIONS)){
    if(typeof window[name]!=='function')continue;
    overrides.wrap(name,'desktop-permissions-v750',base=>function(){
      if(isTrainingEnvironment()&&DEMO_CLOUD_ADMIN_FUNCTIONS.has(name))return rejectTrainingAdmin(name);
      const required=functionPermissionRequirements(name,permission,arguments);
      if(!hasPermissions(required)){rejectPermission(required,name);return}
      return base.apply(this,arguments)
    })
  }
}
const RECOVERY_OWNERSHIP_LOGOUT_CODES=new Set(['ENTITY_LOCAL_RECOVERY_USER_UNKNOWN','ENTITY_DIRTY_OWNER_READ_FAILED','ENTITY_DIRTY_OWNER_CORRUPT','ENTITY_OUTBOX_OWNER_CORRUPT','ENTITY_OUTBOX_MULTIPLE_OWNERS','ENTITY_OUTBOX_OWNER_MISMATCH','ENTITY_LOCAL_RECOVERY_OWNER_CONFLICT','ENTITY_LOCAL_RECOVERY_OWNER_UNKNOWN','ENTITY_LOCAL_RECOVERY_USER_MISMATCH','ENTITY_RECOVERY_JOURNAL_OWNER_CORRUPT','ENTITY_RECOVERY_JOURNAL_OWNER_MISMATCH','ENTITY_RECOVERY_JOURNAL_OWNER_UNKNOWN']);
function recoveryOwnershipLogoutAllowed(){const error=cloudSyncState?.contextBlockedError,details=asObject(error?.details),currentUserId=currentEntityUserId();return RECOVERY_OWNERSHIP_LOGOUT_CODES.has(String(error?.code||''))&&String(details.currentUserId||'')===currentUserId&&Boolean(String(details.source||''))}
async function logout(){
  const recoveryOwnershipExit=recoveryOwnershipLogoutAllowed();
  if(!recoveryOwnershipExit){try{assertEntityContextChangeAllowed({kind:'logout'});if(desktopSession?.edition!=='demo'){resetEntityScope();const queue=requireLocalOutbox(),before=queue.status();if(cloudSyncState.dirty||durableEntityDirty(cloudSyncState.scope)||before.active){await flushEntitySyncBeforeContextChange();resetEntityScope();const after=requireLocalOutbox().status();if(cloudSyncState.dirty||durableEntityDirty(cloudSyncState.scope)||after.active)throw outboxError('LOGOUT_LOCAL_CHANGES_UNCONFIRMED','Выход остановлен: VPS ещё не подтвердил все локальные изменения. Данные сохранены на этом компьютере.')}}}catch(error){toast(error?.message||String(error),'error');audit('logout_blocked_unsynced_data',{code:error?.code||''});return false}}
  audit(recoveryOwnershipExit?'logout_from_recovery_ownership_block':'logout');stopLiveAccessRefresh();stopTelegramPolling();clearSession();if(desktopSession?.edition==='demo'){await window.JustFunDesktop?.quit?.();return true}await window.JustFunDesktop?.auth?.logout?.();currentUser=null;users=[];desktopSession.auth=null;await window.JustFunDesktop?.restart?.();return true
}
function normalizedServerWarehouse(item){
  const id=String(item?.id||''),code=String(item?.code||'СКЛ').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)||'СКЛ';
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))return null;
  const lat=item?.lat==null?null:Number(item.lat),lon=item?.lon==null?null:Number(item.lon);
  return{id,name:String(item?.name||'Склад').slice(0,160),code,address:String(item?.address||'').slice(0,500),lat:Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,lon:Number.isFinite(lon)&&lon>=-180&&lon<=180?lon:null,timezone:String(item?.timezone||'Europe/Moscow').slice(0,80),status:item?.status==='archived'?'archived':'active',catalogMode:item?.catalog_mode==='empty'||item?.catalogMode==='empty'?'empty':'catalog',origin:'server',revision:Number(item?.entity_version??item?.revision)||0,digest:String(item?.digest_sha256||''),updatedAt:String(item?.updated_at||new Date().toISOString())};
}
function confirmedPreferredWarehouseIdV784(response,warehouses){
  const id=String(response?.preferredWarehouseId||''),list=Array.isArray(warehouses)?warehouses:[];return /^[A-Za-z0-9_-]{1,120}$/.test(id)&&list.some(item=>String(item?.id||'')===id&&item?.status!=='archived')?id:''
}
const LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783=3;
function localToServerMigrationKeyV783(B){return String(B.registryKey||'').replace(/warehouses_registry_v600$/,'local_to_server_migration_v783')}
function readLocalToServerMigrationV783(B){try{const value=JSON.parse(B.raw.get(localToServerMigrationKeyV783(B))||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}}
function writeLocalToServerMigrationV783(B,value){B.raw.set(localToServerMigrationKeyV783(B),JSON.stringify(value));return value}
function localMigrationCommandIdV783(label,warehouseId,index=0){return`client:migrate-v783:${String(label)}:${String(warehouseId)}:${Number(index)}`.slice(0,180)}
function localMigrationSnapshotSignatureV783(snapshot){return entityFingerprint({warehouse:snapshot?.warehouse,data:snapshot?.data})}
function localMigrationOutboxV783(companyId,warehouseId){const scope=`${companyId}:live:${warehouseId}`,queue=window.JustFunLocalOutboxV783?.create?.(localStorage,scope);if(!queue||queue.isCorrupt())throw Object.assign(new Error(`Локальная очередь склада ${warehouseId} повреждена. Перенос на VPS остановлен.`),{code:'LOCAL_MIGRATION_OUTBOX_UNAVAILABLE'});return queue}
function localMigrationEffectiveSnapshotV783(companyId,warehouseId,storedSnapshot,journalEntry=null){
  const queue=localMigrationOutboxV783(companyId,warehouseId),all=queue.list(),blocked=all.find(item=>(item.state==='conflict'||item.state==='rejected')&&item.preserveLocal!==false);
  if(blocked)throw Object.assign(new Error(`Локальная команда ${blocked.commandId} требует решения. Перенос на VPS остановлен без подтверждения очереди.`),{code:'LOCAL_MIGRATION_OUTBOX_BLOCKED'});
  const active=all.filter(item=>(item.state==='pending'||item.state==='sending')&&item.preserveLocal!==false),expected=Array.isArray(journalEntry?.outboxCommandIds)?journalEntry.outboxCommandIds.map(String):active.map(item=>String(item.commandId)),expectedSet=new Set(expected);
  if(journalEntry&&active.some(item=>!expectedSet.has(String(item.commandId))))throw Object.assign(new Error('Локальная очередь изменилась после начала переноса. Автоматическое продолжение остановлено без потери новых команд.'),{code:'LOCAL_MIGRATION_SOURCE_CHANGED'});
  const byId=new Map(all.map(item=>[String(item.commandId),item])),included=expected.map(commandId=>byId.get(commandId));
  if(included.some(item=>!item))throw Object.assign(new Error('Команда, включённая в план переноса, отсутствует в локальной очереди. Автоматическое подтверждение запрещено.'),{code:'LOCAL_MIGRATION_OUTBOX_CHANGED'});
  const snapshot=cloneValue(storedSnapshot);for(const entry of included)for(const change of entry.changes)applyEntityToSnapshot(snapshot,change,change.deleted===true);
  const currentDirtyGeneration=entityDirtyGeneration(queue.scope),savedDirtyGeneration=Number(journalEntry?.dirtyGenerationAtStart),dirtyGenerationAtStart=Number.isSafeInteger(savedDirtyGeneration)&&savedDirtyGeneration>=0?savedDirtyGeneration:currentDirtyGeneration;
  return{snapshot,queue,commandIds:expected,dirtyGenerationAtStart}
}
function canImportLocalMigrationV783(user=currentUser){const permissions=exactPermissionList(user?.permissions);return user?.role==='owner'&&user?.allWarehouses===true&&(permissions.includes('*')||permissions.includes('jf.warehouse:*'))&&(permissions.includes('*')||permissions.includes('warehouses.manage')||permissions.includes('warehouses.*'))}
function generatedLocalWarehousePlaceholderV783(local){
  if(local.warehouses.length!==1||String(local.warehouses[0]?.origin||'')!=='local-default')return false;const counts=window.TeplitsaWarehouseV600?.counts?.()||{},B=window.TeplitsaWarehouseBootstrap,warehouseId=String(local.warehouses[0]?.id||'');let userProducts=Number(counts.products||0);
  try{const products=JSON.parse(B.raw.get(B.dataKey('orders_osm_leaflet_products_v1','live',warehouseId))||'[]');if(Array.isArray(products))userProducts=products.filter(item=>!(item?.catalogManaged===true&&String(item?.id||'').startsWith('catalog-'))).length}catch{}
  const businessCount=Number(counts.orders||0)+userProducts+Number(counts.drivers||0)+Number(counts.movements||0)+Number(counts.routes||0)+Number(counts.executions||0)+Number(counts.archives||0);return businessCount===0
}
function provisionalNativeWarehouseIdV784(value=registry()){
  const id=String(value?.nativeRecoveryProvisionalWarehouseId||''),companyId=String(desktopSession?.auth?.company?.id||''),warehouses=Array.isArray(value?.warehouses)?value.warehouses:[],record=warehouses.find(item=>String(item?.id||'')===id);
  return /^[A-Za-z0-9_-]{1,120}$/.test(id)&&warehouses.length===1&&String(value?.activeWarehouseId||'')===id&&String(value?.serverWorkspaceId||'')===companyId&&value?.serverRegistryInitialized===false&&String(record?.origin||'')==='native-preference-provisional'?id:''
}
function lostWarehouseRegistryPlaceholderV784(value=registry()){
  const warehouses=Array.isArray(value?.warehouses)?value.warehouses:[],record=warehouses[0],id=String(record?.id||'');
  return warehouses.length===1&&/^[A-Za-z0-9_-]{1,120}$/.test(id)&&String(value?.activeWarehouseId||'')===id&&record?.status!=='archived'&&String(record?.origin||'')==='local-default'&&!String(value?.serverWorkspaceId||'')&&value?.serverRegistryInitialized!==true&&value?.serverAuthoritativeEmpty!==true&&!String(value?.pendingServerDeleteWarehouseId||'')?record:null
}
function cachedAuthAllowsWarehouseRecoveryV784(warehouseId){
  const user=desktopSession?.auth?.user,company=desktopSession?.auth?.company,permissions=exactPermissionList(user?.permissions),id=String(warehouseId||'');
  if(String(user?.status||'active')!=='active'||String(company?.status||'active')!=='active')return false;
  return String(user?.role||'')==='owner'||permissions.includes('*')||permissions.includes('jf.warehouse:*')||permissions.includes(`jf.warehouse:${id}`)
}
function recoveryWarehouseFromScopedSettingsV784(B,warehouseId){
  let saved=null;try{saved=JSON.parse(B.raw.get(B.dataKey('orders_osm_leaflet_settings_v1','live',warehouseId))||'null')}catch{return null}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return null;const profile=saved.warehouseProfile,point=saved.warehouse;
  if(!profile||typeof profile!=='object'||String(profile.id||'')!==warehouseId)return null;
  const code=String(profile.code||'СКЛ').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)||'СКЛ',lat=point?.lat==null?null:Number(point.lat),lon=point?.lon==null?null:Number(point.lon),now=new Date().toISOString();
  return{id:warehouseId,name:String(profile.name||'Восстановленный склад').trim().slice(0,160)||'Восстановленный склад',code,address:String(point?.address||'').slice(0,500),lat:Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,lon:Number.isFinite(lon)&&lon>=-180&&lon<=180?lon:null,timezone:String(profile.timezone||'Europe/Moscow').slice(0,80),status:'active',catalogMode:'empty',origin:'native-preference-provisional',nativeRecoveryPlaceholder:true,createdAt:now,updatedAt:now}
}
async function migrateLocalCompanyToEmptyServerV783(B,local,response,remote){
  const companyId=String(desktopSession?.auth?.company?.id||''),existing=readLocalToServerMigrationV783(B),provisional=Boolean(provisionalNativeWarehouseIdV784(local)),canStart=!provisional&&response.registryInitialized===false&&!remote.length&&local.warehouses.length>0&&local.warehouses.some(item=>String(item.origin||'')!=='server'),canResume=!provisional&&existing?.schemaVersion===LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783&&existing?.workspaceId===companyId&&existing?.state!=='complete';
  if(existing?.state==='complete'&&canStart)throw Object.assign(new Error('VPS потерял ранее перенесённый реестр складов. Автоматическое повторное заполнение запрещено; требуется проверка backup и журнала сервера.'),{code:'LOCAL_MIGRATION_REMOTE_RESET'});
  if(existing&&canStart&&(existing.schemaVersion!==LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783||existing.workspaceId!==companyId))throw Object.assign(new Error('Найден незавершённый журнал переноса другой версии или компании. Автоматическое продолжение запрещено до проверки журнала и резервной копии.'),{code:'LOCAL_MIGRATION_JOURNAL_INCOMPATIBLE'});
  if(!canStart&&!canResume)return false;
  if(canStart&&!canResume&&generatedLocalWarehousePlaceholderV783(local)&&(!currentUser?.allWarehouses||!hasPermission('warehouses.manage')))return false;
  if(!canImportLocalMigrationV783())throw Object.assign(new Error('Перенос локальной компании на VPS может выполнить только владелец с доступом ко всем складам.'),{code:'LOCAL_MIGRATION_PERMISSION_DENIED'});
  const sourceWarehouses=local.warehouses.map(item=>cloneValue(item)),sourceIds=new Set(sourceWarehouses.map(item=>String(item.id))),foreignRemote=remote.find(item=>!sourceIds.has(String(item.id)));if(foreignRemote)throw Object.assign(new Error('VPS уже содержит другой склад. Автоматическое объединение с локальной базой запрещено.'),{code:'LOCAL_MIGRATION_REMOTE_NOT_EMPTY'});
  const snapshots=new Map(),migrationQueues=new Map(),signatures={};for(const warehouse of sourceWarehouses){const storedSnapshot=await window.TeplitsaWarehouseV600?.storedSnapshot?.(warehouse.id,'live');if(!storedSnapshot)throw Object.assign(new Error(`Локальный снимок склада ${warehouse.code||warehouse.id} не подготовлен.`),{code:'LOCAL_MIGRATION_SNAPSHOT_UNAVAILABLE'});const previous=existing?.warehouses?.find(item=>String(item.id)===String(warehouse.id))||null,effective=localMigrationEffectiveSnapshotV783(companyId,warehouse.id,storedSnapshot,previous);snapshots.set(String(warehouse.id),effective.snapshot);migrationQueues.set(String(warehouse.id),effective);signatures[warehouse.id]=localMigrationSnapshotSignatureV783(effective.snapshot)}
  let journal=existing;
  if(!journal){journal={schemaVersion:LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783,workspaceId:companyId,state:'prepared',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),originalActiveWarehouseId:String(local.activeWarehouseId||''),sourceSignatures:signatures,warehouses:sourceWarehouses.map(item=>({id:String(item.id),code:String(item.code||''),state:'prepared',createCommandId:localMigrationCommandIdV783('warehouse',item.id),chunkCommandIds:[],outboxCommandIds:migrationQueues.get(String(item.id))?.commandIds||[],dirtyGenerationAtStart:migrationQueues.get(String(item.id))?.dirtyGenerationAtStart||0}))};writeLocalToServerMigrationV783(B,journal)}
  if(JSON.stringify(journal.sourceSignatures)!==JSON.stringify(signatures))throw Object.assign(new Error('Локальная база изменилась после начала переноса. Автоматическое продолжение остановлено без перезаписи данных.'),{code:'LOCAL_MIGRATION_SOURCE_CHANGED'});
  const bridge=window.JustFunDesktop;if(typeof bridge?.setActiveWarehouse!=='function'||typeof bridge?.regVps?.writeWarehouse!=='function'||typeof bridge?.regVps?.syncEntities!=='function')throw Object.assign(new Error('Защищённый модуль переноса на VPS недоступен.'),{code:'LOCAL_MIGRATION_BRIDGE_UNAVAILABLE'});
  journal={...journal,state:'in_progress',updatedAt:new Date().toISOString(),lastError:null};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_started',{warehouses:sourceWarehouses.length,workspaceId:companyId});
  try{
    for(const source of sourceWarehouses){const id=String(source.id),entry=journal.warehouses.find(item=>item.id===id),snapshot=snapshots.get(id),snapshotFingerprint=String(signatures[id]||''),warehousePayload=serverWarehouseEntityPayloadV784(source,{warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});
      const warehouseChanges=[{type:'warehouse',id,baseVersion:0,deleted:false,payload:warehousePayload}],created=await bridge.regVps.writeWarehouse({warehouseId:id,warehouseCode:String(source.code||''),environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:entry.createCommandId,changes:warehouseChanges});if(!created?.ok)throw Object.assign(new Error(created?.error||`VPS не создал склад ${source.code||id}.`),{code:created?.code||'LOCAL_MIGRATION_WAREHOUSE_FAILED'});validateEntityBatchAck(created,warehouseChanges,entry.createCommandId);
      B.setActive(id);const context=await bridge.setActiveWarehouse({warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});if(!context?.ok)throw Object.assign(new Error(context?.error||'Основное ядро не подтвердило склад для переноса.'),{code:context?.code||'LOCAL_MIGRATION_CONTEXT_REJECTED'});
      const changes=[...splitEntitySnapshot(snapshot).values()].filter(item=>item.type!=='warehouse').map(item=>({type:item.type,id:item.id,baseVersion:0,deleted:false,payload:item.payload})),chunks=[];for(let offset=0;offset<changes.length;offset+=1000)chunks.push(changes.slice(offset,offset+1000));
      if(!entry.chunkCommandIds.length){entry.chunkCommandIds=chunks.map((_,index)=>localMigrationCommandIdV783('entities',id,index));writeLocalToServerMigrationV783(B,{...journal,updatedAt:new Date().toISOString()})}if(entry.chunkCommandIds.length!==chunks.length)throw Object.assign(new Error('План пакетов переноса не совпадает с локальным снимком.'),{code:'LOCAL_MIGRATION_PLAN_CHANGED'});
      for(let index=0;index<chunks.length;index++){const commandId=entry.chunkCommandIds[index],result=await bridge.regVps.syncEntities({warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId,changes:chunks[index],intent:{kind:'local_migration_import',targetId:id,snapshotFingerprint,chunkIndex:index,chunkCount:chunks.length}});if(!result?.ok)throw Object.assign(new Error(result?.error||`VPS не принял пакет ${index+1} склада ${source.code||id}.`),{code:result?.code||'LOCAL_MIGRATION_ENTITY_FAILED',details:result?.details||{}});validateEntityBatchAck(result,chunks[index],commandId)}
      entry.state='uploaded';entry.updatedAt=new Date().toISOString();writeLocalToServerMigrationV783(B,{...journal,updatedAt:new Date().toISOString()})
    }
    const migratedOutboxScopes=new Set();
    for(const source of sourceWarehouses){const prepared=migrationQueues.get(String(source.id));if(prepared?.queue?.scope)migratedOutboxScopes.add(String(prepared.queue.scope));for(const commandId of prepared?.commandIds||[]){const item=prepared.queue.get(commandId);if(item&&item.state!=='confirmed')prepared.queue.markConfirmed(commandId,{migration:'local-to-server-v783',workspaceId:companyId,warehouseId:String(source.id),includedInSnapshot:true})}}
    for(const migratedScope of migratedOutboxScopes)cloudSyncState.outboxes.delete(migratedScope);
    if(migratedOutboxScopes.has(cloudSyncState.scope)){cloudSyncState.scope='';cloudSyncState.outbox=null;cloudSyncState.outboxError=null;cloudSyncState.scopeEpoch++}
    const original=sourceIds.has(String(journal.originalActiveWarehouseId))?String(journal.originalActiveWarehouseId):String(sourceWarehouses.find(item=>item.status!=='archived')?.id||'');if(original){B.setActive(original);const restored=await bridge.setActiveWarehouse({warehouseId:original,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});if(!restored?.ok)throw Object.assign(new Error(restored?.error||'Не удалось восстановить исходный склад после переноса.'),{code:restored?.code||'LOCAL_MIGRATION_CONTEXT_RESTORE_FAILED'});resetEntityScope()}
    journal={...journal,state:'complete',cleanupState:'pending',completedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastError:null};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_completed',{warehouses:sourceWarehouses.length,workspaceId:companyId});return true
  }catch(error){const original=sourceIds.has(String(journal.originalActiveWarehouseId))?String(journal.originalActiveWarehouseId):'';if(original){try{B.setActive(original);await bridge.setActiveWarehouse({warehouseId:original,environment:WAREHOUSE_REGISTRY_ENVIRONMENT})}catch{}}journal={...journal,state:'failed',updatedAt:new Date().toISOString(),lastError:{code:String(error?.code||'LOCAL_MIGRATION_FAILED'),message:String(error?.message||error).slice(0,500)}};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_failed',{code:journal.lastError.code,workspaceId:companyId});throw error}
}
function finalizeLocalToServerMigrationStorageV783(B,journal=readLocalToServerMigrationV783(B)){
  if(journal?.schemaVersion!==LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783||journal?.state!=='complete'||journal?.cleanupState!=='pending')return false;
  if(document.documentElement.classList.contains('jf-authenticated'))throw Object.assign(new Error('Очистка журнала переноса остановлена: рабочее пространство уже открыто.'),{code:'LOCAL_MIGRATION_CLEANUP_CONTEXT_UNSAFE'});
  const companyId=String(desktopSession?.auth?.company?.id||'');if(String(journal.workspaceId||'')!==companyId)throw Object.assign(new Error('Журнал завершения переноса принадлежит другой компании.'),{code:'LOCAL_MIGRATION_CLEANUP_SCOPE_MISMATCH'});
  const queues=[];for(const entry of journal.warehouses||[]){const warehouseId=String(entry?.id||''),queue=localMigrationOutboxV783(companyId,warehouseId),planned=asArray(entry?.outboxCommandIds).map(String);if(planned.some(commandId=>{const item=queue.get(commandId);return!item||item.state!=='confirmed'||item.preserveLocal!==false}))throw Object.assign(new Error(`Очередь склада ${warehouseId} не подтверждает завершённый перенос.`),{code:'LOCAL_MIGRATION_CLEANUP_OUTBOX_CHANGED'});if(queue.status().active>0)throw Object.assign(new Error(`После переноса склада ${warehouseId} появились новые локальные изменения. Автоматическая очистка остановлена.`),{code:'LOCAL_MIGRATION_CLEANUP_DIRTY'});queues.push(queue)}
  const scopes=new Set(queues.map(queue=>String(queue.scope)));for(const scope of scopes)cloudSyncState.outboxes.delete(scope);if(scopes.has(cloudSyncState.scope)){cloudSyncState.scope='';cloudSyncState.outbox=null;cloudSyncState.outboxError=null;cloudSyncState.scopeEpoch++}clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=null;
  for(const queue of queues){assertEntityRecoveryOwnership({scope:queue.scope,queue,block:false});persistEntityDirty(false,queue.scope)}resetEntityScope();cloudSyncState.dirty=false;rememberLocalEntityBaseline();rememberObservedEntitySnapshot();writeLocalToServerMigrationV783(B,{...journal,cleanupState:'complete',cleanupCompletedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});return true
}
async function synchronizeCompanyWarehouseRegistry(){
  const B=window.TeplitsaWarehouseBootstrap;
  if(!B||isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return false;
  if(!provisionalNativeWarehouseIdV784(B.getRegistry()))await recoverPendingWarehouseWritesV784();
  const response=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});
  if(!response?.ok||response.configured!==true){
    audit('company_warehouse_registry_unavailable',{code:response?.code||'',error:response?.error||'',configured:response?.configured===true});
    throw Object.assign(new Error(response?.error||'Серверный реестр складов недоступен.'),{code:response?.code||'WAREHOUSE_REGISTRY_UNAVAILABLE'})
  }
  let remote=(response.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean),preferredWarehouseId=confirmedPreferredWarehouseIdV784(response,remote);
  const local=B.getRegistry(),companyId=String(desktopSession.auth.company.id||'');
  const pendingMigration=readLocalToServerMigrationV783(B),matchingMigration=pendingMigration?.schemaVersion===LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783&&pendingMigration?.workspaceId===companyId;
  if(remote.length&&matchingMigration&&pendingMigration.state==='complete'){const remoteIds=new Set(remote.map(item=>String(item.id))),missing=(pendingMigration.warehouses||[]).find(item=>!remoteIds.has(String(item.id)));if(missing)throw Object.assign(new Error('VPS не содержит один из ранее перенесённых складов. Автоматическая замена локального реестра запрещена до проверки backup и журнала сервера.'),{code:'LOCAL_MIGRATION_REMOTE_RESET'})}
  if(remote.length&&local.warehouses.some(item=>String(item.origin||'')!=='server')&&!matchingMigration&&!generatedLocalWarehousePlaceholderV783(local)&&!provisionalNativeWarehouseIdV784(local))throw Object.assign(new Error('VPS уже содержит складские данные, а на компьютере найдены самостоятельные локальные склады. Автоматическое объединение запрещено: требуется контролируемый выбор источника.'),{code:'LOCAL_MIGRATION_REMOTE_NOT_EMPTY'});
  if(remote.length&&matchingMigration&&pendingMigration.state!=='complete'){
    currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];await migrateLocalCompanyToEmptyServerV783(B,local,response,remote);const refreshed=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});if(!refreshed?.ok||refreshed.configured!==true)throw Object.assign(new Error(refreshed?.error||'VPS не вернул список складов после продолжения переноса.'),{code:refreshed?.code||'LOCAL_MIGRATION_REGISTRY_REFRESH_FAILED'});remote=(refreshed.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean);preferredWarehouseId=confirmedPreferredWarehouseIdV784(refreshed,remote)
  }
  if(!remote.length){
    pendingActiveWarehouseMetadataChangeV783=null;
    currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];
    if(typeof response.registryInitialized!=='boolean'){
      audit('company_warehouse_registry_state_unknown',{workspaceId:companyId});
      throw Object.assign(new Error('Сервер не подтвердил состояние пустого реестра складов.'),{code:'WAREHOUSE_REGISTRY_CONTRACT_MISMATCH'})
    }
    if(await migrateLocalCompanyToEmptyServerV783(B,local,response,remote)){
      const refreshed=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});if(!refreshed?.ok||refreshed.configured!==true)throw Object.assign(new Error(refreshed?.error||'VPS не вернул список складов после переноса.'),{code:refreshed?.code||'LOCAL_MIGRATION_REGISTRY_REFRESH_FAILED'});remote=(refreshed.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean);preferredWarehouseId=confirmedPreferredWarehouseIdV784(refreshed,remote);if(!remote.length)throw Object.assign(new Error('VPS не подтвердил ни одного склада после переноса.'),{code:'LOCAL_MIGRATION_REGISTRY_EMPTY'})
    }
    if(remote.length){const warehouses=remote;let active=String(B.getRegistry().activeWarehouseId||'');if(!warehouses.some(item=>String(item.id)===active&&item.status!=='archived'))active=preferredWarehouseId||warehouses.find(item=>item.status!=='archived')?.id||'';B.saveRegistry({...B.getRegistry(),warehouses,activeWarehouseId:active,pendingServerDeleteWarehouseId:'',serverAuthoritativeEmpty:false,serverRegistryInitialized:true,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId,nativeRecoveryProvisionalWarehouseId:''});finalizeLocalToServerMigrationStorageV783(B);return true}
    const freshGenerated=generatedLocalWarehousePlaceholderV783(local);
    const mayBootstrapFirstWarehouse=response.registryInitialized===false&&freshGenerated&&currentUser?.allWarehouses===true&&hasPermission('warehouses.manage');
    if(mayBootstrapFirstWarehouse){
      const changed=String(local.serverWorkspaceId||'')!==companyId||local.serverRegistryInitialized!==false;
      if(changed)B.saveRegistry({...local,serverWorkspaceId:companyId,serverRegistryInitialized:false,serverHydratedAt:new Date().toISOString()});
      return false
    }
    const changed=local.warehouses.length>0||local.activeWarehouseId!==''||local.serverAuthoritativeEmpty!==true||String(local.serverWorkspaceId||'')!==companyId||local.serverRegistryInitialized!==response.registryInitialized;
    if(changed||Boolean(provisionalNativeWarehouseIdV784(local)))B.saveRegistry({...local,warehouses:[],activeWarehouseId:'',pendingServerDeleteWarehouseId:'',serverAuthoritativeEmpty:true,serverRegistryInitialized:response.registryInitialized,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId,nativeRecoveryProvisionalWarehouseId:''});
    return changed
  }
  const warehouses=remote,remoteIds=new Set(remote.map(item=>String(item.id)));
  let active=String(local.activeWarehouseId||'');
  if(!warehouses.some(item=>String(item.id)===active&&item.status!=='archived'))active=preferredWarehouseId||remote.find(item=>item.status!=='archived')?.id||'';
  const pending=String(local.pendingServerDeleteWarehouseId||''),next={...local,warehouses,activeWarehouseId:active,pendingServerDeleteWarehouseId:pending&&warehouses.some(item=>String(item.id)===pending)?pending:'',serverAuthoritativeEmpty:false,serverRegistryInitialized:true,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId,nativeRecoveryProvisionalWarehouseId:''};
  const signature=value=>JSON.stringify({activeWarehouseId:value.activeWarehouseId,nativeRecoveryProvisionalWarehouseId:String(value.nativeRecoveryProvisionalWarehouseId||''),warehouses:value.warehouses.map(item=>({id:item.id,code:item.code,name:item.name,address:item.address,lat:item.lat,lon:item.lon,timezone:item.timezone,status:item.status,origin:item.origin,revision:item.revision,digest:item.digest}))});
  const changed=signature(local)!==signature(next);
  if(changed)B.saveRegistry(next);finalizeLocalToServerMigrationStorageV783(B);
  currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];
  const previousActive=local.warehouses.find(item=>String(item.id)===String(local.activeWarehouseId)),nextActive=warehouses.find(item=>String(item.id)===String(active)),activeSelectionChanged=changed&&String(local.activeWarehouseId)!==String(active),activeMetadataChanged=!activeSelectionChanged&&String(active)===String(local.activeWarehouseId)&&remoteIds.has(String(active))&&(canonicalWarehouseMetadataSignatureV783(previousActive)!==canonicalWarehouseMetadataSignatureV783(nextActive)||!activeWarehouseSettingsMatchV783(nextActive));
  if(activeSelectionChanged)pendingActiveWarehouseMetadataChangeV783=null;else if(activeMetadataChanged)stageActiveWarehouseMetadataChangeV783(previousActive,nextActive);
  return activeSelectionChanged||pendingActiveWarehouseMetadataChangeV783?.warehouseId===String(active);
}
window.JustFunWarehouseRegistryV783=Object.freeze({refresh:synchronizeCompanyWarehouseRegistry,showNoWarehouse:renderNoWarehouse});
function requiresAuthoritativeWarehouseRegistry(){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return false;
  const companyId=String(desktopSession?.auth?.company?.id||''),pending=pendingWarehouseDeleteId(),migration=typeof readLocalToServerMigrationV783==='function'?readLocalToServerMigrationV783(window.TeplitsaWarehouseBootstrap):null,migrationCleanupPending=migration?.schemaVersion===LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783&&String(migration?.workspaceId||'')===companyId&&migration?.state==='complete'&&migration?.cleanupState==='pending';return !companyId||String(registry().serverWorkspaceId||'')!==companyId||Boolean(pending&&registry().warehouses.some(item=>String(item.id)===pending))||migrationCleanupPending
}
async function restoreFreshComputerWorkspace(){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return false;
  const warehouseId=activeWarehouseId(),environment=activeEnvironment();resetEntityScope();
  if(cloudSyncState.bootstrapped&&cloudSyncState.known.size)return false;
  const counts=window.TeplitsaWarehouseV600?.counts?.()||{},businessCount=Number(counts.orders||0)+Number(counts.movements||0)+Number(counts.routes||0)+Number(counts.executions||0)+Number(counts.archives||0);
  if(businessCount>0)return false;
  try{await bootstrapEntitySync(true);const restored=cloudSyncState.known.size>0;if(restored)audit('fresh_computer_workspace_restored',{warehouseId,environment,cursor:cloudSyncState.cursor,entities:cloudSyncState.known.size});return restored}
  catch(error){audit('fresh_computer_restore_failed',{code:error?.code||'',error:String(error?.message||error)});return false}
}
function mountWorkspace(){
  installAutomaticCloudSync();
  startLiveAccessRefresh();
  clearWorkspaceReloadGuard();
  document.documentElement.classList.add('jf-authenticated');addDesktopStrip();applyPermissions();installGuards();installEntityCommandGuards();applyBrand();installUserManagement();installIntegrationPanel();installLogDiagnostics();installHelp();installTelegramDriverActions();installTelegramRouteActions();if(desktopSession?.edition==='demo')enableLicensedDemo();setTimeout(()=>{try{window.renderAll?.();if(!isTrainingEnvironment()){refreshTelegramBindings().then(promptRequiredWarehouseTelegram).catch(()=>promptRequiredWarehouseTelegram());startTelegramPolling()}}catch{}},0)
}
async function confirmActiveWarehouseContext(){
  if(isTrainingEnvironment())return true;
  const bridge=window.JustFunDesktop?.setActiveWarehouse;if(typeof bridge!=='function')return true;
  const result=await bridge({warehouseId:activeWarehouseId(),environment:activeEnvironment()});
  if(!result?.ok)throw Object.assign(new Error(result?.error||'Основное ядро не подтвердило активный склад.'),{code:result?.code||'WAREHOUSE_CONTEXT_REJECTED'});
  return true
}
async function synchronizeWorkspaceInBackground(){
  if(backgroundWorkspaceSyncStarted||isTrainingEnvironment()||desktopSession?.auth?.offline)return;
  backgroundWorkspaceSyncStarted=true;
  try{
    const before=activeWarehouseId();await synchronizeCompanyWarehouseRegistry();const allowed=allowedWarehouseIds();
    if(!allowed.includes(before)){const target=allowed.includes(activeWarehouseId())?activeWarehouseId():allowed[0];if(target&&target!==activeWarehouseId())window.TeplitsaWarehouseBootstrap.setActive(target)}
    if(applyWarehouseRegistryTransition(before,'warehouse-registry-changed'))return;
    if(pendingWarehouseDeleteId()){renderNoWarehouse('Удаление склада подтверждено событием сервера, но новый список складов ещё не получен. Повторите проверку.');return}
    if(!document.documentElement.classList.contains('jf-authenticated')&&allowed.length){mountWorkspace();return}
    const restored=await restoreFreshComputerWorkspace();
    if(restored){window.renderAll?.();toast('Свежая защищённая копия склада восстановлена с сервера.')}
  }catch(error){backgroundWorkspaceSyncStarted=false;audit('background_workspace_sync_failed',{error:String(error?.message||error)});console.warn('Фоновая синхронизация рабочего пространства недоступна',error);if(!document.documentElement.classList.contains('jf-authenticated')&&requiresAuthoritativeWarehouseRegistry())renderNoWarehouse('Не удалось получить разрешённые склады с сервера. Проверьте соединение и повторите проверку.')}
}
async function restoreActiveWarehouseBeforeRecoveryV784(){
  if(isTrainingEnvironment())return false;const B=window.TeplitsaWarehouseBootstrap,local=B?.getRegistry?.(),placeholder=lostWarehouseRegistryPlaceholderV784(local);if(!placeholder)return false;
  const block=(reason,detail={})=>{audit('active_warehouse_pre_recovery_blocked',{reason,...detail});renderNoWarehouse('Локальный список складов повреждён. Данные не удалены и не отправлены на VPS. Подключите сервер и повторите проверку.');return true};
  if(!generatedLocalWarehousePlaceholderV783(local))return block('generated_placeholder_contains_business_data',{warehouseId:String(placeholder.id)});
  const companyId=String(desktopSession?.auth?.company?.id||''),userId=String(desktopSession?.auth?.user?.id||''),environment=activeEnvironment(),placeholderScope=`${companyId}:${environment}:${String(placeholder.id)}`;
  const restoreAuthoritative=async reason=>{if(desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return block(`${reason}_offline`);const before=activeWarehouseId();try{await synchronizeCompanyWarehouseRegistry()}catch(error){return block('authoritative_registry_read_failed',{reason,code:String(error?.code||''),error:String(error?.message||error)})}if(applyWarehouseRegistryTransition(before,'warehouse-registry-restored-before-recovery'))return true;return false};
  try{const inspected=window.JustFunLocalOutboxV783?.inspect?.(localStorage,placeholderScope);if(!inspected||inspected.overlayEntries().length||inspected.pendingServerResolutions().length||durableEntityDirty(placeholderScope))return block('generated_placeholder_has_local_changes',{warehouseId:String(placeholder.id)})}catch(error){return block('generated_placeholder_state_unreadable',{warehouseId:String(placeholder.id),code:String(error?.code||'')})}
  const recoveryKeyPrefix=`${B.prefix}${String(placeholder.id)}__${environment}__`;try{for(let index=0;index<localStorage.length;index++){const storageKey=String(localStorage.key(index)||'');if(storageKey.startsWith(recoveryKeyPrefix)&&storageKey.includes('justfun_critical_recovery_v1_'))return block('generated_placeholder_has_recovery_pointer',{warehouseId:String(placeholder.id)})}}catch(error){return block('generated_placeholder_storage_unreadable',{warehouseId:String(placeholder.id)})}
  if(typeof window.JustFunDesktop?.getActiveWarehousePreference!=='function')return block('trusted_preference_bridge_missing');let response;try{response=await window.JustFunDesktop.getActiveWarehousePreference()}catch(error){return block('trusted_preference_read_failed',{code:String(error?.code||''),error:String(error?.message||error)})}
  const id=String(response?.warehouseId||'');
  if(!response?.ok||String(response?.companyId||'')!==companyId||String(response?.userId||'')!==userId||String(response?.environment||'')!==environment)return block('trusted_preference_scope_invalid',{warehouseId:id});
  if(!id)return restoreAuthoritative('trusted_preference_missing');
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(id)||!cachedAuthAllowsWarehouseRecoveryV784(id))return restoreAuthoritative('trusted_preference_access_invalid');
  const target=recoveryWarehouseFromScopedSettingsV784(B,id);if(!target)return block('trusted_warehouse_settings_missing',{warehouseId:id});
  const targetScope=`${companyId}:${environment}:${id}`;try{const inspected=window.JustFunLocalOutboxV783.inspect(localStorage,targetScope),protectedEntries=[...inspected.overlayEntries(),...inspected.pendingServerResolutions()];if(protectedEntries.some(entry=>String(entry.companyId||'')!==companyId||String(entry.environment||'')!==environment||String(entry.warehouseId||'')!==id||String(entry.authorUserId||'')!==userId))return block('trusted_warehouse_outbox_owner_mismatch',{warehouseId:id})}catch(error){return block('trusted_warehouse_outbox_unreadable',{warehouseId:id,code:String(error?.code||'')})}
  const key=workspaceReloadKey(),now=Date.now();let previous={};try{previous=JSON.parse(sessionStorage.getItem(key)||'{}')}catch{}const same=String(previous.targetWarehouseId||'')===id&&String(previous.reason||'')==='native-active-preference';if(same&&now-Number(previous.at||0)<60000)return block('reload_loop_stopped',{warehouseId:id});
  try{sessionStorage.setItem(key,JSON.stringify({reason:'native-active-preference',targetWarehouseId:id,at:now}))}catch(error){audit('active_warehouse_pre_recovery_guard_failed',{warehouseId:id,error:String(error?.message||error)});renderNoWarehouse('Не удалось подготовить безопасное восстановление активного склада. Закройте и снова откройте программу.');return true}
  stopLiveAccessRefresh();try{audit('active_warehouse_pre_recovery_reload',{fromWarehouseId:String(placeholder.id),toWarehouseId:id});B.saveRegistry({...local,activeWarehouseId:id,warehouses:[target],serverWorkspaceId:companyId,serverRegistryInitialized:false,serverAuthoritativeEmpty:false,nativeRecoveryProvisionalWarehouseId:id});location.reload();return true}catch(error){audit('active_warehouse_pre_recovery_reload_failed',{fromWarehouseId:String(placeholder.id),toWarehouseId:id,error:String(error?.message||error)});renderNoWarehouse('Последний активный склад найден, но безопасная перезагрузка не выполнена. Закройте и снова откройте программу.');return true}
}
async function confirmProvisionalWarehouseBeforeRecoveryV784(){
  const id=provisionalNativeWarehouseIdV784();if(!id)return true;
  const inspectLocalJournal=async()=>{let journal;try{const context=criticalRecoveryContext();journal=await criticalRecoveryApi().read(context.warehouseId,context.environment,context.companyId)}catch(error){audit('native_recovery_journal_inspection_failed',{warehouseId:id,code:String(error?.code||''),error:String(error?.message||error)});renderNoWarehouse('Не удалось проверить локальное аварийное восстановление. Данные не отправлены. Повторите проверку после подключения VPS.');return false}if(journal?.phase==='pending_server'){audit('native_recovery_pending_server_waits_for_registry',{warehouseId:id,commandId:String(journal.commandId||'')});renderNoWarehouse('Операция сохранена локально и ожидает подтверждения склада на VPS. Подключите сервер и нажмите «Повторить проверку».');return false}return true};
  const online=!desktopSession?.auth?.offline&&Boolean(desktopSession?.auth?.company?.data_service)&&typeof window.JustFunDesktop?.regVps?.warehouses==='function';
  if(online){const before=activeWarehouseId();try{await synchronizeCompanyWarehouseRegistry()}catch(error){audit('native_recovery_registry_confirmation_failed',{warehouseId:id,code:String(error?.code||''),error:String(error?.message||error)});if(retryableEntityFailure(error))return inspectLocalJournal();renderNoWarehouse('VPS отклонил подтверждение последнего активного склада. Данные не отправлены. Повторите проверку с учётной записью, имеющей доступ к складу.');return false}if(applyWarehouseRegistryTransition(before,'native-recovery-registry-confirmed'))return false;if(provisionalNativeWarehouseIdV784()){renderNoWarehouse('VPS не подтвердил последний активный склад. Данные не отправлены. Повторите проверку.');return false}return true}
  return inspectLocalJournal()
}
async function enterWorkspace(){
  if(await restoreActiveWarehouseBeforeRecoveryV784())return false;if(!await confirmProvisionalWarehouseBeforeRecoveryV784())return false;try{await recoverCriticalEntityMutation()}catch(error){audit('critical_recovery_startup_blocked',{code:error?.code||'',error:String(error?.message||error)});renderNoWarehouse(error?.details?.foreignRecovery===true||String(error?.code||'').includes('OWNER_')||String(error?.code||'').includes('USER_MISMATCH')?String(error?.message||error):'Аварийное восстановление данных не завершено. Работа заблокирована до диагностики хранилища.');return false}const allowed=allowedWarehouseIds(),current=activeWarehouseId();
  if(pendingWarehouseDeleteId()){renderNoWarehouse('Сервер сообщил об удалении открытого склада. Подключитесь к сети и нажмите «Повторить проверку», чтобы получить новый список складов.');return false}
  if(requiresAuthoritativeWarehouseRegistry()){renderWarehouseLoading();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return false}
  if(!allowed.length){renderNoWarehouse();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return false}
  if(!allowed.includes(current)){window.TeplitsaWarehouseBootstrap.setActive(allowed[0]);if(!guardedWorkspaceReload('warehouse-selection',allowed[0]))renderNoWarehouse('Назначение склада получено, но повторная перезагрузка остановлена. Нажмите «Повторить проверку».');return false}
  try{await confirmActiveWarehouseContext();if(hasEntityPermissionQuarantine()){renderWarehouseLoading();await bootstrapEntitySync(true)}}catch(error){audit('warehouse_context_rejected',{warehouseId:current,code:error?.code||'',error:String(error?.message||error)});renderNoWarehouse(error?.code==='ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED'?error.message:'Не удалось безопасно подтвердить активный склад. Повторите проверку.');return false}
  mountWorkspace();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return true
}
async function installLogDiagnostics(){const diagnosticButton=q('#jfRunDataDiagnostics');if(diagnosticButton&&!diagnosticButton.dataset.bound){diagnosticButton.dataset.bound='1';diagnosticButton.onclick=()=>{const fixes=runDataDiagnostics(true);audit('manual_data_diagnostics_completed',{fixes:Number(fixes)||0});return fixes}}const button=q('#jfOpenLogs'),label=q('#jfLogPath');if(!button||button.dataset.bound)return;button.dataset.bound='1';try{const info=await window.JustFunDesktop?.getAppInfo?.();if(info?.logDir)label.textContent=info.logDir}catch{}button.onclick=async()=>{const result=await window.JustFunDesktop?.openLogFolder?.();if(!result?.ok)toast(result?.error||'Не удалось открыть папку журналов.','error')}}
function enableLicensedDemo(){document.body.classList.add('jf-demo-lock');const B=window.TeplitsaWarehouseBootstrap;if(B&&!B.isDemo()){B.setDemo(true);setSession(currentUser);location.reload();return}setTimeout(()=>{try{const scenarioKey=B?.dataKey?.('scenario_version','demo',activeWarehouseId());if(scenarioKey&&!localStorage.getItem(scenarioKey)&&typeof window.createDemonstrationScenario==='function')window.createDemonstrationScenario({showMessage:false});window.syncDemonstrationModeUI?.()}catch(e){console.error('Demo init',e)}},50)}
function toast(message,type='ok'){let stack=q('#jfToastStack');if(!stack){stack=document.createElement('div');stack.id='jfToastStack';stack.className='jf-toast-stack';stack.setAttribute('aria-live','polite');stack.setAttribute('aria-relevant','additions');document.body.append(stack)}const item=document.createElement('div');item.className='jf-toast'+(type==='error'?' error':'');item.setAttribute('role',type==='error'?'alert':'status');item.textContent=String(message);stack.append(item);setTimeout(()=>item.remove(),5000)}
let desktopDecisionQueue=Promise.resolve();
function desktopDecisionDialog(options={}){
  const config={title:'Подтвердите действие',message:'',confirmLabel:'Продолжить',cancelLabel:'Отмена',kind:'warning',prompt:false,defaultValue:'',placeholder:'',...options};
  return new Promise(resolve=>{
    const modal=document.createElement('div'),id=`jfDecision${Date.now()}${Math.random().toString(36).slice(2,7)}`;modal.id=id;modal.className=`jf-dialog-overlay open jf-decision-${config.kind}`;
    modal.innerHTML=`<form class="jf-dialog jf-decision-dialog"><header><span class="jf-decision-kicker">${config.kind==='danger'?'Важное действие':'Требуется решение'}</span><h2>${esc(config.title)}</h2></header><p class="jf-decision-message">${esc(config.message)}</p>${config.prompt?`<label class="jf-decision-input"><span>${esc(config.inputLabel||'Введите значение')}</span><input autocomplete="off" value="${esc(config.defaultValue)}" placeholder="${esc(config.placeholder)}"></label>`:''}<div class="jf-dialog-actions"><button class="btn-gray" type="button" data-dialog-cancel>${esc(config.cancelLabel)}</button><button class="${config.kind==='danger'?'btn-warn':'btn-primary'}" type="submit" data-dialog-confirm>${esc(config.confirmLabel)}</button></div></form>`;
    document.body.append(modal);document.body.classList.add('modal-open');const form=q('form',modal),input=q('input',modal);let settled=false;
    const finish=value=>{if(settled)return;settled=true;modal.classList.remove('open');if(!document.querySelector('.jf-profile-modal.open,.jf-help-modal.open,.jf-dialog-overlay.open'))document.body.classList.remove('modal-open');setTimeout(()=>modal.remove(),0);resolve(value)};
    q('[data-dialog-cancel]',modal).onclick=()=>finish(config.prompt?null:false);
    form.onsubmit=event=>{event.preventDefault();finish(config.prompt?String(input?.value||''):true)};
    modal.addEventListener('click',event=>{if(event.target===modal)finish(config.prompt?null:false)});
    modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finish(config.prompt?null:false)}});
    setTimeout(()=>{(input||q('[data-dialog-confirm]',modal))?.focus()},0)
  })
}
function queueDesktopDecision(options){const run=()=>desktopDecisionDialog(options);const pending=desktopDecisionQueue.then(run,run);desktopDecisionQueue=pending.catch(()=>{});return pending}
window.JustFunDialog=Object.freeze({
  confirm:(message,options={})=>queueDesktopDecision({...options,message:String(message||'')}),
  prompt:(message,defaultValue='',options={})=>queueDesktopDecision({...options,message:String(message||''),prompt:true,defaultValue:String(defaultValue||'')})
});
window.jfConfirm=(message,options={})=>{const text=String(message||''),danger=/безвозврат|удалить|очист|заменить локальный|восстановить данные|отменить операц/i.test(text);return window.JustFunDialog.confirm(text,{title:danger?'Подтвердите важное действие':'Подтвердите действие',confirmLabel:danger?'Подтвердить':'Продолжить',kind:danger?'danger':'warning',...options})};
window.jfPrompt=(message,defaultValue='',options={})=>window.JustFunDialog.prompt(message,defaultValue,{title:'Введите подтверждение',confirmLabel:'Продолжить',...options});
function modernAlert(){window.JustFunOverrides.replace('alert','desktop-dialogs-v750',function(message){toast(message,/ошиб|нельзя|запрещ|не удалось/i.test(String(message))?'error':'ok')})}
async function openProfile(){const returnFocus=document.activeElement;let modal=q('#jfProfileModal');if(!modal){modal=document.createElement('div');modal.id='jfProfileModal';modal.className='jf-profile-modal';document.body.append(modal)}const warehouses=allowedWarehouseIds().map(x=>registry().warehouses.find(w=>String(w.id)===x)?.name).filter(Boolean).map(esc).join(', ')||'Нет';const connection=isTrainingEnvironment()?'Учебный режим: реальные сервисы не изменяются':desktopSession?.auth?.offline?'Автономный доступ до '+new Date(desktopSession.auth.offline_expires_at).toLocaleString('ru-RU'):'Защищённый сервер подтверждён';modal.innerHTML=`<div class="jf-dialog"><h2>Профиль пользователя</h2><p class="muted">${esc(currentUser.fullName)} · ${esc(ROLE_LABELS[roleFor()]||roleFor())}</p><div class="jf-auth-grid"><div class="jf-auth-field"><label>Логин</label><div>${esc(currentUser.login||'demo')}</div></div><div class="jf-auth-field"><label>Роль</label><div>${esc(ROLE_LABELS[roleFor()]||roleFor())}</div></div><div class="jf-auth-field"><label>Компания</label><div>${esc(currentUser.companyName||'—')}</div></div><div class="jf-auth-field"><label>Код компании</label><div>${esc(currentUser.companyCode||'DEMO')}</div></div><div class="jf-auth-field"><label>Версия программы</label><div>${VERSION}</div></div><div class="jf-auth-field"><label>Устройство</label><div>${esc(currentUser.deviceId||'Локальный компьютер')}</div></div><div class="jf-auth-field span-2"><label>Разрешённые склады</label><div>${warehouses}</div></div><div class="jf-auth-field span-2"><label>Telegram активного склада</label><div id="jfProfileTelegram">${isTrainingEnvironment()?'Отключён в учебном режиме':'Проверяется…'}</div></div><div class="jf-auth-field span-2"><label>Состояние доступа</label><div>${esc(connection)}</div></div></div><div class="jf-dialog-actions"><button class="btn-primary" id="jfProfileClose">Закрыть</button></div></div>`;modal.classList.add('open');q('#jfProfileClose').onclick=()=>{modal.classList.remove('open');if(returnFocus&&document.contains(returnFocus))returnFocus.focus()};if(isTrainingEnvironment())return;try{const telegram=await window.JustFunDesktop?.telegramCloudflare?.status?.({warehouseId:activeWarehouseId()}),field=q('#jfProfileTelegram');if(field&&modal.classList.contains('open'))field.textContent=telegram?.configured?`${activeWarehouseLabel()} · @${telegram.botUsername||'имя не получено'} · ${telegram.online?'работает':'требует восстановления'}`:`${activeWarehouseLabel()} · бот не подключён`}catch(error){const field=q('#jfProfileTelegram');if(field&&modal.classList.contains('open'))field.textContent=`${activeWarehouseLabel()} · проверка недоступна`}}
function installUserManagement(){const existing=q('#jfUsersBox');if(!hasPermission('users.read')){existing?.remove();return}const grid=q('#programSettingsView .settings-grid');if(!grid||existing)return;const box=document.createElement('div');box.id='jfUsersBox';box.className='settings-box span-2 jf-users-panel';grid.prepend(box);renderUsersPanel()}
async function renderUsersPanel(){
  const box=q('#jfUsersBox');if(!box)return;
  if(isTrainingEnvironment()){box.innerHTML='<h3>Пользователи и права доступа</h3><p>Учебный режим не читает и не изменяет реальных сотрудников. Переключитесь в рабочий режим для управления доступом.</p>';return}
  box.innerHTML='<h3>Пользователи и права доступа</h3><p>Загрузка списка с Cloudflare…</p>';
  const [ur,dr,ir]=await Promise.all([window.JustFunDesktop.auth.users(),window.JustFunDesktop.auth.devices(),window.JustFunDesktop.auth.invitations()]);
  if(!ur?.ok){box.innerHTML=`<h3>Пользователи и права доступа</h3><div class="notice notice-warn">${esc(cloudResultError(ur))}</div>`;return}
  const panelUsers=(ur.users||[]).map(u=>cloudUserToLocal(u,desktopSession.auth?.company||{},desktopSession.auth||{})),panelUserById=new Map(panelUsers.map(user=>[String(user.id),user]));users=panelUsers;cloudDevices=dr?.ok?(dr.devices||[]):[];
  const warehouses=registry().warehouses;
  box.innerHTML=`<div class="jf-users-head"><div><h3>Пользователи и права доступа</h3></div><button class="btn-primary" id="jfAddUser">+ Создать приглашение</button></div><div class="jf-user-list">${panelUsers.map(u=>{const access=u.allWarehouses?'Все склады по одному':(u.warehouseIds||[]).map(id=>warehouses.find(w=>String(w.id)===String(id))?.code).filter(Boolean).join(', ')||'По роли';const locked=u.id===currentUser.id||u.role==='owner';return`<div class="jf-user-row ${u.status==='blocked'?'blocked':''}"><div><b>${esc(u.fullName)}</b><small>${esc(u.login)} · ${u.status==='blocked'?'заблокирован':'активен'}</small></div><div>${esc(ROLE_LABELS[u.role]||u.role)}</div><div>${esc(access)}</div><div class="jf-user-actions"><button class="btn-soft" data-user-edit="${esc(u.id)}" ${locked?'disabled':''}>Изменить доступ</button><button class="btn-gray" data-user-toggle="${esc(u.id)}" ${locked?'disabled':''}>${u.status==='blocked'?'Разблокировать':'Блокировать'}</button></div></div>`}).join('')}</div><div class="jf-users-head" style="margin-top:22px"><div><h3>Подключённые компьютеры</h3><p>Заблокированный компьютер больше не сможет войти.</p></div></div><div class="jf-user-list">${cloudDevices.map(d=>`<div class="jf-user-row ${d.status==='blocked'?'blocked':''}"><div><b>${esc(d.device_name)}</b><small>${esc(d.full_name)} · ${esc(d.login)}</small></div><div>${esc(ROLE_LABELS[SERVER_ROLE_TO_APP[d.role]||d.role]||d.role)}</div><div>${new Date(d.last_seen_at).toLocaleString('ru-RU')}</div><div class="jf-user-actions"><button class="btn-gray" data-device-toggle="${esc(d.id)}" ${String(d.id)===String(currentUser.deviceId)?'disabled':''}>${d.status==='blocked'?'Разблокировать':'Блокировать'}</button></div></div>`).join('')||'<div class="muted">Компьютеры ещё не зарегистрированы.</div>'}</div>`;
  const invitationRows=ir?.ok?asArray(ir.invitations):[],invitationStatus={pending:'Ожидает входа',used:'Использовано',expired:'Истекло',revoked:'Отозвано'},invitationHost=document.createElement('section');invitationHost.className='jf-invitation-registry';invitationHost.innerHTML=`<div class="jf-users-head"><div><h3>Приглашения</h3><p>Код показывается только при создании. Здесь нет секрета — только безопасный статус и срок.</p></div></div>${ir?.ok?`<div class="jf-user-list">${invitationRows.map(invitation=>`<div class="jf-user-row invitation-${esc(invitation.status)}"><div><b>${esc(invitation.full_name)}</b><small>${esc(invitation.login)} · создано ${new Date(invitation.created_at).toLocaleString('ru-RU')}</small></div><div>${esc(invitation.role)}</div><div><b>${esc(invitationStatus[invitation.status]||invitation.status)}</b><small>${invitation.status==='used'?`Вход: ${new Date(invitation.claimed_at).toLocaleString('ru-RU')}`:invitation.status==='revoked'?`Отозвано: ${new Date(invitation.revoked_at).toLocaleString('ru-RU')}`:`Действует до: ${new Date(invitation.expires_at).toLocaleString('ru-RU')}`}</small></div><div class="jf-user-actions">${invitation.status==='pending'&&roleFor()==='owner'?`<button class="btn-danger" data-invitation-revoke="${esc(invitation.id)}">Отозвать</button>`:''}</div></div>`).join('')||'<div class="muted">Приглашений ещё нет.</div>'}</div>`:`<div class="notice notice-warn">${esc(cloudResultError(ir))}</div>`}`;const deviceHeading=qa('.jf-users-head',box)[1];if(deviceHeading)deviceHeading.before(invitationHost);else box.append(invitationHost);
  qa('[data-invitation-revoke]',invitationHost).forEach(button=>button.onclick=async()=>{const invitation=invitationRows.find(item=>String(item.id)===String(button.dataset.invitationRevoke));if(!invitation||!await jfConfirm(`Отозвать приглашение для «${invitation.full_name}»? После этого код больше не сработает.`,{title:'Отзыв приглашения',confirmLabel:'Отозвать',kind:'danger'}))return;button.disabled=true;const result=await window.JustFunDesktop.auth.revokeInvitation({invitationId:invitation.id});if(!result?.ok)toast(cloudResultError(result),'error');await renderUsersPanel()});
  const canCreate=hasPermission('users.create'),canUpdate=hasPermission('users.update'),canManageDevices=hasPermission('devices.manage'),addUser=q('#jfAddUser');
  addUser.disabled=!canCreate;addUser.title=canCreate?'Создать приглашение':'Нет права создавать сотрудников';if(canCreate)addUser.onclick=openUserCreator;
  qa('[data-user-edit]',box).forEach(b=>{b.disabled=b.disabled||!canUpdate;b.title=canUpdate?'Изменить роль и разрешения':'Нет права изменять доступ';if(canUpdate)b.onclick=()=>{const u=panelUserById.get(String(b.dataset.userEdit));if(u)openUserAccessEditor(u)}});
  qa('[data-user-toggle]',box).forEach(b=>{b.disabled=b.disabled||!canUpdate;b.title=canUpdate?'Изменить состояние сотрудника':'Нет права блокировать сотрудников';if(canUpdate)b.onclick=async()=>{const u=panelUserById.get(String(b.dataset.userToggle));if(!u)return;const target=u.status==='blocked'?'active':'blocked';b.disabled=true;const r=await window.JustFunDesktop.auth.setUserStatus({userId:u.id,status:target});if(!r?.ok)toast(cloudResultError(r),'error');await renderUsersPanel()}});
  qa('[data-device-toggle]',box).forEach(b=>{b.disabled=b.disabled||!canManageDevices;b.title=canManageDevices?'Изменить состояние компьютера':'Нет права управлять компьютерами';if(canManageDevices)b.onclick=async()=>{const d=cloudDevices.find(x=>String(x.id)===String(b.dataset.deviceToggle));if(!d)return;const target=d.status==='blocked'?'active':'blocked';b.disabled=true;const r=await window.JustFunDesktop.auth.setDeviceStatus({deviceId:d.id,status:target});if(!r?.ok)toast(cloudResultError(r),'error');await renderUsersPanel()}});
}
function openUserCreator(){return openUserEditor('')}
function accessFormError(modal,statusBox,message,field=null){qa('[aria-invalid="true"]',modal).forEach(input=>input.removeAttribute('aria-invalid'));if(field){field.setAttribute('aria-invalid','true');field.focus()}statusBox.textContent=message;statusBox.className='jf-auth-status error';return false}
function validCustomRole(value){const role=String(value||'').trim().replace(/\s+/g,' ');return role.toLowerCase()!=='owner'&&/^[\p{L}\p{N}][\p{L}\p{N} ._()\/-]{1,49}$/u.test(role)}
function openUserEditor(){
  let modal=q('#jfUserCreator');if(!modal){modal=document.createElement('div');modal.id='jfUserCreator';modal.className='jf-profile-modal';document.body.append(modal)}
  const allowed=new Set(allowedWarehouseIds()),warehouses=registry().warehouses.filter(w=>w.status!=='archived'&&allowed.has(String(w.id))),selected=new Set(activeWarehouseId()?[activeWarehouseId()]:[]),canAssignAll=Boolean(currentUser?.allWarehouses);
  modal.innerHTML=`<form class="jf-dialog jf-user-access-dialog" id="jfUserForm"><header class="jf-access-head"><span>Новый сотрудник</span><h2>Приглашение и точные права</h2><p>Название роли придумывает владелец. Разрешения действуют только в выбранных складах.</p></header><div class="jf-access-scroll"><section class="jf-access-section"><h3>1. Кто входит</h3><div class="jf-auth-grid"><div class="jf-auth-field span-2"><label>ФИО сотрудника</label><input id="jfUserName" maxlength="100" autocomplete="name" required></div><div class="jf-auth-field"><label>Логин</label><input id="jfUserLogin" maxlength="40" autocomplete="off" placeholder="Например: sklad_msk" required><small>От 3 до 40 букв, цифр, точек, дефисов или подчёркиваний.</small></div><div class="jf-auth-field"><label>Название роли</label><input id="jfUserRole" maxlength="50" placeholder="Например: Старший кладовщик" required><small>Это свободное название, а не заранее заданная роль.</small></div></div></section><section class="jf-access-section"><h3>2. Что сотрудник сможет делать</h3>${cloudPermissionTools('jfPermission')}<div class="jf-permission-grid">${cloudPermissionPicker('jfPermission')}</div></section><section class="jf-access-section"><h3>3. Где действуют права</h3><label class="jf-user-all"><input id="jfUserAll" type="checkbox" ${canAssignAll?'':'disabled'}><span><b>Все склады компании</b><small>Включает будущие склады. Обычно безопаснее назначить конкретные.</small></span></label><div class="jf-warehouse-checks">${warehouses.map(w=>`<label><input type="checkbox" name="jfWarehouse" value="${esc(w.id)}" ${selected.has(String(w.id))?'checked':''}><span><b>${esc(w.name)}</b><small>${esc(w.code)}</small></span></label>`).join('')}</div></section></div><footer class="jf-dialog-actions jf-access-footer"><div class="jf-auth-status" id="jfUserStatus"></div><button class="btn-gray" type="button" id="jfUserCancel">Отмена</button><button class="btn-primary" type="submit" id="jfUserSubmit">Создать приглашение</button></footer></form>`;
  modal.classList.add('open');const all=q('#jfUserAll'),checks=()=>qa('input[name="jfWarehouse"]',modal),sync=()=>checks().forEach(x=>x.disabled=all.checked);sync();all.onchange=sync;prepareCloudPermissionEditor(modal,'jfPermission');q('#jfUserCancel').onclick=()=>modal.classList.remove('open');
  q('#jfUserForm').onsubmit=async e=>{e.preventDefault();const nameInput=q('#jfUserName'),loginInput=q('#jfUserLogin'),roleInput=q('#jfUserRole'),fullName=nameInput.value.trim(),login=loginInput.value.trim().toLowerCase(),role=roleInput.value.trim().replace(/\s+/g,' '),permissions=qa('input[name="jfPermission"]:checked',modal).map(x=>x.value),allWarehouses=all.checked,warehouseIds=checks().filter(x=>x.checked).map(x=>x.value),st=q('#jfUserStatus'),submit=q('#jfUserSubmit');if(fullName.length<2)return accessFormError(modal,st,'Укажите ФИО сотрудника: минимум 2 символа.',nameInput);if(!/^[a-zа-яё0-9._-]{3,40}$/iu.test(login))return accessFormError(modal,st,'Логин: 3–40 букв или цифр; допустимы точка, дефис и подчёркивание.',loginInput);if(!validCustomRole(role))return accessFormError(modal,st,'Название роли: 2–50 букв или цифр. Слово «owner» зарезервировано.',roleInput);if(!permissions.length)return accessFormError(modal,st,'Выберите хотя бы одно действие сотрудника.');if(!allWarehouses&&!warehouseIds.length)return accessFormError(modal,st,'Выберите хотя бы один склад.');qa('[aria-invalid="true"]',modal).forEach(input=>input.removeAttribute('aria-invalid'));st.textContent='Создаём одноразовое приглашение…';st.className='jf-auth-status';submit.disabled=true;const r=await window.JustFunDesktop.auth.invite({fullName,login,role,permissions:cloudPermissions(permissions,allWarehouses,warehouseIds),expiresInHours:24});submit.disabled=false;if(!r?.ok)return accessFormError(modal,st,cloudResultError(r),r?.error==='LOGIN_ALREADY_EXISTS'||r?.error==='INVITATION_ALREADY_EXISTS'?loginInput:null);const inv=r.invitation;if(!inv?.code)return accessFormError(modal,st,'Сервер подтвердил операцию, но не вернул код приглашения. Повторите запрос.');modal.innerHTML=`<div class="jf-dialog jf-invitation-result"><span>Приглашение создано</span><h2>${esc(inv.full_name)}</h2><p>Логин: <b>${esc(inv.login)}</b> · роль: <b>${esc(inv.role)}</b><br>Код действует до ${new Date(inv.expires_at).toLocaleString('ru-RU')} и используется один раз.</p><div class="code">${esc(inv.code)}</div><div class="jf-dialog-actions"><button class="btn-soft" id="jfCopyInvitation">Скопировать код</button><button class="btn-primary" id="jfInvitationDone">Закрыть</button></div></div>`;q('#jfCopyInvitation').onclick=()=>window.JustFunDesktop.copyText(inv.code);q('#jfInvitationDone').onclick=async()=>{modal.classList.remove('open');await renderUsersPanel()}}
}
function openUserAccessEditor(user){
  let modal=q('#jfUserCreator');if(!modal){modal=document.createElement('div');modal.id='jfUserCreator';modal.className='jf-profile-modal';document.body.append(modal)}
  const allowed=new Set(allowedWarehouseIds()),warehouses=registry().warehouses.filter(w=>w.status!=='archived'&&allowed.has(String(w.id))),selected=new Set(user.warehouseIds||[]),selectedPermissions=(user.permissions||[]).filter(x=>!String(x).startsWith('jf.warehouse')),canAssignAll=Boolean(currentUser?.allWarehouses);
  modal.innerHTML=`<form class="jf-dialog jf-user-access-dialog" id="jfUserAccessForm"><header class="jf-access-head"><span>Доступ сотрудника</span><h2>${esc(user.fullName)}</h2><p>Логин: ${esc(user.login)}. Изменения вступят в силу при ближайшей проверке сессии сотрудника.</p></header><div class="jf-access-scroll"><section class="jf-access-section"><h3>1. Название роли</h3><div class="jf-auth-field"><label>Роль, которую придумал владелец</label><input id="jfAccessRole" maxlength="50" value="${esc(user.serverRole||user.role)}" required></div></section><section class="jf-access-section"><h3>2. Разрешённые действия</h3>${cloudPermissionTools('jfAccessPermission')}<div class="jf-permission-grid">${cloudPermissionPicker('jfAccessPermission',selectedPermissions)}</div></section><section class="jf-access-section"><h3>3. Разрешённые склады</h3><label class="jf-user-all"><input id="jfAccessAll" type="checkbox" ${canAssignAll&&user.allWarehouses?'checked':''} ${canAssignAll?'':'disabled'}><span><b>Все склады компании</b><small>Включает будущие склады.</small></span></label><div class="jf-warehouse-checks">${warehouses.map(w=>`<label><input type="checkbox" name="jfAccessWarehouse" value="${esc(w.id)}" ${selected.has(String(w.id))?'checked':''}><span><b>${esc(w.name)}</b><small>${esc(w.code)}</small></span></label>`).join('')}</div></section></div><footer class="jf-dialog-actions jf-access-footer"><div class="jf-auth-status" id="jfAccessStatus"></div><button class="btn-gray" type="button" id="jfAccessCancel">Отмена</button><button class="btn-primary" type="submit" id="jfAccessSubmit">Сохранить доступ</button></footer></form>`;
  modal.classList.add('open');const all=q('#jfAccessAll'),checks=()=>qa('input[name="jfAccessWarehouse"]',modal),sync=()=>checks().forEach(x=>x.disabled=all.checked);sync();all.onchange=sync;prepareCloudPermissionEditor(modal,'jfAccessPermission');q('#jfAccessCancel').onclick=()=>modal.classList.remove('open');
  q('#jfUserAccessForm').onsubmit=async event=>{event.preventDefault();const roleInput=q('#jfAccessRole'),role=roleInput.value.trim().replace(/\s+/g,' '),permissions=qa('input[name="jfAccessPermission"]:checked',modal).map(x=>x.value),allWarehouses=all.checked,warehouseIds=checks().filter(x=>x.checked).map(x=>x.value),statusBox=q('#jfAccessStatus'),submit=q('#jfAccessSubmit');if(!validCustomRole(role))return accessFormError(modal,statusBox,'Название роли: 2–50 букв или цифр. Слово «owner» зарезервировано.',roleInput);if(!permissions.length)return accessFormError(modal,statusBox,'Выберите хотя бы одно действие сотрудника.');if(!allWarehouses&&!warehouseIds.length)return accessFormError(modal,statusBox,'Выберите хотя бы один склад.');statusBox.textContent='Сохраняем права…';statusBox.className='jf-auth-status';submit.disabled=true;const result=await window.JustFunDesktop.auth.setUserAccess({userId:user.id,role,permissions:cloudPermissions(permissions,allWarehouses,warehouseIds)});submit.disabled=false;if(!result?.ok)return accessFormError(modal,statusBox,cloudResultError(result));modal.classList.remove('open');toast('Название роли, права и склады сотрудника обновлены.','ok');await renderUsersPanel()}
}
function activeEnvironment(){return window.TeplitsaWarehouseBootstrap?.isDemo?.()?'demo':'live'}
function isTrainingEnvironment(){return desktopSession?.edition==='demo'||window.TeplitsaWarehouseBootstrap?.isDemo?.()===true}
function userVisibleError(error,fallback='Операция не выполнена'){return String(error?.message||error||fallback).replace(/^Error:\s*/i,'').trim()||fallback}
function activeWarehouseLabel(){const w=registry().warehouses.find(x=>String(x.id)===activeWarehouseId());return w?.name||w?.code||'Активный склад'}
function setIntegrationBusy(button,busy){if(button){button.disabled=!!busy;button.dataset.originalText=button.dataset.originalText||button.textContent;if(busy)button.textContent='Выполняется…';else button.textContent=button.dataset.originalText}}
function setIntegrationWizardBusy(activeButton,busy){
  integrationWizardBusy=!!busy;
  for(const button of ['#jfRegConfigure','#jfTelegramConfigure','#jfTelegramReconnect'].map(selector=>q(selector)).filter(Boolean)){
    button.dataset.originalText=button.dataset.originalText||button.textContent;
    button.disabled=integrationWizardBusy;
    button.textContent=integrationWizardBusy&&button===activeButton?'Выполняется…':button.dataset.originalText;
  }
}
function integrationStatus(id,text,kind=''){const el=q('#'+id);if(!el)return;el.textContent=String(text||'');el.className='jf-integration-status'+(kind?' '+kind:'')}
function integrationBadge(id,text,kind=''){const el=q('#'+id);if(!el)return;el.textContent=text;el.className=kind}
async function refreshRegVpsStatus(options={}){
  const manual=options===true||options?.manual===true,button=manual?q('#jfRegCheck'):null;
  if(button?.disabled)return;
  if(manual){setIntegrationBusy(button,true);integrationBadge('jfRegBadge','Проверяем…');integrationStatus('jfRegStatus',`Проверяем HTTPS, закреплённый TLS-сертификат, сервер ${VERSION} и PostgreSQL…`)}
  try{
    const status=await window.JustFunDesktop?.regVps?.status?.();if(!status)throw new Error('Настольное ядро не вернуло результат проверки.');
    if(status.address&&q('#jfRegAddress')&&!q('#jfRegAddress').value)q('#jfRegAddress').value=status.address;
    if(status.sshUser&&q('#jfRegUser'))q('#jfRegUser').value=status.sshUser;
    if(status.sshPort&&q('#jfRegPort'))q('#jfRegPort').value=status.sshPort;
    const checked=status.checkedAt?new Date(status.checkedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if(!status.configured){integrationBadge('jfRegBadge','Не настроен');integrationStatus('jfRegStatus','Сначала установите VPS: одного IP в поле недостаточно, программа должна закрепить SSH- и TLS-отпечатки.','error');return}
    if(status.online){integrationBadge('jfRegBadge','Работает','ready');integrationStatus('jfRegStatus',`Связь подтверждена в ${checked}. HTTPS ${status.address} · сервер ${status.version||'—'} · PostgreSQL: ${status.database==='ready'?'готов':'проверяется'}. Копии LIVE и DEMO хранятся раздельно.`,'ok')}
    else{const stage=({dns:'DNS-адрес',connection:'сетевое соединение',tls:'TLS-сертификат',health:'прикладной API',api:'прикладной API',authorization:'авторизация компании',database:'PostgreSQL'})[status.diagnosticStage]||'подключение';integrationBadge('jfRegBadge','Нет связи','error');integrationStatus('jfRegStatus',`Не пройдена проверка «${stage}» в ${checked}: ${status.error||'VPS не отвечает'}. Код: ${status.errorCode||'NETWORK_ERROR'}. Уже работающие компоненты переустанавливать не нужно.`,'error')}
  }catch(error){integrationBadge('jfRegBadge','Ошибка проверки','error');integrationStatus('jfRegStatus',error?.message||String(error),'error')}
  finally{if(button)setIntegrationBusy(button,false)}
}
async function configureRegVps(){
  const button=q('#jfRegConfigure'),address=q('#jfRegAddress')?.value.trim(),sshUser=q('#jfRegUser')?.value.trim(),sshPort=Number(q('#jfRegPort')?.value||22);if(integrationWizardBusy)return integrationStatus('jfRegStatus','Сначала завершите уже открытый защищённый мастер.','error');setIntegrationWizardBusy(button,true);integrationStatus('jfRegStatus','Открывается защищённое окно. После ввода пароля подтвердите отпечаток SSH-ключа вашего VPS REG.RU.');
  try{const result=await window.JustFunDesktop?.regVps?.configure?.({address,sshUser,sshPort});if(!result?.ok)throw new Error(result?.error||'Мастер VPS не завершён');if(result.canceled){integrationStatus('jfRegStatus','Настройка VPS отменена. Сохранённые параметры не изменены.');return}const refreshedSession=await window.JustFunDesktop?.getSession?.();if(!refreshedSession?.auth?.company?.data_service)throw new Error('VPS установлен, но текущая сессия не получила серверные настройки компании. Повторите проверку входа.');desktopSession.auth=refreshedSession.auth;currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);integrationStatus('jfRegStatus','VPS установлен и проверен. SSH-ключ закреплён, PostgreSQL не открыт наружу.','ok');await refreshRegVpsStatus()}
  catch(error){integrationStatus('jfRegStatus',error?.message||error,'error')}
  finally{setIntegrationWizardBusy(button,false)}
}
const ENTITY_ARRAY_SECTIONS=['orders','products','inventoryMovements','drivers','routeArchives'];
const ENTITY_MAP_SECTIONS=['routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','warehouseReservations','manualRouteSequences'];
const ENTITY_SINGLETON_SECTIONS=['settings','reportingData','company'];
const WAREHOUSE_REGISTRY_ENVIRONMENT='live';
const ENTITY_SETTINGS_WAREHOUSE_FIELDS=['warehouse'];
const ENTITY_SETTINGS_ROUTE_FIELDS=['routeStartTime','serviceMinutes','serviceMinMinutes','serviceMaxMinutes','minRouteHours','maxRouteHours','maxRoundKm','maxStops','routeMode','returnToDepot','routeProfile','routeHintsEnabled','driverPayment','deliveryPricing','driverRatePerKm','loadingStartTime','loadingBayCount','loadingMinutes','loadingIntervalMinutes','driverArrivalLeadMinutes','arrivalWindowMinutes','loadingPriority'];
const ENTITY_SETTINGS_INTEGRATION_FIELDS=['nominatimUrl','osrmUrl','tileUrl'];
const ENTITY_UPDATE_PERMISSION={warehouse:['warehouses.manage'],orders:['orders.create','orders.update','orders.status','orders.payment','orders.pricing','orders.delete'],products:['inventory.catalog','inventory.stock','inventory.pricing','inventory.delete'],inventoryMovements:['inventory.stock'],drivers:['drivers.update','drivers.delete'],settings:['warehouses.manage','routes.settings','integrations.manage'],company:['company.update'],reportingData:['reports.settings','reports.expenses'],routePlans:['routes.plan','routes.approve','routes.pick','routes.start','routes.return','routes.close','routes.cancel'],routeAssignments:['routes.plan','routes.cancel'],routeCatalog:['routes.plan','routes.cancel'],routeDriverAssignments:['drivers.assign','routes.cancel'],routeLocks:['routes.plan','routes.approve','routes.cancel'],routeOverrides:['routes.settings','routes.cancel'],routeExecutions:['routes.start','routes.return','routes.close'],routeArchives:['routes.close'],warehouseReservations:['inventory.pick','routes.close'],manualRouteSequences:['routes.plan','routes.cancel']};
const cloudSyncState={installed:false,bootstrapped:false,bootstrapPromise:null,bootstrapFlights:new Map(),scopeEpoch:0,dirty:false,dirtyOwnerUserId:'',dirtyOwnerError:null,serial:0,suspended:0,uploadTimer:null,pollTimer:null,retryTimer:null,inFlightScopes:new Map(),criticalFlights:new Map(),ordinaryFlights:new Map(),ordinaryPrearms:new Map(),contextBlockedError:null,pollFailures:0,nextPollAt:0,scope:'',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set(),readerUserId:'',outboxes:new Map(),outbox:null,outboxError:null,localBaseline:null,observedFingerprint:''};
function stableEntityValue(value){if(Array.isArray(value))return value.map(stableEntityValue);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stableEntityValue(value[key]);return out}return value}
function entityFingerprint(value){const stable=JSON.stringify(stableEntityValue(value)),reverse=stable.split('').reverse().join('');return`${hashString(stable)}:${hashString(reverse)}:${stable.length}`}
function entityKey(type,id){return`${String(type)}:${String(id)}`}
function entityScope(){return`${String(desktopSession?.auth?.company?.id||'unknown')}:${activeEnvironment()}:${activeWarehouseId()}`}
function entityStateStorageKey(scope=entityScope()){return`jf.reg-entity-state.v2.${String(scope).replace(/[^A-Za-z0-9_.:-]/g,'_')}`}
function entityDirtyStorageKey(scope=cloudSyncState.scope||entityScope()){return`jf.reg-entity-dirty.v1.${String(scope).replace(/[^A-Za-z0-9_.:-]/g,'_')}`}
function entityDirtyOwnerStorageKey(scope=cloudSyncState.scope||entityScope()){return`jf.reg-entity-dirty-owner.v1.${String(scope).replace(/[^A-Za-z0-9_.:-]/g,'_')}`}
function currentEntityUserId(){return String(desktopSession?.auth?.user?.id||currentUser?.id||'').trim()}
function validEntityRecoveryUserId(value){return/^[A-Za-z0-9_-]{1,160}$/.test(String(value||''))}
function readEntityDirtyOwner(scope=cloudSyncState.scope||entityScope()){
  let raw;try{raw=localStorage.getItem(entityDirtyOwnerStorageKey(scope))}catch(error){throw outboxError('ENTITY_DIRTY_OWNER_READ_FAILED','Не удалось прочитать владельца локальных несинхронизированных данных.',{cause:String(error?.message||error)})}if(!raw)return null;
  let record;try{record=JSON.parse(raw)}catch(error){throw outboxError('ENTITY_DIRTY_OWNER_CORRUPT','Запись владельца локальных несинхронизированных данных повреждена.',{cause:String(error?.message||error)})}
  const ownerUserId=String(record?.ownerUserId||'');if(Number(record?.schemaVersion)!==1||String(record?.scope||'')!==String(scope)||!validEntityRecoveryUserId(ownerUserId))throw outboxError('ENTITY_DIRTY_OWNER_CORRUPT','Запись владельца локальных несинхронизированных данных имеет неверный формат или область.');return{schemaVersion:1,scope:String(scope),ownerUserId,deviceId:String(record?.deviceId||''),createdAt:String(record?.createdAt||''),updatedAt:String(record?.updatedAt||'')}
}
function writeEntityDirtyOwner(ownerUserId,scope=cloudSyncState.scope||entityScope()){
  ownerUserId=String(ownerUserId||'');if(!validEntityRecoveryUserId(ownerUserId))throw outboxError('ENTITY_DIRTY_OWNER_REQUIRED','Нельзя сохранить локальное изменение без подтверждённого пользователя.');const previous=readEntityDirtyOwner(scope),now=new Date().toISOString(),record={schemaVersion:1,scope:String(scope),ownerUserId,deviceId:localOutboxDeviceId(),createdAt:previous?.ownerUserId===ownerUserId&&previous.createdAt?previous.createdAt:now,updatedAt:now};try{localStorage.setItem(entityDirtyOwnerStorageKey(scope),JSON.stringify(record))}catch(error){throw outboxError('ENTITY_DIRTY_OWNER_WRITE_FAILED','Не удалось зафиксировать владельца локального изменения на диске.',{cause:String(error?.message||error)})}if(cloudSyncState.scope===scope){cloudSyncState.dirtyOwnerUserId=ownerUserId;cloudSyncState.dirtyOwnerError=null}return record
}
function entityProtectedOutboxEntries(queue){const entries=[...asArray(queue?.overlayEntries?.()).filter(entry=>entry?.preserveLocal!==false),...asArray(queue?.pendingServerResolutions?.())],unique=new Map();for(const entry of entries)if(entry?.commandId)unique.set(String(entry.commandId),entry);return[...unique.values()]}
function entityOutboxOwnerIds(queue){const owners=new Set();for(const entry of entityProtectedOutboxEntries(queue)){const owner=String(entry?.authorUserId||'');if(!validEntityRecoveryUserId(owner))throw outboxError('ENTITY_OUTBOX_OWNER_CORRUPT','Локальная очередь содержит команду без подтверждённого автора.');owners.add(owner)}return owners}
function savedEntityReaderUserId(scope=cloudSyncState.scope||entityScope()){
  if(cloudSyncState.scope===scope&&cloudSyncState.readerUserId)return String(cloudSyncState.readerUserId);try{const saved=JSON.parse(localStorage.getItem(entityStateStorageKey(scope))||'{}');return String(saved?.readerUserId||'')}catch{return''}
}
function entityRecoveryOwnershipFailure(code,ownerUserId,currentUserId,source,block=true){
  const foreign=Boolean(ownerUserId&&currentUserId&&ownerUserId!==currentUserId),message=foreign?'На этом компьютере сохранены несинхронизированные данные другого пользователя. Выйдите и войдите под той же учётной записью, которая создала изменения. Данные не удалены и не отправлены на VPS.':'Не удалось подтвердить владельца локальных несинхронизированных данных. Автоматическая работа остановлена без удаления и отправки данных.';const error=outboxError(code,message,{ownerUserId:String(ownerUserId||''),currentUserId:String(currentUserId||''),source:String(source||''),foreignRecovery:foreign});cloudSyncState.contextBlockedError=error;if(block){stopLiveAccessRefresh();stopTelegramPolling();freezeWorkspaceForWarehouseTransition();cloudSyncState.dirty=true;renderNoWarehouse(message)}throw error
}
function assertEntityRecoveryOwnership({scope=cloudSyncState.scope||entityScope(),queue=scope===cloudSyncState.scope?cloudSyncState.outbox:null,journalOwnerUserId=null,legacyJournal=false,block=true,adoptLegacyOwner=true}={}){
  scope=String(scope);let owners;try{owners=entityOutboxOwnerIds(queue)}catch(error){return entityRecoveryOwnershipFailure(String(error?.code||'ENTITY_OUTBOX_OWNER_CORRUPT'),'',currentEntityUserId(),'outbox',block)}const outboxOwner=owners.size?[...owners][0]:'',generation=entityDirtyGeneration(scope),recoveryJournalPresent=journalOwnerUserId!==null,currentUserId=currentEntityUserId();
  if(owners.size>1)return entityRecoveryOwnershipFailure('ENTITY_OUTBOX_MULTIPLE_OWNERS','',currentUserId,'outbox',block);if(!validEntityRecoveryUserId(currentUserId)){if(currentUserId===''&&!generation&&!outboxOwner&&!recoveryJournalPresent)return{ownerUserId:'',currentUserId:'',scope};return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_USER_UNKNOWN','',currentUserId,'current-user',block)}
  if(outboxOwner&&outboxOwner!==currentUserId)return entityRecoveryOwnershipFailure('ENTITY_OUTBOX_OWNER_MISMATCH',outboxOwner,currentUserId,'outbox',block);
  if(scope===cloudSyncState.scope&&cloudSyncState.dirtyOwnerError)return entityRecoveryOwnershipFailure(String(cloudSyncState.dirtyOwnerError.code||'ENTITY_DIRTY_OWNER_CORRUPT'),'',currentUserId,'dirty-owner',block);
  const protectedLocal=Boolean(generation||outboxOwner);let ownerRecord=null;try{ownerRecord=readEntityDirtyOwner(scope)}catch(error){return entityRecoveryOwnershipFailure(String(error?.code||'ENTITY_DIRTY_OWNER_CORRUPT'),'',currentUserId,'dirty-owner',block)}let ownerUserId=protectedLocal?String(ownerRecord?.ownerUserId||outboxOwner||''):'';
  if(ownerRecord&&outboxOwner&&ownerRecord.ownerUserId!==outboxOwner)return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_OWNER_CONFLICT',ownerRecord.ownerUserId,currentUserId,'dirty-outbox',block);
  if(generation&&!ownerRecord){const savedReaderOwner=savedEntityReaderUserId(scope),legacyOwner=validEntityRecoveryUserId(savedReaderOwner)?savedReaderOwner:outboxOwner;if(!validEntityRecoveryUserId(legacyOwner))return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_OWNER_UNKNOWN','',currentUserId,'legacy-dirty',block);if(legacyOwner!==currentUserId)return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_USER_MISMATCH',legacyOwner,currentUserId,'legacy-dirty',block);if(savedReaderOwner&&outboxOwner&&outboxOwner!==savedReaderOwner)return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_OWNER_CONFLICT',outboxOwner,currentUserId,'legacy-dirty-outbox',block);ownerUserId=legacyOwner}
  if(ownerUserId&&ownerUserId!==currentUserId)return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_USER_MISMATCH',ownerUserId,currentUserId,'dirty',block);
  const journalOwner=String(journalOwnerUserId||'');if(journalOwnerUserId!==null){if(journalOwner){if(!validEntityRecoveryUserId(journalOwner))return entityRecoveryOwnershipFailure('ENTITY_RECOVERY_JOURNAL_OWNER_CORRUPT','',currentUserId,'journal',block);if(journalOwner!==currentUserId)return entityRecoveryOwnershipFailure('ENTITY_RECOVERY_JOURNAL_OWNER_MISMATCH',journalOwner,currentUserId,'journal',block);if(ownerUserId&&ownerUserId!==journalOwner)return entityRecoveryOwnershipFailure('ENTITY_LOCAL_RECOVERY_OWNER_CONFLICT',ownerUserId,currentUserId,'journal-dirty',block)}else if(legacyJournal){const legacyOwner=ownerUserId||savedEntityReaderUserId(scope);if(!validEntityRecoveryUserId(legacyOwner))return entityRecoveryOwnershipFailure('ENTITY_RECOVERY_JOURNAL_OWNER_UNKNOWN','',currentUserId,'legacy-journal',block);if(legacyOwner!==currentUserId)return entityRecoveryOwnershipFailure('ENTITY_RECOVERY_JOURNAL_OWNER_MISMATCH',legacyOwner,currentUserId,'legacy-journal',block);ownerUserId=legacyOwner}}
  if(generation&&!ownerRecord&&adoptLegacyOwner)writeEntityDirtyOwner(ownerUserId,scope);return{ownerUserId:ownerUserId||journalOwner||outboxOwner||'',currentUserId,scope}
}
function entityDirtyGeneration(scope=cloudSyncState.scope||entityScope()){try{const value=Number(localStorage.getItem(entityDirtyStorageKey(scope))||0);return Number.isSafeInteger(value)&&value>0?value:0}catch{return Number.MAX_SAFE_INTEGER}}
function durableEntityDirty(scope=cloudSyncState.scope||entityScope()){return entityDirtyGeneration(scope)>0}
function persistEntityDirty(value,scope=cloudSyncState.scope||entityScope()){
  try{
    const queue=scope===cloudSyncState.scope?cloudSyncState.outbox:null,currentUserId=currentEntityUserId(),currentGeneration=entityDirtyGeneration(scope),protectedEntries=entityProtectedOutboxEntries(queue);
    if(value){if(currentGeneration||protectedEntries.length)assertEntityRecoveryOwnership({scope,queue,block:false});writeEntityDirtyOwner(currentUserId,scope);const next=currentGeneration>=Number.MAX_SAFE_INTEGER?1:currentGeneration+1;localStorage.setItem(entityDirtyStorageKey(scope),String(next));return true}
    if(protectedEntries.length)throw outboxError('ENTITY_DIRTY_CLEAR_WITH_ACTIVE_OUTBOX','Нельзя очистить признак локальных изменений, пока очередь не подтверждена.');if(currentGeneration)assertEntityRecoveryOwnership({scope,queue,block:false});localStorage.removeItem(entityDirtyStorageKey(scope));localStorage.removeItem(entityDirtyOwnerStorageKey(scope));if(cloudSyncState.scope===scope){cloudSyncState.dirtyOwnerUserId='';cloudSyncState.dirtyOwnerError=null}return true
  }catch(error){if(value||error?.code)throw error instanceof Error?error:outboxError('ENTITY_DIRTY_JOURNAL_WRITE_FAILED','Не удалось изменить журнал локальных данных.');return false}
}
function prearmEntityDirty(scope=cloudSyncState.scope||entityScope()){
  const previousGeneration=entityDirtyGeneration(scope);persistEntityDirty(true,scope);const armedGeneration=entityDirtyGeneration(scope);if(!armedGeneration||armedGeneration===previousGeneration)throw outboxError('ENTITY_DIRTY_JOURNAL_WRITE_FAILED','Не удалось заранее зафиксировать локальную операцию на диске.');beginLogicalScopeFlight(cloudSyncState.ordinaryPrearms,scope);return{scope,previousGeneration,armedGeneration,serial:cloudSyncState.serial,active:true}
}
function releaseEntityDirtyPrearm(prearm){if(!prearm?.active)return false;prearm.active=false;endLogicalScopeFlight(cloudSyncState.ordinaryPrearms,prearm.scope);return true}
function ordinaryEntityPrearmCount(scope=cloudSyncState.scope||entityScope()){return cloudSyncState.ordinaryPrearms.get(scope)||0}
function ordinaryEntityPrearmTotal(){let count=0;for(const value of cloudSyncState.ordinaryPrearms.values())count+=Number(value)||0;return count}
function clearUnusedEntityDirtyPrearm(prearm,queue=requireLocalOutbox()){
  releaseEntityDirtyPrearm(prearm);
  if(!prearm||prearm.previousGeneration>0||entityDirtyGeneration(prearm.scope)!==prearm.armedGeneration||queue.status().active>0||cloudSyncState.serial!==prearm.serial)return false;
  const cleared=persistEntityDirty(false,prearm.scope);if(cleared&&cloudSyncState.scope===prearm.scope)cloudSyncState.dirty=false;return cleared
}
function settleEntityDirty(scope,queue,{generationAtStart,serialAtStart,updateCurrent=true}={}){
  const dirty=queue.status().active>0||entityDirtyGeneration(scope)!==generationAtStart||cloudSyncState.serial!==serialAtStart||ordinaryEntityPrearmCount(scope)>0;if(!dirty)persistEntityDirty(false,scope);else if(!durableEntityDirty(scope))persistEntityDirty(true,scope);if(updateCurrent&&cloudSyncState.scope===scope)cloudSyncState.dirty=dirty;return dirty
}
function outboxError(code,message,details={}){return Object.assign(new Error(message),{code,details})}
function localOutboxDeviceId(){
  const authenticated=String(currentUser?.deviceId||desktopSession?.auth?.device_id||desktopSession?.auth?.deviceId||'').trim();if(authenticated)return authenticated;
  const key='jf.local-device-id.v1';try{const saved=String(localStorage.getItem(key)||'').trim();if(saved)return saved;const created=`desktop:${newEntityCommandId().split(':').slice(2).join(':')}`;localStorage.setItem(key,created);return created}catch{return'desktop:unavailable'}
}
function onlineEntitySyncAvailable(){return!provisionalNativeWarehouseIdV784()&&!desktopSession?.auth?.offline&&Boolean(desktopSession?.auth?.company?.data_service)&&typeof window.JustFunDesktop?.regVps?.syncEntities==='function'}
function renderLocalOutboxStatus(){
  const badge=q('#jfOutboxState');if(!badge||isTrainingEnvironment())return;
  const interactive=active=>{if(!badge.dataset.jfConflictDialog){badge.dataset.jfConflictDialog='1';badge.addEventListener('click',()=>{if(Number(badge.dataset.conflicts||0)>0)openOutboxConflictDialog(badge).catch(error=>toast(error?.message||String(error),'error'))});badge.addEventListener('keydown',event=>{if(Number(badge.dataset.conflicts||0)<=0||!['Enter',' '].includes(event.key))return;event.preventDefault();openOutboxConflictDialog(badge).catch(error=>toast(error?.message||String(error),'error'))})}badge.dataset.conflicts=active?'1':'0';if(active){badge.tabIndex=0;badge.setAttribute('role','button');badge.setAttribute('aria-haspopup','dialog');badge.setAttribute('aria-label','Открыть список конфликтов синхронизации')}else{badge.tabIndex=-1;badge.removeAttribute('role');badge.removeAttribute('aria-haspopup');badge.removeAttribute('aria-label')}};
  if(cloudSyncState.outboxError||cloudSyncState.outbox?.isCorrupt?.()){interactive(false);badge.className='jf-outbox-state error';badge.textContent='Ошибка локальной очереди';badge.title=String(cloudSyncState.outboxError?.message||cloudSyncState.outbox?.corruption?.()?.message||'Outbox недоступен');return}
  const state=cloudSyncState.outbox?.status?.();if(!state){interactive(false);badge.className='jf-outbox-state pending';badge.textContent='Локальная очередь запускается';return}
  if(state.conflict||state.rejectedActive){interactive(state.conflict>0);badge.className='jf-outbox-state error';badge.textContent=`Требуют решения: ${state.conflict+state.rejectedActive}`;badge.title=state.conflict?'Нажмите, чтобы сравнить локальные и серверные версии.':'Локальные данные сохранены, но сервер отклонил часть изменений.';return}
  if(state.resolutionPending){interactive(false);badge.className='jf-outbox-state error';badge.textContent='Восстанавливается выбранная версия';badge.title='Выбор записан на диске. Локальная база должна завершить безопасное восстановление перед продолжением работы.';return}
  interactive(false);
  if(state.pending||state.sending){badge.className='jf-outbox-state pending';badge.textContent=`Ожидают синхронизации: ${state.pending+state.sending}`;badge.title='Изменения надёжно сохранены на этом компьютере и будут отправлены с теми же command_id.';return}
  badge.className='jf-outbox-state ready';badge.textContent='Локальные данные сохранены';badge.title='Несинхронизированных изменений нет.'
}
const CONFLICT_SECRET_KEY=/(?:password|passwd|secret|token|authorization|cookie|credential|private.?key|api.?key|license.?key|lease)/i;
let outboxConflictDialogOpener=null,outboxConflictDialogBusy=false;
function conflictSafeValue(value,depth=0){
  if(depth>5)return'[скрыто: слишком глубокая структура]';if(value===null||['boolean','number'].includes(typeof value))return value;if(typeof value==='string')return value.length>600?`${value.slice(0,600)}…`:value;if(Array.isArray(value))return value.slice(0,40).map(item=>conflictSafeValue(item,depth+1));if(value&&typeof value==='object'){const result={};for(const key of Object.keys(value).sort().slice(0,80))result[key]=CONFLICT_SECRET_KEY.test(key)?'[скрыто]':conflictSafeValue(value[key],depth+1);return result}return String(value)
}
function conflictJson(value){let text;try{text=JSON.stringify(conflictSafeValue(value),null,2)}catch{text='Технические данные недоступны.'}return text.length>12000?`${text.slice(0,12000)}\n… данные сокращены`:text}
function conflictEntityLabel(type){return({warehouse:'Склад',orders:'Заказ',products:'Товар',inventoryMovements:'Движение товара',drivers:'Водитель',settings:'Настройки',company:'Компания',reportingData:'Отчётность',routePlans:'План рейса',routeAssignments:'Назначение рейса',routeCatalog:'Рейс',routeDriverAssignments:'Водитель рейса',routeLocks:'Фиксация рейса',routeOverrides:'Настройка рейса',routeExecutions:'Выполнение рейса',routeArchives:'Архив рейса',warehouseReservations:'Резерв склада',manualRouteSequences:'Порядок точек'})[String(type)]||'Запись'}
function conflictFriendlySummary(type,id,payload,deleted=false){
  if(deleted)return{title:`${conflictEntityLabel(type)} удалён на этой стороне`,lines:[`Идентификатор: ${id}`]};const value=asObject(payload),first=(...keys)=>{for(const key of keys){const item=value[key];if(item!==undefined&&item!==null&&String(item).trim())return String(item)}return''},lines=[];let title='';
  if(type==='orders'){title=first('number','orderNumber','title')||`Заказ ${id}`;const contact=first('contactName','customerName','clientName'),address=first('deliveryAddress','address'),status=first('fulfillmentStatus','warehouseFlowStatus','status');if(contact)lines.push(`Клиент: ${contact}`);if(address)lines.push(`Адрес: ${address}`);if(status)lines.push(`Состояние: ${status}`)}
  else if(type==='products'){title=first('name','title')||`Товар ${id}`;const article=first('article','sku','barcode'),place=first('binLocation','location'),category=first('category');if(article)lines.push(`Артикул: ${article}`);if(category)lines.push(`Категория: ${category}`);if(place)lines.push(`Место хранения: ${place}`)}
  else if(type==='drivers'){title=first('name','fullName')||`Водитель ${id}`;const phone=first('phone'),vehicle=[first('brand'),first('model'),first('plate')].filter(Boolean).join(' ');if(phone)lines.push(`Телефон: ${phone}`);if(vehicle)lines.push(`Автомобиль: ${vehicle}`)}
  else if(type==='warehouse'){title=first('name','title')||`Склад ${id}`;const code=first('code'),address=first('address'),status=first('status');if(code)lines.push(`Код: ${code}`);if(address)lines.push(`Адрес: ${address}`);if(status)lines.push(`Состояние: ${status}`)}
  else if(type==='company'){title=first('name','legalName','title')||'Данные компании'}
  else{title=first('name','title','number','label')||`${conflictEntityLabel(type)} ${id}`;const status=first('status','state','stage');if(status)lines.push(`Состояние: ${status}`)}
  const updated=first('updatedAt','updated_at');if(updated)lines.push(`Изменено: ${updated}`);return{title,lines:lines.slice(0,5)}
}
function conflictTarget(queue,entry){
  const keys=asArray(queue?.conflictEntityKeys?.(entry?.commandId));if(keys.length!==1)return{ambiguous:true,keys};const key=String(keys[0]),split=key.indexOf(':'),type=key.slice(0,split),id=key.slice(split+1),matches=asArray(entry?.changes).filter(change=>change.type===type&&change.id===id);return matches.length===1?{ambiguous:false,key,type,id,change:matches[0]}:{ambiguous:true,keys}
}
function conflictDetails(entry){return asObject(entry?.lastError?.details)}
function conflictCurrentVersion(entry){const details=conflictDetails(entry),value=Number(details.current_version??details.remoteVersion);return Number.isSafeInteger(value)&&value>=0?value:null}
function declaredConflictKey(entry){const details=conflictDetails(entry),type=String(details.entity_type||details.type||''),id=String(details.entity_id||details.id||'');if(type&&id)return entityKey(type,id);const changes=asArray(entry?.changes);return changes.length===1?entityKey(changes[0].type,changes[0].id):''}
function ensureOutboxConflictDialog(){
  let overlay=q('#jfOutboxConflictDialog');if(overlay)return overlay;overlay=document.createElement('div');overlay.id='jfOutboxConflictDialog';overlay.className='jf-dialog-overlay jf-conflict-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','jfConflictTitle');overlay.innerHTML='<section class="jf-dialog jf-conflict-dialog"><header class="jf-conflict-head"><div><span>Синхронизация данных</span><h2 id="jfConflictTitle">Разрешение конфликтов</h2><p>Сравните версии и явно выберите, какие данные должны остаться.</p></div><button type="button" class="jf-help-x" id="jfConflictClose" aria-label="Закрыть">×</button></header><div class="jf-conflict-toolbar"><p id="jfConflictStatus"></p><button type="button" class="btn-gray" id="jfConflictRefresh">Обновить с VPS</button></div><div class="jf-conflict-list" id="jfConflictList"></div><footer class="jf-dialog-actions"><button type="button" class="btn-gray" id="jfConflictDone">Закрыть</button></footer></section>';document.body.append(overlay);
  const close=()=>closeOutboxConflictDialog();q('#jfConflictClose',overlay).addEventListener('click',close);q('#jfConflictDone',overlay).addEventListener('click',close);q('#jfConflictRefresh',overlay).addEventListener('click',()=>refreshOutboxConflictDialog().catch(error=>renderOutboxConflictDialogError(error)));overlay.addEventListener('click',event=>{if(event.target===overlay)close()});overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}});return overlay
}
function closeOutboxConflictDialog(){const overlay=q('#jfOutboxConflictDialog');if(!overlay||outboxConflictDialogBusy)return;overlay.classList.remove('open');const opener=outboxConflictDialogOpener;outboxConflictDialogOpener=null;if(opener?.isConnected)opener.focus()}
function renderConflictVersion(container,label,type,id,change,versionLabel){
  const panel=document.createElement('section');panel.className='jf-conflict-version';const heading=document.createElement('div');heading.className='jf-conflict-version-head';const strong=document.createElement('strong');strong.textContent=label;const version=document.createElement('span');version.textContent=versionLabel;heading.append(strong,version);const summary=conflictFriendlySummary(type,id,change?.payload,change?.deleted===true),title=document.createElement('b');title.className='jf-conflict-summary-title';title.textContent=summary.title;panel.append(heading,title);for(const line of summary.lines){const row=document.createElement('p');row.textContent=line;panel.append(row)}const details=document.createElement('details'),detailsTitle=document.createElement('summary'),pre=document.createElement('pre');detailsTitle.textContent='Показать безопасные технические данные';pre.textContent=conflictJson(change?.deleted===true?{deleted:true}:change?.payload);details.append(detailsTitle,pre);panel.append(details);container.append(panel)
}
function renderOutboxConflictDialogError(error){const status=q('#jfConflictStatus');if(status){status.className='error';status.textContent=error?.message||String(error)}const refresh=q('#jfConflictRefresh');if(refresh)refresh.disabled=false}
async function fetchConflictRemoteBundle(queue,entries){
  if(!onlineEntitySyncAvailable())throw outboxError('CONFLICT_SERVER_OFFLINE','Для сравнения версий восстановите подключение к VPS. Локальные данные сохранены.');resetEntityScope();const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,warehouseId=activeWarehouseId(),environment=activeEnvironment();assertEntityRecoveryOwnership({scope:expectedScope,queue});const result=await window.JustFunDesktop.regVps.bootstrapEntities({warehouseId,environment});assertEntityScope(expectedScope,expectedEpoch);if(!result?.ok)throw outboxError(String(result?.code||'CONFLICT_BOOTSTRAP_FAILED'),String(result?.error||'VPS не вернул актуальные записи.'));const readable=new Set(asArray(result.readableTypes).map(String)),entities=new Map();for(const raw of asArray(result.entities)){const entity=canonicalServerEntity(raw);entities.set(entityKey(entity.type,entity.id),{type:entity.type,id:entity.id,version:Number(entity.version),digest:String(entity.digest_sha256||entity.digest||''),eventId:Number(entity.event_id||entity.eventId||0),deleted:false,payload:cloneValue(entity.payload)})}return{scope:expectedScope,epoch:expectedEpoch,warehouseId,environment,readable,entities,entries}
}
function remoteConflictState(bundle,entry,target,change=target.change){
  if(target.type!=='warehouse'&&!bundle.readable.has(target.type))throw outboxError('CONFLICT_ENTITY_NOT_READABLE',`Сервер больше не разрешает читать запись ${target.type}/${target.id}. Разрешение остановлено без удаления локальных данных.`);const current=bundle.entities.get(target.key);if(current){if(!Number.isSafeInteger(current.version)||current.version<0||current.version>0&&!/^[a-f0-9]{64}$/i.test(String(current.digest||'')))throw outboxError('CONFLICT_REMOTE_VERSION_INVALID',`VPS вернул некорректную версию ${target.type}/${target.id}. Локальная команда оставлена без изменений.`);return current}const isDeclaredTarget=target.key===declaredConflictKey(entry),declared=isDeclaredTarget?conflictCurrentVersion(entry):null,base=Number(change?.baseVersion);if(isDeclaredTarget&&declared===null)throw outboxError('CONFLICT_REMOTE_VERSION_UNKNOWN',`VPS не подтвердил актуальную версию конфликтной записи ${target.type}/${target.id}. Локальная команда оставлена без изменений.`);const version=isDeclaredTarget?declared:(base===0?0:null),digest=String(conflictDetails(entry).current_digest_sha256||'');if(version===null||version>0&&!/^[a-f0-9]{64}$/i.test(digest))throw outboxError('CONFLICT_REMOTE_VERSION_UNKNOWN',`VPS не вернул актуальную версию ${target.type}/${target.id}. Локальная команда оставлена без изменений.`);return{type:target.type,id:target.id,version,digest,eventId:0,deleted:true,payload:null}
}
function remoteStateForChange(bundle,entry,change){const target={key:entityKey(change.type,change.id),type:String(change.type),id:String(change.id),change};return remoteConflictState(bundle,entry,target,change)}
function replacementChangesForConflict(queue,entry,target,bundle,strategy){
  const result=[];for(const change of asArray(entry.changes)){const key=entityKey(change.type,change.id),isTarget=key===target.key;if(isTarget&&strategy==='server')continue;const remote=isTarget?remoteConflictState(bundle,entry,target,change):remoteStateForChange(bundle,entry,change);result.push({...cloneValue(change),baseVersion:remote.version,_fingerprint:change.deleted===true?'':entityFingerprint(change.payload)})}const context={companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()};return requireWritableLocalEntityChanges(result,context,'conflict_resolution')
}
function normalizedConflictProjectionPayload(change,currentPayload){
  if(change?.deleted===true)return null;const payload=cloneValue(change?.payload);if(!payload||typeof payload!=='object'||Array.isArray(payload)||!currentPayload||typeof currentPayload!=='object'||Array.isArray(currentPayload))return payload;for(const field of['id','warehouseId','warehouse_id','environment'])if(!Object.prototype.hasOwnProperty.call(payload,field)&&Object.prototype.hasOwnProperty.call(currentPayload,field))payload[field]=cloneValue(currentPayload[field]);if(Object.prototype.hasOwnProperty.call(currentPayload,'createdAt'))payload.createdAt=cloneValue(currentPayload.createdAt);return payload
}
function advanceConflictProjection(projected,change){
  const deleted=change?.deleted===true,payload=normalizedConflictProjectionPayload(change,projected.payload),fingerprint=deleted?'':entityFingerprint(payload),unchanged=deleted===projected.deleted&&(deleted||fingerprint===projected.fingerprint);return{version:projected.version+(unchanged?0:1),deleted,payload,fingerprint}
}
function followingConflictRebases(queue,entry,bundle,replacementChanges){
  const entries=queue.list(),index=entries.findIndex(item=>item.commandId===entry.commandId);if(index<0)throw outboxError('OUTBOX_CONFLICT_STATE_CHANGED','Конфликтная команда исчезла из очереди. Обновите список.');const originals=asArray(entry.changes),keys=originals.map(change=>entityKey(change.type,change.id)),affected=new Set(keys);if(affected.size!==keys.length)throw outboxError('OUTBOX_DUPLICATE_ENTITY','Конфликтная команда содержит одну запись несколько раз. Автоматическое разрешение остановлено.');
  const projected=new Map();for(const change of originals){const remote=remoteStateForChange(bundle,entry,change);projected.set(entityKey(change.type,change.id),{version:remote.version,deleted:remote.deleted===true,payload:cloneValue(remote.payload),fingerprint:remote.deleted?'':entityFingerprint(remote.payload)})}
  for(const change of replacementChanges){const key=entityKey(change.type,change.id),current=projected.get(key);if(!current||Number(change.baseVersion)!==current.version)throw outboxError('OUTBOX_REBASE_REPLACEMENT_INVALID','Повторная команда не соответствует актуальной серверной версии.');projected.set(key,advanceConflictProjection(current,change))}
  const plans=[];for(let position=0;position<entries.length;position++){const candidate=entries[position];if(candidate.commandId===entry.commandId)continue;const candidateChanges=asArray(candidate.changes),touched=candidateChanges.filter(change=>affected.has(entityKey(change.type,change.id)));if(!touched.length||candidate.state==='confirmed'||candidate.state==='rejected'&&candidate.preserveLocal===false)continue;if(position<index)throw outboxError('OUTBOX_REBASE_ORDER_UNSAFE','Перед конфликтом осталась более ранняя активная команда той же записи. Сначала требуется безопасное восстановление очереди.');if(candidate.state!=='pending'||candidate.preserveLocal===false||Number(candidate.attempts)!==0||candidate.lastError)throw outboxError('OUTBOX_REBASE_SEND_STATE_UNKNOWN','Следующая команда этой записи уже могла отправляться. Автоматическое разрешение остановлено; локальные данные сохранены.');const denied=candidateChanges.find(change=>!canWriteEntity(change.type));if(denied)throw outboxError('OUTBOX_REBASE_PERMISSION_REVOKED',`Текущая роль больше не разрешает изменять ${denied.type}/${denied.id}. Автоматическое разрешение остановлено; очередь не изменена.`);const touchedKeys=touched.map(change=>entityKey(change.type,change.id));if(new Set(touchedKeys).size!==touchedKeys.length)throw outboxError('OUTBOX_REBASE_DUPLICATE_ENTITY','Следующая команда содержит одну запись несколько раз. Автоматическое разрешение остановлено.');const changes=[];for(const change of touched){const key=entityKey(change.type,change.id),current=projected.get(key);if(!current)throw outboxError('OUTBOX_REBASE_STATE_UNKNOWN','Не удалось восстановить последовательность версий записи.');changes.push({type:change.type,id:change.id,baseVersion:current.version});projected.set(key,advanceConflictProjection(current,change))}plans.push({commandId:candidate.commandId,changes})}return plans
}
async function captureConflictResolutionSnapshot(queue,scope,epoch,context,{serverEntities=[]}={}){
  clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=null;const persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();assertEntityScope(scope,epoch);if(persisted===false||window.__warehousePersistenceCritical)throw outboxError('CONFLICT_LOCAL_CAPTURE_NOT_DURABLE','Последнее локальное изменение ещё не подтверждено диском. Выбор версии остановлен без изменения очереди.');const captured=enqueueBackgroundSnapshot(queue,cloneValue(buildBackupPayload()),{knownEntities:new Map(cloudSyncState.known),conflicts:new Map(),context,kind:'conflict_resolution_local_capture',serverEntities});if(captured){cloudSyncState.serial++;cloudSyncState.dirty=true;audit('conflict_resolution_local_snapshot_saved',{changes:captured,warehouseId:context.warehouseId,environment:context.environment})}if(!durableEntityDirty(scope))persistEntityDirty(true,scope);cloudSyncState.dirty=true;renderLocalOutboxStatus();return{generationAtStart:entityDirtyGeneration(scope),serialAtStart:cloudSyncState.serial,captured}
}
function blockConflictResolutionRecovery(error){
  const existing=cloudSyncState.contextBlockedError,blocked=existing||outboxError('CONFLICT_RESOLUTION_RECOVERY_REQUIRED','Выбор версии надёжно сохранён, но локальная база не завершила его применение. Рабочее пространство заблокировано до перезапуска и автоматического восстановления.',{cause:String(error?.message||error)});cloudSyncState.contextBlockedError=blocked;cloudSyncState.scopeEpoch++;cloudSyncState.bootstrapPromise=null;cloudSyncState.bootstrapped=false;freezeWorkspaceForWarehouseTransition();cloudSyncState.dirty=true;renderNoWarehouse(blocked.message);return blocked
}
async function resolveOutboxConflict(commandId,type,id,strategy){
  if(outboxConflictDialogBusy)return;outboxConflictDialogBusy=true;const overlay=ensureOutboxConflictDialog();overlay.classList.add('busy');let outboxCommitted=false,resolutionScope='',resolutionEpoch=null,resolutionFlight=false;
  try{
    if(strategy!=='server'&&strategy!=='local')throw outboxError('OUTBOX_CONFLICT_STRATEGY_INVALID','Неизвестный способ разрешения конфликта. Локальные данные не изменены.');resetEntityScope();if(cloudSyncState.contextBlockedError)throw cloudSyncState.contextBlockedError;resolutionScope=cloudSyncState.scope;resolutionEpoch=cloudSyncState.scopeEpoch;await waitForEntitySyncIdle();assertEntityScope(resolutionScope,resolutionEpoch);beginEntityInFlight(resolutionScope);resolutionFlight=true;const queue=requireLocalOutbox();assertEntityRecoveryOwnership({scope:resolutionScope,queue});if(typeof queue.resolveConflict!=='function'||typeof queue.pendingServerResolutions!=='function'||typeof queue.markResolutionApplied!=='function')throw outboxError('OUTBOX_CONFLICT_RESOLVER_MISSING','Модуль безопасного разрешения конфликтов не загружен.');if(queue.status().resolutionPending)throw outboxError('OUTBOX_RESOLUTION_RECOVERY_PENDING','Сначала завершите восстановление ранее выбранной серверной версии.');let entry=queue.get(commandId),target=conflictTarget(queue,entry);if(!entry||target.ambiguous||target.type!==String(type)||target.id!==String(id))throw outboxError('OUTBOX_CONFLICT_STATE_CHANGED','Конфликт изменился. Обновите список перед выбором.');const context={companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()},bundle=await fetchConflictRemoteBundle(queue,[entry]);assertEntityScope(resolutionScope,resolutionEpoch);const dirtyToken=await captureConflictResolutionSnapshot(queue,resolutionScope,resolutionEpoch,context,{serverEntities:[...bundle.entities.values()]});assertEntityScope(resolutionScope,resolutionEpoch);entry=queue.get(commandId);target=conflictTarget(queue,entry);if(!entry||target.ambiguous||target.type!==String(type)||target.id!==String(id))throw outboxError('OUTBOX_CONFLICT_STATE_CHANGED','Конфликт изменился во время сохранения последних локальных данных. Обновите список.');const remote=remoteConflictState(bundle,entry,target);if(strategy==='server'&&target.type==='warehouse'&&remote.deleted)throw outboxError('WAREHOUSE_CONFLICT_DELETE_REQUIRES_RELOAD','Склад удалён на сервере. Закройте это окно и повторите проверку доступных складов. Локальная команда не удалена.');const replacementChanges=replacementChangesForConflict(queue,entry,target,bundle,strategy),followingRebases=followingConflictRebases(queue,entry,bundle,replacementChanges),replacementCommandId=replacementChanges.length?newEntityCommandId():'';
    assertEntityScope(resolutionScope,resolutionEpoch);queue.resolveConflict(commandId,{type:target.type,id:target.id,strategy,replacementCommandId,replacementChanges,followingRebases,serverResult:{type:target.type,id:target.id,version:remote.version,digest:remote.digest,eventId:remote.eventId,deleted:remote.deleted===true,payload:cloneValue(remote.payload)}});outboxCommitted=true;
    if(strategy==='server'){const nextSnapshot=cloneValue(buildBackupPayload()),markers=[];overlayLocalOutbox(nextSnapshot,queue,{resolutionMarkers:markers});if(!markers.some(marker=>marker.commandId===commandId))throw outboxError('CONFLICT_RESOLUTION_MARKER_MISSING','Журнал выбранной серверной версии не найден после записи outbox.');assertEntityScope(resolutionScope,resolutionEpoch);cloudSyncState.suspended++;try{const imported=await window.TeplitsaWarehouseV600?.importServerSnapshot?.(nextSnapshot),persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();assertEntityScope(resolutionScope,resolutionEpoch);if(imported===false||persisted===false||window.__warehousePersistenceCritical)throw outboxError('CONFLICT_REMOTE_APPLY_NOT_DURABLE','Выбор записан в очередь, но серверная версия ещё не подтверждена локальным диском.');rememberLocalEntityBaseline(nextSnapshot);rememberObservedEntitySnapshot(nextSnapshot)}finally{cloudSyncState.suspended--}}
    assertEntityScope(resolutionScope,resolutionEpoch);cloudSyncState.conflicts.delete(target.key);cloudSyncState.known.set(target.key,{version:remote.version,digest:remote.digest,fingerprint:remote.deleted?'':semanticEntityFingerprintV784(remote.type,remote.id,remote.payload,context),deleted:remote.deleted===true,eventId:remote.eventId});if(strategy!=='server'){const current=cloneValue(buildBackupPayload());rememberLocalEntityBaseline(current);rememberObservedEntitySnapshot(current)}saveEntitySyncState({required:true});assertEntityScope(resolutionScope,resolutionEpoch);if(strategy==='server')queue.markResolutionApplied(commandId);settleEntityDirty(resolutionScope,queue,dirtyToken);window.renderAll?.();renderLocalOutboxStatus();audit('entity_conflict_resolved',{strategy,type:target.type,id:target.id,oldCommandId:commandId,newCommandId:replacementCommandId||'',remainingChanges:replacementChanges.length,rebasedCommands:followingRebases.length,serverVersion:remote.version});if(queue.status().pending)scheduleOutboxDrain(0);toast(strategy==='server'?'Принята серверная версия. Более поздние локальные изменения сохранены в очереди.':'Локальная версия поставлена в новую очередь с актуальной версией VPS.','success');await refreshOutboxConflictDialog()
  }catch(error){const reported=outboxCommitted?blockConflictResolutionRecovery(error):error;renderOutboxConflictDialogError(reported);toast(reported?.message||String(reported),'error')}finally{if(resolutionFlight)endEntityInFlight(resolutionScope,resolutionEpoch);outboxConflictDialogBusy=false;overlay.classList.remove('busy')}
}
function renderConflictCard(list,queue,entry,bundle){
  const target=conflictTarget(queue,entry),card=document.createElement('article');card.className='jf-conflict-card';if(target.ambiguous){const title=document.createElement('h3');title.textContent='Команда содержит неоднозначный конфликт';const note=document.createElement('p');note.className='jf-conflict-card-error';note.textContent='Сервер не указал единственную конфликтную запись. Автоматическое разбиение запрещено; локальные данные сохранены.';card.append(title,note);list.append(card);return}
  const head=document.createElement('header'),name=document.createElement('div'),kind=document.createElement('span'),title=document.createElement('h3');kind.textContent=conflictEntityLabel(target.type);title.textContent=target.id;name.append(kind,title);const command=document.createElement('code');command.textContent=entry.commandId;head.append(name,command);card.append(head);let remote=null,error=null;try{remote=remoteConflictState(bundle,entry,target)}catch(caught){error=caught}const versions=document.createElement('div');versions.className='jf-conflict-versions';renderConflictVersion(versions,'На этом компьютере',target.type,target.id,target.change,`база v${Number(target.change.baseVersion)||0}`);if(remote)renderConflictVersion(versions,'Сейчас на VPS',target.type,target.id,{payload:remote.payload,deleted:remote.deleted},`версия v${remote.version}`);else renderConflictVersion(versions,'Сейчас на VPS',target.type,target.id,{payload:{message:error?.message||'Версия недоступна'},deleted:false},'не получена');card.append(versions);if(error){const note=document.createElement('p');note.className='jf-conflict-card-error';note.textContent=error.message;card.append(note)}const actions=document.createElement('div');actions.className='jf-conflict-actions';const server=document.createElement('button'),local=document.createElement('button');server.type=local.type='button';server.className='btn-gray';local.className='btn-primary';server.textContent='Принять серверную';local.textContent='Оставить мою';server.disabled=local.disabled=Boolean(error);server.addEventListener('click',()=>resolveOutboxConflict(entry.commandId,target.type,target.id,'server'));local.addEventListener('click',()=>resolveOutboxConflict(entry.commandId,target.type,target.id,'local'));actions.append(server,local);card.append(actions);list.append(card)
}
async function refreshOutboxConflictDialog(){
  const overlay=ensureOutboxConflictDialog(),list=q('#jfConflictList',overlay),status=q('#jfConflictStatus',overlay),refresh=q('#jfConflictRefresh',overlay);list.replaceChildren();status.className='';status.textContent='Получаем актуальные серверные версии…';refresh.disabled=true;resetEntityScope();const queue=requireLocalOutbox();assertEntityRecoveryOwnership({queue});const entries=queue.list('conflict').filter(entry=>entry.preserveLocal!==false);if(!entries.length){status.textContent='Неразрешённых конфликтов нет.';renderLocalOutboxStatus();refresh.disabled=false;return}try{const bundle=await fetchConflictRemoteBundle(queue,entries);status.textContent=`Конфликтов: ${entries.length}. Данные показаны для текущего склада и пользователя.`;for(const entry of entries)renderConflictCard(list,queue,entry,bundle)}catch(error){status.className='error';status.textContent=error?.message||String(error);for(const entry of entries)renderConflictCard(list,queue,entry,{readable:new Set(),entities:new Map()})}finally{refresh.disabled=false}
}
async function openOutboxConflictDialog(opener=null){const overlay=ensureOutboxConflictDialog();outboxConflictDialogOpener=opener||document.activeElement;overlay.classList.add('open');q('#jfConflictClose',overlay)?.focus();await refreshOutboxConflictDialog()}
function rememberLocalEntityBaseline(snapshot=null){try{cloudSyncState.localBaseline=cloneValue(snapshot||buildBackupPayload())}catch{cloudSyncState.localBaseline=null}}
function entityScopeIsCurrent(expectedScope,expectedEpoch){return cloudSyncState.scope===expectedScope&&cloudSyncState.scopeEpoch===expectedEpoch&&entityScope()===expectedScope}
function assertEntityScope(expectedScope,expectedEpoch){if(!entityScopeIsCurrent(expectedScope,expectedEpoch))throw outboxError('ENTITY_SCOPE_CHANGED','Контекст компании или склада изменился во время синхронизации. Устаревший ответ VPS отброшен.')}
function entityFlightKey(scope,epoch){return`${scope}\u0000${epoch}`}
function beginEntityBootstrapFlight(scope,epoch){const key=entityFlightKey(scope,epoch);cloudSyncState.bootstrapFlights.set(key,(cloudSyncState.bootstrapFlights.get(key)||0)+1)}
function endEntityBootstrapFlight(scope,epoch){const key=entityFlightKey(scope,epoch),left=(cloudSyncState.bootstrapFlights.get(key)||0)-1;if(left>0)cloudSyncState.bootstrapFlights.set(key,left);else cloudSyncState.bootstrapFlights.delete(key)}
function currentEntityBootstrapInFlight(){return cloudSyncState.bootstrapFlights.get(entityFlightKey(cloudSyncState.scope,cloudSyncState.scopeEpoch))||0}
function beginLogicalScopeFlight(map,scope){map.set(scope,(map.get(scope)||0)+1)}
function endLogicalScopeFlight(map,scope){const left=(map.get(scope)||0)-1;if(left>0)map.set(scope,left);else map.delete(scope)}
function beginEntityInFlight(scope){beginLogicalScopeFlight(cloudSyncState.inFlightScopes,scope)}
function endEntityInFlight(scope){endLogicalScopeFlight(cloudSyncState.inFlightScopes,scope)}
function currentEntityInFlight(){return(cloudSyncState.inFlightScopes.get(cloudSyncState.scope)||0)>0}
function beginCriticalEntityFlight(scope){beginLogicalScopeFlight(cloudSyncState.criticalFlights,scope)}
function endCriticalEntityFlight(scope){endLogicalScopeFlight(cloudSyncState.criticalFlights,scope)}
function criticalEntityFlightCount(){let count=0;for(const value of cloudSyncState.criticalFlights.values())count+=Number(value)||0;return count}
function beginOrdinaryEntityFlight(scope){beginLogicalScopeFlight(cloudSyncState.ordinaryFlights,scope)}
function endOrdinaryEntityFlight(scope){endLogicalScopeFlight(cloudSyncState.ordinaryFlights,scope)}
function ordinaryEntityFlightCount(){let count=0;for(const value of cloudSyncState.ordinaryFlights.values())count+=Number(value)||0;return count}
function assertEntityContextChangeAllowed(detail={}){if(cloudSyncState.contextBlockedError)throw cloudSyncState.contextBlockedError;const state=cloudSyncState.outbox?.status?.();if(Number(state?.resolutionPending||0)>0)throw outboxError('ENTITY_CONFLICT_RECOVERY_REQUIRED','Сначала завершите применение уже выбранной серверной версии. Любые новые изменения и смена контекста временно остановлены.',detail);if(String(detail?.kind||'')!=='business-mutation'){if(outboxConflictDialogBusy)throw outboxError('ENTITY_CONFLICT_RESOLUTION_IN_FLIGHT','Дождитесь завершения выбора версии. Смена склада, режима или выход временно остановлены.',detail);if(cloudSyncState.outboxError)throw cloudSyncState.outboxError;if(Number(state?.conflict||0)>0||cloudSyncState.conflicts.size>0)throw outboxError('ENTITY_CONFLICTS_REQUIRE_RESOLUTION','Смена склада, режима или выход остановлены: сначала разрешите все конфликты и завершите применение выбранной версии.',{...asObject(detail),conflicts:Math.max(Number(state?.conflict||0),cloudSyncState.conflicts.size)})}if(criticalEntityFlightCount()>0)throw outboxError('ENTITY_CRITICAL_OPERATION_IN_FLIGHT','Дождитесь подтверждения критической операции сервером. Смена склада, режима или выход временно остановлены.',detail);if(ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0)throw outboxError('ENTITY_ORDINARY_OPERATION_IN_FLIGHT','Дождитесь сохранения текущего изменения. Смена склада, режима или выход временно остановлены.',detail)}
function requireLocalOutbox(){resetEntityScope();if(cloudSyncState.outboxError)throw cloudSyncState.outboxError;if(!cloudSyncState.outbox)throw outboxError('OUTBOX_UNAVAILABLE','Модуль локальной очереди не загружен. Изменение безопасно остановлено.');return cloudSyncState.outbox}
function resetEntityScope(){
  const scope=entityScope();if(cloudSyncState.scope===scope)return;
  clearTimeout(cloudSyncState.retryTimer);cloudSyncState.retryTimer=null;cloudSyncState.scope=scope;cloudSyncState.scopeEpoch++;cloudSyncState.bootstrapPromise=null;cloudSyncState.bootstrapped=false;cloudSyncState.cursor=0;cloudSyncState.known=new Map();cloudSyncState.conflicts=new Map();cloudSyncState.readableTypes=new Set();cloudSyncState.readerUserId='';cloudSyncState.dirtyOwnerUserId='';cloudSyncState.dirtyOwnerError=null;cloudSyncState.outbox=cloudSyncState.outboxes.get(scope)||null;cloudSyncState.outboxError=null;cloudSyncState.observedFingerprint='';
  try{const saved=JSON.parse(localStorage.getItem(entityStateStorageKey())||'{}');cloudSyncState.cursor=Number.isSafeInteger(Number(saved.cursor))?Number(saved.cursor):0;cloudSyncState.known=new Map(Object.entries(saved.entities||{}));cloudSyncState.conflicts=new Map(Object.entries(saved.conflicts||{}));cloudSyncState.readableTypes=new Set(asArray(saved.readableTypes).map(String));cloudSyncState.readerUserId=String(saved.readerUserId||'')}catch{}
  try{if(!cloudSyncState.outbox){const module=window.JustFunLocalOutboxV783;if(!module?.create||!module?.inspect)throw outboxError('OUTBOX_MODULE_MISSING','Модуль локальной очереди не загружен.');const inspected=module.inspect(localStorage,scope);assertEntityRecoveryOwnership({scope,queue:inspected,block:false,adoptLegacyOwner:false});cloudSyncState.outbox=module.create(localStorage,scope);if(cloudSyncState.outbox.isCorrupt())throw cloudSyncState.outbox.corruption();assertEntityRecoveryOwnership({scope,queue:cloudSyncState.outbox,block:false});cloudSyncState.outboxes.set(scope,cloudSyncState.outbox)}else assertEntityRecoveryOwnership({scope,queue:cloudSyncState.outbox,block:false})}catch(error){cloudSyncState.outbox=null;cloudSyncState.outboxError=error instanceof Error?error:outboxError('OUTBOX_INIT_FAILED',String(error))}
  cloudSyncState.dirty=Boolean(cloudSyncState.outbox&&!cloudSyncState.outboxError&&cloudSyncState.outbox.status().active)||durableEntityDirty(scope);if(cloudSyncState.dirty){try{cloudSyncState.dirtyOwnerUserId=String(readEntityDirtyOwner(scope)?.ownerUserId||'')}catch(error){cloudSyncState.dirtyOwnerError=error}}rememberLocalEntityBaseline();rememberObservedEntitySnapshot();renderLocalOutboxStatus();
}
function saveEntitySyncState({required=false}={}){
  resetEntityScope();
  try{const readerUserId=currentEntityUserId();localStorage.setItem(entityStateStorageKey(),JSON.stringify({cursor:cloudSyncState.cursor,entities:Object.fromEntries(cloudSyncState.known),conflicts:Object.fromEntries(cloudSyncState.conflicts),readableTypes:[...cloudSyncState.readableTypes],readerUserId,savedAt:new Date().toISOString()}));cloudSyncState.readerUserId=readerUserId;return true}catch(error){console.error('VPS entity state',error);if(required)throw outboxError('ENTITY_STATE_WRITE_FAILED','Подтверждение VPS получено, но его нельзя надёжно зафиксировать на этом компьютере. Команда будет повторена с тем же идентификатором.');return false}
}
function wrappedEntityPayload(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{__jf_wrapped_value:true,value}}
function unwrappedEntityPayload(value){return value?.__jf_wrapped_value===true?value.value:value}
function canonicalServerEntity(entity){
  const item={...asObject(entity)},type=String(item.type||''),id=String(item.id||''),deleted=item.operation==='delete'||item.deleted===true;
  if(deleted||!item.payload||typeof item.payload!=='object'||Array.isArray(item.payload))return item;
  const payload=cloneValue(item.payload),recordType=type==='warehouse'||ENTITY_ARRAY_SECTIONS.includes(type);
  if(!recordType)return{...item,payload};
  const declaredId=String(payload.id||'');if(declaredId&&declaredId!==id)throw new Error(`VPS вернул повреждённую запись ${type}/${id}: идентификатор не совпадает.`);
  payload.id=id;
  if(type==='warehouse'){
    const declaredEnvironment=String(payload.environment||'').toLowerCase();if(declaredEnvironment&&declaredEnvironment!==activeEnvironment())throw new Error('VPS вернул карточку склада из другой рабочей среды.');
    payload.environment=activeEnvironment();
  }else{
    const declaredWarehouse=String(payload.warehouseId||payload.warehouse_id||'');if(declaredWarehouse&&declaredWarehouse!==activeWarehouseId())throw new Error(`VPS вернул запись другого склада: ${type}/${id}.`);
    payload.warehouseId=activeWarehouseId();delete payload.warehouse_id;
  }
  if(!payload.createdAt&&(item.created_at||item.createdAt))payload.createdAt=String(item.created_at||item.createdAt);
  return{...item,payload}
}
function serverSettingsPayload(value,{initial=false}={}){
  const source=asObject(value),keys=[...ENTITY_SETTINGS_WAREHOUSE_FIELDS];
  if(!initial||hasPermission('routes.settings'))keys.push(...ENTITY_SETTINGS_ROUTE_FIELDS);
  if(!initial||hasPermission('integrations.manage'))keys.push(...ENTITY_SETTINGS_INTEGRATION_FIELDS);
  const payload={};for(const key of keys)if(Object.prototype.hasOwnProperty.call(source,key))payload[key]=cloneValue(source[key]);return payload
}
function splitEntitySnapshot(snapshot,{warehouseId=activeWarehouseId(),environment=activeEnvironment()}={}){
  warehouseId=String(warehouseId);environment=String(environment);const map=new Map(),data=asObject(snapshot?.data),warehouse=asObject(snapshot?.warehouse);
  // Unassigned automatic routes are render-time previews, not server entities.
  const referencedRouteIds=new Set([...Object.values(asObject(data.routeAssignments)),...Object.values(asObject(data.routeLocks)),...Object.keys(asObject(data.routePlans)),...Object.keys(asObject(data.routeDriverAssignments)),...Object.keys(asObject(data.routeOverrides)),...Object.keys(asObject(data.routeExecutions))].map(String).filter(id=>id&&id!=='__unassigned__'));
  const add=(type,id,payload)=>{id=String(id||'');if(!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw new Error(`Раздел ${type} содержит запись без безопасного идентификатора.`);const wrapped=wrappedEntityPayload(payload);map.set(entityKey(type,id),{type,id,payload:wrapped,fingerprint:semanticEntityFingerprintV784(type,id,wrapped,{warehouseId,environment})})};
  if(environment===WAREHOUSE_REGISTRY_ENVIRONMENT)add('warehouse',warehouseId,serverWarehouseEntityPayloadV784(warehouse,{warehouseId,environment}));
  for(const type of ENTITY_SINGLETON_SECTIONS){const value=data[type];if(value&&typeof value==='object'&&!Array.isArray(value))add(type,type,type==='settings'?serverSettingsPayload(value):value)}
  for(const type of ENTITY_ARRAY_SECTIONS){for(const value of asArray(data[type])){const fallback=type==='routeArchives'?(value?.routeId||value?.executionId):'';add(type,value?.id||fallback,value)}}
  for(const type of ENTITY_MAP_SECTIONS){for(const[id,value]of Object.entries(asObject(data[type]))){if(type==='routeCatalog'&&value?.custom!==true&&!referencedRouteIds.has(String(id)))continue;add(type,id,value)}}
  return map;
}
function localEntitySnapshotFingerprint(snapshot=buildBackupPayload()){const records=splitEntitySnapshot(snapshot);return entityFingerprint([...records].map(([key,item])=>[key,item.fingerprint]).sort((a,b)=>a[0].localeCompare(b[0])))}
function rememberObservedEntitySnapshot(snapshot=null){try{cloudSyncState.observedFingerprint=localEntitySnapshotFingerprint(snapshot||buildBackupPayload());return true}catch{cloudSyncState.observedFingerprint='';return false}}
function canWriteEntity(type){
  const required=asArray(ENTITY_UPDATE_PERMISSION[type]);
  if(roleFor()==='owner'||hasPermission('*'))return true;
  return required.some(permission=>hasPermission(permission));
}
function entityPermissionQuarantineKey(context={}){const scope=`${String(context.companyId||desktopSession?.auth?.company?.id||'unknown')}:${String(context.environment||activeEnvironment())}:${String(context.warehouseId||activeWarehouseId())}`;return`jf.entity-permission-quarantine.v1.${scope.replace(/[^A-Za-z0-9_.:-]/g,'_')}`}
function hasEntityPermissionQuarantine(context={}){try{return Boolean(localStorage.getItem(entityPermissionQuarantineKey(context)))}catch{return true}}
function quarantineLocalEntityChanges(changes,context={},reason='local_dirty_recovery',message='На компьютере найдены несинхронизированные изменения, которые текущая роль больше не вправе отправить. Локальные данные сохранены и требуют входа пользователя с подходящими правами либо экспорта резервной копии.'){
  const protectedChanges=asArray(changes);if(!protectedChanges.length)return protectedChanges;const key=entityPermissionQuarantineKey(context),scope=`${String(context.companyId||desktopSession?.auth?.company?.id||'unknown')}:${String(context.environment||activeEnvironment())}:${String(context.warehouseId||activeWarehouseId())}`;persistEntityDirty(true,scope);cloudSyncState.dirty=true;const details={reason,companyId:String(context.companyId||desktopSession?.auth?.company?.id||''),warehouseId:String(context.warehouseId||activeWarehouseId()),environment:String(context.environment||activeEnvironment()),entities:protectedChanges.slice(0,1000).map(change=>({type:String(change.type),id:String(change.id),deleted:change.deleted===true})),total:protectedChanges.length,exportRequired:true};try{localStorage.setItem(key,JSON.stringify({...details,recordedAt:new Date().toISOString()}))}catch{}audit('local_changes_quarantined_after_permission_change',{reason,types:[...new Set(protectedChanges.map(change=>String(change.type)))],total:protectedChanges.length,warehouseId:details.warehouseId,environment:details.environment});const error=outboxError('ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED',message,details);cloudSyncState.contextBlockedError=error;blockWorkspaceForEntityPermissionQuarantine(error.message);throw error
}
function requireWritableLocalEntityChanges(changes,context={},reason='local_dirty_recovery'){
  const denied=asArray(changes).filter(change=>!canWriteEntity(change.type)),key=entityPermissionQuarantineKey(context);if(!denied.length){try{localStorage.removeItem(key)}catch{}if(cloudSyncState.contextBlockedError?.code==='ENTITY_LOCAL_CHANGES_PERMISSION_REVOKED')cloudSyncState.contextBlockedError=null;return changes}
  return quarantineLocalEntityChanges(denied,context,reason,'На компьютере найдены несинхронизированные изменения, на которые у текущей роли больше нет права записи. Серверный снимок не применён: локальные данные сохранены. Войдите с подходящей ролью и повторите синхронизацию либо экспортируйте резервную копию.')
}
function applyEntityToSnapshot(snapshot,item,deleted=false){
  const type=String(item.type),id=String(item.id),payload=unwrappedEntityPayload(item.payload),data=snapshot.data||(snapshot.data={});
  if(type==='warehouse'){if(!deleted)snapshot.warehouse=cloneValue(payload);return}
  if(ENTITY_SINGLETON_SECTIONS.includes(type)){data[type]=deleted?{}:cloneValue(payload);return}
  if(ENTITY_ARRAY_SECTIONS.includes(type)){const list=asArray(data[type]),index=list.findIndex(value=>String(value?.id||value?.routeId||value?.executionId||'')===id);if(deleted){if(index>=0)list.splice(index,1)}else if(index>=0)list[index]=cloneValue(payload);else list.push(cloneValue(payload));data[type]=list;return}
  if(ENTITY_MAP_SECTIONS.includes(type)){const values=asObject(data[type]);if(deleted)delete values[id];else values[id]=cloneValue(payload);data[type]=values}
}
function snapshotFromServerEntities(base,entities,readableTypes){
  const snapshot=cloneValue(base),data=snapshot.data||(snapshot.data={}),readable=new Set(readableTypes);
  for(const type of ENTITY_ARRAY_SECTIONS)data[type]=[];
  for(const type of ENTITY_MAP_SECTIONS)data[type]={};
  for(const type of ENTITY_SINGLETON_SECTIONS)data[type]={};
  for(const entity of entities)if(readable.has(String(entity.type))||entity.type==='warehouse')applyEntityToSnapshot(snapshot,entity,false);
  data.warehouseId=activeWarehouseId();if(snapshot.warehouse)snapshot.warehouse.environment=activeEnvironment();return snapshot;
}
function newEntityCommandId(){const random=globalThis.crypto?.randomUUID?.()||`${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;return`client:${Date.now().toString(36)}:${random}`}
function entityTypeSetSignature(values){return[...new Set(asArray(values).map(String))].sort().join('|')}
function knownWarehouseVersion(record){
  const id=String(record?.id||''),known=cloudSyncState.scope===entityScope()?cloudSyncState.known.get(entityKey('warehouse',id)):null,stored=Number(record?.revision||0);
  return Number.isSafeInteger(Number(known?.version))?Number(known.version):(Number.isSafeInteger(stored)&&stored>=0?stored:0)
}
const WAREHOUSE_LIFECYCLE_SCHEMA_V784=2,WAREHOUSE_LIFECYCLE_STORE_V784='journal',WAREHOUSE_LIFECYCLE_RECORD_V784='active';
let warehouseLifecycleChainV784=Promise.resolve();
function warehouseLifecycleErrorV784(code,message,cause){const error=Object.assign(new Error(message),{code,warehouseWritePending:true});if(cause)error.cause=cause;return error}
function warehouseLifecycleCompanyV784(){return String(desktopSession?.auth?.company?.id||'')}
function warehouseLifecycleIndexKeyV784(companyId){return`jf.warehouse-lifecycle.v1.${String(companyId).replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,120)}.${hashString(companyId)}`}
function warehouseLifecycleDbNameV784(companyId,warehouseId){return`justfun_warehouse_lifecycle_v1__${hashString(`${companyId}:${warehouseId}`)}__${String(warehouseId).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)}`}
function warehouseLifecycleReadIndexV784(companyId){
  const key=warehouseLifecycleIndexKeyV784(companyId);let value;try{value=JSON.parse(localStorage.getItem(key)||'[]')}catch(error){throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_INDEX_CORRUPT','Журнал операций со складами повреждён. Автоматическая работа остановлена.',error)}if(!Array.isArray(value)||value.length>200)throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_INDEX_CORRUPT','Журнал операций со складами имеет неверный формат.');const seen=new Set();return value.map(item=>{const warehouseId=String(item?.warehouseId||''),commandId=String(item?.commandId||''),state=String(item?.state||''),authorUserId=String(item?.authorUserId||'');if(!/^[A-Za-z0-9_-]{1,160}$/.test(warehouseId)||!/^[A-Za-z0-9_.:-]{16,180}$/.test(commandId)||authorUserId&&!validEntityRecoveryUserId(authorUserId)||!['preparing','ready','clearing'].includes(state)||seen.has(warehouseId))throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_INDEX_CORRUPT','Журнал операций со складами содержит недопустимую запись.');seen.add(warehouseId);return{warehouseId,commandId,state,authorUserId,fingerprint:String(item?.fingerprint||''),updatedAt:String(item?.updatedAt||'')}})}
function warehouseLifecycleWriteIndexV784(companyId,index){try{localStorage.setItem(warehouseLifecycleIndexKeyV784(companyId),JSON.stringify(index))}catch(error){throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_INDEX_WRITE_FAILED','Не удалось сохранить управляющий журнал операции со складом.',error)}}
function warehouseLifecycleSetPointerV784(companyId,pointer){const index=warehouseLifecycleReadIndexV784(companyId),next=index.filter(item=>item.warehouseId!==pointer.warehouseId);next.push({...pointer,updatedAt:new Date().toISOString()});warehouseLifecycleWriteIndexV784(companyId,next)}
function warehouseLifecycleRemovePointerV784(companyId,warehouseId){const index=warehouseLifecycleReadIndexV784(companyId),next=index.filter(item=>item.warehouseId!==warehouseId);if(next.length!==index.length)warehouseLifecycleWriteIndexV784(companyId,next)}
function openWarehouseLifecycleDbV784(companyId,warehouseId){return new Promise((resolve,reject)=>{if(typeof indexedDB==='undefined'){reject(warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_INDEXEDDB_UNAVAILABLE','Расширенное хранилище операций со складами недоступно.'));return}let request;try{request=indexedDB.open(warehouseLifecycleDbNameV784(companyId,warehouseId),1)}catch(error){reject(error);return}request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(WAREHOUSE_LIFECYCLE_STORE_V784))db.createObjectStore(WAREHOUSE_LIFECYCLE_STORE_V784,{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_DB_OPEN_FAILED','Не удалось открыть журнал операции со складом.'));request.onblocked=()=>reject(warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_DB_BLOCKED','Журнал операции со складом заблокирован другой копией программы.'))})}
function warehouseLifecycleDbOperationV784(companyId,warehouseId,mode,operation){return openWarehouseLifecycleDbV784(companyId,warehouseId).then(db=>new Promise((resolve,reject)=>{let tx,requestValue=null,result,settled=false;const fail=error=>{if(settled)return;settled=true;try{db.close()}catch{}reject(error)};try{tx=mode==='readwrite'?db.transaction(WAREHOUSE_LIFECYCLE_STORE_V784,mode,{durability:'strict'}):db.transaction(WAREHOUSE_LIFECYCLE_STORE_V784,mode);result=operation(tx.objectStore(WAREHOUSE_LIFECYCLE_STORE_V784))}catch(error){fail(error);return}if(result&&'onsuccess'in result){result.onsuccess=()=>{requestValue=result.result??null};result.onerror=()=>fail(result.error||warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_DB_REQUEST_FAILED','Операция с журналом склада не выполнена.'))}tx.oncomplete=()=>{if(settled)return;settled=true;try{db.close()}catch{}resolve(result&&'onsuccess'in result?requestValue:true)};tx.onerror=()=>fail(tx.error||warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_DB_WRITE_FAILED','Журнал операции со складом не подтверждён диском.'));tx.onabort=tx.onerror})).catch(error=>{throw warehouseLifecycleErrorV784(String(error?.code||'WAREHOUSE_LIFECYCLE_STORAGE_FAILED'),String(error?.message||'Журнал операции со складом недоступен.'),error)})}
function warehouseLifecycleFingerprintV784(warehouseId,warehouseCode,environment,changes,authorUserId=''){return entityFingerprint({warehouseId,warehouseCode,environment,changes,...(authorUserId?{authorUserId}: {})})}
function canonicalWarehouseLifecycleV784(input,companyId,warehouseId){const source=asObject(input),schemaVersion=Number(source.schemaVersion),environment=String(source.environment||''),commandId=String(source.commandId||''),authorUserId=String(source.authorUserId||''),warehouseCode=String(source.warehouseCode||''),changes=asArray(source.changes).map(item=>cloneValue(item)),fingerprint=String(source.fingerprint||''),expectedFingerprint=warehouseLifecycleFingerprintV784(warehouseId,warehouseCode,environment,changes,schemaVersion>=2?authorUserId:'');if(![1,WAREHOUSE_LIFECYCLE_SCHEMA_V784].includes(schemaVersion)||schemaVersion>=2&&!validEntityRecoveryUserId(authorUserId)||String(source.companyId||'')!==companyId||String(source.warehouseId||'')!==warehouseId||environment!=='live'||!/^[A-Za-z0-9_.:-]{16,180}$/.test(commandId)||!changes.length||changes.length>3||fingerprint!==expectedFingerprint)throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_JOURNAL_CORRUPT','Журнал операции со складом повреждён или относится к другой области данных.');return{...source,id:WAREHOUSE_LIFECYCLE_RECORD_V784,schemaVersion,companyId,warehouseId,environment,commandId,...(authorUserId?{authorUserId}:{}),warehouseCode,changes,fingerprint}}
async function prepareWarehouseLifecycleV784(journal){const companyId=String(journal.companyId),warehouseId=String(journal.warehouseId),pointer={warehouseId,commandId:String(journal.commandId),authorUserId:String(journal.authorUserId||''),fingerprint:String(journal.fingerprint),state:'preparing'};warehouseLifecycleSetPointerV784(companyId,pointer);await warehouseLifecycleDbOperationV784(companyId,warehouseId,'readwrite',store=>store.put(journal));warehouseLifecycleSetPointerV784(companyId,{...pointer,state:'ready'});return journal}
async function clearWarehouseLifecycleV784(companyId,warehouseId,commandId,fingerprint,authorUserId=''){warehouseLifecycleSetPointerV784(companyId,{warehouseId,commandId,authorUserId:String(authorUserId||''),fingerprint,state:'clearing'});await warehouseLifecycleDbOperationV784(companyId,warehouseId,'readwrite',store=>store.delete(WAREHOUSE_LIFECYCLE_RECORD_V784));warehouseLifecycleRemovePointerV784(companyId,warehouseId);return true}
async function sendWarehouseLifecycleJournalV784(journal){
  const scope=`${String(journal.companyId)}:${String(journal.environment)}:${String(journal.warehouseId)}`;assertEntityRecoveryOwnership({scope,queue:null,journalOwnerUserId:String(journal.authorUserId||''),legacyJournal:Number(journal.schemaVersion)<2});let lastError;for(let attempt=0;attempt<2;attempt++){try{const result=await window.JustFunDesktop.regVps.writeWarehouse({warehouseId:journal.warehouseId,warehouseCode:journal.warehouseCode,environment:journal.environment,commandId:journal.commandId,changes:journal.changes});if(!result?.ok){const rejection=Object.assign(new Error(result?.error||'VPS не подтвердил изменение склада.'),{code:result?.code||'WAREHOUSE_WRITE_FAILED',details:result?.details||{}});if(definitiveEntityRejection(result)&&!retryableEntityFailure(rejection)){await clearWarehouseLifecycleV784(journal.companyId,journal.warehouseId,journal.commandId,journal.fingerprint,journal.authorUserId);rejection.warehouseWriteRejected=true}throw rejection}validateEntityBatchAck(result,journal.changes,journal.commandId);await clearWarehouseLifecycleV784(journal.companyId,journal.warehouseId,journal.commandId,journal.fingerprint,journal.authorUserId);return result}catch(error){if(error?.warehouseWriteRejected===true)throw error;lastError=error;if(attempt===0)continue}}
  throw warehouseLifecycleErrorV784('WAREHOUSE_WRITE_UNCERTAIN','Ответ VPS на операцию со складом не подтверждён. Команда сохранена и будет безопасно повторена с тем же идентификатором.',lastError)
}
async function recoverPendingWarehouseWritesUnlockedV784(){
  const companyId=warehouseLifecycleCompanyV784();if(!companyId||!desktopSession?.auth?.company?.data_service||desktopSession?.auth?.offline)return[];const recovered=[];
  for(const pointer of warehouseLifecycleReadIndexV784(companyId)){const scope=`${companyId}:live:${pointer.warehouseId}`;assertEntityRecoveryOwnership({scope,queue:null,journalOwnerUserId:String(pointer.authorUserId||''),legacyJournal:!pointer.authorUserId});let raw=null;try{raw=await warehouseLifecycleDbOperationV784(companyId,pointer.warehouseId,'readonly',store=>store.get(WAREHOUSE_LIFECYCLE_RECORD_V784))}catch(error){throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_READ_FAILED','Не удалось проверить незавершённую операцию со складом. Работа остановлена без перезаписи данных.',error)}if(!raw){if(pointer.state==='preparing'||pointer.state==='clearing'){warehouseLifecycleRemovePointerV784(companyId,pointer.warehouseId);continue}throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_JOURNAL_MISSING','Управляющий журнал склада указывает на отсутствующую команду. Автоматическая работа остановлена.')}const journal=canonicalWarehouseLifecycleV784(raw,companyId,pointer.warehouseId);if(pointer.commandId!==journal.commandId||pointer.fingerprint!==journal.fingerprint||pointer.authorUserId&&pointer.authorUserId!==String(journal.authorUserId||''))throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_SOURCE_DIVERGED','Управляющий и расширенный журналы склада содержат разные команды.');assertEntityRecoveryOwnership({scope,queue:null,journalOwnerUserId:String(journal.authorUserId||''),legacyJournal:Number(journal.schemaVersion)<2});const result=await sendWarehouseLifecycleJournalV784(journal);recovered.push({warehouseId:journal.warehouseId,fingerprint:journal.fingerprint,result})}
  return recovered
}
function serializeWarehouseLifecycleV784(task){const run=()=>Promise.resolve().then(task);warehouseLifecycleChainV784=warehouseLifecycleChainV784.then(run,run);return warehouseLifecycleChainV784}
function recoverPendingWarehouseWritesV784(){return serializeWarehouseLifecycleV784(()=>recoverPendingWarehouseWritesUnlockedV784())}
async function writeAuthoritativeWarehouse(record,{deleted=false,baseVersion,initialSettings=null,initialCompany=null}={}){
  if(isTrainingEnvironment())return{ok:true,skipped:true,version:Number(baseVersion)||0};
  if(!desktopSession?.auth?.company?.data_service){if(deleted)throw new Error('Безвозвратное удаление склада требует рабочего VPS и серверной резервной копии. Можно использовать архив.');return{ok:true,skipped:true,storageMode:'local',version:Number(baseVersion)||0}}
  if(desktopSession?.auth?.offline||!window.JustFunDesktop?.regVps?.writeWarehouse)throw new Error('Серверный режим компании временно недоступен. Изменение склада не выполнено.');
  const id=String(record?.id||'');if(!id)throw new Error('Идентификатор склада не определён.');resetEntityScope();const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch;
  const version=baseVersion==null?knownWarehouseVersion(record):Number(baseVersion),payload=deleted?null:serverWarehouseEntityPayloadV784(record,{warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});
  const changes=[{type:'warehouse',id,baseVersion:version,deleted,payload}];
  if(!deleted&&version===0&&initialSettings&&typeof initialSettings==='object'&&!Array.isArray(initialSettings)){
    const settingsPayload=serverSettingsPayload(initialSettings,{initial:true});if(Object.keys(settingsPayload).length)changes.push({type:'settings',id:'settings',baseVersion:0,deleted:false,payload:settingsPayload});
    if(hasPermission('company.update')&&initialCompany&&typeof initialCompany==='object'&&!Array.isArray(initialCompany)&&Object.keys(initialCompany).length)changes.push({type:'company',id:'company',baseVersion:0,deleted:false,payload:cloneValue(initialCompany)})
  }
  const companyId=warehouseLifecycleCompanyV784(),warehouseCode=String(record?.code||''),authorUserId=currentEntityUserId();if(!validEntityRecoveryUserId(authorUserId))throw warehouseLifecycleErrorV784('WAREHOUSE_LIFECYCLE_OWNER_REQUIRED','Операция со складом остановлена: пользователь не подтверждён.');const fingerprint=warehouseLifecycleFingerprintV784(id,warehouseCode,WAREHOUSE_REGISTRY_ENVIRONMENT,changes,authorUserId),result=await serializeWarehouseLifecycleV784(async()=>{const recovered=await recoverPendingWarehouseWritesUnlockedV784(),matching=recovered.find(item=>item.warehouseId===id&&item.fingerprint===fingerprint);if(matching)return matching.result;const journal=canonicalWarehouseLifecycleV784({id:WAREHOUSE_LIFECYCLE_RECORD_V784,schemaVersion:WAREHOUSE_LIFECYCLE_SCHEMA_V784,companyId,warehouseId:id,warehouseCode,environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:newEntityCommandId(),authorUserId,changes,fingerprint,preparedAt:new Date().toISOString()},companyId,id);await prepareWarehouseLifecycleV784(journal);return sendWarehouseLifecycleJournalV784(journal)});
  const confirmed=result.entities?.find(item=>item.type==='warehouse'&&item.id===id),confirmedVersion=Number(confirmed?.version)||version;
  if(activeEnvironment()===WAREHOUSE_REGISTRY_ENVIRONMENT&&id===activeWarehouseId()&&entityScopeIsCurrent(expectedScope,expectedEpoch)){if(deleted)cloudSyncState.known.set(entityKey('warehouse',id),{version:confirmedVersion,digest:String(confirmed?.digest||''),fingerprint:'',deleted:true,eventId:Number(confirmed?.eventId)||0});else cloudSyncState.known.set(entityKey('warehouse',id),{version:confirmedVersion,digest:String(confirmed?.digest||''),fingerprint:semanticEntityFingerprintV784('warehouse',id,payload,{warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT}),deleted:false,eventId:Number(confirmed?.eventId)||0});saveEntitySyncState()}
  return{...result,version:confirmedVersion}
}
window.JustFunServerStorageV3=Object.freeze({writeWarehouse:writeAuthoritativeWarehouse,deleteWarehouse:(record,options={})=>writeAuthoritativeWarehouse(record,{...options,deleted:true}),recoverPendingWarehouseWrites:recoverPendingWarehouseWritesV784});
function initialServerSeedChanges(localSnapshot){
  const records=splitEntitySnapshot(localSnapshot),changes=[];
  for(const entity of records.values()){
    const initialWarehouse=entity.type==='warehouse';
    const packagedCatalog=entity.type==='products'&&localSnapshot?.warehouse?.catalogMode==='catalog'&&entity.payload?.catalogManaged===true;
    if(initialWarehouse||packagedCatalog)changes.push({type:entity.type,id:entity.id,baseVersion:0,deleted:false,payload:entity.payload})
  }
  return changes
}
function overlayLocalOutbox(snapshot,queue=requireLocalOutbox(),options={}){
  let applied=0;const markers=Array.isArray(options.resolutionMarkers)?options.resolutionMarkers:null,authoritativeKnown=options.authoritativeKnown instanceof Map?options.authoritativeKnown:null,authoritativeSnapshot=options.authoritativeSnapshot===true,targetConflicts=options.conflicts instanceof Map?options.conflicts:cloudSyncState.conflicts,activeConflictKeys=new Set(),ignoredCommandIds=new Set(asArray(options.ignoredCommandIds).map(String));
  for(const entry of asArray(queue.pendingServerResolutions?.())){const remote=asObject(entry.serverResult),key=entityKey(remote.type,remote.id),known=authoritativeKnown?.get(key),version=Number(remote.version);if(!Number.isSafeInteger(version)||version<0)throw outboxError('OUTBOX_RESOLUTION_REMOTE_INVALID','Журнал выбранной серверной версии повреждён. Автоматическое восстановление остановлено.');if(known){const knownVersion=Number(known.version);if(!Number.isSafeInteger(knownVersion)||authoritativeSnapshot&&knownVersion<version)throw outboxError('OUTBOX_RESOLUTION_REMOTE_AHEAD','Журнал выбора содержит версию новее подтверждённого серверного снимка.');if(knownVersion===version&&(Boolean(known.deleted)!==(remote.deleted===true)||known.digest&&remote.digest&&String(known.digest)!==String(remote.digest)))throw outboxError('OUTBOX_RESOLUTION_REMOTE_DIVERGED','Одинаковая версия записи имеет разные серверные данные. Автоматическое восстановление остановлено.');if(!authoritativeSnapshot&&knownVersion>version)throw outboxError('OUTBOX_RESOLUTION_REMOTE_STALE','Служебное состояние уже содержит более новую версию. Требуется повторная сверка с VPS.')}else if(authoritativeSnapshot&&remote.deleted!==true)throw outboxError('OUTBOX_RESOLUTION_REMOTE_DISAPPEARED','Выбранная серверная запись больше не присутствует в актуальном снимке VPS. Автоматическое восстановление остановлено.');if(!(authoritativeSnapshot&&known))applyEntityToSnapshot(snapshot,{type:remote.type,id:remote.id,payload:remote.payload},remote.deleted===true);if(markers)markers.push(entry);applied++}
  for(const entry of queue.overlayEntries()){if(ignoredCommandIds.has(String(entry.commandId||'')))continue;const conflictKeys=new Set(entry.state==='conflict'?asArray(queue.conflictEntityKeys?.(entry.commandId)):entry.state==='rejected'?entry.changes.map(change=>entityKey(change.type,change.id)):[]);for(const change of entry.changes){applyEntityToSnapshot(snapshot,change,change.deleted===true);applied++;const key=entityKey(change.type,change.id);if(conflictKeys.has(key)){activeConflictKeys.add(key);targetConflicts.set(key,{type:change.type,id:change.id,commandId:entry.commandId,state:entry.state,...asObject(entry.lastError),detectedAt:entry.updatedAt})}}
  }
  for(const[key,value]of targetConflicts)if(value?.commandId&&!activeConflictKeys.has(key))targetConflicts.delete(key);return applied
}
function applyPendingResolutionMetadata(markers,authoritativeKnown=null,{knownEntities=cloudSyncState.known,conflicts=cloudSyncState.conflicts,context=null}={}){
  const fingerprintContext=context||{warehouseId:activeWarehouseId(),environment:activeEnvironment()};for(const entry of markers){const remote=asObject(entry.serverResult),key=entityKey(remote.type,remote.id),authoritative=authoritativeKnown instanceof Map?authoritativeKnown.get(key):null;if(authoritative&&Number(authoritative.version)>=Number(remote.version)){conflicts.delete(key);continue}const current=knownEntities.get(key);if(current&&Number(current.version)>Number(remote.version))throw outboxError('OUTBOX_RESOLUTION_METADATA_STALE','Локальное служебное состояние новее журнала выбора. Автоматическая перезапись остановлена.');knownEntities.set(key,{version:Number(remote.version)||0,digest:String(remote.digest||''),fingerprint:remote.deleted?'':semanticEntityFingerprintV784(remote.type,remote.id,remote.payload,fingerprintContext),deleted:remote.deleted===true,eventId:Number(remote.eventId)||0});conflicts.delete(key)}
}
function finalizePendingServerResolutions(queue,markers){const ids=[...new Set(markers.map(entry=>String(entry.commandId||'')).filter(Boolean))];for(const commandId of ids)queue.markResolutionApplied(commandId);return ids.length
}
function reconcileServerEquivalentWarehouseOutboxV784(queue,entities,context,{conflicts=cloudSyncState.conflicts}={}){
  const companyId=String(context?.companyId||''),warehouseId=String(context?.warehouseId||''),environment=String(context?.environment||'live'),expectedScope=`${companyId}:${environment}:${warehouseId}`;if(!companyId||!/^[A-Za-z0-9_-]{1,160}$/.test(warehouseId)||!['live','demo'].includes(environment))return 0;const matching=asArray(entities).filter(item=>item?.type==='warehouse'&&String(item?.id||'')===warehouseId);if(matching.length!==1)return 0;
  const server=matching[0],serverVersion=Number(server?.version),serverEventId=Number(server?.event_id),serverDigest=String(server?.digest_sha256||''),serverPayload=server?.payload,declaredServerId=String(serverPayload?.id||''),declaredServerEnvironment=String(serverPayload?.environment||'').toLowerCase();if(server?.deleted===true||server?.operation==='delete'||!serverPayload||typeof serverPayload!=='object'||Array.isArray(serverPayload)||!Number.isSafeInteger(serverVersion)||serverVersion<0||!Number.isSafeInteger(serverEventId)||serverEventId<0||!/^[a-f0-9]{64}$/i.test(serverDigest)||declaredServerId&&declaredServerId!==warehouseId||declaredServerEnvironment&&declaredServerEnvironment!==environment)return 0;
  const normalizedServer=JSON.stringify(stableEntityValue(serverWarehouseEntityPayloadV784(serverPayload,{warehouseId,environment}))),active=queue.list().filter(entry=>entry?.state==='pending'||entry?.state==='sending'||entry?.state==='conflict'||entry?.state==='rejected'&&entry?.preserveLocal===true),prefix=[];
  for(const entry of active){
    const safeState=entry?.preserveLocal===true&&(entry.state==='pending'||entry.state==='conflict'||entry.state==='rejected'),changes=asArray(entry?.changes),change=changes.length===1?changes[0]:null,payload=change?.payload,declaredLocalId=String(payload?.id||''),declaredLocalEnvironment=String(payload?.environment||'').toLowerCase(),baseVersion=Number(change?.baseVersion),equivalent=safeState&&String(entry.scope||'')===expectedScope&&String(entry.companyId||'')===companyId&&String(entry.warehouseId||'')===warehouseId&&String(entry.environment||'')===environment&&change?.type==='warehouse'&&String(change?.id||'')===warehouseId&&change?.deleted!==true&&payload&&typeof payload==='object'&&!Array.isArray(payload)&&(!declaredLocalId||declaredLocalId===warehouseId)&&(!declaredLocalEnvironment||declaredLocalEnvironment===environment)&&Number.isSafeInteger(baseVersion)&&baseVersion>=0&&baseVersion<=serverVersion&&JSON.stringify(stableEntityValue(serverWarehouseEntityPayloadV784(payload,{warehouseId,environment})))===normalizedServer;
    if(!equivalent)break;prefix.push(entry)
  }
  for(const entry of prefix)queue.markConfirmed(entry.commandId,{reconciled:'server-equivalent-warehouse-metadata',version:serverVersion,eventId:serverEventId});
  const blockingWarehouseEntry=queue.list().some(entry=>entry?.preserveLocal===true&&(entry?.state==='conflict'||entry?.state==='rejected')&&asArray(entry?.changes).some(change=>change?.type==='warehouse'&&String(change?.id||'')===warehouseId));if(prefix.length&&!blockingWarehouseEntry)conflicts.delete(entityKey('warehouse',warehouseId));
  if(prefix.length)audit('server_equivalent_warehouse_outbox_reconciled',{commands:prefix.length,warehouseId,environment});return prefix.length
}
function rejectedOrderNormalizationProjectionV784(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const payload=cloneValue(value),documentSnapshot=payload.documentSnapshot;if(documentSnapshot&&typeof documentSnapshot==='object'&&!Array.isArray(documentSnapshot))delete documentSnapshot.capturedAt;if(Array.isArray(payload.statusHistory))payload.statusHistory=payload.statusHistory.map(entry=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))return entry;const item=cloneValue(entry);delete item.id;return item});return JSON.stringify(stableEntityValue(payload))
}
function planRejectedOrderNormalizationRecoveryV784(queue,entities,context,localSnapshot){
  const companyId=String(context?.companyId||''),warehouseId=String(context?.warehouseId||''),environment=String(context?.environment||'live'),expectedScope=`${companyId}:${environment}:${warehouseId}`;if(!companyId||!/^[A-Za-z0-9_-]{1,160}$/.test(warehouseId)||!['live','demo'].includes(environment)||!localSnapshot)return 0;
  const active=asArray(queue?.list?.()).filter(entry=>entry?.preserveLocal!==false&&(entry?.state==='pending'||entry?.state==='sending'||entry?.state==='conflict'||entry?.state==='rejected'));if(active.length!==1)return null;const entry=active[0],changes=asArray(entry?.changes),change=changes.length===1?changes[0]:null,details=asObject(entry?.lastError?.details),fieldSet=new Set(asArray(details.fields).map(String)),requiredSet=new Set(asArray(details.required_permissions).map(String)),declaredErrorId=String(details.entity_id||'');if(entry?.state!=='rejected'||entry?.preserveLocal!==true||String(entry?.scope||'')!==expectedScope||String(entry?.companyId||'')!==companyId||String(entry?.warehouseId||'')!==warehouseId||String(entry?.environment||'')!==environment||String(entry?.intent?.kind||'')!=='conflict_resolution_local_capture'||String(entry?.intent?.targetId||'')!==warehouseId||String(entry?.lastError?.code||'').toLowerCase()!=='entity_field_access_denied'||String(details.entity_type||'')!=='orders'||declaredErrorId&&declaredErrorId!==String(change?.id||'')||fieldSet.size!==2||!fieldSet.has('documentSnapshot')||!fieldSet.has('statusHistory')||requiredSet.size!==1||!requiredSet.has('orders.status')||change?.type!=='orders'||change?.deleted===true)return null;
  const orderId=String(change.id||''),payload=change.payload;if(!/^[A-Za-z0-9_-]{1,160}$/.test(orderId)||!payload||typeof payload!=='object'||Array.isArray(payload)||String(payload.id||'')!==orderId||String(payload.warehouseId||payload.warehouse_id||'')!==warehouseId)return 0;const matching=asArray(entities).filter(item=>item?.type==='orders'&&String(item?.id||'')===orderId&&!item?.deleted&&item?.operation!=='delete');if(matching.length!==1)return 0;
  const server=matching[0],serverPayload=server?.payload,serverVersion=Number(server?.version),serverEventId=Number(server?.event_id??server?.eventId),serverDigest=String(server?.digest_sha256||server?.digest||'');if(!serverPayload||typeof serverPayload!=='object'||Array.isArray(serverPayload)||String(serverPayload.id||'')!==orderId||String(serverPayload.warehouseId||serverPayload.warehouse_id||'')!==warehouseId||!Number.isSafeInteger(serverVersion)||serverVersion<0||!Number.isSafeInteger(serverEventId)||serverEventId<=0||!/^[a-f0-9]{64}$/i.test(serverDigest)||Number(change.baseVersion)!==serverVersion)return 0;
  let localEntity;try{localEntity=splitEntitySnapshot(localSnapshot,{warehouseId,environment}).get(entityKey('orders',orderId))}catch{return 0}const local=localEntity?.payload,candidateProjection=rejectedOrderNormalizationProjectionV784(payload),serverProjection=rejectedOrderNormalizationProjectionV784(serverPayload),localProjection=rejectedOrderNormalizationProjectionV784(local);if(!candidateProjection||candidateProjection!==serverProjection||localProjection!==serverProjection||!localEntity?.fingerprint)return 0;
  return{commandId:String(entry.commandId),key:entityKey('orders',orderId),orderId,localFingerprint:String(localEntity.fingerprint),serverVersion,serverEventId,serverDigest,warehouseId,environment}
}
function finalizeRejectedOrderNormalizationRecoveryV784(queue,plan,{conflicts=cloudSyncState.conflicts}={}){
  if(!plan)return 0;const entry=queue?.get?.(plan.commandId);if(!entry||entry.state!=='rejected'||entry.preserveLocal!==true)throw outboxError('ORDER_NORMALIZATION_RECOVERY_STATE_CHANGED','Служебная команда заказа изменилась во время восстановления. Повторите сверку с VPS.');queue.markConfirmed(plan.commandId,{reconciled:'restart-order-normalization-noise',version:plan.serverVersion,eventId:plan.serverEventId,digest:plan.serverDigest});conflicts.delete(plan.key);audit('server_equivalent_order_normalization_reconciled',{commandId:plan.commandId,orderId:plan.orderId,version:plan.serverVersion,warehouseId:plan.warehouseId,environment:plan.environment});return 1
}
function entityReadBoundaryBelongsToCurrentUser(){const userId=currentEntityUserId();return Boolean(userId&&cloudSyncState.readerUserId===userId&&cloudSyncState.readableTypes.has('warehouse'))}
function entityTypeWasReadableOrWritable(type){type=String(type);return type==='warehouse'||(entityReadBoundaryBelongsToCurrentUser()?cloudSyncState.readableTypes.has(type):canWriteEntity(type))}
function serverEquivalentWarehouseMetadataChangeV784(change,entities,context){
  const warehouseId=String(context?.warehouseId||''),environment=String(context?.environment||'live').toLowerCase(),payload=change?.payload;if(change?.type!=='warehouse'||String(change?.id||'')!==warehouseId||change?.deleted===true||!payload||typeof payload!=='object'||Array.isArray(payload)||!warehouseId||!['live','demo'].includes(environment))return false;
  const matching=asArray(entities).filter(item=>item?.type==='warehouse'&&String(item?.id||'')===warehouseId&&!item?.deleted&&item?.operation!=='delete');if(matching.length!==1)return false;const serverPayload=matching[0]?.payload;if(!serverPayload||typeof serverPayload!=='object'||Array.isArray(serverPayload))return false;
  const declaredLocalId=String(payload.id||''),declaredServerId=String(serverPayload.id||''),declaredLocalEnvironment=String(payload.environment||'').toLowerCase(),declaredServerEnvironment=String(serverPayload.environment||'').toLowerCase();if(declaredLocalId&&declaredLocalId!==warehouseId||declaredServerId&&declaredServerId!==warehouseId||declaredLocalEnvironment&&declaredLocalEnvironment!==environment||declaredServerEnvironment&&declaredServerEnvironment!==environment)return false;
  const normalize=value=>JSON.stringify(stableEntityValue(serverWarehouseEntityPayloadV784(value,{warehouseId,environment})));return normalize(payload)===normalize(serverPayload)
}
function serverEquivalentCurrentEntityChangeV784(change,entities,context,queue){
  const type=String(change?.type||''),id=String(change?.id||''),fingerprint=String(change?._fingerprint||'');if(type!=='settings'||id!=='settings'||!fingerprint||change?.deleted===true)return false;
  const queued=asArray(queue?.overlayEntries?.()).some(entry=>entry?.preserveLocal!==false&&['pending','sending','conflict','rejected'].includes(String(entry?.state||''))&&asArray(entry?.changes).some(item=>String(item?.type||'')===type&&String(item?.id||'')===id));if(queued)return false;
  const matching=asArray(entities).filter(item=>String(item?.type||'')===type&&String(item?.id||'')===id&&item?.deleted!==true&&item?.operation!=='delete');if(matching.length!==1||matching[0]?.payload===undefined)return false;
  const serverPayload=type==='settings'?serverSettingsPayload(matching[0].payload):matching[0].payload;return semanticEntityFingerprintV784(type,id,serverPayload,context)===fingerprint
}
function recoveryKnownEntitiesFromServer(localSnapshot,serverSnapshot,knownAtStart,serverKnown,context){
  const options={warehouseId:String(context?.warehouseId||''),environment:String(context?.environment||'live')},local=splitEntitySnapshot(localSnapshot,options),remote=splitEntitySnapshot(serverSnapshot,options),recovery=new Map(knownAtStart);
  for(const[key,item]of local){const serverItem=remote.get(key),confirmed=serverKnown.get(key);if(serverItem?.fingerprint===item.fingerprint&&confirmed)recovery.set(key,{...confirmed,fingerprint:item.fingerprint})}
  return recovery
}
function capturePreBootstrapLocalIntent(baseline,current,{queue,knownEntities,context,serverEntities=[],suppressedEntityFingerprints=null,ignoredCommandIds=[]}){
  const suppressed=suppressedEntityFingerprints instanceof Map?suppressedEntityFingerprints:new Map(),ignored=new Set(asArray(ignoredCommandIds).map(String)),expected=cloneValue(baseline);overlayLocalOutbox(expected,queue,{conflicts:new Map(cloudSyncState.conflicts),ignoredCommandIds:[...ignored]});const detected=entityChangesBetween(expected,current,{includeOutbox:true,knownEntities,queue,context}).filter(change=>suppressed.get(entityKey(change.type,change.id))!==String(change._fingerprint||'')&&entityTypeWasReadableOrWritable(change.type)&&!serverEquivalentCurrentEntityChangeV784(change,serverEntities,context,queue)&&!serverEquivalentWarehouseMetadataChangeV784(change,serverEntities,context));
  const blocked=ignored.size?new Set(asArray(queue.list?.()).filter(entry=>!ignored.has(String(entry?.commandId||''))&&(entry?.state==='conflict'||entry?.state==='rejected')&&entry?.preserveLocal!==false).flatMap(entry=>asArray(entry.changes).map(change=>entityKey(change.type,change.id)))):queue.blockedEntityKeys(),blockedChange=detected.find(change=>blocked.has(entityKey(change.type,change.id)));if(blockedChange)throw outboxError('OUTBOX_ENTITY_BLOCKED',`Запись ${blockedChange.type}/${blockedChange.id} уже требует разрешения конфликта. Серверный снимок не применён, локальные данные сохранены.`);
  const changes=requireWritableLocalEntityChanges(detected,context,'prebootstrap_local_capture');
  for(let offset=0;offset<changes.length;offset+=1000)queue.enqueue(localOutboxEntry({kind:'prebootstrap_local_capture',targetId:context.warehouseId},changes.slice(offset,offset+1000),context));
  if(changes.length){cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;renderLocalOutboxStatus();audit('prebootstrap_local_intent_saved',{changes:changes.length,warehouseId:context.warehouseId,environment:context.environment})}
  return changes.length
}
function captureEntitySyncMetadataV784(){return{known:new Map(cloudSyncState.known),conflicts:new Map(cloudSyncState.conflicts),cursor:cloudSyncState.cursor,readableTypes:new Set(cloudSyncState.readableTypes),readerUserId:cloudSyncState.readerUserId,bootstrapped:cloudSyncState.bootstrapped,localBaseline:cloudSyncState.localBaseline?cloneValue(cloudSyncState.localBaseline):null,observedFingerprint:cloudSyncState.observedFingerprint}}
function restoreEntitySyncMetadataV784(state){cloudSyncState.known=new Map(state.known);cloudSyncState.conflicts=new Map(state.conflicts);cloudSyncState.cursor=state.cursor;cloudSyncState.readableTypes=new Set(state.readableTypes);cloudSyncState.readerUserId=state.readerUserId;cloudSyncState.bootstrapped=state.bootstrapped;cloudSyncState.localBaseline=state.localBaseline?cloneValue(state.localBaseline):null;cloudSyncState.observedFingerprint=state.observedFingerprint}
function blockRemoteEntityApplyRollbackV784(error,rollbackError,phase){
  const blocked=outboxError('ENTITY_REMOTE_APPLY_ROLLBACK_FAILED','Серверные данные не удалось безопасно применить или откатить. Рабочее пространство заблокировано без отправки локальных удалений.',{phase:String(phase||''),cause:String(error?.message||error),rollbackCause:String(rollbackError?.message||rollbackError)});cloudSyncState.contextBlockedError=blocked;cloudSyncState.scopeEpoch++;cloudSyncState.bootstrapPromise=null;cloudSyncState.bootstrapped=false;try{freezeWorkspaceForWarehouseTransition()}catch{}try{renderNoWarehouse(blocked.message)}catch{}return blocked
}
async function commitRemoteEntitySnapshotV784({snapshot,rollbackSnapshot,metadata,expectedScope,expectedEpoch,phase='remote-apply',failureCode='ENTITY_REMOTE_IMPORT_NOT_DURABLE',failureMessage='Серверный снимок не подтверждён локальным диском.'}){
  const previous=captureEntitySyncMetadataV784();let importStarted=false;try{
    assertEntityScope(expectedScope,expectedEpoch);const importer=window.TeplitsaWarehouseV600?.importServerSnapshot,persistedBarrier=window.TeplitsaWarehouseV600?.whenPersisted;if(typeof importer!=='function'||typeof persistedBarrier!=='function')throw outboxError('ENTITY_REMOTE_IMPORT_UNAVAILABLE','Модуль подтверждённого применения серверных данных не загружен.');cloudSyncState.suspended++;try{importStarted=true;const imported=await importer(snapshot),persisted=await persistedBarrier();assertEntityScope(expectedScope,expectedEpoch);if(imported===false||persisted===false||window.__warehousePersistenceCritical)throw outboxError(failureCode,failureMessage)}finally{cloudSyncState.suspended--}
    cloudSyncState.known=new Map(metadata.known);cloudSyncState.conflicts=new Map(metadata.conflicts);cloudSyncState.cursor=Number(metadata.cursor)||0;cloudSyncState.readableTypes=new Set(metadata.readableTypes);cloudSyncState.bootstrapped=metadata.bootstrapped!==false;rememberLocalEntityBaseline(snapshot);rememberObservedEntitySnapshot(snapshot);if(saveEntitySyncState({required:true})!==true)throw outboxError('ENTITY_STATE_WRITE_FAILED','Серверные данные применены, но их служебное состояние не подтверждено на этом компьютере.');return true
  }catch(error){
    restoreEntitySyncMetadataV784(previous);if(importStarted){if(!entityScopeIsCurrent(expectedScope,expectedEpoch))throw blockRemoteEntityApplyRollbackV784(error,outboxError('ENTITY_SCOPE_CHANGED','Контекст изменился до безопасного отката серверного снимка.'),phase);try{const rolledBack=await rollbackLocalSnapshot(rollbackSnapshot);assertEntityScope(expectedScope,expectedEpoch);if(rolledBack!==true)throw outboxError('ENTITY_REMOTE_ROLLBACK_NOT_DURABLE','Откат локального снимка не подтверждён диском.')}catch(rollbackError){restoreEntitySyncMetadataV784(previous);throw blockRemoteEntityApplyRollbackV784(error,rollbackError,phase)}restoreEntitySyncMetadataV784(previous)}throw error
  }
}
async function restoreLocalOutboxOverlay(){
  if(isTrainingEnvironment())return false;
  resetEntityScope();const queue=requireLocalOutbox();assertEntityRecoveryOwnership({queue});const initialStatus=queue.status();if(!initialStatus.active)return false;const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,dirtyToken={generationAtStart:entityDirtyGeneration(cloudSyncState.scope),serialAtStart:cloudSyncState.serial},recoveryPending=Number(initialStatus.resolutionPending||0)>0;
  try{const localSnapshot=cloneValue(buildBackupPayload()),markers=[],applied=overlayLocalOutbox(localSnapshot,queue,{resolutionMarkers:markers,authoritativeKnown:cloudSyncState.known});if(!applied)return false;if(typeof window.TeplitsaWarehouseV600?.importServerSnapshot!=='function')throw outboxError('OUTBOX_RESTORE_UNAVAILABLE','Локальная очередь сохранена, но модуль восстановления данных не загружен.');assertEntityScope(expectedScope,expectedEpoch);cloudSyncState.suspended++;try{const imported=await window.TeplitsaWarehouseV600.importServerSnapshot(localSnapshot),persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();assertEntityScope(expectedScope,expectedEpoch);if(imported===false||persisted===false||window.__warehousePersistenceCritical)throw outboxError('OUTBOX_RESTORE_NOT_DURABLE','Восстановленный локальный снимок не подтверждён диском.');rememberLocalEntityBaseline(localSnapshot);rememberObservedEntitySnapshot(localSnapshot)}finally{cloudSyncState.suspended--}applyPendingResolutionMetadata(markers);if(markers.length)saveEntitySyncState({required:true});finalizePendingServerResolutions(queue,markers);settleEntityDirty(expectedScope,queue,dirtyToken);const finalStatus=queue.status();window.renderAll?.();renderLocalOutboxStatus();audit('local_outbox_overlay_restored',{commands:initialStatus.active,remaining:finalStatus.active,changes:applied,resolutions:markers.length,warehouseId:activeWarehouseId(),environment:activeEnvironment()});return true}catch(error){if(recoveryPending)throw blockConflictResolutionRecovery(error);throw error}
}
async function bootstrapEntitySync(force=false){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service||!window.JustFunDesktop?.regVps?.bootstrapEntities)return false;
  if(typeof provisionalNativeWarehouseIdV784==='function'&&provisionalNativeWarehouseIdV784())throw outboxError('ENTITY_REGISTRY_CONFIRMATION_REQUIRED','Серверный список складов ещё не подтверждён. Получение и отправка данных остановлены до проверки VPS.');
  resetEntityScope();assertEntityRecoveryOwnership({queue:requireLocalOutbox()});if(ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0||cloudSyncState.suspended>0)throw outboxError('ENTITY_ORDINARY_MUTATION_IN_FLIGHT','Получение серверных данных отложено до завершения локального изменения.');if(cloudSyncState.bootstrapped&&!force)return true;if(cloudSyncState.bootstrapPromise)return cloudSyncState.bootstrapPromise;
  const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,queue=cloudSyncState.outbox,knownAtStart=new Map(cloudSyncState.known),warehouseId=activeWarehouseId(),environment=activeEnvironment(),companyId=String(desktopSession?.auth?.company?.id||''),localSnapshot=cloneValue(buildBackupPayload()),baselineSnapshot=cloneValue(cloudSyncState.localBaseline||localSnapshot),bootstrapSerial=cloudSyncState.serial,dirtyGenerationAtStart=entityDirtyGeneration(expectedScope),context={companyId,warehouseId,environment},pendingResolutionsAtStart=asArray(queue.pendingServerResolutions?.());
  let operation,resolutionApplyStarted=false;
  operation=(async()=>{
    beginEntityBootstrapFlight(expectedScope,expectedEpoch);
    try{
      let result=await window.JustFunDesktop.regVps.bootstrapEntities({warehouseId,environment});assertEntityScope(expectedScope,expectedEpoch);
      if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS не вернул сущности склада.'),{code:result?.code||'ENTITY_BOOTSTRAP_FAILED'});
      let entities=asArray(result.entities).map(canonicalServerEntity);
      if(environment===WAREHOUSE_REGISTRY_ENVIRONMENT&&!entities.some(entity=>entity.type==='warehouse'&&entity.id===warehouseId)){
        if(!canWriteEntity('warehouse'))throw Object.assign(new Error('Склад ещё не зарегистрирован на VPS и у пользователя нет права его создать.'),{code:'WAREHOUSE_NOT_REGISTERED'});
        const seed=initialServerSeedChanges(localSnapshot),created=await window.JustFunDesktop.regVps.syncEntities({warehouseId,environment,commandId:newEntityCommandId(),changes:seed});assertEntityScope(expectedScope,expectedEpoch);
        if(!created?.ok)throw Object.assign(new Error(created?.error||'VPS не зарегистрировал склад.'),{code:created?.code||'WAREHOUSE_CREATE_FAILED',details:created?.details||{}});
        result=await window.JustFunDesktop.regVps.bootstrapEntities({warehouseId,environment});assertEntityScope(expectedScope,expectedEpoch);
        if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS не вернул созданный склад.'),{code:result?.code||'ENTITY_BOOTSTRAP_FAILED'});
        entities=asArray(result.entities).map(canonicalServerEntity)
      }
      const readableTypes=asArray(result.readableTypes).map(String),serverSnapshot=snapshotFromServerEntities(localSnapshot,entities,readableTypes),serverKnown=new Map();
      for(const entity of entities)serverKnown.set(entityKey(entity.type,entity.id),{version:Number(entity.version)||0,digest:String(entity.digest_sha256||''),fingerprint:semanticEntityFingerprintV784(entity.type,entity.id,entity.payload,context),deleted:false,eventId:Number(entity.event_id)||0});
      const orderRecoveryPlan=planRejectedOrderNormalizationRecoveryV784(queue,entities,context,localSnapshot),suppressedEntityKeys=orderRecoveryPlan?new Set([orderRecoveryPlan.key]):null,suppressedEntityFingerprints=orderRecoveryPlan?new Map([[orderRecoveryPlan.key,orderRecoveryPlan.localFingerprint]]):null,ignoredCommandIds=orderRecoveryPlan?[orderRecoveryPlan.commandId]:[];
      if(cloudSyncState.dirty&&!pendingResolutionsAtStart.length){const recoveryKnown=recoveryKnownEntitiesFromServer(localSnapshot,serverSnapshot,knownAtStart,serverKnown,context),suppressedDeletes=[],pendingBeforeServer=buildPendingEntityChanges({snapshot:localSnapshot,knownEntities:recoveryKnown,conflicts:new Map(cloudSyncState.conflicts),queue,context,allowInferredDeletes:false,suppressedDeletes,suppressedEntityKeys,serverEntities:entities});for(let offset=0;offset<pendingBeforeServer.length;offset+=1000)queue.enqueue(localOutboxEntry({kind:'durable_dirty_recovery',targetId:warehouseId},pendingBeforeServer.slice(offset,offset+1000),context));if(suppressedDeletes.length)audit('unjournaled_dirty_deletes_suppressed',{entities:suppressedDeletes.slice(0,100),total:suppressedDeletes.length,warehouseId,environment})}
      const localPersisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();assertEntityScope(expectedScope,expectedEpoch);if(localPersisted===false||window.__warehousePersistenceCritical)throw outboxError('ENTITY_BOOTSTRAP_LOCAL_CAPTURE_NOT_DURABLE','Текущий локальный снимок не подтверждён диском. Серверные данные пока не применены.');if(!pendingResolutionsAtStart.length)capturePreBootstrapLocalIntent(baselineSnapshot,cloneValue(buildBackupPayload()),{queue,knownEntities:knownAtStart,context,serverEntities:entities,suppressedEntityFingerprints,ignoredCommandIds});assertEntityScope(expectedScope,expectedEpoch);const stagedConflicts=new Map();reconcileServerEquivalentWarehouseOutboxV784(queue,entities,context,{conflicts:stagedConflicts});
      const resolutionMarkers=[];resolutionApplyStarted=pendingResolutionsAtStart.length>0;const overlaid=overlayLocalOutbox(serverSnapshot,queue,{resolutionMarkers,authoritativeKnown:serverKnown,authoritativeSnapshot:true,conflicts:stagedConflicts,ignoredCommandIds});applyPendingResolutionMetadata(resolutionMarkers,serverKnown,{knownEntities:serverKnown,conflicts:stagedConflicts,context});await commitRemoteEntitySnapshotV784({snapshot:serverSnapshot,rollbackSnapshot:localSnapshot,metadata:{known:serverKnown,conflicts:stagedConflicts,cursor:Number(result.cursor)||0,readableTypes:new Set(readableTypes),bootstrapped:true},expectedScope,expectedEpoch,phase:'bootstrap',failureCode:'ENTITY_BOOTSTRAP_IMPORT_NOT_DURABLE',failureMessage:'Серверный снимок не подтверждён локальным диском.'});
      if(orderRecoveryPlan){try{finalizeRejectedOrderNormalizationRecoveryV784(queue,orderRecoveryPlan,{conflicts:cloudSyncState.conflicts})}catch(error){cloudSyncState.bootstrapped=false;throw error}}
      cloudSyncState.pollFailures=0;cloudSyncState.nextPollAt=0;finalizePendingServerResolutions(queue,resolutionMarkers);settleEntityDirty(expectedScope,queue,{generationAtStart:dirtyGenerationAtStart,serialAtStart:bootstrapSerial});renderLocalOutboxStatus();
      integrationBadge('jfRegBadge',overlaid?'Сервер + локальная очередь':'Серверные данные готовы','ready');if(cloudSyncState.dirty)scheduleOutboxDrain(0);return true;
    }catch(error){if(error?.code==='ENTITY_SCOPE_CHANGED')return false;if(resolutionApplyStarted)throw blockConflictResolutionRecovery(error);throw error}
    finally{endEntityBootstrapFlight(expectedScope,expectedEpoch)}
  })().finally(()=>{if(cloudSyncState.bootstrapPromise===operation)cloudSyncState.bootstrapPromise=null});
  cloudSyncState.bootstrapPromise=operation;return operation;
}
function scheduleCloudUpload(){
  if(isTrainingEnvironment())return;
  resetEntityScope();let changed=true;try{const fingerprint=localEntitySnapshotFingerprint();changed=!cloudSyncState.observedFingerprint||cloudSyncState.observedFingerprint!==fingerprint;cloudSyncState.observedFingerprint=fingerprint}catch{}if(!changed||cloudSyncState.suspended)return;cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);
}
function installAutomaticCloudSync(){
  if(cloudSyncState.installed)return;cloudSyncState.installed=true;
  window.addEventListener('beforeunload',event=>{if(cloudSyncState.contextBlockedError||criticalEntityFlightCount()>0||ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0){event.preventDefault();event.returnValue=''}});
  if(!isTrainingEnvironment()){resetEntityScope();renderLocalOutboxStatus()}
  const names=['persistOrders','persistProducts','persistInventoryMovements','persistDrivers','persistSettings','persistRoutes','persistRouteAssignments','persistRouteDrivers','persistRouteLocks','persistRouteOverrides','persistRouteExecutions','persistRouteArchives','persistWarehouseReservations','persistReporting'];
  for(const name of names){const base=window[name];if(typeof base!=='function')continue;window[name]=function(){const result=base.apply(this,arguments);scheduleCloudUpload();return result}}
  setTimeout(async()=>{try{if(onlineEntitySyncAvailable())await bootstrapEntitySync();else{await restoreLocalOutboxOverlay();if(cloudSyncState.dirty)scheduleOutboxDrain(1000)}}catch(error){reportCloudSyncFailure(error)}},250);
  cloudSyncState.pollTimer=setInterval(()=>pollCloudRevision().catch(error=>console.error('Background entity check failed',error)),5000);
}
function latestQueuedEntityChanges(queue){
  const latest=new Map();for(const entry of queue?.overlayEntries?.()||[])for(const change of entry.changes)latest.set(entityKey(change.type,change.id),change);return latest
}
function buildPendingEntityChanges({snapshot=null,knownEntities=cloudSyncState.known,conflicts=cloudSyncState.conflicts,queue=requireLocalOutbox(),context=null,allowInferredDeletes=true,suppressedDeletes=null,suppressedEntityKeys=null,serverEntities=[],reason='durable_dirty_recovery'}={}){
  const sourceSnapshot=snapshot||buildBackupPayload(),splitOptions=context?{warehouseId:String(context.warehouseId||''),environment:String(context.environment||'live')}:undefined,current=splitEntitySnapshot(sourceSnapshot,splitOptions),queued=latestQueuedEntityChanges(queue),changes=[],keys=new Set([...current.keys(),...knownEntities.keys(),...queued.keys()]),suppressed=suppressedEntityKeys instanceof Set?suppressedEntityKeys:new Set(asArray(suppressedEntityKeys).map(String));
  for(const key of keys){if(conflicts.has(key)||suppressed.has(key))continue;const entity=current.get(key),known=knownEntities.get(key),pending=queued.get(key),split=key.indexOf(':'),type=entity?.type||key.slice(0,split),entityId=entity?.id||key.slice(split+1);let change=null;
    if(!pending&&!entityTypeWasReadableOrWritable(type))continue;
    if(entity){if(pending&&pending.deleted!==true&&String(pending._fingerprint||'')===entity.fingerprint)continue;if(!pending&&known&&!known.deleted&&known.fingerprint===entity.fingerprint)continue;change={type,id:entityId,baseVersion:nextLocalBaseVersion(type,entityId,known?.version,queue),payload:entity.payload,deleted:false,_fingerprint:entity.fingerprint}}
    else{if(pending?.deleted===true||(!pending&&(!known||known.deleted)))continue;if(!pending&&!allowInferredDeletes){if(Array.isArray(suppressedDeletes))suppressedDeletes.push({type,id:entityId,version:Number(known?.version)||0});continue}change={type,id:entityId,baseVersion:nextLocalBaseVersion(type,entityId,known?.version,queue),deleted:true,payload:null,_fingerprint:''}}
    if(serverEquivalentWarehouseMetadataChangeV784(change,serverEntities,context))continue;changes.push(change)
  }
  return requireWritableLocalEntityChanges(changes,context||{companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()},reason);
}
function validateEntityBatchAck(result,changes,expectedCommandId){
  const commandId=String(expectedCommandId||''),cursor=Number(result?.cursor),entities=asArray(result?.entities);if(!commandId||String(result?.commandId||'')!==commandId)throw outboxError('ENTITY_ACK_COMMAND_MISMATCH','VPS вернул подтверждение другой команды. Локальная команда сохранена для безопасного повтора.');if(!Number.isSafeInteger(cursor)||cursor<0||entities.length!==changes.length)throw outboxError('ENTITY_ACK_INCOMPLETE','VPS вернул неполное или повреждённое подтверждение. Локальная команда не удалена.');
  const expected=new Map(changes.map(change=>[entityKey(change.type,change.id),change])),seen=new Set();let maxEventId=0;for(const item of entities){const key=entityKey(item?.type,item?.id),change=expected.get(key),version=Number(item?.version),eventId=Number(item?.eventId);if(!change||seen.has(key)||(item?.deleted===true)!==(change.deleted===true)||!Number.isSafeInteger(version)||version<0||!Number.isSafeInteger(eventId)||eventId<0||!/^[a-f0-9]{64}$/i.test(String(item?.digest||'')))throw outboxError('ENTITY_ACK_INVALID','VPS вернул подтверждение с неверной записью, версией или контрольной суммой. Локальная команда не удалена.');const expectedVersion=(item?.unchanged===true)?Number(change.baseVersion)||0:(Number(change.baseVersion)||0)+1;if(version!==expectedVersion||item?.unchanged!==true&&eventId<=0)throw outboxError('ENTITY_ACK_VERSION_MISMATCH','VPS не подтвердил ожидаемую версию записи. Локальная команда сохранена.');seen.add(key);maxEventId=Math.max(maxEventId,eventId)}if(seen.size!==expected.size||cursor<maxEventId)throw outboxError('ENTITY_ACK_INCOMPLETE','VPS не подтвердил каждую изменённую запись или вернул устаревший курсор.');return true
}
function acceptEntityBatchResult(result,changes,expectedCommandId,expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch){
  assertEntityScope(expectedScope,expectedEpoch);
  validateEntityBatchAck(result,changes,expectedCommandId);
  const previousKnown=new Map(cloudSyncState.known),previousCursor=cloudSyncState.cursor,previousBaseline=cloneValue(cloudSyncState.localBaseline),byKey=new Map(changes.map(item=>[entityKey(item.type,item.id),item]));
  try{
    for(const item of asArray(result.entities)){
      const pending=byKey.get(entityKey(item.type,item.id));
      cloudSyncState.known.set(entityKey(item.type,item.id),{version:Number(item.version)||0,digest:String(item.digest||''),fingerprint:item.deleted?'':pending?semanticEntityFingerprintV784(item.type,item.id,pending.payload,{warehouseId:activeWarehouseId(),environment:activeEnvironment()}):'',deleted:item.deleted===true,eventId:Number(item.eventId)||0})
    }
    if(cloudSyncState.localBaseline){const confirmed=cloneValue(cloudSyncState.localBaseline);for(const change of changes)applyEntityToSnapshot(confirmed,change,change.deleted===true);rememberLocalEntityBaseline(confirmed)}
    cloudSyncState.cursor=Math.max(cloudSyncState.cursor,Number(result.cursor)||0);saveEntitySyncState({required:true})
  }catch(error){cloudSyncState.known=previousKnown;cloudSyncState.cursor=previousCursor;cloudSyncState.localBaseline=previousBaseline;throw error}
}
function nextLocalBaseVersion(type,id,knownVersion,queue=null,excludeCommandId=''){
  try{queue=queue||requireLocalOutbox();let version=Number(knownVersion)||0;for(const entry of queue.list(['pending','sending'])){if(excludeCommandId&&entry.commandId===excludeCommandId)continue;for(const change of entry.changes)if(change.type===String(type)&&change.id===String(id))version=(Number(change.baseVersion)||0)+1}return version}catch{return Number(knownVersion)||0}
}
function entityChangesBetween(beforeSnapshot,afterSnapshot,{includeOutbox=true,knownEntities=cloudSyncState.known,queue=null,context=null}={}){
  const splitOptions=context?{warehouseId:String(context.warehouseId||''),environment:String(context.environment||'live')}:undefined,before=splitEntitySnapshot(beforeSnapshot,splitOptions),after=splitEntitySnapshot(afterSnapshot,splitOptions),keys=new Set([...before.keys(),...after.keys()]),changes=[];
  for(const key of keys){const previous=before.get(key),next=after.get(key);if(previous?.fingerprint===next?.fingerprint)continue;const split=key.indexOf(':'),type=key.slice(0,split),id=key.slice(split+1),known=knownEntities.get(key),baseVersion=includeOutbox?nextLocalBaseVersion(type,id,known?.version,queue):Number(known?.version)||0;changes.push({type,id,baseVersion,deleted:!next,payload:next?.payload||null,_fingerprint:next?.fingerprint||''})}
  return changes
}
function ordinaryEntityRecoverySnapshot(snapshot,context,queue=requireLocalOutbox()){
  const entities=[];for(const item of splitEntitySnapshot(snapshot,{warehouseId:context.warehouseId,environment:context.environment}).values()){const known=cloudSyncState.known.get(entityKey(item.type,item.id));entities.push({type:item.type,id:item.id,fingerprint:item.fingerprint,baseVersion:nextLocalBaseVersion(item.type,item.id,known?.version,queue)})}
  return{warehouse:{id:String(context.warehouseId)},data:{ordinaryEntityBaseline:entities},schemaVersion:1}
}
function ordinaryEntityChangesFromRecovery(journal,currentSnapshot,queue=requireLocalOutbox()){
  const source=journal?.snapshot?.data?.ordinaryEntityBaseline;if(!Array.isArray(source)||Number(journal?.snapshot?.schemaVersion)!==1||source.length>10000)throw outboxError('ORDINARY_RECOVERY_BASELINE_INVALID','Аварийный журнал обычного изменения повреждён. Локальные данные оставлены заблокированными.');
  const baseline=new Map();for(const raw of source){const type=String(raw?.type||''),id=String(raw?.id||''),baseVersion=Number(raw?.baseVersion);if(!/^[A-Za-z0-9_-]{1,160}$/.test(type)||!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!Number.isSafeInteger(baseVersion)||baseVersion<0||baseline.has(entityKey(type,id)))throw outboxError('ORDINARY_RECOVERY_BASELINE_INVALID','Аварийный журнал обычного изменения содержит недопустимую запись.');baseline.set(entityKey(type,id),{type,id,fingerprint:String(raw?.fingerprint||''),baseVersion})}
  const context={warehouseId:String(journal.warehouseId),environment:String(journal.environment)},current=splitEntitySnapshot(currentSnapshot,context),keys=new Set([...baseline.keys(),...current.keys()]),changes=[];
  for(const key of keys){const previous=baseline.get(key),next=current.get(key);if(previous?.fingerprint===next?.fingerprint)continue;const split=key.indexOf(':'),type=next?.type||previous?.type||key.slice(0,split),id=next?.id||previous?.id||key.slice(split+1),known=cloudSyncState.known.get(key),baseVersion=previous?previous.baseVersion:nextLocalBaseVersion(type,id,known?.version,queue,String(journal.commandId||''));changes.push({type,id,baseVersion,deleted:!next,payload:next?.payload||null,_fingerprint:next?.fingerprint||''})}
  return changes
}
async function waitForEntitySyncIdle(){
  const requested=window.__JF_RUNTIME_TEST__?Number(window.__entitySyncIdleTimeoutMs):NaN,timeoutMs=Number.isFinite(requested)?Math.max(100,Math.min(15000,requested)):15000,deadline=Date.now()+timeoutMs;
  while((currentEntityInFlight()||currentEntityBootstrapInFlight())&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(currentEntityInFlight()||currentEntityBootstrapInFlight())throw outboxError('ENTITY_SYNC_BUSY','Синхронизация занята другой операцией. Повторите действие.')
}
function localOutboxEntry(intent,changes,context={}){
  return{commandId:String(context.commandId||newEntityCommandId()),companyId:String(context.companyId??desktopSession?.auth?.company?.id??''),warehouseId:String(context.warehouseId??activeWarehouseId()),environment:String(context.environment??activeEnvironment()),authorUserId:currentEntityUserId(),deviceId:localOutboxDeviceId(),intent:{kind:String(intent?.kind||'local_change'),targetId:String(intent?.targetId||'')},changes}
}
const SERVER_ENTITY_INTENTS_V783=new Set(['route_approve','route_picking','route_cancel','route_start','route_return','route_close','pickup_ready','pickup_collected']);
function serverEntityIntentV783(intent){
  const kind=String(intent?.kind||''),targetId=String(intent?.targetId||'');
  return SERVER_ENTITY_INTENTS_V783.has(kind)&&/^[A-Za-z0-9_-]{1,160}$/.test(targetId)?{kind,targetId}:null
}
function retryableEntityFailure(value){
  const code=String(value?.code||value?.errorCode||'').toUpperCase(),message=String(value?.message||value?.error||'').toUpperCase();
  return/(TIMEOUT|NETWORK|UNAVAILABLE|CONNECTION|ECONN|ABORT|TEMPORARY|BUSY|RATE_LIMIT|HTTP_5)/.test(`${code} ${message}`)
}
function definitiveEntityRejection(value){return value?.writeOutcome==='definitive_rejection'}
function outboxRetryDelay(attempts){return Math.min(300000,1000*(2**Math.min(8,Math.max(0,Number(attempts)||0))))}
function scheduleOutboxDrain(delay=0){
  if(isTrainingEnvironment()||!onlineEntitySyncAvailable())return;clearTimeout(cloudSyncState.retryTimer);cloudSyncState.retryTimer=setTimeout(()=>{cloudSyncState.retryTimer=null;drainLocalOutbox().catch(reportCloudSyncFailure)},Math.max(0,Number(delay)||0))
}
function blockingOutboxEntries(queue=requireLocalOutbox()){return queue.overlayEntries().filter(entry=>entry.state==='conflict'||entry.state==='rejected')}
function markOutboxEntityConflict(key,details){
  const queue=requireLocalOutbox();for(const entry of queue.list(['pending','sending']))if(entry.changes.some(change=>entityKey(change.type,change.id)===key))queue.markConflict(entry.commandId,details);cloudSyncState.dirty=queue.status().active>0;renderLocalOutboxStatus()
}
function criticalRecoveryContext(){return{companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()}}
function criticalRecoveryApi(){const api=window.TeplitsaWarehouseV600?.criticalRecovery;if(!api?.prepare||!api?.read||!api?.clear)throw outboxError('CRITICAL_RECOVERY_UNAVAILABLE','Модуль аварийного отката не загружен. Критическая операция остановлена.');return api}
async function prepareCriticalEntityRecovery(snapshot,context,commandId,intent,extra={}){const phase=extra.phase==='pending_server'?'pending_server':extra.phase==='ordinary_prepared'?'ordinary_prepared':'prepared',authorUserId=currentEntityUserId();if(!validEntityRecoveryUserId(authorUserId))throw outboxError('ENTITY_RECOVERY_JOURNAL_OWNER_REQUIRED','Критическая операция остановлена: пользователь не подтверждён.');return criticalRecoveryApi().prepare({...context,commandId,authorUserId,intent:cloneValue(intent),snapshot:cloneValue(snapshot),phase,changes:phase==='pending_server'?cloneValue(extra.changes):[],postSnapshot:phase==='pending_server'?cloneValue(extra.postSnapshot):null,createdAt:String(extra.createdAt||new Date().toISOString()),updatedAt:new Date().toISOString()})}
async function clearCriticalEntityRecovery(context,commandId=''){return criticalRecoveryApi().clear(context.warehouseId,context.environment,context.companyId,String(commandId||''))}
function blockForCriticalRecovery(error,message){const blocked=error instanceof Error?error:outboxError('CRITICAL_RECOVERY_FAILED',String(error));cloudSyncState.contextBlockedError=blocked;blockWorkspaceAfterWarehouseChange(message||'Аварийное восстановление критической операции не подтверждено. Рабочее пространство заблокировано.');return blocked}
async function recoverCriticalEntityMutation(){
  if(isTrainingEnvironment())return false;const context=criticalRecoveryContext();if(!context.companyId||!context.warehouseId)return false;let journal;
  try{
    resetEntityScope();const queue=requireLocalOutbox();assertEntityRecoveryOwnership({queue});journal=await criticalRecoveryApi().read(context.warehouseId,context.environment,context.companyId);if(!journal)return false;if(String(journal.companyId)!==context.companyId||String(journal.warehouseId)!==context.warehouseId||String(journal.environment)!==context.environment)throw outboxError('CRITICAL_RECOVERY_SCOPE_MISMATCH','Аварийный журнал относится к другой компании, среде или складу.');assertEntityRecoveryOwnership({queue,journalOwnerUserId:String(journal.authorUserId||''),legacyJournal:Number(journal.schemaVersion)<3||!journal.authorUserId});
    if(journal.phase==='ordinary_prepared'){
      const queue=requireLocalOutbox(),changes=ordinaryEntityChangesFromRecovery(journal,cloneValue(buildBackupPayload()),queue),existing=queue.get(String(journal.commandId));if(existing){const sameChanges=JSON.stringify(stableEntityValue(existing.changes))===JSON.stringify(stableEntityValue(changes));if(existing.companyId!==context.companyId||existing.warehouseId!==context.warehouseId||existing.environment!==context.environment||String(existing.intent?.kind||'')!==String(journal.intent?.kind||'')||String(existing.intent?.targetId||'')!==String(journal.intent?.targetId||'')||!sameChanges)throw outboxError('ORDINARY_RECOVERY_COMMAND_COLLISION','Аварийный журнал и локальная очередь содержат разные операции с одним command_id.');cloudSyncState.dirty=queue.status().active>0;persistEntityDirty(cloudSyncState.dirty);await clearCriticalEntityRecovery(context,journal.commandId);cloudSyncState.contextBlockedError=null;audit('ordinary_mutation_recovered_after_restart',{commandId:String(journal.commandId||''),kind:String(journal.intent?.kind||''),changes:existing.changes.length,queued:true,alreadyDurable:true,warehouseId:context.warehouseId,environment:context.environment});return true}
      if(changes.length>1000)throw outboxError('ORDINARY_RECOVERY_TOO_LARGE','Прерванное изменение затронуло больше 1000 записей. Автоматическая синхронизация остановлена без потери локальных данных.');
      let entry=null;if(changes.length){entry=queue.enqueue(localOutboxEntry(journal.intent,changes,{...context,commandId:String(journal.commandId)}));cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;renderLocalOutboxStatus()}
      await clearCriticalEntityRecovery(context,journal.commandId);cloudSyncState.contextBlockedError=null;audit('ordinary_mutation_recovered_after_restart',{commandId:String(journal.commandId||''),kind:String(journal.intent?.kind||''),changes:changes.length,queued:Boolean(entry),warehouseId:context.warehouseId,environment:context.environment});return true
    }
    if(journal.phase!=='pending_server'){
      const restored=await rollbackLocalSnapshot(journal.snapshot);if(restored!==true)throw outboxError('CRITICAL_RECOVERY_NOT_DURABLE','Аварийный откат не подтверждён диском.');await clearCriticalEntityRecovery(context,journal.commandId);cloudSyncState.contextBlockedError=null;audit('critical_mutation_recovered_after_restart',{commandId:String(journal.commandId||''),kind:String(journal.intent?.kind||''),phase:'prepared',warehouseId:context.warehouseId,environment:context.environment});return true
    }
    const postRestored=await rollbackLocalSnapshot(journal.postSnapshot);if(postRestored!==true)throw outboxError('CRITICAL_RECOVERY_POST_NOT_DURABLE','Результат критической операции не подтверждён локальным диском.');
    if(!onlineEntitySyncAvailable())throw outboxError('CRITICAL_RECOVERY_SERVER_UNAVAILABLE','Критическая операция ожидает сверки с VPS. Подключите рабочий VPS и повторите проверку.');
    let result;try{result=await window.JustFunDesktop.regVps.syncEntities({warehouseId:context.warehouseId,environment:context.environment,commandId:String(journal.commandId),changes:journal.changes.map(({_fingerprint,...change})=>change),intent:cloneValue(journal.intent)})}catch(error){throw outboxError(String(error?.code||'CRITICAL_RECOVERY_NETWORK_UNCERTAIN'),String(error?.message||'Ответ VPS потерян. Команда сохранена для безопасного повтора.'),{retryable:true})}
    if(!result?.ok){const failure=outboxError(String(result?.code||'ENTITY_COMMAND_FAILED'),String(result?.error||'VPS отклонил критическую операцию.'),asObject(result?.details));if(!definitiveEntityRejection(result)||retryableEntityFailure(failure))throw failure;const restored=await rollbackLocalSnapshot(journal.snapshot);if(restored!==true)throw outboxError('CRITICAL_RECOVERY_NOT_DURABLE','VPS отклонил операцию, но локальный откат не подтверждён диском.');await clearCriticalEntityRecovery(context,journal.commandId);cloudSyncState.contextBlockedError=null;audit('critical_mutation_rejected_after_restart',{commandId:String(journal.commandId),kind:String(journal.intent?.kind||''),code:String(failure.code||''),warehouseId:context.warehouseId,environment:context.environment});return true}
    acceptEntityBatchResult(result,journal.changes,String(journal.commandId),cloudSyncState.scope,cloudSyncState.scopeEpoch);await clearCriticalEntityRecovery(context,journal.commandId);cloudSyncState.contextBlockedError=null;audit('critical_mutation_confirmed_after_restart',{commandId:String(journal.commandId),kind:String(journal.intent?.kind||''),replayed:result.replayed===true,warehouseId:context.warehouseId,environment:context.environment});return true
  }catch(error){if(error?.details?.foreignRecovery===true||String(error?.code||'').includes('OWNER_')||String(error?.code||'').includes('USER_MISMATCH'))throw error;throw blockForCriticalRecovery(error,journal?.phase==='pending_server'?'Критическая операция сохранена, но ещё не сверена с VPS. Рабочее пространство заблокировано до безопасного повтора той же команды.':'После аварийного завершения не удалось надёжно вернуть данные. Рабочее пространство заблокировано; нужна диагностика хранилища.')}
}
function refreshVisibleOrderDetailAfterRollbackV784(){
  const modal=q('#detailModal');if(!modal?.classList?.contains('open'))return;const detailId=typeof currentDetailId!=='undefined'?String(currentDetailId||''):'';const current=detailId&&typeof orders!=='undefined'?asArray(orders).find(item=>String(item?.id||'')===detailId):null;if(current&&typeof window.openDetails==='function')window.openDetails(detailId);else window.closeDetailModal?.()
}
async function rollbackLocalSnapshot(snapshot){
  if(!snapshot||typeof window.TeplitsaWarehouseV600?.importServerSnapshot!=='function')return false;cloudSyncState.suspended++;try{const imported=await window.TeplitsaWarehouseV600.importServerSnapshot(snapshot),persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();if(imported===false||persisted===false||window.__warehousePersistenceCritical)throw outboxError('LOCAL_ROLLBACK_NOT_DURABLE','Откат локальной базы не подтверждён хранилищем. Рабочий контекст оставлен заблокированным.');rememberLocalEntityBaseline(snapshot);window.renderAll?.();refreshVisibleOrderDetailAfterRollbackV784();return true}finally{cloudSyncState.suspended--}
}
const outboxDrainChains=new Map();
function drainLocalOutbox(options={}){
  resetEntityScope();const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,key=expectedScope,previous=outboxDrainChains.get(key)||Promise.resolve();let chain;
  const run=()=>drainLocalOutboxNow({...options,expectedScope,expectedEpoch});chain=previous.then(run,run).finally(()=>{if(outboxDrainChains.get(key)===chain)outboxDrainChains.delete(key)});outboxDrainChains.set(key,chain);return chain
}
async function drainLocalOutboxNow({targetCommandId='',force=false,expectedScope='',expectedEpoch=null}={}){
  if(isTrainingEnvironment()||!onlineEntitySyncAvailable())return{state:'offline'};
  resetEntityScope();expectedScope=expectedScope||cloudSyncState.scope;expectedEpoch=expectedEpoch==null?cloudSyncState.scopeEpoch:expectedEpoch;if(!entityScopeIsCurrent(expectedScope,expectedEpoch))return{state:'stale-scope'};const queue=requireLocalOutbox();assertEntityRecoveryOwnership({scope:expectedScope,queue});const drainSerial=cloudSyncState.serial,dirtyGenerationAtStart=entityDirtyGeneration(expectedScope);if(!cloudSyncState.bootstrapped)await bootstrapEntitySync();if(!entityScopeIsCurrent(expectedScope,expectedEpoch))return{state:'stale-scope'};await waitForEntitySyncIdle();if(!entityScopeIsCurrent(expectedScope,expectedEpoch))return{state:'stale-scope'};
  const blockedKeys=queue.blockedEntityKeys();beginEntityInFlight(expectedScope,expectedEpoch);let targetEntry=targetCommandId?queue.get(targetCommandId):null,targetState=targetEntry?.state==='conflict'?'conflict':targetEntry?.state==='rejected'?'rejected':'pending';
  try{
    const ready=()=>queue.ready(force?Number.MAX_SAFE_INTEGER:Date.now(),blockedKeys);for(let entry=ready();entry;entry=ready()){
      if(!entityScopeIsCurrent(expectedScope,expectedEpoch))break;entry=queue.markSending(entry.commandId);renderLocalOutboxStatus();let result;
      try{const serverIntent=serverEntityIntentV783(entry.intent);result=await window.JustFunDesktop.regVps.syncEntities({warehouseId:entry.warehouseId,environment:entry.environment,commandId:entry.commandId,changes:entry.changes.map(({_fingerprint,...change})=>change),...(serverIntent?{intent:serverIntent}:{})})}
      catch(error){const details={code:String(error?.code||'ENTITY_NETWORK_ERROR'),message:String(error?.message||error)};queue.markPending(entry.commandId,details,outboxRetryDelay(entry.attempts));if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}if(entityScopeIsCurrent(expectedScope,expectedEpoch))scheduleOutboxDrain(outboxRetryDelay(entry.attempts));break}
      if(result?.ok){
        if(!entityScopeIsCurrent(expectedScope,expectedEpoch)){queue.markPending(entry.commandId,{code:'OUTBOX_ACK_SCOPE_DEFERRED',message:'VPS подтвердил команду после смены рабочего контекста. Она будет безопасно сверена повтором с тем же command_id.'},0);if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}break}
        try{acceptEntityBatchResult(result,entry.changes,entry.commandId,expectedScope,expectedEpoch);queue.markConfirmed(entry.commandId,{cursor:Number(result.cursor)||0,replayed:result.replayed===true})}catch(error){try{queue.markPending(entry.commandId,{code:String(error?.code||'ENTITY_ACK_PERSIST_FAILED'),message:String(error?.message||error)},0)}catch{}throw error}
        if(entry.commandId===targetCommandId){targetState='confirmed';targetEntry=queue.get(entry.commandId)}continue
      }
      const failure={code:String(result?.code||'ENTITY_COMMAND_FAILED'),message:String(result?.error||'VPS отклонил изменение.'),details:asObject(result?.details)};
      if(!definitiveEntityRejection(result)){queue.markPending(entry.commandId,failure,outboxRetryDelay(entry.attempts));if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}if(entityScopeIsCurrent(expectedScope,expectedEpoch))scheduleOutboxDrain(outboxRetryDelay(entry.attempts));break}
      if(failure.code.toLowerCase()==='entity_version_conflict'){
        queue.markConflict(entry.commandId,failure);const declaredType=String(failure.details?.entity_type||failure.details?.type||''),declaredId=String(failure.details?.entity_id||failure.details?.id||''),declaredKey=declaredType&&declaredId?entityKey(declaredType,declaredId):'',affected=declaredKey&&entry.changes.some(change=>entityKey(change.type,change.id)===declaredKey)?entry.changes.filter(change=>entityKey(change.type,change.id)===declaredKey):entry.changes;for(const change of entry.changes)blockedKeys.add(entityKey(change.type,change.id));if(entityScopeIsCurrent(expectedScope,expectedEpoch)){for(const change of affected)cloudSyncState.conflicts.set(entityKey(change.type,change.id),{...failure.details,type:change.type,id:change.id,commandId:entry.commandId,detectedAt:new Date().toISOString()});saveEntitySyncState()}if(entry.commandId===targetCommandId){targetState='conflict';targetEntry=queue.get(entry.commandId)}continue
      }
      if(retryableEntityFailure(failure)){queue.markPending(entry.commandId,failure,outboxRetryDelay(entry.attempts));if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}if(entityScopeIsCurrent(expectedScope,expectedEpoch))scheduleOutboxDrain(outboxRetryDelay(entry.attempts));break}
      queue.markRejected(entry.commandId,failure,true);for(const change of entry.changes)blockedKeys.add(entityKey(change.type,change.id));if(entityScopeIsCurrent(expectedScope,expectedEpoch)){for(const change of entry.changes)cloudSyncState.conflicts.set(entityKey(change.type,change.id),{...failure.details,type:change.type,id:change.id,commandId:entry.commandId,state:'rejected',code:failure.code,detectedAt:new Date().toISOString()});saveEntitySyncState()}if(entry.commandId===targetCommandId){targetState='rejected';targetEntry=queue.get(entry.commandId)}continue
    }
  }finally{if(entityScopeIsCurrent(expectedScope,expectedEpoch)){settleEntityDirty(expectedScope,queue,{generationAtStart:dirtyGenerationAtStart,serialAtStart:drainSerial});renderLocalOutboxStatus()}else settleEntityDirty(expectedScope,queue,{generationAtStart:dirtyGenerationAtStart,serialAtStart:drainSerial,updateCurrent:false});endEntityInFlight(expectedScope,expectedEpoch)}
  const state=queue.status();if(entityScopeIsCurrent(expectedScope,expectedEpoch)){if(!state.active){integrationBadge('jfRegBadge','Синхронизировано','ready');integrationStatus('jfRegStatus','Все локальные изменения подтверждены VPS.','ok')}else if(state.resolutionPending)integrationStatus('jfRegStatus','Выбранная серверная версия сохранена и ожидает завершения локального восстановления.','error');else if(state.pending||state.sending)integrationStatus('jfRegStatus',`На компьютере сохранено изменений: ${state.pending+state.sending}. Отправка будет повторена автоматически.`,'error');else integrationStatus('jfRegStatus',`Требуют решения: ${state.conflict+state.rejectedActive}. Локальные данные не удалены.`,'error')}
  return{state:targetCommandId?targetState:(state.active?'pending':'confirmed'),entry:targetEntry}
}
let entityCommandChain=Promise.resolve();
function commitEntityMutation(intent,mutation){
  if(isTrainingEnvironment())return Promise.resolve().then(mutation);
  try{assertEntityContextChangeAllowed({kind:'business-mutation',intent:String(intent?.kind||''),targetId:String(intent?.targetId||'')})}catch(error){toast(error?.message||'Рабочее пространство заблокировано до безопасного восстановления данных.','error');audit('business_mutation_blocked_by_context',{kind:String(intent?.kind||''),targetId:String(intent?.targetId||''),code:String(error?.code||'ENTITY_CONTEXT_BLOCKED')});return Promise.resolve(false)}
  const critical=intent?.critical!==false;
  const correlationId=id(),auditDetail={kind:intent?.kind||'',targetId:intent?.targetId||'',critical};
  audit('business_mutation_started',auditDetail,correlationId);
  if(critical&&!onlineEntitySyncAvailable()){const message='Эта критическая операция требует подтверждения рабочего VPS. Обычные данные можно продолжать сохранять локально.';toast(message,'error');audit('critical_server_mutation_offline_blocked',auditDetail,correlationId);return Promise.resolve(false)}
  const execute=async()=>{
    let rollbackSnapshot=null,localCommandPersisted=false,operationScope='',operationEpoch=0,operationContext=null,operationQueue=null,operationFlightStarted=false,criticalFlight=false,ordinaryFlight=false,criticalRecoveryAttempted=false,criticalRecoveryPrepared=false,criticalRecoveryPendingServer=false,criticalTerminalRejected=false,criticalCommandId='',serverConfirmed=false,ordinaryDirtyPrearm=null,ordinaryRecoveryAttempted=false,ordinaryRecoveryPrepared=false,ordinaryCommandId='';
    try{
      resetEntityScope();const queue=requireLocalOutbox();operationQueue=queue;operationScope=cloudSyncState.scope;operationEpoch=cloudSyncState.scopeEpoch;operationContext={companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()};
      if(critical){
        await waitForEntitySyncIdle();if(cloudSyncState.dirty)await backgroundCloudUpload({force:true});else{await bootstrapEntitySync();await drainLocalOutbox({force:true})}assertEntityScope(operationScope,operationEpoch);await waitForEntitySyncIdle();assertEntityScope(operationScope,operationEpoch);const pending=queue.status();if(pending.active||cloudSyncState.dirty)throw new Error('Сначала синхронизируйте или разрешите локальные изменения. Критическая операция не выполнена.');if(cloudSyncState.conflicts.size)throw new Error('Сначала разрешите конфликт серверных записей. Операция не выполнена.');beginEntityInFlight(operationScope);operationFlightStarted=true;beginCriticalEntityFlight(operationScope);criticalFlight=true
      }else if(onlineEntitySyncAvailable()){
        try{await waitForEntitySyncIdle();if(cloudSyncState.dirty)await backgroundCloudUpload();else{await bootstrapEntitySync();await drainLocalOutbox()}assertEntityScope(operationScope,operationEpoch)}catch(error){if(error?.code==='ENTITY_SCOPE_CHANGED'||currentEntityInFlight()||currentEntityBootstrapInFlight())throw error;reportCloudSyncFailure(error)}
      }
      if(!critical){beginEntityInFlight(operationScope);operationFlightStarted=true;beginOrdinaryEntityFlight(operationScope);ordinaryFlight=true}
      // The application mutates many records and arrays in place.  A live reference here
      // makes the "before" snapshot change together with the UI and hides the mutation
      // from the durable outbox (payments, new orders, archive and pickup reservations).
      assertEntityScope(operationScope,operationEpoch);rollbackSnapshot=cloneValue(buildBackupPayload());if(critical){criticalCommandId=newEntityCommandId();criticalRecoveryAttempted=true;await prepareCriticalEntityRecovery(rollbackSnapshot,operationContext,criticalCommandId,intent);criticalRecoveryPrepared=true}else{ordinaryCommandId=newEntityCommandId();ordinaryRecoveryAttempted=true;await prepareCriticalEntityRecovery(ordinaryEntityRecoverySnapshot(rollbackSnapshot,operationContext,queue),operationContext,ordinaryCommandId,intent,{phase:'ordinary_prepared'});ordinaryRecoveryPrepared=true;ordinaryDirtyPrearm=prearmEntityDirty(operationScope);cloudSyncState.dirty=true}cloudSyncState.suspended++;let mutationResult;try{mutationResult=await mutation();const persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();if(persisted===false||window.__warehousePersistenceCritical)throw outboxError('LOCAL_MUTATION_NOT_DURABLE','Локальная база не подтвердила запись операции. Изменение отменено.')}finally{cloudSyncState.suspended--}assertEntityScope(operationScope,operationEpoch);const afterSnapshot=cloneValue(buildBackupPayload()),changes=entityChangesBetween(rollbackSnapshot,afterSnapshot,{includeOutbox:!critical});
      if(!changes.length){if(criticalRecoveryPrepared){await clearCriticalEntityRecovery(operationContext,criticalCommandId);criticalRecoveryPrepared=false}else{if(ordinaryRecoveryPrepared){await clearCriticalEntityRecovery(operationContext,ordinaryCommandId);ordinaryRecoveryPrepared=false}clearUnusedEntityDirtyPrearm(ordinaryDirtyPrearm,queue)}audit('business_mutation_no_change',auditDetail,correlationId);return mutationResult}
      if(changes.length>1000)throw new Error('Операция изменила больше 1000 записей и безопасно остановлена. Разделите действие на несколько частей.');
      const blocked=queue.blockedEntityKeys(),blockedChange=changes.find(change=>blocked.has(entityKey(change.type,change.id)));if(blockedChange)throw outboxError('OUTBOX_ENTITY_BLOCKED',`Запись ${blockedChange.type}/${blockedChange.id} уже требует разрешения конфликта. Новое изменение отменено.`);
      if(!critical){
        const entry=queue.enqueue(localOutboxEntry(intent,changes,{...operationContext,commandId:ordinaryCommandId}));localCommandPersisted=true;await clearCriticalEntityRecovery(operationContext,ordinaryCommandId);ordinaryRecoveryPrepared=false;releaseEntityDirtyPrearm(ordinaryDirtyPrearm);cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;renderLocalOutboxStatus();audit('local_entity_command_saved',{...auditDetail,commandId:entry.commandId,changes:changes.length,warehouseId:entry.warehouseId,environment:entry.environment},correlationId);
        if(ordinaryFlight){endOrdinaryEntityFlight(operationScope);ordinaryFlight=false}if(operationFlightStarted){endEntityInFlight(operationScope);operationFlightStarted=false}
        if(!onlineEntitySyncAvailable()){audit('business_mutation_pending',{...auditDetail,commandId:entry.commandId,changes:changes.length,state:'offline'},correlationId);toast('Изменение сохранено на этом компьютере и ожидает синхронизации.','success');return mutationResult}
        const sent=await drainLocalOutbox({targetCommandId:entry.commandId});
        if(sent.state==='rejected'){
          if(await rollbackLocalSnapshot(rollbackSnapshot)){queue.markRejected(entry.commandId,asObject(sent.entry?.lastError),false);for(const change of changes)cloudSyncState.conflicts.delete(entityKey(change.type,change.id));cloudSyncState.dirty=queue.status().active>0;persistEntityDirty(cloudSyncState.dirty);saveEntitySyncState();renderLocalOutboxStatus()}
          throw outboxError(String(sent.entry?.lastError?.code||'ENTITY_COMMAND_REJECTED'),String(sent.entry?.lastError?.message||'VPS отклонил локальное изменение.'),asObject(sent.entry?.lastError?.details))
        }
        audit(sent.state==='confirmed'?'business_mutation_confirmed':'business_mutation_pending',{...auditDetail,commandId:entry.commandId,changes:changes.length,state:sent.state},correlationId);if(sent.state==='confirmed')toast('Изменение сохранено локально и подтверждено VPS.','success');else if(sent.state==='conflict')toast('Изменение сохранено локально, но конфликтует с серверной версией. Данные не потеряны.','error');else toast('Изменение сохранено локально и будет отправлено повторно.','success');return mutationResult
      }
      await prepareCriticalEntityRecovery(rollbackSnapshot,operationContext,criticalCommandId,intent,{phase:'pending_server',changes,postSnapshot:afterSnapshot});criticalRecoveryPendingServer=true;
      clearTimeout(cloudSyncState.uploadTimer);const warehouseId=operationContext.warehouseId,environment=operationContext.environment,commandId=criticalCommandId,result=await window.JustFunDesktop.regVps.syncEntities({warehouseId,environment,commandId,changes:changes.map(({_fingerprint,...item})=>item),intent});
      if(!result)throw outboxError('ENTITY_RESPONSE_MISSING','Ответ VPS потерян. Критическая команда сохранена для безопасного повтора.');
      if(!result.ok){const failure=Object.assign(new Error(result.error||'VPS отклонил изменение.'),{code:result.code||'ENTITY_COMMAND_FAILED',details:result.details||{}});if(definitiveEntityRejection(result)&&!retryableEntityFailure(failure))criticalTerminalRejected=true;throw failure}
      serverConfirmed=true;assertEntityScope(operationScope,operationEpoch);acceptEntityBatchResult(result,changes,commandId,operationScope,operationEpoch);await clearCriticalEntityRecovery(operationContext,commandId);criticalRecoveryPrepared=false;audit('business_mutation_confirmed',{...auditDetail,commandId,changes:changes.length,state:'confirmed'},correlationId);integrationBadge('jfRegBadge','Операция подтверждена сервером','ready');const success=({route_approve:'Согласование рейса подтверждено сервером.',route_picking:'Комплектация рейса подтверждена сервером.',route_cancel:'Рейс отменён, складской резерв освобождён.',route_start:'Выезд подтверждён сервером.',route_return:'Возврат машины подтверждён сервером.',route_close:'Рейс закрыт, склад и архив обновлены.',pickup_ready:'Резерв самовывоза подтверждён сервером.',pickup_collected:'Выдача и списание подтверждены сервером.'})[intent?.kind];if(success)toast(success,'success');return mutationResult
    }catch(error){
      const current=entityScopeIsCurrent(operationScope,operationEpoch);let rejection=error;
      if(serverConfirmed){rejection=blockForCriticalRecovery(error,'Сервер подтвердил критическую операцию, но аварийный журнал не очищен. Перезапустите программу для безопасного восстановления и повторной сверки с VPS.')}
      else if(critical&&criticalRecoveryPendingServer&&!criticalTerminalRejected){rejection=blockForCriticalRecovery(error,'Ответ VPS на критическую операцию не подтверждён. Команда и её результат сохранены; смена контекста заблокирована до безопасного повтора с тем же command_id.')}
      else if(!critical&&localCommandPersisted&&ordinaryRecoveryPrepared){rejection=blockForCriticalRecovery(error,'Локальная команда сохранена, но аварийный журнал не очищен. Перезапустите программу: команда будет восстановлена с тем же command_id.')}
      else if(current&&rollbackSnapshot&&(critical||!localCommandPersisted)){try{await rollbackLocalSnapshot(rollbackSnapshot);if(criticalRecoveryAttempted||ordinaryRecoveryAttempted){await clearCriticalEntityRecovery(operationContext,critical?criticalCommandId:ordinaryCommandId);criticalRecoveryPrepared=false;ordinaryRecoveryPrepared=false}if(ordinaryRecoveryAttempted&&operationQueue)clearUnusedEntityDirtyPrearm(ordinaryDirtyPrearm,operationQueue)}catch(rollbackError){rejection=rollbackError;if(critical||ordinaryRecoveryAttempted)blockForCriticalRecovery(rollbackError,'Операция не завершена, а безопасный локальный откат не подтверждён диском. Рабочий контекст заблокирован до аварийного восстановления.')}}
      else if(critical&&rollbackSnapshot&&!current){rejection=outboxError('ENTITY_SCOPE_CHANGED_DURING_CRITICAL','Контекст изменился в обход защитной блокировки во время критической операции. Автоматическая работа остановлена.');cloudSyncState.contextBlockedError=rejection;blockWorkspaceAfterWarehouseChange(rejection.message)}
      else if(!critical&&ordinaryRecoveryPrepared&&!current){rejection=outboxError('ENTITY_SCOPE_CHANGED_DURING_ORDINARY','Контекст изменился в обход защитной блокировки во время локального изменения. Аварийный журнал сохранён; автоматическая работа остановлена до безопасного восстановления исходного склада.');cloudSyncState.contextBlockedError=rejection;blockWorkspaceAfterWarehouseChange(rejection.message)}
      if(current&&['route_return','route_close'].includes(intent?.kind))window.closeRouteCloseModal?.();
      if(current&&!cloudSyncState.contextBlockedError){integrationBadge('jfRegBadge','Изменение отклонено','error');integrationStatus('jfRegStatus',rejection?.message||String(rejection),'error');toast(rejection?.message||String(rejection),'error')}audit('business_mutation_rejected',{...auditDetail,code:rejection?.code||'',state:'rejected'},correlationId);return false
    }finally{releaseEntityDirtyPrearm(ordinaryDirtyPrearm);if(criticalFlight)endCriticalEntityFlight(operationScope);if(ordinaryFlight)endOrdinaryEntityFlight(operationScope);if(operationFlightStarted)endEntityInFlight(operationScope)}
  };
  entityCommandChain=entityCommandChain.then(execute,execute);return entityCommandChain
}
function installEntityCommandGuards(){
  if(entityCommandGuardsInstalled)return;entityCommandGuardsInstalled=true;
  const currentOrderId=()=>typeof currentDetailId!=='undefined'?currentDetailId:'';
  const editId=selector=>()=>q(selector)?.value||'';
  const currentDriverRoute=()=>typeof currentDriverRouteId!=='undefined'?currentDriverRouteId:'';
  const specs={
    saveOrder:{kind:'order_save',critical:false,target:editId('#editingOrderId'),optionalTarget:true},savePickup:{kind:'pickup_save',critical:false,target:editId('#editingPickupId'),optionalTarget:true},deleteOrder:{kind:'order_delete',critical:false,target:args=>args[0]},clearAll:{kind:'workspace_clear',target:()=>activeWarehouseId()},toggleCurrentOrderPayment:{kind:'order_payment',critical:false,target:currentOrderId},retryCurrentDelivery:{kind:'order_retry',critical:false,target:currentOrderId},resolveCurrentPartial:{kind:'order_partial_resolution',critical:false,target:currentOrderId},confirmNotRelevant:{kind:'order_not_relevant',critical:false,target:()=>q('#notRelevantOrderId')?.value},
    saveProduct:{kind:'product_save',critical:false,target:editId('#productEditId'),optionalTarget:true},deleteProduct:{kind:'product_delete',critical:false,target:args=>args[0]},importProductsFromOrders:{kind:'product_import',critical:false,target:()=>activeWarehouseId()},saveInventoryMovement:{kind:'inventory_movement',critical:false,target:editId('#inventoryMovementProductId'),optionalTarget:true},reverseInventoryMovement:{kind:'inventory_movement_reverse',critical:false,target:args=>args[0]},
    saveDriver:{kind:'driver_save',critical:false,target:editId('#driverEditId'),optionalTarget:true},deleteDriver:{kind:'driver_delete',critical:false,target:args=>args[0]},
    saveReportCalculationSettings:{kind:'report_settings',critical:false,target:()=>activeWarehouseId()},saveReportEmployee:{kind:'report_employee_save',critical:false,target:editId('#reportEmployeeEditId'),optionalTarget:true},deleteReportEmployee:{kind:'report_employee_delete',critical:false,target:args=>args[0]},saveReportExpense:{kind:'report_expense_save',critical:false,target:editId('#reportExpenseEditId'),optionalTarget:true},deleteReportExpense:{kind:'report_expense_delete',critical:false,target:args=>args[0]},
    saveSettingsFromForm:{kind:'route_settings',critical:false,target:()=>activeWarehouseId()},saveDriverPaymentSettings:{kind:'driver_payment_settings',critical:false,target:()=>activeWarehouseId()},saveDeliveryPricingSettings:{kind:'delivery_pricing_settings',critical:false,target:()=>activeWarehouseId()},
    saveCompanySettingsV600:{kind:'company_settings',critical:false,target:()=>activeWarehouseId()},loadCompanyLogoV600:{kind:'company_logo_load',critical:false,target:()=>activeWarehouseId()},removeCompanyLogoV600:{kind:'company_logo_remove',critical:false,target:()=>activeWarehouseId()},
    buildAllRoutes:{kind:'route_plan_build_all',critical:false,target:()=>activeWarehouseId()},buildSingleRoute:{kind:'route_plan_build',critical:false,target:args=>args[0]},
    assignDriverToRoute:{kind:'route_driver_assign',critical:false,target:args=>args[0]},clearRouteDriver:{kind:'route_driver_clear',critical:false,target:currentDriverRoute},
    approveRouteManually:{kind:'route_approve',target:args=>args[0]},startRoutePicking:{kind:'route_picking',critical:false,target:args=>args[0]},cancelRouteBeforeStart:{kind:'route_cancel',target:args=>args[0]},startRoute:{kind:'route_start',target:args=>args[0]},openRouteClosure:{kind:'route_return',target:args=>args[0]},commitRouteClosure:{kind:'route_close',target:()=>q('#routeCloseId')?.value},markCurrentPickupReady:{kind:'pickup_ready',critical:false,target:currentOrderId},markCurrentPickupCollected:{kind:'pickup_collected',target:currentOrderId}
  };
  for(const[name,spec]of Object.entries(specs)){const base=window[name];if(typeof base!=='function')continue;window[name]=function(){const args=arguments,event=args[0];if(event&&typeof event.preventDefault==='function')event.preventDefault();const targetId=String(spec.target(args)||'');if(!targetId&&!spec.optionalTarget)return base.apply(this,args);return commitEntityMutation({kind:spec.kind,targetId,critical:spec.critical},()=>base.apply(this,args))}}
}
function reportCloudSyncFailure(error){
  let localChanges=Boolean(cloudSyncState.dirty);try{localChanges=localChanges||Number(cloudSyncState.outbox?.status?.().active||0)>0||durableEntityDirty(cloudSyncState.scope||entityScope())}catch{}
  const message=String(error?.message||error||'VPS не подтвердил операцию.'),code=String(error?.code||'BACKGROUND_SYNC_FAILED'),badge=localChanges?'Не сохранено на VPS':'Ошибка чтения VPS',status=localChanges?`Не сохранено на VPS: ${message}. Локальные изменения уже сохранены на этом компьютере; восстановите связь и повторите синхронизацию.`:`Не удалось получить данные VPS: ${message}. Локальных изменений для отправки нет; серверные записи не изменялись.`;
  try{integrationBadge('jfRegBadge',badge,'error')}catch{}
  try{integrationStatus('jfRegStatus',status,'error')}catch{}
  try{toast(localChanges?'Не сохранено на VPS. Локальные изменения ожидают подтверждения сервера.':'Не удалось получить данные VPS. Локальная база оставлена без изменений.','error')}catch{}
  try{audit('background_vps_sync_failed',{code,localChanges,warehouseId:activeWarehouseId(),environment:activeEnvironment()})}catch{}
  try{console.error('Background entity upload failed',error)}catch{}
}
function enqueueBackgroundSnapshot(queue,snapshot,{knownEntities,conflicts,context,kind='background_local_capture',serverEntities=[]}={}){
  const changes=buildPendingEntityChanges({snapshot,knownEntities,conflicts,queue,context,serverEntities,reason:kind});for(let offset=0;offset<changes.length;offset+=1000){const chunk=changes.slice(offset,offset+1000);queue.enqueue(localOutboxEntry({kind,targetId:context.warehouseId},chunk,context))}if(changes.length)persistEntityDirty(true,`${context.companyId}:${context.environment}:${context.warehouseId}`);return changes.length
}
async function backgroundCloudUpload({force=false}={}){
  if(isTrainingEnvironment())return;resetEntityScope();if(currentEntityInFlight()||currentEntityBootstrapInFlight()||ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0){clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);return}if(cloudSyncState.suspended){clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);return}const queue=requireLocalOutbox();assertEntityRecoveryOwnership({queue});const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,context={companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()};
  const captureSerial=cloudSyncState.serial,dirtyGenerationAtStart=entityDirtyGeneration(expectedScope),dirtyAtStart=cloudSyncState.dirty,knownAtStart=new Map(cloudSyncState.known),conflictsAtStart=new Map(cloudSyncState.conflicts);await window.TeplitsaWarehouseV600?.whenPersisted?.();if(!entityScopeIsCurrent(expectedScope,expectedEpoch)){let captured=0;if(dirtyAtStart){const stored=await window.TeplitsaWarehouseV600?.storedSnapshot?.(context.warehouseId,context.environment);if(!stored)throw outboxError('STALE_SCOPE_SNAPSHOT_UNAVAILABLE','Изменение прежнего склада сохранено локально, но его снимок не удалось поместить в очередь VPS.');captured=enqueueBackgroundSnapshot(queue,stored,{knownEntities:knownAtStart,conflicts:conflictsAtStart,context,kind:'stale_scope_local_capture'})}return{state:'stale-scope-captured',captured}}
  let captured=0;if(cloudSyncState.dirty)captured=enqueueBackgroundSnapshot(queue,cloneValue(buildBackupPayload()),{knownEntities:cloudSyncState.known,conflicts:cloudSyncState.conflicts,context});
  settleEntityDirty(expectedScope,queue,{generationAtStart:dirtyGenerationAtStart,serialAtStart:captureSerial});renderLocalOutboxStatus();if(captured)audit('background_local_entity_command_saved',{changes:captured,warehouseId:context.warehouseId,environment:context.environment});
  if(!onlineEntitySyncAvailable()){if(cloudSyncState.dirty)integrationStatus('jfRegStatus',`Изменения сохранены на компьютере: ${queue.status().active}. VPS будет синхронизирован после восстановления связи.`,'error');return}
  if(!cloudSyncState.bootstrapped)await bootstrapEntitySync();if(!entityScopeIsCurrent(expectedScope,expectedEpoch))return{state:'stale-scope'};await drainLocalOutbox({force});if(!entityScopeIsCurrent(expectedScope,expectedEpoch))return{state:'stale-scope'};if(cloudSyncState.serial!==captureSerial){cloudSyncState.dirty=true;persistEntityDirty(true);clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150)}return{state:'complete'}
}
async function flushEntitySyncBeforeContextChange(){
  if(isTrainingEnvironment())return true;
  assertEntityContextChangeAllowed({kind:'context-change-flush'});resetEntityScope();if(!onlineEntitySyncAvailable()){if(!desktopSession?.auth?.company?.data_service){await window.TeplitsaWarehouseV600?.whenPersisted?.();if(window.__warehousePersistenceCritical)throw new Error('Локальные данные не подтверждены на диске. Переключение склада остановлено.');return true}throw new Error('Рабочий VPS недоступен: локальные изменения сохранены, но перед сменой контекста должны быть синхронизированы.')}
  await waitForEntitySyncIdle();await backgroundCloudUpload({force:true});await waitForEntitySyncIdle();const state=requireLocalOutbox().status();
  if(cloudSyncState.conflicts.size||state.active||cloudSyncState.dirty)throw new Error(`VPS не подтвердил все локальные изменения. Ожидают или требуют решения: ${Math.max(state.active,cloudSyncState.dirty?1:0)}.`);
  return true
}
function simulateEntityRuntimeRestartForTest(){
  clearInterval(cloudSyncState.pollTimer);clearTimeout(cloudSyncState.uploadTimer);clearTimeout(cloudSyncState.retryTimer);cloudSyncState.pollTimer=null;cloudSyncState.uploadTimer=null;cloudSyncState.retryTimer=null;outboxDrainChains.clear();cloudSyncState.bootstrapFlights.clear();cloudSyncState.inFlightScopes.clear();cloudSyncState.criticalFlights.clear();cloudSyncState.ordinaryFlights.clear();cloudSyncState.ordinaryPrearms.clear();cloudSyncState.scope='';cloudSyncState.scopeEpoch++;cloudSyncState.bootstrapped=false;cloudSyncState.bootstrapPromise=null;cloudSyncState.outboxes=new Map();cloudSyncState.outbox=null;cloudSyncState.outboxError=null;cloudSyncState.localBaseline=null;cloudSyncState.contextBlockedError=null;entityCommandChain=Promise.resolve();resetEntityScope();return{scope:cloudSyncState.scope,dirty:cloudSyncState.dirty,generation:entityDirtyGeneration(cloudSyncState.scope),outbox:cloudSyncState.outbox?.status?.()||null}
}
async function simulateOrdinaryCrashForTest(mutation,beforeRestart=null,options={}){
  resetEntityScope();const scope=cloudSyncState.scope,queue=requireLocalOutbox(),context=criticalRecoveryContext(),commandId=newEntityCommandId(),beforeSnapshot=cloneValue(buildBackupPayload());await prepareCriticalEntityRecovery(ordinaryEntityRecoverySnapshot(beforeSnapshot,context,queue),context,commandId,options.intent||{kind:'runtime_ordinary_crash_test'},{phase:'ordinary_prepared'});const prearm=prearmEntityDirty(scope);cloudSyncState.dirty=true;cloudSyncState.suspended++;try{await mutation();const persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();if(persisted===false||window.__warehousePersistenceCritical)throw outboxError('LOCAL_MUTATION_NOT_DURABLE','Тестовая локальная операция не подтверждена диском.')}finally{cloudSyncState.suspended--}const afterSnapshot=cloneValue(buildBackupPayload()),changes=entityChangesBetween(beforeSnapshot,afterSnapshot,{includeOutbox:true,queue,context});let stagedEntry=null;if(options.enqueueBeforeRestart&&changes.length)stagedEntry=queue.enqueue(localOutboxEntry(options.intent||{kind:'runtime_ordinary_crash_test'},changes,{...context,commandId}));const hookResult=typeof beforeRestart==='function'?await beforeRestart({commandId,changes:cloneValue(changes),stagedEntry:cloneValue(stagedEntry)}):null,generationBeforeRestart=entityDirtyGeneration(scope),restart=simulateEntityRuntimeRestartForTest();return{scope,commandId,changes:cloneValue(changes),stagedEntry:cloneValue(stagedEntry),prearm:{previousGeneration:prearm.previousGeneration,armedGeneration:prearm.armedGeneration},hookResult,generationBeforeRestart,restart}
}
async function stageCriticalRecoveryForTest(beforeSnapshot,afterSnapshot,intent={kind:'runtime_crash_test'}){resetEntityScope();const context=criticalRecoveryContext(),commandId=newEntityCommandId(),changes=entityChangesBetween(beforeSnapshot,afterSnapshot,{includeOutbox:false});if(!changes.length)throw outboxError('CRITICAL_RECOVERY_TEST_NO_CHANGE','Тестовая критическая операция не содержит изменений.');await prepareCriticalEntityRecovery(beforeSnapshot,context,commandId,intent);await prepareCriticalEntityRecovery(beforeSnapshot,context,commandId,intent,{phase:'pending_server',changes,postSnapshot:afterSnapshot});return{commandId,changes:cloneValue(changes),context}}
async function simulatePendingCriticalMutationForTest(mutation,intent={kind:'runtime_crash_test'}){resetEntityScope();const beforeSnapshot=cloneValue(buildBackupPayload()),context=criticalRecoveryContext(),commandId=newEntityCommandId();await prepareCriticalEntityRecovery(beforeSnapshot,context,commandId,intent);cloudSyncState.suspended++;try{await mutation();const persisted=await window.TeplitsaWarehouseV600?.whenPersisted?.();if(persisted===false||window.__warehousePersistenceCritical)throw outboxError('LOCAL_MUTATION_NOT_DURABLE','Тестовая критическая операция не подтверждена локальным диском.')}finally{cloudSyncState.suspended--}const afterSnapshot=cloneValue(buildBackupPayload()),changes=entityChangesBetween(beforeSnapshot,afterSnapshot,{includeOutbox:false});if(!changes.length)throw outboxError('CRITICAL_RECOVERY_TEST_NO_CHANGE','Тестовая критическая операция не содержит изменений.');await prepareCriticalEntityRecovery(beforeSnapshot,context,commandId,intent,{phase:'pending_server',changes,postSnapshot:afterSnapshot});return{commandId,changes:cloneValue(changes),context,beforeSnapshot,afterSnapshot}}
window.JustFunEntitySyncV783=Object.freeze({flushAndConfirm:flushEntitySyncBeforeContextChange,assertContextChangeAllowed:detail=>assertEntityContextChangeAllowed(detail),canChangeContext:()=>{try{const state=cloudSyncState.outbox&&!cloudSyncState.outboxError?cloudSyncState.outbox.status():null;return!outboxConflictDialogBusy&&!cloudSyncState.contextBlockedError&&!cloudSyncState.outboxError&&Number(state?.conflict||0)===0&&Number(state?.resolutionPending||0)===0&&cloudSyncState.conflicts.size===0&&criticalEntityFlightCount()===0&&ordinaryEntityFlightCount()===0&&ordinaryEntityPrearmTotal()===0}catch{return false}},status:()=>{resetEntityScope();const outbox=cloudSyncState.outbox&&!cloudSyncState.outboxError?cloudSyncState.outbox.status():{active:0,corrupt:Boolean(cloudSyncState.outboxError)},bootstrapInFlight=currentEntityBootstrapInFlight();return{bootstrapped:cloudSyncState.bootstrapped,dirty:cloudSyncState.dirty,inFlight:currentEntityInFlight()||bootstrapInFlight>0||ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0,conflicts:cloudSyncState.conflicts.size,scope:cloudSyncState.scope,cursor:cloudSyncState.cursor,outbox,...(window.__JF_RUNTIME_TEST__?{serial:cloudSyncState.serial,suspended:cloudSyncState.suspended,installed:cloudSyncState.installed,scopeEpoch:cloudSyncState.scopeEpoch,bootstrapInFlight,criticalInFlight:criticalEntityFlightCount(),ordinaryInFlight:ordinaryEntityFlightCount(),ordinaryPrearmed:ordinaryEntityPrearmTotal(),contextBlocked:Boolean(cloudSyncState.contextBlockedError)}:{})}}});
if(window.__JF_RUNTIME_TEST__)window.__JustFunEntitySyncTestV783=Object.freeze({install:()=>{installAutomaticCloudSync();installEntityCommandGuards()},bootstrap:force=>bootstrapEntitySync(force),poll:()=>pollCloudRevision(),background:options=>backgroundCloudUpload(options),drain:options=>drainLocalOutbox(options),commitMutation:(intent,mutation)=>commitEntityMutation(intent,mutation),logout:()=>logout(),reload:(reason='runtime-test',target='')=>guardedWorkspaceReload(reason,target),markDirty:()=>{resetEntityScope();cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;return cloudSyncState.serial},dirtyGeneration:()=>{resetEntityScope();return entityDirtyGeneration(cloudSyncState.scope)},enqueue:(intent,changes)=>{resetEntityScope();const context={companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment()},entry=requireLocalOutbox().enqueue(localOutboxEntry(intent,changes,context));cloudSyncState.dirty=true;persistEntityDirty(true);cloudSyncState.serial++;return entry},prepareCriticalRecovery:(snapshot,intent={kind:'runtime_crash_test'})=>{const context=criticalRecoveryContext();return prepareCriticalEntityRecovery(snapshot,context,newEntityCommandId(),intent)},stageCriticalRecovery:(beforeSnapshot,afterSnapshot,intent)=>stageCriticalRecoveryForTest(beforeSnapshot,afterSnapshot,intent),simulateCriticalPending:(mutation,intent)=>simulatePendingCriticalMutationForTest(mutation,intent),readCriticalRecovery:()=>{const context=criticalRecoveryContext();return criticalRecoveryApi().read(context.warehouseId,context.environment,context.companyId)},recoverCritical:()=>recoverCriticalEntityMutation(),simulateRestart:()=>simulateEntityRuntimeRestartForTest(),simulateOrdinaryCrash:(mutation,beforeRestart,options)=>simulateOrdinaryCrashForTest(mutation,beforeRestart,options),overlaySnapshot:snapshot=>{const copy=cloneValue(snapshot);overlayLocalOutbox(copy);return copy},restoreLocalOutboxOverlay,pausePolling:()=>{clearInterval(cloudSyncState.pollTimer);clearTimeout(cloudSyncState.uploadTimer);clearTimeout(cloudSyncState.retryTimer);cloudSyncState.pollTimer=null;cloudSyncState.uploadTimer=null;cloudSyncState.retryTimer=null},access:()=>({role:String(currentUser?.role||''),allWarehouses:currentUser?.allWarehouses===true,permissions:[...asArray(currentUser?.permissions)]}),setAccess:access=>{if(!currentUser)return false;currentUser={...currentUser,role:String(access?.role||'viewer'),allWarehouses:access?.allWarehouses===true,permissions:[...asArray(access?.permissions)]};return true},canImportLocalMigration:()=>canImportLocalMigrationV783(),setOffline:value=>{if(!desktopSession?.auth)return false;desktopSession.auth.offline=Boolean(value);return true}});
let nextWarehouseRegistryRefreshAtV783=0;
async function refreshWarehouseRegistryDuringPollingV783(force=false,reason='warehouse-registry-periodic'){
  const now=Date.now();if(!force&&now<nextWarehouseRegistryRefreshAtV783)return false;nextWarehouseRegistryRefreshAtV783=now+30000;
  const before=activeWarehouseId();await synchronizeCompanyWarehouseRegistry();return applyWarehouseRegistryTransition(before,reason)
}
async function pollCloudRevision(){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return;resetEntityScope();if(cloudSyncState.suspended||ordinaryEntityFlightCount()>0||ordinaryEntityPrearmTotal()>0||currentEntityInFlight()||currentEntityBootstrapInFlight())return;
  if(provisionalNativeWarehouseIdV784()){const transitioned=await refreshWarehouseRegistryDuringPollingV783(true,'native-recovery-registry-confirmation');if(transitioned||provisionalNativeWarehouseIdV784())return;resetEntityScope()}
  if(cloudSyncState.outbox&&!cloudSyncState.outboxError&&cloudSyncState.outbox.ready())await drainLocalOutbox();resetEntityScope();const now=Date.now();if(now<cloudSyncState.nextPollAt)return;if(await refreshWarehouseRegistryDuringPollingV783(false))return;resetEntityScope();await bootstrapEntitySync();resetEntityScope();if(!cloudSyncState.bootstrapped)return;
  const expectedScope=cloudSyncState.scope,expectedEpoch=cloudSyncState.scopeEpoch,warehouseId=activeWarehouseId(),environment=activeEnvironment(),rollbackSnapshot=cloneValue(buildBackupPayload()),stagedKnown=new Map(cloudSyncState.known),stagedConflicts=new Map(cloudSyncState.conflicts),stagedReadableTypes=new Set(cloudSyncState.readableTypes);let stagedCursor=cloudSyncState.cursor;if(!warehouseId)return;beginEntityInFlight(expectedScope,expectedEpoch);
  try{
    let more=true,rounds=0,applied=0,workingSnapshot=cloneValue(rollbackSnapshot),current=splitEntitySnapshot(workingSnapshot),activeWarehouseDeleted=false,metadataChanged=false;const pendingOutboxConflicts=[];
    while(more&&rounds++<8){
      const result=await window.JustFunDesktop?.regVps?.entityChanges?.({warehouseId,environment,afterEventId:stagedCursor,limit:250});assertEntityScope(expectedScope,expectedEpoch);if(!result?.ok){const code=String(result?.code||'ENTITY_CHANGES_FAILED');if(code.toLowerCase()==='warehouse_access_denied'){if(await refreshWarehouseRegistryDuringPollingV783(true,'warehouse-access-revoked'))return;assertEntityScope(expectedScope,expectedEpoch);blockWorkspaceAfterWarehouseChange('Сервер отозвал доступ к открытому складу. Локальный кэш заблокирован до повторной проверки.');return}throw Object.assign(new Error(result?.error||'Лента изменений VPS недоступна.'),{code})}
      if(entityTypeSetSignature(result.readableTypes)!==entityTypeSetSignature([...stagedReadableTypes])){await bootstrapEntitySync(true);assertEntityScope(expectedScope,expectedEpoch);return}
      const events=asArray(result.events),nextCursor=Math.max(stagedCursor,Number(result.cursor)||0);if(nextCursor!==stagedCursor)metadataChanged=true;stagedCursor=nextCursor;if(!events.length){more=false;break}
      for(const rawEvent of events){const event=canonicalServerEntity(rawEvent),key=entityKey(event.type,event.id),known=stagedKnown.get(key),local=current.get(key),localDirty=local?(!known||known.deleted||local.fingerprint!==known.fingerprint):Boolean(known&&!known.deleted);if(Number(event.version)<=Number(known?.version||0))continue;metadataChanged=true;
        if(event.type==='warehouse'&&event.id===warehouseId&&event.operation==='delete'){activeWarehouseDeleted=true;current.delete(key);stagedKnown.set(key,{version:Number(event.version)||0,digest:String(event.digest||''),fingerprint:'',deleted:true,eventId:Number(event.eventId)||0});applied++;continue}
        if(localDirty){const details={type:event.type,id:event.id,remoteVersion:event.version,remotePayload:event.payload,operation:event.operation,eventId:event.eventId,detectedAt:new Date().toISOString()};stagedConflicts.set(key,details);pendingOutboxConflicts.push({key,details});continue}
        applyEntityToSnapshot(workingSnapshot,event,event.operation==='delete');if(event.operation==='delete')current.delete(key);else current.set(key,{type:event.type,id:event.id,payload:event.payload,fingerprint:semanticEntityFingerprintV784(event.type,event.id,event.payload,{warehouseId,environment})});stagedKnown.set(key,{version:Number(event.version)||0,digest:String(event.digest||''),fingerprint:event.operation==='delete'?'':semanticEntityFingerprintV784(event.type,event.id,event.payload,{warehouseId,environment}),deleted:event.operation==='delete',eventId:Number(event.eventId)||0});applied++}
      more=result.hasMore===true;
    }
    if(activeWarehouseDeleted)stagedConflicts.clear();if(metadataChanged)await commitRemoteEntitySnapshotV784({snapshot:workingSnapshot,rollbackSnapshot,metadata:{known:stagedKnown,conflicts:stagedConflicts,cursor:stagedCursor,readableTypes:stagedReadableTypes,bootstrapped:true},expectedScope,expectedEpoch,phase:'poll',failureCode:'ENTITY_POLL_IMPORT_NOT_DURABLE',failureMessage:'Изменения VPS не подтверждены локальным диском.'});
    for(const item of pendingOutboxConflicts)markOutboxEntityConflict(item.key,{code:'entity_version_conflict',message:'Запись изменена на другом компьютере.',details:item.details});if(pendingOutboxConflicts.length)integrationBadge('jfRegBadge','Нужно решить конфликт','error');
    if(activeWarehouseDeleted){markPendingWarehouseDelete(warehouseId);cloudSyncState.dirty=false;try{await synchronizeCompanyWarehouseRegistry()}catch(error){applyWarehouseRegistryTransition(warehouseId,'active-warehouse-delete-pending');throw error}audit('active_warehouse_deleted_remotely',{warehouseId,replacement:activeWarehouseId()});applyWarehouseRegistryTransition(warehouseId,'active-warehouse-deleted');return}
    if(applied){integrationBadge('jfRegBadge','Получены изменения','ready');integrationStatus('jfRegStatus',`Применено ${applied} изменений отдельных записей с других компьютеров.`,'ok')}
    if(cloudSyncState.conflicts.size)integrationStatus('jfRegStatus',`Обнаружено конфликтов: ${cloudSyncState.conflicts.size}. Локальные данные не перезаписаны; требуется выбрать версию.`,'error');
    cloudSyncState.pollFailures=0;cloudSyncState.nextPollAt=0;
  }catch(error){if(error?.code==='ENTITY_SCOPE_CHANGED')return;cloudSyncState.pollFailures=Math.min(8,cloudSyncState.pollFailures+1);cloudSyncState.nextPollAt=Date.now()+Math.min(300000,5000*(2**cloudSyncState.pollFailures));throw error}
  finally{endEntityInFlight(expectedScope,expectedEpoch)}
}
async function syncActiveWarehouse(){
  const button=q('#jfRegSync'),warehouseId=activeWarehouseId(),environment=activeEnvironment();if(!warehouseId)return integrationStatus('jfRegStatus','Активный склад не определён.','error');setIntegrationBusy(button,true);integrationStatus('jfRegStatus',`Получаем актуальные серверные записи склада «${activeWarehouseLabel()}» · ${environment.toUpperCase()}…`);
  try{if(!onlineEntitySyncAvailable())throw new Error('VPS не настроен или недоступен. Локальные данные не изменены и продолжают храниться на этом компьютере.');cloudSyncState.bootstrapped=false;await bootstrapEntitySync(true);await backgroundCloudUpload({force:true});const pending=requireLocalOutbox().status().active;integrationStatus('jfRegStatus',pending?`Сервер прочитан, но ${pending} локальных изменений ещё требуют отправки или решения.`:'Локальный кэш и VPS синхронизированы.','ok')}
  catch(error){integrationStatus('jfRegStatus',error?.message||error,'error')}
  finally{setIntegrationBusy(button,false)}
}
async function restoreActiveWarehouseFromVps(){
  const button=q('#jfRegRestore'),warehouseId=activeWarehouseId(),environment=activeEnvironment();setIntegrationBusy(button,true);integrationStatus('jfRegStatus',`Получаем подтверждённые серверные записи «${activeWarehouseLabel()}» · ${environment.toUpperCase()}…`);
  try{resetEntityScope();const pending=requireLocalOutbox().status().active;if(pending)throw new Error(`Восстановление остановлено: ${pending} локальных изменений ещё не подтверждены. Сначала синхронизируйте или разрешите их.`);if(!await jfConfirm(`Заменить локальный кэш склада «${activeWarehouseLabel()}» актуальными серверными записями? Перед заменой будет сохранена резервная копия.`,{title:'Восстановление с сервера',confirmLabel:'Восстановить',kind:'danger'}))return integrationStatus('jfRegStatus','Восстановление отменено. Локальные данные не изменены.');if(typeof exportBackup==='function')exportBackup();cloudSyncState.bootstrapped=false;await bootstrapEntitySync(true);cloudSyncState.dirty=false;integrationStatus('jfRegStatus',`Локальный кэш «${activeWarehouseLabel()}» восстановлен из отдельных серверных записей.`,'ok')}
  catch(error){integrationStatus('jfRegStatus',error?.message||error,'error')}
  finally{setIntegrationBusy(button,false)}
}
let telegramProgressBound=false,telegramCompanyPublishBound=false,telegramProgressActive=false;
const TELEGRAM_STAGE_LABELS={
  token_verification:'Проверяется Cloudflare API-токен',account_selection:'Проверяются аккаунт и разрешения',telegram_verification:'Проверяется Telegram-бот',subdomain:'Подготавливается бесплатный адрес workers.dev',database:'Создаётся база D1',migration:'Создаются таблицы и применяются миграции',worker_upload:'Публикуется Cloudflare Worker',worker_check:'Проверяется Worker',webhook:'Устанавливается защищённый webhook',final_check:'Выполняется итоговая диагностика',completed:'Подключение завершено'
};
function renderTelegramProgress(payload={}){
  if(!telegramProgressActive)return;
  const wrap=q('#jfTelegramProgress'),bar=q('#jfTelegramProgressBar'),percent=q('#jfTelegramProgressPercent'),text=q('#jfTelegramProgressText');if(!wrap)return;
  const value=Math.max(0,Math.min(100,Number(payload.percent||0)));wrap.hidden=false;if(bar)bar.style.width=value+'%';if(percent)percent.textContent=Math.round(value)+'%';if(text)text.textContent=payload.title||payload.message||TELEGRAM_STAGE_LABELS[payload.stage]||'Выполняется настройка…';
  if(payload.stage==='completed')setTimeout(()=>{if(wrap)wrap.hidden=true},1600);
}
function clearTelegramProgress(){telegramProgressActive=false;const wrap=q('#jfTelegramProgress'),bar=q('#jfTelegramProgressBar'),percent=q('#jfTelegramProgressPercent'),text=q('#jfTelegramProgressText');if(wrap)wrap.hidden=true;if(bar)bar.style.width='0%';if(percent)percent.textContent='0%';if(text)text.textContent='Подготовка…'}
function startTelegramProgress(){clearTelegramProgress();telegramProgressActive=true}
async function refreshTelegramStatus(){
  const status=await window.JustFunDesktop?.telegramCloudflare?.status?.({warehouseId:activeWarehouseId()});if(!status)return;
  lastTelegramStatus=status;telegramPollingConfigured=Boolean(status.configured&&status.online);renderTelegramWarehouseContext();
  if(!status.configured){integrationBadge('jfTelegramBadge',status.repairRequired?'Нужно восстановить':'Не настроен',status.repairRequired?'error':'');integrationStatus('jfTelegramStatus',status.repairRequired?'Общий Telegram-профиль компании ещё не сохранён, а старый локальный ключ недоступен этому пользователю Windows. Владельцу нужно один раз нажать «Настроить Telegram» и пройти восстановление — после этого сотрудники получат доступ автоматически.':'Создайте временный ограниченный Cloudflare API-токен и Telegram-бота через @BotFather. Домен не нужен; программа выполнит остальное автоматически.',status.repairRequired?'error':'');return}
  if(status.online&&status.brokerOffline){const retry=status.companyPublishRetryScheduled?(status.companyPublishRetryAt?` Следующая автоматическая попытка: ${new Date(status.companyPublishRetryAt).toLocaleTimeString('ru-RU')}.`:' Автоматический повтор запланирован.'):' Автоматический повтор не запланирован — владельцу нужно нажать «Проверить и восстановить».';integrationBadge('jfTelegramBadge',status.companyPublishPending?'Настройка не завершена':'Проверка недоступна',status.companyPublishPending?'error':'');integrationStatus('jfTelegramStatus',`@${status.botUsername||'бот'} · ${status.error||'Worker и webhook подтверждены, но серверный профиль компании недоступен.'}${status.companyPublishPending?retry:''} Временный Cloudflare-токен можно удалить.`,status.companyPublishPending?'error':'ok')}
  else if(status.online){integrationBadge('jfTelegramBadge','Работает','ready');integrationStatus('jfTelegramStatus',`@${status.botUsername||'бот'} · webhook подтверждён${status.pendingUpdates?` · ожидает обновлений: ${status.pendingUpdates}`:''}. Worker и D1 изолированы в Cloudflare-аккаунте клиента. Временный Cloudflare-токен можно удалить.`,'ok')}
  else{integrationBadge('jfTelegramBadge','Требует восстановления','error');integrationStatus('jfTelegramStatus',`${status.error||'Webhook не подтверждён'}${status.lastError?` · Telegram: ${status.lastError}`:''}. Нажмите «Проверить и восстановить».`,'error')}
}
function renderTelegramWarehouseContext(){const context=q('#jfTelegramWarehouseContext');if(!context)return;const warehouseId=activeWarehouseId(),binding=telegramBindings.get(telegramBindingKey('warehouse',warehouseId)),status=lastTelegramStatus,checked=status?.checkedAt?new Date(status.checkedAt).toLocaleString('ru-RU'):'ещё не проверено',bot=status?.configured?`@${status.botUsername||'имя не получено'}`:'не подключён',group=binding?(binding.title||binding.username?`${binding.title||''}${binding.username?` @${binding.username}`:''}`:'подключена'):'не подключена',problem=status?.lastError||(!status?.online&&status?.error)||'';context.textContent=`Склад: ${activeWarehouseLabel()} · бот: ${bot} · группа: ${group} · проверка: ${checked}${problem?` · ошибка: ${problem}`:''}`}
async function configureTelegram(reconnect=false){
  const button=q(reconnect?'#jfTelegramReconnect':'#jfTelegramConfigure');if(integrationWizardBusy)return integrationStatus('jfTelegramStatus','Сначала завершите уже открытый системный мастер.','error');let completed=false;startTelegramProgress();setIntegrationWizardBusy(button,true);integrationStatus('jfTelegramStatus','Открывается отдельное защищённое окно. Введите временный Cloudflare API-токен и токен своего бота от @BotFather. Cloudflare-токен не будет сохранён.');
  try{const result=await window.JustFunDesktop?.telegramCloudflare?.configure?.(reconnect,activeWarehouseId());if(result?.canceled){clearTelegramProgress();return integrationStatus('jfTelegramStatus','Настройка отменена. Введённые токены очищены и не сохранены.')}if(!result?.ok)throw new Error(result?.error||'Подключение не завершено');completed=true;integrationStatus('jfTelegramStatus',result?.companyPublishPending?`${result.error||'Worker, D1 и webhook созданы, но профиль компании ещё не сохранён.'} Временный Cloudflare API-токен можно удалить.`:'Инфраструктура создана и проверена. Теперь удалите временный Cloudflare API-токен в личном кабинете Cloudflare.',result?.companyPublishPending?'error':'ok');await refreshTelegramStatus();await refreshTelegramBindings().catch(()=>false);startTelegramPolling()}
  catch(error){clearTelegramProgress();integrationBadge('jfTelegramBadge','Ошибка','error');integrationStatus('jfTelegramStatus',error?.message||error,'error')}
  finally{telegramProgressActive=false;if(completed)setTimeout(clearTelegramProgress,1600);setIntegrationWizardBusy(button,false)}
}
async function repairTelegram(){
  const button=q('#jfTelegramReconnect');if(integrationWizardBusy)return integrationStatus('jfTelegramStatus','Сначала завершите уже открытый системный мастер.','error');setIntegrationWizardBusy(button,true);integrationStatus('jfTelegramStatus','Проверяем Worker, webhook, Telegram-бота и локальный защищённый ключ…');
  try{
    const current=await window.JustFunDesktop?.telegramCloudflare?.status?.({warehouseId:activeWarehouseId()});
    if(!current?.configured){integrationBadge('jfTelegramBadge','Не настроен');return integrationStatus('jfTelegramStatus','Подключение ещё не создано. Нажмите «Настроить Telegram» — восстановление без исходной настройки невозможно.','error')}
    if(current.online&&!current.brokerOffline){integrationBadge('jfTelegramBadge','Работает','ready');return integrationStatus('jfTelegramStatus',`Диагностика завершена: @${current.botUsername||'бот'}, Worker, webhook и профиль компании работают. Восстановление не требуется.`,'ok')}
    if(current.online&&current.brokerOffline){integrationBadge('jfTelegramBadge','Настройка не завершена','error');return integrationStatus('jfTelegramStatus',current.error||'Worker и webhook работают, но профиль компании ещё не сохранён.', 'error')}
    integrationBadge('jfTelegramBadge','Требует данных','error');
    integrationStatus('jfTelegramStatus',`${current.error||'Подключение повреждено'}. Диагностика завершена. Для безопасного восстановления нужны временный API-токен и токен бота — нажмите «Настроить Telegram».`,'error')
  }catch(error){integrationBadge('jfTelegramBadge','Ошибка','error');integrationStatus('jfTelegramStatus',error?.message||error,'error')}
  finally{setIntegrationWizardBusy(button,false)}
}
function showTelegramLink(result,targetId='jfTelegramLinkResult'){
  const box=q('#'+targetId);if(!box)return;const value=result.deepLink||result.command||'';box.hidden=false;box.innerHTML=`<b>Одноразовая привязка действует 20 минут</b><div style="margin-top:6px">${result.deepLink?`<a href="${esc(result.deepLink)}" target="_blank" rel="noopener">${esc(result.deepLink)}</a>`:esc(result.command||'Команда не получена')}</div><div class="inline-actions" style="margin-top:8px"><button class="btn-soft" type="button" data-copy-link>Скопировать</button></div>`;q('[data-copy-link]',box).onclick=()=>window.JustFunDesktop?.copyText?.(value)
}
async function bindActiveWarehouseTelegram(){const button=q('#jfTelegramWarehouse'),warehouseId=activeWarehouseId();setIntegrationBusy(button,true);try{const result=await window.JustFunDesktop?.telegramCloudflare?.createLink?.({warehouseId,entityType:'warehouse',entityId:warehouseId,label:activeWarehouseLabel()});if(!result?.ok)throw new Error(result?.error||'Код привязки не создан');showTelegramLink(result);integrationStatus('jfTelegramStatus',`Добавьте своего бота в группу склада «${activeWarehouseLabel()}» и отправьте показанную команду.`,'ok')}catch(error){integrationStatus('jfTelegramStatus',error?.message||error,'error')}finally{setIntegrationBusy(button,false)}}
function pendingWarehouseTelegramId(){try{return String(sessionStorage.getItem('jfTelegramSetupWarehouseV783')||'')}catch{return''}}
function clearPendingWarehouseTelegram(){try{sessionStorage.removeItem('jfTelegramSetupWarehouseV783')}catch{}q('#jfWarehouseTelegramRequired')?.remove()}
function openWarehouseTelegramSetup(){
  q('#jfWarehouseTelegramRequired')?.remove();
  window.showView?.('programSettings');
  setTimeout(()=>{const box=q('#jfTelegramIntegrationsBox');if(box){const accordion=box.closest('.settings-accordion-v610');if(accordion&&!accordion.classList.contains('open'))accordion.querySelector(':scope > .settings-accordion-toggle-v610')?.click();box.scrollIntoView({behavior:'smooth',block:'start'})}q('#jfTelegramConfigure')?.focus()},120)
}
function promptRequiredWarehouseTelegram(){
  const warehouseId=pendingWarehouseTelegramId();if(!warehouseId||warehouseId!==activeWarehouseId()||!hasPermission('company.update'))return;
  if(telegramBindings.has(telegramBindingKey('warehouse',warehouseId))){clearPendingWarehouseTelegram();return}
  if(q('#jfWarehouseTelegramRequired'))return;const modal=document.createElement('div');modal.id='jfWarehouseTelegramRequired';modal.className='jf-profile-modal open';modal.innerHTML=`<div class="jf-dialog"><h2>Подключите Telegram нового склада</h2><p>Для склада «${esc(activeWarehouseLabel())}» нужен отдельный бот и отдельная группа. Так сообщения разных складов не смешиваются.</p><div class="jf-settings-help"><b>После подключения группа будет получать:</b><br>состав рейса, общий список товара, порядок погрузки, время подачи машины, дефицит и статусы сборки.</div><div class="jf-dialog-actions"><button class="btn-primary" id="jfWarehouseTelegramOpen">Перейти к подключению</button></div></div>`;document.body.append(modal);q('#jfWarehouseTelegramOpen').onclick=openWarehouseTelegramSetup
}
function installIntegrationPanel(){
  const boxes=qa('#jfRegIntegrationsBox,#jfTelegramIntegrationsBox,#jfIntegrationsBox');if(!boxes.length||boxes.every(box=>box.dataset.bound==='1')||!hasPermission('company.update'))return;if(isTrainingEnvironment()){boxes.forEach(box=>{box.dataset.bound='1';qa('[data-jf-integration-action]',box).forEach(button=>{button.disabled=true;button.classList.add('jf-role-hidden')})});integrationBadge('jfRegBadge','Учебный режим');integrationStatus('jfRegStatus','Подключение VPS доступно только в рабочем режиме.');integrationBadge('jfTelegramBadge','Учебный режим');integrationStatus('jfTelegramStatus','Подключение Telegram доступно только в рабочем режиме.');return}boxes.forEach(box=>box.dataset.bound='1');if(!telegramProgressBound&&window.JustFunDesktop?.telegramCloudflare?.onProgress){window.JustFunDesktop.telegramCloudflare.onProgress(renderTelegramProgress);telegramProgressBound=true;}if(!telegramCompanyPublishBound&&window.JustFunDesktop?.telegramCloudflare?.onCompanyPublished){window.JustFunDesktop.telegramCloudflare.onCompanyPublished(()=>refreshTelegramStatus().catch(error=>integrationStatus('jfTelegramStatus',userVisibleError(error),'error')));telegramCompanyPublishBound=true;}q('#jfRegConfigure').onclick=configureRegVps;q('#jfRegCheck').onclick=()=>refreshRegVpsStatus({manual:true});q('#jfRegSync').onclick=syncActiveWarehouse;q('#jfRegRestore').onclick=restoreActiveWarehouseFromVps;q('#jfTelegramConfigure').onclick=()=>configureTelegram(false);q('#jfTelegramReconnect').onclick=repairTelegram;q('#jfTelegramCheck').onclick=refreshTelegramStatus;q('#jfTelegramWarehouse').onclick=bindActiveWarehouseTelegram;refreshRegVpsStatus().catch(error=>integrationStatus('jfRegStatus',userVisibleError(error),'error'));refreshTelegramStatus().catch(error=>integrationStatus('jfTelegramStatus',userVisibleError(error),'error'))
}
function telegramEnvironment(){return activeEnvironment()}
function telegramScopeKey(){return`${telegramEnvironment()}:${activeWarehouseId()}`}
function loadTelegramRouteState(){
  const scope=telegramScopeKey();if(scope===telegramRouteScope)return;
  telegramRouteScope=scope;telegramBindings=new Map();
  try{const value=JSON.parse(localStorage.getItem(`jf_telegram_routes_v783:${scope}`)||'{}');telegramRouteState=value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{telegramRouteState={}}
}
function saveTelegramRouteState(){loadTelegramRouteState();try{localStorage.setItem(`jf_telegram_routes_v783:${telegramRouteScope}`,JSON.stringify(telegramRouteState))}catch{}}
function telegramBindingKey(type,id){return`${type}:${id}`}
function telegramTargetKey(routeId,type,entityId){return`${routeId}:${type}:${entityId}`}
const TELEGRAM_STATUS_LABELS={sending:'Отправляется',sent:'Доставлено в Telegram',accepted:'Рейс принят',departed:'Водитель выехал',completed:'Рейс завершён',collecting:'Идёт сборка',ready:'Груз собран',loaded:'Машина загружена',problem:'Проблема',error:'Ошибка'};
function telegramStatusLabel(status){return TELEGRAM_STATUS_LABELS[String(status||'')]||'Не отправлено'}
function routeTelegramState(routeId,type,entityId){loadTelegramRouteState();return telegramRouteState[telegramTargetKey(routeId,type,entityId)]||null}
function setRouteTelegramState(routeId,type,entityId,value){
  if(!routeId||!['driver','warehouse'].includes(type)||!entityId)return;
  loadTelegramRouteState();const key=telegramTargetKey(routeId,type,entityId);
  telegramRouteState[key]={...(telegramRouteState[key]||{}),...value,routeId,type,entityId,updatedAt:new Date().toISOString()};
  saveTelegramRouteState()
}
function routeTelegramOrderedOrders(def){
  const orders=Array.isArray(def?.orders)?def.orders:[],plan=typeof validRoutePlan==='function'?validRoutePlan(def):null;
  return plan?.orderedIds?.map(id=>orders.find(order=>String(order.id)===String(id))).filter(Boolean)||orders
}
function routeTelegramUrl(def){
  const ordered=routeTelegramOrderedOrders(def),returns=typeof routeReturnsToWarehouse==='function'?routeReturnsToWarehouse(def.id):true;
  const warehousePoint=[Number(settings?.warehouse?.lat),Number(settings?.warehouse?.lon)],hasWarehousePoint=warehousePoint.every(Number.isFinite);
  const orderPoints=ordered.map(order=>[Number(order.geo?.lat),Number(order.geo?.lon)]).filter(point=>point.every(Number.isFinite));
  const points=[...(hasWarehousePoint?[warehousePoint]:[]),...orderPoints,...(hasWarehousePoint&&returns?[warehousePoint]:[])];
  return points.length>1?`https://yandex.ru/maps/?rtext=${encodeURIComponent(points.map(point=>point.join(',')).join('~'))}&rtt=auto`:''
}
function routeTelegramMessage(def,targetType){
  const plan=typeof validRoutePlan==='function'?validRoutePlan(def):null,ordered=routeTelegramOrderedOrders(def);
  const driver=typeof assignedDriverForRoute==='function'?assignedDriverForRoute(def.id):null,slot=typeof routeLoadingSlot==='function'?routeLoadingSlot(def):null;
  const rules=plan&&typeof routeRuleMetrics==='function'?routeRuleMetrics(plan,ordered.length):null,returns=typeof routeReturnsToWarehouse==='function'?routeReturnsToWarehouse(def.id):true;
  const routeTitle=String(def.displayDistrict||def.district||'Рейс'),routeDate=typeof formatDateOnly==='function'?formatDateOnly(def.date):String(def.date||'—');
  if(targetType==='warehouse'){
    const cargo=new Map();
    ordered.forEach(order=>(order.items||[]).forEach(item=>{const key=String(item.productId||item.article||item.name),entry=cargo.get(key)||{name:item.name||item.article||'Товар',qty:0,unit:item.unit||'шт'};entry.qty+=Number(item.qty||0);cargo.set(key,entry)}));
    const shortages=typeof inventoryShortagesForOrders==='function'?inventoryShortagesForOrders(ordered):[];
    const lines=['📦 Соберите груз для рейса',`${routeTitle} · ${routeDate}`,`Склад: ${activeWarehouseLabel()}`,`Машина: ${driver?.name||'не назначена'}${driver?.plate?` · ${driver.plate}`:''}`,'',`Что собрать (товаров: ${cargo.size}):`];
    if(cargo.size)[...cargo.values()].forEach(item=>lines.push(`• ${item.name} — ${item.qty.toLocaleString('ru-RU')} ${item.unit}`));
    else lines.push('• Товары не указаны');
    if(shortages.length){lines.push('','⚠️ Не хватает:');shortages.forEach(item=>lines.push(`• ${item.product?.name||'Товар'} — ${Number(item.missing||0).toLocaleString('ru-RU')} ${item.product?.unit||''}`.trim()))}
    else if(cargo.size)lines.push('','✅ Все товары есть');
    lines.push('','Когда:');
    lines.push(`• Подача машины: ${slot?.arrivalWindow||'время не указано'}`);
    lines.push(`• Погрузка: ${slot?.loadingWindow||'время не указано'}`);
    lines.push(`• Выезд: ${slot?.departureTime||'время не указано'}`);
    if(ordered.length){lines.push('','Порядок погрузки: последняя точка рейса грузится первой.');[...ordered].reverse().forEach((order,index)=>lines.push(`${index+1}. Заказ ${order.number||order.id||'без номера'} — ${order.deliveryAddress||'адрес не указан'}`))}
    lines.push('','После начала нажмите «Начать сборку». Дальше: «Сборка завершена» → «Машина загружена». Если работа остановилась — «Есть проблема».');
    return lines.join('\n').slice(0,3490)
  }
  const vehicle=[driver?.brand,driver?.model,driver?.plate].filter(Boolean).join(' '),routeUrl=routeTelegramUrl(def);
  const distance=plan?(typeof formatKm==='function'?formatKm(plan.distance):`${Math.round(Number(plan.distance||0)/1000)} км`):'не рассчитано';
  const duration=plan&&typeof formatDuration==='function'?formatDuration(rules?.totalMin||0):'';
  const lines=[
    '🚚 Примите рейс',
    'Статус: ждёт подтверждения',
    `${routeTitle} · ${routeDate}`,
    `Склад: ${activeWarehouseLabel()}`,
    `Машина: ${vehicle||'не указана'}`,
    '',
    'График:',
    `• Подача: ${slot?.arrivalWindow||'время не указано'}`,
    `• Выезд: ${slot?.departureTime||'время не указано'}`,
    `• Путь: ${distance}${duration?` · ${duration}`:''} · ${returns?'с возвратом на склад':'без возврата на склад'}`,
    '',
    `Точки (${ordered.length}):`
  ];
  ordered.forEach((order,index)=>{
    const eta=plan?.schedule?.find(stop=>String(stop.orderId)===String(order.id))?.eta||'время не указано';
    const contact=[order.contactName,order.contactMethod].filter(Boolean).join(' · ')||'не указан';
    const cargo=(order.items||[]).map(item=>`${item.name||'Товар'} — ${Number(item.qty||0).toLocaleString('ru-RU')} ${item.unit||'шт'}`).join('; ')||'не указан';
    lines.push(`${index+1}. 📍 ${order.deliveryAddress||'Адрес не указан'}`);
    lines.push(`   Контакт: ${contact}`);
    lines.push(`   Время: ${eta}`);
    lines.push(`   Груз: ${cargo}`);
    if(order.driverNote)lines.push(`   Важно: ${order.driverNote}`)
  });
  lines.push('',routeUrl?'Маршрут откройте кнопкой ниже.':'Маршрут на карте пока недоступен — используйте адреса точек.');
  lines.push('Нажмите «Принять рейс». Далее: «В пути» → «Доставлено». Если не можете продолжить — «Проблема».');
  return lines.join('\n').slice(0,3490)
}
async function sendRouteTelegram(def,targetType,button){
  const warehouseId=activeWarehouseId(),driver=typeof assignedDriverForRoute==='function'?assignedDriverForRoute(def.id):null;
  const entityId=targetType==='driver'?String(driver?.id||''):warehouseId;
  if(!entityId)return toast('Сначала назначьте водителя на рейс.','error');
  if(!telegramBindings.has(telegramBindingKey(targetType,entityId)))return toast(targetType==='driver'?'Сначала подключите водителя к Telegram-боту.':'Сначала подключите Telegram-группу склада.','error');
  const text=routeTelegramMessage(def,targetType),routeUrl=targetType==='driver'?routeTelegramUrl(def):'',fingerprintSource=`${text}\n${routeUrl}`,fingerprint=typeof hashString==='function'?hashString(fingerprintSource):String(fingerprintSource.length),routeHash=typeof hashString==='function'?hashString(String(def.id)):String(def.id).replace(/[^A-Za-z0-9_-]/g,'').slice(0,30);
  setIntegrationBusy(button,true);setRouteTelegramState(def.id,targetType,entityId,{status:'sending'});decorateRouteTelegram();
  try{
    const response=await window.JustFunDesktop?.telegramCloudflare?.sendNotification?.({
      warehouseId,entityType:targetType,entityId,routeId:String(def.id),
      idempotencyKey:`route:${routeHash}:${targetType}:${fingerprint}`,
      title:String(def.displayDistrict||def.district||'Маршрутный лист'),
      metadata:{date:String(def.date||''),warehouse:activeWarehouseLabel(),driver:String(driver?.name||''),stops:Number(def.orders?.length||0)},
      text,routeUrl,disableLinkPreview:targetType==='driver',statusButtons:true
    });
    if(!response?.ok||!response?.deliveryConfirmed||!response?.notificationId)throw new Error(response?.error||'Telegram не подтвердил доставку маршрутного листа');
    setRouteTelegramState(def.id,targetType,entityId,{status:response.status||'sent',notificationId:response.notificationId||'',duplicate:!!response.duplicate});
    toast(response.duplicate?'Маршрутный лист уже был доставлен без изменений.':'Маршрутный лист доставлен в Telegram.');
    setTimeout(()=>pollTelegramEventsOnce().catch(()=>{}),1200)
  }catch(error){setRouteTelegramState(def.id,targetType,entityId,{status:'error',error:String(error?.message||error)});toast(error?.message||String(error),'error')}
  finally{setIntegrationBusy(button,false);decorateRouteTelegram()}
}
function decorateRouteTelegram(){
  loadTelegramRouteState();if(typeof routeState!=='function')return;
  const definitions=new Map(routeState().allDefs.map(def=>[String(def.id),def]));
  qa('#tripsArea .route-card').forEach(card=>{
    card.querySelector('.jf-route-telegram')?.remove();
    const routeId=String(card.id||'').replace(/^routeCard-/,''),
      def=definitions.get(routeId),details=q('.route-card-details',card);
    if(!def||!details)return;
    const driver=typeof assignedDriverForRoute==='function'?assignedDriverForRoute(def.id):null,
      aggregator=driver&&typeof driverIsAggregator==='function'&&driverIsAggregator(driver),
      driverId=String(driver?.id||''),warehouseId=activeWarehouseId(),
      training=isTrainingEnvironment(),
      driverBound=!training&&driverId&&telegramBindings.has(telegramBindingKey('driver',driverId)),
      warehouseBound=!training&&telegramBindings.has(telegramBindingKey('warehouse',warehouseId)),
      driverState=driverId?routeTelegramState(routeId,'driver',driverId):null,
      warehouseState=routeTelegramState(routeId,'warehouse',warehouseId),
      section=document.createElement('section');
    section.className='jf-route-telegram';section.onclick=event=>event.stopPropagation();
    section.innerHTML=`<div class="jf-route-telegram-head"><b>Telegram маршрута</b></div><div class="jf-route-telegram-actions"><div class="jf-route-telegram-target"><button class="btn-primary" type="button" data-route-tg="driver" ${!driver||aggregator||!driverBound?'disabled':''}>Отправить водителю</button><span class="jf-telegram-state ${esc(driverState?.status||'')}">${esc(!driver?'Водитель не назначен':aggregator?'Агрегатор без личного бота':!driverBound?'Не подключён':telegramStatusLabel(driverState?.status))}</span></div><div class="jf-route-telegram-target"><button class="btn-soft" type="button" data-route-tg="warehouse" ${!warehouseBound?'disabled':''}>Отправить на склад</button><span class="jf-telegram-state ${esc(warehouseState?.status||'')}">${esc(!warehouseBound?'Группа не подключена':telegramStatusLabel(warehouseState?.status))}</span></div></div>`;
    const dock=q('.route-action-dock',details);dock?.insertAdjacentElement('afterend',section)||details.prepend(section);
    qa('[data-route-tg]',section).forEach(button=>button.onclick=()=>sendRouteTelegram(def,button.dataset.routeTg,button))
  })
}
function applyTelegramEvents(events=[]){
  let changed=false;
  for(const event of events){
    const payload=event?.payload&&typeof event.payload==='object'?event.payload:{};
    if(event.event_type==='chat_bound'){
      const type=String(payload.entity_type||event.actor||''),entityId=String(payload.entity_id||'');
      if(type&&entityId){telegramBindings.set(telegramBindingKey(type,entityId),{entityType:type,entityId,username:String(event.username||''),title:String(payload.label||'')});if(type==='warehouse'&&entityId===pendingWarehouseTelegramId())clearPendingWarehouseTelegram();changed=true}
    }
    if(['notification_sent','status_changed'].includes(String(event.event_type||''))&&event.route_id&&['driver','warehouse'].includes(String(event.actor||''))){
      const type=String(event.actor),entityId=String(payload.entity_id||'');
      if(entityId){setRouteTelegramState(String(event.route_id),type,entityId,{status:String(event.status||'sent'),notificationId:String(event.notification_id||'')});changed=true}
    }
  }
  if(changed){decorateRouteTelegram();const openDriver=q('.jf-telegram-driver');if(openDriver){const id=openDriver.dataset.driverId;openDriver.remove();injectTelegramDriverActions(id)}}
}
async function refreshTelegramBindings(){
  const warehouseId=activeWarehouseId();if(!warehouseId||!window.JustFunDesktop?.telegramCloudflare?.bindings)return false;
  loadTelegramRouteState();
  const result=await window.JustFunDesktop.telegramCloudflare.bindings({warehouseId,environment:telegramEnvironment()});
  if(!result?.ok)return false;
  telegramBindings=new Map((result.bindings||[]).map(binding=>[telegramBindingKey(binding.entityType,binding.entityId),binding]));
  if(telegramBindings.has(telegramBindingKey('warehouse',warehouseId))&&warehouseId===pendingWarehouseTelegramId())clearPendingWarehouseTelegram();
  renderTelegramWarehouseContext();decorateRouteTelegram();return true
}
async function pollTelegramEventsOnce(){
  const warehouseId=activeWarehouseId();if(!warehouseId||!window.JustFunDesktop?.telegramCloudflare?.pollEvents)return false;
  const result=await window.JustFunDesktop.telegramCloudflare.pollEvents({warehouseId,environment:telegramEnvironment()});
  if(!result?.ok)throw Object.assign(new Error(result?.error||'Опрос Telegram временно недоступен.'),{code:String(result?.code||'TELEGRAM_POLL_FAILED')});
  applyTelegramEvents(result.events||[]);return true
}
function stopTelegramPolling(){if(telegramPollTimer)clearTimeout(telegramPollTimer);telegramPollTimer=null;telegramPollFailures=0}
function telegramPollDelay(){return Math.min(5*60*1000,15000*Math.pow(2,Math.min(5,telegramPollFailures)))}
async function telegramPollingStep(){telegramPollTimer=null;if(isTrainingEnvironment()||!currentUser||(desktopSession?.edition!=='demo'&&!desktopSession?.auth)){stopTelegramPolling();return}try{if(telegramPollingConfigured===null){const status=await window.JustFunDesktop?.telegramCloudflare?.status?.({warehouseId:activeWarehouseId()});lastTelegramStatus=status||null;telegramPollingConfigured=Boolean(status?.configured&&status?.online);renderTelegramWarehouseContext()}if(!telegramPollingConfigured){stopTelegramPolling();return}await pollTelegramEventsOnce();telegramPollFailures=0}catch(error){telegramPollFailures+=1;if(['TELEGRAM_NOT_CONFIGURED','INVALID_SESSION','AUTH_REQUIRED','WAREHOUSE_ACCESS_DENIED'].includes(String(error?.code||''))||telegramPollFailures>=7){telegramPollingConfigured=false;stopTelegramPolling();return}}telegramPollTimer=setTimeout(telegramPollingStep,telegramPollDelay())}
function startTelegramPolling(){if(telegramPollTimer||telegramPollingConfigured===false)return;telegramPollTimer=setTimeout(telegramPollingStep,0)}
function installTelegramRouteActions(){
  if(telegramRouteGuardInstalled)return;
  telegramRouteGuardInstalled=true;
  document.addEventListener('jf:routes-rendered',()=>setTimeout(decorateRouteTelegram,0));
  setTimeout(decorateRouteTelegram,0);
}
let telegramDriverGuardInstalled=false;
function installTelegramDriverActions(){
  if(telegramDriverGuardInstalled||typeof window.openDriverDetails!=='function')return;
  telegramDriverGuardInstalled=true;
  window.JustFunOverrides.wrap('openDriverDetails','desktop-telegram-v750',base=>function(driverId){const result=base.apply(this,arguments);setTimeout(()=>injectTelegramDriverActions(driverId),0);return result})
}
function injectTelegramDriverActions(driverId){
  const warehouseId=activeWarehouseId(),driver=typeof drivers!=='undefined'?drivers.find(x=>String(x.id)===String(driverId)):null,body=q('#driverDetailBody');if(!driver||!body||body.querySelector('.jf-telegram-driver')||String(driver.warehouseId||warehouseId)!==warehouseId)return;if(typeof driverIsAggregator==='function'&&driverIsAggregator(driver))return;
  const training=isTrainingEnvironment(),binding=training?null:telegramBindings.get(telegramBindingKey('driver',String(driver.id))),section=document.createElement('div');section.className='detail-section jf-telegram-driver';section.dataset.driverId=String(driver.id);section.innerHTML=`<h2 class="detail-section-title">Telegram водителя</h2><div class="jf-route-telegram-head"><div class="muted">Одноразовая ссылка относится только к водителю «${esc(driver.name)}» и складу «${esc(activeWarehouseLabel())}». Chat ID вручную не вводится.</div><span class="jf-telegram-state ${binding?'sent':''}">${binding?`Подключён${binding.username?`: @${esc(binding.username)}`:''}`:'Не подключён'}</span></div><div class="jf-telegram-driver-actions"><button class="btn-primary" type="button" data-driver-link ${training?'disabled':''}>${binding?'Создать новую ссылку':'Подключить водителя'}</button><button class="btn-soft" type="button" data-driver-test ${binding&&!training?'':'disabled'}>Отправить проверку</button></div><div class="jf-telegram-driver-result" data-driver-result hidden></div>`;body.prepend(section);const resultBox=q('[data-driver-result]',section);
  q('[data-driver-link]',section).onclick=async event=>{const button=event.currentTarget;setIntegrationBusy(button,true);try{const result=await window.JustFunDesktop?.telegramCloudflare?.createLink?.({warehouseId,entityType:'driver',entityId:String(driver.id),label:driver.name});if(!result?.ok)throw new Error(result?.error||'Ссылка не создана');resultBox.hidden=false;resultBox.innerHTML=`Откройте ссылку на телефоне водителя и нажмите START:<br><a href="${esc(result.deepLink)}" target="_blank" rel="noopener">${esc(result.deepLink)}</a><br><small>После START статус обновится в программе автоматически.</small>`;setTimeout(()=>pollTelegramEventsOnce().catch(()=>{}),1500)}catch(error){resultBox.hidden=false;resultBox.textContent=userVisibleError(error,'Ссылка не создана')}finally{setIntegrationBusy(button,false)}};
  q('[data-driver-test]',section).onclick=async event=>{const button=event.currentTarget;setIntegrationBusy(button,true);try{const key=`warehouse:${warehouseId}:driver:${driver.id}:test:${Date.now()}`,response=await window.JustFunDesktop?.telegramCloudflare?.sendNotification?.({warehouseId,entityType:'driver',entityId:String(driver.id),idempotencyKey:key,text:`JustFun · проверка связи\nСклад: ${activeWarehouseLabel()}\nВодитель: ${driver.name}`,statusButtons:false});if(!response?.ok)throw new Error(response?.error||'Уведомление не отправлено');resultBox.hidden=false;resultBox.textContent=response.duplicate?'Проверочное сообщение уже было отправлено.':'Проверочное сообщение отправлено.'}catch(error){resultBox.hidden=false;resultBox.textContent=userVisibleError(error,'Уведомление не отправлено')}finally{setIntegrationBusy(button,false)}}
}
const HELP={
  warehousePoint:{
    title:'Склад и начальная точка маршрута',
    summary:'Здесь программа узнаёт, откуда выезжают машины и от какой точки считать расстояние, время и стоимость доставки.',
    purpose:['Адрес и отметка на карте становятся началом каждого рейса активного склада.','Пока точка склада не подтверждена, заказы и товары доступны, но построение маршрутов безопасно заблокировано.'],
    steps:['Введите полный адрес: город, улицу, дом или понятное название складского комплекса.','Нажмите «Найти склад на карте». Если найдено несколько мест, выберите правильное и сверьте отметку на карте.','Если вы физически находитесь на складе, можно нажать «Моя геопозиция», затем обязательно проверить точность отметки.','Убедитесь, что в сообщении под кнопками нет предупреждения и точка стоит именно у въезда или зоны погрузки.','Сохраните настройки маршрута в соседнем блоке.'],
    result:['Новые доставки считаются от правильного склада.','Маршрутные листы, километраж, график погрузки и стоимость доставки используют одну подтверждённую точку.'],
    check:['Создайте учебный заказ с адресом доставки и проверьте, что расстояние не равно нулю.','Откройте «Рейсы по районам»: предупреждение о ненастроенном складе должно исчезнуть.'],
    important:['Настройка относится только к активному складу. Перед изменением посмотрите название склада в верхней части программы.','Не ставьте точку в центре города или района: это исказит все расстояния и суммы доставки.']
  },
  routeRules:{
    title:'Правила рейса и ограничения маршрута',
    summary:'Эти параметры определяют, какие рейсы программа считает допустимыми и когда она запретит ошибочный выезд.',
    purpose:['Схема «в круг» учитывает возвращение машины на склад; схема «без возврата» завершает расчёт на последней точке.','Лимиты времени, пробега, количества точек и разгрузки защищают от перегруженных или нереальных маршрутов.'],
    steps:['Выберите схему движения. Для собственного автопарка обычно используют «Склад → точки → склад».','Укажите нормальный диапазон рабочего времени рейса. Короткий рейс даст рекомендацию, слишком длинный — блокировку.','Задайте минимальное и максимальное время разгрузки. Программа выберет время внутри диапазона по объёму и сложности заказа.','Укажите максимальное число точек и допустимый пробег.','Оставьте профиль «Автомобиль / фургон», если не подключён другой дорожный профиль.','Нажмите «Сохранить настройки маршрута», затем пересчитайте ещё не выпущенные рейсы.'],
    result:['Новые рейсы проверяются по единому правилу.','Уже закрытые рейсы и сохранённые документы не переписываются задним числом.'],
    check:['Откройте карточку рассчитанного рейса и посмотрите блок проверок: дата, адреса, склад, товар, машина, пробег и время должны быть отмечены как пройденные.','Проверьте один дальний и один короткий рейс — пояснения должны соответствовать заданным лимитам.'],
    important:['Кнопка скрытия подсказок убирает только подробное описание. Обязательная защита от ошибочного выезда остаётся включённой.','Не увеличивайте лимиты только ради исчезновения предупреждения: сначала проверьте адрес, состав груза и назначенный автомобиль.']
  },
  loading:{
    title:'График подачи машин и погрузки',
    summary:'Программа раздаёт рейсам время приезда, погрузочное место и плановый выезд, чтобы машины не образовывали очередь.',
    purpose:['Несколько погрузочных мест работают параллельно. Когда все заняты, следующий рейс получает новую волну времени.','Дальние рейсы можно выпускать первыми, чтобы они раньше вернулись или успели к клиенту.'],
    steps:['Укажите начало первой погрузки по реальному времени работы склада.','Введите число мест, где машины действительно можно грузить одновременно.','Задайте среднюю длительность погрузки одной машины и технический интервал между слотами.','Укажите, за сколько минут водитель должен приехать, и допустимое окно раннего прибытия.','Выберите очередность: сначала дальние рейсы или по названию.','Нажмите «Сохранить и пересчитать график».'],
    result:['В карточке рейса и маршрутном листе появятся время подачи, номер места, интервал погрузки и плановый выезд.','Водителю можно отправить точное время через Telegram после подключения.'],
    check:['Создайте несколько рейсов на одну дату. У рейсов на одном месте интервалы не должны пересекаться.','При двух местах первые две машины должны грузиться параллельно, третья — в следующей волне.'],
    important:['Не указывайте больше погрузочных мест, чем работает фактически.','После изменения графика сообщите водителям обновлённое время; уже отправленное сообщение Telegram само не изменится.']
  },
  driverPayments:{
    title:'Общие правила оплаты водителей',
    summary:'Итоговая сумма складывается из включённых правил: подача, рейс, километры, точки, часы, переработка и минимальная гарантия.',
    purpose:['Общие правила служат исходным шаблоном расчёта.','В карточке конкретного водителя можно задать его персональную схему; она имеет приоритет при назначении на рейс.'],
    steps:['Включите общий расчёт.','Оставьте активными только те начисления, которые предусмотрены вашими договорами.','Заполните ставки. Для километров выберите: весь круг или только путь по точкам.','Если включены часы, задайте округление и решите, оплачивается ли погрузка.','Если используется переработка, укажите порог и дополнительную ставку.','Минимальную гарантию включайте последней: она повышает итог до минимума, но не прибавляется сверху.','Сохраните расчёт и проверьте предварительную сумму в карточке рейса.'],
    result:['Плановая оплата видна в рейсах, карточке водителя и управленческой отчётности.','При закрытии рейса сохраняется снимок расчёта, поэтому история остаётся объяснимой.'],
    check:['Возьмите один короткий и один дальний рейс и вручную сверяйте каждую строку начисления.','Проверьте, что отключённое правило не попало в итог, а минимальная гарантия сработала только при меньшей сумме.'],
    important:['Стоимость для клиента и оплата водителю — разные настройки. Изменение одной не должно автоматически менять другую.','Перед массовым использованием согласуйте формулу с бухгалтерией и водителями.']
  },
  individualPayments:{
    title:'Индивидуальная оплата исполнителей',
    summary:'Ставки штатного водителя или службы доставки задаются в его собственной карточке, а не одной цифрой на весь автопарк.',
    purpose:['Обычный водитель может получать оплату по персональным правилам.','Агрегатор может работать по фиксированному тарифу или по фактической цене заявки.'],
    steps:['Нажмите «Открыть водителей».','Откройте нужного исполнителя и нажмите редактирование.','Выберите тип: водитель или агрегатор доставки.','Для водителя включите персональные правила и ставки. Для агрегатора укажите сервис, режим тарифа и данные кабинета без пароля.','Сохраните карточку, назначьте исполнителя на тестовый рейс и сверьте сумму.'],
    result:['Каждый рейс рассчитывается по правилам назначенного исполнителя.','При смене исполнителя плановая стоимость пересчитывается, пока машина не выехала.'],
    check:['Сравните один и тот же рейс с двумя разными исполнителями.','Для агрегатора «по заявке» программа должна требовать номер заявки и фактическую стоимость до выезда.'],
    important:['Пароли от кабинетов агрегаторов в программу не вводятся.','После выезда замена исполнителя и схемы движения блокируется, чтобы не испортить историю.']
  },
  deliveryPricing:{
    title:'Стоимость доставки для клиента',
    summary:'Сначала заказ получает цену отдельной поездки, затем общие участки готового рейса можно распределить между клиентами.',
    purpose:['Продажный тариф формирует доход от доставки.','Распределение по рейсу показывает клиентам экономию и контролирует маржу относительно оплаты исполнителя.'],
    steps:['Включите распределение, если оно используется в вашей компании.','Укажите продажный тариф за километр, подачу машины и обслуживание одной точки.','Выберите, какая доля обратного пути включается в цену клиентов.','Задайте минимальную цену заказа, правило одиночной точки, округление и целевую маржу.','Сохраните настройки. В новом заказе проверьте отдельную стоимость.','После формирования рейса откройте его изменение, просмотрите предложение и примените распределение.'],
    result:['В заказе сохраняется отдельная и распределённая стоимость, а также экономия клиента.','Оплаченные заказы, ручные цены и зафиксированные суммы не меняются автоматически.'],
    check:['Сумма товаров плюс доставка должна равняться итогу заказа.','Сумма распределённой доставки по рейсу должна покрывать заданные расходы и показывать ожидаемую маржу.'],
    important:['Нулевая цена допустима только как осознанное решение.','После оплаты не пересчитывайте цену без отдельной корректирующей операции и согласования с клиентом.']
  },
  warehouses:{
    title:'Склады и отдельные рабочие пространства',
    summary:'Каждый склад имеет собственные заказы, товары, остатки, рейсы, водителей, отчёты, документы и отдельную учебную среду.',
    purpose:['Переключение склада полностью перезагружает рабочее пространство, чтобы формы и данные не смешались.','Новый склад создаётся пустым; при необходимости можно скопировать только безопасные настройки.'],
    steps:['Нажмите «Добавить склад».','Введите понятное название и короткий уникальный код, который будет виден в документах и именах копий.','Укажите адрес и точные координаты точки погрузки.','Выберите, какие настройки скопировать. Заказы, остатки и движения товаров не копируются.','Сохраните склад и переключитесь на него через верхний выбор склада.','Заполните реквизиты, товары, водителей и права пользователей для нового склада.'],
    result:['Данные каждого склада сохраняются отдельно и синхронизируются на сервер под своим идентификатором.','Архивирование скрывает склад без удаления его истории.'],
    check:['Создайте учебную запись в одном складе, переключитесь на другой и убедитесь, что запись там не появилась.','Вернитесь обратно — исходные данные должны сохраниться.'],
    important:['Активный склад удалить нельзя. Сначала переключитесь на другой.','Удаление возможно только после архивации, проверки назначенных пользователей, резервной копии и ввода кода склада. Оно необратимо.']
  },
  company:{
    title:'Компания, логотип и печатные документы',
    summary:'Здесь задаются название, реквизиты, контакты, логотип, нумерация счетов и оформление документов активного склада.',
    purpose:['Новый заказ сохраняет снимок реквизитов и склада. Поэтому старый документ не меняется, если компания позже обновит адрес или логотип.','Рекламный блок можно добавить в новые клиентские документы.'],
    steps:['Заполните короткое название для интерфейса и полное юридическое название для документов.','Внесите ИНН, КПП, ОГРН, юридический и фактический адреса.','Заполните телефон, электронную почту, сайт, контактное лицо и часы работы.','При необходимости внесите банк, БИК, расчётный и корреспондентский счета.','Загрузите чёткий логотип, выберите его положение и где его показывать.','Настройте префикс и формат номера счёта.','Нажмите «Сохранить оформление», создайте тестовый заказ и распечатайте его.'],
    result:['Печатный заказ, лист самовывоза, маршрутный лист и отчёт используют реквизиты активной компании.','Номера новых счетов формируются последовательно и не меняют уже созданные документы.'],
    check:['В предварительном просмотре не должно быть обрезанного логотипа, пустых обязательных реквизитов, слов «undefined» или «NaN».','Сверьте название склада, номер счёта, товары, суммы и подписи.'],
    important:['Не загружайте фотографию документа вместо логотипа. Лучше использовать квадратный или горизонтальный PNG с прозрачным фоном.','Изменение реквизитов влияет только на новые снимки документов; старые заказы сохраняют прежние данные для истории.']
  },
  users:{
    title:'Пользователи, роли, склады и компьютеры',
    summary:'Владелец создаёт одноразовое приглашение, назначает роль и даёт сотруднику только нужные склады.',
    purpose:['Роль ограничивает разделы и действия, а список складов ограничивает доступ к данным.','Блокировка компьютера прекращает вход с конкретного устройства без удаления сотрудника.'],
    steps:['Нажмите «Создать приглашение».','Введите ФИО и уникальный логин сотрудника.','Выберите минимально необходимую роль, а не роль владельца «на всякий случай».','Назначьте один или несколько складов.','Передайте сотруднику одноразовый код по безопасному каналу. Сотрудник сам задаст пароль на своём компьютере.','После первого входа проверьте список пользователей и подключённых компьютеров.'],
    result:['Сотрудник видит только разрешённые разделы и склады.','Права можно изменить, сотрудника или потерянный компьютер — заблокировать.'],
    check:['Войдите тестовой учётной записью и проверьте вкладки, кнопки изменения и переключение складов.','Убедитесь, что сотрудник не видит склад, который ему не назначен.'],
    important:['Не отправляйте пароль сотрудника в чате и не создавайте общий логин на весь отдел.','Свою учётную запись владельца и текущий компьютер программа защищает от случайной блокировки.']
  },
  demo:{
    title:'Демонстрация программы на 72 часа',
    summary:'DEMO — отдельная учебная база с заказами, товарами, рейсами, водителями, оплатами и отчётами; рабочие данные она не изменяет.',
    purpose:['В DEMO-редакции учебная база включается автоматически, а в полной версии служит безопасным тренажёром.','Срок 72 часа привязан к компьютеру и подтверждается Cloudflare; переустановка не начинает срок заново.'],
    steps:['Запустите DEMO и посмотрите оставшееся время в верхней полосе.','Пройдите цепочку: заказ → товар → рейс → водитель → выезд → возврат → закрытие → отчёт.','Проверьте готовый самовывоз, отмену, частичную и повторную доставку.','Если учебные данные были сильно изменены, нажмите «Запустить демонстрацию заново». Это обновит сценарий, но не сбросит лицензионный таймер.','Для возврата к работе выйдите из демонстрации или переключитесь на полную редакцию.'],
    result:['Все учебные изменения остаются в среде DEMO выбранного склада.','Рабочая среда LIVE, серверные копии и реальные уведомления не смешиваются с учебными.'],
    check:['Запомните число реальных заказов до входа в DEMO; после выхода оно должно остаться тем же.','Переустановка в другую папку должна продолжить прежний обратный отсчёт, а не выдать новые 72 часа.'],
    important:['Не вводите в DEMO настоящие персональные данные клиентов.','Истечение срока открывает экран покупки или входа; перевод часов назад не добавляет время.']
  },
  updates:{
    title:'Безопасное обновление программы',
    summary:'Программа проверяет цифровую подпись и целостность новой версии до установки, а при неудачном запуске автоматически возвращает предыдущую.',
    purpose:['Обновление заменяет только файлы программы и не переносит рабочую базу складов.','Постепенный выпуск позволяет сначала проверить новую версию на ограниченной группе компьютеров.'],
    steps:['Нажмите «Проверить обновление».','Если новая версия доступна, нажмите «Скачать обновление» и дождитесь окончания проверки.','Сохраните незавершённую работу.','Выберите «Перезапустить и обновить» для установки сейчас или «После закрытия», чтобы программа обновилась при обычном выходе.','Кнопка «Напомнить позже» откладывает напоминание на сутки.','После повторного запуска убедитесь, что блок показывает новую установленную версию.'],
    result:['Проверенная версия устанавливается без повторного запуска установщика вручную.','Если новая версия не подтвердит успешный запуск, предыдущая версия восстановится автоматически.'],
    check:['Сверьте номер установленной версии после перезапуска.','Проверьте строку последней операции. При сообщении о восстановлении скопируйте безопасный код диагностики и передайте его поддержке.'],
    important:['Не выключайте компьютер во время установки.','Обновление без подтверждённой подписи или с повреждённым файлом автоматически блокируется.']
  },
  reliability:{
    title:'Резервные копии, восстановление и диагностика',
    summary:'Этот блок помогает пережить ошибку пользователя, повреждение диска, неудачный импорт или перенос на другой компьютер.',
    purpose:['Копия включает заказы, товары, складские движения, рейсы, водителей, настройки, оплаты, архив и отчётность активного склада.','Диагностика исправляет разорванные связи и не затирает повреждённый раздел до сохранения его в карантин.'],
    steps:['Перед большим изменением нажмите «Скачать копию» и сохраните JSON-файл вне рабочего компьютера.','Для восстановления выберите «Загрузить копию». Программа проверит структуру и принадлежность активному складу.','Подтвердите замену только после проверки названия склада и среды LIVE/DEMO. Перед импортом создаётся страховочная копия.','После восстановления нажмите «Проверить систему».','Если возникла ошибка запуска или синхронизации, откройте папку logs и передайте последний журнал поддержке.'],
    result:['Потерянное состояние можно восстановить без смешивания складов.','Встроенная самопроверка показывает целостность заказов, рейсов, склада, водителей и отчётов.'],
    check:['Скачайте копию и убедитесь, что файл имеет код склада, среду и текущую дату в имени.','Проведите контрольное восстановление только в DEMO или на тестовой копии и сравните количества заказов, товаров и рейсов.'],
    important:['Храните минимум две последние копии на другом физическом диске или в защищённом облаке.','Никогда не редактируйте JSON вручную, если не понимаете структуру данных.','Копия одного склада намеренно не импортируется в другой склад.']
  },
  integrations:{
    title:'REG.RU VPS, Telegram и Cloudflare',
    summary:'Владелец один раз подключает серверную копию данных и Telegram; сотрудники получают доступ через свои роли и склады без передачи секретов.',
    purpose:['REG.RU VPS хранит защищённые снимки складов в PostgreSQL и помогает восстановить новый компьютер.','Telegram отправляет маршрут водителю или складу и принимает статусы обратно в JustFun.'],
    steps:['REG.RU: введите IP VPS, SSH-пользователя и порт. Нажмите «Установить или обновить VPS».','Сверьте показанный отпечаток SSH-ключа с данными сервера и только потом введите пароль в отдельном окне. Пароль не сохраняется.','Нажмите «Проверить связь», затем «Сохранить активный склад». Для проверки восстановления сначала используйте DEMO или тестовый склад.','Telegram: создайте отдельного бота через @BotFather и скопируйте его токен.','В Cloudflare создайте временный ограниченный API-токен для настройки Worker и D1. Собственный домен не нужен.','Нажмите «Настроить Telegram» и введите оба токена в защищённом мастере. Дождитесь всех зелёных этапов и проверки webhook.','Удалите временный Cloudflare API-токен после успешной настройки. Токен бота остаётся только как Cloudflare Secret.','Нажмите «Подключить группу склада», добавьте бота в нужную группу и отправьте показанную одноразовую команду.','Откройте карточку водителя, создайте его персональную ссылку и выполните START на телефоне водителя.'],
    result:['У активного склада появляются отдельные серверная копия, Telegram-группа и привязки водителей.','Статусы «принял», «на складе», «готов», «в пути» и результаты доставки возвращаются в программу автоматически.'],
    check:['Значки REG.RU и Telegram должны показывать «Работает» или «Настроен».','Отправьте тест водителю и группе склада, затем проверьте появление статуса в рейсе.','Сохраните и восстановите только тестовый склад, сравнив контрольную версию и количество сущностей.'],
    important:['Никому не отправляйте SSH-пароль, Cloudflare API-токен или токен бота. Не вставляйте их в обычный чат.','Cloudflare API-токен должен быть временным и ограниченным; мастер его не сохраняет.','Кнопка «Восстановить активный склад» заменяет локальное состояние — сначала скачайте резервную копию.']
  },
  regIntegration:{
    title:'Сервер и резервные копии REG.RU',
    summary:'REG.RU хранит защищённые серверные снимки складов. Если VPS временно выключен, программа продолжает работать с локальной базой и повторяет подключение в фоне.',
    purpose:['Серверная копия помогает восстановить данные после поломки или при установке на новый компьютер.','Каждый склад и каждая компания имеют отдельную область хранения.'],
    steps:['Проверьте оплату и состояние VPS в личном кабинете REG.RU. Сервер должен быть включён.','Введите IP-адрес, SSH-пользователя и порт. Обычно используются root и порт 22.','Нажмите «Установить или обновить VPS». В отдельном защищённом окне введите SSH-пароль.','При первом подключении сравните отпечаток ключа с данными сервера и подтвердите только полное совпадение.','После зелёного результата нажмите «Проверить связь», затем «Сохранить активный склад».','Для контрольного восстановления используйте DEMO или отдельный тестовый склад.'],
    result:['Локальная работа не зависит от времени ответа VPS.','После восстановления связи новые изменения автоматически отправляются в защищённую копию.'],
    check:['Статус блока показывает «Работает», версию сервера и готовность PostgreSQL.','Сохраните учебный склад, измените одну учебную запись и выполните восстановление только после резервной копии.'],
    important:['Если VPS отключён за неуплату, сначала включите его в REG.RU — повторная установка базы не нужна.','Не сообщайте SSH-пароль и не открывайте PostgreSQL в интернет.','Перед восстановлением всегда скачивайте локальную резервную копию.']
  },
  telegramIntegration:{
    title:'Telegram-бот и Cloudflare',
    summary:'Telegram работает через отдельный Cloudflare Worker и D1. Он не зависит от REG.RU и не использует IP, SSH-пароль или PostgreSQL сервера.',
    purpose:['Бот передаёт задания складу и водителям, принимает статусы и результаты доставки.','Cloudflare хранит токен бота как секрет и изолирует данные компаний.'],
    steps:['Создайте бота через @BotFather и сохраните выданный токен.','В Cloudflare создайте временный ограниченный API-токен для Worker и D1. Собственный домен не требуется.','Нажмите «Настроить Telegram» и введите оба токена только в защищённом мастере.','Дождитесь создания D1, Worker, секрета и webhook — каждый этап должен завершиться успешно.','После успешной настройки удалите временный Cloudflare API-токен в кабинете Cloudflare.','Нажмите «Подключить группу склада», добавьте бота в группу и отправьте одноразовую команду.','Создайте персональную ссылку в карточке водителя и нажмите START на его телефоне.'],
    result:['Группа склада и водители получают только назначенные им задания.','Статусы возвращаются в соответствующий рейс без передачи секретов сотрудникам.'],
    check:['Нажмите «Проверить webhook»: должны быть подтверждены Worker, бот и адрес webhook.','Отправьте тестовое задание в DEMO и проверьте обратный статус в карточке рейса.'],
    important:['Не отправляйте токен бота или Cloudflare API-токен в чат.','Ошибка REG.RU сама по себе не мешает Cloudflare; проверяйте два блока отдельно.','Если профиль ещё не создан, «Проверить и восстановить» не заменяет первоначальную настройку.']
  },
  maps:{
    title:'Служебные адреса OpenStreetMap',
    summary:'Nominatim ищет адреса, OSRM строит дорогу, а сервер тайлов показывает саму карту.',
    purpose:['Три сервиса выполняют разные задачи. Отказ одного не должен незаметно подменяться другим.','Стандартные адреса уже настроены и подходят большинству пользователей.'],
    steps:['Не меняйте поля, если поиск адреса, карта и маршруты работают.','Если служба недоступна, сначала проверьте интернет и повторите действие.','Меняйте адрес только по инструкции администратора или поддержки и только на HTTPS-адрес доверенного сервиса.','Нажмите «Сохранить сервисы» и проверьте поиск адреса, отображение карты и расчёт рейса.','Если стало хуже, нажмите «Вернуть стандартные».'],
    result:['Поиск, дорожный расчёт и карта используют выбранные службы.','Интерфейс карты загружается из программы локально; из сети приходят только картографические данные.'],
    check:['Найдите известный адрес и сверьте область, район и точку.','Постройте рейс и убедитесь, что появились километры, время и последовательность точек.'],
    important:['Не вставляйте случайные ссылки из интернета: владелец такого сервера сможет видеть запросы адресов.','Публичные службы имеют ограничения нагрузки; для большого потока нужен согласованный собственный или коммерческий сервис.']
  },
  general:{
    title:'Настройка программы',
    summary:'Изменяйте один блок за раз, сохраняйте и проверяйте результат на учебных данных.',
    purpose:['Пошаговая проверка помогает понять, какая настройка повлияла на результат.'],
    steps:['Скачайте резервную копию активного склада.','Измените только нужный параметр.','Нажмите кнопку сохранения в этом блоке.','Откройте связанный раздел и выполните один тестовый сценарий.'],
    result:['Настройка применяется только к активному складу и текущей среде, если в описании не указано другое.'],
    check:['Перезапустите связанный раздел и убедитесь, что значение сохранилось.'],
    important:['Если результат непонятен, верните прежнее значение и откройте журнал диагностики.']
  }
};
let helpReturnFocus=null,helpObserverInstalled=false,helpInstallBusy=false;
let desktopDialogAccessibilityInstalled=false;
const desktopDialogReturnFocus=new WeakMap();
const desktopDialogSelector='.jf-profile-modal,.jf-help-modal,.jf-dialog-overlay';
const desktopDialogOpenSelector='.jf-profile-modal.open,.jf-help-modal.open,.jf-dialog-overlay.open';
function desktopDialogFocusables(root){return qa('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',root).filter(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&(window.__JF_RUNTIME_TEST__||(rect.width>0&&rect.height>0))})}
function prepareDesktopDialogAccessibility(modal){
  if(!modal?.matches?.(desktopDialogSelector))return;
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  const heading=q('h1,h2,h3',modal);if(heading){if(!heading.id)heading.id=`${modal.id||'jfDialog'}Title`;modal.setAttribute('aria-labelledby',heading.id)}else if(!modal.hasAttribute('aria-label'))modal.setAttribute('aria-label','Диалог программы');
  if(!modal.classList.contains('open')){if(modal.dataset.jfDialogOpen){delete modal.dataset.jfDialogOpen;const previous=desktopDialogReturnFocus.get(modal);desktopDialogReturnFocus.delete(modal);if(previous&&document.contains(previous)&&!document.querySelector(desktopDialogOpenSelector))setTimeout(()=>previous.focus(),0)}return}
  if(modal.dataset.jfDialogOpen)return;
  modal.dataset.jfDialogOpen='1';desktopDialogReturnFocus.set(modal,modal.id==='jfHelpModal'&&helpReturnFocus?helpReturnFocus:document.activeElement);
  setTimeout(()=>{if(!modal.classList.contains('open')||modal.contains(document.activeElement))return;const first=desktopDialogFocusables(modal)[0],surface=q('.jf-dialog',modal);if(surface&&!surface.hasAttribute('tabindex'))surface.tabIndex=-1;(first||surface)?.focus()},0)
}
function closeTopDesktopDialog(modal){
  const close=q('[data-dialog-cancel],[aria-label^="Закрыть"],#jfProfileClose,#jfUserCancel,#jfAccessCancel,#jfInvitationDone,#jfHelpClose',modal);
  if(close){close.click();return}modal.classList.remove('open')
}
function installDesktopDialogAccessibility(){
  if(desktopDialogAccessibilityInstalled)return;desktopDialogAccessibilityInstalled=true;
  const sync=()=>qa(desktopDialogSelector).forEach(prepareDesktopDialogAccessibility);sync();
  new MutationObserver(sync).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('keydown',event=>{const open=qa(desktopDialogOpenSelector).pop();if(!open)return;if(event.key==='Escape'){event.preventDefault();closeTopDesktopDialog(open);return}if(event.key!=='Tab')return;const list=desktopDialogFocusables(open);if(!list.length){event.preventDefault();q('.jf-dialog',open)?.focus();return}const first=list[0],last=list[list.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}else if(!open.contains(document.activeElement)){event.preventDefault();first.focus()}})
}
function helpKeyForBox(box){
  if(box.id==='jfUsersBox')return'users';if(box.id==='jfUpdateCenter')return'updates';if(box.id==='jfRegIntegrationsBox')return'regIntegration';if(box.id==='jfTelegramIntegrationsBox')return'telegramIntegration';if(box.id==='jfIntegrationsBox')return'integrations';if(box.id==='warehouseManagerV600')return'warehouses';if(box.id==='companySettingsV600')return'company';
  if(box.classList.contains('demo-settings-box'))return'demo';if(box.classList.contains('warehouse-manager-box'))return'warehouses';if(box.classList.contains('company-settings-box'))return'company';if(box.classList.contains('route-rules-box'))return'routeRules';if(box.classList.contains('arrival-settings-box'))return'loading';if(box.classList.contains('driver-payment-settings-box'))return'driverPayments';if(box.classList.contains('driver-payment-moved-box'))return'individualPayments';if(box.classList.contains('delivery-pricing-settings-box'))return'deliveryPricing';
  const title=String(q('h3',box)?.textContent||'').toLowerCase().replaceAll('ё','е');if(title.includes('склад и начало'))return'warehousePoint';if(title.includes('надежност'))return'reliability';if(title.includes('openstreetmap'))return'maps';if(title.includes('пользовател'))return'users';if(title.includes('компания')&&title.includes('документ'))return'company';return'general'
}
function installHelp(){
  if(helpInstallBusy)return;helpInstallBusy=true;
  try{
    qa('#settingsView .settings-box, #programSettingsView .settings-box').forEach(box=>{
      const key=helpKeyForBox(box),data=HELP[key]||HELP.general,body=q('.settings-accordion-body-v610',box)||box;box.dataset.jfHelpKey=key;
      if(!q('.jf-instruction-btn',box)){const tools=document.createElement('div');tools.className='jf-instruction-tools';const btn=document.createElement('button');btn.type='button';btn.className='btn-soft jf-instruction-btn';btn.textContent='Подробная инструкция';btn.setAttribute('aria-haspopup','dialog');btn.title=`Открыть пошаговую инструкцию: ${data.title}`;btn.onclick=()=>openHelp(data);tools.append(btn);body.prepend(tools)}
      if(key==='users'){q('.jf-settings-help',box)?.remove()}
      else if(!q('.jf-settings-help',box)&&!q('.jf-integration-lead',body)){const hint=document.createElement('div');hint.className='jf-settings-help';hint.textContent=data.summary;const h=q('h3',body);h?.parentElement?.insertBefore(hint,h.nextSibling)}
    });
    if(!helpObserverInstalled){helpObserverInstalled=true;const observer=new MutationObserver(()=>queueMicrotask(installHelp));for(const grid of qa('#settingsView .settings-grid, #programSettingsView .settings-grid'))observer.observe(grid,{childList:true,subtree:true})}
  }finally{helpInstallBusy=false}
}
function closeHelp(){const modal=q('#jfHelpModal');if(!modal?.classList.contains('open'))return;modal.classList.remove('open');if(helpReturnFocus&&document.contains(helpReturnFocus))helpReturnFocus.focus();helpReturnFocus=null}
function helpList(title,items,ordered=false,kind=''){if(!asArray(items).length)return'';const tag=ordered?'ol':'ul';return`<section class="jf-help-section ${kind}"><h3>${esc(title)}</h3><${tag}>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</${tag}></section>`}
function openHelp(data){
  const guide=data&&typeof data==='object'?data:HELP.general;helpReturnFocus=document.activeElement;let modal=q('#jfHelpModal');
  if(!modal){modal=document.createElement('div');modal.id='jfHelpModal';modal.className='jf-help-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.addEventListener('click',event=>{if(event.target===modal)closeHelp()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))closeHelp()});document.body.append(modal)}
  modal.setAttribute('aria-labelledby','jfHelpTitle');modal.innerHTML=`<div class="jf-dialog jf-help-dialog"><div class="jf-help-head"><div><span>Пошаговая инструкция</span><h2 id="jfHelpTitle">${esc(guide.title)}</h2></div><button type="button" class="btn-gray jf-help-x" id="jfHelpX" aria-label="Закрыть инструкцию">×</button></div><div class="jf-help-scroll" tabindex="0"><p class="jf-help-summary">${esc(guide.summary)}</p>${helpList('Для чего это нужно',guide.purpose)}${helpList('Как настроить',guide.steps,true)}${helpList('Что изменится после сохранения',guide.result)}${helpList('Как проверить результат',guide.check,true,'check')}${helpList('Важно и безопасно',guide.important,false,'warning')}</div><div class="jf-dialog-actions"><button class="btn-primary" id="jfHelpClose">Закрыть инструкцию</button></div></div>`;modal.classList.add('open');q('#jfHelpClose').onclick=closeHelp;q('#jfHelpX').onclick=closeHelp;q('#jfHelpX').focus()
}
function confirmStartupReady(surface){
  if(startupReadySent)return;startupReadySent=true;
  window.JustFunDesktop?.startupReady?.({surface,readyState:document.readyState,warehouseId:activeWarehouseId()}).catch?.(error=>console.error('Startup ready confirmation failed',error));
}
function handleDesktopAppEvent(event){
  const type=String(event?.type||''),message=String(event?.message||'').trim();
  if(type==='warning'&&message){toast(message,'error');return}
  if(type==='warehouse-delete-resume'&&message){toast(message,event?.status==='completed'?'ok':'error');return}
  if(type==='warehouse-delete-refresh'){
    if(message)toast(message,event?.status==='completed-elsewhere'?'ok':'error');
    const before=activeWarehouseId();
    synchronizeCompanyWarehouseRegistry().then(()=>applyWarehouseRegistryTransition(before,'warehouse-delete-server-refresh')).catch(error=>{toast(error?.message||'Не удалось обновить список складов с VPS.','error');audit('warehouse_delete_registry_refresh_failed',{code:error?.code||'',warehouseId:String(event?.warehouseId||'')})});
  }
}
async function init(){
  modernAlert();installDesktopDialogAccessibility();window.JustFunDesktop?.onAppEvent?.(handleDesktopAppEvent);window.JustFunDesktop?.startupStage?.('access-init','Проверяем редакцию и Cloudflare-сессию');desktopSession=await window.JustFunDesktop?.getSession?.()||{edition:'full'};
  window.JustFunDesktop?.onDemoTick?.(x=>{desktopSession.demoRemainingMs=x.remainingMs;updateDemoTime(x.remainingMs)});
  if(desktopSession.edition==='demo'){
    if(!window.TeplitsaWarehouseBootstrap?.isDemo?.())throw new Error('DEMO-среда не была выбрана до чтения данных');
    currentUser={id:'demo-admin',fullName:'Демонстрационный администратор',login:'demo',role:'owner',serverRole:'demo_admin',allWarehouses:true,warehouseIds:[],status:'active',permissions:['*'],companyCode:'DEMO',companyName:'Демонстрационная среда'};users=[currentUser];await enterWorkspace();confirmStartupReady('workspace-demo');return;
  }
  if(desktopSession.auth?.user){const entered=await applyCloudAuth(desktopSession.auth);confirmStartupReady(entered?(desktopSession.auth.offline?'workspace-offline':'workspace-cloud'):'cloud-auth');return}
  renderCloudWelcome();confirmStartupReady('cloud-auth');
}
window.JustFunAccessV760=Object.freeze({version:VERSION,currentUserId:()=>String(currentUser?.id||''),roleTabs:role=>[...(ROLE_TABS[role]||[])],allowedWarehouseIds:user=>allowedWarehouseIds(user),validateAssignment:user=>Boolean(user?.allWarehouses||(user?.warehouseIds||[]).length),refreshUsers:()=>{renderUsersPanel();return users.length},openUserCreator:()=>openUserCreator()});
if(window.__JF_RUNTIME_TEST__)window.__JustFunRoleTest=Object.freeze({snapshot:()=>({role:roleFor(),serverRole:currentUser?.serverRole||'',permissions:permissionList(),allowedTabs:allowedTabs()}),normalizePermissions:value=>normalizePermissionList(value)});
window.JustFunTelegramRoutesV783=Object.freeze({version:VERSION,statusLabel:telegramStatusLabel,refreshBindings:refreshTelegramBindings,poll:pollTelegramEventsOnce,decorate:decorateRouteTelegram,message:routeTelegramMessage});
window.JustFunTelegramSettingsV783=Object.freeze({
  async configure(){await configureTelegram(false);return refreshTelegramStatus()},
  async bindWarehouse(){await bindActiveWarehouseTelegram();await refreshTelegramBindings();return true},
  async warehouseInfo(){const status=await window.JustFunDesktop?.telegramCloudflare?.status?.({warehouseId:activeWarehouseId()});await refreshTelegramBindings().catch(()=>false);return{status,binding:telegramBindings.get(telegramBindingKey('warehouse',activeWarehouseId()))||null}}
});
const runInit=()=>setTimeout(()=>init().catch(error=>{window.JustFunDesktop?.startupStage?.('access-init-error',String(error?.message||error));console.error('Desktop access initialization failed',error)}),0);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',runInit,{once:true});else runInit();
})();
