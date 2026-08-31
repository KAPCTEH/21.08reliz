/* Теплица78 5.9.8 — интеллектуальная автоматизация, московское время и грузовые правила */
(function(){
  const MSK_TZ='Europe/Moscow';
  const SMART_PRODUCT_EXTRA_KEYS=[
    'loadZone','loadingSequence','unloadingPriority','segregationGroup','incompatibleGroups',
    'requiresOpenBody','requiresSideAccess','requiresTailLift','requiresTwoPeople','crewRequired',
    'stackWeightLimitKg','maxTiltDeg','floorProtection','strapCount','loadingRuleVersion'
  ];
  const CATEGORY_LIBRARY={
    'Теплицы, комплектующие и автоматика':{
      subcategories:['Готовые теплицы','Каркасы','Основания','Автоматика','Фурнитура'],
      defaults:{handlingClass:'GREENHOUSE_FRAME_UPRIGHT',cargoShape:'Разобранный каркас',packProfile:'GH_UPRIGHT_STACK',loadOrientation:'upright',orientationNotes:'Стоя плоскостью вдоль борта',topLoadRule:'Не ставить груз сверху',moistureRule:'Защитить фурнитуру и упаковку от осадков',securingRule:'Нижний упор, мягкие прокладки и 2–3 независимых ремня',keepDry:true,topLoadOnly:true,requiresSideAccess:true,requiresTwoPeople:true,crewRequired:2,loadingSequence:'middle',unloadingPriority:'normal',segregationGroup:'Каркасы'}
    },
    'Поликарбонат и комплектующие':{
      subcategories:['Сотовый поликарбонат','Монолитный поликарбонат','Профили','Термошайбы и крепёж'],
      defaults:{handlingClass:'PC_ROLL',cargoShape:'Лист или рулон',packProfile:'PC_ROLL_2_5',loadOrientation:'upright',orientationNotes:'Рулон вертикально у борта либо листы плашмя на сплошной опоре',topLoadRule:'Только лёгкий равномерный груз после подтверждения',moistureRule:'Сухой кузов, защитить торцы и каналы',securingRule:'Минимум два независимых ремня с мягкими прокладками',fragile:true,keepDry:true,topLoadOnly:true,manualTransportCheck:true,requiresOpenBody:true,requiresSideAccess:true,requiresTwoPeople:true,crewRequired:2,loadingSequence:'last',unloadingPriority:'first',segregationGroup:'Поликарбонат',incompatibleGroups:'Острые и точечные грузы'}
    },
    'Листовые древесные материалы':{
      subcategories:['ОСБ','Фанера','ДСП / ЛДСП','МДФ','ДВП'],
      defaults:{handlingClass:'RIGID_SHEET',cargoShape:'Плоский жёсткий лист',packProfile:'FLAT_SHEET_STACK',loadOrientation:'flat',orientationNotes:'Плашмя на ровных сухих прокладках',topLoadRule:'Допускается только равномерная нагрузка в пределах нормы',moistureRule:'Исключить мокрый пол и осадки',securingRule:'Широкие ремни, уголки и сплошная опора',keepDry:true,loadZone:'axle',loadingSequence:'first',unloadingPriority:'last',segregationGroup:'Жёсткие листы',floorProtection:'Сухие прокладки и защитный настил'}
    },
    'Пиломатериалы и деревянный погонаж':{
      subcategories:['Доска и погонаж 6 м','Брусок и рейка 3 м','Террасная доска','Брус','Рейка'],
      defaults:{handlingClass:'LONG_TIMBER',cargoShape:'Длинномерный пакет',packProfile:'LONG_ITEM',loadOrientation:'flat',orientationNotes:'Горизонтально вдоль кузова',topLoadRule:'Только равномерно на выровненную пачку',moistureRule:'Сухо, с вентиляцией; не класть на мокрый пол',securingRule:'Пакетировать; ремни с уголками; опоры по длине',keepDry:true,longLoad:true,requiresOpenBody:true,requiresSideAccess:true,requiresTwoPeople:true,crewRequired:2,loadingSequence:'first',unloadingPriority:'last',segregationGroup:'Длинномер'}
    },
    'Теплоизоляция':{
      subcategories:['Пенополистирол','XPS','Минеральная вата','Рулонная изоляция'],
      defaults:{handlingClass:'LIGHT_PACK',cargoShape:'Лёгкая объёмная упаковка',packProfile:'LIGHT_INSULATION_PACK',loadOrientation:'any',orientationNotes:'После тяжёлых позиций, без сжатия ремнями',topLoadRule:'Не ставить тяжёлый или точечный груз',moistureRule:'Обязательная защита от влаги',securingRule:'Мягкая фиксация без деформации упаковки',keepDry:true,topLoadOnly:true,loadingSequence:'last',unloadingPriority:'first',segregationGroup:'Лёгкие упаковки'}
    },
    'Кабель и провод':{
      subcategories:['Кабель силовой','Провод','Бухты и барабаны','Слаботочный кабель'],
      defaults:{handlingClass:'CABLE',cargoShape:'Бухта или барабан',packProfile:'CABLE_COIL',loadOrientation:'upright',orientationNotes:'Бухты вертикально; барабан с противооткатными упорами',topLoadRule:'Только лёгкий груз при устойчивой упаковке',moistureRule:'Защитить торцы и маркировку',securingRule:'Упоры от качения и отдельная фиксация',loadZone:'axle',loadingSequence:'first',segregationGroup:'Кабель'}
    },
    'Электрооборудование':{
      subcategories:['Автоматы и УЗО','Щиты и корпуса','Пускатели и контакторы','Розетки и выключатели'],
      defaults:{handlingClass:'BOXED_ELECTRICAL',cargoShape:'Коробки',packProfile:'BOX_STACK',loadOrientation:'any',orientationNotes:'Сохранять заводское положение упаковки',topLoadRule:'В пределах маркировки производителя',moistureRule:'Сухой закрытый кузов',securingRule:'Стянуть блоками, исключить смещение',fragile:true,keepDry:true,segregationGroup:'Электрооборудование'}
    },
    'Светотехника':{
      subcategories:['Светильники','Прожекторы','Лампы','Опоры и кронштейны'],
      defaults:{handlingClass:'FRAGILE_BOX',cargoShape:'Хрупкие коробки',packProfile:'FRAGILE_BOX_STACK',loadOrientation:'any',orientationNotes:'По стрелкам на упаковке',topLoadRule:'Не превышать маркировку; тяжёлый груз сверху запрещён',moistureRule:'Сухой закрытый кузов',securingRule:'Мягкие прокладки и фиксация блоками',fragile:true,keepDry:true,topLoadOnly:true,loadingSequence:'last',unloadingPriority:'first',segregationGroup:'Хрупкое'}
    },
    'Крепёж и расходные материалы':{
      subcategories:['Крепёж','Монтажная химия','Ленты и герметики','Фурнитура'],
      defaults:{handlingClass:'SMALL_BOX',cargoShape:'Коробки и мелкие места',packProfile:'SMALL_BOX',loadOrientation:'any',orientationNotes:'В таре или промаркированных контейнерах',topLoadRule:'Допускается в пределах прочности тары',moistureRule:'Защитить от влаги',securingRule:'Контейнеры закрепить от перемещения',keepDry:true,segregationGroup:'Мелкие места'}
    },
    'Прочее':{
      subcategories:['Без подкатегории'],
      defaults:{handlingClass:'GENERAL',cargoShape:'Штучный груз',packProfile:'GENERAL',loadOrientation:'any',orientationNotes:'По фактической упаковке',topLoadRule:'Определить после осмотра',moistureRule:'По маркировке товара',securingRule:'Зафиксировать от продольного и поперечного смещения',manualTransportCheck:true,transportConfidence:'TEMPLATE',segregationGroup:'Общий груз'}
    }
  };

  function smartDefaultProgram(){return{
    timezone:MSK_TZ,automationLevel:'balanced',interfaceDensity:'comfortable',autoOpenIssues:true,
    autosaveIndicator:true,backupReminderDays:7,lastBackupAt:'',decisionExplanations:true,
    defaultView:'orders',compactLargeLists:true,demoCargoTemplatesVersion:0
  }}
  function smartDefaultRoute(){return{
    automationMode:'balanced',optimizationGoal:'balanced',volumeReservePct:14,payloadReservePct:5,
    maxDetourPct:25,trafficBufferPct:12,adaptiveLoadingEnabled:true,requireCargoPassport:false,
    autoSplitOverload:true,blockCompatibilityConflicts:true,defaultCrewAvailable:2,
    showDecisionReasons:true,manualReviewThreshold:2,adaptiveLearningEnabled:true
  }}
  function ensureSmartSettings(){
    if(typeof DEFAULTS==='object'&&DEFAULTS){
      DEFAULTS.program={...smartDefaultProgram(),...(DEFAULTS.program||{})};
      DEFAULTS.smartRoute={...smartDefaultRoute(),...(DEFAULTS.smartRoute||{})};
    }
    settings.program={...smartDefaultProgram(),...(settings.program||{})};
    settings.smartRoute={...smartDefaultRoute(),...(settings.smartRoute||{})};
  }
  ensureSmartSettings();

  /* Московская временная зона: хранение timestamp остаётся ISO UTC, отображение и календарный день — Москва. */
  function mskParts(value=new Date()){
    const d=value instanceof Date?value:new Date(value);
    if(Number.isNaN(d.getTime()))return null;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:MSK_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
    return Object.fromEntries(parts.map(x=>[x.type,x.value]));
  }
  function mskDateISO(value=new Date()){const p=mskParts(value);return p?`${p.year}-${p.month}-${p.day}`:''}
  function mskDateTimeText(value){
    if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';
    return new Intl.DateTimeFormat('ru-RU',{timeZone:MSK_TZ,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)+' МСК';
  }
  todayISO=function(){return mskDateISO()};
  formatDateTime=function(value){return mskDateTimeText(value)};
  formatDateOnly=function(value){
    if(!value)return 'Не указана';const raw=String(value);let d;
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))d=new Date(raw+'T12:00:00+03:00');else d=new Date(raw);
    if(Number.isNaN(d.getTime()))return 'Не указана';
    return new Intl.DateTimeFormat('ru-RU',{timeZone:MSK_TZ,day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  };
  fillDateSelect=function(id,first,values){
    const el=$(id);if(!el)return;const prev=el.value;
    if(el.tagName==='INPUT'){el.type='date';el.setAttribute('aria-label',first);if(prev)el.value=prev;return}
    el.innerHTML=`<option value="">${first}</option>`+values.map(v=>`<option value="${v}">${formatDateOnly(v)}</option>`).join('');if(values.includes(prev))el.value=prev;
  };

  function installMoscowClock(){
    const host=document.querySelector('.actions')||document.querySelector('.nav')||document.querySelector('.top-actions')||document.querySelector('header .wrap');if(!host||document.getElementById('moscowClock'))return;
    const box=document.createElement('div');box.id='moscowClock';box.className='moscow-clock';box.title='Все даты и время программы отображаются по Москве';host.prepend(box);
    const tick=()=>{const now=new Date();box.innerHTML=`<span>Москва</span><b>${new Intl.DateTimeFormat('ru-RU',{timeZone:MSK_TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now)}</b><small>${new Intl.DateTimeFormat('ru-RU',{timeZone:MSK_TZ,day:'2-digit',month:'2-digit',year:'numeric'}).format(now)}</small>`};tick();setInterval(tick,1000);
  }

  function currentCategories(){
    const existing=products.map(p=>p.category).filter(Boolean);return [...new Set([...Object.keys(CATEGORY_LIBRARY),...existing])].sort((a,b)=>a.localeCompare(b,'ru'));
  }
  function categorySubcategories(category){
    const fromData=products.filter(p=>p.category===category).map(p=>p.subcategory).filter(Boolean);
    return [...new Set([...(CATEGORY_LIBRARY[category]?.subcategories||[]),...fromData])].sort((a,b)=>a.localeCompare(b,'ru'));
  }
  function optionHtml(value,label,selected=false){return `<option value="${escapeAttr(value)}"${selected?' selected':''}>${escapeHtml(label)}</option>`}
  function categoryOptions(selected='',includeManual=false){
    return `<option value="">Сначала выберите категорию</option>`+currentCategories().map(c=>optionHtml(c,c,c===selected)).join('')+(includeManual?optionHtml('__manual__','Ввести товар вручную',selected==='__manual__'):'');
  }
  /* Расширенная товарная модель. */
  const normalizeProductV597=normalizeProduct;
  normalizeProduct=function(raw={}){
    const p=normalizeProductV597(raw);return{...p,
      loadZone:['any','front','axle','rear'].includes(raw.loadZone)?raw.loadZone:'any',
      loadingSequence:['first','middle','last'].includes(raw.loadingSequence)?raw.loadingSequence:'middle',
      unloadingPriority:['first','normal','last'].includes(raw.unloadingPriority)?raw.unloadingPriority:'normal',
      segregationGroup:String(raw.segregationGroup||'').trim(),incompatibleGroups:String(raw.incompatibleGroups||'').trim(),
      requiresOpenBody:!!raw.requiresOpenBody,requiresSideAccess:!!raw.requiresSideAccess,requiresTailLift:!!raw.requiresTailLift,
      requiresTwoPeople:!!raw.requiresTwoPeople,crewRequired:Math.max(1,Math.round(Number(raw.crewRequired||1))),
      stackWeightLimitKg:Math.max(0,Number(raw.stackWeightLimitKg||0)),maxTiltDeg:Math.max(0,Number(raw.maxTiltDeg||0)),
      floorProtection:String(raw.floorProtection||'').trim(),strapCount:Math.max(0,Math.round(Number(raw.strapCount||0))),loadingRuleVersion:Number(raw.loadingRuleVersion||2)
    }
  };
  products=products.map(normalizeProduct);persistProducts();

  const itemWarehouseSnapshotV597=itemWarehouseSnapshot;
  itemWarehouseSnapshot=function(p,row){const base=itemWarehouseSnapshotV597(p,row),source=p||row?._itemSnapshot||{};for(const key of SMART_PRODUCT_EXTRA_KEYS)base[key]=source[key]??row?.dataset?.[key]??(typeof source[key]==='boolean'?false:'');return base};
  const setRowSnapshotV597=setRowSnapshot;
  setRowSnapshot=function(row,data={}){setRowSnapshotV597(row,data);for(const key of SMART_PRODUCT_EXTRA_KEYS)row.dataset[key]=String(data[key]??'');row._itemSnapshot=cloneValue(data)};

  function ensureSmartProductModalFields(){
    const preview=$('productPreview');if(!preview||$('productLoadZone'))return;
    const section=document.createElement('div');section.className='product-form-section smart-loading-rules';section.innerHTML=`<div class="product-form-section-head"><div><div class="product-form-section-title">Правила погрузки и совместимости</div><div class="product-form-section-sub">Эти ограничения автоматически участвуют в подборе автомобиля, разбиении рейса и порядке загрузки</div></div><span class="badge badge-green">Умная логика</span></div><div class="smart-rule-grid"><div class="field"><label>Зона кузова</label><select id="productLoadZone"><option value="any">Любая подходящая зона</option><option value="front">Ближе к кабине</option><option value="axle">Над осью / центр массы</option><option value="rear">У двери / заднего борта</option></select></div><div class="field"><label>Очередность погрузки</label><select id="productLoadingSequence"><option value="first">Грузить первым</option><option value="middle">В середине</option><option value="last">Грузить последним</option></select></div><div class="field"><label>Доступ при выгрузке</label><select id="productUnloadingPriority"><option value="first">Должен выгружаться первым</option><option value="normal">Обычный порядок</option><option value="last">Должен выгружаться последним</option></select></div><div class="field"><label>Группа совместимости</label><input id="productSegregationGroup" placeholder="Например: Хрупкое, Длинномер, Химия"/></div><div class="field span-2"><label>Несовместимые группы</label><input id="productIncompatibleGroups" placeholder="Через запятую: Химия, острые грузы..."/><div class="field-help">Система не объединит несовместимые товары в один рейс без ручного согласования</div></div><div class="field"><label>Минимум грузчиков</label><input id="productCrewRequired" min="1" max="10" step="1" type="number" value="1"/></div><div class="field"><label>Минимум ремней</label><input id="productStrapCount" min="0" max="30" step="1" type="number" value="0"/></div><div class="field"><label>Макс. нагрузка сверху, кг</label><input id="productStackWeightLimit" min="0" step="1" type="number" value="0"/><div class="field-help">0 — груз сверху запрещён или не определён</div></div><div class="field"><label>Допустимый наклон, °</label><input id="productMaxTilt" min="0" max="90" step="1" type="number" value="0"/></div><div class="field span-2"><label>Защита пола / прокладки</label><input id="productFloorProtection" placeholder="Сухие бруски, резиновый коврик, сплошной настил..."/></div></div><div class="handling-grid smart-capability-checks"><label class="handling-check"><input id="productRequiresOpenBody" type="checkbox"/> Нужен открытый кузов / съёмный тент</label><label class="handling-check"><input id="productRequiresSideAccess" type="checkbox"/> Нужна боковая загрузка</label><label class="handling-check"><input id="productRequiresTailLift" type="checkbox"/> Нужен гидроборт</label><label class="handling-check"><input id="productRequiresTwoPeople" type="checkbox"/> Нужны минимум два человека</label></div><div class="smart-rule-preview" id="smartProductRulePreview"></div>`;preview.before(section);
    section.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',updateSmartProductRulePreview));
  }
  function smartProductExtraFromForm(){return{
    subcategory:$('productSubcategory')?.value||'',loadZone:$('productLoadZone')?.value||'any',loadingSequence:$('productLoadingSequence')?.value||'middle',unloadingPriority:$('productUnloadingPriority')?.value||'normal',segregationGroup:$('productSegregationGroup')?.value||'',incompatibleGroups:$('productIncompatibleGroups')?.value||'',requiresOpenBody:!!$('productRequiresOpenBody')?.checked,requiresSideAccess:!!$('productRequiresSideAccess')?.checked,requiresTailLift:!!$('productRequiresTailLift')?.checked,requiresTwoPeople:!!$('productRequiresTwoPeople')?.checked,crewRequired:Math.max(1,Number($('productCrewRequired')?.value||1)),stackWeightLimitKg:Math.max(0,Number($('productStackWeightLimit')?.value||0)),maxTiltDeg:Math.max(0,Number($('productMaxTilt')?.value||0)),floorProtection:$('productFloorProtection')?.value||'',strapCount:Math.max(0,Number($('productStrapCount')?.value||0)),loadingRuleVersion:2
  }}
  function fillSmartProductExtra(p={}){ensureSmartProductModalFields();const map={productLoadZone:p.loadZone||'any',productLoadingSequence:p.loadingSequence||'middle',productUnloadingPriority:p.unloadingPriority||'normal',productSegregationGroup:p.segregationGroup||'',productIncompatibleGroups:p.incompatibleGroups||'',productCrewRequired:p.crewRequired||1,productStrapCount:p.strapCount||0,productStackWeightLimit:p.stackWeightLimitKg||0,productMaxTilt:p.maxTiltDeg||0,productFloorProtection:p.floorProtection||''};for(const[id,v]of Object.entries(map))if($(id))$(id).value=v;for(const[id,key]of [['productRequiresOpenBody','requiresOpenBody'],['productRequiresSideAccess','requiresSideAccess'],['productRequiresTailLift','requiresTailLift'],['productRequiresTwoPeople','requiresTwoPeople']])if($(id))$(id).checked=!!p[key];updateSmartProductRulePreview()}
  function updateSmartProductRulePreview(){const target=$('smartProductRulePreview');if(!target)return;const x=smartProductExtraFromForm(),flags=[];if(x.requiresOpenBody)flags.push('открытый кузов');if(x.requiresSideAccess)flags.push('боковой доступ');if(x.requiresTailLift)flags.push('гидроборт');if(x.crewRequired>1||x.requiresTwoPeople)flags.push(`${Math.max(2,x.crewRequired)} человека`);if(x.strapCount)flags.push(`${x.strapCount} ремн.`);target.innerHTML=`<b>Автоматическая проверка:</b> ${flags.length?escapeHtml(flags.join(' · ')):'специальное оснащение не требуется'}${x.incompatibleGroups?`<br><span>Не объединять с: ${escapeHtml(x.incompatibleGroups)}</span>`:''}`}
  window.smartProductCategoryChanged=function(applyDefaults=false){
    const category=$('productCategory')?.value||'',sub=$('productSubcategory'),current=sub?.value||'',items=categorySubcategories(category);if(sub){sub.innerHTML='<option value="">Без подкатегории</option>'+items.map(x=>optionHtml(x,x,x===current)).join('');if(items.includes(current))sub.value=current}
    if(!applyDefaults||!category)return;const template=CATEGORY_LIBRARY[category]?.defaults||{};const isNew=!$('editingProductId')?.value;
    const setters={productHandlingClass:'handlingClass',productCargoShape:'cargoShape',productPackProfile:'packProfile',productLoadOrientation:'loadOrientation',productOrientationNotes:'orientationNotes',productTopLoadRule:'topLoadRule',productMoistureRule:'moistureRule',productSecuringRule:'securingRule',productTransportConfidence:'transportConfidence',productLoadZone:'loadZone',productLoadingSequence:'loadingSequence',productUnloadingPriority:'unloadingPriority',productSegregationGroup:'segregationGroup',productIncompatibleGroups:'incompatibleGroups',productCrewRequired:'crewRequired',productFloorProtection:'floorProtection',productStrapCount:'strapCount'};
    for(const[id,key]of Object.entries(setters)){const el=$(id),v=template[key];if(el&&v!==undefined&&(isNew||!String(el.value||'').trim()||['GENERAL','any','middle','normal'].includes(el.value)))el.value=v}
    for(const[id,key]of [['productFragile','fragile'],['productKeepDry','keepDry'],['productTopLoadOnly','topLoadOnly'],['productLongLoad','longLoad'],['productManualTransportCheck','manualTransportCheck'],['productRequiresOpenBody','requiresOpenBody'],['productRequiresSideAccess','requiresSideAccess'],['productRequiresTailLift','requiresTailLift'],['productRequiresTwoPeople','requiresTwoPeople']]){const el=$(id);if(el&&template[key]!==undefined&&(isNew||!el.checked))el.checked=!!template[key]}
    updateProductPreview();updateSmartProductRulePreview();
  };
  function populateProductCategoryControls(p={}){const cat=$('productCategory'),sub=$('productSubcategory');if(!cat)return;const selected=p.category||'';cat.innerHTML=categoryOptions(selected,false);if(selected&&!currentCategories().includes(selected))cat.insertAdjacentHTML('beforeend',optionHtml(selected,selected,true));cat.value=selected;smartProductCategoryChanged(false);if(sub)sub.value=p.subcategory||''}

  const openProductModalV597=openProductModal__implV595;
  openProductModal__implV595=function(id=null){ensureSmartProductModalFields();openProductModalV597(id);const p=id?products.find(x=>x.id===id):{};populateProductCategoryControls(p||{});fillSmartProductExtra(p||{});if(!id&&currentCategories().length){$('productCategory').value='';$('productSubcategory').innerHTML='<option value="">Сначала выберите категорию</option>'}}
  const saveProductV597=saveProduct__implV595;
  saveProduct__implV595=function(e){const id=$('editingProductId')?.value||'',beforeCount=products.length,beforeStamp=id?products.find(p=>p.id===id)?.updatedAt:'';saveProductV597(e);let target=id?products.find(p=>p.id===id):products.length>beforeCount?products[0]:null;if(!target||(id&&target.updatedAt===beforeStamp))return;target=normalizeProduct({...target,...smartProductExtraFromForm(),category:$('productCategory')?.value||target.category,subcategory:$('productSubcategory')?.value||''});products=products.map(p=>p.id===target.id?target:p);persistProducts();renderProductDatalist();renderProducts();}

  /* Возможности автомобиля, необходимые для честного подбора под правила товара. */
  function ensureDriverCapabilities(){const payload=$('vehiclePayload'),grid=payload?.closest('.grid-3');if(!grid||$('driverBodyType'))return;const box=document.createElement('div');box.className='driver-capability-box';box.innerHTML=`<div class="section-title"><h2>Оснащение и доступ к грузу</h2><span class="badge badge-green">Для умного подбора</span></div><div class="grid-3"><div class="field"><label>Тип кузова</label><select id="driverBodyType"><option value="van">Закрытый фургон</option><option value="tent">Тент / европлатформа</option><option value="board">Открытый борт</option><option value="refrigerated">Рефрижератор</option></select></div><div class="field"><label>Экипаж на погрузке</label><input id="driverCrewCount" min="1" max="10" step="1" type="number" value="1"/></div><div class="field"><label>Допустимый свес, мм</label><input id="driverAllowedOverhang" min="0" step="100" type="number" value="0"/></div></div><div class="handling-grid"><label class="handling-check"><input id="driverOpenTop" type="checkbox"/> Открытый верх / съёмный тент</label><label class="handling-check"><input id="driverSideAccess" type="checkbox"/> Боковая загрузка</label><label class="handling-check"><input id="driverTailLift" type="checkbox"/> Гидроборт</label><label class="handling-check"><input id="driverFloorProtected" type="checkbox"/> Защищённый сухой пол</label></div>`;grid.after(box)}
  const normalizeDriverV597=normalizeDriver__implV595;
  normalizeDriver__implV595=function(raw={}){const d=normalizeDriverV597(raw);return{...d,bodyType:['van','tent','board','refrigerated'].includes(raw.bodyType)?raw.bodyType:'van',openTop:!!raw.openTop,sideAccess:!!raw.sideAccess,tailLift:!!raw.tailLift,floorProtected:raw.floorProtected!==false,crewCount:Math.max(1,Math.round(Number(raw.crewCount||1))),allowedOverhangMm:Math.max(0,Number(raw.allowedOverhangMm||0))}};
  drivers=drivers.map(normalizeDriver);persistDrivers();
  const openDriverModalV597=openDriverModal__implV595;
  openDriverModal__implV595=function(id=null){ensureDriverCapabilities();openDriverModalV597(id);const d=id?drivers.find(x=>x.id===id):{};const vals={driverBodyType:d?.bodyType||'van',driverCrewCount:d?.crewCount||1,driverAllowedOverhang:d?.allowedOverhangMm||0};for(const[id2,v]of Object.entries(vals))if($(id2))$(id2).value=v;for(const[id2,key]of [['driverOpenTop','openTop'],['driverSideAccess','sideAccess'],['driverTailLift','tailLift'],['driverFloorProtected','floorProtected']])if($(id2))$(id2).checked=key==='floorProtected'?d?.[key]!==false:!!d?.[key]}
  const saveDriverV597=saveDriver__implV595;
  saveDriver__implV595=function(e){const id=$('editingDriverId')?.value||'',before=drivers.length,stamp=id?drivers.find(x=>x.id===id)?.updatedAt:'';saveDriverV597(e);let d=id?drivers.find(x=>x.id===id):drivers.length>before?drivers[0]:null;if(!d||(id&&d.updatedAt===stamp))return;d=normalizeDriver({...d,bodyType:$('driverBodyType')?.value||'van',openTop:!!$('driverOpenTop')?.checked,sideAccess:!!$('driverSideAccess')?.checked,tailLift:!!$('driverTailLift')?.checked,floorProtected:!!$('driverFloorProtected')?.checked,crewCount:$('driverCrewCount')?.value||1,allowedOverhangMm:$('driverAllowedOverhang')?.value||0});drivers=drivers.map(x=>x.id===d.id?d:x);persistDrivers();renderDrivers();renderTripsPreview()};

  function parseGroupList(value){return String(value||'').split(/[,;]+/).map(normalizeText).filter(Boolean)}
  function smartCargoRules(orderList=[]){
    const items=orderList.flatMap(o=>asArray(o.items)),groups=new Set(),incompatible=[],rules={requiresOpenBody:false,requiresSideAccess:false,requiresTailLift:false,crewRequired:1,manualChecks:0,lowConfidence:0,strapCount:0,floorProtection:false,loadFirst:0,loadLast:0,unloadFirst:0,unloadLast:0,conflicts:[],missingPassports:[],items};
    for(const item of items){const group=normalizeText(item.segregationGroup);if(group)groups.add(group);incompatible.push({name:item.name,values:parseGroupList(item.incompatibleGroups)});rules.requiresOpenBody||=!!item.requiresOpenBody;rules.requiresSideAccess||=!!item.requiresSideAccess;rules.requiresTailLift||=!!item.requiresTailLift;rules.crewRequired=Math.max(rules.crewRequired,Number(item.crewRequired||1),item.requiresTwoPeople?2:1);rules.manualChecks+=item.manualTransportCheck?1:0;rules.lowConfidence+=['LOW','TEMPLATE'].includes(item.transportConfidence)?1:0;rules.strapCount+=Math.max(0,Number(item.strapCount||0));rules.floorProtection||=!!item.floorProtection;if(item.loadingSequence==='first')rules.loadFirst++;if(item.loadingSequence==='last')rules.loadLast++;if(item.unloadingPriority==='first')rules.unloadFirst++;if(item.unloadingPriority==='last')rules.unloadLast++;const complete=item.weightKg>0&&(item.volumeM3>0||item.transportLengthMm>0)&&item.handlingClass&&item.securingRule;if(!complete)rules.missingPassports.push(item.name)}
    for(const row of incompatible)for(const target of row.values)for(const group of groups)if(group.includes(target)||target.includes(group))rules.conflicts.push(`${row.name}: несовместимо с группой «${group}»`);
    return rules;
  }
  const driverFitForRouteV597=driverFitForRoute;
  driverFitForRoute=function(driver,list=[]){
    const base=driverFitForRouteV597(driver,list),rules=smartCargoRules(list),cfg=settings.smartRoute||smartDefaultRoute(),body=driverBodyVolume(driver),payload=Math.max(0,Number(driver?.payloadKg||0)),usableVolume=body*(1-clamp(Number(cfg.volumeReservePct||14),0,50)/100),usablePayload=payload*(1-clamp(Number(cfg.payloadReservePct||5),0,50)/100),profile=base.profile||routeTransportProfile(list),volumeOk=!profile.effectiveVolumeM3||usableVolume>=profile.effectiveVolumeM3,weightOk=!profile.weightKg||usablePayload>=profile.weightKg;
    const capabilityReasons=[];if(rules.requiresOpenBody&&!(driver.openTop||driver.bodyType==='board'||driver.bodyType==='tent'))capabilityReasons.push('товару нужен открытый кузов или съёмный тент');if(rules.requiresSideAccess&&!driver.sideAccess)capabilityReasons.push('требуется боковая загрузка');if(rules.requiresTailLift&&!driver.tailLift)capabilityReasons.push('требуется гидроборт');if(rules.crewRequired>Number(driver.crewCount||1))capabilityReasons.push(`нужно людей: ${rules.crewRequired}, у экипажа: ${Number(driver.crewCount||1)}`);if(rules.floorProtection&&driver.floorProtected===false)capabilityReasons.push('нужен защищённый сухой пол');
    const reasons=[...base.reasons];if(!volumeOk&&!reasons.some(x=>x.includes('объём')))reasons.push('недостаточно объёма с установленным резервом');if(!weightOk&&!reasons.some(x=>x.includes('грузопод')))reasons.push('недостаточно грузоподъёмности с установленным резервом');reasons.push(...capabilityReasons);
    const hasData=!!(base.hasData||rules.requiresOpenBody||rules.requiresSideAccess||rules.requiresTailLift||rules.crewRequired>1),dimensionOk=base.lengthOk!==false&&base.widthOk!==false&&base.heightOk!==false,fit=Boolean((!hasData||dimensionOk)&&volumeOk&&weightOk&&!capabilityReasons.length);
    return{...base,hasData,fits:hasData?fit:true,volumeOk,weightOk,usableVolume,usablePayload,reasons,smartRules:rules,volumeReserve:usableVolume-profile.effectiveVolumeM3,weightReserve:usablePayload-profile.weightKg}
  };
  const assessRouteOrdersV597=assessRouteOrders;
  assessRouteOrders=function(list=[]){const base=assessRouteOrdersV597(list),rules=smartCargoRules(list),cfg=settings.smartRoute||smartDefaultRoute(),passportBlocked=cfg.requireCargoPassport&&rules.missingPassports.length>0,compatibilityBlocked=cfg.blockCompatibilityConflicts&&rules.conflicts.length>0,manualScore=rules.manualChecks+rules.lowConfidence+rules.conflicts.length+rules.missingPassports.length,manualReview=manualScore>=Number(cfg.manualReviewThreshold||2);return{...base,cargoRules:rules,passportBlocked,compatibilityBlocked,manualReview,manualScore,hardViolation:base.hardViolation||passportBlocked||compatibilityBlocked}}
  const routePlanPenaltyV597=routePlanPenalty;
  routePlanPenalty=function(a){let score=routePlanPenaltyV597(a),goal=settings.smartRoute?.optimizationGoal||'balanced';if(!a)return score;if(goal==='fastest')score+=a.rules.totalMin*.45+a.spread*.2;else if(goal==='economy')score+=a.rules.distanceKm*.8+(a.vehicle?.best?.score||0)*.4;else if(goal==='warehouse')score+=(a.cargoRules?.manualChecks||0)*35+(a.cargoRules?.conflicts?.length||0)*500;return score};
  const plannedUnloadMinutesV597=plannedUnloadMinutes;
  plannedUnloadMinutes=function(order){const base=plannedUnloadMinutesV597(order),r=smartCargoRules([order]);return clamp(Math.round(base+r.manualChecks*3+r.lowConfidence*2+(r.requiresTailLift?4:0)+(r.crewRequired>1?3:0)+(r.requiresSideAccess?2:0)),Number(settings.serviceMinMinutes||10),Math.max(90,Number(settings.serviceMaxMinutes||20)*3))};

  function smartLoadingDuration(def,base){const r=smartCargoRules([{items:def.orders.flatMap(o=>o.items||[])}]),cargo=cargoMetricsFromOrders(def.orders),extra=Math.min(60,Math.round(cargo.weightKg/350+cargo.volumeM3*2.5+r.manualChecks*4+r.strapCount*1.5+(r.requiresSideAccess?5:0)+(r.requiresTailLift?6:0)+(r.crewRequired>1?4:0)));return clamp(base+extra,10,240)}
  routeArrivalSchedule=function(defs=[],source=settings){
    const config=normalizedArrivalConfig(source),map=new Map(),byDate=new Map(),adaptive=settings.smartRoute?.adaptiveLoadingEnabled!==false;for(const def of asArray(defs)){if(!def||(!def.orders?.length&&!def.unready?.length))continue;const date=def.date||'Без даты';if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(def)}
    for(const[date,dateDefs]of byDate){dateDefs.sort((a,b)=>config.priority==='name'?String(a.displayDistrict||a.district||'').localeCompare(String(b.displayDistrict||b.district||''),'ru'):routeLoadingPriorityDistance(b)-routeLoadingPriorityDistance(a)||String(a.displayDistrict||'').localeCompare(String(b.displayDistrict||''),'ru'));const bayFree=Array.from({length:config.bays},()=>config.start);dateDefs.forEach((def,index)=>{let bay=0;for(let i=1;i<bayFree.length;i++)if(bayFree[i]<bayFree[bay])bay=i;const load=adaptive?smartLoadingDuration(def,config.load):config.load,loadingStart=bayFree[bay],loadingEnd=loadingStart+load,arrivalTarget=loadingStart-config.lead,arrivalStart=arrivalTarget-config.window;bayFree[bay]=loadingEnd+config.gap;map.set(def.id,{routeId:def.id,date,bay:bay+1,wave:index,order:index+1,adaptiveLoadMinutes:load,arrivalStart:clockText(arrivalStart),arrivalTime:clockText(arrivalTarget),arrivalWindow:`${clockText(arrivalStart)}–${clockText(arrivalTarget)}`,loadingStart:clockText(loadingStart),loadingEnd:clockText(loadingEnd),loadingWindow:`${clockText(loadingStart)}–${clockText(loadingEnd)}`,departureTime:clockText(loadingEnd)})})}return map
  };

  /* Интеллектуальные настройки маршрута. */
  function ensureSmartRouteSettingsPanel(){const grid=document.querySelector('#settingsView .settings-grid');if(!grid||$('smartRouteSettings'))return;const panel=document.createElement('div');panel.id='smartRouteSettings';panel.className='settings-box span-2 smart-route-settings';panel.innerHTML=`<div class="driver-payment-head"><div><h3>Интеллектуальный диспетчер маршрутов</h3><p>Система учитывает запас вместимости, грузовые паспорта, совместимость, экипаж, оснащение кузова и фактическую сложность погрузки.</p></div><span class="badge badge-green">Адаптивный режим</span></div><div class="smart-route-presets"><button type="button" data-jf-onclick="applySmartRoutePreset('city')">Городские доставки</button><button type="button" data-jf-onclick="applySmartRoutePreset('region')">Область и дальние рейсы</button><button type="button" data-jf-onclick="applySmartRoutePreset('mixed')">Смешанный груз</button><button type="button" data-jf-onclick="applySmartRoutePreset('fragile')">Хрупкое и длинномер</button></div><div class="smart-rule-grid"><div class="field"><label>Уровень самостоятельности</label><select id="routeAutomationMode" data-jf-onchange="previewSmartRouteSettings()"><option value="cautious">Осторожный — больше согласований</option><option value="balanced">Сбалансированный</option><option value="autonomous">Автономный — максимум автоматизации</option></select></div><div class="field"><label>Цель оптимизации</label><select id="routeOptimizationGoal" data-jf-onchange="previewSmartRouteSettings()"><option value="balanced">Баланс времени и стоимости</option><option value="fastest">Минимальное время</option><option value="economy">Минимальный пробег и машина</option><option value="warehouse">Простая и безопасная погрузка</option></select></div><div class="field"><label>Резерв полезного объёма, %</label><input id="routeVolumeReserve" min="0" max="50" step="1" type="number"/></div><div class="field"><label>Резерв грузоподъёмности, %</label><input id="routePayloadReserve" min="0" max="50" step="1" type="number"/></div><div class="field"><label>Допустимый объезд, %</label><input id="routeMaxDetour" min="0" max="100" step="1" type="number"/></div><div class="field"><label>Буфер дорожного времени, %</label><input id="routeTrafficBuffer" min="0" max="100" step="1" type="number"/></div><div class="field"><label>Людей на складе по умолчанию</label><input id="routeDefaultCrew" min="1" max="20" step="1" type="number"/></div><div class="field"><label>Порог ручной проверки</label><input id="routeManualReviewThreshold" min="1" max="20" step="1" type="number"/></div></div><div class="handling-grid"><label class="handling-check"><input id="routeAdaptiveLoading" type="checkbox"/> Адаптивно считать время погрузки</label><label class="handling-check"><input id="routeRequirePassport" type="checkbox"/> Блокировать товар без грузового паспорта</label><label class="handling-check"><input id="routeAutoSplitOverload" type="checkbox"/> Автоматически делить перегруженный рейс</label><label class="handling-check"><input id="routeBlockCompatibility" type="checkbox"/> Блокировать несовместимые грузы</label><label class="handling-check"><input id="routeShowReasons" type="checkbox"/> Показывать причины решений</label><label class="handling-check"><input id="routeAdaptiveLearning" type="checkbox"/> Самокалибровка по закрытым рейсам</label></div><div class="smart-route-preview" id="smartRoutePreview"></div><div class="route-rules-footer"><div class="route-rules-formula"><b>Принцип:</b> автоматизация предлагает и проверяет, но важные ручные корректировки сохраняются и объясняются.</div><button class="btn-primary" data-jf-onclick="saveSmartRouteSettings()" type="button">Сохранить умные правила</button></div>`;const firstSpan=grid.querySelector('.span-2');if(firstSpan)firstSpan.before(panel);else grid.prepend(panel);panel.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',previewSmartRouteSettings))}
  function smartRouteFromForm(){return{automationMode:$('routeAutomationMode')?.value||'balanced',optimizationGoal:$('routeOptimizationGoal')?.value||'balanced',volumeReservePct:clamp(Number($('routeVolumeReserve')?.value||14),0,50),payloadReservePct:clamp(Number($('routePayloadReserve')?.value||5),0,50),maxDetourPct:clamp(Number($('routeMaxDetour')?.value||25),0,100),trafficBufferPct:clamp(Number($('routeTrafficBuffer')?.value||12),0,100),adaptiveLoadingEnabled:!!$('routeAdaptiveLoading')?.checked,requireCargoPassport:!!$('routeRequirePassport')?.checked,autoSplitOverload:!!$('routeAutoSplitOverload')?.checked,blockCompatibilityConflicts:!!$('routeBlockCompatibility')?.checked,defaultCrewAvailable:clamp(Number($('routeDefaultCrew')?.value||2),1,20),showDecisionReasons:!!$('routeShowReasons')?.checked,manualReviewThreshold:clamp(Number($('routeManualReviewThreshold')?.value||2),1,20),adaptiveLearningEnabled:!!$('routeAdaptiveLearning')?.checked}}
  window.previewSmartRouteSettings=function(){const x=smartRouteFromForm(),target=$('smartRoutePreview');if(!target)return;const labels={cautious:'Осторожный',balanced:'Сбалансированный',autonomous:'Автономный'};target.innerHTML=`<div><b>${labels[x.automationMode]}</b><span>резерв объёма ${x.volumeReservePct}% · веса ${x.payloadReservePct}% · буфер времени ${x.trafficBufferPct}%</span></div><div><b>${x.adaptiveLoadingEnabled?'Адаптивная погрузка':'Фиксированные слоты'}</b><span>${x.blockCompatibilityConflicts?'несовместимые грузы блокируются':'конфликты только предупреждаются'} · ${x.requireCargoPassport?'паспорт обязателен':'неполный паспорт допускается с предупреждением'}</span></div>`}
  window.applySmartRoutePreset=function(name){const presets={city:{automationMode:'autonomous',optimizationGoal:'fastest',volumeReservePct:10,payloadReservePct:5,maxDetourPct:18,trafficBufferPct:20,adaptiveLoadingEnabled:true,requireCargoPassport:false,autoSplitOverload:true,blockCompatibilityConflicts:true,defaultCrewAvailable:2,showDecisionReasons:true,manualReviewThreshold:3,adaptiveLearningEnabled:true},region:{automationMode:'balanced',optimizationGoal:'economy',volumeReservePct:15,payloadReservePct:8,maxDetourPct:30,trafficBufferPct:15,adaptiveLoadingEnabled:true,requireCargoPassport:false,autoSplitOverload:true,blockCompatibilityConflicts:true,defaultCrewAvailable:2,showDecisionReasons:true,manualReviewThreshold:2,adaptiveLearningEnabled:true},mixed:{automationMode:'balanced',optimizationGoal:'warehouse',volumeReservePct:20,payloadReservePct:10,maxDetourPct:25,trafficBufferPct:15,adaptiveLoadingEnabled:true,requireCargoPassport:true,autoSplitOverload:true,blockCompatibilityConflicts:true,defaultCrewAvailable:3,showDecisionReasons:true,manualReviewThreshold:1,adaptiveLearningEnabled:true},fragile:{automationMode:'cautious',optimizationGoal:'warehouse',volumeReservePct:25,payloadReservePct:12,maxDetourPct:20,trafficBufferPct:20,adaptiveLoadingEnabled:true,requireCargoPassport:true,autoSplitOverload:true,blockCompatibilityConflicts:true,defaultCrewAvailable:3,showDecisionReasons:true,manualReviewThreshold:1,adaptiveLearningEnabled:true}};settings.smartRoute={...smartDefaultRoute(),...(presets[name]||presets.mixed)};fillSmartRouteSettings();previewSmartRouteSettings()}
  function fillSmartRouteSettings(){ensureSmartRouteSettingsPanel();const x={...smartDefaultRoute(),...(settings.smartRoute||{})},map={routeAutomationMode:x.automationMode,routeOptimizationGoal:x.optimizationGoal,routeVolumeReserve:x.volumeReservePct,routePayloadReserve:x.payloadReservePct,routeMaxDetour:x.maxDetourPct,routeTrafficBuffer:x.trafficBufferPct,routeDefaultCrew:x.defaultCrewAvailable,routeManualReviewThreshold:x.manualReviewThreshold};for(const[id,v]of Object.entries(map))if($(id))$(id).value=v;for(const[id,key]of [['routeAdaptiveLoading','adaptiveLoadingEnabled'],['routeRequirePassport','requireCargoPassport'],['routeAutoSplitOverload','autoSplitOverload'],['routeBlockCompatibility','blockCompatibilityConflicts'],['routeShowReasons','showDecisionReasons'],['routeAdaptiveLearning','adaptiveLearningEnabled']])if($(id))$(id).checked=!!x[key];previewSmartRouteSettings()}
  window.saveSmartRouteSettings=function(){settings.smartRoute=smartRouteFromForm();persistSettings();if(typeof window.invalidateMutableRoutePlansV783==='function')window.invalidateMutableRoutePlansV783();else{routePlans={};persistRoutes()}renderTripsPreview();previewArrivalSchedule();alert('Интеллектуальные правила маршрута сохранены. Неактивные дорожные расчёты сброшены и будут построены заново с учётом грузовых ограничений; выполняемые рейсы сохранены.')}
  const renderSettingsV597=renderSettings__implV595;
  renderSettings__implV595=function(){ensureSmartRouteSettingsPanel();renderSettingsV597();fillSmartRouteSettings()};

  /* Умная аналитика отчётности. */
  function futureDate(days){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return mskDateISO(d)}
  function smartReportData(){
    const today=todayISO(),to7=futureDate(7),archivedStatuses=new Set(['delivered','picked_up','not_relevant','cancelled']),active=orders.filter(o=>!isPickup(o)&&!archivedStatuses.has(o.fulfillmentStatus)&&!o.archivedAt),upcoming=active.filter(o=>o.deliveryDate>=today&&o.deliveryDate<=to7),cargo=cargoMetricsFromOrders(upcoming),unpaid=orders.filter(o=>o.paymentStatus!=='paid'&&!['not_relevant','cancelled'].includes(o.fulfillmentStatus)),unpaidValue=unpaid.reduce((s,o)=>s+orderGrandTotal(o),0),incomplete=products.filter(p=>productCompleteness(p).percent<75||!p.securingRule||!p.handlingClass),manual=products.filter(p=>p.manualTransportCheck||['LOW','TEMPLATE'].includes(p.transportConfidence)),driverReady=drivers.filter(d=>d.active&&d.bodyLength&&d.payloadKg),routeRisks=[];
    for(const def of routeState().allDefs){if(!def.orders?.length)continue;const a=assessRouteOrders(def.orders);if(a.hardViolation||a.manualReview)routeRisks.push({def,a})}
    const shortage=[];for(const p of products){const s=productInventoryState(p);if(s.tracked&&(s.state==='out'||s.state==='low'))shortage.push({p,s})}
    return{today,to7,upcoming,cargo,unpaid,unpaidValue,incomplete,manual,driverReady,routeRisks,shortage}
  }
  function renderSmartReportInsights(){const context=$('directorContext');if(!context)return;let panel=$('smartReportInsights');if(!panel){panel=document.createElement('section');panel.id='smartReportInsights';panel.className='director-section smart-report-insights';context.after(panel)}const d=smartReportData(),readiness=products.length?Math.round((products.length-d.incomplete.length)/products.length*100):100;panel.innerHTML=`<div class="director-section-head"><div><h3>Прогноз и контроль автоматизации</h3><p>Что ожидается в ближайшие 7 дней и где система не может принять надёжное автоматическое решение.</p></div><div class="director-section-badge">Москва · ${formatDateOnly(d.today)}</div></div><div class="smart-report-grid"><div class="smart-report-card"><span>Доставки на 7 дней</span><b>${d.upcoming.length}</b><small>${formatVolume(d.cargo.volumeM3)} · ${formatWeight(d.cargo.weightKg)}</small></div><div class="smart-report-card ${d.routeRisks.length?'warn':'good'}"><span>Рейсы требуют решения</span><b>${d.routeRisks.length}</b><small>${d.routeRisks.length?'перегрузка, совместимость или паспорт':'критических рисков нет'}</small></div><div class="smart-report-card ${readiness<80?'warn':'good'}"><span>Готовность паспортов</span><b>${readiness}%</b><small>неполных карточек: ${d.incomplete.length}</small></div><div class="smart-report-card ${d.shortage.length?'bad':'good'}"><span>Риски склада</span><b>${d.shortage.length}</b><small>нет остатка или ниже минимума</small></div><div class="smart-report-card ${d.unpaidValue?'warn':'good'}"><span>Не оплачено</span><b>${money(d.unpaidValue)}</b><small>заказов: ${d.unpaid.length}</small></div><div class="smart-report-card"><span>Готовый автопарк</span><b>${d.driverReady.length}</b><small>активных профилей с вместимостью</small></div></div>${d.routeRisks.length||d.incomplete.length?`<div class="smart-report-actions"><b>Следующие действия:</b>${d.routeRisks.slice(0,3).map(x=>`<span>• ${escapeHtml(x.def.displayDistrict||'Рейс')}: ${escapeHtml([...(x.a.vehicle?.blocked?['нет подходящей машины']:[]),...(x.a.cargoRules?.conflicts||[]),...(x.a.cargoRules?.missingPassports?.length?['неполные паспорта']:[])].join('; ')||'нужна ручная проверка')}</span>`).join('')}${d.incomplete.length?`<span>• Заполнить правила перевозки у ${d.incomplete.length} товаров.</span>`:''}</div>`:''}`}
  const renderReportV597=renderReport;
  renderReport=function(){renderReportV597();renderSmartReportInsights()};

  /* Настройки программы и прозрачность автоматизации. */
  function ensureSmartProgramSettings(){const grid=document.querySelector('#programSettingsView .settings-grid');if(!grid||$('smartProgramSettings'))return;const panel=document.createElement('div');panel.id='smartProgramSettings';panel.className='settings-box span-2 smart-program-settings';panel.innerHTML=`<div class="driver-payment-head"><div><h3>Поведение программы и автоматизация</h3><p>Общие правила интерфейса, самостоятельности системы, резервирования и объяснения решений.</p></div><div class="moscow-zone-badge">UTC+3 · Europe/Moscow</div></div><div class="smart-rule-grid"><div class="field"><label>Уровень автоматизации</label><select id="programAutomationLevel"><option value="cautious">Осторожный</option><option value="balanced">Сбалансированный</option><option value="autonomous">Максимально самостоятельный</option></select></div><div class="field"><label>Плотность интерфейса</label><select id="programInterfaceDensity"><option value="comfortable">Комфортная</option><option value="compact">Компактная</option></select></div><div class="field"><label>Напоминать о копии через, дней</label><input id="programBackupDays" min="1" max="90" step="1" type="number"/></div><div class="field"><label>Раздел при запуске</label><select id="programDefaultView"><option value="orders">Заказы</option><option value="trips">Рейсы</option><option value="products">Товары</option><option value="reports">Отчётность</option></select></div></div><div class="handling-grid"><label class="handling-check"><input id="programAutoOpenIssues" type="checkbox"/> Автоматически раскрывать найденные риски</label><label class="handling-check"><input id="programDecisionExplanations" type="checkbox"/> Объяснять автоматические решения</label><label class="handling-check"><input id="programAutosaveIndicator" type="checkbox"/> Показывать состояние автосохранения</label><label class="handling-check"><input id="programCompactLargeLists" type="checkbox"/> Уплотнять большие списки</label></div><div class="program-health-grid" id="smartProgramHealth"></div><div class="route-rules-footer"><div class="route-rules-formula"><b>Время:</b> все календарные даты и отображаемое время фиксированы по Москве; системные timestamp хранятся безопасно в ISO.</div><button class="btn-primary" data-jf-onclick="saveSmartProgramSettings()" type="button">Сохранить поведение программы</button></div>`;grid.prepend(panel)}
  function fillSmartProgramSettings(){ensureSmartProgramSettings();const x={...smartDefaultProgram(),...(settings.program||{})},map={programAutomationLevel:x.automationLevel,programInterfaceDensity:x.interfaceDensity,programBackupDays:x.backupReminderDays,programDefaultView:x.defaultView};for(const[id,v]of Object.entries(map))if($(id))$(id).value=v;for(const[id,key]of [['programAutoOpenIssues','autoOpenIssues'],['programDecisionExplanations','decisionExplanations'],['programAutosaveIndicator','autosaveIndicator'],['programCompactLargeLists','compactLargeLists']])if($(id))$(id).checked=!!x[key];applyProgramAppearance();renderSmartProgramHealth()}
  function applyProgramAppearance(){document.documentElement.dataset.density=settings.program?.interfaceDensity||'comfortable';document.body.classList.toggle('smart-compact-lists',settings.program?.compactLargeLists===true)}
  function renderSmartProgramHealth(){const box=$('smartProgramHealth');if(!box)return;const last=settings.program?.lastBackupAt,requested=settings.program?.lastBackupRequestedAt,days=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):null,kind=({manual:'ручная',safety:'страховочная',server:'серверная'})[settings.program?.lastBackupKind]||'подтверждённая',storageCount=orders.length+products.length+drivers.length+inventoryMovements.length;box.innerHTML=`<div><span>Часовой пояс</span><b>Москва, UTC+3</b></div><div><span>Последняя подтверждённая копия</span><b>${last?`${formatDateTime(last)} · ${kind} · ${days} дн. назад`:requested?`Запрошена ${formatDateTime(requested)}, но запись файлом не подтверждена`:'ещё не создавалась'}</b></div><div><span>Объектов в локальной базе</span><b>${storageCount.toLocaleString('ru-RU')}</b></div><div><span>Автосохранение</span><b>включено для всех рабочих разделов</b></div>`}
  window.saveSmartProgramSettings=function(){settings.program={...smartDefaultProgram(),automationLevel:$('programAutomationLevel')?.value||'balanced',interfaceDensity:$('programInterfaceDensity')?.value||'comfortable',backupReminderDays:clamp(Number($('programBackupDays')?.value||7),1,90),defaultView:$('programDefaultView')?.value||'orders',autoOpenIssues:!!$('programAutoOpenIssues')?.checked,decisionExplanations:!!$('programDecisionExplanations')?.checked,autosaveIndicator:!!$('programAutosaveIndicator')?.checked,compactLargeLists:!!$('programCompactLargeLists')?.checked,lastBackupAt:settings.program?.lastBackupAt||'',lastBackupKind:settings.program?.lastBackupKind||'',lastBackupPath:settings.program?.lastBackupPath||'',lastBackupRequestedAt:settings.program?.lastBackupRequestedAt||'',demoCargoTemplatesVersion:Number(settings.program?.demoCargoTemplatesVersion||0),timezone:MSK_TZ};persistSettings();applyProgramAppearance();renderSmartProgramHealth();alert('Настройки поведения программы сохранены.')}
  const renderProgramSettingsV597=renderProgramSettings;
  renderProgramSettings=function(){renderProgramSettingsV597();fillSmartProgramSettings()};
  const exportBackupV597=exportBackup__implV595;
  exportBackup__implV595=async function(){const result=await exportBackupV597.apply(this,arguments);settings.program={...smartDefaultProgram(),...(settings.program||{})};if(result?.confirmed){settings.program.lastBackupAt=result.at||new Date().toISOString();settings.program.lastBackupKind=result.kind||'manual'}else settings.program.lastBackupRequestedAt=new Date().toISOString();persistSettings();renderSmartProgramHealth();return result};

  /* Улучшение вкладки товаров: категории, готовность и грузовые риски. */
  function ensureProductsIntelligence(){const summary=$('productsSummary');if(!summary||$('productIntelligencePanel'))return;const panel=document.createElement('div');panel.id='productIntelligencePanel';panel.className='product-intelligence-panel';summary.after(panel)}
  function renderProductsIntelligence(){ensureProductsIntelligence();const panel=$('productIntelligencePanel');if(!panel)return;const cats=currentCategories().map(category=>{const rows=products.filter(p=>p.category===category),ready=rows.filter(p=>productCompleteness(p).percent>=75&&p.securingRule&&p.handlingClass).length;return{category,count:rows.length,ready}}).filter(x=>x.count).sort((a,b)=>b.count-a.count),missing=products.filter(p=>!p.handlingClass||!p.securingRule||!p.weightKg||(!p.volumeM3&&!p.transportLengthMm)),manual=products.filter(p=>p.manualTransportCheck),special=products.filter(p=>p.requiresOpenBody||p.requiresTailLift||p.requiresSideAccess||p.crewRequired>1);panel.innerHTML=`<div class="product-intelligence-head"><div><b>Готовность номенклатуры к автоматической логистике</b><span>Правила товара используются в заказе, рейсе, подборе машины и отчётности.</span></div><div class="product-intelligence-kpis"><span class="${missing.length?'warn':'good'}">Неполных паспортов: <b>${missing.length}</b></span><span>Ручная проверка: <b>${manual.length}</b></span><span>Спецтребования: <b>${special.length}</b></span></div></div><div class="category-chips">${cats.slice(0,12).map(x=>`<button type="button" data-product-category="${escapeAttr(x.category)}"><b>${escapeHtml(x.category)}</b><span>${x.count} поз. · готово ${x.ready}</span></button>`).join('')}</div>`;panel.querySelectorAll('[data-product-category]').forEach(button=>button.addEventListener('click',()=>{const filter=$('productCategoryFilter');if(filter)filter.value=button.dataset.productCategory||'';renderProducts()}))}
  const renderProductsV597=renderProducts__implV595;
  renderProducts__implV595=function(){renderProductsV597();renderProductsIntelligence()};

  /* Показ причин в карточке рейса без переписывания основного рендера. */
  const renderTripsPreviewV597=renderTripsPreview__implV595;
  renderTripsPreview__implV595=function(){const out=renderTripsPreviewV597.apply(this,arguments);requestAnimationFrame(()=>{document.querySelectorAll('.route-card').forEach(card=>{const id=card.dataset.routeId||card.getAttribute('data-route-id')||(card.getAttribute('data-jf-onclick')||'').match(/['"]([^'"]+)['"]/)?.[1],def=routeState().allDefs.find(x=>x.id===id);if(!def||card.querySelector('.smart-route-reasons'))return;const a=assessRouteOrders(def.orders);if(!settings.smartRoute?.showDecisionReasons||(!a.manualReview&&!a.hardViolation))return;const reasons=[];if(a.vehicle?.blocked)reasons.push('нет подходящего автомобиля');if(a.cargoRules?.conflicts?.length)reasons.push(...a.cargoRules.conflicts.slice(0,2));if(a.cargoRules?.missingPassports?.length)reasons.push(`неполных паспортов: ${a.cargoRules.missingPassports.length}`);if(a.cargoRules?.manualChecks)reasons.push(`ручных проверок: ${a.cargoRules.manualChecks}`);const box=document.createElement('div');box.className=`smart-route-reasons ${a.hardViolation?'bad':'warn'}`;box.innerHTML=`<b>${a.hardViolation?'Автоматическое формирование ограничено':'Нужна проверка логиста'}</b><span>${escapeHtml(reasons.join(' · ')||'нестандартный груз')}</span>`;(card.querySelector('.route-card-body')||card).appendChild(box)})});return out};


  /* Реальная адаптация: самообучение на закрытых рейсах, приоритет выгрузки и рабочие настройки. */
  function median(values=[]){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 1;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
  function routeLearningProfile(){
    const distance=[],time=[];
    for(const row of asArray(typeof routeArchives!=='undefined'?routeArchives:[])){
      const plannedKm=Math.max(0,Number(row?.planSnapshot?.roundDistance||row?.planSnapshot?.distance||0)/1000),actualKm=Math.max(0,Number(row?.actualKm||0));
      if(plannedKm>1&&actualKm>0){const ratio=actualKm/plannedKm;if(ratio>=.65&&ratio<=1.7)distance.push(ratio)}
      const plannedMin=Math.max(0,Number(row?.planSnapshot?.totalWithServiceMin||0)),departed=new Date(row?.departedAt||0).getTime(),closed=new Date(row?.closedAt||row?.returnedAt||0).getTime();
      if(plannedMin>10&&Number.isFinite(departed)&&Number.isFinite(closed)&&closed>departed){const ratio=((closed-departed)/60000)/plannedMin;if(ratio>=.65&&ratio<=1.8)time.push(ratio)}
    }
    const enough=Math.max(distance.length,time.length)>=3;
    return{samples:Math.max(distance.length,time.length),distanceSamples:distance.length,timeSamples:time.length,distanceFactor:enough?clamp(median(distance),.85,1.3):1,timeFactor:enough?clamp(median(time),.9,1.35):1,active:enough&&settings.smartRoute?.adaptiveLearningEnabled!==false}
  }
  window.routeLearningProfile=routeLearningProfile;

  function smartItemDimensions(item={}){return{
    length:Math.max(0,Number(item.transportLengthMm||item.lengthMm||0))/1000,
    width:Math.max(0,Number(item.transportWidthMm||item.widthMm||0))/1000,
    height:Math.max(0,Number(item.transportHeightMm||item.heightMm||0))/1000
  }}
  function smartItemFitsDriver(item={},driver={}){
    const d=smartItemDimensions(item),body={length:Math.max(0,Number(driver.bodyLength||0)),width:Math.max(0,Number(driver.bodyWidth||0)),height:Math.max(0,Number(driver.bodyHeight||0))};
    if(!d.length&&!d.width&&!d.height)return true;
    const normal=typeof cargoItemFitsBody==='function'&&cargoItemFitsBody({lengthM:d.length,widthM:d.width,heightM:d.height,orientation:item.loadOrientation||'any'},driver);if(normal)return true;
    const open=driver.openTop||driver.bodyType==='board'||driver.bodyType==='tent',overhang=Math.max(0,Number(driver.allowedOverhangMm||0))/1000;
    const longFit=open&&d.length<=body.length+overhang+.001&&d.width<=body.width*.99+.001&&(driver.openTop||d.height<=body.height+.001);
    return Boolean(longFit)
  }
  const driverFitForRouteSmartDimensions=driverFitForRoute;
  driverFitForRoute=function(driver,list=[]){
    const result=driverFitForRouteSmartDimensions(driver,list),rules=result.smartRules||smartCargoRules(list),dimensionOk=rules.items.every(item=>smartItemFitsDriver(item,driver));
    const reasons=asArray(result.reasons).filter(reason=>!dimensionOk||!/габарит|ориентац/i.test(reason));
    if(!dimensionOk&&!reasons.some(x=>/габарит|ориентац/i.test(x)))reasons.push('габариты, допустимый свес или ориентация груза не подходят кузову');
    const fits=Boolean((!result.hasData||dimensionOk)&&result.volumeOk!==false&&result.weightOk!==false&&!reasons.length);
    return{...result,dimensionOk,lengthOk:dimensionOk,widthOk:dimensionOk,heightOk:dimensionOk,fits:result.hasData?fits:true,reasons}
  };

  function orderUnloadBias(order={}){let bias=0;for(const item of asArray(order.items)){if(item.unloadingPriority==='first'||item.loadingSequence==='last')bias-=2;if(item.unloadingPriority==='last'||item.loadingSequence==='first')bias+=2}return clamp(bias,-6,6)}
  function smartSequencePenalty(seq,def){const n=Math.max(1,seq.length-1);let penalty=0;seq.forEach((idx,pos)=>{const bias=orderUnloadBias(def.orders[idx-1]);if(!bias)return;const target=bias<0?0:n;penalty+=Math.abs(pos-target)*Math.abs(bias)*150});return penalty}
  const optimizeRouteSequenceSmartBase=optimizeRouteSequence;
  optimizeRouteSequence=function(def,matrix){
    const base=optimizeRouteSequenceSmartBase(def,matrix),prioritized=base.filter(idx=>orderUnloadBias(def.orders[idx-1])!==0);if(!prioritized.length||base.length<2)return base;
    const baseRoad=routeObjective(base,matrix),maxDetour=clamp(Number(settings.smartRoute?.maxDetourPct??25),0,100),candidates=[base];
    let sorted=[...base].sort((a,b)=>orderUnloadBias(def.orders[a-1])-orderUnloadBias(def.orders[b-1])||base.indexOf(a)-base.indexOf(b));candidates.push(sorted);
    for(const idx of prioritized){const rest=base.filter(x=>x!==idx),bias=orderUnloadBias(def.orders[idx-1]),positions=bias<0?[0,Math.min(1,rest.length)]:[rest.length,Math.max(0,rest.length-1)];for(const pos of positions)candidates.push([...rest.slice(0,pos),idx,...rest.slice(pos)])}
    let best=base,bestScore=baseRoad+smartSequencePenalty(base,def);for(const candidate of candidates){const road=routeObjective(candidate,matrix),detour=baseRoad>0?(road/baseRoad-1)*100:0;if(detour>maxDetour+.01)continue;const score=road+smartSequencePenalty(candidate,def);if(score+1<bestScore){best=candidate;bestScore=score}}
    return best
  };

  const buildScheduleSmartBase=buildSchedule;
  buildSchedule=function(seq,matrix,def,startTime=settings.routeStartTime){
    const cfg=settings.smartRoute||smartDefaultRoute(),learning=routeLearningProfile(),traffic=1+clamp(Number(cfg.trafficBufferPct||0),0,100)/100,learn=learning.active?learning.timeFactor:1,factor=traffic*learn;
    if(Math.abs(factor-1)<.001)return buildScheduleSmartBase(seq,matrix,def,startTime);
    const adjusted={...matrix,duration:asArray(matrix?.duration).map(row=>asArray(row).map(value=>Math.max(0,Number(value||0))*factor))},out=buildScheduleSmartBase(seq,adjusted,def,startTime);
    return{...out,smartTravelFactor:factor,trafficBufferPct:Number(cfg.trafficBufferPct||0),learningFactor:learn}
  };

  const assessRouteOrdersSmartBase=assessRouteOrders;
  assessRouteOrders=function(list=[]){
    const out=assessRouteOrdersSmartBase(list),cfg=settings.smartRoute||smartDefaultRoute(),rules=out.cargoRules||smartCargoRules(list),distanceKm=Math.max(0,Number(out.estimate?.distance||0)/1000),radials=list.map(o=>haversine(settings.warehouse,o.geo)),baseline=Math.max(1,(radials.length?Math.max(...radials):0)*(routeReturnsToWarehouse()?2:1)),detourPct=Math.max(0,(distanceKm/baseline-1)*100),crewShortage=rules.crewRequired>Number(cfg.defaultCrewAvailable||1),manualScore=Number(out.manualScore||0)+(crewShortage?1:0)+(detourPct>Number(cfg.maxDetourPct||25)?1:0),manualReview=out.manualReview||manualScore>=Number(cfg.manualReviewThreshold||2);
    return{...out,detourPct,crewShortage,manualScore,manualReview,hardViolation:out.hardViolation}
  };
  const routePlanPenaltySmartBase=routePlanPenalty;
  routePlanPenalty=function(a){let score=routePlanPenaltySmartBase(a);if(!a)return score;const cfg=settings.smartRoute||smartDefaultRoute();score+=Math.max(0,Number(a.detourPct||0)-Number(cfg.maxDetourPct||25))*8;if(a.crewShortage)score+=180;return score};

  const calculateRouteSmartBase=calculateRoute;
  calculateRoute=async function(def){const plan=await calculateRouteSmartBase(def),profile=routeLearningProfile(),assessment=assessRouteOrders(def.orders);plan.smartAutomation={timezone:MSK_TZ,trafficBufferPct:Number(settings.smartRoute?.trafficBufferPct||0),learning:profile,detourPct:assessment.detourPct,cargoRules:assessment.cargoRules};plan.rules=routeRuleMetrics(plan,def.orders.length);return plan};

  function smartProductRulesSummary(p={}){const tags=[];if(p.loadingSequence==='first')tags.push('грузить первым');if(p.loadingSequence==='last')tags.push('грузить последним');if(p.unloadingPriority==='first')tags.push('выгружать первым');if(p.unloadingPriority==='last')tags.push('выгружать последним');if(p.requiresOpenBody)tags.push('открытый кузов');if(p.requiresSideAccess)tags.push('боковая загрузка');if(p.requiresTailLift)tags.push('гидроборт');if(Number(p.crewRequired||1)>1)tags.push(`экипаж ${p.crewRequired}`);if(p.floorProtection)tags.push('защита пола');return tags}
  function smartProductPassportHtml(p={}){const tags=smartProductRulesSummary(p),complete=p.weightKg>0&&(p.volumeM3>0||p.transportLengthMm>0)&&p.handlingClass&&p.securingRule;return`<section class="smart-product-passport"><div class="smart-product-passport-head"><div><h3>Умные правила погрузки</h3><p>Автоматически учитываются при формировании рейса, порядке выгрузки и подборе автомобиля.</p></div><span class="badge ${complete?'badge-green':'badge-warn'}">${complete?'Паспорт готов':'Требует заполнения'}</span></div><div class="smart-product-passport-tags">${tags.length?tags.map(x=>`<span>${escapeHtml(x)}</span>`).join(''):'<span>Специальные требования не заданы</span>'}</div><div class="smart-product-passport-grid"><div><span>Категория</span><b>${escapeHtml([p.category,p.subcategory].filter(Boolean).join(' · ')||'Не указана')}</b></div><div><span>Зона кузова</span><b>${escapeHtml(p.loadZone||'any')}</b></div><div><span>Совместимость</span><b>${escapeHtml(p.incompatibleGroups?`не объединять: ${p.incompatibleGroups}`:'ограничений нет')}</b></div><div><span>Фиксация</span><b>${escapeHtml(p.securingRule||'не заполнена')}</b></div></div></section>`}
  const openProductDetailsSmartBase=openProductDetails__implV595;
  openProductDetails__implV595=function(id){const out=openProductDetailsSmartBase(id),p=products.find(x=>x.id===id),body=$('productDetailBody');if(p&&body&&!body.querySelector('.smart-product-passport'))body.insertAdjacentHTML('afterbegin',smartProductPassportHtml(p));return out};
  const renderProductsSmartBase=renderProducts__implV595;
  renderProducts__implV595=function(){const out=renderProductsSmartBase();document.querySelectorAll('.warehouse-row').forEach(row=>{const id=(row.getAttribute('data-jf-onclick')||'').match(/openProductDetails\('([^']+)'\)/)?.[1],p=products.find(x=>x.id===id),main=row.querySelector('.warehouse-main');if(!p||!main||main.querySelector('.smart-product-row-rules'))return;const tags=smartProductRulesSummary(p).slice(0,4);main.insertAdjacentHTML('beforeend',`<div class="smart-product-row-rules">${tags.length?tags.map(x=>`<span>${escapeHtml(x)}</span>`).join(''):'<span class="muted">обычная погрузка</span>'}</div>`) });return out};

  let autosaveTimer=0,defaultViewApplied=false,persistWrapped=false;
  function installAutosaveIndicator(){const host=document.querySelector('.actions')||document.querySelector('.nav');if(!host||$('smartAutosaveState'))return;const el=document.createElement('div');el.id='smartAutosaveState';el.className='smart-autosave-state';el.innerHTML='<i></i><span>Автосохранение</span><b>готово</b>';host.prepend(el);updateAutosaveVisibility()}
  function updateAutosaveVisibility(){const el=$('smartAutosaveState');if(el)el.hidden=settings.program?.autosaveIndicator===false}
  function markAutosave(ok=true){const el=$('smartAutosaveState');if(!el||settings.program?.autosaveIndicator===false)return;clearTimeout(autosaveTimer);el.classList.toggle('error',!ok);el.classList.add('saving');el.querySelector('b').textContent=ok?'сохранение…':'ошибка';autosaveTimer=setTimeout(()=>{el.classList.remove('saving');el.querySelector('b').textContent=ok?`${new Intl.DateTimeFormat('ru-RU',{timeZone:MSK_TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date())} МСК`:'не сохранено'},240)}
  function installPersistIndicators(){if(persistWrapped)return;persistWrapped=true;const wrap=(fn)=>function(){let result;try{result=fn.apply(this,arguments)}catch(err){markAutosave(false);throw err}if(result&&typeof result.then==='function')result.then(x=>markAutosave(x!==false)).catch(()=>markAutosave(false));else markAutosave(result!==false);return result};persistOrders=wrap(persistOrders);persistSettings=wrap(persistSettings);persistRoutes=wrap(persistRoutes);persistRouteAssignments=wrap(persistRouteAssignments);persistDrivers=wrap(persistDrivers);persistProducts=wrap(persistProducts);persistInventoryMovements=wrap(persistInventoryMovements);persistRouteDrivers=wrap(persistRouteDrivers);persistRouteLocks=wrap(persistRouteLocks);persistRouteOverrides=wrap(persistRouteOverrides);persistReporting=wrap(persistReporting)}
  function installMoscowInputHints(){document.querySelectorAll('input[type="time"]').forEach(el=>{el.title='Время по Москве (МСК)';const field=el.closest('.field');if(field&&!field.querySelector('.time-zone-hint'))field.insertAdjacentHTML('beforeend','<div class="field-help time-zone-hint">Московское время (МСК)</div>')});document.querySelectorAll('input[type="date"]').forEach(el=>{el.lang='ru';el.title='Календарная дата по Москве'})}
  function decorateSmartRouteIssues(){setTimeout(()=>document.querySelectorAll('.smart-route-reasons').forEach(box=>{box.classList.toggle('collapsed',settings.program?.autoOpenIssues===false);if(!box.dataset.smartToggle){box.dataset.smartToggle='1';box.tabIndex=0;box.title='Нажмите, чтобы раскрыть или свернуть';box.addEventListener('click',()=>box.classList.toggle('collapsed'));box.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();box.classList.toggle('collapsed')}})}}),30)}
  const renderTripsPreviewProgramBase=renderTripsPreview__implV595;
  renderTripsPreview__implV595=function(){const out=renderTripsPreviewProgramBase.apply(this,arguments);decorateSmartRouteIssues();return out};
  function applyDefaultViewOnce(){if(defaultViewApplied)return;defaultViewApplied=true;const view=settings.program?.defaultView||'orders';setTimeout(()=>showView(view),100)}

  const previewSmartRouteSettingsLearningBase=previewSmartRouteSettings;
  previewSmartRouteSettings=function(){previewSmartRouteSettingsLearningBase();const target=$('smartRoutePreview'),profile=routeLearningProfile();if(target&&!target.querySelector('.smart-learning-preview'))target.insertAdjacentHTML('beforeend',`<div class="smart-learning-preview"><b>${profile.active?'Самокалибровка активна':'Самокалибровка ожидает данные'}</b><span>закрытых рейсов: ${profile.samples} · коэффициент времени ${profile.timeFactor.toLocaleString('ru-RU',{maximumFractionDigits:2})} · пробега ${profile.distanceFactor.toLocaleString('ru-RU',{maximumFractionDigits:2})}</span></div>`)};
  const renderSmartReportInsightsLearningBase=renderSmartReportInsights;
  renderSmartReportInsights=function(){renderSmartReportInsightsLearningBase();const grid=$('smartReportInsights')?.querySelector('.smart-report-grid'),profile=routeLearningProfile();if(grid&&!grid.querySelector('.smart-learning-card'))grid.insertAdjacentHTML('beforeend',`<div class="smart-report-card smart-learning-card ${profile.active?'good':'warn'}"><span>Самокалибровка</span><b>${profile.samples}</b><small>${profile.active?`время ×${profile.timeFactor.toLocaleString('ru-RU',{maximumFractionDigits:2})} · пробег ×${profile.distanceFactor.toLocaleString('ru-RU',{maximumFractionDigits:2})}`:'нужно минимум 3 закрытых рейса'}</small></div>`)};
  const renderSmartProgramHealthBase=renderSmartProgramHealth;
  renderSmartProgramHealth=function(){renderSmartProgramHealthBase();const box=$('smartProgramHealth'),last=settings.program?.lastBackupAt,days=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):null,due=days===null||days>=Number(settings.program?.backupReminderDays||7);if(box){const backup=box.children[1];if(backup)backup.classList.toggle('health-warn',due);box.insertAdjacentHTML('beforeend',`<div><span>Логика маршрутов</span><b>${settings.smartRoute?.adaptiveLearningEnabled!==false?'адаптивная самокалибровка включена':'фиксированные правила'}</b></div>`)}}

  const saveSmartProgramSettingsActualBase=saveSmartProgramSettings;
  saveSmartProgramSettings=function(){settings.program={...smartDefaultProgram(),automationLevel:$('programAutomationLevel')?.value||'balanced',interfaceDensity:$('programInterfaceDensity')?.value||'comfortable',backupReminderDays:clamp(Number($('programBackupDays')?.value||7),1,90),defaultView:$('programDefaultView')?.value||'orders',autoOpenIssues:!!$('programAutoOpenIssues')?.checked,decisionExplanations:!!$('programDecisionExplanations')?.checked,autosaveIndicator:!!$('programAutosaveIndicator')?.checked,compactLargeLists:!!$('programCompactLargeLists')?.checked,lastBackupAt:settings.program?.lastBackupAt||'',demoCargoTemplatesVersion:Number(settings.program?.demoCargoTemplatesVersion||0),timezone:MSK_TZ};settings.smartRoute={...smartDefaultRoute(),...(settings.smartRoute||{}),automationMode:settings.program.automationLevel,showDecisionReasons:settings.program.decisionExplanations};persistSettings();applyProgramAppearance();updateAutosaveVisibility();renderSmartProgramHealth();renderTripsPreview();alert('Настройки поведения программы сохранены и применены.')};


  /* Защита новых интеллектуальных настроек при демонстрации, импорте старых копий и сбросах. */
  function neutralSmartValue(key,value){
    if(value===undefined||value===null||value==='')return true;
    if(key==='loadZone')return value==='any';
    if(key==='loadingSequence')return value==='middle';
    if(key==='unloadingPriority')return value==='normal';
    if(key==='crewRequired')return Number(value||1)<=1;
    if(['stackWeightLimitKg','maxTiltDeg','strapCount'].includes(key))return Number(value||0)<=0;
    if(['requiresOpenBody','requiresSideAccess','requiresTailLift','requiresTwoPeople'].includes(key))return value===false;
    return false;
  }
  function enrichDemonstrationProduct(product){
    const defaults=CATEGORY_LIBRARY[product?.category]?.defaults||{};
    const enriched={...product};
    for(const [key,value] of Object.entries(defaults)){
      if(neutralSmartValue(key,enriched[key]))enriched[key]=cloneValue(value);
    }
    return normalizeProduct(enriched);
  }
  function restoreSmartRuntimeAfterDataReplacement({enrichDemo=false}={}){
    ensureSmartSettings();
    products=products.map(enrichDemo?enrichDemonstrationProduct:normalizeProduct);
    if(enrichDemo)settings.program.demoCargoTemplatesVersion=2;
    drivers=drivers.map(normalizeDriver);
    persistSettings();persistProducts();persistDrivers();
    renderProductDatalist();fillFilters();applyProgramAppearance();updateAutosaveVisibility();installMoscowInputHints();
    renderAll();
  }
  const createDemonstrationScenarioSmartV598=createDemonstrationScenario__implV595;
  createDemonstrationScenario__implV595=function(options={}){
    const result=createDemonstrationScenarioSmartV598(options);
    restoreSmartRuntimeAfterDataReplacement({enrichDemo:true});
    return result;
  };
  const importBackupFileSmartV598=importBackupFile__implV595;
  importBackupFile__implV595=async function(event){
    const result=await importBackupFileSmartV598(event);
    restoreSmartRuntimeAfterDataReplacement();
    return result;
  };

  function initSmartV598(){
    ensureSmartSettings();
    if(typeof isDemonstrationMode==='function'&&isDemonstrationMode()&&Number(settings.program.demoCargoTemplatesVersion||0)<2){
      products=products.map(enrichDemonstrationProduct);drivers=drivers.map(normalizeDriver);settings.program.demoCargoTemplatesVersion=2;persistProducts();persistDrivers();persistSettings();
    }
    ensureSmartProductModalFields();ensureDriverCapabilities();ensureSmartRouteSettingsPanel();ensureSmartProgramSettings();installMoscowClock();installAutosaveIndicator();installPersistIndicators();installMoscowInputHints();applyProgramAppearance();updateAutosaveVisibility();
    document.documentElement.dataset.timezone='Europe/Moscow';
    const dateInputs=document.querySelectorAll('input[type="date"]');dateInputs.forEach(x=>x.lang='ru');
    renderProductDatalist();fillFilters();
    if($('deliveryDate')&&!$('deliveryDate').value)$('deliveryDate').value=todayISO();
    if($('movementDate')&&!$('movementDate').value)$('movementDate').value=todayISO();
    runDataDiagnostics(false);applyDefaultViewOnce();
  }
  window.JustFunSmartProgramV783=Object.freeze({renderHealth:()=>renderSmartProgramHealth()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSmartV598);else initSmartV598();
})();
