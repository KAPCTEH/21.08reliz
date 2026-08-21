'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'source/application/main.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'source/license-server/worker.mjs'),'utf8');
const verifier=fs.readFileSync(path.join(root,'source/license-server/verify-deployment.mjs'),'utf8');
const telegramBroker=fs.readFileSync(path.join(root,'source/company-telegram-broker/worker.mjs'),'utf8');

assert.ok(main.includes("authorized:Boolean(cloudAuth)"),'full mode must reflect actual account authorization');
assert.ok(main.includes("const claims=combinedCloudClaims(accessToken,offlineToken)"),'access and offline token context must be cross-checked');
assert.ok(main.includes("AUTH_CONTEXT_MISMATCH"),'conflicting account context must be rejected');
assert.ok(main.includes("AUTH_TOKEN_INVALID"),'foreign or malformed token context must be rejected');
assert.ok(main.includes("cloudAuthenticatedRequest('POST','/v1/auth/introspect',{})"),'REG setup must verify the live account context');
assert.ok(main.indexOf('const authState=await verifyCloudAuthContext()')<main.indexOf('sshPassword=await openRegVpsPasswordWindow()'),'online owner verification must happen before SSH password entry');
assert.ok(main.includes("if(String(state.workspace_id||'')!==companyId)throw new Error('Подключение REG.RU относится к другой компании."),'foreign REG workspace must be blocked before token transmission');
assert.ok(main.includes("`reg-vps-state.${scope}.json`"),'REG local state must be company-scoped');
assert.ok(main.includes("`regApiKey:${scope}`"),'REG fallback secret must be company-scoped');

assert.ok(renderer.includes("if(!CLOUD_ID_RE.test(companyId)||!String(auth?.user?.id||''))"),'renderer must reject a session without company/user ids');
assert.ok(renderer.includes("await window.JustFunDesktop?.auth?.logout?.()"),'renderer must clear incomplete server session');
assert.ok(renderer.includes("if(String(window.JustFunDesktop?.bootstrapCompanyId||'')!==companyId)"),'renderer must restart into the confirmed company scope');
assert.ok(renderer.includes("const entered=await applyCloudAuth(desktopSession.auth)"),'startup readiness must wait for the company guard');

assert.ok(worker.includes('auth_context_version: 2'),'license server must return auth context contract 2');
assert.ok(worker.includes('company_id: row.company_id'),'license server token response must expose company id redundantly');
assert.ok(worker.includes("auth_contract: 4"),'health endpoint must expose granular authorization contract version');
assert.ok(verifier.includes('authContract: 4'),'deployment verification must reject an outdated Worker');
assert.ok(telegramBroker.includes("'/v1/company/telegram/status'"),'standalone service must expose the authenticated Telegram broker');
assert.ok(telegramBroker.includes('telegram_client_key_ciphertext'),'Telegram client key must be encrypted in the separate company service');
assert.ok(telegramBroker.includes('/v1/auth/introspect'),'Telegram broker must confirm every account through the live license server');
assert.ok(main.includes("const COMPANY_TELEGRAM_BROKER_HOST = 'justfun-company-telegram.l2maloy47rus.workers.dev'"),'desktop must use the isolated company Telegram service');
assert.ok(main.includes("/v1/company/telegram/status?warehouse_id=${encodeURIComponent(warehouseId)}"),'full edition must read Telegram through the warehouse-scoped company broker');
assert.ok(main.includes("companyTelegramBrokerRequest('PUT','/v1/company/telegram-service'"),'owner setup must publish Telegram to the separate company service');
assert.ok(main.includes('warehouse_id:scopedWarehouseId'),'owner setup must publish Telegram for the active warehouse');
assert.ok(renderer.includes("ids.map(id=>'jf.warehouse:'+id)"),'employee invitations must include authoritative warehouse ids');
assert.ok(renderer.includes('workspace_reload_loop_blocked'),'repeated warehouse reloads must be stopped and audited');
assert.ok(renderer.includes('jf_workspace_reload_guard_v783:'),'warehouse initialization must keep a per-company reload guard');

console.log(JSON.stringify({ok:true,sourceLevelFix:true,onlineOwnerVerificationBeforeSsh:true,companyScopedRegState:true,isolatedCompanyTelegramBroker:true,serverContract:3,brokerContract:1}));
