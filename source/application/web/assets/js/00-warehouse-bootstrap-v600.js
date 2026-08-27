/* JustFun Orders & Logistics 7.8.3 — early multi-warehouse storage bootstrap */
(function(){
  'use strict';
  const LEGACY_REGISTRY_KEY='teplitsa_warehouses_registry_v600';
  const LEGACY_MIGRATION_KEY='teplitsa_warehouses_migration_v600';
  const LEGACY_PREFIX='teplitsa_wh_v600__';
  const DESKTOP_DEMO=window.JustFunDesktop?.bootstrapEdition==='demo';
  const COMPANY_ID=String(window.JustFunDesktop?.bootstrapCompanyId||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
  const COMPANY_SCOPE=DESKTOP_DEMO?'demo':(COMPANY_ID||'signed-out');
  const SCOPE_PREFIX=`teplitsa_company_${COMPANY_SCOPE}__`;
  const REGISTRY_KEY=SCOPE_PREFIX+'warehouses_registry_v600';
  const MIGRATION_KEY=SCOPE_PREFIX+'warehouses_migration_v600';
  const PREFIX=SCOPE_PREFIX+'wh_v600__';
  const LEGACY_DEMO_PREFIX='orders_teplitsa_demonstration_v1__';
  const LEGACY_SCOPE_CLAIM_KEY='teplitsa_company_scope_claimed_v783';
  const LEGACY_KEYS=[
    'orders_2gis_tms_v1','orders_osm_leaflet_settings_v1','orders_osm_leaflet_routes_v1',
    'orders_osm_leaflet_route_assignments_v1','orders_osm_leaflet_route_catalog_v1',
    'orders_osm_leaflet_drivers_v1','orders_osm_leaflet_products_v1',
    'orders_osm_leaflet_inventory_movements_v1','orders_osm_leaflet_route_drivers_v1',
    'orders_osm_leaflet_route_locks_v1','orders_osm_leaflet_reporting_v1',
    'orders_osm_leaflet_route_overrides_v1','orders_osm_route_executions_v5',
    'orders_osm_route_archive_v5','orders_osm_warehouse_reservations_v5',
    'teplitsa_route_engine_v570','teplitsa_route_manual_sequences_v596',
    'orders_teplitsa_qa_v595','orders_teplitsa_transaction_v595'
  ];
  const raw={
    get:key=>localStorage.getItem(key),
    set:(key,value)=>localStorage.setItem(key,value),
    remove:key=>localStorage.removeItem(key)
  };
  function parse(value,fallback){try{const out=JSON.parse(value);return out&&typeof out==='object'?out:fallback}catch{return fallback}}
  function uid(){try{return crypto.randomUUID()}catch{return'wh-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}}
  function safeCode(value){return String(value||'СКЛ').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g,'').slice(0,3)||'СКЛ'}
  function ownsGlobalLegacy(){return!DESKTOP_DEMO&&Boolean(COMPANY_ID)&&String(raw.get(LEGACY_SCOPE_CLAIM_KEY)||'')===COMPANY_ID}
  function legacyWarehouse(){
    const saved=ownsGlobalLegacy()?parse(raw.get('orders_osm_leaflet_settings_v1'),{}):{},warehouse=saved.warehouse&&typeof saved.warehouse==='object'?saved.warehouse:{};
    const address=String(warehouse.address||'Павловск, Санкт-Петербург');
    const spb=/петербург|павловск/i.test(address);
    return{id:uid(),name:spb?'Склад Санкт-Петербург':'Основной склад',code:spb?'СПБ':'СКЛ',address,lat:Number(warehouse.lat)||59.685528,lon:Number(warehouse.lon)||30.434454,timezone:'Europe/Moscow',status:'active',catalogMode:'catalog',origin:'local-default',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  }
  function normalizeRegistry(value){
    const list=Array.isArray(value?.warehouses)?value.warehouses.filter(x=>x&&x.id):[];
    const serverAuthoritative=value?.serverRegistryInitialized===true||value?.serverAuthoritativeEmpty===true;
    if(!list.length&&serverAuthoritative)return{...value,version:2,activeWarehouseId:'',warehouses:[],serverAuthoritativeEmpty:true};
    if(!list.length){const first=legacyWarehouse();return{version:2,activeWarehouseId:first.id,warehouses:[first],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}
    const warehouses=list.map((x,index)=>({...x,id:String(x.id),name:String(x.name||'Склад'),code:safeCode(x.code),status:x.status==='archived'?'archived':'active',catalogMode:x.catalogMode==='catalog'?'catalog':x.catalogMode==='empty'?'empty':index===0?'catalog':'empty',origin:String(x.origin||'local')}));
    if(!serverAuthoritative&&!warehouses.some(x=>x.status!=='archived'))warehouses[0].status='active';
    let active=String(value.activeWarehouseId||'');if(!warehouses.some(x=>x.id===active&&x.status!=='archived'))active=warehouses.find(x=>x.status!=='archived')?.id||'';
    return{...value,version:2,activeWarehouseId:active,warehouses,serverAuthoritativeEmpty:false};
  }
  function migrateLegacyCompanyScope(){
    if(DESKTOP_DEMO||!COMPANY_ID)return;
    const claimKey=LEGACY_SCOPE_CLAIM_KEY,journalKey=SCOPE_PREFIX+'company_scope_migration_v783',claimed=String(raw.get(claimKey)||'');
    if(claimed&&claimed!==COMPANY_ID)return;
    const legacyRegistry=raw.get(LEGACY_REGISTRY_KEY);
    const legacyKeys=[];
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);
      if(key&&key.startsWith(LEGACY_PREFIX))legacyKeys.push(key);
    }
    const legacyMigration=raw.get(LEGACY_MIGRATION_KEY),globalLegacyPresent=LEGACY_KEYS.some(key=>raw.get(key)!==null||raw.get(LEGACY_DEMO_PREFIX+key)!==null)||raw.get('orders_teplitsa_demonstration_mode_v1')!==null||raw.get(LEGACY_DEMO_PREFIX+'scenario_version')!==null,existingJournal=parse(raw.get(journalKey),null);
    if(existingJournal&&String(existingJournal.companyId||'')!==COMPANY_ID)throw new Error('Журнал переноса старой базы относится к другой компании.');
    if(existingJournal?.state==='completed')return;
    if(legacyRegistry===null&&legacyMigration===null&&!legacyKeys.length&&!globalLegacyPresent&&!existingJournal)return;
    if(!claimed){raw.set(claimKey,COMPANY_ID);if(String(raw.get(claimKey)||'')!==COMPANY_ID)throw new Error('Не удалось закрепить старую локальную базу за компанией.')}
    const startedAt=String(existingJournal?.startedAt||new Date().toISOString());raw.set(journalKey,JSON.stringify({version:1,companyId:COMPANY_ID,state:'copying',startedAt,updatedAt:new Date().toISOString(),legacyPreserved:true}));
    if(legacyRegistry!==null&&raw.get(REGISTRY_KEY)===null)raw.set(REGISTRY_KEY,legacyRegistry);
    if(legacyMigration!==null&&raw.get(MIGRATION_KEY)===null)raw.set(MIGRATION_KEY,legacyMigration);
    for(const key of legacyKeys){
      const value=raw.get(key),target=PREFIX+key.slice(LEGACY_PREFIX.length);
      if(value!==null&&raw.get(target)===null)raw.set(target,value);
    }
    raw.set(journalKey,JSON.stringify({version:1,companyId:COMPANY_ID,state:'completed',startedAt,completedAt:new Date().toISOString(),legacyPreserved:true,copiedLegacyKeys:legacyKeys.length}));
  }
  migrateLegacyCompanyScope();
  let registry=normalizeRegistry(parse(raw.get(REGISTRY_KEY),null));
  raw.set(REGISTRY_KEY,JSON.stringify(registry));
  function envPrefix(warehouseId=registry.activeWarehouseId,environment){const env=environment||((raw.get(systemKey('demo_mode',warehouseId))==='1')?'demo':'live');return`${PREFIX}${warehouseId}__${env}__`}
  function dataKey(key,environment,warehouseId){return envPrefix(warehouseId,environment)+String(key)}
  function systemKey(name,warehouseId=registry.activeWarehouseId){return`${PREFIX}${warehouseId}__system__${String(name)}`}
  function isDemo(warehouseId=registry.activeWarehouseId){return DESKTOP_DEMO||raw.get(systemKey('demo_mode',warehouseId))==='1'}
  function assertContextChangeAllowed(detail){const guard=window.JustFunEntitySyncV783?.assertContextChangeAllowed;if(typeof guard==='function')guard(detail)}
  function setDemo(enabled,warehouseId=registry.activeWarehouseId){const value=DESKTOP_DEMO?true:Boolean(enabled),before=isDemo(warehouseId);if(before!==value)assertContextChangeAllowed({kind:'environment',warehouseId:String(warehouseId||''),from:before?'demo':'live',to:value?'demo':'live'});raw.set(systemKey('demo_mode',warehouseId),value?'1':'0')}
  function saveRegistry(next){const normalized=normalizeRegistry(next);if(String(normalized.activeWarehouseId||'')!==String(registry.activeWarehouseId||''))assertContextChangeAllowed({kind:'warehouse',fromWarehouseId:String(registry.activeWarehouseId||''),toWarehouseId:String(normalized.activeWarehouseId||'')});registry=normalized;registry.updatedAt=new Date().toISOString();raw.set(REGISTRY_KEY,JSON.stringify(registry));return registry}
  function getRegistry(){return JSON.parse(JSON.stringify(registry))}
  function activeWarehouse(){return getRegistry().warehouses.find(x=>x.id===registry.activeWarehouseId)||null}
  function migrateLegacy(){
    if(DESKTOP_DEMO||!COMPANY_ID||!ownsGlobalLegacy())return;const marker=parse(raw.get(MIGRATION_KEY),{});if(marker.completed){if(marker.companyId!==COMPANY_ID||Number(marker.scopeVersion)!==2)raw.set(MIGRATION_KEY,JSON.stringify({...marker,completed:true,companyId:COMPANY_ID,scopeVersion:2,upgradedAt:new Date().toISOString(),legacyPreserved:true}));return}
    const activeId=registry.activeWarehouseId;
    for(const key of LEGACY_KEYS){
      const legacy=raw.get(key),target=dataKey(key,'live',activeId);if(legacy!==null&&raw.get(target)===null)raw.set(target,legacy);
      const legacyDemo=raw.get(LEGACY_DEMO_PREFIX+key),targetDemo=dataKey(key,'demo',activeId);if(legacyDemo!==null&&raw.get(targetDemo)===null)raw.set(targetDemo,legacyDemo);
    }
    const legacyDemoFlag=raw.get('orders_teplitsa_demonstration_mode_v1');if(legacyDemoFlag==='1')setDemo(true,activeId);else if(raw.get(systemKey('demo_mode',activeId))===null)setDemo(false,activeId);
    const legacyScenario=raw.get(LEGACY_DEMO_PREFIX+'scenario_version');if(legacyScenario!==null&&raw.get(dataKey('scenario_version','demo',activeId))===null)raw.set(dataKey('scenario_version','demo',activeId),legacyScenario);
    raw.set(MIGRATION_KEY,JSON.stringify({completed:true,companyId:COMPANY_ID,scopeVersion:2,activeWarehouseId:activeId,at:new Date().toISOString(),legacyPreserved:true}));
  }
  if(DESKTOP_DEMO)raw.set(systemKey('demo_mode',registry.activeWarehouseId),'1');
  window.JustFunDesktop?.startupStage?.('warehouse-bootstrap',DESKTOP_DEMO?'demo-before-data':'stored-environment');
  migrateLegacy();
  window.TeplitsaWarehouseBootstrap={
    version:'7.8.3',registryKey:REGISTRY_KEY,prefix:PREFIX,raw,dataKey,systemKey,isDemo,setDemo,getRegistry,saveRegistry,activeWarehouse,
    setActive(id){const next=getRegistry();const target=next.warehouses.find(x=>x.id===id&&x.status!=='archived');if(!target)throw new Error('Склад не найден или архивирован');next.activeWarehouseId=id;saveRegistry(next);return target},
    databaseName(base,warehouseId=registry.activeWarehouseId,environment){return`${base}__${warehouseId}__${environment|| (isDemo(warehouseId)?'demo':'live')}`},
    companyScope:COMPANY_SCOPE,
    createWarehouseRecord(input={}){const hasLat=input.lat!==''&&input.lat!==null&&input.lat!==undefined,hasLon=input.lon!==''&&input.lon!==null&&input.lon!==undefined,lat=hasLat?Number(input.lat):null,lon=hasLon?Number(input.lon):null;return{id:uid(),name:String(input.name||'Новый склад').trim(),code:safeCode(input.code),address:String(input.address||'').trim(),lat:Number.isFinite(lat)&&lat>=-90&&lat<=90?lat:null,lon:Number.isFinite(lon)&&lon>=-180&&lon<=180?lon:null,timezone:'Europe/Moscow',status:'active',catalogMode:'empty',origin:'local',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}
  };
})();
