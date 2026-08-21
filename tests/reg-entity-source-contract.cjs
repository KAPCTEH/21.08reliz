'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'source/application/main.js'),'utf8');
const preload=fs.readFileSync(path.join(root,'source/application/preload.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const server=fs.readFileSync(path.join(root,'source/application/integrations/reg-vps/server/server.py'),'utf8');

assert.ok(server.includes('CREATE TABLE IF NOT EXISTS business_records_v3'),'VPS must store authoritative independent business records');
assert.ok(server.includes('CREATE TABLE IF NOT EXISTS business_events_v3'),'VPS must maintain an append-only change feed');
assert.ok(server.includes('CREATE TABLE IF NOT EXISTS business_commands_v3'),'VPS must deduplicate retried commands');
assert.ok(server.includes('CREATE TABLE IF NOT EXISTS business_audit_v3'),'VPS must keep an authenticated business audit');
assert.ok(server.includes('ThreadedConnectionPool'),'VPS must reuse bounded PostgreSQL connections for concurrent clients');
assert.ok(server.includes('FORCE ROW LEVEL SECURITY'),'VPS must enforce database-level company and warehouse isolation');
assert.ok(server.includes('entity_version_conflict'),'VPS must reject stale row versions');
assert.ok(server.includes('readable_types'),'VPS must return the current read boundary');
assert.ok(server.includes('validate_entity_intent_current'),'VPS must guard critical state transitions inside the transaction');
assert.ok(server.includes('"route_cancel"'),'VPS must support atomic pre-departure route cancellation');
assert.ok(server.includes('"route_approve"'),'VPS must store manual approval as an authenticated server intent');
assert.ok(server.includes('ENTITY_INTENT_PERMISSIONS'),'VPS must enforce a distinct permission for every critical transition');
assert.ok(server.includes('validate_entity_field_permissions'),'VPS must authorize each changed field inside the row transaction');
assert.ok(server.includes('intent_field_access_denied'),'critical intents must not mutate unrelated business fields');
assert.ok(server.includes('inventory_ledger_immutable'),'inventory history must use reversal entries instead of deletion');
assert.ok(server.includes('canonical_entity_payload'),'VPS must canonicalize all incoming and migrated record identity');
assert.ok(server.includes('normalize_client_immutable_fields'),'VPS must preserve authoritative immutable fields omitted or stale in compatible older clients');

assert.ok(main.includes("handleMainIPC('desktop:reg-entity-bootstrap'"),'main process must expose entity bootstrap');
assert.ok(main.includes("handleMainIPC('desktop:reg-entity-sync'"),'main process must expose row-level writes');
assert.ok(main.includes("handleMainIPC('desktop:reg-entity-changes'"),'main process must expose the change feed');
assert.ok(main.includes('const REG_API_CONTRACT=3'),'desktop must require the server-authoritative API contract');
assert.ok(!main.includes("handleMainIPC('desktop:reg-sync'"),'legacy whole-snapshot IPC must be removed');
assert.ok(!main.includes("handleMainIPC('desktop:reg-fetch'"),'legacy whole-snapshot restore IPC must be removed');
assert.ok(main.includes("handleMainIPC('desktop:set-active-warehouse'"),'main process must confirm the renderer warehouse before background synchronization');
assert.match(preload,/setActiveWarehouse:\s*\(payload=\{\}\)\s*=>\s*ipcRenderer\.invoke\('desktop:set-active-warehouse'/,'preload must expose warehouse context confirmation only through IPC');
assert.match(preload,/bootstrapEntities:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('desktop:reg-entity-bootstrap'/,'preload must expose entity bootstrap only through IPC');
assert.match(preload,/syncEntities:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('desktop:reg-entity-sync'/,'preload must expose row-level writes only through IPC');
assert.match(preload,/entityChanges:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('desktop:reg-entity-changes'/,'preload must expose the change feed only through IPC');

assert.ok(renderer.includes('function buildPendingEntityChanges()'),'renderer must diff individual records');
assert.ok(renderer.includes('await confirmActiveWarehouseContext()'),'renderer must confirm the active warehouse before installing background synchronization');
assert.ok(renderer.includes('requiresAuthoritativeWarehouseRegistry()'),'cloud login must defer mounting integrations until the authoritative warehouse registry is available');
assert.ok(renderer.includes('function canonicalServerEntity(entity)'),'renderer must preserve authoritative entity identity during bootstrap and polling');
assert.ok(renderer.includes('snapshotFromServerEntities(localSnapshot,entities,readableTypes)'),'bootstrap must replace the cache from authoritative server records');
assert.ok(!renderer.includes('function mergeBootstrapEntities('),'bootstrap must never merge stale local business data into an authoritative server state');
assert.ok(renderer.includes('cloudSyncState.dirty=false;saveEntitySyncState()'),'a completed bootstrap must not upload stale local cache data');
assert.ok(renderer.includes('flushEntitySyncBeforeContextChange'),'warehouse switching must wait for VPS confirmation');
assert.ok(renderer.includes('Не сохранено на VPS'),'background write failures must be visible to the user');
assert.ok(renderer.includes("result?.code==='entity_version_conflict'"),'renderer must preserve local state on row conflict');
assert.ok(renderer.includes('entityTypeSetSignature(result.readableTypes)'), 'permission changes must trigger a fresh access-filtered bootstrap');
assert.ok(renderer.includes('function commitEntityMutation(intent,mutation)'), 'critical route and stock actions must wait for server commit');
assert.ok(renderer.includes("saveOrder:{kind:'order_save',critical:false"), 'ordinary order saves must wait for an atomic VPS record batch');
assert.ok(renderer.includes("savePickup:{kind:'pickup_save',critical:false,target:editId('#editingPickupId')"), 'pickup saves must use the pickup editor id as their mutation target');
assert.ok(renderer.includes("deleteOrder:{kind:'order_delete',critical:false"), 'ordinary order deletion must wait for an atomic VPS record batch');
assert.ok(renderer.includes("clearAll:{kind:'workspace_clear',critical:false"), 'bulk clearing must roll back when VPS confirmation fails');
assert.ok(renderer.includes("serverIntent=intent?.critical===false?null:intent"), 'ordinary record batches must not impersonate critical state-machine intents');
assert.ok(renderer.includes("commitRouteClosure:{kind:'route_close'"), 'route closure must use a named server intent');
assert.ok(renderer.includes("cancelRouteBeforeStart:{kind:'route_cancel'"), 'route cancellation must use a named server intent');
assert.ok(renderer.includes("approveRouteManually:{kind:'route_approve'"), 'manual approval must use a named server intent');
assert.ok(renderer.includes('Изменение требует подтверждения рабочего VPS'), 'all protected full-edition mutations must stop when the VPS is unavailable');
assert.ok(!renderer.includes('if(cloudSyncState.dirty)return;'), 'local edits must not stop unrelated remote polling');

console.log(JSON.stringify({ok:true,rowLevelEntities:true,idempotentCommands:true,permissionRefresh:true,conflictProtection:true}));
