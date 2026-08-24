/* JustFun Desktop Platform 7.8.3 */
(function(){
'use strict';
const VERSION='7.8.3', AUDIT_KEY='jf_auth_audit_v750', SESSION_KEY='jf_session_v750';
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
  buildAllRoutes:'routes.plan',createManualRoute:'routes.plan',resetRouteAssignments:'routes.plan',
  openRouteComposer:'routes.plan',addOrderToRoute:'routes.plan',removeOrderFromRoute:'routes.plan',
  assignDriverToRoute:'drivers.assign',clearRouteDriver:'drivers.assign',approveRouteManually:'routes.approve',
  restoreAllUnassigned:'routes.plan',restoreAutoAssignment:'routes.plan',clearRoutePlans:'routes.plan',
  startRoutePicking:'routes.pick',cancelRouteBeforeStart:'routes.cancel',startRoute:'routes.start',openRouteClosure:'routes.return',commitRouteClosure:'routes.close',
  saveRouteTitle:'routes.plan',saveRouteEditSettings:'routes.settings',applyRoutePricingProposal:'orders.pricing',
  restoreRouteStandalonePricing:'orders.pricing',saveSettingsFromForm:'routes.settings',
  saveDriverPaymentSettings:'routes.settings',saveDeliveryPricingSettings:'routes.settings',
  openDriverModal:'drivers.update',saveDriver:'drivers.update',deleteDriver:'drivers.delete',deleteCurrentDriver:'drivers.delete',
  openProductModal:'inventory.catalog',saveProduct:'inventory.catalog',deleteProduct:'inventory.delete',deleteCurrentProduct:'inventory.delete',
  openInventoryMovementModal:'inventory.stock',openMovementForCurrentProduct:'inventory.stock',saveInventoryMovement:'inventory.stock',
  importProductsFromOrders:'inventory.catalog',
  saveReportCalculationSettings:'reports.settings',saveReportEmployee:'reports.expenses',deleteReportEmployee:'reports.expenses',
  saveReportExpense:'reports.expenses',deleteReportExpense:'reports.expenses',
  openWarehouseCreatorV600:'warehouses.manage',openWarehouseEditorV600:'warehouses.manage',saveWarehouseEditorV600:'warehouses.manage',
  toggleWarehouseArchiveV600:'warehouses.manage',deleteWarehouseV760:'warehouses.manage',saveCompanySettingsV600:'company.update',
  removeCompanyLogoV600:'company.update',saveServiceSettings:'integrations.manage',resetServiceSettings:'integrations.manage',
  chooseBackupFile:'company.update',importBackupFile:'company.update',clearAll:'company.update',restartDemonstrationScenario:'company.update'
};
const FORM_PERMISSIONS={orderForm:'orders.update',pickupForm:'orders.update',driverForm:'drivers.update',productForm:'inventory.catalog',inventoryMovementForm:'inventory.stock',reportEmployeeForm:'reports.expenses',reportExpenseForm:'reports.expenses'};
const CONTROL_PERMISSIONS={deleteOrderBtn:'orders.delete',deleteDriverBtn:'drivers.delete',deleteProductBtn:'inventory.delete',restartDemoButton:'company.update'};
const DEMO_CLOUD_ADMIN_FUNCTIONS=new Set(['openWarehouseCreatorV600','openWarehouseEditorV600','saveWarehouseEditorV600','toggleWarehouseArchiveV600','deleteWarehouseV760']);
const DEMO_CLOUD_CONTROL_IDS=new Set(['jfAddUser','jfRegConfigure','jfRegCheck','jfRegSync','jfRegRestore','jfTelegramConfigure','jfTelegramReconnect','jfTelegramCheck','jfTelegramWarehouse']);
const CLOUD_ID_RE=/^[A-Za-z0-9_-]{16,80}$/;
let desktopSession=null,currentUser=null,users=[],guardInstalled=false,entityCommandGuardsInstalled=false,permissionEventsInstalled=false,permissionObserverInstalled=false,memorySession=null,startupReadySent=false,integrationWizardBusy=false,backgroundWorkspaceSyncStarted=false;
let telegramBindings=new Map(),telegramRouteState={},telegramRouteScope='',telegramPollTimer=null,telegramPollFailures=0,telegramPollingConfigured=null,lastTelegramStatus=null,telegramRouteGuardInstalled=false;
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)],esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function id(){return crypto.randomUUID?crypto.randomUUID():'u-'+Date.now().toString(36)+Math.random().toString(36).slice(2)}
function audit(action,detail={}){try{const a=JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]');a.unshift({id:id(),at:new Date().toISOString(),userId:currentUser?.id||null,login:currentUser?.login||'',warehouseId:activeWarehouseId(),action,detail});localStorage.setItem(AUDIT_KEY,JSON.stringify(a.slice(0,3000)))}catch{}}
function registry(){return window.TeplitsaWarehouseBootstrap?.getRegistry?.()||{activeWarehouseId:'',warehouses:[]}}
function activeWarehouseId(){return String(window.TeplitsaWarehouseBootstrap?.activeWarehouse?.()?.id||'')}
function allowedWarehouseIds(user=currentUser){if(!user)return[];const all=registry().warehouses.filter(w=>w.status!=='archived').map(w=>String(w.id));return user.allWarehouses?all:(user.warehouseIds||[]).map(String).filter(x=>all.includes(x))}
function roleFor(user=currentUser){return user?.role||'viewer'}
function normalizePermissionList(value){const result=[];for(const permission of Array.isArray(value)?value.map(String):[]){if(!result.includes(permission))result.push(permission);for(const expanded of LEGACY_PERMISSION_EXPANSIONS[permission]||[]){if(!result.includes(expanded))result.push(expanded)}}return result}
function permissionList(user=currentUser){if(!user)return[];if(isTrainingEnvironment()||!user.serverRole)return normalizePermissionList(LOCAL_ROLE_PERMISSIONS[roleFor(user)]||LOCAL_ROLE_PERMISSIONS.viewer);return normalizePermissionList(user.permissions)}
function hasPermission(name,user=currentUser){const list=permissionList(user);if(user?.role==='owner'||list.includes('*'))return true;const domain=String(name||'').split('.')[0];return list.includes(name)||list.includes(domain+'.*')}
window.JustFunWarehouseAccessV783=Object.freeze({canCreate:()=>!isTrainingEnvironment()&&hasPermission('warehouses.manage')&&currentUser?.allWarehouses===true,canDelete:()=>!isTrainingEnvironment()&&hasPermission('warehouses.manage')&&currentUser?.allWarehouses===true});
function resolvedFunctionPermission(name,fallback,args=[]){
  if(name==='openOrderModal'||name==='openPickupModal')return args[0]?'orders.update':'orders.create';
  if(name==='saveOrder'||name==='savePickup')return q('#editingOrderId')?.value?'orders.update':'orders.create';
  return fallback
}
function formPermission(form){if(!form)return'';if(form.id==='orderForm'||form.id==='pickupForm')return q('#editingOrderId')?.value?'orders.update':'orders.create';return FORM_PERMISSIONS[form.id]||''}
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
  currentUser=cloudUserToLocal(auth?.user,auth?.company,auth);users=[currentUser];audit('cloud_login_success',{company:currentUser.companyCode,companyId,offline:!!auth?.offline});return await enterWorkspace()
}
function cloudResultError(result,fallback='Операция не выполнена.'){
  const code=String(result?.error||'');
  const known={LOGIN_ALREADY_EXISTS:'В этой компании уже есть сотрудник с таким логином. Укажите другой логин.',INVITATION_ALREADY_EXISTS:'Для этого логина уже действует приглашение. Используйте его или дождитесь окончания срока.',INVALID_ROLE_NAME:'Название роли должно содержать от 2 до 50 букв или цифр; роль «owner» зарезервирована.',REQUIRED_FIELDS_MISSING:'Сервер отклонил заполнение одного из полей. Проверьте ФИО и логин.',CANNOT_GRANT_PERMISSION:'Нельзя выдать сотруднику право, которого нет у вашей учётной записи.',ACCESS_BLOCKED:'У вашей учётной записи нет права выполнять это действие.',USER_NOT_FOUND:'Сотрудник больше не найден в этой компании.',CANNOT_CHANGE_SELF:'Нельзя изменять собственные права из этого окна.',OWNER_CANNOT_BE_CHANGED_HERE:'Права владельца нельзя изменить как права сотрудника.'};
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
  const canCreate=canCreateWarehouseFromNoAccessV783(),first=registry().serverAuthoritativeEmpty===true,createLabel=first?'Создать первый склад':'Создать новый склад';
  authFrame(`<div class="jf-no-access"><h2>${canCreate?(first?'Складов пока нет':'Нет активного склада'):'Склад не назначен'}</h2><p id="jfNoWarehouseMessage">${esc(canCreate?(first?'Сервер подтвердил пустой реестр компании. Создайте первый склад — локальный склад по умолчанию восстановлен не будет.':'Все склады сейчас находятся в архиве. Создайте новый склад или обратитесь к владельцу.'):message)}</p></div><div class="jf-auth-actions">${canCreate?`<button class="jf-auth-button" id="jfCreateFirstWarehouse">${createLabel}</button>`:''}<button class="jf-auth-button secondary" id="jfRetry">Повторить проверку</button><button class="jf-auth-button${canCreate?' secondary':''}" id="jfLogout">Выйти</button></div>`,'Доступ ограничен');
  if(canCreate)q('#jfCreateFirstWarehouse').onclick=()=>window.openWarehouseCreatorV600?.();q('#jfRetry').onclick=retryWorkspaceAccess;q('#jfLogout').onclick=logout
}
function renderWarehouseLoading(){authFrame('<div class="jf-no-access"><h2>Подготавливаем рабочее пространство</h2><p>Получаем разрешённые склады и выбираем активный склад. Заказы, Telegram и синхронизация ещё не запущены.</p></div>','Безопасный запуск')}
function workspaceReloadKey(){return`jf_workspace_reload_guard_v783:${String(desktopSession?.auth?.company?.id||'unknown')}`}
let pendingActiveWarehouseMetadataChangeV783=null;
function canonicalWarehouseMetadataV783(item){
  const lat=item?.lat==null?null:Number(item.lat),lon=item?.lon==null?null:Number(item.lon);
  return{id:String(item?.id||''),name:String(item?.name||'Склад'),code:String(item?.code||'СКЛ'),address:String(item?.address||''),lat:Number.isFinite(lat)?lat:null,lon:Number.isFinite(lon)?lon:null,timezone:String(item?.timezone||'Europe/Moscow'),status:item?.status==='archived'?'archived':'active',revision:Number(item?.revision)||0,digest:String(item?.digest||'')}
}
function canonicalWarehouseMetadataSignatureV783(item){return JSON.stringify(canonicalWarehouseMetadataV783(item))}
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
  const key=workspaceReloadKey(),now=Date.now();let previous={};try{previous=JSON.parse(sessionStorage.getItem(key)||'{}')}catch{}
  const same=String(previous.targetWarehouseId||'')===String(targetWarehouseId||'')&&String(previous.reason||'')===String(reason||'');
  if(same&&now-Number(previous.at||0)<60000){audit('workspace_reload_loop_blocked',{reason,targetWarehouseId,previousAt:previous.at});return false}
  try{sessionStorage.setItem(key,JSON.stringify({reason:String(reason||''),targetWarehouseId:String(targetWarehouseId||''),at:now}))}catch{}
  setSession(currentUser);setTimeout(()=>location.reload(),350);return true
}
function pendingWarehouseDeleteId(){return String(registry().pendingServerDeleteWarehouseId||'')}
function markPendingWarehouseDelete(warehouseId){const B=window.TeplitsaWarehouseBootstrap;if(!B)return;const next=B.getRegistry();next.pendingServerDeleteWarehouseId=String(warehouseId||'');B.saveRegistry(next)}
function freezeWorkspaceForWarehouseTransition(){clearTimeout(cloudSyncState?.uploadTimer);clearInterval(cloudSyncState?.pollTimer);if(cloudSyncState){cloudSyncState.uploadTimer=null;cloudSyncState.pollTimer=null;cloudSyncState.dirty=false}document.documentElement.classList.remove('jf-authenticated')}
function blockWorkspaceAfterWarehouseChange(message){freezeWorkspaceForWarehouseTransition();renderNoWarehouse(message)}
function applyWarehouseRegistryTransition(previousWarehouseId,reason){
  const current=activeWarehouseId(),allowed=allowedWarehouseIds(),pending=pendingWarehouseDeleteId();
  if(current===previousWarehouseId&&allowed.includes(previousWarehouseId)&&!pending&&pendingActiveWarehouseMetadataChangeV783?.warehouseId===current){applyCanonicalActiveWarehouseMetadataV783();return true}
  if(current===previousWarehouseId&&allowed.includes(previousWarehouseId)&&!pending)return false;
  if(current&&current!==previousWarehouseId&&allowed.includes(current)&&!pending){freezeWorkspaceForWarehouseTransition();renderWarehouseLoading();if(window.__JF_TEST_NO_RELOAD){window.__jfRemoteWarehouseReplacementV783=current;return true}if(guardedWorkspaceReload(reason,current))return true;blockWorkspaceAfterWarehouseChange('Список складов изменился, но безопасная автоматическая перезагрузка была остановлена. Нажмите «Повторить проверку».');return true}
  blockWorkspaceAfterWarehouseChange(pending?'Открытый склад удалён на другом компьютере. Локальный кэш заблокирован до подтверждения нового списка складов.':'Доступ к открытому складу отозван. Локальный кэш заблокирован и не будет отправлен на сервер.');return true
}
function clearWorkspaceReloadGuard(){try{sessionStorage.removeItem(workspaceReloadKey())}catch{}}
async function retryWorkspaceAccess(){
  const button=q('#jfRetry'),message=q('#jfNoWarehouseMessage');if(button)button.disabled=true;if(message)message.textContent='Проверяем назначения складов на сервере…';
  try{const before=activeWarehouseId();await synchronizeCompanyWarehouseRegistry();const allowed=allowedWarehouseIds();if(pendingWarehouseDeleteId()){if(message)message.textContent='Сервер ещё не подтвердил новый список после удаления склада.';return false}if(!allowed.length){if(message)message.textContent='Сервер подтвердил: вашей учётной записи пока не назначен склад.';return false}const target=allowed.includes(activeWarehouseId())?activeWarehouseId():allowed[0];if(target!==activeWarehouseId())window.TeplitsaWarehouseBootstrap.setActive(target);if(applyWarehouseRegistryTransition(before,'warehouse-assignment-retry'))return true;await confirmActiveWarehouseContext();mountWorkspace();return true}catch(error){if(message)message.textContent=`Проверка не выполнена: ${cloudResultError({error:error?.message||String(error)})}`;return false}finally{if(button)button.disabled=false}
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
  for(const[name,permission]of Object.entries(FUNCTION_PERMISSIONS))if(new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\s*\\(`).test(inline))return permission;
  return'';
}
function rejectPermission(permission,action){toast('Недостаточно прав для этого действия.','error');audit('forbidden_action',{action,permission,role:roleFor()})}
function applyActionPermissions(root=document){
  qa('button,input[type="submit"],input[type="button"]',root).forEach(control=>{
    const permission=permissionForControl(control),trainingAction=trainingAdminActionForControl(control);if(!permission&&!trainingAction)return;
    const denied=Boolean(trainingAction)||(permission&&!hasPermission(permission));
    control.classList.toggle('jf-role-hidden',!!denied);
    if(denied){control.setAttribute('aria-hidden','true');control.tabIndex=-1}else{control.removeAttribute('aria-hidden');if(control.tabIndex===-1)control.removeAttribute('tabindex')}
  })
}
function installPermissionEvents(){
  if(permissionEventsInstalled)return;permissionEventsInstalled=true;
  document.addEventListener('click',event=>{const control=event.target?.closest?.('button,input[type="submit"],input[type="button"]'),trainingAction=trainingAdminActionForControl(control),permission=permissionForControl(control);if(trainingAction){event.preventDefault();event.stopImmediatePropagation();rejectTrainingAdmin(trainingAction);return}if(permission&&!hasPermission(permission)){event.preventDefault();event.stopImmediatePropagation();rejectPermission(permission,control?.id||control?.textContent?.trim()||'button')}},true);
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
      const required=resolvedFunctionPermission(name,permission,arguments);
      if(!hasPermission(required)){rejectPermission(required,name);return}
      return base.apply(this,arguments)
    })
  }
}
async function logout(){audit('logout');stopTelegramPolling();clearSession();if(desktopSession?.edition==='demo'){await window.JustFunDesktop?.quit?.();return}await window.JustFunDesktop?.auth?.logout?.();currentUser=null;users=[];desktopSession.auth=null;await window.JustFunDesktop?.restart?.()}
function normalizedServerWarehouse(item){
  const id=String(item?.id||''),code=String(item?.code||'СКЛ').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)||'СКЛ';
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))return null;
  const lat=item?.lat==null?null:Number(item.lat),lon=item?.lon==null?null:Number(item.lon);
  return{id,name:String(item?.name||'Склад').slice(0,160),code,address:String(item?.address||'').slice(0,500),lat:Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,lon:Number.isFinite(lon)&&lon>=-180&&lon<=180?lon:null,timezone:String(item?.timezone||'Europe/Moscow').slice(0,80),status:item?.status==='archived'?'archived':'active',catalogMode:item?.catalog_mode==='empty'||item?.catalogMode==='empty'?'empty':'catalog',origin:'server',revision:Number(item?.entity_version??item?.revision)||0,digest:String(item?.digest_sha256||''),updatedAt:String(item?.updated_at||new Date().toISOString())};
}
const LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783=1;
function localToServerMigrationKeyV783(B){return String(B.registryKey||'').replace(/warehouses_registry_v600$/,'local_to_server_migration_v783')}
function readLocalToServerMigrationV783(B){try{const value=JSON.parse(B.raw.get(localToServerMigrationKeyV783(B))||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}}
function writeLocalToServerMigrationV783(B,value){B.raw.set(localToServerMigrationKeyV783(B),JSON.stringify(value));return value}
function localMigrationCommandIdV783(label,warehouseId,index=0){return`client:migrate-v783:${String(label)}:${String(warehouseId)}:${Number(index)}`.slice(0,180)}
function localMigrationSnapshotSignatureV783(snapshot){return entityFingerprint({warehouse:snapshot?.warehouse,data:snapshot?.data})}
function localMigrationOutboxV783(companyId,warehouseId){const scope=`${companyId}:live:${warehouseId}`,queue=window.JustFunLocalOutboxV783?.create?.(localStorage,scope);if(!queue||queue.isCorrupt())throw Object.assign(new Error(`Локальная очередь склада ${warehouseId} повреждена. Перенос на VPS остановлен.`),{code:'LOCAL_MIGRATION_OUTBOX_UNAVAILABLE'});return queue}
function generatedLocalWarehousePlaceholderV783(local){const counts=window.TeplitsaWarehouseV600?.counts?.()||{},businessCount=Number(counts.orders||0)+Number(counts.movements||0)+Number(counts.routes||0)+Number(counts.executions||0)+Number(counts.archives||0);return businessCount===0&&local.warehouses.length===1&&String(local.warehouses[0]?.origin||'')==='local-default'}
async function migrateLocalCompanyToEmptyServerV783(B,local,response,remote){
  const companyId=String(desktopSession?.auth?.company?.id||''),existing=readLocalToServerMigrationV783(B),canStart=response.registryInitialized===false&&!remote.length&&local.warehouses.length>0&&local.warehouses.some(item=>String(item.origin||'')!=='server'),canResume=existing?.schemaVersion===LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783&&existing?.workspaceId===companyId&&existing?.state!=='complete';
  if(existing?.state==='complete'&&canStart)throw Object.assign(new Error('VPS потерял ранее перенесённый реестр складов. Автоматическое повторное заполнение запрещено; требуется проверка backup и журнала сервера.'),{code:'LOCAL_MIGRATION_REMOTE_RESET'});
  if(!canStart&&!canResume)return false;
  if(!currentUser?.allWarehouses||!hasPermission('warehouses.manage'))throw Object.assign(new Error('Перенос локальной компании на VPS может выполнить только владелец с доступом ко всем складам.'),{code:'LOCAL_MIGRATION_PERMISSION_DENIED'});
  const sourceWarehouses=local.warehouses.map(item=>cloneValue(item)),sourceIds=new Set(sourceWarehouses.map(item=>String(item.id))),foreignRemote=remote.find(item=>!sourceIds.has(String(item.id)));if(foreignRemote)throw Object.assign(new Error('VPS уже содержит другой склад. Автоматическое объединение с локальной базой запрещено.'),{code:'LOCAL_MIGRATION_REMOTE_NOT_EMPTY'});
  const snapshots=new Map(),signatures={};for(const warehouse of sourceWarehouses){const snapshot=await window.TeplitsaWarehouseV600?.storedSnapshot?.(warehouse.id,'live');if(!snapshot)throw Object.assign(new Error(`Локальный снимок склада ${warehouse.code||warehouse.id} не подготовлен.`),{code:'LOCAL_MIGRATION_SNAPSHOT_UNAVAILABLE'});snapshots.set(String(warehouse.id),snapshot);signatures[warehouse.id]=localMigrationSnapshotSignatureV783(snapshot);localMigrationOutboxV783(companyId,warehouse.id)}
  let journal=existing;
  if(!journal){journal={schemaVersion:LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783,workspaceId:companyId,state:'prepared',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),originalActiveWarehouseId:String(local.activeWarehouseId||''),sourceSignatures:signatures,warehouses:sourceWarehouses.map(item=>({id:String(item.id),code:String(item.code||''),state:'prepared',createCommandId:localMigrationCommandIdV783('warehouse',item.id),chunkCommandIds:[]}))};writeLocalToServerMigrationV783(B,journal)}
  if(JSON.stringify(journal.sourceSignatures)!==JSON.stringify(signatures))throw Object.assign(new Error('Локальная база изменилась после начала переноса. Автоматическое продолжение остановлено без перезаписи данных.'),{code:'LOCAL_MIGRATION_SOURCE_CHANGED'});
  const bridge=window.JustFunDesktop;if(typeof bridge?.setActiveWarehouse!=='function'||typeof bridge?.regVps?.writeWarehouse!=='function'||typeof bridge?.regVps?.syncEntities!=='function')throw Object.assign(new Error('Защищённый модуль переноса на VPS недоступен.'),{code:'LOCAL_MIGRATION_BRIDGE_UNAVAILABLE'});
  journal={...journal,state:'in_progress',updatedAt:new Date().toISOString(),lastError:null};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_started',{warehouses:sourceWarehouses.length,workspaceId:companyId});
  try{
    for(const source of sourceWarehouses){const id=String(source.id),entry=journal.warehouses.find(item=>item.id===id),snapshot=snapshots.get(id),warehousePayload={...cloneValue(source),id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT};delete warehousePayload.revision;delete warehousePayload.digest;delete warehousePayload.updated_at;
      const created=await bridge.regVps.writeWarehouse({warehouseId:id,warehouseCode:String(source.code||''),environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:entry.createCommandId,changes:[{type:'warehouse',id,baseVersion:0,deleted:false,payload:warehousePayload}]});if(!created?.ok)throw Object.assign(new Error(created?.error||`VPS не создал склад ${source.code||id}.`),{code:created?.code||'LOCAL_MIGRATION_WAREHOUSE_FAILED'});
      B.setActive(id);const context=await bridge.setActiveWarehouse({warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});if(!context?.ok)throw Object.assign(new Error(context?.error||'Основное ядро не подтвердило склад для переноса.'),{code:context?.code||'LOCAL_MIGRATION_CONTEXT_REJECTED'});
      const changes=[...splitEntitySnapshot(snapshot).values()].filter(item=>item.type!=='warehouse').map(item=>({type:item.type,id:item.id,baseVersion:0,deleted:false,payload:item.payload})),chunks=[];for(let offset=0;offset<changes.length;offset+=1000)chunks.push(changes.slice(offset,offset+1000));
      if(!entry.chunkCommandIds.length){entry.chunkCommandIds=chunks.map((_,index)=>localMigrationCommandIdV783('entities',id,index));writeLocalToServerMigrationV783(B,{...journal,updatedAt:new Date().toISOString()})}if(entry.chunkCommandIds.length!==chunks.length)throw Object.assign(new Error('План пакетов переноса не совпадает с локальным снимком.'),{code:'LOCAL_MIGRATION_PLAN_CHANGED'});
      for(let index=0;index<chunks.length;index++){const result=await bridge.regVps.syncEntities({warehouseId:id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:entry.chunkCommandIds[index],changes:chunks[index]});if(!result?.ok)throw Object.assign(new Error(result?.error||`VPS не принял пакет ${index+1} склада ${source.code||id}.`),{code:result?.code||'LOCAL_MIGRATION_ENTITY_FAILED',details:result?.details||{}})}
      entry.state='uploaded';entry.updatedAt=new Date().toISOString();writeLocalToServerMigrationV783(B,{...journal,updatedAt:new Date().toISOString()})
    }
    for(const source of sourceWarehouses){const queue=localMigrationOutboxV783(companyId,source.id);for(const item of queue.list())if(item.state!=='confirmed')queue.markConfirmed(item.commandId,{migration:'local-to-server-v783',workspaceId:companyId,warehouseId:String(source.id)})}
    const original=sourceIds.has(String(journal.originalActiveWarehouseId))?String(journal.originalActiveWarehouseId):String(sourceWarehouses.find(item=>item.status!=='archived')?.id||'');if(original){B.setActive(original);const restored=await bridge.setActiveWarehouse({warehouseId:original,environment:WAREHOUSE_REGISTRY_ENVIRONMENT});if(!restored?.ok)throw Object.assign(new Error(restored?.error||'Не удалось восстановить исходный склад после переноса.'),{code:restored?.code||'LOCAL_MIGRATION_CONTEXT_RESTORE_FAILED'})}
    journal={...journal,state:'complete',completedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastError:null};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_completed',{warehouses:sourceWarehouses.length,workspaceId:companyId});return true
  }catch(error){const original=sourceIds.has(String(journal.originalActiveWarehouseId))?String(journal.originalActiveWarehouseId):'';if(original){try{B.setActive(original);await bridge.setActiveWarehouse({warehouseId:original,environment:WAREHOUSE_REGISTRY_ENVIRONMENT})}catch{}}journal={...journal,state:'failed',updatedAt:new Date().toISOString(),lastError:{code:String(error?.code||'LOCAL_MIGRATION_FAILED'),message:String(error?.message||error).slice(0,500)}};writeLocalToServerMigrationV783(B,journal);audit('local_to_server_migration_failed',{code:journal.lastError.code,workspaceId:companyId});throw error}
}
async function synchronizeCompanyWarehouseRegistry(){
  const B=window.TeplitsaWarehouseBootstrap;
  if(!B||isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return false;
  const response=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});
  if(!response?.ok||response.configured!==true){
    audit('company_warehouse_registry_unavailable',{code:response?.code||'',error:response?.error||'',configured:response?.configured===true});
    throw Object.assign(new Error(response?.error||'Серверный реестр складов недоступен.'),{code:response?.code||'WAREHOUSE_REGISTRY_UNAVAILABLE'})
  }
  let remote=(response.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean);
  const local=B.getRegistry(),companyId=String(desktopSession.auth.company.id||'');
  const pendingMigration=readLocalToServerMigrationV783(B),matchingMigration=pendingMigration?.schemaVersion===LOCAL_TO_SERVER_MIGRATION_SCHEMA_V783&&pendingMigration?.workspaceId===companyId;
  if(remote.length&&matchingMigration&&pendingMigration.state==='complete'){const remoteIds=new Set(remote.map(item=>String(item.id))),missing=(pendingMigration.warehouses||[]).find(item=>!remoteIds.has(String(item.id)));if(missing)throw Object.assign(new Error('VPS не содержит один из ранее перенесённых складов. Автоматическая замена локального реестра запрещена до проверки backup и журнала сервера.'),{code:'LOCAL_MIGRATION_REMOTE_RESET'})}
  if(remote.length&&local.warehouses.some(item=>String(item.origin||'')!=='server')&&!matchingMigration&&!generatedLocalWarehousePlaceholderV783(local))throw Object.assign(new Error('VPS уже содержит складские данные, а на компьютере найдены самостоятельные локальные склады. Автоматическое объединение запрещено: требуется контролируемый выбор источника.'),{code:'LOCAL_MIGRATION_REMOTE_NOT_EMPTY'});
  if(remote.length&&matchingMigration&&pendingMigration.state!=='complete'){
    currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];await migrateLocalCompanyToEmptyServerV783(B,local,response,remote);const refreshed=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});if(!refreshed?.ok||refreshed.configured!==true)throw Object.assign(new Error(refreshed?.error||'VPS не вернул список складов после продолжения переноса.'),{code:refreshed?.code||'LOCAL_MIGRATION_REGISTRY_REFRESH_FAILED'});remote=(refreshed.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean)
  }
  if(!remote.length){
    pendingActiveWarehouseMetadataChangeV783=null;
    currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];
    if(typeof response.registryInitialized!=='boolean'){
      audit('company_warehouse_registry_state_unknown',{workspaceId:companyId});
      throw Object.assign(new Error('Сервер не подтвердил состояние пустого реестра складов.'),{code:'WAREHOUSE_REGISTRY_CONTRACT_MISMATCH'})
    }
    if(await migrateLocalCompanyToEmptyServerV783(B,local,response,remote)){
      const refreshed=await window.JustFunDesktop?.regVps?.warehouses?.({environment:'live'});if(!refreshed?.ok||refreshed.configured!==true)throw Object.assign(new Error(refreshed?.error||'VPS не вернул список складов после переноса.'),{code:refreshed?.code||'LOCAL_MIGRATION_REGISTRY_REFRESH_FAILED'});remote=(refreshed.warehouses||[]).map(normalizedServerWarehouse).filter(Boolean);if(!remote.length)throw Object.assign(new Error('VPS не подтвердил ни одного склада после переноса.'),{code:'LOCAL_MIGRATION_REGISTRY_EMPTY'})
    }
    if(remote.length){const warehouses=remote;let active=String(B.getRegistry().activeWarehouseId||'');if(!warehouses.some(item=>String(item.id)===active&&item.status!=='archived'))active=warehouses.find(item=>item.status!=='archived')?.id||'';B.saveRegistry({...B.getRegistry(),warehouses,activeWarehouseId:active,pendingServerDeleteWarehouseId:'',serverAuthoritativeEmpty:false,serverRegistryInitialized:true,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId});return true}
    const freshGenerated=generatedLocalWarehousePlaceholderV783(local);
    const mayBootstrapFirstWarehouse=response.registryInitialized===false&&freshGenerated&&currentUser?.allWarehouses===true&&hasPermission('warehouses.manage');
    if(mayBootstrapFirstWarehouse){
      const changed=String(local.serverWorkspaceId||'')!==companyId||local.serverRegistryInitialized!==false;
      if(changed)B.saveRegistry({...local,serverWorkspaceId:companyId,serverRegistryInitialized:false,serverHydratedAt:new Date().toISOString()});
      return false
    }
    const changed=local.warehouses.length>0||local.activeWarehouseId!==''||local.serverAuthoritativeEmpty!==true||String(local.serverWorkspaceId||'')!==companyId||local.serverRegistryInitialized!==response.registryInitialized;
    if(changed)B.saveRegistry({...local,warehouses:[],activeWarehouseId:'',pendingServerDeleteWarehouseId:'',serverAuthoritativeEmpty:true,serverRegistryInitialized:response.registryInitialized,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId});
    return changed
  }
  const warehouses=remote,remoteIds=new Set(remote.map(item=>String(item.id)));
  let active=String(local.activeWarehouseId||'');
  if(!warehouses.some(item=>String(item.id)===active&&item.status!=='archived'))active=remote.find(item=>item.status!=='archived')?.id||'';
  const pending=String(local.pendingServerDeleteWarehouseId||''),next={...local,warehouses,activeWarehouseId:active,pendingServerDeleteWarehouseId:pending&&warehouses.some(item=>String(item.id)===pending)?pending:'',serverAuthoritativeEmpty:false,serverRegistryInitialized:true,serverHydratedAt:new Date().toISOString(),serverWorkspaceId:companyId};
  const signature=value=>JSON.stringify({activeWarehouseId:value.activeWarehouseId,warehouses:value.warehouses.map(item=>({id:item.id,code:item.code,name:item.name,address:item.address,lat:item.lat,lon:item.lon,timezone:item.timezone,status:item.status,origin:item.origin,revision:item.revision,digest:item.digest}))});
  const changed=signature(local)!==signature(next);
  if(changed)B.saveRegistry(next);
  currentUser=cloudUserToLocal(desktopSession.auth.user,desktopSession.auth.company,desktopSession.auth);users=[currentUser];
  const previousActive=local.warehouses.find(item=>String(item.id)===String(local.activeWarehouseId)),nextActive=warehouses.find(item=>String(item.id)===String(active)),activeSelectionChanged=changed&&String(local.activeWarehouseId)!==String(active),activeMetadataChanged=!activeSelectionChanged&&String(active)===String(local.activeWarehouseId)&&remoteIds.has(String(active))&&(canonicalWarehouseMetadataSignatureV783(previousActive)!==canonicalWarehouseMetadataSignatureV783(nextActive)||!activeWarehouseSettingsMatchV783(nextActive));
  if(activeSelectionChanged)pendingActiveWarehouseMetadataChangeV783=null;else if(activeMetadataChanged)stageActiveWarehouseMetadataChangeV783(previousActive,nextActive);
  return activeSelectionChanged||pendingActiveWarehouseMetadataChangeV783?.warehouseId===String(active);
}
window.JustFunWarehouseRegistryV783=Object.freeze({refresh:synchronizeCompanyWarehouseRegistry,showNoWarehouse:renderNoWarehouse});
function requiresAuthoritativeWarehouseRegistry(){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return false;
  const companyId=String(desktopSession?.auth?.company?.id||''),pending=pendingWarehouseDeleteId();return !companyId||String(registry().serverWorkspaceId||'')!==companyId||Boolean(pending&&registry().warehouses.some(item=>String(item.id)===pending))
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
  clearWorkspaceReloadGuard();
  document.documentElement.classList.add('jf-authenticated');addDesktopStrip();applyPermissions();installGuards();installEntityCommandGuards();applyBrand();installUserManagement();installIntegrationPanel();installLogDiagnostics();installHelp();if(!isTrainingEnvironment()){installTelegramDriverActions();installTelegramRouteActions()}if(desktopSession?.edition==='demo')enableLicensedDemo();setTimeout(()=>{try{window.renderAll?.();if(!isTrainingEnvironment()){refreshTelegramBindings().then(promptRequiredWarehouseTelegram).catch(()=>promptRequiredWarehouseTelegram());startTelegramPolling()}}catch{}},0)
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
async function enterWorkspace(){
  const allowed=allowedWarehouseIds(),current=activeWarehouseId();
  if(pendingWarehouseDeleteId()){renderNoWarehouse('Сервер сообщил об удалении открытого склада. Подключитесь к сети и нажмите «Повторить проверку», чтобы получить новый список складов.');return false}
  if(requiresAuthoritativeWarehouseRegistry()){renderWarehouseLoading();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return false}
  if(!allowed.length){renderNoWarehouse();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return false}
  if(!allowed.includes(current)){window.TeplitsaWarehouseBootstrap.setActive(allowed[0]);if(!guardedWorkspaceReload('warehouse-selection',allowed[0]))renderNoWarehouse('Назначение склада получено, но повторная перезагрузка остановлена. Нажмите «Повторить проверку».');return false}
  try{await confirmActiveWarehouseContext()}catch(error){audit('warehouse_context_rejected',{warehouseId:current,code:error?.code||'',error:String(error?.message||error)});renderNoWarehouse('Не удалось безопасно подтвердить активный склад. Повторите проверку.');return false}
  mountWorkspace();setTimeout(()=>synchronizeWorkspaceInBackground(),0);return true
}
async function installLogDiagnostics(){const button=q('#jfOpenLogs'),label=q('#jfLogPath');if(!button||button.dataset.bound)return;button.dataset.bound='1';try{const info=await window.JustFunDesktop?.getAppInfo?.();if(info?.logDir)label.textContent=info.logDir}catch{}button.onclick=async()=>{const result=await window.JustFunDesktop?.openLogFolder?.();if(!result?.ok)toast(result?.error||'Не удалось открыть папку журналов.','error')}}
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
function installUserManagement(){if(!hasPermission('users.read'))return;const grid=q('#programSettingsView .settings-grid');if(!grid||q('#jfUsersBox'))return;const box=document.createElement('div');box.id='jfUsersBox';box.className='settings-box span-2 jf-users-panel';grid.prepend(box);renderUsersPanel()}
async function renderUsersPanel(){
  const box=q('#jfUsersBox');if(!box)return;
  if(isTrainingEnvironment()){box.innerHTML='<h3>Пользователи и права доступа</h3><p>Учебный режим не читает и не изменяет реальных сотрудников. Переключитесь в рабочий режим для управления доступом.</p>';return}
  box.innerHTML='<h3>Пользователи и права доступа</h3><p>Загрузка списка с Cloudflare…</p>';
  const [ur,dr]=await Promise.all([window.JustFunDesktop.auth.users(),window.JustFunDesktop.auth.devices()]);
  if(!ur?.ok){box.innerHTML=`<h3>Пользователи и права доступа</h3><div class="notice notice-warn">${esc(cloudResultError(ur))}</div>`;return}
  users=(ur.users||[]).map(u=>cloudUserToLocal(u,desktopSession.auth?.company||{},desktopSession.auth||{}));cloudDevices=dr?.ok?(dr.devices||[]):[];
  const warehouses=registry().warehouses;
  box.innerHTML=`<div class="jf-users-head"><div><h3>Пользователи и права доступа</h3><p>Владелец создаёт одноразовое приглашение. Сотрудник сам задаёт пароль на своём компьютере.</p></div><button class="btn-primary" id="jfAddUser">+ Создать приглашение</button></div><div class="jf-user-list">${users.map(u=>{const access=u.allWarehouses?'Все склады по одному':(u.warehouseIds||[]).map(id=>warehouses.find(w=>String(w.id)===String(id))?.code).filter(Boolean).join(', ')||'По роли';const locked=u.id===currentUser.id||u.role==='owner';return`<div class="jf-user-row ${u.status==='blocked'?'blocked':''}"><div><b>${esc(u.fullName)}</b><small>${esc(u.login)} · ${u.status==='blocked'?'заблокирован':'активен'}</small></div><div>${esc(ROLE_LABELS[u.role]||u.role)}</div><div>${esc(access)}</div><div class="jf-user-actions"><button class="btn-soft" data-user-edit="${esc(u.id)}" ${locked?'disabled':''}>Изменить доступ</button><button class="btn-gray" data-user-toggle="${esc(u.id)}" ${locked?'disabled':''}>${u.status==='blocked'?'Разблокировать':'Блокировать'}</button></div></div>`}).join('')}</div><div class="jf-users-head" style="margin-top:22px"><div><h3>Подключённые компьютеры</h3><p>Заблокированный компьютер больше не сможет войти.</p></div></div><div class="jf-user-list">${cloudDevices.map(d=>`<div class="jf-user-row ${d.status==='blocked'?'blocked':''}"><div><b>${esc(d.device_name)}</b><small>${esc(d.full_name)} · ${esc(d.login)}</small></div><div>${esc(ROLE_LABELS[SERVER_ROLE_TO_APP[d.role]||d.role]||d.role)}</div><div>${new Date(d.last_seen_at).toLocaleString('ru-RU')}</div><div class="jf-user-actions"><button class="btn-gray" data-device-toggle="${esc(d.id)}" ${String(d.id)===String(currentUser.deviceId)?'disabled':''}>${d.status==='blocked'?'Разблокировать':'Блокировать'}</button></div></div>`).join('')||'<div class="muted">Компьютеры ещё не зарегистрированы.</div>'}</div>`;
  const canCreate=hasPermission('users.create'),canUpdate=hasPermission('users.update'),canManageDevices=hasPermission('devices.manage'),addUser=q('#jfAddUser');
  addUser.disabled=!canCreate;addUser.title=canCreate?'Создать приглашение':'Нет права создавать сотрудников';if(canCreate)addUser.onclick=openUserCreator;
  qa('[data-user-edit]',box).forEach(b=>{b.disabled=b.disabled||!canUpdate;b.title=canUpdate?'Изменить роль и разрешения':'Нет права изменять доступ';if(canUpdate)b.onclick=()=>{const u=users.find(x=>x.id===b.dataset.userEdit);if(u)openUserAccessEditor(u)}});
  qa('[data-user-toggle]',box).forEach(b=>{b.disabled=b.disabled||!canUpdate;b.title=canUpdate?'Изменить состояние сотрудника':'Нет права блокировать сотрудников';if(canUpdate)b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.userToggle);if(!u)return;const target=u.status==='blocked'?'active':'blocked';b.disabled=true;const r=await window.JustFunDesktop.auth.setUserStatus({userId:u.id,status:target});if(!r?.ok)toast(cloudResultError(r),'error');await renderUsersPanel()}});
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
  if(manual){setIntegrationBusy(button,true);integrationBadge('jfRegBadge','Проверяем…');integrationStatus('jfRegStatus','Проверяем HTTPS, закреплённый TLS-сертификат, сервер 7.8.3 и PostgreSQL…')}
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
  try{const result=await window.JustFunDesktop?.regVps?.configure?.({address,sshUser,sshPort});if(!result?.ok)throw new Error(result?.error||'Мастер VPS не завершён');if(result.canceled){integrationStatus('jfRegStatus','Настройка VPS отменена. Сохранённые параметры не изменены.');return}integrationStatus('jfRegStatus','VPS установлен и проверен. SSH-ключ закреплён, PostgreSQL не открыт наружу.','ok');await refreshRegVpsStatus()}
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
const cloudSyncState={installed:false,bootstrapped:false,bootstrapPromise:null,dirty:false,serial:0,suspended:0,uploadTimer:null,pollTimer:null,retryTimer:null,inFlight:false,pollFailures:0,nextPollAt:0,scope:'',cursor:0,known:new Map(),conflicts:new Map(),readableTypes:new Set(),outbox:null,outboxError:null};
function stableEntityValue(value){if(Array.isArray(value))return value.map(stableEntityValue);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stableEntityValue(value[key]);return out}return value}
function entityFingerprint(value){const stable=JSON.stringify(stableEntityValue(value)),reverse=stable.split('').reverse().join('');return`${hashString(stable)}:${hashString(reverse)}:${stable.length}`}
function entityKey(type,id){return`${String(type)}:${String(id)}`}
function entityScope(){return`${String(desktopSession?.auth?.company?.id||'unknown')}:${activeEnvironment()}:${activeWarehouseId()}`}
function entityStateStorageKey(){return`jf.reg-entity-state.v2.${entityScope().replace(/[^A-Za-z0-9_.:-]/g,'_')}`}
function outboxError(code,message,details={}){return Object.assign(new Error(message),{code,details})}
function localOutboxDeviceId(){
  const authenticated=String(currentUser?.deviceId||desktopSession?.auth?.device_id||desktopSession?.auth?.deviceId||'').trim();if(authenticated)return authenticated;
  const key='jf.local-device-id.v1';try{const saved=String(localStorage.getItem(key)||'').trim();if(saved)return saved;const created=`desktop:${newEntityCommandId().split(':').slice(2).join(':')}`;localStorage.setItem(key,created);return created}catch{return'desktop:unavailable'}
}
function onlineEntitySyncAvailable(){return!desktopSession?.auth?.offline&&Boolean(desktopSession?.auth?.company?.data_service)&&typeof window.JustFunDesktop?.regVps?.syncEntities==='function'}
function renderLocalOutboxStatus(){
  const badge=q('#jfOutboxState');if(!badge||isTrainingEnvironment())return;
  if(cloudSyncState.outboxError||cloudSyncState.outbox?.isCorrupt?.()){badge.className='jf-outbox-state error';badge.textContent='Ошибка локальной очереди';badge.title=String(cloudSyncState.outboxError?.message||cloudSyncState.outbox?.corruption?.()?.message||'Outbox недоступен');return}
  const state=cloudSyncState.outbox?.status?.();if(!state){badge.className='jf-outbox-state pending';badge.textContent='Локальная очередь запускается';return}
  if(state.conflict||state.rejectedActive){badge.className='jf-outbox-state error';badge.textContent=`Требуют решения: ${state.conflict+state.rejectedActive}`;badge.title='Локальные данные сохранены, но сервер не принял часть изменений.';return}
  if(state.pending||state.sending){badge.className='jf-outbox-state pending';badge.textContent=`Ожидают синхронизации: ${state.pending+state.sending}`;badge.title='Изменения надёжно сохранены на этом компьютере и будут отправлены с теми же command_id.';return}
  badge.className='jf-outbox-state ready';badge.textContent='Локальные данные сохранены';badge.title='Несинхронизированных изменений нет.'
}
function requireLocalOutbox(){resetEntityScope();if(cloudSyncState.outboxError)throw cloudSyncState.outboxError;if(!cloudSyncState.outbox)throw outboxError('OUTBOX_UNAVAILABLE','Модуль локальной очереди не загружен. Изменение безопасно остановлено.');return cloudSyncState.outbox}
function resetEntityScope(){
  const scope=entityScope();if(cloudSyncState.scope===scope)return;
  clearTimeout(cloudSyncState.retryTimer);cloudSyncState.retryTimer=null;cloudSyncState.scope=scope;cloudSyncState.bootstrapped=false;cloudSyncState.cursor=0;cloudSyncState.known=new Map();cloudSyncState.conflicts=new Map();cloudSyncState.readableTypes=new Set();cloudSyncState.outbox=null;cloudSyncState.outboxError=null;
  try{const saved=JSON.parse(localStorage.getItem(entityStateStorageKey())||'{}');cloudSyncState.cursor=Number.isSafeInteger(Number(saved.cursor))?Number(saved.cursor):0;cloudSyncState.known=new Map(Object.entries(saved.entities||{}));cloudSyncState.conflicts=new Map(Object.entries(saved.conflicts||{}));cloudSyncState.readableTypes=new Set(asArray(saved.readableTypes).map(String))}catch{}
  try{if(!window.JustFunLocalOutboxV783?.create)throw outboxError('OUTBOX_MODULE_MISSING','Модуль локальной очереди не загружен.');cloudSyncState.outbox=window.JustFunLocalOutboxV783.create(localStorage,scope);if(cloudSyncState.outbox.isCorrupt())throw cloudSyncState.outbox.corruption()}catch(error){cloudSyncState.outboxError=error instanceof Error?error:outboxError('OUTBOX_INIT_FAILED',String(error))}
  cloudSyncState.dirty=Boolean(cloudSyncState.outbox&&!cloudSyncState.outboxError&&cloudSyncState.outbox.status().active);renderLocalOutboxStatus();
}
function saveEntitySyncState(){
  resetEntityScope();
  try{localStorage.setItem(entityStateStorageKey(),JSON.stringify({cursor:cloudSyncState.cursor,entities:Object.fromEntries(cloudSyncState.known),conflicts:Object.fromEntries(cloudSyncState.conflicts),readableTypes:[...cloudSyncState.readableTypes],savedAt:new Date().toISOString()}))}catch(error){console.error('VPS entity state',error)}
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
function splitEntitySnapshot(snapshot){
  const map=new Map(),data=asObject(snapshot?.data),warehouse=asObject(snapshot?.warehouse),warehouseId=activeWarehouseId();
  // Unassigned automatic routes are render-time previews, not server entities.
  const referencedRouteIds=new Set([...Object.values(asObject(data.routeAssignments)),...Object.values(asObject(data.routeLocks)),...Object.keys(asObject(data.routePlans)),...Object.keys(asObject(data.routeDriverAssignments)),...Object.keys(asObject(data.routeOverrides)),...Object.keys(asObject(data.routeExecutions))].map(String).filter(id=>id&&id!=='__unassigned__'));
  const add=(type,id,payload)=>{id=String(id||'');if(!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw new Error(`Раздел ${type} содержит запись без безопасного идентификатора.`);map.set(entityKey(type,id),{type,id,payload:wrappedEntityPayload(payload),fingerprint:entityFingerprint(wrappedEntityPayload(payload))})};
  if(activeEnvironment()===WAREHOUSE_REGISTRY_ENVIRONMENT)add('warehouse',warehouseId,warehouse);
  for(const type of ENTITY_SINGLETON_SECTIONS){const value=data[type];if(value&&typeof value==='object'&&!Array.isArray(value))add(type,type,type==='settings'?serverSettingsPayload(value):value)}
  for(const type of ENTITY_ARRAY_SECTIONS){for(const value of asArray(data[type])){const fallback=type==='routeArchives'?(value?.routeId||value?.executionId):'';add(type,value?.id||fallback,value)}}
  for(const type of ENTITY_MAP_SECTIONS){for(const[id,value]of Object.entries(asObject(data[type]))){if(type==='routeCatalog'&&value?.custom!==true&&!referencedRouteIds.has(String(id)))continue;add(type,id,value)}}
  return map;
}
function canWriteEntity(type){
  const required=asArray(ENTITY_UPDATE_PERMISSION[type]);
  if(roleFor()==='owner'||hasPermission('*'))return true;
  return required.some(permission=>hasPermission(permission));
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
async function writeAuthoritativeWarehouse(record,{deleted=false,baseVersion,initialSettings=null,initialCompany=null}={}){
  if(isTrainingEnvironment())return{ok:true,skipped:true,version:Number(baseVersion)||0};
  if(!desktopSession?.auth?.company?.data_service){if(deleted)throw new Error('Безвозвратное удаление склада требует рабочего VPS и серверной резервной копии. Можно использовать архив.');return{ok:true,skipped:true,storageMode:'local',version:Number(baseVersion)||0}}
  if(desktopSession?.auth?.offline||!window.JustFunDesktop?.regVps?.writeWarehouse)throw new Error('Серверный режим компании временно недоступен. Изменение склада не выполнено.');
  const id=String(record?.id||'');if(!id)throw new Error('Идентификатор склада не определён.');
  const version=baseVersion==null?knownWarehouseVersion(record):Number(baseVersion),payload=deleted?null:{...cloneValue(record),id,environment:WAREHOUSE_REGISTRY_ENVIRONMENT};
  if(payload){delete payload.revision;delete payload.digest;delete payload.updated_at}
  const changes=[{type:'warehouse',id,baseVersion:version,deleted,payload}];
  if(!deleted&&version===0&&initialSettings&&typeof initialSettings==='object'&&!Array.isArray(initialSettings)){
    const settingsPayload=serverSettingsPayload(initialSettings,{initial:true});if(Object.keys(settingsPayload).length)changes.push({type:'settings',id:'settings',baseVersion:0,deleted:false,payload:settingsPayload});
    if(hasPermission('company.update')&&initialCompany&&typeof initialCompany==='object'&&!Array.isArray(initialCompany)&&Object.keys(initialCompany).length)changes.push({type:'company',id:'company',baseVersion:0,deleted:false,payload:cloneValue(initialCompany)})
  }
  const result=await window.JustFunDesktop.regVps.writeWarehouse({warehouseId:id,warehouseCode:String(record?.code||''),environment:WAREHOUSE_REGISTRY_ENVIRONMENT,commandId:newEntityCommandId(),changes});
  if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS не подтвердил изменение склада.'),{code:result?.code||'WAREHOUSE_WRITE_FAILED',details:result?.details||{}});
  const confirmed=result.entities?.find(item=>item.type==='warehouse'&&item.id===id),confirmedVersion=Number(confirmed?.version)||version;
  if(activeEnvironment()===WAREHOUSE_REGISTRY_ENVIRONMENT&&id===activeWarehouseId()&&cloudSyncState.scope===entityScope()){if(deleted)cloudSyncState.known.set(entityKey('warehouse',id),{version:confirmedVersion,digest:String(confirmed?.digest||''),fingerprint:'',deleted:true,eventId:Number(confirmed?.eventId)||0});else cloudSyncState.known.set(entityKey('warehouse',id),{version:confirmedVersion,digest:String(confirmed?.digest||''),fingerprint:entityFingerprint(payload),deleted:false,eventId:Number(confirmed?.eventId)||0});saveEntitySyncState()}
  return{...result,version:confirmedVersion}
}
window.JustFunServerStorageV3=Object.freeze({writeWarehouse:writeAuthoritativeWarehouse,deleteWarehouse:(record,options={})=>writeAuthoritativeWarehouse(record,{...options,deleted:true})});
function initialServerSeedChanges(localSnapshot){
  const records=splitEntitySnapshot(localSnapshot),changes=[];
  for(const entity of records.values()){
    const initialWarehouse=entity.type==='warehouse';
    const packagedCatalog=entity.type==='products'&&localSnapshot?.warehouse?.catalogMode==='catalog'&&entity.payload?.catalogManaged===true;
    if(initialWarehouse||packagedCatalog)changes.push({type:entity.type,id:entity.id,baseVersion:0,deleted:false,payload:entity.payload})
  }
  return changes
}
function overlayLocalOutbox(snapshot){
  const queue=requireLocalOutbox();let applied=0;
  for(const entry of queue.overlayEntries())for(const change of entry.changes){applyEntityToSnapshot(snapshot,change,change.deleted===true);applied++;if(entry.state==='conflict'||entry.state==='rejected')cloudSyncState.conflicts.set(entityKey(change.type,change.id),{type:change.type,id:change.id,commandId:entry.commandId,state:entry.state,...asObject(entry.lastError),detectedAt:entry.updatedAt})}
  return applied
}
async function bootstrapEntitySync(force=false){
  if(isTrainingEnvironment()||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service||!window.JustFunDesktop?.regVps?.bootstrapEntities)return false;
  resetEntityScope();if(cloudSyncState.bootstrapped&&!force)return true;if(cloudSyncState.bootstrapPromise)return cloudSyncState.bootstrapPromise;
  cloudSyncState.bootstrapPromise=(async()=>{
    const warehouseId=activeWarehouseId(),environment=activeEnvironment(),localSnapshot=buildBackupPayload(),bootstrapSerial=cloudSyncState.serial;let result=await window.JustFunDesktop.regVps.bootstrapEntities({warehouseId,environment});
    if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS не вернул сущности склада.'),{code:result?.code||'ENTITY_BOOTSTRAP_FAILED'});
    let entities=asArray(result.entities).map(canonicalServerEntity);
    if(environment===WAREHOUSE_REGISTRY_ENVIRONMENT&&!entities.some(entity=>entity.type==='warehouse'&&entity.id===warehouseId)){
      if(!canWriteEntity('warehouse'))throw Object.assign(new Error('Склад ещё не зарегистрирован на VPS и у пользователя нет права его создать.'),{code:'WAREHOUSE_NOT_REGISTERED'});
      const seed=initialServerSeedChanges(localSnapshot),created=await window.JustFunDesktop.regVps.syncEntities({warehouseId,environment,commandId:newEntityCommandId(),changes:seed});
      if(!created?.ok)throw Object.assign(new Error(created?.error||'VPS не зарегистрировал склад.'),{code:created?.code||'WAREHOUSE_CREATE_FAILED',details:created?.details||{}});
      result=await window.JustFunDesktop.regVps.bootstrapEntities({warehouseId,environment});
      if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS не вернул созданный склад.'),{code:result?.code||'ENTITY_BOOTSTRAP_FAILED'});
      entities=asArray(result.entities).map(canonicalServerEntity)
    }
    const readableTypes=asArray(result.readableTypes).map(String),serverSnapshot=snapshotFromServerEntities(localSnapshot,entities,readableTypes);cloudSyncState.known=new Map();cloudSyncState.conflicts=new Map();cloudSyncState.cursor=Number(result.cursor)||0;cloudSyncState.readableTypes=new Set(readableTypes);
    for(const entity of entities)cloudSyncState.known.set(entityKey(entity.type,entity.id),{version:Number(entity.version)||0,digest:String(entity.digest_sha256||''),fingerprint:entityFingerprint(entity.payload),deleted:false,eventId:Number(entity.event_id)||0});
    const overlaid=overlayLocalOutbox(serverSnapshot);
    if(typeof buildBackupPayload==='function'&&typeof window.TeplitsaWarehouseV600?.importServerSnapshot==='function'){
      cloudSyncState.suspended++;try{await window.TeplitsaWarehouseV600.importServerSnapshot(serverSnapshot)}finally{cloudSyncState.suspended--}
    }
    cloudSyncState.bootstrapped=true;cloudSyncState.pollFailures=0;cloudSyncState.nextPollAt=0;cloudSyncState.dirty=requireLocalOutbox().status().active>0||cloudSyncState.serial!==bootstrapSerial;saveEntitySyncState();renderLocalOutboxStatus();
    integrationBadge('jfRegBadge',overlaid?'Сервер + локальная очередь':'Серверные данные готовы','ready');if(cloudSyncState.dirty)scheduleOutboxDrain(0);return true;
  })().finally(()=>{cloudSyncState.bootstrapPromise=null});
  return cloudSyncState.bootstrapPromise;
}
function scheduleCloudUpload(){
  if(cloudSyncState.suspended||isTrainingEnvironment())return;
  resetEntityScope();cloudSyncState.dirty=true;cloudSyncState.serial++;clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);
}
function installAutomaticCloudSync(){
  if(cloudSyncState.installed)return;cloudSyncState.installed=true;
  if(!isTrainingEnvironment()){resetEntityScope();renderLocalOutboxStatus()}
  const names=['persistOrders','persistProducts','persistInventoryMovements','persistDrivers','persistSettings','persistRoutes','persistRouteAssignments','persistRouteDrivers','persistRouteLocks','persistRouteOverrides','persistRouteExecutions','persistRouteArchives','persistWarehouseReservations','persistReporting'];
  for(const name of names){const base=window[name];if(typeof base!=='function')continue;window[name]=function(){const result=base.apply(this,arguments);scheduleCloudUpload();return result}}
  setTimeout(()=>{if(onlineEntitySyncAvailable())bootstrapEntitySync().catch(reportCloudSyncFailure);else if(cloudSyncState.dirty)scheduleOutboxDrain(1000)},250);
  cloudSyncState.pollTimer=setInterval(()=>pollCloudRevision().catch(error=>console.error('Background entity check failed',error)),5000);
}
function buildPendingEntityChanges(){
  const current=splitEntitySnapshot(buildBackupPayload()),changes=[];
  for(const[key,entity]of current){if(cloudSyncState.conflicts.has(key)||!canWriteEntity(entity.type))continue;const known=cloudSyncState.known.get(key);if(!known||known.deleted||known.fingerprint!==entity.fingerprint)changes.push({type:entity.type,id:entity.id,baseVersion:Number(known?.version)||0,payload:entity.payload,deleted:false,_fingerprint:entity.fingerprint})}
  for(const[key,known]of cloudSyncState.known){if(cloudSyncState.conflicts.has(key)||known.deleted||current.has(key))continue;const split=key.indexOf(':'),type=key.slice(0,split),id=key.slice(split+1);if(canWriteEntity(type))changes.push({type,id,baseVersion:Number(known.version)||0,deleted:true,payload:null,_fingerprint:''})}
  return changes;
}
function acceptEntityBatchResult(result,changes){
  const byKey=new Map(changes.map(item=>[entityKey(item.type,item.id),item]));
  for(const item of asArray(result.entities)){
    const pending=byKey.get(entityKey(item.type,item.id));
    cloudSyncState.known.set(entityKey(item.type,item.id),{version:Number(item.version)||0,digest:String(item.digest||''),fingerprint:item.deleted?'':String(pending?._fingerprint||''),deleted:item.deleted===true,eventId:Number(item.eventId)||0})
  }
  cloudSyncState.cursor=Math.max(cloudSyncState.cursor,Number(result.cursor)||0);saveEntitySyncState()
}
function nextLocalBaseVersion(type,id,knownVersion){
  try{return Number(knownVersion||0)+requireLocalOutbox().pendingOffset(type,id)}catch{return Number(knownVersion)||0}
}
function entityChangesBetween(beforeSnapshot,afterSnapshot,{includeOutbox=true}={}){
  const before=splitEntitySnapshot(beforeSnapshot),after=splitEntitySnapshot(afterSnapshot),keys=new Set([...before.keys(),...after.keys()]),changes=[];
  for(const key of keys){const previous=before.get(key),next=after.get(key);if(previous?.fingerprint===next?.fingerprint)continue;const split=key.indexOf(':'),type=key.slice(0,split),id=key.slice(split+1),known=cloudSyncState.known.get(key),baseVersion=includeOutbox?nextLocalBaseVersion(type,id,known?.version):Number(known?.version)||0;changes.push({type,id,baseVersion,deleted:!next,payload:next?.payload||null,_fingerprint:next?.fingerprint||''})}
  return changes
}
async function waitForEntitySyncIdle(){
  for(let attempt=0;cloudSyncState.inFlight&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
  if(cloudSyncState.inFlight)throw new Error('Синхронизация занята другой операцией. Повторите действие.')
}
function localOutboxEntry(intent,changes){
  return{commandId:newEntityCommandId(),companyId:String(desktopSession?.auth?.company?.id||''),warehouseId:activeWarehouseId(),environment:activeEnvironment(),authorUserId:String(currentUser?.id||desktopSession?.auth?.user?.id||'local-user'),deviceId:localOutboxDeviceId(),intent:{kind:String(intent?.kind||'local_change'),targetId:String(intent?.targetId||'')},changes}
}
function retryableEntityFailure(value){
  const code=String(value?.code||value?.errorCode||'').toUpperCase(),message=String(value?.message||value?.error||'').toUpperCase();
  return/(TIMEOUT|NETWORK|UNAVAILABLE|CONNECTION|ECONN|ABORT|TEMPORARY|BUSY|RATE_LIMIT|HTTP_5)/.test(`${code} ${message}`)
}
function outboxRetryDelay(attempts){return Math.min(300000,1000*(2**Math.min(8,Math.max(0,Number(attempts)||0))))}
function scheduleOutboxDrain(delay=0){
  if(isTrainingEnvironment()||!onlineEntitySyncAvailable())return;clearTimeout(cloudSyncState.retryTimer);cloudSyncState.retryTimer=setTimeout(()=>{cloudSyncState.retryTimer=null;drainLocalOutbox().catch(reportCloudSyncFailure)},Math.max(0,Number(delay)||0))
}
function blockingOutboxEntries(queue=requireLocalOutbox()){return queue.overlayEntries().filter(entry=>entry.state==='conflict'||entry.state==='rejected')}
function markOutboxEntityConflict(key,details){
  const queue=requireLocalOutbox();for(const entry of queue.list(['pending','sending']))if(entry.changes.some(change=>entityKey(change.type,change.id)===key))queue.markConflict(entry.commandId,details);cloudSyncState.dirty=queue.status().active>0;renderLocalOutboxStatus()
}
async function rollbackLocalSnapshot(snapshot){
  if(!snapshot||typeof window.TeplitsaWarehouseV600?.importServerSnapshot!=='function')return false;cloudSyncState.suspended++;try{await window.TeplitsaWarehouseV600.importServerSnapshot(snapshot);window.renderAll?.();return true}finally{cloudSyncState.suspended--}
}
let outboxDrainChain=Promise.resolve();
function drainLocalOutbox(options={}){const run=()=>drainLocalOutboxNow(options);outboxDrainChain=outboxDrainChain.then(run,run);return outboxDrainChain}
async function drainLocalOutboxNow({targetCommandId='',force=false}={}){
  if(isTrainingEnvironment()||!onlineEntitySyncAvailable())return{state:'offline'};
  resetEntityScope();const queue=requireLocalOutbox(),drainSerial=cloudSyncState.serial;if(!cloudSyncState.bootstrapped)await bootstrapEntitySync();await waitForEntitySyncIdle();
  const blocked=blockingOutboxEntries(queue);if(blocked.length){cloudSyncState.dirty=true;renderLocalOutboxStatus();return{state:'blocked',entry:blocked[0]}}
  cloudSyncState.inFlight=true;let targetState='pending',targetEntry=targetCommandId?queue.get(targetCommandId):null;
  try{
    const ready=()=>queue.ready(force?Number.MAX_SAFE_INTEGER:Date.now());for(let entry=ready();entry;entry=ready()){
      entry=queue.markSending(entry.commandId);renderLocalOutboxStatus();let result;
      try{result=await window.JustFunDesktop.regVps.syncEntities({warehouseId:entry.warehouseId,environment:entry.environment,commandId:entry.commandId,changes:entry.changes.map(({_fingerprint,...change})=>change)})}
      catch(error){const details={code:String(error?.code||'ENTITY_NETWORK_ERROR'),message:String(error?.message||error)};queue.markPending(entry.commandId,details,outboxRetryDelay(entry.attempts));if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}scheduleOutboxDrain(outboxRetryDelay(entry.attempts));break}
      if(result?.ok){acceptEntityBatchResult(result,entry.changes);queue.markConfirmed(entry.commandId,{cursor:Number(result.cursor)||0});if(entry.commandId===targetCommandId){targetState='confirmed';targetEntry=queue.get(entry.commandId)}continue}
      const failure={code:String(result?.code||'ENTITY_COMMAND_FAILED'),message:String(result?.error||'VPS отклонил изменение.'),details:asObject(result?.details)};
      if(failure.code.toLowerCase()==='entity_version_conflict'){
        queue.markConflict(entry.commandId,failure);for(const change of entry.changes)cloudSyncState.conflicts.set(entityKey(change.type,change.id),{...failure.details,type:change.type,id:change.id,commandId:entry.commandId,detectedAt:new Date().toISOString()});saveEntitySyncState();if(entry.commandId===targetCommandId){targetState='conflict';targetEntry=queue.get(entry.commandId)}break
      }
      if(retryableEntityFailure(failure)){queue.markPending(entry.commandId,failure,outboxRetryDelay(entry.attempts));if(entry.commandId===targetCommandId){targetState='pending';targetEntry=queue.get(entry.commandId)}scheduleOutboxDrain(outboxRetryDelay(entry.attempts));break}
      queue.markRejected(entry.commandId,failure,true);for(const change of entry.changes)cloudSyncState.conflicts.set(entityKey(change.type,change.id),{...failure.details,type:change.type,id:change.id,commandId:entry.commandId,state:'rejected',code:failure.code,detectedAt:new Date().toISOString()});saveEntitySyncState();if(entry.commandId===targetCommandId){targetState='rejected';targetEntry=queue.get(entry.commandId)}break
    }
  }finally{cloudSyncState.inFlight=false;cloudSyncState.dirty=queue.status().active>0||cloudSyncState.serial!==drainSerial;renderLocalOutboxStatus()}
  const state=queue.status();if(!state.active){integrationBadge('jfRegBadge','Синхронизировано','ready');integrationStatus('jfRegStatus','Все локальные изменения подтверждены VPS.','ok')}else if(state.pending||state.sending)integrationStatus('jfRegStatus',`На компьютере сохранено изменений: ${state.pending+state.sending}. Отправка будет повторена автоматически.`,'error');else integrationStatus('jfRegStatus',`Требуют решения: ${state.conflict+state.rejectedActive}. Локальные данные не удалены.`,'error');
  return{state:targetCommandId?targetState:(state.active?'pending':'confirmed'),entry:targetEntry}
}
let entityCommandChain=Promise.resolve();
function commitEntityMutation(intent,mutation){
  if(isTrainingEnvironment())return Promise.resolve().then(mutation);
  const critical=intent?.critical!==false;
  if(critical&&!onlineEntitySyncAvailable()){const message='Эта критическая операция требует подтверждения рабочего VPS. Обычные данные можно продолжать сохранять локально.';toast(message,'error');audit('critical_server_mutation_offline_blocked',{kind:intent?.kind||'',targetId:intent?.targetId||''});return Promise.resolve(false)}
  const execute=async()=>{
    let rollbackSnapshot=null,localCommandPersisted=false;
    try{
      resetEntityScope();const queue=requireLocalOutbox();
      if(critical){
        await waitForEntitySyncIdle();if(cloudSyncState.dirty)await backgroundCloudUpload({force:true});else{await bootstrapEntitySync();await drainLocalOutbox({force:true})}await waitForEntitySyncIdle();const pending=queue.status();if(pending.active||cloudSyncState.dirty)throw new Error('Сначала синхронизируйте или разрешите локальные изменения. Критическая операция не выполнена.');if(cloudSyncState.conflicts.size)throw new Error('Сначала разрешите конфликт серверных записей. Операция не выполнена.')
      }else if(onlineEntitySyncAvailable()){
        try{await waitForEntitySyncIdle();if(cloudSyncState.dirty)await backgroundCloudUpload();else{await bootstrapEntitySync();await drainLocalOutbox()}}catch(error){reportCloudSyncFailure(error)}
      }
      rollbackSnapshot=buildBackupPayload();cloudSyncState.suspended++;let mutationResult;try{mutationResult=await mutation();await window.TeplitsaWarehouseV600?.whenPersisted?.()}finally{cloudSyncState.suspended--}const afterSnapshot=buildBackupPayload(),changes=entityChangesBetween(rollbackSnapshot,afterSnapshot,{includeOutbox:!critical});
      if(!changes.length)return mutationResult;
      if(changes.length>1000)throw new Error('Операция изменила больше 1000 записей и безопасно остановлена. Разделите действие на несколько частей.');
      const blocked=queue.blockedEntityKeys(),blockedChange=changes.find(change=>blocked.has(entityKey(change.type,change.id)));if(blockedChange)throw outboxError('OUTBOX_ENTITY_BLOCKED',`Запись ${blockedChange.type}/${blockedChange.id} уже требует разрешения конфликта. Новое изменение отменено.`);
      if(!critical){
        const entry=queue.enqueue(localOutboxEntry(intent,changes));localCommandPersisted=true;cloudSyncState.dirty=true;cloudSyncState.serial++;renderLocalOutboxStatus();audit('local_entity_command_saved',{kind:intent?.kind||'',targetId:intent?.targetId||'',commandId:entry.commandId,changes:changes.length,warehouseId:entry.warehouseId,environment:entry.environment});
        if(!onlineEntitySyncAvailable()){toast('Изменение сохранено на этом компьютере и ожидает синхронизации.','success');return mutationResult}
        const sent=await drainLocalOutbox({targetCommandId:entry.commandId});
        if(sent.state==='rejected'){
          if(await rollbackLocalSnapshot(rollbackSnapshot)){queue.markRejected(entry.commandId,asObject(sent.entry?.lastError),false);for(const change of changes)cloudSyncState.conflicts.delete(entityKey(change.type,change.id));cloudSyncState.dirty=queue.status().active>0;saveEntitySyncState();renderLocalOutboxStatus()}
          throw outboxError(String(sent.entry?.lastError?.code||'ENTITY_COMMAND_REJECTED'),String(sent.entry?.lastError?.message||'VPS отклонил локальное изменение.'),asObject(sent.entry?.lastError?.details))
        }
        if(sent.state==='confirmed')toast('Изменение сохранено локально и подтверждено VPS.','success');else if(sent.state==='conflict')toast('Изменение сохранено локально, но конфликтует с серверной версией. Данные не потеряны.','error');else toast('Изменение сохранено локально и будет отправлено повторно.','success');return mutationResult
      }
      clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.inFlight=true;const warehouseId=activeWarehouseId(),environment=activeEnvironment(),commandId=newEntityCommandId(),result=await window.JustFunDesktop.regVps.syncEntities({warehouseId,environment,commandId,changes:changes.map(({_fingerprint,...item})=>item),intent});
      if(!result?.ok)throw Object.assign(new Error(result?.error||'VPS отклонил изменение.'),{code:result?.code||'ENTITY_COMMAND_FAILED',details:result?.details||{}});
      acceptEntityBatchResult(result,changes);integrationBadge('jfRegBadge','Операция подтверждена сервером','ready');const success=({route_approve:'Согласование рейса подтверждено сервером.',route_picking:'Комплектация рейса подтверждена сервером.',route_cancel:'Рейс отменён, складской резерв освобождён.',route_start:'Выезд подтверждён сервером.',route_return:'Возврат машины подтверждён сервером.',route_close:'Рейс закрыт, склад и архив обновлены.',pickup_ready:'Резерв самовывоза подтверждён сервером.',pickup_collected:'Выдача и списание подтверждены сервером.'})[intent?.kind];if(success)toast(success,'success');return mutationResult
    }catch(error){
      if(rollbackSnapshot&&(critical||!localCommandPersisted))await rollbackLocalSnapshot(rollbackSnapshot);if(['route_return','route_close'].includes(intent?.kind))window.closeRouteCloseModal?.();
      integrationBadge('jfRegBadge','Изменение отклонено','error');integrationStatus('jfRegStatus',error?.message||String(error),'error');toast(error?.message||String(error),'error');audit('server_entity_command_rejected',{kind:intent?.kind||'',targetId:intent?.targetId||'',code:error?.code||'',details:error?.details||{}});return false
    }finally{cloudSyncState.inFlight=false}
  };
  entityCommandChain=entityCommandChain.then(execute,execute);return entityCommandChain
}
function installEntityCommandGuards(){
  if(entityCommandGuardsInstalled)return;entityCommandGuardsInstalled=true;
  const currentOrderId=()=>typeof currentDetailId!=='undefined'?currentDetailId:'';
  const editId=selector=>()=>q(selector)?.value||'';
  const specs={
    saveOrder:{kind:'order_save',critical:false,target:editId('#editingOrderId'),optionalTarget:true},savePickup:{kind:'pickup_save',critical:false,target:editId('#editingPickupId'),optionalTarget:true},deleteOrder:{kind:'order_delete',critical:false,target:args=>args[0]},clearAll:{kind:'workspace_clear',target:()=>activeWarehouseId()},toggleCurrentOrderPayment:{kind:'order_payment',critical:false,target:currentOrderId},retryCurrentDelivery:{kind:'order_retry',critical:false,target:currentOrderId},resolveCurrentPartial:{kind:'order_partial_resolution',critical:false,target:currentOrderId},confirmNotRelevant:{kind:'order_not_relevant',critical:false,target:()=>q('#notRelevantOrderId')?.value},
    saveProduct:{kind:'product_save',critical:false,target:editId('#productEditId'),optionalTarget:true},deleteProduct:{kind:'product_delete',critical:false,target:args=>args[0]},importProductsFromOrders:{kind:'product_import',critical:false,target:()=>activeWarehouseId()},saveInventoryMovement:{kind:'inventory_movement',critical:false,target:editId('#inventoryMovementProductId'),optionalTarget:true},
    saveDriver:{kind:'driver_save',critical:false,target:editId('#driverEditId'),optionalTarget:true},deleteDriver:{kind:'driver_delete',critical:false,target:args=>args[0]},
    saveReportCalculationSettings:{kind:'report_settings',critical:false,target:()=>activeWarehouseId()},saveReportEmployee:{kind:'report_employee_save',critical:false,target:editId('#reportEmployeeEditId'),optionalTarget:true},deleteReportEmployee:{kind:'report_employee_delete',critical:false,target:args=>args[0]},saveReportExpense:{kind:'report_expense_save',critical:false,target:editId('#reportExpenseEditId'),optionalTarget:true},deleteReportExpense:{kind:'report_expense_delete',critical:false,target:args=>args[0]},
    saveSettingsFromForm:{kind:'route_settings',critical:false,target:()=>activeWarehouseId()},saveDriverPaymentSettings:{kind:'driver_payment_settings',critical:false,target:()=>activeWarehouseId()},saveDeliveryPricingSettings:{kind:'delivery_pricing_settings',critical:false,target:()=>activeWarehouseId()},
    approveRouteManually:{kind:'route_approve',target:args=>args[0]},startRoutePicking:{kind:'route_picking',critical:false,target:args=>args[0]},cancelRouteBeforeStart:{kind:'route_cancel',target:args=>args[0]},startRoute:{kind:'route_start',target:args=>args[0]},openRouteClosure:{kind:'route_return',target:args=>args[0]},commitRouteClosure:{kind:'route_close',target:()=>q('#routeCloseId')?.value},markCurrentPickupReady:{kind:'pickup_ready',critical:false,target:currentOrderId},markCurrentPickupCollected:{kind:'pickup_collected',target:currentOrderId}
  };
  for(const[name,spec]of Object.entries(specs)){const base=window[name];if(typeof base!=='function')continue;window[name]=function(){const args=arguments,event=args[0];if(event&&typeof event.preventDefault==='function')event.preventDefault();const targetId=String(spec.target(args)||'');if(!targetId&&!spec.optionalTarget)return base.apply(this,args);return commitEntityMutation({kind:spec.kind,targetId,critical:spec.critical},()=>base.apply(this,args))}}
}
function reportCloudSyncFailure(error){
  cloudSyncState.dirty=true;
  const message=String(error?.message||error||'VPS не подтвердил изменения.'),code=String(error?.code||'BACKGROUND_SYNC_FAILED');
  try{integrationBadge('jfRegBadge','Не сохранено на VPS','error')}catch{}
  try{integrationStatus('jfRegStatus',`Не сохранено на VPS: ${message}. Локальные изменения сохранены на этом компьютере; восстановите связь и повторите синхронизацию.`,'error')}catch{}
  try{toast('Не сохранено на VPS. Локальные изменения ожидают подтверждения сервера.','error')}catch{}
  try{audit('background_vps_sync_failed',{code,warehouseId:activeWarehouseId(),environment:activeEnvironment()})}catch{}
  try{console.error('Background entity upload failed',error)}catch{}
}
async function backgroundCloudUpload({force=false}={}){
  if(isTrainingEnvironment())return;if(cloudSyncState.inFlight){clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);return}if(cloudSyncState.suspended){clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150);return}resetEntityScope();const queue=requireLocalOutbox();
  const captureSerial=cloudSyncState.serial;await window.TeplitsaWarehouseV600?.whenPersisted?.();
  if(cloudSyncState.dirty&&!queue.status().active){
    const changes=buildPendingEntityChanges();for(let offset=0;offset<changes.length;offset+=1000){const chunk=changes.slice(offset,offset+1000);queue.enqueue(localOutboxEntry({kind:'background_local_capture',targetId:activeWarehouseId()},chunk));audit('background_local_entity_command_saved',{changes:chunk.length,warehouseId:activeWarehouseId(),environment:activeEnvironment()})}
  }
  cloudSyncState.dirty=queue.status().active>0||cloudSyncState.serial!==captureSerial;renderLocalOutboxStatus();
  if(!onlineEntitySyncAvailable()){if(cloudSyncState.dirty)integrationStatus('jfRegStatus',`Изменения сохранены на компьютере: ${queue.status().active}. VPS будет синхронизирован после восстановления связи.`,'error');return}
  if(!cloudSyncState.bootstrapped)await bootstrapEntitySync();await drainLocalOutbox({force});if(cloudSyncState.serial!==captureSerial){cloudSyncState.dirty=true;clearTimeout(cloudSyncState.uploadTimer);cloudSyncState.uploadTimer=setTimeout(()=>backgroundCloudUpload().catch(reportCloudSyncFailure),150)}
}
async function flushEntitySyncBeforeContextChange(){
  if(isTrainingEnvironment())return true;
  resetEntityScope();if(!onlineEntitySyncAvailable()){if(!desktopSession?.auth?.company?.data_service){await window.TeplitsaWarehouseV600?.whenPersisted?.();if(window.__warehousePersistenceCritical)throw new Error('Локальные данные не подтверждены на диске. Переключение склада остановлено.');return true}throw new Error('Рабочий VPS недоступен: локальные изменения сохранены, но перед сменой контекста должны быть синхронизированы.')}
  await waitForEntitySyncIdle();await backgroundCloudUpload({force:true});await waitForEntitySyncIdle();const state=requireLocalOutbox().status();
  if(cloudSyncState.conflicts.size||state.active||cloudSyncState.dirty)throw new Error(`VPS не подтвердил все локальные изменения. Ожидают или требуют решения: ${Math.max(state.active,cloudSyncState.dirty?1:0)}.`);
  return true
}
window.JustFunEntitySyncV783=Object.freeze({flushAndConfirm:flushEntitySyncBeforeContextChange,status:()=>{resetEntityScope();const outbox=cloudSyncState.outbox&&!cloudSyncState.outboxError?cloudSyncState.outbox.status():{active:0,corrupt:Boolean(cloudSyncState.outboxError)};return{bootstrapped:cloudSyncState.bootstrapped,dirty:cloudSyncState.dirty,inFlight:cloudSyncState.inFlight,conflicts:cloudSyncState.conflicts.size,scope:cloudSyncState.scope,cursor:cloudSyncState.cursor,outbox,...(window.__JF_RUNTIME_TEST__?{serial:cloudSyncState.serial,suspended:cloudSyncState.suspended,installed:cloudSyncState.installed}:{})}}});
if(window.__JF_RUNTIME_TEST__)window.__JustFunEntitySyncTestV783=Object.freeze({install:()=>{installAutomaticCloudSync();installEntityCommandGuards()},overlaySnapshot:snapshot=>{const copy=cloneValue(snapshot);overlayLocalOutbox(copy);return copy}});
let nextWarehouseRegistryRefreshAtV783=0;
async function refreshWarehouseRegistryDuringPollingV783(force=false,reason='warehouse-registry-periodic'){
  const now=Date.now();if(!force&&now<nextWarehouseRegistryRefreshAtV783)return false;nextWarehouseRegistryRefreshAtV783=now+30000;
  const before=activeWarehouseId();await synchronizeCompanyWarehouseRegistry();return applyWarehouseRegistryTransition(before,reason)
}
async function pollCloudRevision(){
  if(isTrainingEnvironment()||cloudSyncState.inFlight||desktopSession?.auth?.offline||!desktopSession?.auth?.company?.data_service)return;
  resetEntityScope();if(cloudSyncState.outbox&&!cloudSyncState.outboxError&&cloudSyncState.outbox.ready())await drainLocalOutbox();const now=Date.now();if(now<cloudSyncState.nextPollAt)return;if(await refreshWarehouseRegistryDuringPollingV783(false))return;await bootstrapEntitySync();if(!cloudSyncState.bootstrapped)return;
  const warehouseId=activeWarehouseId(),environment=activeEnvironment();if(!warehouseId)return;cloudSyncState.inFlight=true;
  try{
    let more=true,rounds=0,applied=0,workingSnapshot=null,current=null,activeWarehouseDeleted=false;
    while(more&&rounds++<8){
      const result=await window.JustFunDesktop?.regVps?.entityChanges?.({warehouseId,environment,afterEventId:cloudSyncState.cursor,limit:250});if(!result?.ok){const code=String(result?.code||'ENTITY_CHANGES_FAILED');if(code.toLowerCase()==='warehouse_access_denied'){if(await refreshWarehouseRegistryDuringPollingV783(true,'warehouse-access-revoked'))return;blockWorkspaceAfterWarehouseChange('Сервер отозвал доступ к открытому складу. Локальный кэш заблокирован до повторной проверки.');return}throw Object.assign(new Error(result?.error||'Лента изменений VPS недоступна.'),{code})}
      if(entityTypeSetSignature(result.readableTypes)!==entityTypeSetSignature([...cloudSyncState.readableTypes])){cloudSyncState.bootstrapped=false;await bootstrapEntitySync(true);workingSnapshot=null;current=null;applied=0;more=false;break}
      if(!asArray(result.events).length){cloudSyncState.cursor=Math.max(cloudSyncState.cursor,Number(result.cursor)||0);more=false;break}
      workingSnapshot=workingSnapshot||buildBackupPayload();current=current||splitEntitySnapshot(workingSnapshot);
      for(const rawEvent of result.events){const event=canonicalServerEntity(rawEvent),key=entityKey(event.type,event.id),known=cloudSyncState.known.get(key),local=current.get(key),localDirty=local?(!known||known.deleted||local.fingerprint!==known.fingerprint):Boolean(known&&!known.deleted);if(Number(event.version)<=Number(known?.version||0))continue;
        if(event.type==='warehouse'&&event.id===warehouseId&&event.operation==='delete'){activeWarehouseDeleted=true;current.delete(key);cloudSyncState.known.set(key,{version:Number(event.version)||0,digest:String(event.digest||''),fingerprint:'',deleted:true,eventId:Number(event.eventId)||0});applied++;continue}
        if(localDirty){const details={type:event.type,id:event.id,remoteVersion:event.version,remotePayload:event.payload,operation:event.operation,eventId:event.eventId,detectedAt:new Date().toISOString()};cloudSyncState.conflicts.set(key,details);markOutboxEntityConflict(key,{code:'entity_version_conflict',message:'Запись изменена на другом компьютере.',details});integrationBadge('jfRegBadge','Нужно решить конфликт','error');continue}
        applyEntityToSnapshot(workingSnapshot,event,event.operation==='delete');if(event.operation==='delete')current.delete(key);else current.set(key,{type:event.type,id:event.id,payload:event.payload,fingerprint:entityFingerprint(event.payload)});cloudSyncState.known.set(key,{version:Number(event.version)||0,digest:String(event.digest||''),fingerprint:event.operation==='delete'?'':entityFingerprint(event.payload),deleted:event.operation==='delete',eventId:Number(event.eventId)||0});applied++}
      cloudSyncState.cursor=Math.max(cloudSyncState.cursor,Number(result.cursor)||0);more=result.hasMore===true;
    }
    if(activeWarehouseDeleted){markPendingWarehouseDelete(warehouseId);cloudSyncState.dirty=false;cloudSyncState.conflicts=new Map();saveEntitySyncState();try{await synchronizeCompanyWarehouseRegistry()}catch(error){applyWarehouseRegistryTransition(warehouseId,'active-warehouse-delete-pending');throw error}audit('active_warehouse_deleted_remotely',{warehouseId,replacement:activeWarehouseId()});applyWarehouseRegistryTransition(warehouseId,'active-warehouse-deleted');return}
    if(applied&&workingSnapshot){cloudSyncState.suspended++;try{await window.TeplitsaWarehouseV600?.importServerSnapshot?.(workingSnapshot)}finally{cloudSyncState.suspended--}integrationBadge('jfRegBadge','Получены изменения','ready');integrationStatus('jfRegStatus',`Применено ${applied} изменений отдельных записей с других компьютеров.`,'ok')}
    if(cloudSyncState.conflicts.size)integrationStatus('jfRegStatus',`Обнаружено конфликтов: ${cloudSyncState.conflicts.size}. Локальные данные не перезаписаны; требуется выбрать версию.`,'error');
    cloudSyncState.pollFailures=0;cloudSyncState.nextPollAt=0;saveEntitySyncState();
  }catch(error){cloudSyncState.pollFailures=Math.min(8,cloudSyncState.pollFailures+1);cloudSyncState.nextPollAt=Date.now()+Math.min(300000,5000*(2**cloudSyncState.pollFailures));throw error}
  finally{cloudSyncState.inFlight=false}
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
let telegramProgressBound=false,telegramCompanyPublishBound=false;
const TELEGRAM_STAGE_LABELS={
  token_verification:'Проверяется Cloudflare API-токен',account_selection:'Проверяются аккаунт и разрешения',telegram_verification:'Проверяется Telegram-бот',subdomain:'Подготавливается бесплатный адрес workers.dev',database:'Создаётся база D1',migration:'Создаются таблицы и применяются миграции',worker_upload:'Публикуется Cloudflare Worker',worker_check:'Проверяется Worker',webhook:'Устанавливается защищённый webhook',final_check:'Выполняется итоговая диагностика',completed:'Подключение завершено'
};
function renderTelegramProgress(payload={}){
  const wrap=q('#jfTelegramProgress'),bar=q('#jfTelegramProgressBar'),percent=q('#jfTelegramProgressPercent'),text=q('#jfTelegramProgressText');if(!wrap)return;
  const value=Math.max(0,Math.min(100,Number(payload.percent||0)));wrap.hidden=false;if(bar)bar.style.width=value+'%';if(percent)percent.textContent=Math.round(value)+'%';if(text)text.textContent=payload.title||payload.message||TELEGRAM_STAGE_LABELS[payload.stage]||'Выполняется настройка…';
  if(payload.stage==='completed')setTimeout(()=>{if(wrap)wrap.hidden=true},1600);
}
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
  const button=q(reconnect?'#jfTelegramReconnect':'#jfTelegramConfigure');if(integrationWizardBusy)return integrationStatus('jfTelegramStatus','Сначала завершите уже открытый системный мастер.','error');setIntegrationWizardBusy(button,true);integrationStatus('jfTelegramStatus','Открывается отдельное защищённое окно. Введите временный Cloudflare API-токен и токен своего бота от @BotFather. Cloudflare-токен не будет сохранён.');
  try{const result=await window.JustFunDesktop?.telegramCloudflare?.configure?.(reconnect,activeWarehouseId());if(result?.canceled)return integrationStatus('jfTelegramStatus','Настройка отменена. Введённые токены очищены и не сохранены.');if(!result?.ok)throw new Error(result?.error||'Подключение не завершено');integrationStatus('jfTelegramStatus',result?.companyPublishPending?`${result.error||'Worker, D1 и webhook созданы, но профиль компании ещё не сохранён.'} Временный Cloudflare API-токен можно удалить.`:'Инфраструктура создана и проверена. Теперь удалите временный Cloudflare API-токен в личном кабинете Cloudflare.',result?.companyPublishPending?'error':'ok');await refreshTelegramStatus();await refreshTelegramBindings().catch(()=>false);startTelegramPolling()}
  catch(error){integrationBadge('jfTelegramBadge','Ошибка','error');integrationStatus('jfTelegramStatus',error?.message||error,'error')}
  finally{setIntegrationWizardBusy(button,false)}
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
  const boxes=qa('#jfRegIntegrationsBox,#jfTelegramIntegrationsBox,#jfIntegrationsBox');if(!boxes.length||boxes.every(box=>box.dataset.bound==='1')||!hasPermission('company.update'))return;if(isTrainingEnvironment()){boxes.forEach(box=>{box.dataset.bound='1';qa('button',box).forEach(button=>{button.disabled=true;button.classList.add('jf-role-hidden')})});integrationBadge('jfRegBadge','Учебный режим');integrationStatus('jfRegStatus','Подключение VPS доступно только в рабочем режиме.');integrationBadge('jfTelegramBadge','Учебный режим');integrationStatus('jfTelegramStatus','Подключение Telegram доступно только в рабочем режиме.');return}boxes.forEach(box=>box.dataset.bound='1');if(!telegramProgressBound&&window.JustFunDesktop?.telegramCloudflare?.onProgress){window.JustFunDesktop.telegramCloudflare.onProgress(renderTelegramProgress);telegramProgressBound=true;}if(!telegramCompanyPublishBound&&window.JustFunDesktop?.telegramCloudflare?.onCompanyPublished){window.JustFunDesktop.telegramCloudflare.onCompanyPublished(()=>refreshTelegramStatus().catch(error=>integrationStatus('jfTelegramStatus',userVisibleError(error),'error')));telegramCompanyPublishBound=true;}q('#jfRegConfigure').onclick=configureRegVps;q('#jfRegCheck').onclick=()=>refreshRegVpsStatus({manual:true});q('#jfRegSync').onclick=syncActiveWarehouse;q('#jfRegRestore').onclick=restoreActiveWarehouseFromVps;q('#jfTelegramConfigure').onclick=()=>configureTelegram(false);q('#jfTelegramReconnect').onclick=repairTelegram;q('#jfTelegramCheck').onclick=refreshTelegramStatus;q('#jfTelegramWarehouse').onclick=bindActiveWarehouseTelegram;refreshRegVpsStatus().catch(error=>integrationStatus('jfRegStatus',userVisibleError(error),'error'));refreshTelegramStatus().catch(error=>integrationStatus('jfTelegramStatus',userVisibleError(error),'error'))
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
function routeTelegramMessage(def,targetType){
  const plan=typeof validRoutePlan==='function'?validRoutePlan(def):null;
  const ordered=plan?.orderedIds?.map(id=>def.orders.find(order=>String(order.id)===String(id))).filter(Boolean)||def.orders||[];
  const driver=typeof assignedDriverForRoute==='function'?assignedDriverForRoute(def.id):null,slot=typeof routeLoadingSlot==='function'?routeLoadingSlot(def):null;
  const rules=plan&&typeof routeRuleMetrics==='function'?routeRuleMetrics(plan,ordered.length):null;
  const warehousePoint=[Number(settings?.warehouse?.lat),Number(settings?.warehouse?.lon)],hasWarehousePoint=warehousePoint.every(Number.isFinite),returns=typeof routeReturnsToWarehouse==='function'?routeReturnsToWarehouse(def.id):true;
  const orderPoints=ordered.map(order=>[Number(order.geo?.lat),Number(order.geo?.lon)]).filter(point=>point.every(Number.isFinite));
  const yandexPoints=[...(hasWarehousePoint?[warehousePoint]:[]),...orderPoints,...(hasWarehousePoint&&returns?[warehousePoint]:[])];
  const yandexUrl=yandexPoints.length>1?`https://yandex.ru/maps/?rtext=${encodeURIComponent(yandexPoints.map(point=>point.join(',')).join('~'))}&rtt=auto`:'';
  if(targetType==='warehouse'){
    const cargo=new Map();
    ordered.forEach(order=>(order.items||[]).forEach(item=>{const key=String(item.productId||item.article||item.name),entry=cargo.get(key)||{name:item.name||item.article||'Товар',qty:0,unit:item.unit||'шт'};entry.qty+=Number(item.qty||0);cargo.set(key,entry)}));
    const shortages=typeof inventoryShortagesForOrders==='function'?inventoryShortagesForOrders(ordered):[];
    const lines=['JUSTFUN · ЛИСТ КОМПЛЕКТАЦИИ И ПОГРУЗКИ',String(def.displayDistrict||def.district||'Рейс'),`Дата: ${typeof formatDateOnly==='function'?formatDateOnly(def.date):String(def.date||'—')}`,`Склад: ${activeWarehouseLabel()}`,`Машина: ${driver?.name||'не назначена'}${driver?.plate?` · ${driver.plate}`:''}`,`Подача: ${slot?.arrivalWindow||'—'} · погрузка: ${slot?.loadingWindow||'—'} · выезд: ${slot?.departureTime||'—'}`,'',`СОБРАТЬ ДЛЯ РЕЙСА · ${ordered.length} точек:`];
    [...cargo.values()].forEach((item,index)=>lines.push(`${index+1}. ${item.name} — ${item.qty.toLocaleString('ru-RU')} ${item.unit}`));
    lines.push('',shortages.length?`ПРОБЛЕМА: не хватает ${shortages.map(item=>`${item.product?.name||'товара'} — ${Number(item.missing||0).toLocaleString('ru-RU')}`).join('; ')}`:'ПРОВЕРКА ОСТАТКОВ: дефицит не обнаружен','', 'ПОРЯДОК ПОГРУЗКИ: последняя точка маршрута грузится первой.');
    [...ordered].reverse().forEach((order,index)=>lines.push(`${index+1}. Заказ ${order.number||order.id} · ${order.deliveryAddress||'адрес не указан'}\n   ${(order.items||[]).map(item=>`${item.name} × ${Number(item.qty||0).toLocaleString('ru-RU')}`).join('; ')||'состав не указан'}`));
    lines.push('','Кнопками под сообщением отметьте: сборка → готово → загружено → проблема.');
    return lines.join('\n').slice(0,3490)
  }
  const lines=[
    'JUSTFUN · РЕЙС ДЛЯ ВОДИТЕЛЯ',
    String(def.displayDistrict||def.district||'Рейс'),
    `Дата: ${typeof formatDateOnly==='function'?formatDateOnly(def.date):String(def.date||'—')}`,
    `Склад: ${activeWarehouseLabel()}`,
    `Водитель: ${driver?.name||'не назначен'}${driver?.brand||driver?.model?` · ${[driver.brand,driver.model,driver.plate].filter(Boolean).join(' ')}`:''}`,
    `Подача: ${slot?.arrivalWindow||'—'} · погрузка: ${slot?.loadingWindow||'—'} · выезд: ${slot?.departureTime||'—'}`,
    plan?`Маршрут: ${typeof formatKm==='function'?formatKm(plan.distance):Math.round(Number(plan.distance||0)/1000)+' км'} · ${typeof formatDuration==='function'?formatDuration(rules?.totalMin||0):''} · ${returns?'возврат на склад':'без возврата на склад'}`:`Маршрут: склад → точки${returns?' → склад':''} (порядок ещё не рассчитан)`,
    '',
    `Точки: ${ordered.length}`
  ];
  if(yandexUrl)lines.push(`Открыть весь маршрут в Яндекс Картах: ${yandexUrl}`,'');
  ordered.forEach((order,index)=>{
    const eta=plan?.schedule?.find(stop=>String(stop.orderId)===String(order.id))?.eta||'—';
    lines.push(`${index+1}. ${order.deliveryAddress||'Адрес не указан'}`);
    lines.push(`   Заказ ${order.number||order.id} · ETA ${eta}`);
    lines.push(`   ${order.contactName||'Контакт не указан'}${order.contactMethod?` · ${order.contactMethod}`:''}`);
    if(order.driverNote)lines.push(`   Важно: ${order.driverNote}`);
    if(order.items?.length)lines.push(`   Груз: ${order.items.map(item=>`${item.name} × ${Number(item.qty||0).toLocaleString('ru-RU')}`).join('; ')}`)
  });
  lines.push('','После получения нажмите «Принял». Перед выездом — «В пути». По завершении — «Рейс завершён».');
  return lines.join('\n').slice(0,3490)
}
async function sendRouteTelegram(def,targetType,button){
  const warehouseId=activeWarehouseId(),driver=typeof assignedDriverForRoute==='function'?assignedDriverForRoute(def.id):null;
  const entityId=targetType==='driver'?String(driver?.id||''):warehouseId;
  if(!entityId)return toast('Сначала назначьте водителя на рейс.','error');
  if(!telegramBindings.has(telegramBindingKey(targetType,entityId)))return toast(targetType==='driver'?'Сначала подключите водителя к Telegram-боту.':'Сначала подключите Telegram-группу склада.','error');
  const text=routeTelegramMessage(def,targetType),fingerprint=typeof hashString==='function'?hashString(text):String(text.length),routeHash=typeof hashString==='function'?hashString(String(def.id)):String(def.id).replace(/[^A-Za-z0-9_-]/g,'').slice(0,30);
  setIntegrationBusy(button,true);setRouteTelegramState(def.id,targetType,entityId,{status:'sending'});decorateRouteTelegram();
  try{
    const response=await window.JustFunDesktop?.telegramCloudflare?.sendNotification?.({
      warehouseId,entityType:targetType,entityId,routeId:String(def.id),
      idempotencyKey:`route:${routeHash}:${targetType}:${fingerprint}`,
      title:String(def.displayDistrict||def.district||'Маршрутный лист'),
      metadata:{date:String(def.date||''),warehouse:activeWarehouseLabel(),driver:String(driver?.name||''),stops:Number(def.orders?.length||0)},
      text,statusButtons:true
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
      driverBound=driverId&&telegramBindings.has(telegramBindingKey('driver',driverId)),
      warehouseBound=telegramBindings.has(telegramBindingKey('warehouse',warehouseId)),
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
  const binding=telegramBindings.get(telegramBindingKey('driver',String(driver.id))),section=document.createElement('div');section.className='detail-section jf-telegram-driver';section.dataset.driverId=String(driver.id);section.innerHTML=`<h2 class="detail-section-title">Telegram водителя</h2><div class="jf-route-telegram-head"><div class="muted">Одноразовая ссылка относится только к водителю «${esc(driver.name)}» и складу «${esc(activeWarehouseLabel())}». Chat ID вручную не вводится.</div><span class="jf-telegram-state ${binding?'sent':''}">${binding?`Подключён${binding.username?`: @${esc(binding.username)}`:''}`:'Не подключён'}</span></div><div class="jf-telegram-driver-actions"><button class="btn-primary" type="button" data-driver-link>${binding?'Создать новую ссылку':'Подключить водителя'}</button><button class="btn-soft" type="button" data-driver-test ${binding?'':'disabled'}>Отправить проверку</button></div><div class="jf-telegram-driver-result" data-driver-result hidden></div>`;body.prepend(section);const resultBox=q('[data-driver-result]',section);
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
      if(!q('.jf-settings-help',box)&&!q('.jf-integration-lead',body)){const hint=document.createElement('div');hint.className='jf-settings-help';hint.textContent=data.summary;const h=q('h3',body);h?.parentElement?.insertBefore(hint,h.nextSibling)}
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
