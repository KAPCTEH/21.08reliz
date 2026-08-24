/* JustFun Orders & Logistics 7.8.3 — isolated warehouses, company branding and document identity */
(function(){
'use strict';
const BUILD='7.8.3';
const B=window.TeplitsaWarehouseBootstrap;
if(!B){console.error('Warehouse bootstrap is unavailable');return}
const $id=id=>document.getElementById(id);
const clone=value=>{try{return structuredClone(value)}catch{return JSON.parse(JSON.stringify(value))}};
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const attr=value=>escape(value).replace(/`/g,'&#96;');
const active=()=>B.activeWarehouse();
const activeId=()=>String(active()?.id||'default-warehouse');
const activeCode=()=>String(active()?.code||'СКЛ');
const safePrefix=value=>String(value||'').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3);
const nowIso=()=>new Date().toISOString();
const MAX_LOGO_DATA_URL_LENGTH=5*1024*1024;
function safeLogoDataUrl(value){
  const source=String(value||'');
  if(!source||source.length>MAX_LOGO_DATA_URL_LENGTH)return'';
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)?source:'';
}

function companyDefaults(){return{
  programName:'Заказы и логистика',programSubtitle:'JustFun · разработка и автоматизация для малого бизнеса',shortName:'JustFun',legalName:'',inn:'',kpp:'',ogrn:'',legalAddress:'',actualAddress:'',phone:'',phone2:'',email:'',website:'',contactPerson:'',workHours:'',bank:'',bik:'',corrAccount:'',settlementAccount:'',
  logoDataUrl:'',showLogoInApp:true,showLogoInDocuments:true,logoPosition:'left',
  promoEnabled:false,promoTitle:'Комплексные поставки для строительства и монтажа',promoText:'',promoBenefits:['Быстрая комплектация заказов','',''],promoCta:'Свяжитесь с нами для расчёта следующего заказа.',
  invoicePrefix:safePrefix(active()?.code)||'СЧ',invoiceDateFormat:'DDMMYY',invoiceSeparator:'-',invoiceDailySequence:true
}}
function validRouteStart(source){
  const point=asObject(source),lat=Number(point.lat),lon=Number(point.lon);
  return Boolean(String(point.address||'').trim())&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
}
function ensureWarehouseSettings(){
  settings.company=deepMerge(companyDefaults(),asObject(settings.company));
  settings.company.logoDataUrl=safeLogoDataUrl(settings.company.logoDataUrl);
  const previousProfile=asObject(settings.warehouseProfile),previousWarehouse=asObject(settings.warehouse),warehouse={...previousWarehouse,address:String(previousWarehouse.address||active()?.address||''),lat:previousWarehouse.lat==null&&active()?.lat!=null?Number(active().lat):previousWarehouse.lat==null?null:Number(previousWarehouse.lat),lon:previousWarehouse.lon==null&&active()?.lon!=null?Number(active().lon):previousWarehouse.lon==null?null:Number(previousWarehouse.lon)};
  settings.warehouse=warehouse;
  settings.warehouseProfile={...previousProfile,id:activeId(),code:activeCode(),name:String(active()?.name||'Склад'),timezone:'Europe/Moscow',routeStartConfigured:validRouteStart(warehouse)};
}
const persistSettingsV760=persistSettings;
persistSettings=function(){
  const wh=active(),point=asObject(settings.warehouse);if(wh){const r=B.getRegistry(),record=r.warehouses.find(x=>String(x.id)===activeId());if(record){const address=String(point.address||'').trim(),lat=point.lat==null?null:Number(point.lat),lon=point.lon==null?null:Number(point.lon),changed=String(record.address||'')!==address||(record.lat==null?null:Number(record.lat))!==lat||(record.lon==null?null:Number(record.lon))!==lon;if(changed){record.address=address;record.lat=lat;record.lon=lon;record.updatedAt=nowIso();B.saveRegistry(r)}}settings.warehouseProfile={...asObject(settings.warehouseProfile),id:activeId(),code:activeCode(),name:String(wh.name||'Склад'),timezone:'Europe/Moscow',routeStartConfigured:validRouteStart(point)}}
  return persistSettingsV760.apply(this,arguments);
};
function formatInvoiceDate(value,format){
  let d=new Date(value||Date.now());if(!Number.isFinite(d.getTime()))d=new Date();
  const parts=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(d).reduce((o,p)=>(o[p.type]=p.value,o),{}),dd=parts.day||'01',mm=parts.month||'01',yyyy=parts.year||String(d.getFullYear()),yy=yyyy.slice(-2);
  if(format==='YYMMDD')return yy+mm+dd;if(format==='DDMMYYYY')return dd+mm+yyyy;return dd+mm+yy
}
function baseInvoiceNumber(date){const c=settings.company||companyDefaults(),prefix=safePrefix(c.invoicePrefix)||safePrefix(activeCode())||'СЧ',sep=['-','/',''].includes(c.invoiceSeparator)?c.invoiceSeparator:'-';return prefix+sep+formatInvoiceDate(date,c.invoiceDateFormat)}
function nextInvoiceNumber(date,excludeId=''){
  const base=baseInvoiceNumber(date),escaped=base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('^'+escaped+'(?:-(\\d+))?$');let max=0;
  for(const order of orders){if(order.id===excludeId)continue;const match=String(order.invoiceNumber||'').match(pattern);if(!match)continue;max=Math.max(max,match[1]?Number(match[1]):1)}
  return max?`${base}-${String(max+1).padStart(2,'0')}`:base
}

function documentSnapshot(){const wh=active(),company=clone(settings.company||companyDefaults());return{version:1,capturedAt:nowIso(),warehouse:{id:activeId(),code:activeCode(),name:wh?.name||'Склад',address:settings.warehouse?.address||wh?.address||''},company}}
function quarantineForeign(kind,records,reason='warehouse_id_mismatch'){
  const list=asArray(records).filter(Boolean);if(!list.length)return true;
  const key=B.dataKey('teplitsa_cross_warehouse_quarantine_v600');let current=[];
  try{current=asArray(JSON.parse(localStorage.getItem(key)||'[]'))}catch{current=[]}
  const incident={id:`q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,at:nowIso(),activeWarehouseId:activeId(),activeWarehouseCode:activeCode(),environment:isDemonstrationMode()?'demo':'live',kind,reason,records:clone(list)};
  try{current.push(incident);localStorage.setItem(key,JSON.stringify(current));console.error(`Заблокированы данные другого склада (${kind}): ${list.length}`);return true}catch(error){window.__warehouseIsolationCritical=true;console.error('Не удалось сохранить карантин данных другого склада',error);return false}
}
function splitWarehouseRecords(kind,source){
  const wid=activeId(),accepted=[],foreign=[];
  for(const item of asArray(source)){if(!item)continue;const owner=String(item.warehouseId||'');if(owner&&owner!==wid)foreign.push(item);else accepted.push(item)}
  if(foreign.length)quarantineForeign(kind,foreign);
  return{accepted,foreign}
}
function stampCurrentData(){
  const wid=activeId();let changed=false;
  const orderSplit=splitWarehouseRecords('orders',orders),productSplit=splitWarehouseRecords('products',products),movementSplit=splitWarehouseRecords('inventoryMovements',inventoryMovements),driverSplit=splitWarehouseRecords('drivers',drivers);
  if(orderSplit.foreign.length||productSplit.foreign.length||movementSplit.foreign.length||driverSplit.foreign.length)changed=true;
  let usedInvoices=new Set(orderSplit.accepted.map(o=>String(o?.invoiceNumber||'')).filter(Boolean));
  orders=orderSplit.accepted.map(o=>{let invoice=String(o.invoiceNumber||'');if(!invoice){const base=baseInvoiceNumber(o.createdAt||o.deliveryDate);invoice=base;let seq=2;while(usedInvoices.has(invoice))invoice=`${base}-${String(seq++).padStart(2,'0')}`;usedInvoices.add(invoice)}if(!o.warehouseId||!o.invoiceNumber||!o.documentSnapshot){changed=true;return{...o,warehouseId:wid,invoiceNumber:invoice,documentSnapshot:o.documentSnapshot||documentSnapshot()}}return o});
  products=productSplit.accepted.map(p=>p.warehouseId?p:(changed=true,{...p,warehouseId:wid}));
  inventoryMovements=movementSplit.accepted.map(m=>m.warehouseId?m:(changed=true,{...m,warehouseId:wid}));
  drivers=driverSplit.accepted.map(d=>d.warehouseId?d:(changed=true,{...d,warehouseId:wid}));
  for(const [id,meta] of Object.entries(routeCatalog||{})){if(!meta)continue;const owner=String(meta.warehouseId||'');if(owner&&owner!==wid){quarantineForeign('routeCatalog',[{id,...meta}]);delete routeCatalog[id];changed=true}else if(!owner){meta.warehouseId=wid;changed=true}}
  for(const [id,ex] of Object.entries(routeExecutions||{})){if(!ex)continue;const owner=String(ex.warehouseId||'');if(owner&&owner!==wid){quarantineForeign('routeExecutions',[{id,...ex}]);delete routeExecutions[id];changed=true}else if(!owner){ex.warehouseId=wid;changed=true}}
  if(changed){persistOrders();persistProducts();persistInventoryMovements();persistDrivers();persistRoutes();persistRouteAssignments();persistRouteExecutions()}
}
function persistEverything(){
  const operations=[['orders',persistOrders],['products',persistProducts],['inventoryMovements',persistInventoryMovements],['drivers',persistDrivers],['settings',persistSettings],['routes',persistRoutes],['routeAssignments',persistRouteAssignments],['routeDrivers',persistRouteDrivers],['routeLocks',persistRouteLocks],['routeOverrides',persistRouteOverrides],['routeExecutions',persistRouteExecutions],['routeArchives',persistRouteArchives],['warehouseReservations',persistWarehouseReservations],['reporting',persistReporting]],failures=[];
  for(const[name,operation]of operations){try{if(operation()===false)failures.push({name,error:'Функция сохранения вернула false'})}catch(error){failures.push({name,error:String(error?.message||error)});window.reportRuntimeErrorV783?.(`warehouse.persist.${name}`,error)}}
  if(failures.length){window.__warehousePersistenceCritical=failures;throw new Error(`Не сохранены разделы склада: ${failures.map(item=>item.name).join(', ')}`)}
  window.__warehousePersistenceCritical=null;return true
}
function applyBranding(){
  ensureWarehouseSettings();const c=settings.company,wh=active();
  document.title=`${c.programName||'Заказы и логистика'} — ${wh?.name||'Склад'} · ${BUILD}`;
  const title=document.querySelector('.brand-title'),sub=document.querySelector('.brand-sub'),brand=document.querySelector('.company-brand'),logo=document.querySelector('.company-brand .logo');
  if(title)title.textContent=c.programName||'Заказы и логистика';if(sub)sub.textContent=c.programSubtitle||wh?.name||'';
  if(brand){brand.classList.remove('logo-center-v600','logo-right-v600');if(c.logoPosition==='center')brand.classList.add('logo-center-v600');else if(c.logoPosition==='right')brand.classList.add('logo-right-v600')}
  if(logo){const logoDataUrl=safeLogoDataUrl(c.logoDataUrl),custom=!!logoDataUrl&&c.showLogoInApp!==false;logo.classList.toggle('warehouse-custom-logo',custom);if(custom)logo.style.setProperty('background-image',`url("${logoDataUrl}")`,'important');else logo.style.removeProperty('background-image')}
  let chip=$id('activeWarehouseChip');if(!chip){chip=document.createElement('button');chip.id='activeWarehouseChip';chip.className='warehouse-active-chip';chip.type='button';chip.onclick=()=>{showView('programSettings');setTimeout(()=>document.querySelector('.warehouse-manager-box')?.scrollIntoView({behavior:'smooth',block:'start'}),50)};document.querySelector('.nav .actions')?.prepend(chip)}
  if(chip)chip.innerHTML=`<span>Активный склад</span><b>${escape(wh?.name||'Склад')}</b><i>${escape(wh?.code||'СКЛ')}</i>`;
  document.querySelectorAll('[data-warehouse-context]').forEach(el=>el.textContent=`${wh?.name||'Склад'} · ${wh?.code||'СКЛ'}`)
}

function warehouseCardsHtml(){const r=B.getRegistry();return r.warehouses.map(w=>{const point=w.id===r.activeWarehouseId?settings.warehouse:w,ready=validRouteStart(point);return`<div class="warehouse-card ${w.id===r.activeWarehouseId?'active':''} ${w.status==='archived'?'archived':''}"><div class="warehouse-card-code">${escape(w.code)}</div><div class="warehouse-card-main"><b>${escape(w.name)}</b><span>${escape(w.address||'Адрес не заполнен')}</span><small>${w.id===r.activeWarehouseId?'Сейчас открыт':w.status==='archived'?'Архивный склад':'Полностью отдельная пустая база'} · ${ready?'точка маршрута готова':'нужно настроить точку маршрута'}</small></div><div class="warehouse-card-actions">${w.id!==r.activeWarehouseId&&w.status!=='archived'?`<button class="btn-primary mini-btn" data-jf-onclick="switchWarehouseV600('${attr(w.id)}')">Открыть</button>`:''}${w.id===r.activeWarehouseId?`<button class="btn-soft mini-btn" data-jf-onclick="openWarehouseEditorV600()">Изменить</button>`:''}${w.id!==r.activeWarehouseId?`<button class="btn-gray mini-btn" data-jf-onclick="toggleWarehouseArchiveV600('${attr(w.id)}')">${w.status==='archived'?'Вернуть':'В архив'}</button>`:''}${w.id!==r.activeWarehouseId&&w.status==='archived'&&canDeleteWarehouseV760()?`<button class="btn-danger mini-btn" data-jf-onclick="deleteWarehouseV760('${attr(w.id)}')">Удалить данные</button>`:''}</div></div>`}).join('')}
function canCreateWarehouseV760(){const check=window.JustFunWarehouseAccessV783?.canCreate;return typeof check!=='function'||check()===true}
function canDeleteWarehouseV760(){const check=window.JustFunWarehouseAccessV783?.canDelete;return typeof check!=='function'||check()===true}
function installSettingsPanels(){
  const grid=$id('programSettingsView')?.querySelector('.settings-grid');if(!grid)return;
  let box=$id('warehouseManagerV600');if(!box){box=document.createElement('div');box.id='warehouseManagerV600';box.className='settings-box span-2 warehouse-manager-box';grid.prepend(box)}
  box.innerHTML=`<div class="warehouse-section-head"><div><h3>Склады и рабочее пространство</h3><p>Программа загружает данные только одного склада. Заказы, товары, остатки, рейсы, водители, расходы, отчёты, документы и DEMO физически хранятся раздельно.</p></div>${canCreateWarehouseV760()?'<button class="btn-primary" data-jf-onclick="openWarehouseCreatorV600()">+ Добавить склад</button>':''}</div><div class="warehouse-safety-line"><b>Сейчас открыт:</b> <span data-warehouse-context></span><i>При переключении программа полностью меняет рабочий контекст, поэтому формы и карты другого склада не переносятся.</i></div>${validRouteStart(settings.warehouse)?'':`<div class="warehouse-route-warning"><b>Маршруты пока заблокированы.</b><span>Найдите адрес склада и подтвердите его точку на карте. Заказы и остальные разделы уже доступны.</span><button class="btn-soft mini-btn" data-jf-onclick="openWarehouseEditorV600()">Настроить адрес</button></div>`}<div class="warehouse-list">${warehouseCardsHtml()}</div>`;
  let company=$id('companySettingsV600');if(!company){company=document.createElement('div');company.id='companySettingsV600';company.className='settings-box span-2 company-settings-box';box.insertAdjacentElement('afterend',company)}
  renderCompanySettings();
}
function renderCompanySettings(){const box=$id('companySettingsV600');if(!box)return;ensureWarehouseSettings();const c=settings.company,logoDataUrl=safeLogoDataUrl(c.logoDataUrl);
  box.innerHTML=`<div class="warehouse-section-head"><div><h3>Компания, логотип и документы</h3><p>Все параметры относятся только к активному складу и сохраняются в новых документах снимком.</p></div><button class="btn-primary" data-jf-onclick="saveCompanySettingsV600()">Сохранить оформление</button></div>
  <div class="company-settings-grid">
    <section><h4>Название программы</h4><div class="field"><label>Название в шапке</label><input id="v600ProgramName" value="${attr(c.programName)}" maxlength="60"></div><div class="field"><label>Подзаголовок</label><input id="v600ProgramSubtitle" value="${attr(c.programSubtitle)}" maxlength="120"></div></section>
    <section><h4>Логотип</h4><div class="logo-settings-row"><div class="logo-preview-v600" id="v600LogoPreview" ${logoDataUrl?`style="background-image:url('${attr(logoDataUrl)}')"`:''}></div><div><button class="btn-soft" type="button" data-jf-onclick="chooseCompanyLogoV600()">Загрузить</button><button class="btn-gray" type="button" data-jf-onclick="removeCompanyLogoV600()">Удалить</button><input id="v600LogoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden data-jf-onchange="loadCompanyLogoV600(event)"><label class="checkline"><input id="v600LogoApp" type="checkbox" ${c.showLogoInApp!==false?'checked':''}> В программе</label><label class="checkline"><input id="v600LogoDocs" type="checkbox" ${c.showLogoInDocuments!==false?'checked':''}> В документах</label><div class="field logo-position-field-v600"><label>Расположение логотипа</label><select id="v600LogoPosition"><option value="left" ${c.logoPosition!=='center'&&c.logoPosition!=='right'?'selected':''}>Слева</option><option value="center" ${c.logoPosition==='center'?'selected':''}>По центру</option><option value="right" ${c.logoPosition==='right'?'selected':''}>Справа</option></select></div></div></div></section>
    <section class="span-2"><h4>Реквизиты и контакты</h4><div class="grid-3"><div class="field"><label>Краткое название</label><input id="v600ShortName" value="${attr(c.shortName)}"></div><div class="field"><label>Полное юридическое название</label><input id="v600LegalName" value="${attr(c.legalName)}"></div><div class="field"><label>ИНН</label><input id="v600Inn" value="${attr(c.inn)}"></div><div class="field"><label>КПП</label><input id="v600Kpp" value="${attr(c.kpp)}"></div><div class="field"><label>ОГРН</label><input id="v600Ogrn" value="${attr(c.ogrn)}"></div><div class="field"><label>Телефон</label><input id="v600Phone" value="${attr(c.phone)}"></div><div class="field"><label>Доп. телефон</label><input id="v600Phone2" value="${attr(c.phone2)}"></div><div class="field"><label>E-mail</label><input id="v600Email" value="${attr(c.email)}"></div><div class="field"><label>Сайт</label><input id="v600Website" value="${attr(c.website)}"></div><div class="field"><label>Контактное лицо</label><input id="v600ContactPerson" value="${attr(c.contactPerson)}"></div><div class="field"><label>Режим работы</label><input id="v600WorkHours" value="${attr(c.workHours)}"></div><div class="field"><label>Юридический адрес</label><input id="v600LegalAddress" value="${attr(c.legalAddress)}"></div><div class="field span-2"><label>Фактический адрес</label><input id="v600ActualAddress" value="${attr(c.actualAddress)}"></div></div></section>
    <section class="span-2"><h4>Банковские реквизиты</h4><div class="grid-3"><div class="field"><label>Банк</label><input id="v600Bank" value="${attr(c.bank)}"></div><div class="field"><label>БИК</label><input id="v600Bik" value="${attr(c.bik)}"></div><div class="field"><label>Расчётный счёт</label><input id="v600Settlement" value="${attr(c.settlementAccount)}"></div><div class="field"><label>Корреспондентский счёт</label><input id="v600Corr" value="${attr(c.corrAccount)}"></div></div></section>
    <section><h4>Номер счёта</h4><div class="invoice-format-row"><div class="field"><label>Префикс, максимум 3 символа</label><input id="v600InvoicePrefix" maxlength="3" value="${attr(c.invoicePrefix)}" data-jf-oninput="this.value=this.value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3);previewInvoiceV600()"></div><div class="field"><label>Формат даты</label><select id="v600InvoiceDateFormat" data-jf-onchange="previewInvoiceV600()"><option value="DDMMYY" ${c.invoiceDateFormat==='DDMMYY'?'selected':''}>ДДММГГ</option><option value="YYMMDD" ${c.invoiceDateFormat==='YYMMDD'?'selected':''}>ГГММДД</option><option value="DDMMYYYY" ${c.invoiceDateFormat==='DDMMYYYY'?'selected':''}>ДДММГГГГ</option></select></div><div class="field"><label>Разделитель</label><select id="v600InvoiceSeparator" data-jf-onchange="previewInvoiceV600()"><option value="-" ${c.invoiceSeparator==='-'?'selected':''}>Дефис</option><option value="/" ${c.invoiceSeparator==='/'?'selected':''}>Косая черта</option><option value="" ${c.invoiceSeparator===''?'selected':''}>Без разделителя</option></select></div></div><div class="invoice-preview-v600">Следующий счёт: <b id="v600InvoicePreview"></b><span>При повторном счёте в ту же дату добавляется безопасный суффикс -02, -03.</span></div></section>
    <section><h4>Информация для клиента</h4><label class="checkline"><input id="v600PromoEnabled" type="checkbox" ${c.promoEnabled?'checked':''}> Показывать рекламный блок в документе</label><div class="field"><label>Заголовок</label><input id="v600PromoTitle" value="${attr(c.promoTitle)}"></div><div class="field"><label>Основной текст</label><textarea id="v600PromoText">${escape(c.promoText)}</textarea></div><div class="field"><label>Преимущество 1</label><input id="v600Promo1" value="${attr(c.promoBenefits?.[0]||'')}"></div><div class="field"><label>Преимущество 2</label><input id="v600Promo2" value="${attr(c.promoBenefits?.[1]||'')}"></div><div class="field"><label>Преимущество 3</label><input id="v600Promo3" value="${attr(c.promoBenefits?.[2]||'')}"></div><div class="field"><label>Призыв к действию</label><input id="v600PromoCta" value="${attr(c.promoCta)}"></div></section>
  </div><div class="company-save-footer"><span>Изменения применятся к интерфейсу сразу. Ранее созданные документы сохраняют снимок прежних реквизитов.</span><button class="btn-primary" data-jf-onclick="saveCompanySettingsV600()">Сохранить оформление</button></div>`;
  previewInvoiceV600()
}
function input(id){return $id(id)?.value?.trim()||''}
window.previewInvoiceV600=function(){const c=settings.company||companyDefaults(),prefix=safePrefix(input('v600InvoicePrefix')||c.invoicePrefix)||'СЧ',fmt=$id('v600InvoiceDateFormat')?.value||c.invoiceDateFormat,sep=$id('v600InvoiceSeparator')?.value??c.invoiceSeparator,el=$id('v600InvoicePreview');if(el)el.textContent=prefix+sep+formatInvoiceDate(Date.now(),fmt)};
window.saveCompanySettingsV600=function(){
  const prefix=safePrefix(input('v600InvoicePrefix'));if(!prefix){alert('Укажите префикс счёта: от 1 до 3 букв или цифр.');return}
  settings.company={...settings.company,programName:input('v600ProgramName')||'Заказы и логистика',programSubtitle:input('v600ProgramSubtitle'),shortName:input('v600ShortName'),legalName:input('v600LegalName'),inn:input('v600Inn'),kpp:input('v600Kpp'),ogrn:input('v600Ogrn'),legalAddress:input('v600LegalAddress'),actualAddress:input('v600ActualAddress'),phone:input('v600Phone'),phone2:input('v600Phone2'),email:input('v600Email'),website:input('v600Website'),contactPerson:input('v600ContactPerson'),workHours:input('v600WorkHours'),bank:input('v600Bank'),bik:input('v600Bik'),settlementAccount:input('v600Settlement'),corrAccount:input('v600Corr'),showLogoInApp:!!$id('v600LogoApp')?.checked,showLogoInDocuments:!!$id('v600LogoDocs')?.checked,logoPosition:['left','center','right'].includes($id('v600LogoPosition')?.value)?$id('v600LogoPosition').value:'left',invoicePrefix:prefix,invoiceDateFormat:$id('v600InvoiceDateFormat')?.value||'DDMMYY',invoiceSeparator:$id('v600InvoiceSeparator')?.value??'-',invoiceDailySequence:true,promoEnabled:!!$id('v600PromoEnabled')?.checked,promoTitle:input('v600PromoTitle'),promoText:input('v600PromoText'),promoBenefits:[input('v600Promo1'),input('v600Promo2'),input('v600Promo3')],promoCta:input('v600PromoCta')};
  persistSettings();applyBranding();renderCompanySettings();alert('Настройки компании, программы и документов сохранены только для склада «'+(active()?.name||'Склад')+'».')
};
window.chooseCompanyLogoV600=function(){$id('v600LogoInput')?.click()};
window.loadCompanyLogoV600=function(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(String(file.type||'').toLowerCase())){alert('Разрешены только изображения PNG, JPEG или WebP.');return}if(file.size>3*1024*1024){alert('Файл слишком большой. Выберите логотип до 3 МБ.');return}const img=new Image(),reader=new FileReader();reader.onerror=()=>alert('Не удалось прочитать файл логотипа.');reader.onload=()=>{img.onerror=()=>alert('Файл не является корректным изображением.');img.onload=()=>{const max=1000,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const encoded=safeLogoDataUrl(canvas.toDataURL('image/webp',.88));if(!encoded){alert('Не удалось безопасно подготовить логотип.');return}settings.company.logoDataUrl=encoded;persistSettings();renderCompanySettings();applyBranding()};img.src=String(reader.result||'')};reader.readAsDataURL(file)};
window.removeCompanyLogoV600=function(){settings.company.logoDataUrl='';persistSettings();renderCompanySettings();applyBranding()};

let warehouseEditorMapV600=null,warehouseEditorMarkerV600=null,warehouseEditorCandidatesV600=[],warehouseAddressSearchSerialV600=0;
function warehouseEditorStatusV600(text,state='info'){const el=$id('warehouseLocationStatusV600');if(el){el.className=`notice warehouse-location-status ${state==='ok'?'notice-ok':state==='error'?'notice-danger':'notice-warn'}`;el.textContent=text}}
function setWarehouseEditorPointV600(point,move=true){const lat=Number(point?.lat),lon=Number(point?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return false;warehouseAddressSearchSerialV600++;$id('warehouseLatV600').value=lat.toFixed(6);$id('warehouseLonV600').value=lon.toFixed(6);if(point.displayName)$id('warehouseAddressV600').value=point.displayName;if(warehouseEditorMapV600){warehouseEditorMarkerV600.setLatLng([lat,lon]);if(move)warehouseEditorMapV600.setView([lat,lon],16)}warehouseEditorStatusV600(`Точка склада подтверждена: ${$id('warehouseAddressV600').value}`,'ok');$id('warehouseLocationResultsV600').innerHTML='';return true}
function ensureWarehouseEditorMapV600(){const container=$id('warehouseLocationMapV600');if(!container||!window.L){warehouseEditorStatusV600('Карта недоступна. Проверьте подключение картографического модуля.','error');return false}const lat=Number($id('warehouseLatV600').value),lon=Number($id('warehouseLonV600').value),ready=Number.isFinite(lat)&&Number.isFinite(lon),center=ready?[lat,lon]:[59.9343,30.3351];if(!warehouseEditorMapV600){warehouseEditorMapV600=L.map(container,{attributionControl:false}).setView(center,ready?15:9);addTileLayer(warehouseEditorMapV600);warehouseEditorMarkerV600=L.marker(center,{draggable:true,icon:numberedIcon('С','depot-marker')}).addTo(warehouseEditorMapV600);const update=async point=>{warehouseEditorMarkerV600.setLatLng(point);warehouseEditorStatusV600('Определяю адрес выбранной точки…');try{const result=await reverseGeocode(point.lat,point.lng);setWarehouseEditorPointV600({lat:point.lat,lon:point.lng,displayName:result.display_name||'Точка на карте'},false)}catch{setWarehouseEditorPointV600({lat:point.lat,lon:point.lng,displayName:$id('warehouseAddressV600').value||'Точка на карте'},false);warehouseEditorStatusV600('Точка сохранена, но адрес не удалось уточнить. Проверьте строку адреса.','info')}};warehouseEditorMarkerV600.on('dragend',()=>update(warehouseEditorMarkerV600.getLatLng()));warehouseEditorMapV600.on('click',event=>update(event.latlng))}else{warehouseEditorMapV600.setView(center,ready?15:9);warehouseEditorMarkerV600.setLatLng(center)}setTimeout(()=>warehouseEditorMapV600?.invalidateSize(),80);return true}
window.invalidateWarehouseAddressSearchV600=function(){warehouseAddressSearchSerialV600++;warehouseEditorCandidatesV600=[];const button=$id('warehouseSearchButtonV600');if(button)button.disabled=false};
window.searchWarehouseAddressV600=async function(){const query=input('warehouseAddressV600'),requestSerial=++warehouseAddressSearchSerialV600,button=$id('warehouseSearchButtonV600');if(query.length<4)return warehouseEditorStatusV600('Введите адрес подробнее: город, улица и номер дома.','error');button.disabled=true;warehouseEditorStatusV600('Ищу адрес…');try{const candidates=await geocodeSearch(query);if(requestSerial!==warehouseAddressSearchSerialV600)return;warehouseEditorCandidatesV600=candidates;const box=$id('warehouseLocationResultsV600');if(!warehouseEditorCandidatesV600.length){box.innerHTML='';warehouseEditorStatusV600('Адрес не найден. Уточните запрос или выберите точку на карте.','error');return}box.innerHTML=warehouseEditorCandidatesV600.slice(0,5).map((item,index)=>`<button type="button" class="geo-result" data-jf-onclick="selectWarehouseAddressV600(${index})"><b>${escape(item.display_name||'Найденная точка')}</b><small>Выбрать этот адрес</small></button>`).join('');warehouseEditorStatusV600(`Найдено вариантов: ${Math.min(5,warehouseEditorCandidatesV600.length)}. Выберите точный адрес.`)}catch(error){if(requestSerial===warehouseAddressSearchSerialV600)warehouseEditorStatusV600(`Поиск адреса недоступен: ${error?.message||error}`,'error')}finally{if(requestSerial===warehouseAddressSearchSerialV600)button.disabled=false}};
window.selectWarehouseAddressV600=function(index){const item=warehouseEditorCandidatesV600[index];if(!item)return;setWarehouseEditorPointV600({lat:item.lat,lon:item.lon,displayName:item.display_name||''})};
function ensureWarehouseModal(){if($id('warehouseEditorModalV600'))return;const modal=document.createElement('div');modal.id='warehouseEditorModalV600';modal.className='modal';modal.innerHTML=`<div class="modal-box warehouse-editor-box"><div class="modal-head"><div><div class="modal-title" id="warehouseEditorTitleV600">Новый склад</div><div class="muted">Укажите адрес и подтвердите точку погрузки на карте. Координаты система сохранит сама.</div></div><button class="btn-gray" data-jf-onclick="closeWarehouseEditorV600()">Закрыть</button></div><form id="warehouseEditorFormV600" data-jf-onsubmit="saveWarehouseEditorV600(event)"><div class="modal-body"><input id="warehouseEditIdV600" type="hidden"><input id="warehouseLatV600" type="hidden"><input id="warehouseLonV600" type="hidden"><div class="grid-3"><div class="field"><label>Название склада</label><input id="warehouseNameV600" required maxlength="80"></div><div class="field"><label>Короткий код</label><input id="warehouseCodeV600" required maxlength="3" aria-describedby="warehouseCodeHelpV600" data-jf-oninput="this.value=this.value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)"><small id="warehouseCodeHelpV600">Код задаётся один раз и защищает права доступа.</small></div><div class="field"><label>Часовой пояс</label><input value="Москва · UTC+3" disabled></div></div><section class="warehouse-location-picker"><div class="field"><label>Найти адрес склада</label><div class="warehouse-location-search"><input id="warehouseAddressV600" placeholder="Например: Санкт-Петербург, Софийская улица, 60" data-jf-oninput="invalidateWarehouseAddressSearchV600()"><button class="btn-soft" id="warehouseSearchButtonV600" type="button" data-jf-onclick="searchWarehouseAddressV600()">Найти</button></div></div><div id="warehouseLocationResultsV600" class="warehouse-location-results"></div><div id="warehouseLocationStatusV600" class="notice warehouse-location-status">Найдите адрес или поставьте маркер на карте.</div><div id="warehouseLocationMapV600" class="warehouse-location-map" aria-label="Карта выбора точки склада"></div></section><label class="warehouse-copy-option" id="warehouseCopyOptionV600"><input id="warehouseCopySettingsV600" type="checkbox" checked><span><b>Скопировать только безопасные настройки</b><small>Маршрутные правила, оформление и реквизиты. Заказы, товары, остатки, водители, рейсы и отчёты не копируются.</small></span></label><div class="warehouse-telegram-next"><b>Telegram подключается отдельно</b><span>Сначала сохраните склад. Настроить бота и группу можно позже в настройках этого склада.</span></div></div><div class="modal-foot"><button class="btn-gray" type="button" data-jf-onclick="closeWarehouseEditorV600()">Отмена</button><button class="btn-primary" type="submit">Сохранить склад</button></div></form></div>`;document.body.appendChild(modal)}
async function runWarehouseTelegramActionV600(action,pendingText){const field=$id('warehouseTelegramStatusV600'),buttons=[...($id('warehouseTelegramPanelV600')?.querySelectorAll('button')||[])];buttons.forEach(button=>button.disabled=true);if(field)field.textContent=pendingText;try{const api=window.JustFunTelegramSettingsV783;if(!api)throw new Error('Модуль Telegram ещё не загружен. Закройте окно и повторите проверку.');await action(api);await window.refreshWarehouseTelegramV600()}catch(error){if(field)field.textContent=`Ошибка: ${error?.message||error}`}finally{buttons.forEach(button=>button.disabled=false)}}
function warehouseTelegramPanelV600(isNew=false){const host=$id('warehouseEditorModalV600')?.querySelector('.warehouse-telegram-next');if(!host)return;host.id='warehouseTelegramPanelV600';if(isNew){host.innerHTML='<b>Telegram подключается отдельно</b><span>Сначала сохраните независимый склад. Бота и группу можно настроить позже; отсутствие Telegram не блокирует работу склада.</span>';return}host.innerHTML=`<div><b>Telegram этого склада</b><span id="warehouseTelegramStatusV600">Проверяю подключение…</span></div><div class="inline-actions"><button class="btn-primary" type="button" id="warehouseTelegramConfigureV600">Настроить бота</button><button class="btn-soft" type="button" id="warehouseTelegramGroupV600">Подключить группу</button><button class="btn-gray" type="button" id="warehouseTelegramCheckV600">Проверить</button></div>`;$id('warehouseTelegramConfigureV600').onclick=()=>runWarehouseTelegramActionV600(api=>api.configure(),'Открываю защищённый мастер Telegram…');$id('warehouseTelegramGroupV600').onclick=()=>runWarehouseTelegramActionV600(api=>api.bindWarehouse(),'Создаю приглашение для группы склада…');$id('warehouseTelegramCheckV600').onclick=()=>runWarehouseTelegramActionV600(()=>Promise.resolve(),'Проверяю подключение…');window.refreshWarehouseTelegramV600()}
window.refreshWarehouseTelegramV600=async function(){const field=$id('warehouseTelegramStatusV600');if(!field)return;field.textContent='Проверяю подключение…';try{const info=await window.JustFunTelegramSettingsV783?.warehouseInfo?.(),status=info?.status||{},binding=info?.binding,checked=status.checkedAt?new Date(status.checkedAt).toLocaleString('ru-RU'):'ещё не проверено';field.textContent=status.configured?`Бот @${status.botUsername||'имя не получено'} · группа ${binding?(binding.title||binding.username||'подключена'):'не подключена'} · проверка ${checked}${status.online?'':' · требуется восстановление'}${status.lastError?` · ${status.lastError}`:''}`:`Бот не подключён · проверка ${checked}`}catch(error){field.textContent=`Проверка не выполнена: ${error?.message||error}`}};
window.openWarehouseCreatorV600=function(){if(!canCreateWarehouseV760()){alert('Создать склад может владелец или администратор с доступом ко всем складам.');return false}ensureWarehouseModal();warehouseTelegramPanelV600(true);const hasSource=Boolean(active());$id('warehouseEditorFormV600').reset();$id('warehouseEditIdV600').value='';$id('warehouseEditorTitleV600').textContent='Добавить независимый склад';$id('warehouseCodeV600').readOnly=false;$id('warehouseCodeV600').value='';$id('warehouseCodeHelpV600').textContent='Код задаётся при создании один раз и затем не изменяется.';$id('warehouseAddressV600').value='';$id('warehouseLatV600').value='';$id('warehouseLonV600').value='';$id('warehouseCopySettingsV600').checked=hasSource;$id('warehouseCopyOptionV600').style.display=hasSource?'flex':'none';$id('warehouseEditorModalV600').classList.add('open');warehouseEditorStatusV600('Найдите адрес или поставьте маркер на карте.');setTimeout(ensureWarehouseEditorMapV600,40);return true};
window.openWarehouseEditorV600=function(){ensureWarehouseModal();warehouseTelegramPanelV600(false);const w=active();$id('warehouseEditIdV600').value=w.id;$id('warehouseEditorTitleV600').textContent='Настройки текущего склада';$id('warehouseNameV600').value=w.name;$id('warehouseCodeV600').value=w.code;$id('warehouseCodeV600').readOnly=true;$id('warehouseCodeHelpV600').textContent='Код защищает права сотрудников и после создания не изменяется.';$id('warehouseAddressV600').value=settings.warehouse?.address||w.address||'';$id('warehouseLatV600').value=settings.warehouse?.lat??w.lat??'';$id('warehouseLonV600').value=settings.warehouse?.lon??w.lon??'';$id('warehouseCopyOptionV600').style.display='none';$id('warehouseEditorModalV600').classList.add('open');warehouseEditorStatusV600(validRouteStart({address:$id('warehouseAddressV600').value,lat:$id('warehouseLatV600').value,lon:$id('warehouseLonV600').value})?'Текущая точка склада подтверждена.':'Найдите адрес или поставьте маркер на карте.',validRouteStart({address:$id('warehouseAddressV600').value,lat:$id('warehouseLatV600').value,lon:$id('warehouseLonV600').value})?'ok':'info');setTimeout(ensureWarehouseEditorMapV600,40)};
window.closeWarehouseEditorV600=function(){window.invalidateWarehouseAddressSearchV600();$id('warehouseEditorModalV600')?.classList.remove('open')};
function initializeEmptyWarehouse(w,copySettings){
  const nextSettings=copySettings?clone(settings):clone(DEFAULTS),warehouse={address:String(w.address||''),lat:w.lat==null?null:Number(w.lat),lon:w.lon==null?null:Number(w.lon)};nextSettings.warehouse=warehouse;nextSettings.warehouseProfile={id:w.id,code:w.code,name:w.name,timezone:'Europe/Moscow',routeStartConfigured:validRouteStart(warehouse)};nextSettings.company=copySettings?clone(settings.company):companyDefaults();nextSettings.company.invoicePrefix=w.code;
  const write=(key,value,env='live')=>B.raw.set(B.dataKey(key,env,w.id),JSON.stringify(value));
  write(SETTINGS_KEY,nextSettings);write(STORAGE_KEY,[]);write(PRODUCTS_KEY,[]);write(INVENTORY_MOVEMENTS_KEY,[]);write(DRIVERS_KEY,[]);for(const key of [ROUTES_KEY,ROUTE_ASSIGNMENTS_KEY,ROUTE_CATALOG_KEY,ROUTE_DRIVERS_KEY,ROUTE_LOCKS_KEY,REPORTING_KEY,ROUTE_OVERRIDES_KEY,ROUTE_EXECUTIONS_KEY,WAREHOUSE_RESERVATIONS_KEY])write(key,{});write(ROUTE_ARCHIVE_KEY,[]);return nextSettings
}
function repairLegacySeededCatalog(){
  if(isDemonstrationMode()||active()?.catalogMode!=='empty')return 0;
  const builtinArticles=new Set(asArray(typeof BUILTIN_CATALOG==='undefined'?[]:BUILTIN_CATALOG).map(item=>normalizeText(item?.article||'')).filter(Boolean));
  const removedIds=new Set(),kept=[];
  for(const product of products){
    const id=String(product?.id||''),article=normalizeText(product?.article||''),isBuiltin=(id.startsWith('catalog-')||builtinArticles.has(article))&&product?.catalogManaged===true;
    if(isBuiltin)removedIds.add(id);else kept.push(product)
  }
  if(!removedIds.size)return 0;
  products=kept;
  inventoryMovements=inventoryMovements.filter(movement=>!removedIds.has(String(movement?.productId||'')));
  persistProducts();persistInventoryMovements();
  B.raw.set(B.systemKey('empty_catalog_repair_v783'),JSON.stringify({at:nowIso(),removed:removedIds.size,reason:'builtin_catalog_isolated_to_primary_warehouse'}));
  return removedIds.size;
}
async function persistWarehouseRegistryV760(record,{deleted=false,...options}={}){
  const storage=window.JustFunServerStorageV3,operation=deleted?storage?.deleteWarehouse:storage?.writeWarehouse;
  if(typeof operation!=='function')throw new Error('Защищённое хранилище складов ещё не готово. Повторите действие после подключения к VPS.');
  return operation(record,options)
}
function applyConfirmedWarehouseVersionV760(record,result){
  const version=Number(result?.version);if(Number.isSafeInteger(version)&&version>=0)record.revision=version;
  if(result?.skipped!==true)record.origin='server';return record
}
async function refreshAuthoritativeWarehouseRegistryV760(action,{warehouseId='',deleted=false,status='',code=''}={}){
  const refresh=window.JustFunWarehouseRegistryV783?.refresh;if(typeof refresh!=='function')throw new Error(`Сервер подтвердил ${action}, но модуль обновления реестра недоступен.`);
  await refresh();const latest=B.getRegistry(),record=latest.warehouses.find(item=>String(item.id)===String(warehouseId));
  if(deleted&&record)throw new Error(`Сервер подтвердил ${action}, но удалённый склад всё ещё присутствует в актуальном реестре.`);
  if(!deleted&&warehouseId&&!record)throw new Error(`Сервер подтвердил ${action}, но склад отсутствует в актуальном реестре.`);
  if(record&&status&&String(record.status)!==String(status))throw new Error(`Сервер вернул другой статус склада после операции «${action}».`);
  if(record&&code&&safePrefix(record.code)!==safePrefix(code))throw new Error('Сервер вернул другой код склада. Обновите рабочее пространство.');
  return{registry:latest,record}
}
let warehouseLifecycleBusyV760=false;
async function withWarehouseLifecycleLockV760(action){
  if(warehouseLifecycleBusyV760){alert('Операция со складом уже выполняется. Дождитесь подтверждения сервера.');return false}
  warehouseLifecycleBusyV760=true;
  try{return await action()}finally{warehouseLifecycleBusyV760=false}
}
function refreshWarehouseCacheAfterCommitFailureV760(action,error){
  console.error(`VPS подтвердил ${action}, но локальный кэш не обновился`,error);
  alert(`Сервер подтвердил ${action}, но локальный кэш требует обновления. Программа перезагрузит список складов.`);
  if(window.__JF_TEST_NO_RELOAD)window.__jfWarehouseRefreshRequiredV760=action;
  else setTimeout(()=>location.reload(),350)
}
window.saveWarehouseEditorV600=async function(event){event.preventDefault();const id=input('warehouseEditIdV600'),name=input('warehouseNameV600'),code=safePrefix(input('warehouseCodeV600')),address=input('warehouseAddressV600'),latRaw=$id('warehouseLatV600').value.trim(),lonRaw=$id('warehouseLonV600').value.trim(),lat=latRaw===''?null:Number(latRaw),lon=lonRaw===''?null:Number(lonRaw);if(!name||!code){alert('Укажите название и короткий код склада.');return}if(!validRouteStart({address,lat,lon})){alert('Подтвердите адрес и точку погрузки: найдите адрес или поставьте маркер на карте.');warehouseEditorStatusV600('Точка склада не подтверждена.','error');return}const r=B.getRegistry();if(r.warehouses.some(w=>w.id!==id&&w.code===code)){alert('Такой код склада уже используется.');return}
  if(!id&&!canCreateWarehouseV760()){alert('Создать склад может владелец или администратор с доступом ко всем складам.');return false}
  return withWarehouseLifecycleLockV760(async()=>{
    if(id){
      const w=r.warehouses.find(x=>x.id===id);if(!w){alert('Склад не найден. Обновите список и повторите действие.');return false}if(code!==safePrefix(w.code)){alert('Код существующего склада нельзя изменять: он защищает права доступа.');return false}
      const next={...w,name,code,address,lat,lon,updatedAt:nowIso()};
      let committed=false,canonical=null;try{const result=await persistWarehouseRegistryV760(next);applyConfirmedWarehouseVersionV760(next,result);committed=result?.skipped!==true;if(committed)canonical=(await refreshAuthoritativeWarehouseRegistryV760('изменение склада',{warehouseId:id,status:next.status,code})).record;else{Object.assign(w,next);B.saveRegistry(r);canonical=next}}catch(error){if(committed){refreshWarehouseCacheAfterCommitFailureV760('изменение склада',error);return false}console.error('Хранилище не подтвердило изменение склада',error);alert(`Склад не изменён: ${error?.message||error}`);return false}
      try{settings.warehouse={address:String(canonical.address||''),lat:canonical.lat==null?null:Number(canonical.lat),lon:canonical.lon==null?null:Number(canonical.lon)};settings.warehouseProfile={id,code:canonical.code,name:canonical.name,timezone:String(canonical.timezone||'Europe/Moscow'),routeStartConfigured:validRouteStart(canonical)};if(!settings.company.invoicePrefix)settings.company.invoicePrefix=canonical.code;persistSettings();closeWarehouseEditorV600();applyBranding();installSettingsPanels();renderSettings()}catch(error){refreshWarehouseCacheAfterCommitFailureV760('изменение склада',error);return false}
      alert('Адрес и точка склада сохранены. Новые маршруты используют обновлённое начало и завершение рейса.');return true
    }
    const w=B.createWarehouseRecord({name,code,address,lat,lon}),copySettings=Boolean(active())&&!!$id('warehouseCopySettingsV600')?.checked,createdKeys=[],previousActiveWarehouseId=r.activeWarehouseId;let serverWrite=null,serverCommitted=false;
    try{
      const initialSettings=initializeEmptyWarehouse(w,copySettings);
      const required=[SETTINGS_KEY,STORAGE_KEY,PRODUCTS_KEY,INVENTORY_MOVEMENTS_KEY,DRIVERS_KEY,ROUTES_KEY,REPORTING_KEY];
      for(const key of required){const scoped=B.dataKey(key,'live',w.id);createdKeys.push(scoped);if(B.raw.get(scoped)===null)throw new Error(`Не создан обязательный раздел: ${key}`);JSON.parse(B.raw.get(scoped))}
      serverWrite=await persistWarehouseRegistryV760(w,{initialSettings,initialCompany:initialSettings.company});applyConfirmedWarehouseVersionV760(w,serverWrite);
      serverCommitted=serverWrite?.skipped!==true;
      if(serverCommitted){const refreshed=await refreshAuthoritativeWarehouseRegistryV760('создание склада',{warehouseId:w.id,status:'active',code:w.code});Object.assign(w,refreshed.record)}else{const local=B.getRegistry();local.warehouses.push(w);B.saveRegistry(local)}
      B.setActive(w.id);try{window.recordAuditEventV601?.('warehouse_created',{warehouseId:w.id,code:w.code,name:w.name,telegramSetupRequired:false,storageMode:serverCommitted?'server':'local'})}catch{}if(window.__JF_TEST_NO_RELOAD){window.__jfCreatedWarehouseV750=w;closeWarehouseEditorV600();return true}location.reload();return true
    }catch(error){
      if(serverCommitted){refreshWarehouseCacheAfterCommitFailureV760('создание склада',error);return false}
      try{const rollback=B.getRegistry();rollback.warehouses=rollback.warehouses.filter(item=>String(item.id)!==String(w.id));rollback.activeWarehouseId=previousActiveWarehouseId;if(!rollback.warehouses.length&&rollback.serverRegistryInitialized===true)rollback.serverAuthoritativeEmpty=true;B.saveRegistry(rollback)}catch(registryError){console.error('Не удалось откатить локальный реестр складов',registryError)}
      try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.startsWith(`${B.prefix}${w.id}__`))B.raw.remove(key)}}catch(cleanupError){console.error('Не удалось полностью удалить временные данные склада',cleanupError)}
      console.error('Создание склада отменено до подтверждённой серверной фиксации',error);alert('Склад не создан: сервер или локальное хранилище не подтвердили операцию. Данные текущего склада не изменены.');return false
    }
  })
};
window.switchWarehouseV600=async function(id){
  if(id===activeId()||window.__jfWarehouseSwitchInProgress)return;
  const target=B.getRegistry().warehouses.find(w=>w.id===id);
  if(!target||target.status==='archived'){alert('Этот склад недоступен.');return}
  const openModal=document.querySelector('.modal.open');
  if(openModal&&!await jfConfirm('Открыто окно редактирования. Несохранённые изменения будут закрыты. Переключить склад?',{title:'Закрыть несохранённое окно'}))return;
  if(!await jfConfirm(`Переключиться на склад «${target.name}»?\n\nПрограмма сохранит текущую базу и полностью перезагрузит рабочее пространство.`,{title:'Переключение склада',confirmLabel:'Переключить'}))return;
  window.__jfWarehouseSwitchInProgress=true;
  try{
    persistEverything();
    const persisted=await ordersPersistChain;
    if(persisted===false||window.__warehousePersistenceCritical)throw new Error('Текущая база не подтверждена на диске');
    if(window.JustFunEntitySyncV783?.flushAndConfirm)await window.JustFunEntitySyncV783.flushAndConfirm();
    B.setActive(id);
    if(window.__JF_TEST_NO_RELOAD){window.__jfSwitchedWarehouseV783=id;return}
    location.reload();
  }catch(error){
    window.__jfWarehouseSwitchInProgress=false;
    console.error('Переключение склада остановлено',error);
    alert(`Склад не переключён: ${error?.message||error}. Текущие данные оставлены открытыми.`)
  }
};
window.toggleWarehouseArchiveV600=async function(id){const r=B.getRegistry(),w=r.warehouses.find(x=>x.id===id);if(!w||w.id===r.activeWarehouseId)return false;return withWarehouseLifecycleLockV760(async()=>{const archive=w.status!=='archived';if(archive&&!await jfConfirm(`Перевести склад «${w.name}» в архив? Его данные не удалятся, но открыть его для работы будет нельзя.`,{title:'Архивация склада',confirmLabel:'В архив'}))return false;const next={...w,status:archive?'archived':'active',updatedAt:nowIso()},action=archive?'архивацию склада':'возврат склада из архива';let committed=false;try{const result=await persistWarehouseRegistryV760(next);applyConfirmedWarehouseVersionV760(next,result);committed=result?.skipped!==true;if(committed)await refreshAuthoritativeWarehouseRegistryV760(action,{warehouseId:id,status:next.status,code:next.code});else{Object.assign(w,next);B.saveRegistry(r)}}catch(error){if(committed){refreshWarehouseCacheAfterCommitFailureV760(action,error);return false}console.error('Хранилище не подтвердило изменение статуса склада',error);alert(`Статус склада не изменён: ${error?.message||error}`);return false}try{installSettingsPanels()}catch(error){if(committed)refreshWarehouseCacheAfterCommitFailureV760(action,error);else console.error('Не удалось обновить список складов',error);return false}return true})};
window.deleteWarehouseV760=async function(id){
  if(!canDeleteWarehouseV760()){alert('Удалить склад может только владелец или администратор с доступом ко всем складам.');return false}const r=B.getRegistry(),w=r.warehouses.find(x=>String(x.id)===String(id));if(!w||w.id===r.activeWarehouseId){alert('Активный склад удалять нельзя. Сначала переключитесь на другой склад.');return}if(w.status!=='archived'){alert('Сначала переведите склад в архив.');return}
  return withWarehouseLifecycleLockV760(async()=>{
    if(!await jfConfirm(`Удалить рабочие данные склада «${w.name}»?\n\nДанные LIVE и DEMO, а также содержимое истории событий будут удалены. Минимальный технический аудит и резервные копии могут сохраняться по установленной политике хранения. Остальные склады не будут затронуты.`,{title:'Удаление склада',confirmLabel:'Продолжить',kind:'danger'}))return false;
    const typed=await jfPrompt(`Для подтверждения введите код склада: ${w.code}`,'',{title:'Подтверждение удаления',inputLabel:'Код склада',confirmLabel:'Удалить склад',kind:'danger'});if(String(typed||'').trim().toUpperCase()!==String(w.code).toUpperCase()){alert('Код не совпал. Удаление отменено.');return false}
    let serverDelete;try{serverDelete=await persistWarehouseRegistryV760(w,{deleted:true})}catch(error){console.error('VPS не подтвердил удаление склада',error);alert(`Склад не удалён: ${error?.message||error}`);return false}
    try{await refreshAuthoritativeWarehouseRegistryV760('удаление склада',{warehouseId:w.id,deleted:true})}catch(error){refreshWarehouseCacheAfterCommitFailureV760('удаление склада',error);return false}
    const prefix=`${B.prefix}${w.id}__`;let removed=0,cleanupFailed=false;
    try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.startsWith(prefix)){B.raw.remove(key);removed++}}}catch(error){cleanupFailed=true;console.error('Не полностью очищен локальный кэш склада',error)}
    if(typeof indexedDB!=='undefined'){for(const env of ['live','demo'])await new Promise(resolve=>{try{const req=indexedDB.deleteDatabase(`orders_teplitsa_large_v1__${w.id}__${env}`);req.onsuccess=()=>resolve();req.onerror=req.onblocked=()=>{cleanupFailed=true;resolve()}}catch{cleanupFailed=true;resolve()}})}
    const telegramCleanupPending=serverDelete?.telegram_local_cleanup_pending===true;
    try{window.recordAuditEventV601?.('warehouse_deleted',{warehouseId:w.id,code:w.code,removedKeys:removed,cascadeDeleted:Number(serverDelete?.cascade_deleted)||0,historyPayloadsRedacted:Number(serverDelete?.history_payloads_redacted)||0,telegramDeprovisioned:serverDelete?.telegram_deprovisioned===true,telegramLocalCleanupPending:telegramCleanupPending,localCleanupComplete:!cleanupFailed})}catch{}if(active())installSettingsPanels();else window.JustFunWarehouseRegistryV783?.showNoWarehouse?.('Сервер подтвердил удаление последнего склада.');alert(cleanupFailed||telegramCleanupPending?`Рабочие данные и Telegram склада «${w.name}» отключены. Часть локального кэша будет автоматически дочищена программой. Минимальный технический аудит и резервные копии сохраняются по политике хранения.`:`Рабочие данные, Telegram и локальный кэш склада «${w.name}» удалены. Минимальный технический аудит и резервные копии сохраняются по политике хранения.`);return true
  })
};

function decoratePrintedDocument(order){const sheet=$id('printArea')?.querySelector('.print-order-sheet');if(!sheet||!order)return;const snap=order.documentSnapshot||documentSnapshot(),c=snap.company||settings.company||companyDefaults(),w=snap.warehouse||active();const brand=sheet.querySelector('.print-brand'),docNumber=sheet.querySelector('.print-doc-number');if(docNumber)docNumber.textContent=`Счёт № ${order.invoiceNumber||order.number}`;sheet.querySelector('.print-doc-status')?.remove();sheet.querySelectorAll('.print-section').forEach(section=>{if(/инструкция комплектовщику|инструкция.*водител/i.test(section.querySelector('.print-section-title')?.textContent||''))section.remove()});
  if(brand){const customLogo=safeLogoDataUrl(c.logoDataUrl),logoSrc=c.showLogoInDocuments===false?'':(customLogo||'assets/justfun-official-transparent.png');brand.classList.remove('logo-center-v600','logo-right-v600');if(c.logoPosition==='center')brand.classList.add('logo-center-v600');else if(c.logoPosition==='right')brand.classList.add('logo-right-v600');brand.innerHTML=`${logoSrc?`<img class="print-company-logo-v600" src="${attr(logoSrc)}" alt="Логотип">`:''}<div><div class="print-brand-name">${escape(c.shortName||c.programName||'Заказы и логистика')}</div><div class="print-brand-sub">${escape(w.name||'Склад')} · ${escape(w.address||'')}</div></div>`;}
  const groups=[
    {title:'Организация',lines:[c.legalName,[c.inn?`ИНН ${c.inn}`:'',c.kpp?`КПП ${c.kpp}`:'',c.ogrn?`ОГРН ${c.ogrn}`:''].filter(Boolean).join(' · ')]},
    {title:'Адреса',lines:[c.legalAddress?`Юридический: ${c.legalAddress}`:'',c.actualAddress?`Фактический: ${c.actualAddress}`:'']},
    {title:'Банк',lines:[c.bank,[c.bik?`БИК ${c.bik}`:'',c.settlementAccount?`р/с ${c.settlementAccount}`:'',c.corrAccount?`к/с ${c.corrAccount}`:''].filter(Boolean).join(' · ')]},
    {title:'Связь',lines:[[c.phone,c.phone2,c.email,c.website].filter(Boolean).join(' · '),c.contactPerson?`Контакт: ${c.contactPerson}`:'',c.workHours?`Режим: ${c.workHours}`:'']}
  ].map(group=>({...group,lines:group.lines.filter(Boolean)})).filter(group=>group.lines.length);if(groups.length){const info=document.createElement('div');info.className='print-company-info-v600 print-company-info-grid-v783';info.innerHTML=groups.map(group=>`<section><b>${escape(group.title)}</b>${group.lines.map(line=>`<span>${escape(line)}</span>`).join('')}</section>`).join('');sheet.querySelector('.print-header')?.insertAdjacentElement('afterend',info)}
  if(c.promoEnabled&&(c.promoTitle||c.promoText||c.promoBenefits?.some(Boolean))){const promo=document.createElement('div');promo.className='print-promo-v600';promo.innerHTML=`<span class="print-promo-label-v783">Предложение для клиента</span><b>${escape(c.promoTitle||'Информация для клиента')}</b>${c.promoText?`<p>${escape(c.promoText)}</p>`:''}${c.promoBenefits?.filter(Boolean).length?`<div>${c.promoBenefits.filter(Boolean).map(x=>`<span>✓ ${escape(x)}</span>`).join('')}</div>`:''}${c.promoCta?`<small>${escape(c.promoCta)}</small>`:''}`;const footnote=sheet.querySelector('.print-footnote');if(footnote)footnote.insertAdjacentElement('afterend',promo);else sheet.append(promo)}
}
function decoratePrintedRoute(){
  const sheet=$id('printArea')?.querySelector('.print-route-sheet');if(!sheet)return;const c=settings.company||companyDefaults(),w=active(),brand=sheet.querySelector('.print-brand');
  if(brand){const customLogo=safeLogoDataUrl(c.logoDataUrl),logoSrc=c.showLogoInDocuments===false?'':(customLogo||'assets/justfun-official-transparent.png');brand.classList.remove('logo-center-v600','logo-right-v600');if(c.logoPosition==='center')brand.classList.add('logo-center-v600');else if(c.logoPosition==='right')brand.classList.add('logo-right-v600');brand.innerHTML=`${logoSrc?`<img class="print-company-logo-v600" src="${attr(logoSrc)}" alt="Логотип">`:''}<div><div class="print-brand-name">${escape(c.shortName||c.programName||'JustFun')}</div><div class="print-brand-sub">Маршрутный лист · ${escape(w?.name||'Склад')}</div></div>`}
  const contact=[c.phone,c.email,c.website].filter(Boolean).join(' · ');if(contact&&!sheet.querySelector('.print-company-info-v600')){const info=document.createElement('div');info.className='print-company-info-v600';info.innerHTML=`<div>${escape(contact)}</div>`;sheet.querySelector('.print-header')?.insertAdjacentElement('afterend',info)}
  sheet.querySelectorAll('.driver-payment-breakdown,.print-payment-breakdown').forEach(node=>node.remove());sheet.querySelectorAll('.print-section').forEach(section=>{const title=section.querySelector('.print-section-title')?.textContent||'';if(/расч[её]т оплаты водителя|состав начисления/i.test(title))section.remove()});
}
function decoratePrintedReport(){
  const sheet=$id('printArea')?.querySelector('.print-route-sheet');if(!sheet)return;const c=settings.company||companyDefaults(),name=c.shortName||c.programName||'JustFun',header=sheet.querySelector('.print-header'),brand=header?.firstElementChild,title=sheet.querySelector('.print-brand-name');if(title)title.textContent=`${name} · ОТЧЁТ ДИРЕКТОРА`;
  const customLogo=safeLogoDataUrl(c.logoDataUrl),logoSrc=c.showLogoInDocuments===false?'':(customLogo||'assets/justfun-official-transparent.png');if(brand&&logoSrc&&!brand.querySelector('.print-company-logo-v600')){const logo=document.createElement('img');logo.className='print-company-logo-v600';logo.src=logoSrc;logo.alt='Логотип';brand.prepend(logo)}
  const contact=[c.legalName,c.phone,c.email,c.website].filter(Boolean).join(' · ');if(contact&&!sheet.querySelector('.print-company-info-v600')){const info=document.createElement('div');info.className='print-company-info-v600';info.textContent=contact;header?.insertAdjacentElement('afterend',info)}
}

const normalizeOrderV600=normalizeOrder__implV595;normalizeOrder__implV595=function(raw){const source=raw&&typeof raw==='object'?raw:{};if(source.warehouseId&&String(source.warehouseId)!==activeId()){quarantineForeign('orders',[source],'normalize_rejected');return null}const out=normalizeOrderV600(source);if(!out)return out;out.warehouseId=activeId();out.invoiceNumber=String(source.invoiceNumber||out.invoiceNumber||'');out.documentSnapshot=source.documentSnapshot?clone(source.documentSnapshot):(out.documentSnapshot||null);return out};
const normalizeDriverV600=normalizeDriver__implV595;normalizeDriver__implV595=function(raw){const source=raw&&typeof raw==='object'?raw:{};if(source.warehouseId&&String(source.warehouseId)!==activeId()){quarantineForeign('drivers',[source],'normalize_rejected');return null}const out=normalizeDriverV600(source);if(out)out.warehouseId=activeId();return out};
try{const base=normalizeProduct;normalizeProduct=function(raw){const source=raw&&typeof raw==='object'?raw:{};if(source.warehouseId&&String(source.warehouseId)!==activeId()){quarantineForeign('products',[source],'normalize_rejected');return null}const out=base(source);if(out)out.warehouseId=activeId();return out}}catch{}
try{const base=normalizeInventoryMovement;normalizeInventoryMovement=function(raw){const source=raw&&typeof raw==='object'?raw:{};if(source.warehouseId&&String(source.warehouseId)!==activeId()){quarantineForeign('inventoryMovements',[source],'normalize_rejected');return null}const out=base(source);if(out)out.warehouseId=activeId();return out}}catch{}
const saveOrderV600=saveOrder__implV595;saveOrder__implV595=async function(event){const editId=$id('editingOrderId')?.value||'',old=orders.find(o=>o.id===editId),before=new Set(orders.map(o=>o.id)),result=await saveOrderV600(event),saved=editId?orders.find(o=>o.id===editId):orders.find(o=>!before.has(o.id));if(!saved||(editId&&saved===old))return result;saved.warehouseId=activeId();saved.invoiceNumber=old?.invoiceNumber||nextInvoiceNumber(saved.createdAt,saved.id);saved.documentSnapshot=old?.documentSnapshot||documentSnapshot();persistOrders();openDetails(saved.id);return result};
const savePickupV600=savePickup__implV595;savePickup__implV595=async function(event){const editId=$id('editingPickupId')?.value||'',old=orders.find(o=>o.id===editId),before=new Set(orders.map(o=>o.id)),result=await savePickupV600(event),saved=editId?orders.find(o=>o.id===editId):orders.find(o=>!before.has(o.id));if(!saved||(editId&&saved===old))return result;saved.warehouseId=activeId();saved.invoiceNumber=old?.invoiceNumber||nextInvoiceNumber(saved.createdAt,saved.id);saved.documentSnapshot=old?.documentSnapshot||documentSnapshot();persistOrders();openDetails(saved.id);return result};
const openDetailsV600=openDetails__implV595;openDetails__implV595=function(id){const result=openDetailsV600(id),o=orders.find(x=>x.id===id),body=$id('detailBody');if(o&&body){const strip=document.createElement('div');strip.className='warehouse-order-context-v600';strip.innerHTML=`<span>Склад: <b>${escape(active()?.name||'Склад')}</b></span><span>Счёт: <b>${escape(o.invoiceNumber||o.number)}</b></span>`;body.prepend(strip)}return result};
const printOrderV600=printCurrentOrder__implV595;printCurrentOrder__implV595=function(){const o=orders.find(x=>x.id===currentDetailId),native=doPrint;doPrint=function(){decoratePrintedDocument(o);return native.apply(this,arguments)};try{return printOrderV600.apply(this,arguments)}finally{doPrint=native}};
try{const printRouteV760=printRoute;printRoute=function(){const native=doPrint;doPrint=function(){decoratePrintedRoute();return native.apply(this,arguments)};try{return printRouteV760.apply(this,arguments)}finally{doPrint=native}}}catch{}
try{const printReportV760=printReport;printReport=function(){const native=doPrint;doPrint=function(){decoratePrintedReport();return native.apply(this,arguments)};try{return printReportV760.apply(this,arguments)}finally{doPrint=native}}}catch{}
try{const exportReportV760=exportReportCSV;exportReportCSV=function(){const native=downloadBlob,header=String(settings.company?.shortName||settings.company?.programName||'JustFun').toUpperCase().replaceAll('"','""')+' · ОТЧЁТ ДИРЕКТОРА';downloadBlob=function(content,name,type){const next=/^director_report_/i.test(String(name||''))?String(content).replace('ТЕПЛИЦА78 · ОТЧЁТ ДИРЕКТОРА',header):content;return native(next,name,type)};try{return exportReportV760.apply(this,arguments)}finally{downloadBlob=native}}}catch{}

const buildBackupV600=buildBackupPayload__implV595;buildBackupPayload__implV595=function(){const payload=buildBackupV600();payload.version=BUILD;payload.warehouse={...active(),environment:isDemonstrationMode()?'demo':'live'};payload.data.warehouseId=activeId();payload.data.company=clone(settings.company||{});payload.data.routeOverrides=clone(routeOverrides||{});payload.data.routeExecutions=clone(routeExecutions||{});payload.data.routeArchives=clone(routeArchives||[]);payload.data.warehouseReservations=clone(warehouseReservations||{});try{payload.data.manualRouteSequences=JSON.parse(localStorage.getItem(B.dataKey('teplitsa_route_manual_sequences_v596'))||'{}')}catch{payload.data.manualRouteSequences={}}return payload};
exportBackup__implV595=async function(options={}){const payload=buildBackupPayload(),code=activeCode(),env=isDemonstrationMode()?'DEMO':'WORK',kind=['manual','safety','server'].includes(options?.kind)?options.kind:'manual',fileName=`${code}_${env}_backup_${todayISO()}.json`,nativeSave=window.JustFunDesktop?.backups?.save;if(typeof nativeSave==='function'){const result=await nativeSave({backup:payload,fileName,kind});if(!result?.ok)throw new Error(result?.message||'Windows не подтвердил запись резервной копии.');settings.program=settings.program||{};settings.program.lastBackupAt=result.at||nowIso();settings.program.lastBackupKind=kind;settings.program.lastBackupPath=result.path||'';persistSettings();if(typeof renderSmartProgramHealth==='function')renderSmartProgramHealth();return{...result,confirmed:true}}const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fileName;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);settings.program=settings.program||{};settings.program.lastBackupRequestedAt=nowIso();persistSettings();if(typeof renderSmartProgramHealth==='function')renderSmartProgramHealth();return{ok:true,confirmed:false,kind,fileName}};
const exportCsvV600=exportCSV__implV595;exportCSV__implV595=function(){const native=downloadBlob;downloadBlob=function(content,name,type){return native(content,`${activeCode()}_${String(name).replace(/^orders[_-]?/i,'orders_')}`,type)};try{return exportCsvV600()}finally{downloadBlob=native}};
function validateWarehouseSnapshotV783(parsed,{requireIdentity=false}={}){
  const data=asObject(parsed?.data||parsed),meta=asObject(parsed?.warehouse),expected=activeId(),currentEnvironment=isDemonstrationMode()?'demo':'live';
  if(!Array.isArray(data.orders)||!Array.isArray(data.products)||!Array.isArray(data.drivers))throw new Error('Файл не содержит обязательные разделы');
  const declaredIds=[meta.id,data.warehouseId,data.settings?.warehouseProfile?.id].filter(Boolean).map(String),foreignDeclared=declaredIds.find(id=>id!==expected);
  if(foreignDeclared)throw new Error(`Резервная копия относится к другому складу (${meta.name||meta.code||foreignDeclared}). Импорт в активный склад «${active()?.name}» запрещён.`);
  if(requireIdentity&&!declaredIds.length)throw new Error('Серверная копия не содержит идентификатор склада.');
  if(meta.environment&&String(meta.environment)!==currentEnvironment)throw new Error(`Резервная копия относится к среде ${String(meta.environment).toUpperCase()}, а сейчас открыта ${currentEnvironment.toUpperCase()}. Смешивание LIVE и DEMO запрещено.`);
  const groups=[['заказы',asArray(data.orders)],['товары',asArray(data.products)],['движения',asArray(data.inventoryMovements)],['водители',asArray(data.drivers)],['архив рейсов',asArray(data.routeArchives)],['рейсы',Object.values(asObject(data.routeCatalog))],['выполнение рейсов',Object.values(asObject(data.routeExecutions))]];
  for(const [label,records] of groups){const wrong=records.find(x=>x?.warehouseId&&String(x.warehouseId)!==expected);if(wrong)throw new Error(`Импорт заблокирован: раздел «${label}» содержит запись другого склада.`)}
  validateSafeSnapshotIdentifiersV783(data);
  return{data,meta,expected,currentEnvironment,declaredIds};
}
function validateSafeSnapshotIdentifiersV783(data){
  const safe=value=>value===''||/^[A-Za-z0-9_-]{1,160}$/.test(String(value));
  const visit=(value,key='',depth=0)=>{
    if(depth>40)throw new Error('Резервная копия имеет недопустимую глубину вложенности.');
    if(Array.isArray(value)){if(/Ids$/.test(key))for(const item of value)if(!safe(item))throw new Error(`Небезопасный идентификатор ${key}.`);for(const item of value)visit(item,key,depth+1);return}
    if(!value||typeof value!=='object'){if(/(?:^id$|Id$)/.test(key)&&!safe(value))throw new Error(`Небезопасный идентификатор ${key}.`);return}
    for(const[childKey,child]of Object.entries(value))visit(child,childKey,depth+1)
  };
  for(const mapName of ['routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','warehouseReservations']){const map=data?.[mapName];if(map&&typeof map==='object'&&!Array.isArray(map))for(const key of Object.keys(map))if(!safe(key))throw new Error(`Раздел ${mapName} содержит небезопасный ключ.`)}
  visit(data)
}
function reconcileServerWarehouseV783(meta,expected){
  const source=asObject(meta);if(!Object.keys(source).length)return;
  const registry=B.getRegistry(),record=registry.warehouses.find(item=>String(item.id)===String(expected));if(!record)throw new Error('Активный склад отсутствует в локальном реестре.');
  const fields=['name','code','address','lat','lon','createdAt','updatedAt','catalogMode'];
  for(const field of fields)if(source[field]!==undefined&&source[field]!==null&&source[field]!=='')record[field]=clone(source[field]);
  record.id=expected;B.saveRegistry(registry)
}
function applyWarehouseSnapshotV783(parsed){
  const{data,meta,expected}=validateWarehouseSnapshotV783(parsed,{requireIdentity:true});
  reconcileServerWarehouseV783(meta,expected);
  orders=asArray(data.orders).map(x=>normalizeOrder({...x,warehouseId:expected})).filter(Boolean);
  products=asArray(data.products).map(x=>normalizeProduct({...x,warehouseId:expected})).filter(Boolean);
  inventoryMovements=asArray(data.inventoryMovements).map(x=>normalizeInventoryMovement({...x,warehouseId:expected})).filter(Boolean);
  drivers=asArray(data.drivers).map(x=>normalizeDriver({...x,warehouseId:expected})).filter(Boolean);
  settings=deepMerge(cloneValue(DEFAULTS),asObject(data.settings));const serverCompany=asObject(data.company);settings.company=deepMerge(companyDefaults(),Object.keys(serverCompany).length?serverCompany:asObject(settings.company));const currentWarehouse=active();settings.warehouse={address:String(currentWarehouse?.address||''),lat:currentWarehouse?.lat==null?null:Number(currentWarehouse.lat),lon:currentWarehouse?.lon==null?null:Number(currentWarehouse.lon)};ensureWarehouseSettings();
  settings.warehouseProfile={id:expected,code:activeCode(),name:active()?.name,timezone:'Europe/Moscow',routeStartConfigured:validRouteStart(settings.warehouse)};
  routePlans=asObject(data.routePlans);routeAssignments=asObject(data.routeAssignments);routeCatalog=asObject(data.routeCatalog);routeDriverAssignments=asObject(data.routeDriverAssignments);routeLocks=asObject(data.routeLocks);routeOverrides=asObject(data.routeOverrides);routeExecutions=asObject(data.routeExecutions);routeArchives=asArray(data.routeArchives);warehouseReservations=asObject(data.warehouseReservations);
  try{localStorage.setItem(B.dataKey('teplitsa_route_manual_sequences_v596'),JSON.stringify(asObject(data.manualRouteSequences)));window.RouteStopInteractionsV597?.reloadFromStorage?.()}catch{}
  reportingData=normalizeReportingData(data.reportingData||{});stampCurrentData();persistEverything();runDataDiagnostics(false);renderAll();applyBranding();installSettingsPanels();
  return true;
}
function readStoredWarehouseSectionV783(warehouseId,environment,key,fallback){
  const raw=B.raw.get(B.dataKey(key,environment,warehouseId));if(raw===null||raw==='')return clone(fallback);
  let parsed;try{parsed=JSON.parse(raw)}catch{throw Object.assign(new Error(`Раздел ${key} склада повреждён. Миграция на VPS остановлена без изменения локальных данных.`),{code:'LOCAL_MIGRATION_SECTION_CORRUPT',section:key,warehouseId})}
  if(Array.isArray(fallback)){if(!Array.isArray(parsed))throw Object.assign(new Error(`Раздел ${key} должен содержать список. Миграция на VPS остановлена.`),{code:'LOCAL_MIGRATION_SECTION_INVALID',section:key,warehouseId})}
  else if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(new Error(`Раздел ${key} должен содержать объект. Миграция на VPS остановлена.`),{code:'LOCAL_MIGRATION_SECTION_INVALID',section:key,warehouseId});
  return parsed
}
async function storedWarehouseSnapshotV783(warehouseId,environment='live'){
  const record=B.getRegistry().warehouses.find(item=>String(item.id)===String(warehouseId));if(!record)throw Object.assign(new Error('Склад для переноса на VPS отсутствует в локальном реестре.'),{code:'LOCAL_MIGRATION_WAREHOUSE_MISSING'});
  const ordersRaw=B.raw.get(B.dataKey(STORAGE_KEY,environment,record.id));let storedOrders=[];if(ordersRaw!==null&&ordersRaw!==''){try{storedOrders=JSON.parse(ordersRaw)}catch{throw Object.assign(new Error('Раздел заказов склада повреждён. Миграция на VPS остановлена.'),{code:'LOCAL_MIGRATION_SECTION_CORRUPT',section:STORAGE_KEY,warehouseId:record.id})}if(!Array.isArray(storedOrders)&&storedOrders?.[LARGE_ORDERS_POINTER]!==true)throw Object.assign(new Error('Раздел заказов склада имеет неверный формат.'),{code:'LOCAL_MIGRATION_SECTION_INVALID',section:STORAGE_KEY,warehouseId:record.id})}
  if(!Array.isArray(storedOrders)&&storedOrders?.[LARGE_ORDERS_POINTER]===true){
    const database=B.databaseName(LARGE_ORDERS_DB_NAME,record.id,environment),large=await readLargeOrdersRecordFromDatabase(database).catch(error=>{throw Object.assign(new Error(`Расширенная база заказов склада не прочитана: ${error?.message||error}`),{code:'LOCAL_MIGRATION_LARGE_ORDERS_UNAVAILABLE'})});
    if(!large||typeof large.json!=='string')throw Object.assign(new Error('Расширенная база заказов склада отсутствует. Миграция остановлена.'),{code:'LOCAL_MIGRATION_LARGE_ORDERS_MISSING'});
    try{storedOrders=JSON.parse(large.json)}catch{throw Object.assign(new Error('Расширенная база заказов склада повреждена. Миграция остановлена.'),{code:'LOCAL_MIGRATION_LARGE_ORDERS_CORRUPT'})}
    if(!Array.isArray(storedOrders))throw Object.assign(new Error('Расширенная база заказов имеет неверный формат.'),{code:'LOCAL_MIGRATION_LARGE_ORDERS_INVALID'})
  }
  const storedSettings=readStoredWarehouseSectionV783(record.id,environment,SETTINGS_KEY,{}),data={
    orders:storedOrders,
    products:readStoredWarehouseSectionV783(record.id,environment,PRODUCTS_KEY,[]),
    inventoryMovements:readStoredWarehouseSectionV783(record.id,environment,INVENTORY_MOVEMENTS_KEY,[]),
    drivers:readStoredWarehouseSectionV783(record.id,environment,DRIVERS_KEY,[]),
    settings:storedSettings,
    company:asObject(storedSettings.company),
    routePlans:readStoredWarehouseSectionV783(record.id,environment,ROUTES_KEY,{}),
    routeAssignments:readStoredWarehouseSectionV783(record.id,environment,ROUTE_ASSIGNMENTS_KEY,{}),
    routeCatalog:readStoredWarehouseSectionV783(record.id,environment,ROUTE_CATALOG_KEY,{}),
    routeDriverAssignments:readStoredWarehouseSectionV783(record.id,environment,ROUTE_DRIVERS_KEY,{}),
    routeLocks:readStoredWarehouseSectionV783(record.id,environment,ROUTE_LOCKS_KEY,{}),
    reportingData:readStoredWarehouseSectionV783(record.id,environment,REPORTING_KEY,{}),
    routeOverrides:readStoredWarehouseSectionV783(record.id,environment,ROUTE_OVERRIDES_KEY,{}),
    routeExecutions:readStoredWarehouseSectionV783(record.id,environment,ROUTE_EXECUTIONS_KEY,{}),
    routeArchives:readStoredWarehouseSectionV783(record.id,environment,ROUTE_ARCHIVE_KEY,[]),
    warehouseReservations:readStoredWarehouseSectionV783(record.id,environment,WAREHOUSE_RESERVATIONS_KEY,{}),
    manualRouteSequences:readStoredWarehouseSectionV783(record.id,environment,'teplitsa_route_manual_sequences_v596',{})
  };
  return{app:'Заказы и логистика',version:BUILD,exportedAt:nowIso(),warehouse:{...clone(record),id:String(record.id),environment},data:{...data,warehouseId:String(record.id)}}
}
importBackupFile__implV595=async function(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{
    const parsed=JSON.parse(await file.text()),checked=validateWarehouseSnapshotV783(parsed);
    if(!checked.declaredIds.length&&!await jfConfirm('Это резервная копия старой версии без идентификатора склада. Записи другого склада определить невозможно. Привязать файл только к текущему складу?',{title:'Копия старой версии',confirmLabel:'Привязать'}))return;
    if(!await jfConfirm(`Восстановить данные склада «${active()?.name}» в среде ${checked.currentEnvironment.toUpperCase()}? Текущая база сначала будет скачана как страховочная копия.`,{title:'Восстановление склада',confirmLabel:'Восстановить',kind:'danger'}))return;
    if(!checked.declaredIds.length){parsed.warehouse={...checked.meta,id:checked.expected,environment:checked.currentEnvironment};parsed.data={...checked.data,warehouseId:checked.expected}}
    const safety=await exportBackup({kind:'safety'});if(!safety?.confirmed)throw new Error('Windows не подтвердил страховочную копию. Восстановление остановлено без изменения данных.');applyWarehouseSnapshotV783(parsed);alert('Резервная копия восстановлена только в активный склад и текущую среду. Остальные данные не изменялись.')
  }catch(err){alert('Не удалось загрузить резервную копию: '+(err?.message||err))}
};

try{const baseRender=renderProgramSettings;renderProgramSettings=function(){const result=baseRender.apply(this,arguments);installSettingsPanels();applyBranding();return result}}catch{}
try{const baseDiag=runDataDiagnostics__implV595;runDataDiagnostics__implV595=function(show){const fixes=baseDiag(show);const before={orders:orders.length,products:products.length,drivers:drivers.length,movements:inventoryMovements.length};stampCurrentData();const blocked=(before.orders-orders.length)+(before.products-products.length)+(before.drivers-drivers.length)+(before.movements-inventoryMovements.length);if(show&&blocked)alert(`Заблокированы и помещены в карантин записи другого склада: ${blocked}.`);return fixes}}catch{}
try{const baseBuildAll=buildAllRoutes;buildAllRoutes=async function(){if(!validRouteStart(settings.warehouse)){setProgress('Маршруты не рассчитаны: сначала настройте адрес и координаты активного склада.',false,true);return}return baseBuildAll.apply(this,arguments)}}catch{}
try{const baseBuildOne=buildSingleRoute;buildSingleRoute=async function(){if(!validRouteStart(settings.warehouse)){setProgress('Маршрут не рассчитан: сначала настройте адрес и координаты активного склада.',false,true);return}return baseBuildOne.apply(this,arguments)}}catch{}

window.TeplitsaWarehouseV600=Object.freeze({version:BUILD,activeWarehouse:()=>clone(active()),activeWarehouseId:activeId,nextInvoiceNumber:(date,excludeId='')=>nextInvoiceNumber(date,excludeId),baseInvoiceNumber:date=>baseInvoiceNumber(date),documentSnapshot:()=>documentSnapshot(),storageKey:key=>B.dataKey(key),routeStartReady:()=>validRouteStart(settings.warehouse),counts:()=>({orders:orders.length,products:products.length,movements:inventoryMovements.length,drivers:drivers.length,routes:Object.keys(routePlans||{}).length,executions:Object.keys(routeExecutions||{}).length,archives:routeArchives.length}),whenPersisted:()=>ordersPersistChain,storedSnapshot:(warehouseId,environment='live')=>storedWarehouseSnapshotV783(warehouseId,environment),importServerSnapshot:snapshot=>applyWarehouseSnapshotV783(snapshot),quarantine:()=>{try{return clone(JSON.parse(localStorage.getItem(B.dataKey('teplitsa_cross_warehouse_quarantine_v600'))||'[]'))}catch{return[]}},afterOrdersHydrated:()=>{stampCurrentData();persistSettings();applyBranding();return true},stampCurrentData:()=>stampCurrentData(),applyBranding:()=>applyBranding(),installSettingsPanels:()=>installSettingsPanels()});

try{repairLegacySeededCatalog();stampCurrentData()}catch(error){window.__warehouseIsolationCritical=true;console.error('Ранняя проверка складской изоляции не выполнена',error)}
function init(){ensureWarehouseSettings();stampCurrentData();persistSettings();applyBranding();ensureWarehouseModal();installSettingsPanels();const status=$id('diagnosticStatus');if(status)status.textContent=`Версия системы: ${BUILD} · активный склад «${active()?.name}» · физически изолированное хранилище.`;try{renderAll()}catch(err){console.error('Warehouse final render failed',err)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
