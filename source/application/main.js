'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session, Menu, safeStorage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');
const https = require('https');
const tls = require('tls');
const nodeNet = require('net');
const { verifyPackagedApplicationIntegrity } = require('./security-manifest.cjs');
const { UpdateController } = require('./update/controller.cjs');
const UPDATE_POLICY = Object.freeze(require('./update/policy.json'));
const UPDATE_TRUST_STORE = Object.freeze(require('./update/trusted-keys.json'));
const UPDATE_HELPER_IDENTITY = Object.freeze(require('./update/helper-identity.json'));
const telegramProvisioner = require('./integrations/telegram-cloudflare-native/provisioner.cjs');
const regVpsNativeSsh = require('./integrations/reg-vps/native-ssh.cjs');
const addressIntelligence = require('./web/assets/js/04-address-intelligence-v783.js');
const RELEASE = Object.freeze(require('./release.json'));

const VERSION = RELEASE.version;
const APP_NAME = 'JustFun Логистика';
const COMPANY = 'JustFun';
const SUPPORT_TELEGRAM = 'https://t.me/KAPCTEH';
const SUPPORT_VK = 'https://vk.ru/k_a_p_c_t_e_n';
const SUPPORT_EMAIL = 'mailto:pw-fanat@mail.ru';
const CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';
const BOTFATHER_URL = 'https://t.me/BotFather';
const DEMO_DURATION_MS = 72 * 60 * 60 * 1000;
const DEMO_SCHEMA = 3;
const DEMO_STATE_NAME = 'demo-state-v750.json';
const INSTALL_CONFIG_NAME = 'install.json';
const STARTUP_TIMEOUT_MS = 30000;
// An authenticated start may legitimately wait for two independent VPS
// operations (warehouse registry and first-computer restore).  Each operation
// has its own network timeout, so the renderer readiness watchdog must not
// report a false crash while the local interface is still progressing.
const RENDERER_READY_TIMEOUT_MS = 90000;
const REG_STATE_NAME = 'reg-vps-state.json';
const SECRET_STORE_NAME = 'native-secrets.json';
const LICENSE_API_ORIGIN = 'https://justfun-license-api.l2maloy47rus.workers.dev';
const LICENSE_API_HOST = 'justfun-license-api.l2maloy47rus.workers.dev';
const COMPANY_TELEGRAM_BROKER_ORIGIN = 'https://justfun-company-telegram.l2maloy47rus.workers.dev';
const COMPANY_TELEGRAM_BROKER_HOST = 'justfun-company-telegram.l2maloy47rus.workers.dev';
const TELEGRAM_COMPANY_PUBLISH_RETRY_BASE_MS = 15 * 1000;
const TELEGRAM_COMPANY_PUBLISH_RETRY_MAX_MS = 5 * 60 * 1000;
const CLOUD_AUTH_SECRET = 'licenseCloudAuthV1';
const APP_RENDERER_SCHEME = 'justfun';
const APP_RENDERER_HOST = 'app';
const APP_RENDERER_TOP_LEVEL_FILES = new Set([
  'splash.html','splash-renderer.js',
  'reg-vps-setup.html','reg-vps-setup-renderer.js',
  'telegram-setup.html','telegram-setup-renderer.js'
]);
let localRootOverride = '';

// This registration must happen before Electron becomes ready. The renderer is
// deliberately not loaded through file:// because the packaged runtime keeps
// GrantFileProtocolExtraPrivileges disabled.
protocol?.registerSchemesAsPrivileged?.([{
  scheme: APP_RENDERER_SCHEME,
  privileges: {standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, codeCache:true}
}]);

let mainWindow = null;
let splashWindow = null;
let demoTimer = null;
let currentSession = null;
let startupLog = null;
let rendererReadyResolve = null;
let activeRendererWarehouseId = '';
let singleInstanceLock = false;
let ipcRegistered = false;
let activeIntegrationWizard = null;
let telegramSetupWindow = null;
let regVpsSetupWindow = null;
let telegramCompanyPublishRetryTimer = null;
let telegramCompanyPublishRetryAt = 0;
let telegramCompanyPublishRetryFailures = 0;
let telegramCompanyPublishRetryInFlight = false;
let updateController = null;
let updateCheckTimer = null;
let updateCheckInterval = null;
let updateHelperPollTimer = null;
let updateCloseApplyStarted = false;
const DESKTOP_UNIT_TEST_MODE = process.env.JF_DESKTOP_UNIT_TEST === '1' && !process.versions.electron;
const runtimeHardeningReport = {sandboxEnabled:false, removedSwitches:[], devToolsGuardInstalled:false, errors:[]};
const registeredAppProtocolSessions = new WeakSet();

function recordRuntimeHardeningError(stage,error) {
  runtimeHardeningReport.errors.push({stage:String(stage||'runtime-hardening'),error:safeError(error)});
}

function enforceEarlyRuntimeHardening() {
  const blockedSwitches = [
    'remote-debugging-port', 'remote-debugging-pipe',
    'inspect', 'inspect-brk', 'inspect-brk-node', 'inspect-port',
    'js-flags', 'no-sandbox', 'disable-web-security',
    'allow-running-insecure-content', 'ignore-certificate-errors',
    'disable-site-isolation-trials', 'user-data-dir'
  ];
  for (const name of blockedSwitches) {
    try {
      if (app.commandLine?.hasSwitch?.(name)) {
        app.commandLine.removeSwitch(name);
        runtimeHardeningReport.removedSwitches.push(name);
      }
    } catch (error) { recordRuntimeHardeningError(`remove-switch:${name}`,error); }
  }
  try { app.enableSandbox?.(); runtimeHardeningReport.sandboxEnabled=true; }
  catch (error) { recordRuntimeHardeningError('enable-sandbox',error); }
  if (typeof app.on === 'function') {
    app.on('web-contents-created', (_event, contents) => {
      contents.on('devtools-opened', () => {
        try { contents.closeDevTools(); }
        catch (error) { recordRuntimeHardeningError('close-devtools',error); }
      });
      contents.on('before-input-event', (event, input) => {
        const key=String(input?.key||'').toUpperCase();
        if (key === 'F12' || ((input?.control || input?.meta) && input?.shift && ['I','J','C'].includes(key))) event.preventDefault();
      });
    });
    runtimeHardeningReport.devToolsGuardInstalled=true;
  }
}
enforceEarlyRuntimeHardening();

function localRoot() {
  if (localRootOverride) return localRootOverride;
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  if (localAppData) return path.join(localAppData, 'JustFun', 'OrdersLogistics');
  try { return path.join(app.getPath('userData'), 'JustFun', 'OrdersLogistics'); }
  catch { return path.join(os.tmpdir(), 'JustFun', 'OrdersLogistics'); }
}
function programDataRoot() {
  const programData = String(process.env.PROGRAMDATA || '').trim();
  return programData ? path.join(programData, 'JustFun', 'OrdersLogistics') : localRoot();
}
function installConfigPath() { return path.join(localRoot(), INSTALL_CONFIG_NAME); }
function logCandidates() {
  const emergencyDir = String(process.env.JF_LOG_EMERGENCY_DIR_FOR_TEST || '').trim() || path.join(os.tmpdir(), 'JustFun-OrdersLogistics');
  const candidates = [
    path.join(localRoot(), 'logs', 'desktop.log'),
    path.join(emergencyDir, 'desktop-emergency.log')
  ].filter(Boolean).map(value => path.resolve(value));
  return [...new Set(candidates)];
}
function logFile() { return startupLog || logCandidates()[0]; }
function logDir() { return path.dirname(logFile()); }
function ensureDir(dir) { fs.mkdirSync(dir, {recursive: true}); }
function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file);
    const text = raw.length >= 2 && raw[0] === 0xFF && raw[1] === 0xFE
      ? raw.subarray(2).toString('utf16le')
      : raw.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {encoding: 'utf8', mode: 0o600});
  fs.renameSync(tmp, file);
}
function writeFailureArtifact(file,value,label) {
  try {
    writeJsonAtomic(file,value);
    return true;
  } catch (error) {
    const detail={label:String(label||'failure-artifact'),file:String(file||''),error:safeError(error)};
    appendLog('failure artifact write failed',detail);
    process.stderr.write(`${detail.label}: ${detail.error}\n`);
    return false;
  }
}
function appendLog(message, data) {
  const line = `${new Date().toISOString()} ${message}${data === undefined ? '' : ' ' + JSON.stringify(data)}\n`;
  const failures = [];
  for (const file of logCandidates()) {
    try {
      ensureDir(path.dirname(file));
      fs.appendFileSync(file, line, 'utf8');
      startupLog = file;
      if (failures.length) {
        const warning = `${new Date().toISOString()} logger target failed ${JSON.stringify(failures)}\n`;
        try { fs.appendFileSync(startupLog, warning, 'utf8'); } catch (error) { process.stderr.write(warning + safeError(error) + '\n'); }
      }
      return {ok:true, files:[file], failures};
    } catch (error) {
      failures.push({file, error:safeError(error)});
    }
  }
  process.stderr.write(line + `${new Date().toISOString()} logger unavailable ${JSON.stringify(failures)}\n`);
  return {ok:false, files:[], failures};
}

function getUpdateController() {
  if (updateController) return updateController;
  updateController = new UpdateController({
    productId: RELEASE.product_id,
    currentVersion: VERSION,
    channel: RELEASE.default_channel,
    availableContracts: {
      reg_api: RELEASE.contracts.reg_api,
      license_auth: RELEASE.contracts.license_auth,
      telegram_broker: RELEASE.contracts.telegram_broker,
      storage_protocol: RELEASE.contracts.storage_protocol,
      address_search: RELEASE.contracts.address_search,
      warehouse_delete_prepare: RELEASE.contracts.warehouse_delete_prepare,
      warehouse_delete_lease: RELEASE.contracts.warehouse_delete_lease,
      telegram_broker_deprovision: RELEASE.contracts.telegram_broker_deprovision,
      telegram_native_deprovision: RELEASE.contracts.telegram_native_deprovision,
      vps_attestation: RELEASE.contracts.vps_attestation,
      warehouse_delete_release_outbox: RELEASE.contracts.warehouse_delete_release_outbox,
    },
    policy: UPDATE_POLICY,
    trustStore: UPDATE_TRUST_STORE,
    rootDirectory: localRoot(),
    installationId: getMachineCode(),
    installRoot: path.dirname(process.execPath),
    installedHelper: path.join(path.dirname(process.execPath), UPDATE_HELPER_IDENTITY.file_name),
    helperIdentity: UPDATE_HELPER_IDENTITY,
    log: (message, data) => appendLog(message, data),
    onStatus: status => sendWindowMessage(mainWindow, 'desktop:update-status', status),
    onApplyScheduled: () => { const timer=setTimeout(()=>app.quit(),350);timer.unref?.(); },
  });
  return updateController;
}

function stopUpdateSchedule() {
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  if (updateCheckInterval) clearInterval(updateCheckInterval);
  updateCheckTimer = null;
  updateCheckInterval = null;
  if (updateHelperPollTimer) clearInterval(updateHelperPollTimer);
  updateHelperPollTimer = null;
}

function updateOperationArgument(name) {
  const prefix=`--${name}=`;
  const argument=process.argv.find(value=>String(value).startsWith(prefix));
  const operation=argument?String(argument).slice(prefix.length):'';
  return /^[A-Za-z0-9._-]{16,128}$/.test(operation)?operation:'';
}

function monitorUpdateHelper() {
  if (updateHelperPollTimer) clearInterval(updateHelperPollTimer);
  updateHelperPollTimer=setInterval(()=>{
    try {
      const status=getUpdateController().reconcileHelperState();
      if (['CONFIRMED','ROLLED_BACK','FAILED','IDLE'].includes(status.state)) { clearInterval(updateHelperPollTimer);updateHelperPollTimer=null; }
    } catch(error) { appendLog('update helper reconciliation failed',{code:String(error?.code||'UPDATE_RECONCILE_FAILED'),error:safeError(error)}); }
  },1000);
  updateHelperPollTimer.unref?.();
}

function confirmUpdateHealthIfRequested() {
  const operationId=updateOperationArgument('update-health-operation');
  if (!operationId) return;
  try { getUpdateController().confirmHealth(operationId);monitorUpdateHelper(); }
  catch(error) { appendLog('update health confirmation rejected',{code:String(error?.code||'UPDATE_HEALTH_FAILED'),error:safeError(error)}); }
}

function scheduleUpdateChecks() {
  stopUpdateSchedule();
  if (UPDATE_POLICY.enabled !== true) return;
  const run = async () => {
    try { await getUpdateController().check(); }
    catch (error) { appendLog('automatic update check failed', {code:String(error?.code || 'UPDATE_CHECK_FAILED'), error:safeError(error)}); }
  };
  updateCheckTimer = setTimeout(() => {
    run();
    updateCheckInterval = setInterval(run, UPDATE_POLICY.check_interval_seconds * 1000);
    updateCheckInterval.unref?.();
  }, UPDATE_POLICY.check_delay_seconds * 1000);
  updateCheckTimer.unref?.();
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}
function safeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
function diagnosticError(error) {
  return error instanceof Error && error.stack ? String(error.stack).slice(0, 12000) : safeError(error);
}
const recurringLogState = new Map();
function flushRecurringLog(key) {
  const item=recurringLogState.get(key);if(!item)return;
  recurringLogState.delete(key);clearTimeout(item.timer);
  if(item.repeats>0)appendLog(`${item.message} summary`,{...item.last,repeats:item.repeats,firstAt:item.firstAt,lastAt:item.lastAt});
}
function appendRecurringLog(message,data={},windowMs=60000) {
  const safeData=data&&typeof data==='object'?data:{error:String(data||'')};
  const key=`${message}|${String(safeData.code||'')}|${String(safeData.error||'')}`;
  const existing=recurringLogState.get(key),now=new Date().toISOString();
  if(existing){existing.repeats+=1;existing.last=safeData;existing.lastAt=now;return}
  appendLog(message,safeData);
  const item={message,last:safeData,repeats:0,firstAt:now,lastAt:now,timer:null};
  item.timer=setTimeout(()=>flushRecurringLog(key),Math.max(5000,Number(windowMs)||60000));item.timer.unref?.();recurringLogState.set(key,item);
}
function flushRecurringLogs(){for(const key of [...recurringLogState.keys()])flushRecurringLog(key)}
function sendWindowMessage(target,channel,payload) {
  try{
    if(!target||target.isDestroyed?.()||!target.webContents||target.webContents.isDestroyed?.())return false;
    target.webContents.send(channel,payload);return true;
  }catch(error){appendRecurringLog('window message dropped',{code:'WINDOW_DESTROYED',error:safeError(error),channel:String(channel||'')},30000);return false}
}
function appRendererUrl(relativePath) {
  const segments=String(relativePath||'').replace(/\\/g,'/').split('/').filter(Boolean);
  if (!segments.length || segments.some(segment=>segment==='.'||segment==='..'||segment.includes('\0'))) {
    throw new Error('Некорректный внутренний путь интерфейса');
  }
  return `${APP_RENDERER_SCHEME}://${APP_RENDERER_HOST}/${segments.map(encodeURIComponent).join('/')}`;
}
function resolveAppRendererPath(requestUrl) {
  const parsed=new URL(requestUrl);
  if (parsed.protocol!==`${APP_RENDERER_SCHEME}:` || parsed.hostname!==APP_RENDERER_HOST || parsed.username || parsed.password || parsed.port) {
    throw new Error('Недоверенный внутренний адрес интерфейса');
  }
  const decoded=decodeURIComponent(parsed.pathname);
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) throw new Error('Некорректный внутренний путь интерфейса');
  const segments=decoded.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment=>segment==='.'||segment==='..')) throw new Error('Выход за пределы интерфейса запрещён');
  const allowed=segments[0]==='web' || segments[0]==='assets' || (segments.length===1 && APP_RENDERER_TOP_LEVEL_FILES.has(segments[0]));
  if (!allowed) throw new Error('Ресурс не входит в разрешённую область интерфейса');
  const root=path.resolve(__dirname);
  const target=path.resolve(root,...segments);
  const relative=path.relative(root,target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Выход за пределы интерфейса запрещён');
  return target;
}
function appRendererMimeType(file) {
  return ({
    '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
    '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
    '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.map':'application/json; charset=utf-8'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}
function isTrustedAppUrl(value) {
  try {
    const parsed=new URL(value);
    return parsed.protocol===`${APP_RENDERER_SCHEME}:` && parsed.hostname===APP_RENDERER_HOST && !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}
function registerAppProtocol(targetSession) {
  if (!targetSession?.protocol?.handle || registeredAppProtocolSessions.has(targetSession)) return;
  targetSession.protocol.handle(APP_RENDERER_SCHEME, async request => {
    try {
      if (!['GET','HEAD'].includes(String(request.method||'GET').toUpperCase())) {
        return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD'}});
      }
      const target=resolveAppRendererPath(request.url);
      const stat=await fs.promises.stat(target);
      if (!stat.isFile()) throw new Error('Ресурс интерфейса не является файлом');
      const headers={
        'content-type':appRendererMimeType(target),
        'cache-control':'no-store',
        'x-content-type-options':'nosniff'
      };
      const body=String(request.method||'GET').toUpperCase()==='HEAD'?null:await fs.promises.readFile(target);
      return new Response(body,{status:200,headers});
    } catch (error) {
      appendLog('blocked or missing app resource',{url:String(request.url||'').slice(0,500),error:safeError(error)});
      return new Response('Not Found',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
    }
  });
  registeredAppProtocolSessions.add(targetSession);
}
function readInstallConfig() {
  const defaults = {
    app_version: VERSION,
    mode: 'demo',
    data_dir: path.join(app.getPath('documents'), 'JustFun', 'Заказы и логистика'),
    installed_at: new Date().toISOString()
  };
  const config = readJson(installConfigPath(), defaults) || defaults;
  config.mode = config.mode === 'full' ? 'full' : 'demo';
  config.data_dir = String(config.data_dir || defaults.data_dir);
  return config;
}
function persistInstallConfig(config) { writeJsonAtomic(installConfigPath(), config); }

function getMachineCode() {
  const source = [
    os.hostname(), os.arch(), os.platform(), process.env.USERDOMAIN || '',
    process.env.COMPUTERNAME || '', process.env.SystemDrive || '',
    os.cpus()?.[0]?.model || '', os.totalmem().toString()
  ].join('|').toUpperCase();
  const hash = crypto.createHash('sha256').update('JUSTFUN-ORDERS-LOGISTICS-750|' + source).digest('base64url').toUpperCase();
  return `JF75-${hash.slice(0,5)}-${hash.slice(5,10)}-${hash.slice(10,15)}-${hash.slice(15,20)}-${hash.slice(20,25)}`;
}
function hmacKey() {
  return crypto.createHash('sha256').update('JF-DEMO-ANCHOR-750|' + getMachineCode()).digest();
}
function signObject(object) {
  const clean = {...object}; delete clean.signature;
  return crypto.createHmac('sha256', hmacKey()).update(JSON.stringify(clean)).digest('base64url');
}
function validSignedObject(object) {
  if (!object || typeof object !== 'object' || typeof object.signature !== 'string') return false;
  const expected = signObject(object);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(object.signature));
  } catch { return false; }
}
function demoLocations(dataDir) {
  const result = [
    path.join(localRoot(), DEMO_STATE_NAME),
    path.join(dataDir, '.justfun', DEMO_STATE_NAME)
  ];
  const shared=path.join(programDataRoot(),DEMO_STATE_NAME);
  try{
    ensureDir(path.dirname(shared));
    fs.accessSync(path.dirname(shared),fs.constants.W_OK);
    result.push(shared);
  }catch{
    // A standard Windows account may not write to ProgramData. The signed
    // per-user file, separate data anchor and registry anchor remain active.
  }
  return [...new Set(result.map(p => path.resolve(p)))];
}
function readRegistryDemoAnchor() {
  if (DESKTOP_UNIT_TEST_MODE || process.platform !== 'win32') return null;
  try {
    const output = childProcess.execFileSync('reg.exe', ['query', 'HKCU\\Software\\JustFun\\OrdersLogistics', '/v', 'DemoAnchor750'], {encoding:'utf8', windowsHide:true, timeout:2000});
    const match = output.match(/DemoAnchor750\s+REG_SZ\s+(.+)$/mi);
    return match ? JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8')) : null;
  } catch { return null; }
}
function writeRegistryDemoAnchor(state) {
  if (DESKTOP_UNIT_TEST_MODE || process.platform !== 'win32') return;
  try {
    const value = Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
    childProcess.execFileSync('reg.exe', ['add', 'HKCU\\Software\\JustFun\\OrdersLogistics', '/v', 'DemoAnchor750', '/t', 'REG_SZ', '/d', value, '/f'], {windowsHide:true, timeout:2500, stdio:'ignore'});
  } catch (error) { appendLog('demo registry anchor write failed',{error:safeError(error)}); }
}
function collectDemoStates(dataDir) {
  const entries = [];
  for (const file of demoLocations(dataDir)) {
    const value = readJson(file);
    if (value) entries.push({source:file, value});
  }
  const registry = readRegistryDemoAnchor();
  if (registry) entries.push({source:'registry', value:registry});
  return entries;
}
function makeDemoState(now = Date.now()) {
  const base = {
    schema: DEMO_SCHEMA,
    machine_code: getMachineCode(),
    first_started_at: new Date(now).toISOString(),
    expires_at: new Date(now + DEMO_DURATION_MS).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    version_created: VERSION
  };
  return {...base, signature: signObject(base)};
}
function normalizeDemoState(dataDir) {
  const now = Date.now();
  const observed = collectDemoStates(dataDir);
  const candidates = observed.filter(entry => validSignedObject(entry.value) && entry.value.schema === DEMO_SCHEMA && entry.value.machine_code === getMachineCode());
  let state;
  let recovery = false;
  if (!candidates.length) {
    recovery = observed.length > 0;
    if (recovery) {
      // A present but invalid current anchor is evidence of corruption or
      // tampering. Offline recovery must fail closed; a reachable Cloudflare
      // authority can still restore the genuine server-side window below.
      const base = {
        schema: DEMO_SCHEMA,
        machine_code: getMachineCode(),
        first_started_at: new Date(now).toISOString(),
        expires_at: new Date(now - 1000).toISOString(),
        last_seen_at: new Date(now).toISOString(),
        version_created: VERSION
      };
      state = {...base, signature: signObject(base)};
    } else {
      state = makeDemoState(now);
    }
  } else {
    const starts = candidates.map(x => Date.parse(x.value.first_started_at)).filter(Number.isFinite);
    const expiries = candidates.map(x => Date.parse(x.value.expires_at)).filter(Number.isFinite);
    const lastSeen = candidates.map(x => Date.parse(x.value.last_seen_at)).filter(Number.isFinite);
    const first = starts.length ? Math.min(...starts) : now;
    const expiry = expiries.length ? Math.min(...expiries) : first + DEMO_DURATION_MS;
    const latestSeen = lastSeen.length ? Math.max(...lastSeen) : now;
    // Clock rollback never grants extra time. It does not falsely destroy DEMO; it clamps to last observed time.
    const effectiveNow = Math.max(now, latestSeen);
    const base = {
      schema: DEMO_SCHEMA,
      machine_code: getMachineCode(),
      first_started_at: new Date(first).toISOString(),
      expires_at: new Date(expiry).toISOString(),
      last_seen_at: new Date(effectiveNow).toISOString(),
      version_created: candidates[0].value.version_created || VERSION
    };
    state = {...base, signature: signObject(base)};
  }
  persistDemoState(dataDir, state);
  return {state, recovery};
}
function persistDemoState(dataDir, state) {
  const signed = {...state}; signed.signature = signObject(signed);
  // Keep the in-memory session consistent with the exact signed value written
  // to disk. Otherwise a cloud reconciliation left currentSession with a stale
  // signature until the next application start.
  state.signature = signed.signature;
  for (const file of demoLocations(dataDir)) {
    try { writeJsonAtomic(file, signed); } catch (error) { appendLog('demo anchor write skipped', {file, error:safeError(error)}); }
  }
  writeRegistryDemoAnchor(signed);
}
function remainingDemoMs(state) {
  const now = Math.max(Date.now(), Date.parse(state.last_seen_at) || 0);
  return Math.max(0, Date.parse(state.expires_at) - now);
}

async function buildSession(config) {
  ensureDir(config.data_dir);
  const machineCode = getMachineCode();
  if (config.mode === 'full') {
    const cloudAuth = await restoreCloudAuthSession();
    // The full application always opens its protected sign-in surface, but the
    // authorization flag now reflects a complete server-confirmed account context.
    return {edition:'full', authorized:Boolean(cloudAuth), cloudAuth, machineCode, dataDir:config.data_dir, recovery:false};
  }
  const demo = await normalizeDemoStateWithCloud(config.data_dir);
  const ms = remainingDemoMs(demo.state);
  return {edition:'demo', authorized:ms > 0, demoState:demo.state, demoRemainingMs:ms, machineCode, dataDir:config.data_dir, recovery:demo.recovery};
}
function setSecureSessionDefaults(config) {
  const profile = path.join(config.data_dir, '.desktop-profile-v750');
  ensureDir(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'session'));
  app.setPath('logs', logDir());
}
function configureElectronSession(config) {
  const ses = session.defaultSession;
  registerAppProtocol(ses);
  const networkUserAgent = `JustFunOrdersLogistics/${VERSION} (Windows desktop; contact: pw-fanat@mail.ru)`;
  const networkFailures = new Map();
  const networkFilter = {
    urls: [
      'https://tile.openstreetmap.org/*',
      'https://nominatim.openstreetmap.org/*',
      'https://router.project-osrm.org/*'
    ]
  };
  const logNetworkFailure = (details, reason) => {
    let host = 'unknown';
    try { host = new URL(details.url).hostname; }
    catch (error) { appendRecurringLog('map service URL parse failed',{error:safeError(error)},60000); }
    const key = `${host}|${reason}`;
    const now = Date.now(), previous = networkFailures.get(key) || {at:0,count:0};
    previous.count += 1;
    if (now - previous.at >= 60000) {
      appendLog('map service request failed', {
        host,
        reason:String(reason || 'unknown').slice(0,160),
        statusCode:Number(details.statusCode) || 0,
        resourceType:String(details.resourceType || ''),
        occurrences:previous.count
      });
      previous.at = now;
      previous.count = 0;
    }
    networkFailures.set(key, previous);
  };
  // OSMF requires an identifiable application User-Agent. Electron's generic
  // default can be blocked, which otherwise leaves Leaflet as an unexplained
  // grey rectangle even though the map object itself was created correctly.
  ses.setUserAgent(networkUserAgent, 'ru-RU,ru,en-US,en');
  ses.webRequest.onBeforeSendHeaders(networkFilter, (details, callback) => {
    details.requestHeaders['User-Agent'] = networkUserAgent;
    callback({requestHeaders:details.requestHeaders});
  });
  ses.webRequest.onCompleted(networkFilter, details => {
    if (Number(details.statusCode) >= 400) logNetworkFailure(details, `HTTP ${details.statusCode}`);
  });
  ses.webRequest.onErrorOccurred(networkFilter, details => {
    if(String(details.error||'').toUpperCase()==='NET::ERR_ABORTED')return;
    logNetworkFailure(details, details.error || 'network error');
  });
  appendLog('map service network identity configured', {userAgent:networkUserAgent});
  const isTrustedLocalContents = webContents => webContents === mainWindow?.webContents && isTrustedAppUrl(webContents.getURL());
  ses.setPermissionRequestHandler((webContents, permission, callback) => callback(permission === 'geolocation' && isTrustedLocalContents(webContents)));
  ses.setPermissionCheckHandler((webContents, permission) => permission === 'geolocation' && isTrustedLocalContents(webContents));
  ses.on('will-download', (_event, item) => {
    try {
      const downloads = path.join(config.data_dir, 'Экспорт');
      ensureDir(downloads);
      const safeName = String(item.getFilename() || 'export.bin').replace(/[\/:*?"<>|]/g, '_');
      let target = path.join(downloads, safeName);
      if (fs.existsSync(target)) {
        const ext = path.extname(safeName), base = path.basename(safeName, ext);
        target = path.join(downloads, `${base}-${Date.now()}${ext}`);
      }
      item.setSavePath(target);
      appendLog('download started', {target});
      item.once('done', (_e, state) => appendLog('download finished', {target, state}));
    } catch (error) { appendLog('download handler failed', safeError(error)); }
  });
}
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 760, height: 440, resizable:false, frame:false, transparent:false,
    show:false, backgroundColor:'#071d17', icon:path.join(__dirname,'assets','JustFun.ico'),
    webPreferences:{preload:path.join(__dirname,'splash-preload.js'), nodeIntegration:false, contextIsolation:true, sandbox:true}
  });
  splashWindow.loadURL(appRendererUrl('splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
}
function sendSplash(stage, detail, progress) {
  sendWindowMessage(splashWindow,'splash-status',{stage, detail, progress});
}
async function createMainWindow() {
  const bounds = readJson(path.join(localRoot(), 'window-state.json'), {});
  const companyScope=String(currentSession?.cloudAuth?.company?.id || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
  appendLog('main window creation started', {edition:currentSession?.edition, dataDir:currentSession?.dataDir});
  mainWindow = new BrowserWindow({
    width: Number(bounds.width) || 1540,
    height: Number(bounds.height) || 940,
    x: Number.isFinite(bounds.x) ? bounds.x : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y : undefined,
    minWidth: 1120, minHeight: 720,
    show:false, backgroundColor:'#eef6f1', title:`${APP_NAME} · ${COMPANY}`,
    icon:path.join(__dirname,'assets','JustFun.ico'), autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.js'), nodeIntegration:false, contextIsolation:true,
      sandbox:true, webSecurity:true, allowRunningInsecureContent:false,
      devTools:false, spellcheck:true, backgroundThrottling:false,
      additionalArguments:[
        `--jf-edition=${currentSession?.edition === 'demo' ? 'demo' : 'full'}`,
        `--jf-company-id=${companyScope}`,
        `--jf-version=${VERSION}`
      ]
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return {action:'deny'};
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (!isTrustedAppUrl(url)) { event.preventDefault(); if (isAllowedExternal(url)) shell.openExternal(url); }
    } catch (error) {
      event.preventDefault();
      appendLog('blocked malformed navigation', {url:String(url || '').slice(0,500), error:safeError(error)});
    }
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) activeRendererWarehouseId='';
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendLog('renderer gone', details);
    showRecoveryError('Рабочий интерфейс был неожиданно остановлен.', `Причина: ${details.reason}. Код: ${details.exitCode}`);
  });
  mainWindow.webContents.on('did-start-loading', () => appendLog('renderer did-start-loading'));
  mainWindow.webContents.on('dom-ready', () => appendLog('renderer dom-ready'));
  mainWindow.webContents.on('did-finish-load', () => appendLog('renderer did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    appendLog('renderer did-fail-load', {code, description, url, isMainFrame});
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendLog('renderer preload-error', {preloadPath, error:safeError(error)});
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') appendLog('renderer console error', {message:String(details.message || '').slice(0,2000), line:details.lineNumber, source:details.sourceId});
  });
  mainWindow.once('ready-to-show', () => appendLog('main window ready-to-show'));
  mainWindow.on('unresponsive', () => {
    appendLog('main window unresponsive');
    sendWindowMessage(mainWindow,'desktop:app-event',{type:'warning',message:'Интерфейс выполняет тяжёлую операцию. Подождите несколько секунд.'});
  });
  mainWindow.on('responsive', () => appendLog('main window responsive'));
  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    try { writeJsonAtomic(path.join(localRoot(), 'window-state.json'), b); }
    catch (error) { appendLog('window state write failed',{error:safeError(error)}); }
  });
  mainWindow.on('closed',()=>{activeRendererWarehouseId='';stopTelegramCompanyPublishRetry();mainWindow=null});
  const rendererReady = new Promise(resolve => { rendererReadyResolve = resolve; });
  try {
    await withTimeout(
      mainWindow.loadURL(appRendererUrl('web/index.html')),
      STARTUP_TIMEOUT_MS,
      'Рабочая страница не завершила загрузку за 30 секунд'
    );
    sendSplash('Проверяем интерфейс','Ожидаем готовность входа и рабочей области',78);
    await withTimeout(rendererReady, RENDERER_READY_TIMEOUT_MS, 'Рабочий интерфейс загрузился, но не подтвердил готовность');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Рабочее окно было закрыто во время запуска');
    mainWindow.show(); mainWindow.focus();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    appendLog('main window shown');
  } finally {
    rendererReadyResolve = null;
  }
}
function isAllowedExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return true;
    return u.protocol === 'https:' && ['t.me','telegram.me','vk.ru','yandex.ru','yandex.com','maps.yandex.ru','www.openstreetmap.org','openstreetmap.org','dash.cloudflare.com','developers.cloudflare.com'].includes(u.hostname.toLowerCase());
  } catch { return false; }
}
function showRecoveryError(title, details) {
  const paths = logCandidates().join('\n');
  dialog.showMessageBox({type:'error', title:'JustFun — восстановление запуска', message:title, detail:`${details}\n\nЖурналы запуска:\n${paths}`, buttons:['Перезапустить','Открыть журнал','Закрыть'], defaultId:0, cancelId:2, noLink:true}).then(({response}) => {
    if (response === 0) { app.relaunch(); app.exit(0); }
    if (response === 1) shell.showItemInFolder(logFile());
  });
}

function integrationsRoot() { return path.join(localRoot(), 'integrations'); }
function regStatePath(companyId='') {
  const scope=normalizedCloudId(companyId);
  return path.join(integrationsRoot(), 'reg-vps', scope ? `reg-vps-state.${scope}.json` : REG_STATE_NAME);
}
function nativeSecretStorePath() { return path.join(integrationsRoot(), SECRET_STORE_NAME); }
let telegramDataMigrationDone=false;
function telegramBaseRoot() {
  const current=path.join(integrationsRoot(),'telegram-cloudflare-native');
  if(!telegramDataMigrationDone){
    telegramDataMigrationDone=true;
    const legacy=path.join(integrationsRoot(),'telegram-cloudflare');
    try{
      if(fs.existsSync(legacy)&&!fs.existsSync(current))fs.renameSync(legacy,current);
      else if(fs.existsSync(legacy)){
        ensureDir(current);
        for(const name of ['state.json','event-cursors.json']){
          const source=path.join(legacy,name),target=path.join(current,name);
          if(fs.existsSync(source)&&!fs.existsSync(target))fs.copyFileSync(source,target);
        }
      }
    }catch(error){appendLog('Telegram legacy data migration skipped',safeIntegrationError(error));}
  }
  return current;
}
function telegramScopeParts(companyId,warehouseId,environment=currentEnvironment()){
  const resolvedEnvironment=validateEnvironment(environment);
  const resolvedCompany=normalizedCloudId(companyId);
  const resolvedWarehouse=validateWarehouseId(warehouseId);
  if(!resolvedCompany)throw new Error('Не удалось определить компанию для отдельного Telegram-контура. Выполните вход снова.');
  return{
    companyId:resolvedCompany,
    warehouseId:resolvedWarehouse,
    environment:resolvedEnvironment,
    key:`${resolvedCompany}:${resolvedEnvironment}:${resolvedWarehouse}`
  };
}
function currentTelegramScope(warehouseId=activeRendererWarehouseId,companyId=''){
  const auth=currentSession?.cloudAuth||readCloudAuthState()||{};
  const resolvedCompany=companyId||auth?.company?.id||auth?.company_id||(currentSession?.edition==='demo'?'demo-local':'');
  return telegramScopeParts(resolvedCompany,warehouseId,currentEnvironment());
}
function telegramScopeRoot(scope){
  return path.join(telegramBaseRoot(),`company-${scope.companyId}`,`warehouse-${scope.environment}-${scope.warehouseId}`);
}
function telegramRoot(companyId='',warehouseId=activeRendererWarehouseId){
  return telegramScopeRoot(currentTelegramScope(warehouseId,companyId));
}
function telegramStatePath(companyId='',warehouseId=activeRendererWarehouseId) { return path.join(telegramRoot(companyId,warehouseId), 'state.json'); }
function telegramCursorPath(companyId='',warehouseId=activeRendererWarehouseId) { return path.join(telegramRoot(companyId,warehouseId), 'event-cursors.json'); }
function telegramSecretNameForScope(scope){
  return `telegramClientApiKey.${scope.companyId}.${scope.environment}.${scope.warehouseId}`;
}
function telegramSecretName(companyId='',warehouseId=activeRendererWarehouseId){
  const scope=currentTelegramScope(warehouseId,companyId);
  return telegramSecretNameForScope(scope);
}
function explicitLegacyTelegramState(scope){
  const legacyPath=path.join(telegramBaseRoot(),'state.json');
  const legacy=readJson(legacyPath,null);
  if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))return null;
  if(String(legacy.company_id||'')!==scope.companyId)return null;
  if(String(legacy.warehouse_id||'')!==scope.warehouseId)return null;
  if(String(legacy.environment||'live').toLowerCase()!==scope.environment)return null;
  return{legacy,legacyPath};
}
function migrateExplicitLegacyTelegramScope(companyId='',warehouseId=activeRendererWarehouseId){
  const scope=currentTelegramScope(warehouseId,companyId),targetPath=path.join(telegramScopeRoot(scope),'state.json');
  if(fs.existsSync(targetPath))return false;
  const match=explicitLegacyTelegramState(scope);
  if(!match)return false;
  ensureDir(path.dirname(targetPath));
  writeJsonAtomic(targetPath,{...match.legacy,company_id:scope.companyId,warehouse_id:scope.warehouseId,environment:scope.environment,migrated_from_legacy_at:new Date().toISOString()});
  const legacyCursor=path.join(telegramBaseRoot(),'event-cursors.json'),targetCursor=path.join(telegramScopeRoot(scope),'event-cursors.json');
  if(fs.existsSync(legacyCursor)&&!fs.existsSync(targetCursor))fs.copyFileSync(legacyCursor,targetCursor);
  try{
    const legacyKey=readNativeSecret('telegramClientApiKey');
    if(legacyKey)writeNativeSecret(telegramSecretName(scope.companyId,scope.warehouseId),legacyKey);
  }catch(error){appendLog('Telegram explicit legacy key migration skipped',{scope:scope.key,error:safeIntegrationError(error)});}
  appendLog('Telegram explicit legacy scope migrated',{company:scope.companyId,warehouse:scope.warehouseId,environment:scope.environment});
  return true;
}
function bundledIntegrationPath(...parts) { return path.join(__dirname, 'integrations', ...parts); }

function requireSecureStorage() {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('Защищённое хранилище Windows недоступно. Войдите в обычную учётную запись Windows и повторите запуск.'), { code: 'NATIVE_SECRET_STORAGE_UNAVAILABLE' });
  }
}
function readNativeSecret(name) {
  requireSecureStorage();
  const store = readJson(nativeSecretStorePath(), {}) || {};
  const encoded = String(store[name] || '');
  if (!encoded) return '';
  try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')); }
  catch (cause) {
    throw Object.assign(new Error('Защищённый локальный ключ временно недоступен. Выполните обычный вход; сохранённые данные ключа не удалены.'), {
      code: 'NATIVE_SECRET_DECRYPT_FAILED',
      causeCode: String(cause?.code || cause?.name || '')
    });
  }
}
function writeNativeSecret(name, value) {
  requireSecureStorage();
  const store = readJson(nativeSecretStorePath(), {}) || {};
  store[name] = safeStorage.encryptString(String(value)).toString('base64');
  store.updated_at = new Date().toISOString();
  writeJsonAtomic(nativeSecretStorePath(), store);
}

function deleteNativeSecret(name) {
  requireSecureStorage();
  const store = readJson(nativeSecretStorePath(), {}) || {};
  if (Object.prototype.hasOwnProperty.call(store, name)) delete store[name];
  store.updated_at = new Date().toISOString();
  writeJsonAtomic(nativeSecretStorePath(), store);
}
const CLOUD_ID_RE=/^[A-Za-z0-9_-]{3,120}$/;
const COMPANY_WORKSPACE_RE=/^[A-Za-z0-9_-]{16,80}$/;
const CLOUD_ROLE_RE=/^[\p{L}\p{N}][\p{L}\p{N} ._()\-/]{1,49}$/u;
function normalizedCloudRole(value){const role=String(value||'').trim();return CLOUD_ROLE_RE.test(role)?role:'viewer'}
function cloudAuthError(code,message){return Object.assign(new Error(message),{code});}
function normalizedCloudId(value){
  const id=String(value||'').trim();
  return CLOUD_ID_RE.test(id)?id:'';
}
function consistentCloudId(label,values){
  const ids=[...new Set(values.map(normalizedCloudId).filter(Boolean))];
  if(ids.length>1)throw cloudAuthError('AUTH_CONTEXT_MISMATCH',`Сервер вернул противоречивый идентификатор ${label}. Сессия остановлена.`);
  return ids[0]||'';
}
function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return null; }
}
function tokenExpiresAt(token) {
  const payload = decodeJwtPayload(token);
  return payload?.exp ? Number(payload.exp) * 1000 : 0;
}
function normalizedPermissions(value){
  return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))].sort();
}
function sameStringList(left,right){
  const a=normalizedPermissions(left),b=normalizedPermissions(right);
  return a.length===b.length&&a.every((item,index)=>item===b[index]);
}
function justFunTokenClaims(token,expectedType){
  if(!String(token||''))return null;
  const claims=decodeJwtPayload(token);
  if(!claims||claims.iss!=='justfun-license-api'||claims.typ!==expectedType){
    throw cloudAuthError('AUTH_TOKEN_INVALID','Сохранённый токен сессии повреждён или выдан другим сервером. Выполните вход повторно.');
  }
  return claims;
}
function combinedCloudClaims(accessToken,offlineToken){
  const access=justFunTokenClaims(accessToken,'access'),offline=justFunTokenClaims(offlineToken,'offline');
  if(!access&&!offline)throw cloudAuthError('AUTH_TOKEN_INVALID','Сервер лицензий не вернул токены сессии. Выполните вход повторно.');
  const claimsList=[access,offline].filter(Boolean);
  const roleValues=[...new Set(claimsList.map(item=>String(item.role||'')).filter(Boolean))];
  if(roleValues.length>1)throw cloudAuthError('AUTH_CONTEXT_MISMATCH','Токены сессии содержат разные роли. Сессия остановлена.');
  const permissionLists=claimsList.map(item=>normalizedPermissions(item.permissions));
  if(permissionLists.length>1&&!sameStringList(permissionLists[0],permissionLists[1])){
    throw cloudAuthError('AUTH_CONTEXT_MISMATCH','Токены сессии содержат разные права. Сессия остановлена.');
  }
  return {
    sub:consistentCloudId('пользователя',claimsList.map(item=>item.sub)),
    cid:consistentCloudId('компании',claimsList.map(item=>item.cid)),
    did:consistentCloudId('компьютера',claimsList.map(item=>item.did)),
    role:roleValues[0]||'',
    permissions:permissionLists[0]||[]
  };
}
function normalizeCloudUser(user={}, fallback={}, claims={}, envelope={}) {
  const id=consistentCloudId('пользователя',[user?.id,envelope?.user_id,fallback?.id,claims?.sub]);
  const verified=Boolean(envelope?.auth_context_verified);
  const explicitRole=String(envelope?.role||user?.role||fallback?.role||'');
  const claimRole=String(claims?.role||'');
  let role=explicitRole||claimRole||'viewer';
  if(!verified&&explicitRole&&claimRole&&explicitRole!==claimRole){
    if(explicitRole==='viewer'&&claimRole!=='viewer')role=claimRole;
    else throw cloudAuthError('AUTH_CONTEXT_MISMATCH','Роль пользователя не совпадает с токеном сессии. Сессия остановлена.');
  }
  let permissions=Array.isArray(envelope?.permissions)?envelope.permissions:(Array.isArray(user?.permissions)?user.permissions:(Array.isArray(fallback?.permissions)?fallback.permissions:[]));
  const claimPermissions=normalizedPermissions(claims?.permissions);
  if(!verified){
    if(!permissions.length&&claimPermissions.length)permissions=claimPermissions;
    else if(permissions.length&&claimPermissions.length&&!sameStringList(permissions,claimPermissions)){
      throw cloudAuthError('AUTH_CONTEXT_MISMATCH','Права пользователя не совпадают с токеном сессии. Сессия остановлена.');
    }
  }
  return {
    id,
    full_name:String(user?.full_name||user?.fullName||fallback?.full_name||fallback?.fullName||''),
    login:String(user?.login||fallback?.login||''),
    role:normalizedCloudRole(role),
    permissions:normalizedPermissions(permissions),
    status:String(user?.status||fallback?.status||'active')
  };
}
function normalizeCloudCompany(company={}, fallback={}, claims={}, envelope={}) {
  const id=consistentCloudId('компании',[company?.id,company?.company_id,envelope?.company_id,fallback?.id,fallback?.company_id,claims?.cid]);
  const service={...(fallback?.data_service||{}),...(company?.data_service||{})};
  const telegramService={...(fallback?.telegram_service||{}),...(company?.telegram_service||{})};
  return {
    ...fallback,
    ...company,
    id,
    code:String(company?.code||fallback?.code||''),
    name:String(company?.name||fallback?.name||''),
    status:String(company?.status||fallback?.status||'active'),
    ...(Object.keys(service).length?{data_service:service}:{}),
    ...(Object.keys(telegramService).length?{telegram_service:telegramService}:{})
  };
}
function normalizeCloudAuthState(value, fallback={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const accessToken=String(value.access_token||fallback.access_token||'');
  const offlineToken=String(value.offline_token||fallback.offline_token||'');
  const claims=combinedCloudClaims(accessToken,offlineToken);
  const user=normalizeCloudUser(value.user||{},fallback.user||{},claims,value);
  const company=normalizeCloudCompany(value.company||{},fallback.company||{},claims,value);
  if(!user.id||!company.id)throw cloudAuthError('AUTH_CONTEXT_INCOMPLETE','Сервер лицензий не вернул полный контекст пользователя и компании. Выполните вход повторно.');
  const claimDevice=normalizedCloudId(claims.did);
  const explicitDevice=normalizedCloudId(value.device_id||fallback.device_id);
  if(claimDevice&&explicitDevice&&claimDevice!==explicitDevice)throw cloudAuthError('AUTH_CONTEXT_MISMATCH','Сессия относится к другому компьютеру. Выполните вход повторно.');
  return {
    ...fallback,
    ...value,
    user,
    company,
    access_token:accessToken,
    offline_token:offlineToken,
    refresh_token:String(value.refresh_token||fallback.refresh_token||''),
    access_expires_at:Number(value.access_expires_at||fallback.access_expires_at||tokenExpiresAt(accessToken)||0),
    offline_expires_at:Number(value.offline_expires_at||fallback.offline_expires_at||tokenExpiresAt(offlineToken)||0),
    refresh_expires_at:String(value.refresh_expires_at||fallback.refresh_expires_at||''),
    device_id:claimDevice||explicitDevice,
    auth_context_version:Number(value.auth_context_version||fallback.auth_context_version||1),
    last_verified_at:String(value.last_verified_at||fallback.last_verified_at||''),
    offline:Boolean(value.offline)
  };
}
function cloudSessionComplete(state){
  try{return Boolean(normalizeCloudAuthState(state));}catch{return false;}
}
function readCloudAuthState() {
  try {
    const raw = readNativeSecret(CLOUD_AUTH_SECRET);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const normalized=normalizeCloudAuthState(value);
    if(JSON.stringify(value)!==JSON.stringify(normalized)){
      writeNativeSecret(CLOUD_AUTH_SECRET,JSON.stringify(normalized));
      appendLog('cloud auth state repaired',{company:normalized.company.id,user:normalized.user.id,source:'signed-token'});
    }
    return normalized;
  } catch (error) {
    const code=String(error?.code||''),preserveEncryptedState=['NATIVE_SECRET_DECRYPT_FAILED','NATIVE_SECRET_STORAGE_UNAVAILABLE'].includes(code);
    appendLog(preserveEncryptedState?'cloud auth state temporarily unavailable':'cloud auth state rejected', {code,error:safeIntegrationError(error),causeCode:String(error?.causeCode||'')});
    if(!preserveEncryptedState){try{deleteNativeSecret(CLOUD_AUTH_SECRET)}
    catch(deleteError){appendLog('rejected cloud auth secret delete failed',{error:safeIntegrationError(deleteError)})}}
    return null;
  }
}
function writeCloudAuthState(value) {
  const normalized=normalizeCloudAuthState(value);
  writeNativeSecret(CLOUD_AUTH_SECRET, JSON.stringify(normalized));
  return normalized;
}
function clearCloudAuthState() {
  try { deleteNativeSecret(CLOUD_AUTH_SECRET); } catch (error) { appendLog('cloud auth clear failed', safeIntegrationError(error)); }
}
function cloudFriendlyError(code) {
  const map = {
    LICENSE_KEY_REQUIRED:'Введите лицензионный ключ.', LICENSE_NOT_FOUND:'Лицензионный ключ не найден.', LICENSE_BLOCKED:'Лицензия или компания заблокирована.',
    OWNER_ALREADY_CREATED:'Владелец этой компании уже создан. Используйте обычный вход.', OWNER_ALREADY_CREATED_OR_LOGIN_EXISTS:'Владелец уже создан или такой логин занят.',
    REQUIRED_FIELDS_MISSING:'Заполните все обязательные поля.', PASSWORD_TOO_SHORT:'Пароль должен содержать не менее 10 символов.', PASSWORD_TOO_LONG:'Пароль слишком длинный.',
    PASSWORD_MUST_CONTAIN_LETTERS_AND_NUMBERS:'Пароль должен содержать буквы и цифры.', INVALID_CREDENTIALS:'Неверный код компании, логин или пароль.',
    TOO_MANY_ATTEMPTS:'Слишком много попыток входа. Подождите и повторите позже.', USER_BLOCKED:'Пользователь заблокирован.', DEVICE_BLOCKED:'Этот компьютер заблокирован.',
    DEVICE_LIMIT_REACHED:'Достигнут лимит компьютеров для пользователя.', INVALID_SESSION:'Сессия завершена. Выполните вход снова.', ACCESS_BLOCKED:'Доступ заблокирован.',
    INVITATION_INVALID_OR_EXPIRED:'Приглашение не найдено, уже использовано или просрочено.', LOGIN_ALREADY_EXISTS_OR_INVITATION_USED:'Логин уже занят или приглашение использовано.',
    EMPLOYEE_LIMIT_REACHED:'Достигнут лимит сотрудников компании.', LOGIN_ALREADY_EXISTS:'Такой логин уже существует.', DEMO_EXPIRED:'Демонстрационный период завершён.',
    USER_NOT_FOUND:'Пользователь не найден.', DEVICE_NOT_FOUND:'Компьютер не найден.', CANNOT_BLOCK_SELF:'Нельзя заблокировать собственную учётную запись.',
    OWNER_CANNOT_BE_BLOCKED_HERE:'Владельца нельзя заблокировать из этого раздела.', OWNER_CANNOT_BE_CHANGED_HERE:'Роль и права владельца нельзя изменить из этого раздела.', CANNOT_CHANGE_SELF:'Нельзя изменить собственную роль или права.', INVALID_STATUS:'Недопустимый статус.', NOT_FOUND:'Метод сервера не найден.', INTERNAL_ERROR:'Внутренняя ошибка сервера.',
    AUTH_CONTEXT_INCOMPLETE:'Сервер лицензий вернул неполные данные компании. Выполните вход повторно.', AUTH_CONTEXT_MISMATCH:'Данные пользователя, компании или компьютера не совпадают. Сессия остановлена.', AUTH_TOKEN_INVALID:'Токен сессии повреждён или выдан другим сервером. Выполните вход повторно.', AUTH_REQUIRED:'Сначала выполните вход.',
    TELEGRAM_NOT_CONFIGURED:'Telegram ещё не подключён к компании. Владельцу нужно один раз выполнить настройку или восстановление.', TELEGRAM_SERVICE_INVALID:'Параметры Telegram/Cloudflare имеют неверный формат.', TELEGRAM_BOT_MISMATCH:'Cloudflare подтвердил другого Telegram-бота.', TELEGRAM_CONFIGURATION_REQUIRED:'Защищённый ключ Telegram на сервере компании нужно обновить. Владельцу следует выполнить «Проверить и восстановить».',
    TELEGRAM_UPSTREAM_UNAVAILABLE:'Telegram/Cloudflare временно не отвечает.', TELEGRAM_UPSTREAM_INVALID:'Сервер профиля получил некорректный ответ от Telegram Worker.', TELEGRAM_WORKER_ROUTING_BLOCKED:'Cloudflare заблокировал обращение сервера профиля к Telegram Worker. На сервере нужно включить разрешённый публичный вызов Worker.', TELEGRAM_UPSTREAM_ERROR:'Telegram/Cloudflare отклонил запрос.', TELEGRAM_REQUEST_INVALID:'Параметры Telegram-запроса имеют неверный формат.',
    TELEGRAM_DEPROVISION_UNCONFIRMED:'Telegram не подтвердил безопасное отключение склада. Удаление остановлено.', TELEGRAM_DEPROVISION_LOCAL_KEY_REQUIRED:'Не найден защищённый ключ старого Telegram Worker. Выполните восстановление Telegram и повторите удаление.', TELEGRAM_DEPROVISION_SCOPE_MISMATCH:'Локальный Telegram-профиль относится к другому складу. Удаление остановлено.', TELEGRAM_INSTALLATION_DEPROVISIONED:'Telegram этого склада уже окончательно отключён.',
    AUTH_SERVICE_UNAVAILABLE:'Сервер учётных записей временно недоступен. Повторите проверку позже.', AUTH_SERVICE_INVALID:'Сервер учётных записей вернул неподтверждённые данные.',
    WAREHOUSE_REQUIRED:'Не выбран склад.', ENVIRONMENT_REQUIRED:'Не выбрана рабочая среда.', WAREHOUSE_ACCESS_DENIED:'У этой учётной записи нет доступа к выбранному складу.',
    WAREHOUSE_CODE_REQUIRED:'Код склада имеет неверный формат.', WAREHOUSE_ASSIGNED:'Склад назначен сотрудникам или есть в действующем приглашении. Сначала уберите точное назначение.',
    WAREHOUSE_DELETE_LEASE_ACTIVE:'Удаление этого склада уже выполняется на другом компьютере.', WAREHOUSE_DELETE_IN_PROGRESS:'Назначение склада временно заблокировано: идёт его удаление.',
    WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED:'Защитное разрешение на удаление устарело. Повторите операцию.', WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED:'Не хватило времени на безопасное удаление. Повторите операцию.',
    WAREHOUSE_DELETE_LEASE_SUPERSEDED:'Удаление продолжает другой компьютер. На этом компьютере операция остановлена без изменения данных.', warehouse_delete_lease_superseded:'Удаление продолжает другой компьютер. На этом компьютере операция остановлена без изменения данных.',
    WAREHOUSE_DELETE_GLOBAL_ACCESS_REQUIRED:'Удалить склад может только владелец или администратор с доступом ко всем складам.', WAREHOUSE_DELETE_ACTOR_MISMATCH:'Незавершённое удаление может продолжить только пользователь, который его подтвердил.',
    WAREHOUSE_DELETE_SESSION_CHANGED:'Пользователь изменился во время удаления. Операция безопасно остановлена до повторного входа.', WAREHOUSE_DELETE_PREPARE_UNCONFIRMED:'VPS не подтвердил безопасную подготовку удаления. Telegram и данные склада не затронуты.', WAREHOUSE_DELETE_COMPLETION_UNCONFIRMED:'VPS не подтвердил завершение подготовленного удаления.', WAREHOUSE_DELETE_STATE_MISMATCH:'Состояние удаления на ПК и VPS не совпало. Автоматическое продолжение остановлено.', WAREHOUSE_DELETE_LEASE_RELEASE_UNCONFIRMED:'Сервер не подтвердил снятие защитной блокировки. Операция будет продолжена автоматически.'
  };
  return map[String(code || '')] || String(code || 'Неизвестная ошибка сервера.');
}
function cloudRequest(method, requestPath, body=null, accessToken='', timeoutMs=15000) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {Accept:'application/json', 'User-Agent':`JustFunOrdersLogistics/${VERSION}`};
    if (payload) { headers['Content-Type']='application/json; charset=utf-8'; headers['Content-Length']=String(payload.length); }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    // ClientRequest's socket timeout does not include every DNS/TCP/TLS phase.
    // Keep an independent wall-clock deadline so a filtered route cannot make
    // the login window appear frozen for minutes before retry logic starts.
    let req;
    const deadline=setTimeout(()=>req?.destroy(Object.assign(new Error('Сервер лицензий не ответил вовремя.'),{code:'NETWORK_TIMEOUT'})),timeoutMs);
    deadline.unref?.();
    const finishResolve=value=>{clearTimeout(deadline);resolve(value)};
    const finishReject=error=>{clearTimeout(deadline);reject(error)};
    req = https.request({hostname:LICENSE_API_HOST, port:443, path:requestPath, method, headers, timeout:timeoutMs, servername:LICENSE_API_HOST}, response => {
      const chunks=[]; let size=0;
      response.on('data', chunk => { size += chunk.length; if (size > 2*1024*1024) req.destroy(new Error('Ответ сервера слишком большой.')); else chunks.push(chunk); });
      response.on('end', () => {
        let parsed={};
        try { parsed=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { finishReject(Object.assign(new Error(`Сервер вернул повреждённый ответ (HTTP ${response.statusCode}).`), {code:'INVALID_JSON', status:response.statusCode})); return; }
        if (response.statusCode < 200 || response.statusCode >= 300 || parsed.ok === false) {
          const code=String(parsed.error || `HTTP_${response.statusCode}`);
          finishReject(Object.assign(new Error(cloudFriendlyError(code)), {code, status:response.statusCode, requestId:parsed.request_id})); return;
        }
        finishResolve(parsed);
      });
    });
    req.once('timeout', () => req.destroy(Object.assign(new Error('Сервер лицензий не ответил вовремя.'), {code:'NETWORK_TIMEOUT'})));
    req.once('error', error => finishReject(friendlyCloudNetworkError(error)));
    if (payload) req.write(payload);
    req.end();
  });
}
const CLOUD_RETRYABLE_NETWORK_CODES=new Set(['ECONNRESET','ETIMEDOUT','ESOCKETTIMEDOUT','EAI_AGAIN','ENETDOWN','ENETUNREACH','EHOSTUNREACH','NETWORK_TIMEOUT']);
function isRetryableCloudNetworkError(error){return CLOUD_RETRYABLE_NETWORK_CODES.has(String(error?.code||''))}
function isTemporaryCompanyServiceError(error){
  return isRetryableCloudNetworkError(error)||String(error?.code||'')==='AUTH_SERVICE_UNAVAILABLE'||Number(error?.status)>=500;
}
function telegramCompanyPublishRetryDelay(failures=0){
  const exponent=Math.max(0,Math.min(5,Math.floor(Number(failures)||0)));
  return Math.min(TELEGRAM_COMPANY_PUBLISH_RETRY_MAX_MS,TELEGRAM_COMPANY_PUBLISH_RETRY_BASE_MS*(2**exponent));
}
function friendlyCloudNetworkError(error){
  const code=String(error?.code||'NETWORK_ERROR');
  const messages={
    ECONNRESET:'Защищённое соединение было прервано сетью или VPN. Программа повторит попытку автоматически.',
    ETIMEDOUT:'Сервер входа не ответил вовремя. Проверьте интернет или VPN и повторите вход.',
    ESOCKETTIMEDOUT:'Сервер входа не ответил вовремя. Проверьте интернет или VPN и повторите вход.',
    NETWORK_TIMEOUT:'Сервер входа не ответил вовремя. Проверьте интернет или VPN и повторите вход.',
    EAI_AGAIN:'Не удалось временно определить адрес сервера входа. Проверьте интернет или VPN.',
    ENOTFOUND:'Адрес сервера входа не найден. Проверьте интернет, DNS или VPN.',
    ENETDOWN:'Сетевое подключение отключено. Подключитесь к интернету и повторите вход.',
    ENETUNREACH:'Сервер входа недоступен через текущее подключение. Переподключите интернет или VPN.',
    EHOSTUNREACH:'Сервер входа недоступен через текущее подключение. Переподключите интернет или VPN.'
  };
  return Object.assign(new Error(messages[code]||'Не удалось установить защищённое соединение с сервером входа. Проверьте интернет или VPN и повторите попытку.'),{code,originalMessage:String(error?.message||'')});
}
async function withCloudNetworkRetry(operation,options={}){
  const attempts=Math.max(1,Math.min(5,Number(options.attempts)||3)),sleep=typeof options.sleep==='function'?options.sleep:(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await operation(attempt)}catch(error){
      lastError=error;
      if(!isRetryableCloudNetworkError(error)||attempt>=attempts)throw error;
      if(typeof options.onRetry==='function')options.onRetry(error,attempt,attempts);
      await sleep(attempt===1?450:1100);
    }
  }
  throw lastError;
}
function cloudRequestWithRetry(method,requestPath,body=null,accessToken='',timeoutMs=15000,attempts=3){
  return withCloudNetworkRetry(
    ()=>cloudRequest(method,requestPath,body,accessToken,timeoutMs),
    {attempts,onRetry:(error,attempt,maxAttempts)=>appendLog('cloud request retry',{requestPath,attempt,maxAttempts,code:String(error?.code||'NETWORK_ERROR')})}
  );
}
function publicCloudAuth(state) {
  try{
    const normalized=normalizeCloudAuthState(state);
    return {user:normalized.user, company:normalized.company, device_id:normalized.device_id, offline:!!normalized.offline, offline_expires_at:normalized.offline_expires_at || null, last_verified_at:normalized.last_verified_at || null};
  }catch{return null;}
}
function saveCloudSession(result, context={}) {
  const accessToken=String(result?.access_token||context.access_token||''),offlineToken=String(result?.offline_token||context.offline_token||''),refreshToken=String(result?.refresh_token||context.refresh_token||'');
  const candidate={
    ...context,
    user:{...(context.user||{}),...(result?.user||{})},
    company:{...(context.company||{}),...(result?.company||{})},
    user_id:String(result?.user_id||context.user_id||''),
    company_id:String(result?.company_id||context.company_id||''),
    role:String(result?.role||context.role||''),
    permissions:Array.isArray(result?.permissions)?result.permissions:context.permissions,
    access_token:accessToken,offline_token:offlineToken,refresh_token:refreshToken,
    access_expires_at:tokenExpiresAt(accessToken)||(Date.now()+Number(result?.access_expires_in||900)*1000),
    offline_expires_at:tokenExpiresAt(offlineToken)||(Date.now()+Number(result?.offline_expires_in||259200)*1000),
    refresh_expires_at:String(result?.refresh_expires_at||context.refresh_expires_at||''),
    auth_context_version:Number(result?.auth_context_version||context.auth_context_version||1),
    last_verified_at:new Date().toISOString(),offline:false
  };
  return writeCloudAuthState(candidate);
}
async function restoreCloudAuthSession() {
  const state=readCloudAuthState();
  if (!state?.refresh_token || !cloudSessionComplete(state)) return null;
  try {
    const result=await cloudRequest('POST','/v1/auth/refresh',{refresh_token:state.refresh_token,device_id:getMachineCode()},'',9000);
    return saveCloudSession(result,state);
  } catch (error) {
    if (['INVALID_SESSION','ACCESS_BLOCKED','LICENSE_BLOCKED','USER_BLOCKED','DEVICE_BLOCKED'].includes(String(error.code || ''))) {
      clearCloudAuthState();
      appendLog('cloud auth session revoked', {code:error.code});
      return null;
    }
    if (Number(state.offline_expires_at || 0) > Date.now()) {
      state.offline=true;
      const saved=writeCloudAuthState(state);
      appendLog('cloud auth offline grace used', {company:saved.company.id,until:new Date(saved.offline_expires_at).toISOString(), error:safeIntegrationError(error)});
      return saved;
    }
    clearCloudAuthState();
    return null;
  }
}
async function ensureCloudAccessToken() {
  let state=currentSession?.cloudAuth || readCloudAuthState();
  if (!cloudSessionComplete(state)) throw cloudAuthError('AUTH_REQUIRED','Сначала выполните вход.');
  if (state.access_token && Number(state.access_expires_at || 0) > Date.now()+60000) return state.access_token;
  if(!state.refresh_token)throw cloudAuthError('INVALID_SESSION','Сессия завершена. Выполните вход снова.');
  const result=await cloudRequest('POST','/v1/auth/refresh',{refresh_token:state.refresh_token,device_id:getMachineCode()},'',9000);
  state=saveCloudSession(result,state);
  if (currentSession) currentSession.cloudAuth=state;
  return state.access_token;
}
async function cloudAuthenticatedRequest(method, requestPath, body=null) {
  let token=await ensureCloudAccessToken();
  try { return await cloudRequest(method,requestPath,body,token); }
  catch(error) {
    if (String(error.code || '') !== 'INVALID_TOKEN' && Number(error.status)!==401) throw error;
    const state=currentSession?.cloudAuth || readCloudAuthState();
    if(!cloudSessionComplete(state)||!state.refresh_token)throw cloudAuthError('INVALID_SESSION','Сессия завершена. Выполните вход снова.');
    const refreshed=await cloudRequest('POST','/v1/auth/refresh',{refresh_token:state.refresh_token,device_id:getMachineCode()},'',9000);
    const saved=saveCloudSession(refreshed,state); if(currentSession)currentSession.cloudAuth=saved; token=saved.access_token;
    return cloudRequest(method,requestPath,body,token);
  }
}
async function companyTelegramBrokerRequest(method, requestPath, body=null) {
  const executeOnce=async token=>{
    try{
      return await jsonRequest({
        hostname:COMPANY_TELEGRAM_BROKER_HOST,
        method,
        requestPath,
        headers:{Authorization:`Bearer ${token}`,'User-Agent':`JustFunOrdersLogistics/${VERSION}`},
        body,
        maxBytes:3*1024*1024,
        timeoutMs:30000
      });
    }catch(error){
      const upstreamMessage=String(error?.details?.upstream_message||'').replace(/[\r\n]+/g,' ').trim().slice(0,500);
      const upstreamCode=String(error?.details?.upstream_code||'').trim().slice(0,120);
      if(upstreamMessage){
        throw Object.assign(new Error(`Telegram: ${upstreamMessage}`),error,{code:upstreamCode||String(error?.code||'TELEGRAM_UPSTREAM_ERROR')});
      }
      const friendly=cloudFriendlyError(error?.code);
      if(friendly!==String(error?.code||'')){
        throw Object.assign(new Error(friendly),error,{code:String(error?.code||'')});
      }
      throw error;
    }
  };
  const execute=token=>{
    const operation=()=>executeOnce(token);
    const normalizedMethod=String(method).toUpperCase(),retryable=['GET','PUT'].includes(normalizedMethod);
    if(!retryable)return operation();
    return withCloudNetworkRetry(operation,{attempts:3,onRetry:(error,attempt,maxAttempts)=>appendLog('Telegram company broker retry',{requestPath,attempt,maxAttempts,code:String(error?.code||'NETWORK_ERROR')})});
  };
  let token=await ensureCloudAccessToken();
  try{return await execute(token)}
  catch(error){
    if(String(error?.code||'')!=='INVALID_TOKEN'&&Number(error?.status)!==401)throw error;
    const state=currentSession?.cloudAuth||readCloudAuthState();
    if(!cloudSessionComplete(state)||!state.refresh_token)throw cloudAuthError('INVALID_SESSION','Сессия завершена. Выполните вход снова.');
    const refreshed=await cloudRequest('POST','/v1/auth/refresh',{refresh_token:state.refresh_token,device_id:getMachineCode()},'',9000);
    const saved=saveCloudSession(refreshed,state);if(currentSession)currentSession.cloudAuth=saved;token=saved.access_token;
    return execute(token);
  }
}
async function verifyCloudAuthContext() {
  const existing=currentSession?.cloudAuth||readCloudAuthState();
  if(!cloudSessionComplete(existing))throw cloudAuthError('AUTH_REQUIRED','Сначала выполните вход.');
  const result=await withCloudNetworkRetry(
    ()=>cloudAuthenticatedRequest('POST','/v1/auth/introspect',{}),
    {attempts:3,onRetry:(error,attempt,maxAttempts)=>appendLog('cloud auth context retry',{attempt,maxAttempts,code:String(error?.code||'NETWORK_ERROR')})}
  );
  if(result?.active!==true||!result?.user||!result?.company)throw cloudAuthError('AUTH_CONTEXT_INCOMPLETE','Сервер лицензий не подтвердил пользователя и компанию.');
  const latest=currentSession?.cloudAuth||readCloudAuthState()||existing;
  const verified=writeCloudAuthState({
    ...latest,
    user:{...(latest.user||{}),...(result.user||{})},
    company:{...(latest.company||{}),...(result.company||{})},
    user_id:String(result.user_id||result.user?.id||''),
    company_id:String(result.company_id||result.company?.id||''),
    role:String(result.role||result.user?.role||''),
    permissions:Array.isArray(result.permissions)?result.permissions:result.user?.permissions,
    device_id:String(result.device_id||latest.device_id||''),
    auth_context_version:Number(result.auth_context_version||latest.auth_context_version||1),
    auth_context_verified:true,
    last_verified_at:new Date().toISOString(),offline:false
  });
  if(currentSession)currentSession.cloudAuth=verified;
  appendLog('cloud auth context verified',{company:verified.company.id,user:verified.user.id,role:verified.user.role,contract:verified.auth_context_version});
  return verified;
}
async function normalizeDemoStateWithCloud(dataDir) {
  const local=normalizeDemoState(dataDir);
  try {
    const remote=await cloudRequest('POST','/v1/demo/start',{device_id:getMachineCode()},'',9000);
    local.state=reconcileDemoStateWithCloud(local.state,remote,{recovery:local.recovery});
    persistDemoState(dataDir,local.state);
  } catch(error) {
    if (String(error?.code || '') === 'DEMO_EXPIRED') {
      // Cloudflare remains authoritative after reinstall. A local anchor may be
      // missing on a newly selected data folder, but an expired remote DEMO
      // must still open only the purchase/sign-in surface.
      local.state.expires_at = new Date(Date.now() - 1000).toISOString();
      local.state.last_seen_at = new Date(Math.max(Date.now(), Date.parse(local.state.last_seen_at) || 0)).toISOString();
      persistDemoState(dataDir, local.state);
      appendLog('demo expired according to Cloudflare');
    } else {
      appendLog('demo cloud check unavailable', safeIntegrationError(error));
    }
  }
  return local;
}
function reconcileDemoStateWithCloud(localState, remoteState, options={}) {
  const remoteExpiry=Date.parse(remoteState?.expires_at);
  if (!Number.isFinite(remoteExpiry)) return {...localState};
  const localExpiry=Date.parse(localState?.expires_at);
  const remoteStarted=Date.parse(remoteState?.first_started_at);
  const localStarted=Date.parse(localState?.first_started_at);
  const remoteNow=Date.parse(remoteState?.server_time);
  const localSeen=Date.parse(localState?.last_seen_at);
  const now=Date.now();
  const expiry=options.recovery || !Number.isFinite(localExpiry)
    ? remoteExpiry
    : Math.min(localExpiry,remoteExpiry);
  const startedCandidates=[localStarted,remoteStarted].filter(Number.isFinite);
  const seenCandidates=[localSeen,remoteNow,now].filter(Number.isFinite);
  const base={
    schema:DEMO_SCHEMA,
    machine_code:getMachineCode(),
    first_started_at:new Date(startedCandidates.length?Math.min(...startedCandidates):now).toISOString(),
    expires_at:new Date(expiry).toISOString(),
    // Never move the anti-rollback marker backwards when Windows time changes.
    last_seen_at:new Date(Math.max(...seenCandidates)).toISOString(),
    version_created:String(localState?.version_created||VERSION)
  };
  return {...base,signature:signObject(base)};
}
function safeIntegrationError(error) {
  const text = safeError(error)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{6,14}:[A-Za-z0-9_-]{20,120}\b/g, '[TELEGRAM_TOKEN_REDACTED]')
    .replace(/(api\.telegram\.org\/bot)[^\s/]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?token|bot[_ -]?token|secret[_ -]?token|client[_ -]?api[_ -]?key|password)[\s"'=:]+)[^\s,;}&]+/gi, '$1[REDACTED]');
  return text.slice(0, 800);
}
function randomIntegrationId() { return crypto.randomBytes(24).toString('base64url'); }
function validateWarehouseId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error('Идентификатор склада имеет неверный формат.');
  return id;
}
function validateEnvironment(value) {
  const environment = String(value || '').toLowerCase();
  if (!['live','demo'].includes(environment)) throw new Error('Среда должна быть LIVE или DEMO.');
  return environment;
}
function currentEnvironment() { return currentSession?.edition === 'demo' ? 'demo' : 'live'; }
function requireCurrentEnvironment(value) {
  const environment = validateEnvironment(value);
  if (environment !== currentEnvironment()) throw new Error('Операция другой среды заблокирована: LIVE и DEMO полностью разделены.');
  return environment;
}
function telegramWarehouseScope(warehouseId, environment=currentEnvironment()) {
  const scoped = `${validateEnvironment(environment)}--${validateWarehouseId(warehouseId)}`;
  if (scoped.length > 120) throw new Error('Идентификатор склада слишком длинный для отдельного Telegram-контура.');
  return scoped;
}
function requireActiveRendererWarehouse(value) {
  const warehouseId=validateWarehouseId(value);
  if (activeRendererWarehouseId && warehouseId !== activeRendererWarehouseId) throw new Error('Операция относится не к активному складу и заблокирована.');
  return warehouseId;
}
function activateRendererWarehouse(value) {
  const warehouseId=validateWarehouseId(value);
  if (activeRendererWarehouseId && activeRendererWarehouseId !== warehouseId) {
    stopTelegramCompanyPublishRetry();
    telegramCompanyPublishRetryFailures=0;
  }
  activeRendererWarehouseId=warehouseId;
  return warehouseId;
}
function validateWarehouseSnapshot(snapshot, expectedWarehouseId, expectedEnvironment) {
  const warehouseId = validateWarehouseId(expectedWarehouseId);
  const environment = validateEnvironment(expectedEnvironment);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Снимок склада отсутствует или повреждён.');
  const meta = snapshot.warehouse, data = snapshot.data;
  if (!meta || typeof meta !== 'object' || !data || typeof data !== 'object') throw new Error('В снимке нет обязательных разделов warehouse/data.');
  if (String(meta.id || '') !== warehouseId || String(data.warehouseId || '') !== warehouseId) throw new Error('Снимок относится к другому складу. Передача заблокирована.');
  if (String(meta.environment || '').toLowerCase() !== environment) throw new Error('Смешивание LIVE и DEMO запрещено.');
  const arrays = ['orders','products','inventoryMovements','drivers','routeArchives'];
  const maps = ['routeCatalog','routeExecutions'];
  for (const name of arrays) {
    const records = data[name] ?? [];
    if (!Array.isArray(records)) throw new Error(`Раздел ${name} имеет неверный формат.`);
    for (const record of records) {
      if (!record || typeof record !== 'object') throw new Error(`Раздел ${name} содержит повреждённую запись.`);
      if (record.warehouseId && String(record.warehouseId) !== warehouseId) throw new Error(`Раздел ${name} содержит запись другого склада.`);
    }
  }
  for (const name of maps) {
    const records = data[name] ?? {};
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error(`Раздел ${name} имеет неверный формат.`);
    for (const record of Object.values(records)) {
      if (!record || typeof record !== 'object') throw new Error(`Раздел ${name} содержит повреждённую запись.`);
      if (record.warehouseId && String(record.warehouseId) !== warehouseId) throw new Error(`Раздел ${name} содержит запись другого склада.`);
    }
  }
  validateSnapshotEntityIdentifiers(data);
  const encoded = Buffer.from(JSON.stringify(snapshot), 'utf8');
  if (encoded.length > 30 * 1024 * 1024) throw new Error('Снимок склада превышает 30 МБ. Сначала выполните локальную диагностику и очистите вложенные изображения.');
  return {snapshot, encoded, warehouseId, environment};
}

function validateSnapshotEntityIdentifiers(data) {
  const safe=value=>value === '' || /^[A-Za-z0-9_-]{1,160}$/.test(String(value));
  const visit=(value,key='',depth=0)=>{
    if(depth>40)throw new Error('Снимок имеет недопустимую глубину вложенности.');
    if(Array.isArray(value)){
      if(/Ids$/.test(key))for(const item of value){if(!safe(item))throw new Error(`Снимок содержит небезопасный идентификатор ${key}.`)}
      for(const item of value)visit(item,key,depth+1);
      return;
    }
    if(!value||typeof value!=='object'){
      if(/(?:^id$|Id$)/.test(key)&&!safe(value))throw new Error(`Снимок содержит небезопасный идентификатор ${key}.`);
      return;
    }
    for(const [childKey,child] of Object.entries(value))visit(child,childKey,depth+1);
  };
  for(const mapName of ['routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides','routeExecutions','warehouseReservations']){
    const map=data[mapName];
    if(map&&typeof map==='object'&&!Array.isArray(map))for(const key of Object.keys(map)){if(!safe(key))throw new Error(`Раздел ${mapName} содержит небезопасный ключ.`)}
  }
  visit(data);
}

function normalizeFingerprint(value) { return String(value || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase(); }
function pinnedHttpsAgent(expectedFingerprint) {
  const pin = normalizeFingerprint(expectedFingerprint);
  if (!/^[A-F0-9]{64}$/.test(pin)) throw new Error('Отпечаток сертификата VPS отсутствует или повреждён.');
  // A fresh agent with TLS session caching disabled guarantees that every
  // connection exposes the peer certificate used for certificate pinning.
  const agent = new https.Agent({keepAlive:false, maxSockets:2, maxCachedSessions:0});
  agent.createConnection = (options, callback) => {
    let settled = false;
    const host = String(options?.servername || options?.host || options?.hostname || '');
    const connectOptions = {
      ...options,
      rejectUnauthorized:false,
      servername:nodeNet.isIP(host) ? '' : host,
      ALPNProtocols:['http/1.1']
    };
    const socket = tls.connect(connectOptions);
    const done = (error, readySocket) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.removeListener('error', onEarlyError);
      socket.removeListener('timeout', onHandshakeTimeout);
      callback(error, readySocket);
    };
    const onEarlyError = error => {
      const wrapped = new Error(`TLS-соединение с VPS не установлено: ${String(error?.message || error)}`);
      wrapped.code = String(error?.code || 'TLS_HANDSHAKE_FAILED');
      socket.destroy();
      done(wrapped);
    };
    const onHandshakeTimeout = () => {
      const error = new Error('TLS-соединение с VPS не установлено за отведённое время.');
      error.code = 'TLS_HANDSHAKE_TIMEOUT';
      socket.destroy();
      done(error);
    };
    socket.setTimeout(Math.max(5000, Number(options?.timeout) || 15000));
    socket.once('error', onEarlyError);
    socket.once('timeout', onHandshakeTimeout);
    socket.once('secureConnect', () => {
      try {
        const raw = socket.getPeerCertificate(true)?.raw;
        const actual = raw ? crypto.createHash('sha256').update(raw).digest('hex').toUpperCase() : '';
        if (!actual || actual.length !== pin.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(pin))) {
          const error = new Error('TLS-сертификат VPS изменился. Подключение и передача ключа заблокированы.');
          error.code = 'TLS_PIN_MISMATCH';
          socket.destroy();
          done(error);
          return;
        }
        done(null, socket);
      } catch (error) { socket.destroy(); done(error); }
    });
    // Important: do not return the socket here. Returning it and also invoking
    // the callback hands the same socket to https.Agent twice and allows the
    // HTTP request to start before certificate pinning completes.
  };
  return agent;
}
function jsonRequest({hostname, port=443, method='GET', requestPath='/', headers={}, body=null, fingerprint='', maxBytes=35*1024*1024, timeoutMs=30000}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const requestHeaders = {...headers, Accept:'application/json'};
    if (payload) { requestHeaders['Content-Type']='application/json; charset=utf-8'; requestHeaders['Content-Length']=String(payload.length); }
    const options = {hostname, port, path:requestPath, method, headers:requestHeaders, timeout:timeoutMs};
    if (fingerprint) options.agent = pinnedHttpsAgent(fingerprint);
    const req = https.request(options, response => {
      const chunks=[]; let size=0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error('Ответ сервера превышает допустимый размер.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let parsed={};
        try { parsed=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { reject(new Error(`Сервер вернул повреждённый JSON (HTTP ${response.statusCode}).`)); return; }
        if (response.statusCode < 200 || response.statusCode >= 300 || parsed.ok === false) {
          const error = new Error(String(parsed.message || parsed.error || `HTTP ${response.statusCode}`).slice(0,500));
          error.code = String(parsed.error || `HTTP_${response.statusCode}`);
          error.status = Number(response.statusCode) || 0;
          error.details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
          reject(error); return;
        }
        resolve(parsed);
      });
    });
    req.once('timeout', () => req.destroy(Object.assign(new Error('Сервер не ответил за отведённое время.'),{code:'NETWORK_TIMEOUT'})));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function companyWorkspaceId(authState) {
  const id=String(authState?.company?.id||'');
  if(!COMPANY_WORKSPACE_RE.test(id))throw cloudAuthError('AUTH_CONTEXT_INCOMPLETE','Сервер лицензий не подтвердил идентификатор компании. Выполните вход повторно.');
  return id;
}
function cloudRegState(authState=currentSession?.cloudAuth,local=null) {
  let normalized;
  try{normalized=normalizeCloudAuthState(authState);}catch{return null;}
  const company=normalized?.company,service=company?.data_service;
  if (!company?.id || !service?.address || !service?.tls_sha256) return null;
  const sameAddress=String(local?.address || '') === String(service.address || '');
  return {
    address:String(service.address),
    api_port:Number(service.api_port) || 443,
    tls_sha256:normalizeFingerprint(service.tls_sha256),
    workspace_id:String(company.id),
    configured_at:String(service.updated_at || local?.configured_at || ''),
    ssh_user:sameAddress ? String(local?.ssh_user || '') : '',
    ssh_port:sameAddress ? Number(local?.ssh_port) || 22 : 22,
    source:'company-account'
  };
}
function selectRegState(authState,local,edition='full') {
  if(edition!=='full')return local||null;
  let companyId='';
  try{companyId=companyWorkspaceId(normalizeCloudAuthState(authState));}catch{return null;}
  const cloud=cloudRegState(authState,local);
  if(cloud)return cloud;
  return local&&String(local.workspace_id||'')===companyId?local:null;
}
function regApiSecretName(companyId='') {
  const scope=normalizedCloudId(companyId);
  return scope ? `regApiKey:${scope}` : 'regApiKey';
}
function regVpsAttestationSecretName(companyId='') {
  const scope=normalizedCloudId(companyId);
  if(!scope)throw new Error('Не удалось определить компанию для ключа подтверждения VPS.');
  return`regVpsAttestation:${scope}`;
}
function readLocalRegState(authState=currentSession?.cloudAuth,edition=currentSession?.edition||'full') {
  if(edition!=='full')return readJson(regStatePath(),null);
  let companyId='';
  try{companyId=companyWorkspaceId(normalizeCloudAuthState(authState));}catch{return null;}
  const scopedPath=regStatePath(companyId),scoped=readJson(scopedPath,null);
  if(scoped)return String(scoped.workspace_id||'')===companyId?scoped:null;
  const legacy=readJson(regStatePath(),null);
  if(!legacy||String(legacy.workspace_id||'')!==companyId)return null;
  try{
    writeJsonAtomic(scopedPath,legacy);
    appendLog('REG.RU legacy state migrated',{company:companyId,target:scopedPath});
  }catch(error){appendLog('REG.RU legacy state migration skipped',{company:companyId,error:safeIntegrationError(error)});}
  return legacy;
}
function regState() {
  const edition=currentSession?.edition||'full';
  const local=readLocalRegState(currentSession?.cloudAuth,edition);
  return selectRegState(currentSession?.cloudAuth,local,edition);
}
function canConfigureCompanyServer(authState) {
  const role=String(authState?.user?.role||'');
  const permissions=Array.isArray(authState?.user?.permissions)?authState.user.permissions.map(String):[];
  return role==='owner'||permissions.includes('*')||permissions.includes('integrations.manage')||permissions.includes('company.update');
}
function canManageCompanyWarehouses(authState) {
  const role=String(authState?.user?.role||''),permissions=Array.isArray(authState?.user?.permissions)?authState.user.permissions.map(String):[];
  return role==='owner'||permissions.includes('*')||permissions.includes('warehouses.manage')||permissions.includes('warehouses.*');
}
function canCreateCompanyWarehouses(authState) {
  const role=String(authState?.user?.role||''),permissions=Array.isArray(authState?.user?.permissions)?authState.user.permissions.map(String):[];
  return canManageCompanyWarehouses(authState)&&(role==='owner'||permissions.includes('*')||permissions.includes('jf.warehouse:*'));
}
function canDeleteCompanyWarehouses(authState) {
  return canCreateCompanyWarehouses(authState);
}
function validateWarehouseCode(value) {
  const code=String(value||'').trim();
  if(!/^[A-ZА-ЯЁ0-9]{1,3}$/u.test(code))throw Object.assign(new Error('Код склада имеет неверный формат.'),{code:'WAREHOUSE_CODE_INVALID'});
  return code;
}
function validateWarehouseDeleteLease(result,warehouseId,warehouseCode,authState=currentSession?.cloudAuth) {
  const id=validateWarehouseId(warehouseId),code=validateWarehouseCode(warehouseCode),lease=result?.lease,token=String(result?.lease_token||''),status=String(lease?.status||''),active=status==='active',prepared=status==='prepared';
  const remainingRaw=result?.remaining_seconds,remaining=active?Number(remainingRaw):null,expiresRaw=lease?.expires_at,expiresAt=active?Date.parse(String(expiresRaw||'')):null;
  const activeTimingValid=active&&Number.isSafeInteger(remaining)&&remaining>=30&&Number.isFinite(expiresAt)&&expiresAt>Date.now()+25_000;
  const preparedTimingValid=prepared&&result?.prepared===true&&remainingRaw===null&&expiresRaw===null;
  if(result?.ok!==true||result?.active!==true||String(result?.status||'')!==status||!lease||typeof lease!=='object'||Array.isArray(lease)||String(lease.company_id||'')!==companyWorkspaceId(authState)||String(lease.warehouse_id||'')!==id||String(lease.warehouse_code||'')!==code||!/^wdl_[A-Za-z0-9_-]{8,160}$/.test(String(lease.id||''))||!/^jfdl_[A-Za-z0-9_-]{32,220}$/.test(token)||(!activeTimingValid&&!preparedTimingValid)){
    throw Object.assign(new Error('Сервер не выдал корректное защитное разрешение на удаление.'),{code:'WAREHOUSE_DELETE_LEASE_INVALID'});
  }
  return{token,leaseId:String(lease.id),expiresAt:active?String(expiresRaw):null,remainingSeconds:remaining,status,prepared};
}
async function acquireCloudWarehouseDeleteLease(warehouseId,warehouseCode) {
  const id=validateWarehouseId(warehouseId),code=validateWarehouseCode(warehouseCode);
  const result=await cloudAuthenticatedRequest('POST','/v1/warehouse-delete-leases/acquire',{warehouse_id:id,warehouse_code:code});
  return validateWarehouseDeleteLease(result,id,code);
}
function warehouseDeleteLeaseSecretName(companyId,warehouseId,actorUserId){
  const company=normalizedCloudId(companyId),warehouse=validateWarehouseId(warehouseId),actor=normalizedCloudId(actorUserId);
  if(!company)throw new Error('Не удалось определить компанию для защитного разрешения удаления.');
  if(!actor)throw new Error('Не удалось определить пользователя для защитного разрешения удаления.');
  return`warehouseDeleteLease:${crypto.createHash('sha256').update(`${company}:${warehouse}:${actor}`).digest('hex').slice(0,32)}`;
}
function validWarehouseDeleteLeaseToken(value){return /^jfdl_[A-Za-z0-9_-]{32,220}$/.test(String(value||''))}
function warehouseDeleteLeaseTerminalReleaseError(error){
  return new Set(['WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED','WAREHOUSE_DELETE_LEASE_SUPERSEDED','warehouse_delete_lease_superseded']).has(String(error?.code||''));
}
function warehouseDeletePrepareFailureAction(code,stage){
  const normalized=String(code||'');
  if(new Set(['WAREHOUSE_DELETE_LEASE_SUPERSEDED','warehouse_delete_lease_superseded']).has(normalized))return'superseded';
  if(new Set(['WAREHOUSE_DELETE_LEASE_INVALID_OR_EXPIRED','WAREHOUSE_DELETE_LEASE_REACQUIRE_REQUIRED']).has(normalized))return String(stage||'')==='confirmed'?'reacquire':'superseded';
  return'propagate';
}
function assertWarehouseDeleteSession(authState=currentSession?.cloudAuth){
  const liveAuth=currentSession?.cloudAuth;
  if(!liveAuth||companyWorkspaceId(liveAuth)!==companyWorkspaceId(authState)||warehouseDeleteActorId(liveAuth)!==warehouseDeleteActorId(authState)){
    throw Object.assign(new Error('Пользователь изменился во время удаления склада. Операция безопасно остановлена и будет продолжена после повторного входа того же пользователя.'),{code:'WAREHOUSE_DELETE_SESSION_CHANGED'});
  }
  return true;
}
async function releaseCloudWarehouseDeleteLease(warehouseId,warehouseCode,leaseToken,authState=currentSession?.cloudAuth){
  assertWarehouseDeleteSession(authState);
  const id=validateWarehouseId(warehouseId),code=validateWarehouseCode(warehouseCode),result=await cloudAuthenticatedRequest('POST','/v1/warehouse-delete-leases/release',{
    warehouse_id:id,
    warehouse_code:code,
    lease_token:String(leaseToken||'')
  });
  if(result?.ok!==true||result?.released!==true||String(result?.lease?.company_id||'')!==companyWorkspaceId(authState)||String(result?.lease?.warehouse_id||'')!==id||String(result?.lease?.warehouse_code||'')!==code||String(result?.lease?.status||'')!=='released')throw Object.assign(new Error('Сервер не подтвердил снятие защитной блокировки удаления.'),{code:'WAREHOUSE_DELETE_LEASE_RELEASE_UNCONFIRMED'});
  return true;
}
const WAREHOUSE_DELETE_JOURNAL_PREFIX='warehouse-delete-v3-';
const WAREHOUSE_DELETE_JOURNAL_STAGES=new Set(['confirmed','vps_prepared','telegram_deprovisioned','vps_delete_pending','vps_deleted']);
function warehouseDeleteActorId(authState=currentSession?.cloudAuth){
  const actorId=normalizedCloudId(authState?.user?.id);
  if(!actorId)throw cloudAuthError('AUTH_CONTEXT_INCOMPLETE','Сервер не подтвердил пользователя для удаления склада. Выполните вход повторно.');
  return actorId;
}
function warehouseDeleteJournalPath(companyId,warehouseId,actorUserId){
  const company=normalizedCloudId(companyId),warehouse=validateWarehouseId(warehouseId),actor=normalizedCloudId(actorUserId);
  if(!company)throw new Error('Не удалось определить компанию для журнала удаления склада.');
  if(!actor)throw new Error('Не удалось определить пользователя для журнала удаления склада.');
  const digest=crypto.createHash('sha256').update(`${company}:${warehouse}:${actor}`).digest('hex').slice(0,32);
  return path.join(telegramBaseRoot(),`${WAREHOUSE_DELETE_JOURNAL_PREFIX}${digest}.json`);
}
function normalizeWarehouseDeleteBatch(value,warehouseId){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const rendererShape=source.command_id?{
    commandId:String(source.command_id||''),
    changes:(Array.isArray(source.changes)?source.changes:[]).map(item=>({
      type:item?.type,id:item?.id,baseVersion:item?.base_version,deleted:item?.deleted===true,payload:item?.payload
    })),
    intent:source.intent?{kind:source.intent.kind,targetId:source.intent.target_id}:null
  }:source;
  return validateRegEntityBatch(rendererShape,warehouseId);
}
function validateWarehouseDeleteJournal(value,authState=currentSession?.cloudAuth){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schema_version!==3)throw new Error('Журнал удаления склада повреждён.');
  const companyId=companyWorkspaceId(authState),actorId=warehouseDeleteActorId(authState),warehouseId=validateWarehouseId(value.warehouse_id),warehouseCode=validateWarehouseCode(value.warehouse_code),environment=validateEnvironment(value.environment);
  if(String(value.company_id||'')!==companyId||environment!=='live'||!WAREHOUSE_DELETE_JOURNAL_STAGES.has(String(value.stage||'')))throw new Error('Журнал удаления относится к другой компании или среде.');
  if(String(value.actor_user_id||'')!==actorId)throw Object.assign(new Error('Незавершённое удаление было подтверждено другим пользователем. Его может продолжить только тот же пользователь.'),{code:'WAREHOUSE_DELETE_ACTOR_MISMATCH'});
  const batch=normalizeWarehouseDeleteBatch(value.batch,warehouseId),warehouseChanges=batch.changes.filter(item=>item.type==='warehouse'&&item.id===warehouseId&&item.deleted===true);
  if(batch.intent||batch.changes.length!==1||warehouseChanges.length!==1)throw new Error('Журнал удаления содержит посторонние данные.');
  return{...value,company_id:companyId,actor_user_id:actorId,warehouse_id:warehouseId,warehouse_code:warehouseCode,environment,batch,stage:String(value.stage)};
}
function writeWarehouseDeleteJournal(value){
  ensureDir(telegramBaseRoot());
  const normalized={...value,updated_at:new Date().toISOString()};
  writeJsonAtomic(warehouseDeleteJournalPath(normalized.company_id,normalized.warehouse_id,normalized.actor_user_id),normalized);
  return normalized;
}
function readWarehouseDeleteJournal(companyId,warehouseId,authState=currentSession?.cloudAuth){
  const value=readJson(warehouseDeleteJournalPath(companyId,warehouseId,warehouseDeleteActorId(authState)),null);
  return value?validateWarehouseDeleteJournal(value,authState):null;
}
function beginWarehouseDeleteJournal(warehouseId,warehouseCode,batch,authState=currentSession?.cloudAuth){
  const companyId=companyWorkspaceId(authState),existing=readWarehouseDeleteJournal(companyId,warehouseId,authState);
  if(existing){
    if(existing.warehouse_code!==validateWarehouseCode(warehouseCode))throw new Error('Код склада не совпадает с незавершённой операцией удаления.');
    return existing;
  }
  return writeWarehouseDeleteJournal({
    schema_version:3,
    company_id:companyId,
    actor_user_id:warehouseDeleteActorId(authState),
    warehouse_id:validateWarehouseId(warehouseId),
    warehouse_code:validateWarehouseCode(warehouseCode),
    environment:'live',
    stage:'confirmed',
    batch:normalizeWarehouseDeleteBatch(batch,warehouseId),
    created_at:new Date().toISOString(),
    result:null,
    telegram:null,
    lease_released:false,
    local_cleanup_error:''
  });
}
function validateTelegramDeprovisionResult(result,warehouseId,{installationId='',source='Telegram',reportedWarehouseId='',expectedCompanyId='',expectedWarehouseCode='',expectedDeleteCommandId='',expectedDeleteBaseVersion=0}={}){
  const id=validateWarehouseId(warehouseId),expectedReportedWarehouse=String(reportedWarehouseId||id),reportedInstallation=String(result?.installation_id||''),companyId=String(expectedCompanyId||''),warehouseCode=String(expectedWarehouseCode||''),deleteCommandId=String(expectedDeleteCommandId||''),deleteBaseVersion=Number(expectedDeleteBaseVersion||0);
  if(result?.ok!==true||result?.deprovisioned!==true||String(result?.warehouse_id||'')!==expectedReportedWarehouse||(installationId&&reportedInstallation!==installationId)||(companyId&&String(result?.company_id||'')!==companyId)||(warehouseCode&&String(result?.warehouse_code||'')!==warehouseCode)||(deleteCommandId&&String(result?.delete_command_id||'')!==deleteCommandId)||(deleteBaseVersion&&Number(result?.delete_base_version)!==deleteBaseVersion)||(reportedInstallation&&!/^[A-Za-z0-9._:-]{8,160}$/.test(reportedInstallation))){
    throw Object.assign(new Error(`${source} не подтвердил отключение удаляемого склада.`),{code:'TELEGRAM_DEPROVISION_UNCONFIRMED'});
  }
  return{warehouseId:id,installationId:reportedInstallation,alreadyDeprovisioned:result?.already_deprovisioned===true};
}
function warehouseTelegramScopes(companyId,warehouseId){
  return['live','demo'].map(environment=>telegramScopeParts(companyId,warehouseId,environment));
}
async function deprovisionWarehouseLegacyTelegramWorkers(warehouseId,authState=currentSession?.cloudAuth){
  const id=validateWarehouseId(warehouseId),companyId=companyWorkspaceId(authState),pending=[],direct=[];
  for(const scope of warehouseTelegramScopes(companyId,id)){
    const statePath=path.join(telegramScopeRoot(scope),'state.json'),rawState=readJson(statePath,null);
    if(!rawState)continue;
    if(String(rawState.company_id||'')!==scope.companyId||String(rawState.warehouse_id||'')!==scope.warehouseId||String(rawState.environment||'')!==scope.environment){
      throw Object.assign(new Error('Локальный Telegram-профиль относится к другой компании, складу или среде.'),{code:'TELEGRAM_DEPROVISION_SCOPE_MISMATCH'});
    }
    const installationId=String(rawState.installation_id||'');
    let key='';
    try{key=readNativeSecret(telegramSecretNameForScope(scope))}catch(error){throw Object.assign(error,{code:'TELEGRAM_DEPROVISION_LOCAL_KEY_REQUIRED'})}
    if(!key)throw Object.assign(new Error('Не найден защищённый ключ старого Telegram Worker. Выполните восстановление Telegram и повторите удаление.'),{code:'TELEGRAM_DEPROVISION_LOCAL_KEY_REQUIRED'});
    pending.push({scope,installationId,key,validated:validateWorkerState(rawState)});
  }
  for(const item of pending){
    const result=await jsonRequest({
      hostname:item.validated.url.hostname,
      method:'POST',
      requestPath:'/v1/deprovision',
      headers:{Authorization:`Bearer ${item.key}`},
      body:{},
      maxBytes:1024*1024,
      timeoutMs:30000
    });
    direct.push(validateTelegramDeprovisionResult(result,id,{installationId:item.installationId,source:'Telegram Worker',reportedWarehouseId:telegramWarehouseScope(item.scope.warehouseId,item.scope.environment),expectedCompanyId:item.scope.companyId}));
    item.key='';
  }
  return{direct:direct.map(item=>({installationId:item.installationId,alreadyDeprovisioned:item.alreadyDeprovisioned}))};
}
function deleteTelegramScopeDirectory(scope){
  const base=path.resolve(telegramBaseRoot()),target=path.resolve(telegramScopeRoot(scope)),relative=path.relative(base,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Путь локального Telegram-профиля вышел за разрешённую область.');
  fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
function finalizeWarehouseTelegramLocalCleanup(warehouseId,authState=currentSession?.cloudAuth){
  const id=validateWarehouseId(warehouseId),companyId=companyWorkspaceId(authState),scopes=warehouseTelegramScopes(companyId,id);
  for(const scope of scopes){deleteNativeSecret(telegramSecretNameForScope(scope));deleteTelegramScopeDirectory(scope)}
  for(const scope of scopes){
    const legacy=explicitLegacyTelegramState(scope);if(!legacy)continue;
    for(const name of ['state.json','event-cursors.json']){
      const target=path.join(telegramBaseRoot(),name);if(fs.existsSync(target))fs.rmSync(target,{force:true})
    }
    deleteNativeSecret('telegramClientApiKey');break;
  }
  const liveAuth=currentSession?.cloudAuth;
  if(!liveAuth||companyWorkspaceId(liveAuth)!==companyId||warehouseDeleteActorId(liveAuth)!==warehouseDeleteActorId(authState)){
    appendLog('Warehouse Telegram auth cache cleanup skipped after session change',{companyId,warehouseId:id});
    return true;
  }
  const current=normalizeCloudAuthState(liveAuth),company={...current.company},services=company.telegram_services&&typeof company.telegram_services==='object'&&!Array.isArray(company.telegram_services)?{...company.telegram_services}:{};
  delete services[id];company.telegram_services=services;
  if(String(company.telegram_service?.warehouse_id||'')===id)delete company.telegram_service;
  const saved=writeCloudAuthState({...current,company});if(currentSession)currentSession.cloudAuth=saved;
  return true;
}
const warehouseDeleteOperationLocks=new Map();
async function withWarehouseDeleteOperationLock(companyId,warehouseId,task){
  const company=normalizedCloudId(companyId),warehouse=validateWarehouseId(warehouseId);if(!company||typeof task!=='function')throw new Error('Не удалось создать блокировку удаления склада.');
  const lockKey=`${company}:${warehouse}`,previous=warehouseDeleteOperationLocks.get(lockKey)||Promise.resolve(),current=previous.catch(()=>{}).then(task);
  warehouseDeleteOperationLocks.set(lockKey,current);
  try{return await current}finally{if(warehouseDeleteOperationLocks.get(lockKey)===current)warehouseDeleteOperationLocks.delete(lockKey)}
}
async function completeWarehouseDeleteOperation(args){
  const authState=args?.authState||currentSession?.cloudAuth,companyId=companyWorkspaceId(authState),warehouseId=validateWarehouseId(args?.warehouseId);
  return withWarehouseDeleteOperationLock(companyId,warehouseId,()=>completeWarehouseDeleteOperationUnlocked({...args,warehouseId,authState}));
}
async function completeWarehouseDeleteOperationUnlocked({warehouseId,warehouseCode,batch,state,authState=currentSession?.cloudAuth}){
  let journal=beginWarehouseDeleteJournal(warehouseId,warehouseCode,batch,authState),result=journal.result||null,telegram=journal.telegram||null,lease=null,leaseReleased=journal.lease_released===true;
  const leaseSecretName=warehouseDeleteLeaseSecretName(journal.company_id,journal.warehouse_id,journal.actor_user_id),storedLeaseToken=readNativeSecret(leaseSecretName);
  if(journal.stage!=='vps_deleted'&&!state)throw Object.assign(new Error('VPS REG.RU ещё не подключён; удаление склада остановлено.'),{code:'REG_VPS_NOT_CONFIGURED'});
  if(journal.stage==='vps_deleted'&&storedLeaseToken&&!leaseReleased){
    try{await releaseCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code,storedLeaseToken,authState);leaseReleased=true;journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,lease_released:true,lease_release_error:''})}
    catch(error){
      if(!warehouseDeleteLeaseTerminalReleaseError(error))throw error;
      leaseReleased=true;
      journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,lease_released:true,lease_release_terminal:true,lease_release_error:''});
    }
  }
  if(!leaseReleased){
    if(validWarehouseDeleteLeaseToken(storedLeaseToken))lease={token:storedLeaseToken,prepared:journal.stage!=='confirmed',status:journal.stage==='confirmed'?'active-or-prepared':'prepared'};
    else{assertWarehouseDeleteSession(authState);lease=await acquireCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code);writeNativeSecret(leaseSecretName,lease.token)}
  }
  if(journal.stage!=='vps_deleted'){
    let prepared;
    try{prepared=await prepareRegWarehouseDelete(state,journal,lease.token)}
    catch(error){
      const prepareCode=String(error?.code||''),leaseFailureAction=warehouseDeletePrepareFailureAction(prepareCode,journal.stage);
      if(leaseFailureAction==='superseded'){throw Object.assign(new Error('Операцию удаления продолжает другой компьютер. Этот компьютер больше не меняет защитный токен.'),{code:'WAREHOUSE_DELETE_LEASE_SUPERSEDED'})}
      else if(leaseFailureAction==='reacquire'){assertWarehouseDeleteSession(authState);lease=await acquireCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code);writeNativeSecret(leaseSecretName,lease.token);prepared=await prepareRegWarehouseDelete(state,journal,lease.token)}
      else{
      const alreadyCompleted=journal.stage==='confirmed'&&prepareCode==='warehouse_delete_completed';
      const safeToRestart=journal.stage==='confirmed'&&new Set(['entity_version_conflict','warehouse_delete_requires_archived','warehouse_deleted','invalid_warehouse_code','warehouse_delete_prepare_mismatch']).has(prepareCode);
      if(alreadyCompleted){
        try{
          await releaseCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code,lease.token,authState);
          deleteNativeSecret(leaseSecretName);
          fs.rmSync(warehouseDeleteJournalPath(journal.company_id,journal.warehouse_id,journal.actor_user_id),{force:true});
          sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-refresh',status:'completed-elsewhere',warehouseId:journal.warehouse_id,message:'Склад уже удалён на другом компьютере. Обновляем список складов с VPS.'});
        }catch(releaseError){appendLog('Completed warehouse delete cleanup deferred',{warehouseId:journal.warehouse_id,code:String(releaseError?.code||'')});throw releaseError}
        throw Object.assign(new Error('Склад уже удалён на другом компьютере. Список складов обновляется с VPS.'),{code:'WAREHOUSE_DELETE_ALREADY_COMPLETED'});
      }
      if(safeToRestart){
        try{
          await releaseCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code,lease.token,authState);
          deleteNativeSecret(leaseSecretName);
          fs.rmSync(warehouseDeleteJournalPath(journal.company_id,journal.warehouse_id,journal.actor_user_id),{force:true});
          sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-refresh',status:'reset',warehouseId:journal.warehouse_id,message:'Удаление безопасно остановлено. Обновляем склад с VPS перед новой попыткой.'});
          appendLog('Warehouse delete prepare rejected safely; confirmation reset',{warehouseId:journal.warehouse_id,code:prepareCode});
        }catch(releaseError){appendLog('Warehouse delete prepare reset deferred',{warehouseId:journal.warehouse_id,code:String(releaseError?.code||'')})}
      }
      throw error;
      }
    }
    if(prepared.recoveredExisting&&prepared.commandId!==journal.batch.command_id){
      const change=journal.batch.changes[0],adoptedBatch={command_id:prepared.commandId,changes:[{...change,base_version:prepared.baseVersion}],intent:null};
      journal=writeWarehouseDeleteJournal({...journal,batch:adoptedBatch,recovered_existing:true,recovered_at:new Date().toISOString()});
    }
    if(prepared.status==='completed'){
      result=await submitRegEntityBatch(
        state,
        journal.warehouse_id,
        journal.environment,
        {...journal.batch,warehouse_delete_lease_token:lease.token,warehouse_delete_warehouse_code:journal.warehouse_code}
      );
      telegram=await deprovisionWarehouseLegacyTelegramWorkers(journal.warehouse_id,authState);
      journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,completed_elsewhere:true,local_cleanup_error:''});
    }
    if(journal.stage==='confirmed')journal=writeWarehouseDeleteJournal({...journal,stage:'vps_prepared',prepared_at:prepared.preparedAt});
    if(journal.stage==='vps_prepared'){
      telegram=await deprovisionWarehouseLegacyTelegramWorkers(journal.warehouse_id,authState);
      journal=writeWarehouseDeleteJournal({...journal,stage:'telegram_deprovisioned',telegram});
    }
    if(journal.stage!=='vps_deleted'){
      journal=writeWarehouseDeleteJournal({...journal,stage:'vps_delete_pending'});
      result=await submitRegEntityBatch(
        state,
        journal.warehouse_id,
        journal.environment,
        {...journal.batch,warehouse_delete_lease_token:lease.token,warehouse_delete_warehouse_code:journal.warehouse_code}
      );
      journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,local_cleanup_error:''});
    }
  }
  if(!leaseReleased){
    try{await releaseCloudWarehouseDeleteLease(journal.warehouse_id,journal.warehouse_code,lease.token,authState);leaseReleased=true;journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,lease_released:true,lease_release_error:''})}
    catch(error){
      if(warehouseDeleteLeaseTerminalReleaseError(error)){
        leaseReleased=true;
        journal=writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,lease_released:true,lease_release_terminal:true,lease_release_error:''});
      }else{
        writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,local_cleanup_error:'',lease_release_error:safeIntegrationError(error)});throw error;
      }
    }
  }
  deleteNativeSecret(leaseSecretName);
  let localCleanupPending=false;
  try{
    finalizeWarehouseTelegramLocalCleanup(journal.warehouse_id,authState);
    fs.rmSync(warehouseDeleteJournalPath(journal.company_id,journal.warehouse_id,journal.actor_user_id),{force:true});
  }catch(error){
    localCleanupPending=true;
    writeWarehouseDeleteJournal({...journal,stage:'vps_deleted',result,telegram,local_cleanup_error:safeIntegrationError(error)});
    appendLog('Warehouse Telegram local cleanup pending',{warehouseId:journal.warehouse_id,error:safeIntegrationError(error)});
  }
  return{result,telegram,localCleanupPending,commandId:journal.batch.command_id};
}
async function resumePendingWarehouseDeleteOperations(authState=currentSession?.cloudAuth){
  if(!authState)return[];
  const companyId=companyWorkspaceId(authState),base=telegramBaseRoot(),resumed=[];
  if(!fs.existsSync(base))return resumed;
  for(const entry of fs.readdirSync(base,{withFileTypes:true})){
    if(!entry.isFile()||!entry.name.startsWith(WAREHOUSE_DELETE_JOURNAL_PREFIX)||!entry.name.endsWith('.json'))continue;
    let journal;
    try{journal=validateWarehouseDeleteJournal(readJson(path.join(base,entry.name),null),authState)}catch(error){appendLog('Warehouse delete journal rejected',{file:entry.name,error:safeIntegrationError(error)});continue}
    if(journal.company_id!==companyId)continue;
    try{
      const completed=await completeWarehouseDeleteOperation({warehouseId:journal.warehouse_id,warehouseCode:journal.warehouse_code,batch:journal.batch,state:regState(),authState});
      resumed.push({warehouseId:journal.warehouse_id,ok:true,localCleanupPending:completed.localCleanupPending});
    }catch(error){appendLog('Warehouse delete resume deferred',{warehouseId:journal.warehouse_id,code:String(error?.code||''),error:safeIntegrationError(error)});resumed.push({warehouseId:journal.warehouse_id,ok:false,code:String(error?.code||'')})}
  }
  return resumed;
}
const WAREHOUSE_DELETE_RESUME_DELAYS_MS=[5000,15000,30000,60000,120000,300000,600000,900000];
let warehouseDeleteResumeRunning=false,warehouseDeleteResumeTimer=null,warehouseDeleteResumeRetryIndex=0,warehouseDeleteResumeGeneration=0;
function stopWarehouseDeleteResume(){
  if(warehouseDeleteResumeTimer)clearTimeout(warehouseDeleteResumeTimer);
  warehouseDeleteResumeTimer=null;warehouseDeleteResumeRetryIndex=0;warehouseDeleteResumeGeneration++;
}
function schedulePendingWarehouseDeleteResume(reason='session',delayMs=0){
  if(warehouseDeleteResumeRunning||warehouseDeleteResumeTimer||currentSession?.edition!=='full'||!currentSession?.cloudAuth||!canDeleteCompanyWarehouses(currentSession.cloudAuth))return false;
  const delay=Math.max(0,Math.min(900000,Number(delayMs)||0)),scheduledGeneration=warehouseDeleteResumeGeneration,scheduledAuth=currentSession.cloudAuth,scheduledCompanyId=companyWorkspaceId(scheduledAuth),scheduledActorId=warehouseDeleteActorId(scheduledAuth);
  warehouseDeleteResumeTimer=setTimeout(async()=>{
    warehouseDeleteResumeTimer=null;
    const sessionMatches=()=>warehouseDeleteResumeGeneration===scheduledGeneration&&currentSession?.edition==='full'&&currentSession?.cloudAuth&&companyWorkspaceId(currentSession.cloudAuth)===scheduledCompanyId&&warehouseDeleteActorId(currentSession.cloudAuth)===scheduledActorId;
    if(!sessionMatches())return;
    warehouseDeleteResumeRunning=true;
    let results=[],fatalError=null;
    try{results=await resumePendingWarehouseDeleteOperations(scheduledAuth);if(results.length)appendLog('Warehouse delete journals resumed',{reason,results})}
    catch(error){fatalError=error;appendLog('Warehouse delete journal resume failed',{reason,code:String(error?.code||''),error:safeIntegrationError(error)})}
    finally{warehouseDeleteResumeRunning=false}
    if(!sessionMatches()){
      appendLog('Warehouse delete resume result ignored after session change',{reason,companyId:scheduledCompanyId,actorId:scheduledActorId});
      if(currentSession?.edition==='full'&&currentSession?.cloudAuth&&canDeleteCompanyWarehouses(currentSession.cloudAuth))schedulePendingWarehouseDeleteResume('session-changed',0);
      return;
    }
    const terminalCodes=new Set(['WAREHOUSE_DELETE_ALREADY_COMPLETED','WAREHOUSE_DELETE_LEASE_SUPERSEDED','warehouse_delete_lease_superseded','WAREHOUSE_DELETE_ACTOR_MISMATCH']),attentionRequired=results.some(item=>item.ok!==true&&terminalCodes.has(String(item.code||'')));
    const retryRequired=Boolean(fatalError)||results.some(item=>item.ok!==true&&!terminalCodes.has(String(item.code||'')));
    if(retryRequired&&warehouseDeleteResumeRetryIndex<WAREHOUSE_DELETE_RESUME_DELAYS_MS.length){
      const nextDelay=WAREHOUSE_DELETE_RESUME_DELAYS_MS[warehouseDeleteResumeRetryIndex++];
      sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-resume',status:'retrying',retryInSeconds:Math.ceil(nextDelay/1000),message:`Удаление склада ещё не завершено из-за временной ошибки. Повтор через ${Math.ceil(nextDelay/1000)} сек.`});
      schedulePendingWarehouseDeleteResume('automatic-retry',nextDelay);
    }else if(retryRequired){
      warehouseDeleteResumeRetryIndex=0;
      sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-resume',status:'attention',message:'Автоматическое удаление склада пока не завершено. Данные сохранены; проверьте VPS и Telegram и повторите действие.'});
    }else if(attentionRequired){
      warehouseDeleteResumeRetryIndex=0;
      sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-resume',status:'attention',message:'Удаление этого склада продолжает другой компьютер или другой пользователь. Этот компьютер не меняет защитные данные.'});
    }else{
      warehouseDeleteResumeRetryIndex=0;
      if(results.some(item=>item.ok===true))sendWindowMessage(mainWindow,'desktop:app-event',{type:'warehouse-delete-resume',status:'completed',message:'Отложенное удаление склада безопасно завершено.'});
    }
  },delay);
  warehouseDeleteResumeTimer.unref?.();
  return true;
}
const REG_ENTITY_TYPES=new Set([
  'warehouse','orders','products','inventoryMovements','drivers','settings','reportingData','company',
  'routePlans','routeAssignments','routeCatalog','routeDriverAssignments','routeLocks','routeOverrides',
  'routeExecutions','routeArchives','warehouseReservations','manualRouteSequences'
]);
const REG_ENTITY_INTENTS=new Set(['route_approve','route_picking','route_cancel','route_start','route_return','route_close','pickup_ready','pickup_collected']);
const REG_API_CONTRACT=3;
const ADDRESS_API_CONTRACT=1;
const ADDRESS_PUBLIC_FALLBACK_ALLOWED=RELEASE.release_status==='development';
function regEntityPath(state,warehouseId,environment,kind='entities'){
  const workspace=String(state?.workspace_id||'');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(workspace))throw new Error('Идентификатор подключения VPS повреждён.');
  const root=`/v1/workspaces/${encodeURIComponent(workspace)}/warehouses/${encodeURIComponent(validateWarehouseId(warehouseId))}`;
  const env=validateEnvironment(environment);
  if(kind==='batch')return`${root}/entities/${env}/batch`;
  if(kind==='changes')return`${root}/changes/${env}`;
  return`${root}/entities/${env}`;
}
function regWarehouseDeletePreparePath(state,warehouseId){
  const workspace=String(state?.workspace_id||'');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(workspace))throw new Error('Идентификатор подключения VPS повреждён.');
  return`/v1/workspaces/${encodeURIComponent(workspace)}/warehouses/${encodeURIComponent(validateWarehouseId(warehouseId))}/delete-prepare`;
}
function regAddressSearchPath(state,warehouseId,environment){
  const workspace=String(state?.workspace_id||'');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(workspace))throw new Error('Идентификатор подключения VPS повреждён.');
  return`/v1/workspaces/${encodeURIComponent(workspace)}/warehouses/${encodeURIComponent(validateWarehouseId(warehouseId))}/address-search/${validateEnvironment(environment)}`;
}
function validateRegEntity(item,warehouseId,{event=false}={}){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('VPS вернул повреждённую сущность.');
  const type=String(item.type||''),id=String(item.id||'');
  if(!REG_ENTITY_TYPES.has(type)||!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw new Error('VPS вернул неизвестную сущность.');
  const version=Number(item.version);
  if(!Number.isSafeInteger(version)||version<1)throw new Error('VPS вернул неверную версию сущности.');
  const operation=event?String(item.operation||''):'';
  if(event&&!['upsert','delete'].includes(operation))throw new Error('VPS вернул неизвестную операцию сущности.');
  const payload=operation==='delete'?null:item.payload;
  if(operation!=='delete'&&(!payload||typeof payload!=='object'||Array.isArray(payload)))throw new Error('VPS вернул повреждённые данные сущности.');
  const declaredWarehouse=String(payload?.warehouseId||payload?.warehouse_id||'');
  if(declaredWarehouse&&declaredWarehouse!==warehouseId)throw new Error('VPS вернул сущность другого склада.');
  return{...item,type,id,version,payload,operation};
}
function validateRegEntityBatch(payload,warehouseId){
  const commandId=String(payload?.commandId||'');
  if(!/^[A-Za-z0-9_.:-]{16,180}$/.test(commandId))throw new Error('Для записи не создан безопасный идентификатор команды.');
  const source=Array.isArray(payload?.changes)?payload.changes:[];
  if(!source.length||source.length>1000)throw new Error('Пакет должен содержать от 1 до 1000 изменений.');
  const seen=new Set(),changes=source.map(item=>{
    const type=String(item?.type||''),id=String(item?.id||''),baseVersion=Number(item?.baseVersion),deleted=item?.deleted===true;
    if(!REG_ENTITY_TYPES.has(type)||!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw new Error('Пакет содержит неизвестную сущность.');
    if(!Number.isSafeInteger(baseVersion)||baseVersion<0)throw new Error(`Не указана версия ${type}/${id}.`);
    const key=`${type}:${id}`;if(seen.has(key))throw new Error(`Сущность ${key} повторяется в пакете.`);seen.add(key);
    const value=deleted?null:item?.payload;
    if(!deleted&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error(`Сущность ${key} содержит повреждённые данные.`);
    const owner=String(value?.warehouseId||value?.warehouse_id||'');if(owner&&owner!==warehouseId)throw new Error(`Сущность ${key} относится к другому складу.`);
    return{type,id,base_version:baseVersion,deleted,payload:value};
  });
  let intent=null;
  if(payload?.intent!=null){
    const kind=String(payload.intent?.kind||''),targetId=String(payload.intent?.targetId||'');
    if(!REG_ENTITY_INTENTS.has(kind)||!/^[A-Za-z0-9_-]{1,160}$/.test(targetId))throw new Error('Назначение серверной команды повреждено.');
    intent={kind,target_id:targetId};
  }
  return{command_id:commandId,changes,intent};
}
async function submitRegEntityBatch(state,warehouseId,environment,batch){
  const warehouseDelete=batch?.changes?.length===1&&batch.changes[0]?.type==='warehouse'&&batch.changes[0]?.deleted===true;
  const result=await regApiRequest('POST',regEntityPath(state,warehouseId,environment,'batch'),batch,{timeoutMs:warehouseDelete?120000:30000});
  if(String(result.workspace_id||'')!==String(state.workspace_id||'')||String(result.warehouse_id||'')!==warehouseId||String(result.environment||'')!==environment||String(result.command_id||'')!==batch.command_id)throw new Error('VPS вернул подтверждение другой команды или области данных.');
  const cursor=Number(result.cursor);if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error('VPS вернул повреждённый курсор изменений.');
  const entities=(Array.isArray(result.entities)?result.entities:[]).map(item=>{
    const type=String(item?.type||''),id=String(item?.id||''),version=Number(item?.version),eventId=Number(item?.event_id||0);
    if(!REG_ENTITY_TYPES.has(type)||!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!Number.isSafeInteger(version)||version<0||!Number.isSafeInteger(eventId)||eventId<0)throw new Error('VPS вернул повреждённое подтверждение сущности.');
    return{type,id,version,eventId,digest:String(item?.digest_sha256||''),deleted:item?.deleted===true,unchanged:item?.unchanged===true};
  });
  const cascadeDeleted=Number(result.cascade_deleted??0),rawCascadeByEnvironment=result.cascade_by_environment??{live:0,demo:0};if(!Number.isSafeInteger(cascadeDeleted)||cascadeDeleted<0||!rawCascadeByEnvironment||typeof rawCascadeByEnvironment!=='object'||Array.isArray(rawCascadeByEnvironment))throw new Error('VPS вернул повреждённый результат каскадного удаления.');
  const cascadeByEnvironment={};for(const environmentName of ['live','demo']){const count=Number(rawCascadeByEnvironment[environmentName]??0);if(!Number.isSafeInteger(count)||count<0)throw new Error('VPS вернул повреждённый результат каскадного удаления.');cascadeByEnvironment[environmentName]=count}if(cascadeByEnvironment.live+cascadeByEnvironment.demo!==cascadeDeleted)throw new Error('VPS вернул несогласованный результат каскадного удаления.');
  const historyPayloadsRedacted=Number(result.history_payloads_redacted??0);if(!Number.isSafeInteger(historyPayloadsRedacted)||historyPayloadsRedacted<0)throw new Error('VPS вернул повреждённый результат очистки истории склада.');
  if(warehouseDelete&&(Number(result.delete_prepare_contract)!==1||String(result.delete_operation_status||'')!=='completed'||result.delete_operation_completed!==true||result.telegram_deprovisioned!==true||Number(result.delete_operation_base_version)!==Number(batch.changes[0].base_version)||String(result.delete_operation_warehouse_code||'')!==String(batch.warehouse_delete_warehouse_code||'')||(String(result.telegram_installation_id||'')&&!/^[A-Za-z0-9._:-]{8,160}$/.test(String(result.telegram_installation_id)))))throw Object.assign(new Error('VPS не подтвердил завершение подготовленной операции удаления и отключение Telegram.'),{code:'WAREHOUSE_DELETE_COMPLETION_UNCONFIRMED'});
  return{cursor,entities,replayed:result.replayed===true,cascade_deleted:cascadeDeleted,cascade_by_environment:cascadeByEnvironment,history_payloads_redacted:historyPayloadsRedacted,delete_operation_completed:warehouseDelete,telegram_deprovisioned:warehouseDelete&&result.telegram_deprovisioned===true,telegram_already_deprovisioned:warehouseDelete&&result.telegram_already_deprovisioned===true,telegram_installation_id:warehouseDelete?String(result.telegram_installation_id||''):''}
}
async function prepareRegWarehouseDelete(state,journal,leaseToken){
  const change=journal?.batch?.changes?.[0],body={
    command_id:String(journal?.batch?.command_id||''),
    base_version:Number(change?.base_version),
    warehouse_code:validateWarehouseCode(journal?.warehouse_code),
    warehouse_delete_lease_token:String(leaseToken||'')
  };
  if(change?.type!=='warehouse'||change?.id!==journal?.warehouse_id||change?.deleted!==true||journal?.batch?.changes?.length!==1||!Number.isSafeInteger(body.base_version)||body.base_version<1||!/^jfdl_[A-Za-z0-9_-]{32,220}$/.test(body.warehouse_delete_lease_token))throw new Error('Нельзя подготовить повреждённую команду удаления склада.');
  const result=await regApiRequest('POST',regWarehouseDeletePreparePath(state,journal.warehouse_id),body,{timeoutMs:60000}),status=String(result?.status||''),preparedAt=String(result?.prepared_at||''),completedAt=result?.completed_at==null?null:String(result.completed_at),commandId=String(result?.command_id||''),baseVersion=Number(result?.base_version),recoveredExisting=result?.recovered_existing===true;
  const commandMatches=commandId===body.command_id&&baseVersion===body.base_version;
  if(result?.ok!==true||String(result.workspace_id||'')!==String(state.workspace_id||'')||String(result.warehouse_id||'')!==journal.warehouse_id||Number(result.delete_prepare_contract)!==1||String(result.operation||'')!=='warehouse_delete'||!['prepared','completed'].includes(status)||!/^[A-Za-z0-9_.:-]{16,180}$/.test(commandId)||String(result.warehouse_code||'')!==body.warehouse_code||!Number.isSafeInteger(baseVersion)||baseVersion<1||(!commandMatches&&!recoveredExisting)||!Number.isFinite(Date.parse(preparedAt))||(status==='completed'?!Number.isFinite(Date.parse(completedAt||'')):completedAt!==null))throw Object.assign(new Error('VPS не подтвердил безопасную подготовку удаления склада.'),{code:'WAREHOUSE_DELETE_PREPARE_UNCONFIRMED'});
  return{status,replayed:result.replayed===true,preparedAt,completedAt,commandId,baseVersion,recoveredExisting};
}
async function regApiRequest(method, requestPath, body=null, options={}) {
  const state = regState();
  if (!state) throw new Error('VPS REG.RU ещё не подключён.');
  const address=String(state.address || '');
  if (!nodeNet.isIP(address) && !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(address)) {
    throw new Error('В сохранённых настройках VPS нет корректного адреса.');
  }
  let token='';
  if (currentSession?.edition !== 'demo') {
    const authState=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState());
    const companyId=companyWorkspaceId(authState);
    if(String(state.workspace_id||'')!==companyId)throw new Error('Подключение REG.RU относится к другой компании. Передача данных заблокирована.');
    token=await ensureCloudAccessToken();
  } else {
    token=readNativeSecret(regApiSecretName());
  }
  if (!token) throw new Error('Сначала выполните вход в свою учётную запись.');
  const timeoutMs=Math.min(120000,Math.max(5000,Number(options?.timeoutMs)||30000));
  return jsonRequest({hostname:state.address, port:Number(state.api_port)||443, method, requestPath,
    headers:{Authorization:`Bearer ${token}`,'X-JustFun-API-Contract':String(REG_API_CONTRACT),'X-JustFun-Client-Version':VERSION}, body, fingerprint:state.tls_sha256,timeoutMs});
}
function validateMapCoordinate(value,min,max,label){
  const number=Number(value);
  if(!Number.isFinite(number)||number<min||number>max)throw new Error(`Координата ${label} указана неверно.`);
  return number;
}
function validateDesktopGeocodePayload(payload){
  const mode=String(payload?.mode||'search');
  if(mode==='search'){
    const query=String(payload?.query||'').replace(/\s+/g,' ').trim(),limit=Number(payload?.limit||10);
    if(query.length<3||query.length>300)throw new Error('Введите адрес длиной от 3 до 300 символов.');
    if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new Error('Лимит результатов поиска повреждён.');
    return{mode,query,limit,addressOnly:payload?.addressOnly!==false};
  }
  if(mode==='reverse')return{mode,lat:validateMapCoordinate(payload?.lat,-90,90,'широты'),lon:validateMapCoordinate(payload?.lon,-180,180,'долготы')};
  throw new Error('Неизвестный режим поиска адреса.');
}
function validateDesktopAddressSearchPayload(payload){
  const query=String(payload?.query||'').replace(/\s+/g,' ').trim();
  if(query.length<3||query.length>300)throw new Error('Введите адрес длиной от 3 до 300 символов.');
  const requestId=String(payload?.requestId||'');
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(requestId))throw new Error('Идентификатор адресного запроса повреждён.');
  const interaction=String(payload?.interaction||'');
  if(!['autocomplete','explicit'].includes(interaction))throw new Error('Режим адресного поиска повреждён.');
  const warehouseId=validateWarehouseId(payload?.warehouseId),environment=currentEnvironment();
  const preferredRegion=String(payload?.preferredRegion||'').replace(/\s+/g,' ').trim().slice(0,160);
  return{
    requestId,query,warehouseId,environment,preferredRegion,interaction,
    requestBody:{request_id:requestId,query,preferred_region:preferredRegion,language:'ru',limit:3,client_version:VERSION,address_contract:ADDRESS_API_CONTRACT,interaction}
  };
}
function addressProviderText(value,max,label,{required=false}={}){
  if(value===null||value===undefined||value===''){
    if(required)throw new Error(`VPS не вернул ${label}.`);
    return'';
  }
  if(typeof value!=='string')throw new Error(`VPS вернул повреждённое поле ${label}.`);
  const text=value.trim();
  if((required&&!text)||text.length>max||/[\u0000-\u001f\u007f]/.test(text))throw new Error(`VPS вернул повреждённое поле ${label}.`);
  return text;
}
function canonicalAddressToNominatim(item,input,provider){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('VPS вернул повреждённый вариант адреса.');
  const id=String(item.id||''),displayName=addressProviderText(item.display_name,1000,'полный адрес',{required:true});
  if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(id))throw new Error('VPS вернул повреждённый идентификатор адреса.');
  const components=item.components&&typeof item.components==='object'&&!Array.isArray(item.components)?item.components:{};
  const coordinates=item.coordinates&&typeof item.coordinates==='object'&&!Array.isArray(item.coordinates)?item.coordinates:{};
  const optionalCoordinate=(value,min,max)=>{if(value===null||value===undefined||value==='')return null;const number=Number(value);if(!Number.isFinite(number)||number<min||number>max)throw new Error('VPS вернул повреждённые координаты адреса.');return number};
  const lat=optionalCoordinate(coordinates.lat,-90,90),lon=optionalCoordinate(coordinates.lon,-180,180);
  if((lat===null)!==(lon===null))throw new Error('VPS вернул неполную пару координат адреса.');
  const confidence=String(item.confidence||'');
  if(!['high','medium','low'].includes(confidence))throw new Error('VPS вернул повреждённую оценку адреса.');
  const score=Number(item.match_score);
  if(!Number.isFinite(score)||score<0||score>1)throw new Error('VPS вернул повреждённый рейтинг адреса.');
  const boundedList=(value,label)=>{if(!Array.isArray(value)||value.length>8)throw new Error(`VPS вернул повреждённый список ${label}.`);return value.map(entry=>addressProviderText(entry,180,label,{required:true}))};
  const reasons=boundedList(item.match_reason,'причин совпадения');
  const warnings=boundedList(item.warnings,'предупреждений');
  const source=item.source&&typeof item.source==='object'&&!Array.isArray(item.source)?item.source:{};
  const providerIds=item.provider_ids&&typeof item.provider_ids==='object'&&!Array.isArray(item.provider_ids)?Object.fromEntries(Object.entries(item.provider_ids).filter(([key,value])=>/^[A-Za-z0-9_.:-]{1,80}$/.test(String(key))&&typeof value==='string'&&value.length>0&&value.length<=160).slice(0,8)):{};
  const fiasId=addressProviderText(item.fias_id,36,'идентификатор ФИАС');
  if(fiasId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fiasId))throw new Error('VPS вернул повреждённый идентификатор ФИАС.');
  const sourceDate=addressProviderText(source.date||provider.queried_at.slice(0,10),10,'дату источника');
  if(sourceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))throw new Error('VPS вернул повреждённую дату источника.');
  return{
    place_id:id,display_name:displayName,lat:lat===null?'':String(lat),lon:lon===null?'':String(lon),importance:score,
    address:{state:addressProviderText(components.region,160,'регион'),state_district:addressProviderText(components.district,200,'район'),city:addressProviderText(components.settlement,200,'населённый пункт'),allotments:addressProviderText(components.territory,200,'территорию'),road:addressProviderText(components.street,240,'улицу'),house_number:addressProviderText(components.house,80,'дом'),postcode:addressProviderText(components.postal_code,16,'индекс')},
    __jfAddressMeta:{version:String(provider.api_version||''),confidence,confidencePercent:Math.round(score*100),reasons,warnings},
    __jfCanonicalAddress:{id,fiasId,providerIds,objectType:addressProviderText(item.object_type,80,'тип адреса'),coordinateAccuracy:addressProviderText(coordinates.accuracy||'unknown',40,'точность координат',{required:true}),sourceName:addressProviderText(source.name||provider.name,80,'название источника',{required:true}),sourceVersion:addressProviderText(source.version||provider.api_version,80,'версию источника',{required:true}),sourceDate,datasetVersion:'',datasetChecksum:'',originalInput:input.query,normalizedInput:String(input.normalizedQuery||''),official:Boolean(fiasId),manual:false}
  };
}
function validateAddressSearchResponse(result,input,state){
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('VPS вернул повреждённый ответ адресного поиска.');
  if(result.ok!==true)throw new Error('VPS не подтвердил успешный адресный поиск.');
  if(String(result.workspace_id||'')!==String(state?.workspace_id||'')||String(result.warehouse_id||'')!==input.warehouseId||String(result.environment||'')!==input.environment)throw new Error('VPS вернул адреса другой компании, склада или среды.');
  if(Number(result.address_contract)!==ADDRESS_API_CONTRACT||String(result.request_id||'')!==input.requestId)throw new Error('VPS вернул ответ другого адресного запроса или договора.');
  const provider=result.provider&&typeof result.provider==='object'&&!Array.isArray(result.provider)?result.provider:null;
  const queriedAt=String(provider?.queried_at||''),cacheTtl=Number(provider?.cache_ttl_seconds);
  if(!provider||!/^[A-Za-z0-9_.:-]{1,80}$/.test(String(provider.name||''))||!/^[A-Za-z0-9_.:-]{1,80}$/.test(String(provider.api_version||''))||!/^[A-Za-z0-9_.:-]{1,80}$/.test(String(provider.reference||''))||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(queriedAt)||Number.isNaN(Date.parse(queriedAt))||!Number.isSafeInteger(cacheTtl)||cacheTtl<60||cacheTtl>86400)throw new Error('VPS не подтвердил источник адресного поиска.');
  if(!Array.isArray(result.results))throw new Error('VPS вернул повреждённый список адресов.');
  const source=result.results;
  if(source.length>3)throw new Error('VPS нарушил лимит адресных вариантов.');
  input.normalizedQuery=String(result.normalized_query||'').slice(0,500);
  return source.map(item=>canonicalAddressToNominatim(item,input,provider));
}
function validateDesktopRoutePayload(payload){
  const operation=String(payload?.operation||'route'),source=Array.isArray(payload?.points)?payload.points:[];
  if(!['route','table'].includes(operation))throw new Error('Неизвестный режим дорожного расчёта.');
  if(source.length<2||source.length>100)throw new Error('Для маршрута требуется от 2 до 100 точек.');
  const points=source.map(point=>({lat:validateMapCoordinate(point?.lat,-90,90,'широты'),lon:validateMapCoordinate(point?.lon,-180,180,'долготы')}));
  return{operation,points};
}
async function directOpenStreetMapGeocode(payload){
  const input=validateDesktopGeocodePayload(payload),params=new URLSearchParams({format:'jsonv2',addressdetails:'1','accept-language':'ru'});
  let requestPath;
  if(input.mode==='search'){
    params.set('q',input.query);params.set('limit',String(input.limit));if(input.addressOnly)params.set('layer','address');
    requestPath=`/search?${params.toString()}`;
  }else{
    params.set('lat',String(input.lat));params.set('lon',String(input.lon));params.set('zoom','18');
    requestPath=`/reverse?${params.toString()}`;
  }
  const data=await jsonRequest({hostname:'nominatim.openstreetmap.org',requestPath,headers:{'User-Agent':`JustFun-OrdersLogistics/${VERSION} (${SUPPORT_EMAIL.replace(/^mailto:/,'')})`},maxBytes:2*1024*1024,timeoutMs:15000});
  if(input.mode==='search'&&!Array.isArray(data))throw Object.assign(new Error('OpenStreetMap вернул неверный список адресов.'),{code:'MAP_PUBLIC_INVALID'});
  if(input.mode==='reverse'&&(!data||typeof data!=='object'||Array.isArray(data)))throw Object.assign(new Error('OpenStreetMap вернул неверный адрес точки.'),{code:'MAP_PUBLIC_INVALID'});
  return data;
}
async function directOpenStreetMapRoute(payload){
  const input=validateDesktopRoutePayload(payload),coordinates=input.points.map(point=>`${point.lon},${point.lat}`).join(';'),requestPath=input.operation==='table'?`/table/v1/driving/${coordinates}?annotations=duration,distance`:`/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=false`;
  const data=await jsonRequest({hostname:'router.project-osrm.org',requestPath,headers:{'User-Agent':`JustFun-OrdersLogistics/${VERSION}`},maxBytes:12*1024*1024,timeoutMs:20000});
  if(!data||data.code!=='Ok'||(input.operation==='route'&&!Array.isArray(data.routes)))throw Object.assign(new Error(String(data?.message||'OSRM не построил маршрут.')),{code:'MAP_PUBLIC_INVALID'});
  return data;
}
async function resolveDesktopAddressSearch(payload,{state=regState(),server=async(input,currentState)=>regApiRequest('POST',regAddressSearchPath(currentState,input.warehouseId,input.environment),input.requestBody),direct=directOpenStreetMapGeocode,publicFallbackAllowed=ADDRESS_PUBLIC_FALLBACK_ALLOWED}={}){
  const input=validateDesktopAddressSearchPayload(payload),configured=!!state;
  let serverError=null;
  if(configured){
    try{
      const response=await server(input,state),data=validateAddressSearchResponse(response,input,state);
      appendRecurringLog('Address provider search completed',{requestId:input.requestId,warehouseId:input.warehouseId,environment:input.environment,interaction:input.interaction,results:data.length,provider:String(response?.provider?.name||'')});
      return{ok:true,configured:true,requestId:input.requestId,source:'company-address-provider',data};
    }catch(error){
      serverError=error;
      appendRecurringLog('Company address provider failed',{requestId:input.requestId,warehouseId:input.warehouseId,interaction:input.interaction,code:String(error?.code||''),error:safeIntegrationError(error)});
      if(input.interaction==='autocomplete'||!publicFallbackAllowed)return{ok:false,configured:true,requestId:input.requestId,code:String(error?.code||'ADDRESS_PROVIDER_FAILED'),error:safeIntegrationError(error)};
    }
  }
  if(input.interaction==='autocomplete')return{ok:false,configured,requestId:input.requestId,code:'ADDRESS_AUTOCOMPLETE_REQUIRES_PROVIDER',error:'Автоподсказки появятся после подключения адресного сервиса. Используйте кнопку поиска.'};
  if(!publicFallbackAllowed)return{ok:false,configured:false,requestId:input.requestId,code:'ADDRESS_VPS_REQUIRED',error:'Для релизной версии требуется подключённый адресный сервис компании.'};
  try{
    const normalizedQuery=addressIntelligence.normalizeQuery(input.query)||input.query,data=await direct({mode:'search',query:normalizedQuery,limit:10,addressOnly:true});
    appendRecurringLog('Development address search used public fallback',{requestId:input.requestId,configured,serverCode:String(serverError?.code||''),queryCorrected:normalizedQuery!==input.query.toLowerCase()});
    return{ok:true,configured,requestId:input.requestId,source:'development-public-nominatim',degraded:true,warning:'Использован временный публичный поиск: результат необходимо проверить.',data};
  }catch(error){
    return{ok:false,configured,requestId:input.requestId,code:String(error?.code||serverError?.code||'ADDRESS_SEARCH_FAILED'),error:configured?`Адресный сервис: ${safeIntegrationError(serverError)}; временный поиск: ${safeIntegrationError(error)}`:safeIntegrationError(error)};
  }
}
async function resolveDesktopMapGeocode(payload,{configured=!!regState(),direct=directOpenStreetMapGeocode,fallback=async value=>(await regApiRequest('POST','/v1/maps/geocode',value)).data}={}){
  const requestId=String(payload?.requestId||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
  let publicError=null;
  try{
    const data=await direct(payload);
    appendRecurringLog('Map geocode completed',{requestId,mode:String(payload?.mode||''),source:'direct-openstreetmap'});
    return{ok:true,configured,requestId,source:'direct-openstreetmap',data};
  }catch(error){
    publicError=error;
    appendRecurringLog('Public geocode failed',{requestId,code:String(error?.code||''),error:safeIntegrationError(error)});
  }
  if(configured){
    try{
      const data=await fallback(validateDesktopGeocodePayload(payload));
      appendRecurringLog('Map geocode switched to company VPS',{requestId,mode:String(payload?.mode||''),publicCode:String(publicError?.code||'')});
      return{ok:true,configured:true,requestId,source:'company-vps',degraded:true,warning:'Прямой канал OpenStreetMap недоступен; адрес найден через VPS компании.',data};
    }catch(error){
      appendRecurringLog('VPS geocode failed',{requestId,code:String(error?.code||''),error:safeIntegrationError(error)});
      return{ok:false,configured:true,requestId,code:String(error?.code||publicError?.code||'MAP_REQUEST_FAILED'),error:`OpenStreetMap: ${safeIntegrationError(publicError)}; VPS: ${safeIntegrationError(error)}`};
    }
  }
  return{ok:false,configured:false,requestId,code:String(publicError?.code||'MAP_REQUEST_FAILED'),error:safeIntegrationError(publicError)};
}
function regDiagnosticStage(error,fallback='api'){
  const code=String(error?.code||'').toUpperCase();
  if(['ENOTFOUND','EAI_AGAIN'].includes(code))return'dns';
  if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ESOCKETTIMEDOUT','ENETDOWN','ENETUNREACH','EHOSTUNREACH','NETWORK_TIMEOUT'].includes(code))return'connection';
  if(code.startsWith('TLS_')||['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code))return'tls';
  if(['AUTH_REQUIRED','INVALID_SESSION','SESSION_EXPIRED','INVALID_TOKEN','FORBIDDEN','HTTP_401','HTTP_403'].includes(code))return'authorization';
  if(code.includes('DATABASE')||code.includes('POSTGRES'))return'database';
  return fallback;
}
async function getRegStatus() {
  const state = regState();
  if (!state) return {configured:false, status:'not_configured'};
  let phase='health';
  try {
    const health = await jsonRequest({hostname:state.address, port:Number(state.api_port)||443, requestPath:'/health', fingerprint:state.tls_sha256, maxBytes:1024*1024, timeoutMs:15000});
    if(health.database!=='ready')throw Object.assign(new Error('PostgreSQL на VPS не подтвердил готовность.'),{code:'DATABASE_NOT_READY'});
    if(Number(health.api_contract)!==REG_API_CONTRACT)throw Object.assign(new Error(`VPS использует несовместимый договор API (${health.api_contract||'не указан'} вместо ${REG_API_CONTRACT}).`),{code:'API_CONTRACT_MISMATCH'});
    phase='authorization';
    const authenticated = await regApiRequest('GET','/v1/status');
    if (String(authenticated.workspace_id || '') !== String(state.workspace_id || '')) throw Object.assign(new Error('VPS подтвердил другое рабочее пространство.'),{code:'WORKSPACE_MISMATCH'});
    return {configured:true, online:true, status:'ready', diagnosticStage:'complete', diagnostics:{dns:'ok',connection:'ok',tls:'ok',api:'ok',authorization:'ok',database:'ok'}, address:state.address, sshUser:state.ssh_user, sshPort:state.ssh_port, version:health.version, database:health.database, configuredAt:state.configured_at, checkedAt:new Date().toISOString()};
  } catch (error) {
    const diagnosticStage=regDiagnosticStage(error,phase);
    appendRecurringLog('REG.RU status failed',{code:String(error?.code||''),stage:diagnosticStage,error:safeIntegrationError(error)});
    return {configured:true, online:false, status:'unavailable', diagnosticStage, address:state.address, sshUser:state.ssh_user, sshPort:state.ssh_port, error:safeIntegrationError(error), errorCode:String(error?.code||''), configuredAt:state.configured_at, checkedAt:new Date().toISOString()};
  }
}

function openRegVpsPasswordWindow() {
  if(process.platform!=='win32'&&!process.env.JF_ALLOW_REG_WIZARD_TEST)throw new Error('Мастер VPS доступен в установленной Windows-программе.');
  if(regVpsSetupWindow&&!regVpsSetupWindow.isDestroyed()){regVpsSetupWindow.focus();throw new Error('Окно настройки VPS уже открыто.');}
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;resolve(value)};
    const fail=error=>{if(settled)return;settled=true;reject(error)};
    const partition=`reg-vps-setup-${crypto.randomBytes(10).toString('hex')}`;
    const wizardSession=session.fromPartition(partition);
    registerAppProtocol(wizardSession);
    const win=new BrowserWindow({
      width:760,height:590,minWidth:680,minHeight:540,resizable:true,modal:Boolean(mainWindow&&!mainWindow.isDestroyed()),parent:mainWindow&&!mainWindow.isDestroyed()?mainWindow:undefined,
      show:false,backgroundColor:'#edf5f1',title:'JustFun · Защищённое подключение VPS',icon:path.join(__dirname,'assets','JustFun.ico'),autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'reg-vps-setup-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:false,spellcheck:false,session:wizardSession}
    });
    regVpsSetupWindow=win;
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!isTrustedAppUrl(url))event.preventDefault()});
    const submitChannel='reg-vps-setup:submit',cancelChannel='reg-vps-setup:cancel';
    const cleanup=()=>{
      ipcMain.removeHandler(submitChannel);ipcMain.removeListener(cancelChannel,onCancel);
      if(regVpsSetupWindow===win)regVpsSetupWindow=null;
    };
    const onCancel=event=>{if(event.sender.id!==win.webContents.id)return;finish(null);setImmediate(()=>{if(!win.isDestroyed())win.close()})};
    ipcMain.removeHandler(submitChannel);ipcMain.removeAllListeners(cancelChannel);
    ipcMain.handle(submitChannel,(event,payload)=>{
      if(event.sender.id!==win.webContents.id)return{ok:false,error:'Запрос поступил не из защищённого окна.'};
      const password=String(payload?.password||'');
      if(!password||password.length>1024||/[\r\n\0]/.test(password))return{ok:false,error:'Введите корректный SSH-пароль.'};
      finish(password);setImmediate(()=>{if(!win.isDestroyed())win.close()});return{ok:true};
    });
    ipcMain.on(cancelChannel,onCancel);
    win.once('ready-to-show',()=>win.show());
    win.once('closed',()=>{cleanup();finish(null)});
    win.loadURL(appRendererUrl('reg-vps-setup.html')).catch(error=>{cleanup();fail(error);if(!win.isDestroyed())win.destroy()});
  });
}
async function confirmRegVpsFingerprint(fingerprint, previousFingerprint='') {
  const current=String(fingerprint||''),previous=String(previousFingerprint||'');
  if(!/^SHA256:[A-Za-z0-9+/]{32,60}$/.test(current))return false;
  if(previous&&Buffer.byteLength(current)===Buffer.byteLength(previous)&&crypto.timingSafeEqual(Buffer.from(current),Buffer.from(previous)))return true;
  const changed=Boolean(previous);
  const options={
    type:changed?'warning':'info',
    title:changed?'Изменился SSH-ключ VPS':'Подтвердите VPS REG.RU',
    message:changed?'Защитный SSH-ключ сервера не совпадает с сохранённым.':'Подтвердите отпечаток SSH-ключа вашего VPS.',
    detail:changed
      ? `Сохранённый: ${previous}\nНовый: ${current}\n\nПродолжайте только после переустановки VPS и сверки нового отпечатка в личном кабинете REG.RU.`
      : `${current}\n\nСверьте этот отпечаток с данными сервера в личном кабинете REG.RU. Пароль ещё не передан.`,
    buttons:changed?['Отмена','Доверять новому ключу']:['Отмена','Подключиться'],
    defaultId:0,cancelId:0,noLink:true
  };
  const result=mainWindow&&!mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow,options)
    : await dialog.showMessageBox(options);
  return result.response===1;
}
async function configureRegVps(payload) {
  const address=String(payload?.address||'').trim(), sshUser=String(payload?.sshUser||'root').trim().toLowerCase(), sshPort=Number(payload?.sshPort||22);
  if (!nodeNet.isIP(address)) throw new Error('Укажите IP-адрес VPS REG.RU без https://, пути и домена.');
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(sshUser)) throw new Error('Проверьте имя SSH-пользователя.');
  if (!Number.isInteger(sshPort)||sshPort<1||sshPort>65535) throw new Error('Проверьте SSH-порт.');
  requireSecureStorage();
  const authState=await verifyCloudAuthContext();
  if(!canConfigureCompanyServer(authState))throw new Error('Настроить общий сервер может только владелец компании или администратор с правом управления компанией.');
  const workspaceId=companyWorkspaceId(authState);
  const previous=regState();
  const sameServer=Boolean(previous&&String(previous.address)===address&&String(previous.ssh_user)===sshUser&&Number(previous.ssh_port)===sshPort);
  const scopedSecret=regApiSecretName(workspaceId);
  const scopedAttestationSecret=regVpsAttestationSecretName(workspaceId);
  let previousApiKey=readNativeSecret(scopedSecret);
  if(!previousApiKey&&previous&&String(previous.workspace_id||'')===workspaceId){
    const legacyApiKey=readNativeSecret('regApiKey');
    if(legacyApiKey){previousApiKey=legacyApiKey;writeNativeSecret(scopedSecret,legacyApiKey);appendLog('REG.RU legacy API key migrated',{company:workspaceId});}
  }
  let apiKey=String(sameServer&&previousApiKey?previousApiKey:randomIntegrationId()+randomIntegrationId());
  let attestationSecret=String(sameServer?readNativeSecret(scopedAttestationSecret):'');
  if(!/^jfvps_[A-Za-z0-9_-]{43,120}$/.test(attestationSecret))attestationSecret=`jfvps_${crypto.randomBytes(36).toString('base64url')}`;
  if(activeIntegrationWizard)throw new Error(`Уже выполняется мастер «${activeIntegrationWizard.name}». Завершите его перед запуском другого.`);
  activeIntegrationWizard={name:'REG.RU VPS',startedAt:new Date().toISOString()};
  let sshPassword='';
  try {
    sshPassword=await openRegVpsPasswordWindow();
    if(sshPassword===null)return{canceled:true,configured:Boolean(previous)};
    const setupOptions={
      host:address,username:sshUser,port:sshPort,password:sshPassword,installationId:workspaceId,apiKey,attestationSecret,
      packageRoot:bundledIntegrationPath('reg-vps','server'),
      acceptedFingerprint:'',
      confirmFingerprint:async fingerprint=>{
        const accepted=await confirmRegVpsFingerprint(fingerprint,sameServer?previous?.ssh_host_sha256:'');
        if(accepted)setupOptions.acceptedFingerprint=fingerprint;
        return accepted;
      },
      onProgress:chunk=>{
        const tail=String(chunk||'').replace(/[\r\n]+/g,' ').trim().slice(-240);
        if(tail)appendLog('REG.RU native SSH progress',{detail:tail});
      }
    };
    appendLog('REG.RU native SSH setup started',{address,sshUser,sshPort,architecture:'ssh2-host-key-pinned'});
    const result=await regVpsNativeSsh.installRegVps(setupOptions);
    if (!result||String(result.address)!==address||String(result.workspace_id)!==workspaceId||normalizeFingerprint(result.tls_sha256).length!==64) throw new Error('Мастер не вернул подтверждённые настройки VPS.');
    writeNativeSecret(scopedSecret,apiKey);
    writeNativeSecret(scopedAttestationSecret,attestationSecret);
    writeJsonAtomic(regStatePath(workspaceId),result);
    appendLog('REG.RU native SSH setup completed',{address,sshUser,sshPort,version:result.version,sshFingerprint:result.ssh_host_sha256});
    const status=await getRegStatus();
    if (!status.online) throw new Error(`VPS установлен, но контрольное HTTPS-подключение не прошло: ${status.error || 'неизвестная ошибка'}`);
    const published=await cloudAuthenticatedRequest('PUT','/v1/company/data-service',{
      address:result.address,
      api_port:Number(result.api_port)||443,
      tls_sha256:normalizeFingerprint(result.tls_sha256),
      attestation_secret:attestationSecret
    });
    if (!published?.company?.data_service) throw new Error('Сервер учётных записей не сохранил подключение компании.');
    const savedAuth=writeCloudAuthState({
      ...(currentSession?.cloudAuth||readCloudAuthState()||authState),
      company:{...((currentSession?.cloudAuth||authState).company||{}),...published.company},
      company_id:String(published.company?.id||workspaceId),
      last_verified_at:new Date().toISOString(),offline:false
    });
    if (currentSession) currentSession.cloudAuth=savedAuth;
    return status;
  } finally {
    sshPassword='';
    apiKey='';
    attestationSecret='';
    appendLog('REG.RU native SSH wizard released',{name:activeIntegrationWizard?.name||'REG.RU VPS'});
    activeIntegrationWizard=null;
  }
}

function workerOrigin(value, allowTelegramPath=false) {
  const raw=String(value||'').trim();
  if(!raw)return '';
  let url;
  try{url=new URL(raw)}catch{return ''}
  const pathOk=url.pathname==='/'||(allowTelegramPath&&url.pathname==='/telegram');
  if(url.protocol!=='https:'||url.username||url.password||url.port||!pathOk||url.search||url.hash||!url.hostname.endsWith('.workers.dev'))return '';
  return url.origin;
}
function validateWorkerState(state) {
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Настройки Cloudflare Worker отсутствуют или повреждены.');
  const direct=workerOrigin(state.base_url)||workerOrigin(state.baseUrl)||workerOrigin(state.worker_url);
  const webhook=workerOrigin(state.webhook_url,true);
  const workerName=String(state.worker_name||'').trim().toLowerCase();
  const subdomain=String(state.workers_subdomain||'').trim().toLowerCase();
  const reconstructed=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workerName)&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
    ? `https://${workerName}.${subdomain}.workers.dev` : '';
  const origin=direct||webhook||reconstructed;
  if(!origin)throw new Error('Сохранённый адрес Cloudflare Worker повреждён и не может быть безопасно восстановлен. Нажмите «Проверить и восстановить».');
  const normalized={...state,base_url:origin};
  if(!workerOrigin(normalized.webhook_url,true))normalized.webhook_url=`${origin}/telegram`;
  return {state:normalized,url:new URL(origin),repaired:String(state.base_url||'')!==origin||String(state.webhook_url||'')!==String(normalized.webhook_url||'')};
}
function loadWorkerState(warehouseId=activeRendererWarehouseId,companyId='') {
  migrateExplicitLegacyTelegramScope(companyId,warehouseId);
  const statePath=telegramStatePath(companyId,warehouseId);
  const original=readJson(statePath,null);
  const validated=validateWorkerState(original);
  if(validated.repaired){
    writeJsonAtomic(statePath,validated.state);
    appendLog('Telegram Worker state repaired',{workerHost:validated.url.hostname,source:'local-safe-migration'});
  }
  return validated;
}
function telegramProvisioningError(error) {
  const stageNames={
    token_input:'Ввод токенов',token_verification:'Проверка Cloudflare API-токена',account_selection:'Выбор Cloudflare-аккаунта',telegram_verification:'Проверка Telegram-бота',
    subdomain:'Создание workers.dev',database:'Создание D1',migration:'Миграция D1',worker_upload:'Публикация Worker',secrets:'Передача секретов',worker_check:'Проверка Worker',
    webhook:'Настройка webhook',final_check:'Итоговая диагностика',local_files:'Проверка компонентов',company_auth:'Проверка прав компании',company_publish:'Сохранение профиля компании',unknown:'Неизвестный этап'
  };
  const stage=String(error?.stage||'unknown'),code=String(error?.code||'TG-CF-UNEXPECTED'),message=String(error?.message||error||'Неизвестная ошибка').replace(/[\r\n]+/g,' ').slice(0,900);
  return {stage,code,message,display:`${stageNames[stage]||stage}: ${message} · Код ${code}`};
}
function publishTelegramProgress(progress) {
  const safe={stage:String(progress?.stage||'').slice(0,80),title:String(progress?.title||'').slice(0,160),detail:String(progress?.detail||'').slice(0,500),percent:Math.max(0,Math.min(100,Number(progress?.percent)||0)),at:String(progress?.at||new Date().toISOString())};
  appendLog('Telegram provisioning stage',{stage:safe.stage,percent:safe.percent,title:safe.title});
  sendWindowMessage(mainWindow,'desktop:telegram-progress',safe);
}
function openTelegramSetupWizard(repair=false) {
  if(process.platform!=='win32'&&!process.env.JF_ALLOW_TELEGRAM_WIZARD_TEST)throw new Error('Мастер Telegram доступен в установленной Windows-программе.');
  if(telegramSetupWindow&&!telegramSetupWindow.isDestroyed()){telegramSetupWindow.focus();throw new Error('Окно настройки Telegram уже открыто.');}
  return new Promise((resolve,reject)=>{
    let settled=false,revealTimer=null;
    const finish=value=>{if(settled)return;settled=true;resolve(value)};
    const fail=error=>{if(settled)return;settled=true;reject(error)};
    const partition=`telegram-setup-${crypto.randomBytes(10).toString('hex')}`;
    const wizardSession=session.fromPartition(partition);
    registerAppProtocol(wizardSession);
    const win=new BrowserWindow({
      width:820,height:760,minWidth:720,minHeight:660,resizable:true,modal:Boolean(mainWindow&&!mainWindow.isDestroyed()),parent:mainWindow&&!mainWindow.isDestroyed()?mainWindow:undefined,
      show:false,backgroundColor:'#071b16',title:'JustFun — Telegram + Cloudflare',icon:path.join(__dirname,'assets','JustFun.ico'),autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'telegram-setup-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:false,spellcheck:false,session:wizardSession,
        additionalArguments:[`--jf-telegram-mode=${repair?'repair':'setup'}`]}
    });
    telegramSetupWindow=win;
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!isTrustedAppUrl(url))event.preventDefault()});
    const submitChannel='telegram-setup:submit',openChannel='telegram-setup:open-official',cancelChannel='telegram-setup:cancel';
    const cleanup=()=>{
      if(revealTimer){clearTimeout(revealTimer);revealTimer=null;}
      ipcMain.removeHandler(submitChannel);ipcMain.removeHandler(openChannel);ipcMain.removeListener(cancelChannel,onCancel);
      if(telegramSetupWindow===win)telegramSetupWindow=null;
    };
    const onCancel=event=>{if(event.sender.id!==win.webContents.id)return;finish(null);setImmediate(()=>{if(!win.isDestroyed())win.close()})};
    ipcMain.removeHandler(submitChannel);ipcMain.removeHandler(openChannel);ipcMain.removeAllListeners(cancelChannel);
    ipcMain.handle(submitChannel,(event,payload)=>{
      if(event.sender.id!==win.webContents.id)return{ok:false,error:'Запрос поступил не из защищённого окна.'};
      const cloudflareToken=String(payload?.cloudflareToken||'').trim(),botToken=String(payload?.botToken||'').trim();
      if(!/^[A-Za-z0-9_.-]{20,300}$/.test(cloudflareToken))return{ok:false,error:'Проверьте формат временного Cloudflare API-токена.'};
      if(!/^\d{6,14}:[A-Za-z0-9_-]{25,120}$/.test(botToken))return{ok:false,error:'Проверьте токен Telegram-бота от @BotFather.'};
      finish({cloudflareToken,botToken});setImmediate(()=>{if(!win.isDestroyed())win.close()});return{ok:true};
    });
    ipcMain.handle(openChannel,(event,target)=>{
      if(event.sender.id!==win.webContents.id)return false;
      const url=String(target)==='cloudflare'?CLOUDFLARE_TOKEN_URL:String(target)==='botfather'?BOTFATHER_URL:'';
      return url?shell.openExternal(url).then(()=>true,()=>false):false;
    });
    ipcMain.on(cancelChannel,onCancel);
    const reveal=()=>{
      if(win.isDestroyed()||win.isVisible()||revealTimer)return;
      revealTimer=setTimeout(()=>{
        revealTimer=null;
        if(win.isDestroyed())return;
        win.show();win.focus();
        appendLog('Telegram setup wizard shown',{repair,title:win.getTitle()});
      },350);
    };
    win.once('ready-to-show',reveal);
    win.webContents.once('did-finish-load',()=>{if(!win.isVisible())reveal()});
    win.webContents.once('did-fail-load',(_event,errorCode,errorDescription)=>{
      const error=Object.assign(new Error(`Защищённое окно Telegram не загрузилось: ${errorDescription||errorCode}`),{stage:'token_input',code:'TELEGRAM_WIZARD_LOAD_FAILED'});
      cleanup();fail(error);if(!win.isDestroyed())win.destroy();
    });
    win.once('closed',()=>{cleanup();finish(null)});
    win.loadURL(appRendererUrl('telegram-setup.html')).catch(error=>{cleanup();fail(error);if(!win.isDestroyed())win.destroy()});
  });
}
async function telegramApiRequest(method, requestPath, body=null,warehouseId=activeRendererWarehouseId,companyId='') {
  const {url}=loadWorkerState(warehouseId,companyId);
  const key=readNativeSecret(telegramSecretName(companyId,warehouseId));
  if (!key) throw new Error('Защищённый ключ Telegram/Cloudflare не найден. Нажмите «Проверить и восстановить».');
  try {
    return await jsonRequest({hostname:url.hostname,method,requestPath,headers:{Authorization:`Bearer ${key}`},body,maxBytes:3*1024*1024,timeoutMs:30000});
  } catch(error) {
    if(Number(error?.status)===401)throw Object.assign(new Error('Защищённый ключ Worker устарел или принадлежит другому пользователю Windows. Откройте «Настроить Telegram» и выполните восстановление.'),{code:'TELEGRAM_WORKER_KEY_REJECTED',status:401});
    throw error;
  }
}
function usesCompanyTelegramBroker(){return currentSession?.edition!=='demo'}
function currentTelegramService(warehouseId=activeRendererWarehouseId){
  try{
    const company=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState())?.company||{},requested=String(warehouseId||'');
    if(!requested)return null;
    const mapped=company.telegram_services&&typeof company.telegram_services==='object'&&!Array.isArray(company.telegram_services)?company.telegram_services[requested]:null;
    if(mapped&&String(mapped.warehouse_id||'')===requested)return mapped;
    const legacy=company.telegram_service||null;
    return legacy&&String(legacy.warehouse_id||'')===requested?legacy:null;
  }catch{return null}
}
function savePublishedCompany(company,authFallback=null){
  const current=currentSession?.cloudAuth||readCloudAuthState()||authFallback;
  if(!current||!company)return current;
  const saved=writeCloudAuthState({
    ...current,
    company:{...(current.company||{}),...company},
    company_id:String(company.id||current.company?.id||current.company_id||''),
    last_verified_at:new Date().toISOString(),offline:false
  });
  if(currentSession)currentSession.cloudAuth=saved;
  return saved;
}
async function publishTelegramCompanyService(state,clientApiKey,authState=null,warehouseId=activeRendererWarehouseId){
  const validated=validateWorkerState(state).state;
  const scopedWarehouseId=validateWarehouseId(warehouseId);
  const published=await companyTelegramBrokerRequest('PUT','/v1/company/telegram-service',{
    warehouse_id:scopedWarehouseId,
    base_url:validated.base_url,
    client_api_key:clientApiKey,
    bot_username:String(validated.bot_username||''),
    installation_id:String(validated.installation_id||''),
    deployment_version:String(validated.deployment_version||'')
  });
  if(!published?.service?.base_url)throw new Error('Корпоративный Telegram-сервис не сохранил подключение компании.');
  const current=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState()||authState);
  const services=current.company?.telegram_services&&typeof current.company.telegram_services==='object'&&!Array.isArray(current.company.telegram_services)?{...current.company.telegram_services}:{};
  services[scopedWarehouseId]=published.service;
  savePublishedCompany({...current.company,telegram_services:services,telegram_service:published.service},authState);
  const localPath=telegramStatePath('',scopedWarehouseId),local=readJson(localPath,null);
  if(local&&typeof local==='object'){
    delete local.company_publish_pending;
    delete local.company_publish_error;
    delete local.company_publish_pending_at;
    delete local.company_publish_last_attempt_at;
    delete local.company_publish_retry_count;
    writeJsonAtomic(localPath,local);
  }
  stopTelegramCompanyPublishRetry();
  appendLog('Telegram company service published',{company:current.company.id,warehouse:scopedWarehouseId,broker:COMPANY_TELEGRAM_BROKER_ORIGIN,workerHost:new URL(published.service.base_url).hostname,botUsername:published.service.bot_username});
  return published.service;
}
async function migrateLegacyTelegramCompanyService(warehouseId=activeRendererWarehouseId){
  if(!usesCompanyTelegramBroker())return false;
  let authState;
  try{authState=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState())}catch{return false}
  if(!canConfigureCompanyServer(authState))return false;
  let validated,key;
  try{
    validated=loadWorkerState(warehouseId);
    key=readNativeSecret(telegramSecretName('',warehouseId));
  }catch(error){
    appendLog('Telegram company migration requires owner repair',{error:safeIntegrationError(error)});
    return false;
  }
  if(!key)return false;
  try{
    await publishTelegramCompanyService(validated.state,key,authState,warehouseId);
    return true;
  }finally{key=''}
}
function markTelegramCompanyPublishPending(state,error,warehouseId=activeRendererWarehouseId){
  const statePath=telegramStatePath('',warehouseId),previous=readJson(statePath,{})||{};
  const now=new Date().toISOString();
  const pendingState={
    ...previous,
    ...state,
    company_publish_pending:true,
    company_publish_error:String(error?.code||'NETWORK_ERROR'),
    company_publish_pending_at:String(previous.company_publish_pending_at||now),
    company_publish_last_attempt_at:now,
    company_publish_retry_count:Math.max(1,Number(previous.company_publish_retry_count||0)+1)
  };
  writeJsonAtomic(statePath,pendingState);
  return pendingState;
}
function stopTelegramCompanyPublishRetry(){
  if(telegramCompanyPublishRetryTimer)clearTimeout(telegramCompanyPublishRetryTimer);
  telegramCompanyPublishRetryTimer=null;
  telegramCompanyPublishRetryAt=0;
}
function canRetryTelegramCompanyPublish(){
  if(!usesCompanyTelegramBroker()||!currentSession?.authorized)return false;
  let authState;
  try{authState=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState())}catch{return false}
  if(!canConfigureCompanyServer(authState))return false;
  const state=readJson(telegramStatePath('',activeRendererWarehouseId),null);
  return Boolean(state&&state.company_publish_pending);
}
function scheduleTelegramCompanyPublishRetry(reason='pending',delayMs=null){
  stopTelegramCompanyPublishRetry();
  if(!canRetryTelegramCompanyPublish())return false;
  const hasExplicitDelay=delayMs!==null&&delayMs!==undefined&&Number.isFinite(Number(delayMs));
  const delay=Math.max(1000,hasExplicitDelay?Number(delayMs):telegramCompanyPublishRetryDelay(telegramCompanyPublishRetryFailures));
  telegramCompanyPublishRetryAt=Date.now()+delay;
  telegramCompanyPublishRetryTimer=setTimeout(()=>{
    telegramCompanyPublishRetryTimer=null;
    telegramCompanyPublishRetryAt=0;
    retryPendingTelegramCompanyService('scheduled').catch(error=>appendLog('Telegram company publication retry crashed',{code:String(error?.code||''),error:safeIntegrationError(error)}));
  },delay);
  telegramCompanyPublishRetryTimer.unref?.();
  appendLog('Telegram company publication retry scheduled',{reason,delayMs:delay,failures:telegramCompanyPublishRetryFailures});
  return true;
}
async function retryPendingTelegramCompanyService(trigger='manual-status'){
  if(telegramCompanyPublishRetryInFlight)return false;
  if(activeIntegrationWizard){scheduleTelegramCompanyPublishRetry('wizard-active',TELEGRAM_COMPANY_PUBLISH_RETRY_BASE_MS);return false}
  if(!canRetryTelegramCompanyPublish())return false;
  telegramCompanyPublishRetryInFlight=true;
  try{
    const published=await migrateLegacyTelegramCompanyService();
    if(!published)return false;
    telegramCompanyPublishRetryFailures=0;
    stopTelegramCompanyPublishRetry();
    appendLog('Telegram company publication retry completed',{trigger});
    sendWindowMessage(mainWindow,'desktop:telegram-company-published',{ok:true,at:new Date().toISOString()});
    return true;
  }catch(error){
    telegramCompanyPublishRetryFailures=Math.min(10,telegramCompanyPublishRetryFailures+1);
    let localState=null;
    try{localState=loadWorkerState(activeRendererWarehouseId).state}
    catch(stateError){appendLog('Telegram company retry state load failed',{warehouseId:activeRendererWarehouseId,error:safeIntegrationError(stateError)})}
    if(localState)markTelegramCompanyPublishPending(localState,error,activeRendererWarehouseId);
    appendLog('Telegram company publication retry failed',{trigger,failures:telegramCompanyPublishRetryFailures,code:String(error?.code||'NETWORK_ERROR'),error:safeIntegrationError(error)});
    return false;
  }finally{
    telegramCompanyPublishRetryInFlight=false;
    if(activeRendererWarehouseId&&readJson(telegramStatePath('',activeRendererWarehouseId),null)?.company_publish_pending)scheduleTelegramCompanyPublishRetry('retry-backoff');
  }
}
function telegramCompanyPublishPendingMessage(errorCode='',retryScheduled=false){
  const code=String(errorCode||'');
  const reason=code==='TELEGRAM_WORKER_ROUTING_BLOCKED'
    ? 'Worker и webhook работают, но Cloudflare блокирует серверную проверку Telegram Worker (код 1042). Серверу профиля нужен режим global_fetch_strictly_public.'
    : code==='TELEGRAM_UPSTREAM_INVALID'
      ? 'Worker и webhook работают, но сервер профиля не получил допустимый JSON-ответ от Telegram Worker.'
      : ['unauthorized','TELEGRAM_CONFIGURATION_REQUIRED'].includes(code)
        ? 'Worker создан, но корпоративный broker пока не подтвердил его клиентский ключ. Проверка повторится после распространения секрета.'
        : code==='TOO_MANY_ATTEMPTS'
          ? 'Корпоративный broker временно ограничил повторные попытки. Новая проверка будет выполнена с увеличенной задержкой.'
          : 'Worker и webhook работают, но серверный профиль компании пока не сохранён.';
  return `${reason} ${retryScheduled?'Автоматический повтор запланирован.':'Автоматический повтор сейчас не запланирован; владельцу нужно нажать «Проверить и восстановить».'}`;
}
async function configureTelegram(repair=false,warehouseId=activeRendererWarehouseId) {
  requireSecureStorage();
  if(usesCompanyTelegramBroker())warehouseId=requireActiveRendererWarehouse(warehouseId);
  let authState=null,cachedAuthState=null,companyAuthDeferred=false;
  if(usesCompanyTelegramBroker()){
    cachedAuthState=normalizeCloudAuthState(currentSession?.cloudAuth||readCloudAuthState());
    if(!canConfigureCompanyServer(cachedAuthState))throw new Error('Настроить общий Telegram-бот может только владелец компании или администратор с правом управления компанией.');
    authState=cachedAuthState;
  }
  if(activeIntegrationWizard)throw new Error(`Уже выполняется мастер «${activeIntegrationWizard.name}». Завершите его перед запуском другого.`);
  activeIntegrationWizard={name:'Telegram + Cloudflare',startedAt:new Date().toISOString()};
  let credentials=null,cloudflareToken='',botToken='';
  try {
    credentials=await openTelegramSetupWizard(repair);
    if(!credentials)return{canceled:true,configured:Boolean(currentTelegramService(warehouseId)||readJson(telegramStatePath('',warehouseId),null))};
    cloudflareToken=credentials.cloudflareToken;botToken=credentials.botToken;
    credentials.cloudflareToken='';credentials.botToken='';
    if(usesCompanyTelegramBroker()){
      publishTelegramProgress({stage:'company_auth',title:'Проверяем права компании',detail:'Подтверждаем владельца или администратора. При кратком сбое сети мастер продолжит настройку по защищённой локальной сессии.',percent:4});
      try{authState=await verifyCloudAuthContext()}
      catch(error){
        if(!isTemporaryCompanyServiceError(error))throw Object.assign(error,{stage:error?.stage||'company_auth'});
        companyAuthDeferred=true;authState=cachedAuthState;
        appendLog('Telegram company verification deferred',{code:String(error?.code||'NETWORK_ERROR'),error:safeIntegrationError(error),company:String(authState?.company?.id||'')});
      }
    }
    migrateExplicitLegacyTelegramScope('',warehouseId);
    const scope=currentTelegramScope(warehouseId),statePath=telegramStatePath('',warehouseId),secretName=telegramSecretName('',warehouseId);
    const existingState=readJson(statePath,{})||{};
    let existingClientApiKey='';
    try{existingClientApiKey=readNativeSecret(secretName)}catch(error){appendLog('Telegram scoped local key unavailable',{scope:scope.key,error:safeIntegrationError(error)})}
    appendLog('Telegram native Cloudflare setup started',{repair,architecture:'native-cloudflare-api-v3-shared-d1',existingWorker:String(existingState.worker_name||'')});
    const result=await telegramProvisioner.provision({
      cloudflareToken,botToken,existingState,existingClientApiKey,resourceScope:scope.key,
      companyId:scope.companyId,
      warehouseId:telegramWarehouseScope(scope.warehouseId,scope.environment),
      environment:scope.environment,
      workerDir:bundledIntegrationPath('telegram-cloudflare-native','worker'),
      migrationFile:bundledIntegrationPath('telegram-cloudflare-native','migrations','0001_init.sql'),
      migrationFiles:[
        bundledIntegrationPath('telegram-cloudflare-native','migrations','0001_init.sql'),
        bundledIntegrationPath('telegram-cloudflare-native','migrations','0002_shared_installations.sql'),
        bundledIntegrationPath('telegram-cloudflare-native','migrations','0003_deprovision.sql')
      ],
      onProgress:publishTelegramProgress
    });
    const scopedState={...result.state,company_id:scope.companyId,warehouse_id:scope.warehouseId,environment:scope.environment};
    writeNativeSecret(secretName,result.clientApiKey);
    writeJsonAtomic(statePath,scopedState);
    let companyPublishPending=false,companyPublishErrorCode='',companyPublishRetryScheduled=false;
    if(usesCompanyTelegramBroker()){
      try{await publishTelegramCompanyService(scopedState,result.clientApiKey,authState,warehouseId)}
      catch(error){
        if(!isTemporaryCompanyServiceError(error))throw Object.assign(error,{stage:error?.stage||'company_publish'});
        companyPublishPending=true;
        companyPublishErrorCode=String(error?.code||'NETWORK_ERROR');
        markTelegramCompanyPublishPending(scopedState,error,warehouseId);
        companyPublishRetryScheduled=scheduleTelegramCompanyPublishRetry('configure-deferred');
        appendLog('Telegram company publication deferred',{code:String(error?.code||'NETWORK_ERROR'),error:safeIntegrationError(error),workerHost:new URL(result.state.base_url).hostname});
      }
    }
    const status=companyPublishPending?await getLocalTelegramStatus(warehouseId):await getTelegramStatus(warehouseId);
    if(!status.online)throw Object.assign(new Error(status.error||'Итоговая проверка webhook не пройдена.'),{stage:'final_check',code:'TG-CF-FINAL-STATUS'});
    appendLog(companyPublishPending?'Telegram native Cloudflare infrastructure completed; company publication pending':'Telegram native Cloudflare setup completed',{botUsername:status.botUsername,workerHost:new URL(result.state.base_url).hostname,architecture:result.state.architecture,companyPublishPending,cloudflareTokenSaved:false});
    return{...status,companyPublishPending,companyPublishErrorCode,companyPublishRetryScheduled,error:companyPublishPending?telegramCompanyPublishPendingMessage(companyPublishErrorCode,companyPublishRetryScheduled):status.error,companyAuthDeferred,deleteCloudflareTokenRecommended:true,cloudflareTokenSaved:false};
  } catch(error) {
    const safe=telegramProvisioningError(error);appendLog('Telegram native Cloudflare setup failed',safe);throw Object.assign(new Error(safe.display),safe);
  } finally {
    cloudflareToken='';botToken='';credentials=null;
    appendLog('Telegram native Cloudflare setup released',{name:activeIntegrationWizard?.name||'Telegram + Cloudflare'});
    activeIntegrationWizard=null;
  }
}
async function getLocalTelegramStatus(warehouseId=activeRendererWarehouseId) {
  migrateExplicitLegacyTelegramScope('',warehouseId);
  const originalState=readJson(telegramStatePath('',warehouseId),null);
  if(!originalState)return{configured:false,online:false,status:'not_configured'};
  let state=originalState;
  try{
    const validated=loadWorkerState(warehouseId);state=validated.state;const {url}=validated;
    const health=await jsonRequest({hostname:url.hostname,requestPath:'/health',maxBytes:1024*1024,timeoutMs:15000});
    const full=await telegramApiRequest('GET','/v1/status',null,warehouseId);
    return{configured:true,online:true,status:'ready',architecture:String(state.architecture||'legacy'),deploymentVersion:String(state.deployment_version||health.version||''),baseUrl:url.origin,botUsername:String(full.bot?.username||state.bot_username||''),webhookUrl:String(full.webhook?.url||''),pendingUpdates:Number(full.webhook?.pending_update_count)||0,lastError:String(full.webhook?.last_error_message||''),version:health.version,companyPublishPending:Boolean(state.company_publish_pending),cloudflareTokenSaved:false,deleteCloudflareTokenRecommended:true,checkedAt:new Date().toISOString()};
  }catch(error){
    appendLog('Telegram/Cloudflare local status failed',safeIntegrationError(error));
    return{configured:true,online:false,status:'degraded',architecture:String(state.architecture||'legacy'),deploymentVersion:String(state.deployment_version||''),baseUrl:String(state.base_url||''),botUsername:String(state.bot_username||''),error:safeIntegrationError(error),errorCode:String(error?.code||''),companyPublishPending:Boolean(state.company_publish_pending),cloudflareTokenSaved:false,checkedAt:new Date().toISOString()};
  }
}
async function getTelegramStatus(warehouseId=activeRendererWarehouseId) {
  if(usesCompanyTelegramBroker()){
    warehouseId=requireActiveRendererWarehouse(warehouseId);
    let profile=currentTelegramService(warehouseId);
    try{
      let full;
      try{full=await companyTelegramBrokerRequest('GET',`/v1/company/telegram/status?warehouse_id=${encodeURIComponent(warehouseId)}`)}
      catch(error){
        if(String(error?.code)!=='TELEGRAM_NOT_CONFIGURED')throw error;
        if(!(await migrateLegacyTelegramCompanyService(warehouseId))){
          const local=await getLocalTelegramStatus(warehouseId);
          if(local.configured)return{...local,architecture:'company-broker-pending-v1',brokerOffline:true,companyPublishPending:true,companyPublishRetryScheduled:false,error:telegramCompanyPublishPendingMessage('TELEGRAM_NOT_CONFIGURED',false)};
          return{configured:false,online:false,status:'not_configured',repairRequired:Boolean(profile===null&&canConfigureCompanyServer(currentSession?.cloudAuth)),error:cloudFriendlyError(error.code),cloudflareTokenSaved:false,checkedAt:new Date().toISOString()};
        }
        profile=currentTelegramService(warehouseId);
        full=await companyTelegramBrokerRequest('GET',`/v1/company/telegram/status?warehouse_id=${encodeURIComponent(warehouseId)}`);
      }
      const service=full?.service||profile||{};
      return{configured:true,online:true,status:'ready',architecture:'company-broker-v1',deploymentVersion:String(service.deployment_version||''),baseUrl:String(service.base_url||''),botUsername:String(full?.bot?.username||service.bot_username||''),webhookUrl:String(full?.webhook?.url||''),pendingUpdates:Number(full?.webhook?.pending_update_count)||0,lastError:String(full?.webhook?.last_error_message||''),version:String(service.deployment_version||VERSION),cloudflareTokenSaved:false,deleteCloudflareTokenRecommended:true,checkedAt:new Date().toISOString()};
    }catch(error){
      appendLog('Telegram company status failed',{code:String(error?.code||''),error:safeIntegrationError(error)});
      if(isTemporaryCompanyServiceError(error)){
        const errorCode=String(error?.code||'NETWORK_ERROR');
        let retryScheduled=Boolean(telegramCompanyPublishRetryTimer);
        if(!profile&&canConfigureCompanyServer(currentSession?.cloudAuth)){
          try{
            const localState=loadWorkerState(warehouseId).state;
            if(readNativeSecret(telegramSecretName('',warehouseId))){
              markTelegramCompanyPublishPending(localState,error,warehouseId);
              retryScheduled=scheduleTelegramCompanyPublishRetry('status-deferred')||retryScheduled;
            }
          }catch(localError){appendLog('Telegram company publication could not be queued',{error:safeIntegrationError(localError)})}
        }
        const local=await getLocalTelegramStatus(warehouseId);
        if(local.configured){
          const publicationPending=Boolean(local.companyPublishPending||!profile);
          return{...local,architecture:'company-broker-pending-v1',brokerOffline:true,companyPublishPending:publicationPending,companyPublishErrorCode:errorCode,companyPublishRetryScheduled:publicationPending&&retryScheduled,companyPublishRetryAt:publicationPending&&retryScheduled?new Date(telegramCompanyPublishRetryAt).toISOString():'',error:local.online?(publicationPending?telegramCompanyPublishPendingMessage(errorCode,retryScheduled):'Профиль компании сохранён, но серверная проверка Telegram временно недоступна.'):String(local.error||safeIntegrationError(error))};
        }
      }
      return{configured:Boolean(profile),online:false,status:'degraded',architecture:'company-broker-v1',deploymentVersion:String(profile?.deployment_version||''),baseUrl:String(profile?.base_url||''),botUsername:String(profile?.bot_username||''),error:safeIntegrationError(error),errorCode:String(error?.code||''),cloudflareTokenSaved:false,checkedAt:new Date().toISOString()};
    }
  }
  return getLocalTelegramStatus(warehouseId);
}
async function createTelegramLink(payload) {
  const warehouseId=validateWarehouseId(payload?.warehouseId), environment=currentEnvironment(), scopedWarehouseId=telegramWarehouseScope(warehouseId,environment), entityType=String(payload?.entityType||'');
  const entityId=String(payload?.entityId||''), label=String(payload?.label||'').trim().slice(0,120);
  if (!['driver','warehouse'].includes(entityType)) throw new Error('Привязывать можно только водителя или активный склад.');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(entityId)) throw new Error('Идентификатор объекта имеет неверный формат.');
  const result=usesCompanyTelegramBroker()
    ? await companyTelegramBrokerRequest('POST','/v1/company/telegram/link-code',{warehouse_id:warehouseId,environment,entity_type:entityType,entity_id:entityId,label})
    : await telegramApiRequest('POST','/v1/link-code',{warehouse_id:scopedWarehouseId,entity_type:entityType,entity_id:entityId,label,ttl_minutes:20},warehouseId);
  if (String(result.warehouse_id||'')!==scopedWarehouseId) throw new Error('Cloudflare вернул привязку другого склада или среды.');
  const command=entityType==='warehouse'&&result.code?`/подключить_склад ${String(result.code)}`:'';
  return {ok:true,warehouseId,environment,entityType,entityId,deepLink:String(result.deep_link||''),command,instructions:String(result.instructions||''),expiresAt:String(result.expires_at||'')};
}
function validateDeliveredTelegramNotification(result){
  const notification=result?.notification||{};
  const deliveredStatuses=new Set(['sent','accepted','departed','completed','collecting','ready','loaded','problem']);
  if(!/^nt_[A-Za-z0-9_-]{6,160}$/.test(String(notification.id||''))||!Number.isInteger(Number(notification.message_id))||Number(notification.message_id)<=0||!deliveredStatuses.has(String(notification.status||''))){
    throw Object.assign(new Error('Telegram не подтвердил доставку сообщения. Статус «отправлено» не установлен.'),{code:'TELEGRAM_DELIVERY_NOT_CONFIRMED'});
  }
  return notification;
}
async function sendTelegramNotification(payload) {
  const warehouseId=validateWarehouseId(payload?.warehouseId), environment=currentEnvironment(), scopedWarehouseId=telegramWarehouseScope(warehouseId,environment), entityType=String(payload?.entityType||''), entityId=String(payload?.entityId||'');
  if (!['driver','warehouse'].includes(entityType)||!/^[A-Za-z0-9_-]{1,120}$/.test(entityId)) throw new Error('Получатель Telegram имеет неверный формат.');
  const idempotencyKey=String(payload?.idempotencyKey||'');
  if (!/^[A-Za-z0-9:._-]{10,160}$/.test(idempotencyKey)) throw new Error('Ключ повторной отправки имеет неверный формат.');
  const text=String(payload?.text||'').trim(); if(!text||text.length>3500)throw new Error('Текст уведомления пуст или слишком длинный.');
  const routeId=String(payload?.routeId||'').trim().slice(0,160);
  if (/[\u0000-\u001f]/.test(routeId)) throw new Error('Идентификатор рейса повреждён.');
  const title=String(payload?.title||'').trim().slice(0,300);
  const metadata=payload?.metadata&&typeof payload.metadata==='object'&&!Array.isArray(payload.metadata)?payload.metadata:{};
  const requestBody={
    warehouse_id:usesCompanyTelegramBroker()?warehouseId:scopedWarehouseId,
    environment,
    entity_type:entityType,
    entity_id:entityId,
    actor:entityType,
    route_id:routeId,
    idempotency_key:usesCompanyTelegramBroker()?idempotencyKey:`${environment}:${idempotencyKey}`,
    title,
    metadata,
    text,
    status_buttons:payload?.statusButtons!==false
  };
  const result=usesCompanyTelegramBroker()
    ? await companyTelegramBrokerRequest('POST','/v1/company/telegram/send',requestBody)
    : await telegramApiRequest('POST','/v1/send',requestBody,warehouseId);
  const notification=validateDeliveredTelegramNotification(result);
  return {
    ok:true,
    deliveryConfirmed:true,
    duplicate:!!result.duplicate,
    notificationId:String(notification.id||''),
    routeId:String(notification.route_id||routeId),
    entityType,
    entityId,
    status:String(notification.status||''),
    statusAt:String(notification.status_at||'')
  };
}
async function getTelegramBindings(payload) {
  const warehouseId=validateWarehouseId(payload?.warehouseId), environment=requireCurrentEnvironment(payload?.environment), scopedWarehouseId=telegramWarehouseScope(warehouseId,environment);
  const result=usesCompanyTelegramBroker()
    ? await companyTelegramBrokerRequest('GET',`/v1/company/telegram/bindings?warehouse_id=${encodeURIComponent(warehouseId)}&environment=${encodeURIComponent(environment)}`)
    : await telegramApiRequest('GET',`/v1/bindings?warehouse_id=${encodeURIComponent(scopedWarehouseId)}`,null,warehouseId);
  const bindings=Array.isArray(result.bindings)?result.bindings:[];
  if(bindings.some(binding=>String(binding?.warehouse_id||'')!==scopedWarehouseId))throw new Error('Cloudflare вернул привязку другого склада или среды.');
  return {
    ok:true,
    warehouseId,
    environment,
    bindings:bindings.map(binding=>({
      warehouseId,
      environment,
      entityType:String(binding.entity_type||''),
      entityId:String(binding.entity_id||''),
      chatType:String(binding.chat_type||''),
      title:String(binding.title||''),
      username:String(binding.username||''),
      userId:String(binding.user_id||''),
      updatedAt:String(binding.updated_at||'')
    }))
  };
}
async function pollTelegramEvents(payload) {
  const warehouseId=validateWarehouseId(payload?.warehouseId), environment=requireCurrentEnvironment(payload?.environment), scopedWarehouseId=telegramWarehouseScope(warehouseId,environment);
  const cursorPath=telegramCursorPath('',warehouseId),cursors=readJson(cursorPath,{})||{}, cursorKey=`${environment}:${warehouseId}`, afterId=Math.max(0,Number(cursors[cursorKey])||0);
  const result=usesCompanyTelegramBroker()
    ? await companyTelegramBrokerRequest('GET',`/v1/company/telegram/events?warehouse_id=${encodeURIComponent(warehouseId)}&environment=${encodeURIComponent(environment)}&after_id=${afterId}&limit=100`)
    : await telegramApiRequest('GET',`/v1/events?warehouse_id=${encodeURIComponent(scopedWarehouseId)}&after_id=${afterId}&limit=100`,null,warehouseId);
  const events=Array.isArray(result.events)?result.events:[];
  if(events.some(event=>String(event?.warehouse_id||'')!==scopedWarehouseId))throw new Error('Получено событие другого склада или среды. Пакет заблокирован.');
  const next=Math.max(afterId,Number(result.next_after_id)||afterId); cursors[cursorKey]=next; writeJsonAtomic(cursorPath,cursors);
  return {ok:true,warehouseId,environment,events:events.map(event=>({...event,warehouse_id:warehouseId,environment})),nextAfterId:next};
}
function trustedMainRendererEvent(event) {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || event?.sender?.id !== mainWindow.webContents.id) return false;
    const sourceUrl=String(event?.senderFrame?.url || event.sender.getURL() || '');
    if (!isTrustedAppUrl(sourceUrl)) return false;
    const parsed=new URL(sourceUrl);
    return decodeURIComponent(parsed.pathname)==='/web/index.html' && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}
function trustedMainIPCHandler(channel, listener) {
  return async (event, ...args) => {
    if (!trustedMainRendererEvent(event)) {
      appendLog('blocked untrusted IPC sender',{channel,senderId:event?.sender?.id||null,url:String(event?.senderFrame?.url||'').slice(0,500)});
      throw new Error('Запрос заблокирован: источник рабочего окна не подтверждён.');
    }
    return listener(event,...args);
  };
}
function registerIPC(config) {
  if (ipcRegistered) return;
  ipcRegistered = true;
  const handleMainIPC=(channel,listener)=>ipcMain.handle(channel,trustedMainIPCHandler(channel,listener));
  ipcMain.on('desktop:startup-stage', (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender.id !== mainWindow.webContents.id) return;
    appendLog('renderer startup stage', {
      stage:String(payload?.stage || '').slice(0,120),
      detail:String(payload?.detail || '').slice(0,500)
    });
  });
  handleMainIPC('desktop:renderer-ready', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return false;
    const safePayload = {
      surface:String(payload?.surface || '').slice(0,80),
      readyState:String(payload?.readyState || '').slice(0,40),
      warehouseId:String(payload?.warehouseId || '').slice(0,120)
    };
    if (/^[A-Za-z0-9_-]{1,120}$/.test(safePayload.warehouseId)) activateRendererWarehouse(safePayload.warehouseId);
    appendLog('renderer ready confirmed', safePayload);
    if (rendererReadyResolve) rendererReadyResolve(safePayload);
    confirmUpdateHealthIfRequested();
    return true;
  });
  handleMainIPC('desktop:set-active-warehouse', (_event, payload) => {
    try {
      const environment=requireCurrentEnvironment(payload?.environment);
      const warehouseId=activateRendererWarehouse(payload?.warehouseId);
      appendLog('renderer warehouse context confirmed',{warehouseId,environment});
      return {ok:true,warehouseId,environment};
    } catch(error) {
      appendLog('renderer warehouse context rejected',{code:String(error?.code||''),error:safeIntegrationError(error)});
      return {ok:false,error:safeIntegrationError(error),code:String(error?.code||'WAREHOUSE_CONTEXT_REJECTED')};
    }
  });
  handleMainIPC('desktop:get-session', () => ({
    edition:currentSession?.edition, authorized:currentSession?.authorized,
    demoRemainingMs:currentSession?.edition === 'demo' ? remainingDemoMs(currentSession.demoState) : null,
    machineCode:currentSession?.machineCode, recovery:currentSession?.recovery,
    version:VERSION, dataDir:config.data_dir, licenseApi:LICENSE_API_ORIGIN,
    auth:publicCloudAuth(currentSession?.cloudAuth)
  }));
  handleMainIPC('desktop:get-app-info', () => ({name:APP_NAME, version:VERSION, company:COMPANY, dataDir:config.data_dir, logDir:logDir(), machineCode:getMachineCode()}));
  handleMainIPC('desktop:update-status', () => ({ok:true, ...getUpdateController().status()}));
  handleMainIPC('desktop:update-check', async () => {
    try { return await getUpdateController().check(); }
    catch(error) { appendLog('manual update check failed',{code:String(error?.code||'UPDATE_CHECK_FAILED'),error:safeError(error)}); return {ok:false,code:String(error?.code||'UPDATE_CHECK_FAILED'),message:String(error?.message||'Не удалось проверить обновления.').slice(0,500),status:getUpdateController().status()}; }
  });
  handleMainIPC('desktop:update-download', async () => getUpdateController().download());
  handleMainIPC('desktop:update-apply', async () => getUpdateController().apply());
  handleMainIPC('desktop:update-after-close', async () => getUpdateController().defer('after_close'));
  handleMainIPC('desktop:update-remind-later', async () => getUpdateController().defer('remind_later'));
  handleMainIPC('desktop:open-log-folder', async () => {
    ensureDir(logDir());
    const error=await shell.openPath(logDir());
    return error ? {ok:false,error:String(error)} : {ok:true,path:logDir()};
  });
  handleMainIPC('desktop:auth-license-check', async (_event, payload) => {
    try { const result=await cloudRequestWithRetry('POST','/v1/license/check',{license_key:String(payload?.licenseKey||'')}); return {ok:true,...result}; }
    catch(error){appendLog('license check failed',{code:error.code,error:safeIntegrationError(error)});return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};}
  });
  handleMainIPC('desktop:auth-register-owner', async (_event, payload) => {
    try {
      const licenseKey=String(payload?.licenseKey||''),fullName=String(payload?.fullName||''),login=String(payload?.login||''),password=String(payload?.password||'');
      // Owner registration is the only operation allowed to consume a
      // one-time key. A separate pre-check would create a race.
      const result=await cloudRequest('POST','/v1/owner/register',{license_key:licenseKey,full_name:fullName,login,password,device_id:getMachineCode(),device_name:os.hostname()||'Главный компьютер'});
      const state=saveCloudSession(result,{user:{id:'',full_name:fullName,login:login.trim().toLowerCase(),role:'owner',permissions:['*']}});
      currentSession.cloudAuth=state;schedulePendingWarehouseDeleteResume('owner-register');appendLog('cloud owner registered',{company:state.company?.code,login:state.user?.login}); return{ok:true,auth:publicCloudAuth(state)};
    }catch(error){appendLog('owner registration failed',{code:error.code,error:safeIntegrationError(error)});return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};}
  });
  handleMainIPC('desktop:auth-login', async (_event, payload) => {
    try { const result=await cloudRequestWithRetry('POST','/v1/auth/login',{company_code:String(payload?.companyCode||''),login:String(payload?.login||''),password:String(payload?.password||''),device_id:getMachineCode(),device_name:os.hostname()||'Компьютер'}); const state=saveCloudSession(result); currentSession.cloudAuth=state;schedulePendingWarehouseDeleteResume('login');appendLog('cloud login success',{company:state.company?.code,login:state.user?.login}); return{ok:true,auth:publicCloudAuth(state)}; }
    catch(error){appendLog('cloud login failed',{code:error.code,error:safeIntegrationError(error)});return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};}
  });
  handleMainIPC('desktop:auth-accept-invitation', async (_event, payload) => {
    try { const result=await cloudRequest('POST','/v1/invitations/accept',{invitation_code:String(payload?.invitationCode||''),password:String(payload?.password||''),device_id:getMachineCode(),device_name:os.hostname()||'Компьютер сотрудника'}); const state=saveCloudSession(result); currentSession.cloudAuth=state;schedulePendingWarehouseDeleteResume('invitation-accept');appendLog('cloud invitation accepted',{company:state.company?.code,login:state.user?.login}); return{ok:true,auth:publicCloudAuth(state)}; }
    catch(error){appendLog('cloud invitation failed',{code:error.code,error:safeIntegrationError(error)});return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};}
  });
  handleMainIPC('desktop:auth-logout', async () => { stopTelegramCompanyPublishRetry();stopWarehouseDeleteResume();telegramCompanyPublishRetryFailures=0;clearCloudAuthState(); if(currentSession)currentSession.cloudAuth=null; appendLog('cloud logout'); return{ok:true}; });
  handleMainIPC('desktop:auth-users', async () => { try{return{ok:true,...(await cloudAuthenticatedRequest('GET','/v1/users'))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:auth-invite', async (_event,payload) => { try{return{ok:true,...(await cloudAuthenticatedRequest('POST','/v1/users/invite',{full_name:String(payload?.fullName||''),login:String(payload?.login||''),role:String(payload?.role||'manager'),permissions:Array.isArray(payload?.permissions)?payload.permissions:[],expires_in_hours:Number(payload?.expiresInHours)||24}))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:auth-user-status', async (_event,payload) => { try{return{ok:true,...(await cloudAuthenticatedRequest('PATCH',`/v1/users/${encodeURIComponent(String(payload?.userId||''))}/status`,{status:String(payload?.status||'')}))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:auth-user-access', async (_event,payload) => { try{return{ok:true,...(await cloudAuthenticatedRequest('PATCH',`/v1/users/${encodeURIComponent(String(payload?.userId||''))}/access`,{role:String(payload?.role||''),permissions:Array.isArray(payload?.permissions)?payload.permissions:[]}))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:auth-devices', async () => { try{return{ok:true,...(await cloudAuthenticatedRequest('GET','/v1/devices'))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:auth-device-status', async (_event,payload) => { try{return{ok:true,...(await cloudAuthenticatedRequest('PATCH',`/v1/devices/${encodeURIComponent(String(payload?.deviceId||''))}/status`,{status:String(payload?.status||'')}))};}catch(error){return{ok:false,error:error.code||'NETWORK_ERROR',message:error.message};} });
  handleMainIPC('desktop:copy-text', (_event, text) => { clipboard.writeText(text); return true; });
  handleMainIPC('desktop:open-support', (_event, channel) => {
    const map = {telegram:SUPPORT_TELEGRAM, vk:SUPPORT_VK, email:SUPPORT_EMAIL};
    const url = map[channel]; if (!url) return false; return shell.openExternal(url).then(() => true, () => false);
  });
  handleMainIPC('desktop:reg-status', async () => getRegStatus());
  handleMainIPC('desktop:address-search',async(_event,payload)=>resolveDesktopAddressSearch(payload));
  handleMainIPC('desktop:maps-geocode',async(_event,payload)=>resolveDesktopMapGeocode(payload));
  handleMainIPC('desktop:maps-diagnostic',async(_event,payload)=>{
    const requestId=String(payload?.requestId||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
    const source=String(payload?.source||'unknown').replace(/[^A-Za-z0-9:_-]/g,'').slice(0,60)||'unknown';
    const mode=['search','reverse'].includes(String(payload?.mode||''))?String(payload.mode):'unknown';
    const addressKeys=Array.isArray(payload?.addressKeys)?payload.addressKeys.map(value=>String(value||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)).filter(Boolean).slice(0,30):[];
    appendRecurringLog('Map administrative parser diagnostic',{requestId,source,mode,addressKeys,regionDetected:payload?.regionDetected===true,districtDetected:payload?.districtDetected===true});
    return{ok:true};
  });
  handleMainIPC('desktop:maps-route',async(_event,payload)=>{
    const configured=!!regState();
    let publicError=null;
    try{const data=await directOpenStreetMapRoute(payload);return{ok:true,configured,source:'direct-openstreetmap',data};}
    catch(error){publicError=error;appendRecurringLog('Public route calculation failed',{code:String(error?.code||''),error:safeIntegrationError(error)});}
    if(configured){try{const result=await regApiRequest('POST','/v1/maps/route',validateDesktopRoutePayload(payload));appendRecurringLog('Map route switched to company VPS',{publicCode:String(publicError?.code||'')});return{ok:true,configured:true,source:'company-vps',degraded:true,warning:'Прямой канал OpenStreetMap недоступен; маршрут рассчитан через VPS компании.',data:result.data};}catch(error){appendRecurringLog('VPS route calculation failed',{code:String(error?.code||''),error:safeIntegrationError(error)});return{ok:false,configured:true,code:String(error?.code||publicError?.code||'MAP_REQUEST_FAILED'),error:`OpenStreetMap: ${safeIntegrationError(publicError)}; VPS: ${safeIntegrationError(error)}`};}}
    return{ok:false,configured:false,code:String(publicError?.code||'MAP_REQUEST_FAILED'),error:safeIntegrationError(publicError)};
  });
  handleMainIPC('desktop:reg-warehouses', async (_event, payload) => {
    try {
      const environment='live';
      const state=regState();
      if(!state)return{ok:true,configured:false,warehouses:[]};
      const result=await regApiRequest('GET',`/v1/warehouses?environment=${encodeURIComponent(environment)}`);
      if(String(result.workspace_id||'')!==String(state.workspace_id||''))throw new Error('Сервер вернул склады другой компании.');
      const warehouses=Array.isArray(result.warehouses)?result.warehouses.filter(item=>item&&/^[A-Za-z0-9_-]{1,120}$/.test(String(item.id||''))):[];
      const registryInitialized=typeof result.registry_initialized==='boolean'?result.registry_initialized:null;
      return{ok:true,configured:true,environment,warehouses,registryInitialized};
    }catch(error){
      appendRecurringLog('REG.RU warehouse registry failed',{code:String(error?.code||''),error:safeIntegrationError(error)});
      return{ok:false,error:safeIntegrationError(error),code:String(error?.code||'')};
    }
  });
  handleMainIPC('desktop:reg-configure', async (_event, payload) => {
    try { return {ok:true, ...(await configureRegVps(payload))}; }
    catch (error) { appendLog('REG.RU setup failed',safeIntegrationError(error)); return {ok:false,error:safeIntegrationError(error)}; }
  });
  handleMainIPC('desktop:reg-entity-bootstrap',async(_event,payload)=>{
    try{
      const warehouseId=requireActiveRendererWarehouse(payload?.warehouseId),environment=requireCurrentEnvironment(payload?.environment),state=regState();
      const result=await regApiRequest('GET',regEntityPath(state,warehouseId,environment));
      if(String(result.workspace_id||'')!==String(state.workspace_id||'')||String(result.warehouse_id||'')!==warehouseId||String(result.environment||'')!==environment)throw new Error('VPS вернул данные другой компании, склада или среды.');
      const cursor=Number(result.cursor);if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error('VPS вернул повреждённый курсор изменений.');
      const entities=(Array.isArray(result.entities)?result.entities:[]).map(item=>validateRegEntity(item,warehouseId));
      const readableTypes=[...new Set((Array.isArray(result.readable_types)?result.readable_types:[]).map(String).filter(type=>REG_ENTITY_TYPES.has(type)))];
      appendLog('VPS entity bootstrap downloaded',{warehouseId,environment,cursor,entities:entities.length});
      return{ok:true,warehouseId,environment,cursor,entities,readableTypes};
    }catch(error){appendRecurringLog('VPS entity bootstrap failed',{code:String(error?.code||''),error:safeIntegrationError(error)});return{ok:false,error:safeIntegrationError(error),code:String(error?.code||'')}}
  });
  handleMainIPC('desktop:reg-entity-sync',async(_event,payload)=>{
    try{
      const warehouseId=requireActiveRendererWarehouse(payload?.warehouseId),environment=requireCurrentEnvironment(payload?.environment),state=regState(),batch=validateRegEntityBatch(payload,warehouseId);
      const createsWarehouse=batch.changes.some(item=>item.type==='warehouse'&&item.id===warehouseId&&item.deleted===false&&item.base_version===0);
      if(createsWarehouse&&!canCreateCompanyWarehouses(currentSession?.cloudAuth))throw Object.assign(new Error('Создать склад может владелец или администратор с доступом ко всем складам.'),{code:'WAREHOUSE_CREATE_GLOBAL_ACCESS_REQUIRED'});
      const result=await submitRegEntityBatch(state,warehouseId,environment,batch);
      appendLog('VPS entity batch committed',{warehouseId,environment,cursor:result.cursor,entities:result.entities.length,replayed:result.replayed});
      return{ok:true,warehouseId,environment,commandId:batch.command_id,...result};
    }catch(error){appendLog('VPS entity batch failed',{code:String(error?.code||''),error:safeIntegrationError(error),details:error?.details||{}});return{ok:false,error:safeIntegrationError(error),code:String(error?.code||''),details:error?.details||{}}}
  });
  handleMainIPC('desktop:reg-warehouse-write',async(_event,payload)=>{
    try{
      if(!canManageCompanyWarehouses(currentSession?.cloudAuth))throw Object.assign(new Error('Нет права изменять склады компании.'),{code:'WAREHOUSE_ACCESS_DENIED'});
      const warehouseId=validateWarehouseId(payload?.warehouseId),environment=validateEnvironment(payload?.environment),state=regState(),batch=validateRegEntityBatch(payload,warehouseId);
      if(environment!=='live')throw Object.assign(new Error('Реестр складов можно изменять только в LIVE-контуре.'),{code:'WAREHOUSE_ENVIRONMENT_INVALID'});
      const warehouseChanges=batch.changes.filter(item=>item.type==='warehouse'&&item.id===warehouseId),warehouseChange=warehouseChanges[0],supplemental=batch.changes.filter(item=>item!==warehouseChange),creating=warehouseChange?.deleted===false&&warehouseChange?.base_version===0,supplementalKeys=supplemental.map(item=>`${item.type}:${item.id}`);
      if(creating&&!canCreateCompanyWarehouses(currentSession?.cloudAuth))throw Object.assign(new Error('Создать склад может владелец или администратор с доступом ко всем складам.'),{code:'WAREHOUSE_CREATE_GLOBAL_ACCESS_REQUIRED'});
      if(warehouseChange?.deleted&&!canDeleteCompanyWarehouses(currentSession?.cloudAuth))throw Object.assign(new Error('Удалить склад может только владелец или администратор с доступом ко всем складам.'),{code:'WAREHOUSE_DELETE_GLOBAL_ACCESS_REQUIRED'});
      const validSupplemental=creating&&supplemental.length<=2&&new Set(supplementalKeys).size===supplemental.length&&supplemental.every(item=>item.deleted===false&&item.base_version===0&&((item.type==='settings'&&item.id==='settings')||(item.type==='company'&&item.id==='company')));
      if(batch.intent||warehouseChanges.length!==1||(!validSupplemental&&supplemental.length))throw new Error('Команда склада содержит посторонние данные.');
      const deletion=warehouseChange.deleted?await completeWarehouseDeleteOperation({warehouseId,warehouseCode:validateWarehouseCode(payload?.warehouseCode),batch,state}):null;
      const result=deletion?.result||await submitRegEntityBatch(state,warehouseId,environment,batch),commandId=deletion?.commandId||batch.command_id;
      const confirmed=result.entities.find(item=>item.type==='warehouse'&&item.id===warehouseId);appendLog('VPS warehouse record committed',{warehouseId,environment,deleted:warehouseChange.deleted,version:confirmed?.version||0,cascadeDeleted:result.cascade_deleted,telegramDeprovisioned:Boolean(deletion),telegramLocalCleanupPending:deletion?.localCleanupPending===true});
      return{ok:true,warehouseId,environment,commandId,...result,telegram_deprovisioned:Boolean(deletion),telegram_local_cleanup_pending:deletion?.localCleanupPending===true};
    }catch(error){appendLog('VPS warehouse record failed',{code:String(error?.code||''),error:safeIntegrationError(error),details:error?.details||{}});return{ok:false,error:safeIntegrationError(error),code:String(error?.code||''),details:error?.details||{}}}
  });
  handleMainIPC('desktop:reg-entity-changes',async(_event,payload)=>{
    try{
      const warehouseId=requireActiveRendererWarehouse(payload?.warehouseId),environment=requireCurrentEnvironment(payload?.environment),state=regState(),afterEventId=Number(payload?.afterEventId||0),limit=Math.min(500,Math.max(1,Number(payload?.limit)||250));
      if(!Number.isSafeInteger(afterEventId)||afterEventId<0)throw new Error('Локальный курсор изменений повреждён.');
      const requestPath=`${regEntityPath(state,warehouseId,environment,'changes')}?after=${encodeURIComponent(afterEventId)}&limit=${encodeURIComponent(limit)}`;
      const result=await regApiRequest('GET',requestPath);
      if(String(result.workspace_id||'')!==String(state.workspace_id||'')||String(result.warehouse_id||'')!==warehouseId||String(result.environment||'')!==environment)throw new Error('VPS вернул изменения другой компании, склада или среды.');
      const cursor=Number(result.cursor);if(!Number.isSafeInteger(cursor)||cursor<afterEventId)throw new Error('VPS вернул повреждённый курсор изменений.');
      const events=(Array.isArray(result.events)?result.events:[]).map(item=>{
        const event=validateRegEntity(item,warehouseId,{event:true}),eventId=Number(item.event_id);
        if(!Number.isSafeInteger(eventId)||eventId<=0)throw new Error('VPS вернул событие без идентификатора.');
        return{...event,eventId,digest:String(item.digest_sha256||''),actorId:String(item.actor_id||''),deviceId:String(item.device_id||''),commandId:String(item.command_id||''),createdAt:String(item.created_at||'')};
      });
      const readableTypes=[...new Set((Array.isArray(result.readable_types)?result.readable_types:[]).map(String).filter(type=>REG_ENTITY_TYPES.has(type)))];
      return{ok:true,warehouseId,environment,cursor,events,readableTypes,hasMore:result.has_more===true};
    }catch(error){appendRecurringLog('VPS entity changes failed',{code:String(error?.code||''),error:safeIntegrationError(error)});return{ok:false,error:safeIntegrationError(error),code:String(error?.code||'')}}
  });
  handleMainIPC('desktop:telegram-status', async (_event,payload) => getTelegramStatus(requireActiveRendererWarehouse(payload?.warehouseId)));
  handleMainIPC('desktop:telegram-configure', async (_event, payload) => {
    try { return {ok:true,...(await configureTelegram(!!payload?.reconnect,requireActiveRendererWarehouse(payload?.warehouseId)))}; }
    catch(error) { const safe=telegramProvisioningError(error); appendLog('Telegram/Cloudflare setup failed',safe); return {ok:false,error:safe.display,stage:safe.stage,code:safe.code}; }
  });
  handleMainIPC('desktop:telegram-create-link', async (_event, payload) => {
    try { requireActiveRendererWarehouse(payload?.warehouseId); return await createTelegramLink(payload); }
    catch(error) { appendLog('Telegram link creation failed',{code:String(error?.code||''),error:safeIntegrationError(error)}); return {ok:false,error:safeIntegrationError(error),code:String(error?.code||'TELEGRAM_LINK_FAILED')}; }
  });
  handleMainIPC('desktop:telegram-send', async (_event, payload) => {
    try { requireActiveRendererWarehouse(payload?.warehouseId); return await sendTelegramNotification(payload); }
    catch(error) { appendLog('Telegram send failed',{code:String(error?.code||''),error:safeIntegrationError(error)}); return {ok:false,error:safeIntegrationError(error),code:String(error?.code||'TELEGRAM_SEND_FAILED')}; }
  });
  handleMainIPC('desktop:telegram-poll-events', async (_event, payload) => {
    try { requireActiveRendererWarehouse(payload?.warehouseId); return await pollTelegramEvents(payload); }
    catch(error) { appendRecurringLog('Telegram event poll failed',{code:String(error?.code||''),error:safeIntegrationError(error)}); return {ok:false,error:safeIntegrationError(error),code:String(error?.code||'TELEGRAM_POLL_FAILED')}; }
  });
  handleMainIPC('desktop:telegram-bindings', async (_event, payload) => {
    try { requireActiveRendererWarehouse(payload?.warehouseId); return await getTelegramBindings(payload); }
    catch(error) { appendLog('Telegram bindings failed',{code:String(error?.code||''),error:safeIntegrationError(error)}); return {ok:false,error:safeIntegrationError(error),code:String(error?.code||'TELEGRAM_BINDINGS_FAILED')}; }
  });
  handleMainIPC('desktop:save-text-file', async (_event, payload) => {
    const name = String(payload?.name || 'export.txt').replace(/[\\/:*?"<>|]/g,'_');
    const result = await dialog.showSaveDialog({defaultPath:path.join(config.data_dir,name)});
    if (result.canceled || !result.filePath) return {ok:false,canceled:true};
    fs.writeFileSync(result.filePath, String(payload?.content || ''),'utf8'); return {ok:true,path:result.filePath};
  });
  handleMainIPC('desktop:select-file', async (_event, filters) => {
    const result = await dialog.showOpenDialog({properties:['openFile'], filters:Array.isArray(filters)?filters:undefined});
    return result.canceled ? null : result.filePaths[0];
  });
  handleMainIPC('desktop:select-folder', async () => {
    const result = await dialog.showOpenDialog({properties:['openDirectory','createDirectory']}); return result.canceled?null:result.filePaths[0];
  });
  handleMainIPC('desktop:restart', () => {
    const timer=setTimeout(()=>{app.relaunch();app.exit(0)},150);timer.unref?.();
    return {ok:true,scheduled:true};
  });
  handleMainIPC('desktop:quit', () => {
    const timer=setTimeout(()=>app.quit(),150);timer.unref?.();
    return {ok:true,scheduled:true};
  });
}
function switchExpiredDemoToCloudSignIn(config) {
  // An expired DEMO must never fall back to the retired local activation window.
  // Convert the installation to the full sign-in shell and let Cloudflare decide
  // whether the person activates a new company or signs into an existing one.
  config.mode = 'full';
  delete config.activation_token;
  persistInstallConfig(config);
  appendLog('demo expired; switching to Cloudflare sign-in');
}
function startDemoTimer(config) {
  clearInterval(demoTimer);
  if (currentSession?.edition !== 'demo') return;
  demoTimer = setInterval(() => {
    if (!currentSession?.demoState) return;
    currentSession.demoState.last_seen_at = new Date(Math.max(Date.now(), Date.parse(currentSession.demoState.last_seen_at)||0)).toISOString();
    persistDemoState(config.data_dir, currentSession.demoState);
    const ms = remainingDemoMs(currentSession.demoState);
    currentSession.demoRemainingMs = ms;
    sendWindowMessage(mainWindow,'desktop:demo-tick',{remainingMs:ms});
    if (ms <= 0) {
      clearInterval(demoTimer);
      switchExpiredDemoToCloudSignIn(config);
      app.relaunch();
      app.exit(0);
    }
  }, 60000);
}
async function startAuthorizedApplication() {
  const config = readInstallConfig();
  sendSplash('Проверяем рабочее пространство','Отдельная база и настройки JustFun',20);
  registerIPC(config);
  sendSplash('Готовим данные','Выбираем отдельную среду и проверяем локальное хранилище',45);
  await createMainWindow();
  startDemoTimer(config);
  scheduleTelegramCompanyPublishRetry('application-start',5000);
  scheduleUpdateChecks();
  appendLog('application started', {edition:currentSession.edition, recovery:currentSession.recovery});
}
async function boot() {
  appendLog('boot entered', {version:VERSION, executable:process.execPath});
  appendLog('runtime hardening active', runtimeHardeningReport);
  const config = readInstallConfig();
  setSecureSessionDefaults(config);
  await app.whenReady();
  const integrity = verifyPackagedApplicationIntegrity({applicationDirectory:__dirname});
  appendLog('release integrity verified', integrity);
  appendLog('electron ready', {version:process.versions.electron, chrome:process.versions.chrome, node:process.versions.node});
  app.setAppUserModelId('JustFun.OrdersLogistics');
  configureElectronSession(config);
  try { getUpdateController().reconcileHelperState(); }
  catch(error) { appendLog('startup update reconciliation failed',{code:String(error?.code||'UPDATE_RECONCILE_FAILED'),error:safeError(error)}); }
  const updateHealthOperation=updateOperationArgument('update-health-operation');
  const updateRollbackOperation=updateOperationArgument('update-rollback');
  if (!updateHealthOperation && !updateRollbackOperation && getUpdateController().startupRecovery().action === 'rollback') {
    const recovery=await getUpdateController().recover();
    appendLog('startup update recovery decision',recovery);
    if (recovery.ok) return;
  }
  if (updateRollbackOperation) monitorUpdateHelper();
  createSplash();
  sendSplash('Запуск JustFun','Проверяем редакцию и лицензию',10);
  currentSession = await buildSession(config);
  appendLog('session evaluated', {edition:currentSession.edition, authorized:currentSession.authorized, recovery:currentSession.recovery});
  schedulePendingWarehouseDeleteResume('startup');
  if (!currentSession.authorized && currentSession.edition === 'demo') {
    switchExpiredDemoToCloudSignIn(config);
    currentSession = await buildSession(config);
    appendLog('expired demo opened Cloudflare sign-in', {edition:currentSession.edition, authorized:currentSession.authorized});
  }
  await startAuthorizedApplication();
}

function selfTestOutputPath() {
  const prefix = '--self-test-output=';
  const arg = process.argv.find(value => String(value).startsWith(prefix));
  return arg ? String(arg).slice(prefix.length) : path.join(os.tmpdir(), `JustFun-OrdersLogistics-self-test-${VERSION}.json`);
}
async function runSelfTest() {
  const outputPath = selfTestOutputPath();
  const config = readInstallConfig();
  const isolatedId = crypto.createHash('sha256').update(path.resolve(outputPath)).digest('hex').slice(0,16);
  config.mode = 'demo';
  config.data_dir = path.join(os.tmpdir(), 'JustFun-OrdersLogistics-self-test', isolatedId);
  setSecureSessionDefaults(config);
  await app.whenReady();
  app.setAppUserModelId('JustFun.OrdersLogistics');
  configureElectronSession(config);
  currentSession = {
    edition:'demo',
    authorized:true,
    demoState:makeDemoState(),
    demoRemainingMs:DEMO_DURATION_MS,
    machineCode:getMachineCode(),
    dataDir:config.data_dir,
    recovery:false,
    cloudAuth:null
  };
  const result = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    edition: currentSession.edition,
    authorized: currentSession.authorized,
    machineCode: currentSession.machineCode,
    externalBrowserRequired: false,
    localHttpServerUsed: false,
    checks: {},
    errors: []
  };
  if (!currentSession.authorized) {
    if (currentSession.edition === 'full') {
      result.expectedActivation = true;
      result.checks.protectedSignInAvailable = fs.existsSync(path.join(__dirname, 'web', 'index.html'));
      if (!result.checks.protectedSignInAvailable) result.errors.push('protected sign-in resources missing');
      writeJsonAtomic(outputPath, result);
      appendLog('self-test complete: activation expected', result);
      app.exit(result.errors.length ? 3 : 0);
      return;
    }
    result.errors.push('DEMO expired');
    writeJsonAtomic(outputPath, result);
    app.exit(2);
    return;
  }
  registerIPC(config);
  const selfTestSession=session.fromPartition(`self-test-${isolatedId}`);
  registerAppProtocol(selfTestSession);
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false, backgroundColor: '#eef6f1',
    webPreferences: {preload:path.join(__dirname,'preload.js'), nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, devTools:false,
      session:selfTestSession,
      additionalArguments:[`--jf-edition=${currentSession?.edition === 'demo' ? 'demo' : 'full'}`,`--jf-version=${VERSION}`]}
  });
  mainWindow=win;
  const failures = [];
  win.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') failures.push(String(details.message || 'renderer console error'));
  });
  win.webContents.on('render-process-gone', (_event, details) => failures.push(`renderer:${details.reason}:${details.exitCode}`));
  const loadPromise = win.loadURL(appRendererUrl('web/index.html'));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('self-test load timeout')), 30000));
  await Promise.race([loadPromise, timeout]);
  await waitForRenderer(win,"document.documentElement.classList.contains('jf-authenticated')",45000);
  await new Promise(resolve => setTimeout(resolve, 500));
  const dom = await win.webContents.executeJavaScript(`(() => ({
    title: document.title,
    authRoot: document.querySelectorAll('#jfAuthRoot').length,
    ownerForm: document.querySelectorAll('#jfOwnerForm').length,
    loginForm: document.querySelectorAll('#jfLoginForm').length,
    cloudWelcome: document.querySelectorAll('#jfCloudWelcome').length,
    tabs: ['tabOrders','tabTrips','tabProducts','tabDrivers','tabReports','tabSettings','tabProgramSettings'].filter(id => document.getElementById(id)).length,
    warehouseBootstrap: typeof window.TeplitsaWarehouseBootstrap === 'object' && typeof window.TeplitsaWarehouseBootstrap.dataKey === 'function',
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    readyState: document.readyState,
    workspaceReady: document.documentElement.classList.contains('jf-authenticated'),
    protocol: location.protocol,
    host: location.host
  }))()`);
  result.checks = {
    appProtocol: dom.protocol === `${APP_RENDERER_SCHEME}:`,
    trustedAppHost: dom.host === APP_RENDERER_HOST,
    pageComplete: dom.readyState === 'complete',
    workspaceReady: Boolean(dom.workspaceReady),
    title: dom.title,
    authSurface: dom.authRoot === 1 && (dom.ownerForm === 1 || dom.loginForm === 1 || dom.cloudWelcome === 1),
    accessSurface: Boolean(dom.workspaceReady) || (dom.authRoot === 1 && (dom.ownerForm === 1 || dom.loginForm === 1 || dom.cloudWelcome === 1)),
    tabsDetected: dom.tabs >= 7,
    warehouseBootstrap: Boolean(dom.warehouseBootstrap),
    horizontalOverflow: Math.max(0, dom.bodyWidth - dom.viewportWidth)
  };
  if (!result.checks.appProtocol) failures.push(`unexpected protocol ${dom.protocol}`);
  if (!result.checks.trustedAppHost) failures.push(`unexpected host ${dom.host}`);
  if (!result.checks.pageComplete) failures.push(`readyState ${dom.readyState}`);
  if (!result.checks.workspaceReady) failures.push('workspace not authenticated');
  if (!result.checks.accessSurface) failures.push('workspace or authentication surface not ready');
  if (!result.checks.tabsDetected) failures.push(`tabs detected ${dom.tabs}`);
  if (!result.checks.warehouseBootstrap) failures.push('warehouse bootstrap missing');
  if (result.checks.horizontalOverflow > 0) failures.push(`horizontal overflow ${result.checks.horizontalOverflow}px`);
  result.errors.push(...failures);
  writeJsonAtomic(outputPath, result);
  appendLog('self-test complete', result);
  win.destroy();
  app.exit(failures.length ? 3 : 0);
}

function visualQaOutputDirectory() {
  const prefix='--visual-qa-output=';
  const arg=process.argv.find(value=>String(value).startsWith(prefix));
  return arg?path.resolve(String(arg).slice(prefix.length)):'';
}
function parseCssColor(value) {
  const match=String(value||'').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  return match?{r:Number(match[1]),g:Number(match[2]),b:Number(match[3]),a:match[4]===undefined?1:Number(match[4])}:null;
}
function contrastRatio(foreground,background) {
  const fg=parseCssColor(foreground),bg=parseCssColor(background);
  if(!fg||!bg)return 0;
  const mix=(channel,alpha,back)=>channel*alpha+back*(1-alpha);
  const rgb=[mix(fg.r,fg.a,bg.r),mix(fg.g,fg.a,bg.g),mix(fg.b,fg.a,bg.b)].map(value=>{
    const normalized=value/255;
    return normalized<=0.04045?normalized/12.92:Math.pow((normalized+0.055)/1.055,2.4);
  });
  const bgRgb=[bg.r,bg.g,bg.b].map(value=>{const normalized=value/255;return normalized<=0.04045?normalized/12.92:Math.pow((normalized+0.055)/1.055,2.4)});
  const light=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2],back=0.2126*bgRgb[0]+0.7152*bgRgb[1]+0.0722*bgRgb[2];
  return (Math.max(light,back)+0.05)/(Math.min(light,back)+0.05);
}
async function waitForRenderer(win,predicate,timeoutMs=30000) {
  const started=Date.now();let lastError=null;
  while(Date.now()-started<timeoutMs){
    try{if(await win.webContents.executeJavaScript(`Boolean(${predicate})`))return true}
    catch(error){lastError=error}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error(`Visual QA timeout: ${predicate}${lastError?`; last renderer error: ${safeError(lastError)}`:''}`);
}
async function capturePaintedFrame(win,region) {
  let painted=null;
  const onPaint=(_event,_dirty,image)=>{if(image&&!image.isEmpty())painted=image};
  win.webContents.on('paint',onPaint);
  try{
    win.webContents.invalidate();
    await new Promise(resolve=>setTimeout(resolve,420));
  }finally{
    win.webContents.removeListener('paint',onPaint);
  }
  if(painted&&!painted.isEmpty())return painted;
  return win.webContents.capturePage(region);
}
async function captureVisualQa(win,output,name,expected={width:1600,height:1000}) {
  const viewportWidth=Number(expected.viewportWidth)||Number(expected.width)||1600;
  const viewportHeight=Number(expected.viewportHeight)||Number(expected.height)||1000;
  const outputWidth=Number(expected.outputWidth)||Number(expected.width)||1600;
  const outputHeight=Number(expected.outputHeight)||Number(expected.height)||1000;
  const content=await win.webContents.executeJavaScript("({width:window.innerWidth,height:window.innerHeight})");
  if(Math.abs(content.width-viewportWidth)>2||Math.abs(content.height-viewportHeight)>2){
    throw new Error(`Visual QA viewport changed before capture: ${name} ${content.width}x${content.height}`);
  }
  const captured=await capturePaintedFrame(win,{x:0,y:0,width:content.width,height:content.height});
  const capturedSize=captured.getSize();
  const scaleX=capturedSize.width/outputWidth,scaleY=capturedSize.height/outputHeight;
  if(Math.abs(scaleX-scaleY)>0.01||scaleX<0.5||scaleX>3){
    throw new Error(`Visual QA frame has invalid dimensions: ${name} ${capturedSize.width}x${capturedSize.height}`);
  }
  const image=capturedSize.width===outputWidth&&capturedSize.height===outputHeight
    ? captured
    : captured.resize({width:outputWidth,height:outputHeight,quality:'best'});
  const size=image.getSize();
  if(size.width!==outputWidth||size.height!==outputHeight)throw new Error(`Visual QA frame has invalid dimensions after DPI normalization: ${name} ${size.width}x${size.height}`);
  const target=path.join(output,`${name}.png`);
  fs.writeFileSync(target,image.toPNG());
  const bytes=fs.statSync(target).size;
  if(bytes<20000)throw new Error(`Visual QA produced an empty or incomplete frame: ${name} (${bytes} bytes)`);
  return{name,file:path.basename(target),width:size.width,height:size.height,bytes};
}
async function captureNativeVisualQaWindow(win,output,name) {
  if(!win||win.isDestroyed())throw new Error(`Visual QA window is unavailable: ${name}`);
  const content=win.getContentBounds();
  if(content.width<600||content.height<500)throw new Error(`Visual QA native window is too small: ${name} ${content.width}x${content.height}`);
  win.webContents.invalidate();
  await new Promise(resolve=>setTimeout(resolve,180));
  const captured=await win.webContents.capturePage();
  const capturedSize=captured.getSize();
  const image=capturedSize.width===content.width&&capturedSize.height===content.height
    ? captured
    : captured.resize({width:content.width,height:content.height,quality:'best'});
  const target=path.join(output,`${name}.png`);
  fs.writeFileSync(target,image.toPNG());
  const bytes=fs.statSync(target).size;
  if(bytes<15000)throw new Error(`Visual QA produced an empty or incomplete native frame: ${name} (${bytes} bytes)`);
  return{name,file:path.basename(target),width:content.width,height:content.height,bytes};
}
async function collectVisualContract(win,selectors) {
  return win.webContents.executeJavaScript(`(() => {
    const output={overflow:Math.max(0,document.body.scrollWidth-document.documentElement.clientWidth),items:[]};
    const backgroundOf=element=>{let current=element;while(current){const value=getComputedStyle(current).backgroundColor;if(value&&value!=='rgba(0, 0, 0, 0)'&&value!=='transparent')return value;current=current.parentElement}return'rgb(255, 255, 255)'};
    for(const selector of ${JSON.stringify(selectors)}){
      const element=document.querySelector(selector);if(!element){output.items.push({selector,missing:true});continue}
      const style=getComputedStyle(element);
      const rect=element.getBoundingClientRect();
      output.items.push({selector,text:String(element.textContent||element.value||'').trim().slice(0,160),color:style.color,background:backgroundOf(element),fontSize:style.fontSize,visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0});
    }
    return output;
  })()`);
}
async function openVisualQaWindow(edition,partition,viewport={width:1600,height:1000}) {
  const width=Math.max(720,Number(viewport.width)||1600),height=Math.max(600,Number(viewport.height)||1000);
  const visualSession=session.fromPartition(partition);
  registerAppProtocol(visualSession);
  const win=new BrowserWindow({
    width,height,minWidth:720,minHeight:600,
    x:-20000,y:-20000,useContentSize:false,frame:false,resizable:false,show:true,skipTaskbar:true,backgroundColor:'#edf5f1',
    webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false,spellcheck:false,session:visualSession,
      backgroundThrottling:false,
      additionalArguments:[`--jf-edition=${edition}`,`--jf-company-id=${edition==='demo'?'visualqa':''}`,`--jf-version=${VERSION}`]}
  });
  mainWindow=win;
  await win.loadURL(appRendererUrl('web/index.html'));
  await waitForRenderer(win,"document.readyState==='complete'");
  for(let attempt=0;attempt<3;attempt++){
    const viewport=await win.webContents.executeJavaScript("({width:window.innerWidth,height:window.innerHeight})");
    if(Math.abs(viewport.width-width)<=1&&Math.abs(viewport.height-height)<=1)break;
    const bounds=win.getBounds();
    win.setBounds({x:-20000,y:-20000,width:bounds.width+(width-viewport.width),height:bounds.height+(height-viewport.height)},false);
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(resolve=>setTimeout(resolve,450));
  return win;
}
async function collectResponsiveContract(win,label,zoomFactor) {
  return win.webContents.executeJavaScript(`(() => {
    const viewport={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,innerWidth:window.innerWidth,innerHeight:window.innerHeight,devicePixelRatio:window.devicePixelRatio};
    const visible=element=>{if(!element)return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0};
    const item=selector=>{const element=document.querySelector(selector);if(!element)return{selector,missing:true};const rect=element.getBoundingClientRect();return{selector,visible:visible(element),left:Math.round(rect.left),right:Math.round(rect.right),top:Math.round(rect.top),bottom:Math.round(rect.bottom),width:Math.round(rect.width),height:Math.round(rect.height),clippedLeft:rect.left<-1,clippedRight:rect.right>viewport.width+1}};
    const selectors=['#jfDesktopStrip','.topbar','.tabs-shell-v595','#ordersView .orders-view-copy','#ordersView .orders-toolbar','#orderModal.open .modal-box','#jfHelpModal.open .jf-help-dialog'];
    return{label:${JSON.stringify(label)},zoomFactor:${Number(zoomFactor)||1},viewport,bodyWidth:document.body.scrollWidth,documentWidth:document.documentElement.scrollWidth,horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-viewport.width),verticalScrollable:document.documentElement.scrollHeight>viewport.height,items:selectors.map(item),openDialogs:[...document.querySelectorAll('.modal.open,.jf-help-modal.open,.jf-profile-modal.open')].length};
  })()`);
}
async function runVisualQa() {
  const output=visualQaOutputDirectory();
  if(!output)throw new Error('Не указана папка визуальной проверки.');
  ensureDir(output);
  const electronProfile=path.join(output,'electron-profile');
  ensureDir(electronProfile);
  app.setPath('userData',electronProfile);
  const config=readInstallConfig();
  localRootOverride=path.join(output,'isolated-local');
  ensureDir(localRootOverride);
  config.data_dir=path.join(output,'isolated-data');
  ensureDir(config.data_dir);
  setSecureSessionDefaults(config);
  await app.whenReady();
  app.setAppUserModelId('JustFun.OrdersLogistics.VisualQA');
  configureElectronSession(config);
  currentSession={edition:'full',authorized:false,machineCode:'VISUAL-QA',cloudAuth:null,recovery:false};
  registerIPC(config);
  const result={version:VERSION,createdAt:new Date().toISOString(),screens:[],contracts:[],assetChecks:[],layoutChecks:[],responsiveChecks:[],errors:[]};
  let win=null;
  try{
    win=await openVisualQaWindow('full',`visual-auth-${crypto.randomBytes(8).toString('hex')}`);
    await waitForRenderer(win,"document.querySelector('#jfCloudWelcome')&&getComputedStyle(document.querySelector('#jfAuthRoot')).visibility==='visible'");
    result.screens.push(await captureVisualQa(win,output,'01-auth-welcome'));
    result.contracts.push({screen:'auth-welcome',...(await collectVisualContract(win,['.jf-auth-main h2','#jfCloudWelcome>.muted','.jf-auth-choice b','.jf-auth-choice span']))});
    const authLogo=await win.webContents.executeJavaScript(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({name:'auth-logo',ok:image.naturalWidth>=128&&image.naturalHeight>=128,width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({name:'auth-logo',ok:false,width:0,height:0});image.src=new URL('assets/justfun-official-transparent.png',document.baseURI).href})`);
    result.assetChecks.push(authLogo);
    if(!authLogo.ok)result.errors.push('auth-welcome: JustFun logo asset is missing or incomplete');
    await win.webContents.executeJavaScript("document.querySelector('#jfCloudLogin').click()");
    await waitForRenderer(win,"document.querySelector('#jfLoginForm')&&getComputedStyle(document.querySelector('#jfAuthRoot')).visibility==='visible'");
    result.screens.push(await captureVisualQa(win,output,'02-auth-login'));
    result.contracts.push({screen:'auth-login',...(await collectVisualContract(win,['.jf-auth-main h2','.jf-auth-main>.muted','#jfLoginForm label','#jfCompanyCode']))});
    win.destroy();win=null;

    currentSession={edition:'demo',authorized:true,machineCode:'VISUAL-QA',cloudAuth:null,recovery:false,demoState:makeDemoState()};
    win=await openVisualQaWindow('demo',`visual-workspace-${crypto.randomBytes(8).toString('hex')}`);
    await waitForRenderer(win,"document.documentElement.classList.contains('jf-authenticated')",45000);
    await new Promise(resolve=>setTimeout(resolve,1800));
    result.screens.push(await captureVisualQa(win,output,'03-workspace-orders'));
    result.contracts.push({screen:'workspace-orders',...(await collectVisualContract(win,['.brand-title','.brand-sub','.orders-view-copy h1','.orders-view-copy p','.tab.active']))});
    const orderPaymentLayout=await win.webContents.executeJavaScript(`(() => {const pill=document.querySelector('#ordersArea .payment-pill'),cell=pill?.closest('td');if(!pill||!cell)return{name:'order-payment-pill',ok:false,reason:'missing'};const p=pill.getBoundingClientRect(),c=cell.getBoundingClientRect();return{name:'order-payment-pill',ok:p.left>=c.left-1&&p.right<=c.right+1&&p.top>=c.top-1&&p.bottom<=c.bottom+1,pill:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},cell:{left:c.left,right:c.right,top:c.top,bottom:c.bottom}}})()`);
    result.layoutChecks.push(orderPaymentLayout);
    if(!orderPaymentLayout.ok)result.errors.push('workspace-orders: payment badge leaves its order cell');

    await win.webContents.executeJavaScript("(()=>{showView('programSettings');const box=document.querySelector('#jfUpdateCenter');const toggle=box?.querySelector(':scope > .settings-accordion-toggle-v610');if(box&&!box.classList.contains('open'))toggle?.click();box?.scrollIntoView({block:'start'});})()");
    await waitForRenderer(win,"document.querySelector('#jfUpdateCenter[data-update-ready=\"1\"]')?.classList.contains('open')&&!document.querySelector('#jfUpdateCenter > .settings-accordion-body-v610')?.hidden");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'04-update-center'));
    result.contracts.push({screen:'update-center',...(await collectVisualContract(win,['#jfUpdateTitle','#jfUpdateBadge','#jfUpdateStatus','#jfUpdateCheck','#jfUpdateDownload','#jfUpdateApply','#jfUpdateAfterClose','#jfUpdateRemindLater','#jfUpdateHistory','#jfUpdateDiagnostic']))});

    await win.webContents.executeJavaScript("showView('programSettings');const box=document.querySelector('#jfRegIntegrationsBox');const toggle=box?.querySelector(':scope > .settings-accordion-toggle-v610');if(box&&!box.classList.contains('open'))toggle?.click();box?.scrollIntoView({block:'start'});");
    await waitForRenderer(win,"document.querySelector('#jfRegIntegrationsBox')?.classList.contains('open')&&!document.querySelector('#jfRegIntegrationsBox > .settings-accordion-body-v610')?.hidden");
    await new Promise(resolve=>setTimeout(resolve,900));
    result.screens.push(await captureVisualQa(win,output,'04-settings-integrations'));
    result.contracts.push({screen:'settings-integrations',...(await collectVisualContract(win,['#jfRegIntegrationsBox h3','#jfRegIntegrationsBox .jf-integration-lead','#jfRegIntegrationsBox .jf-integration-card b','#jfRegIntegrationsBox .jf-integration-card label']))});

    await win.webContents.executeJavaScript("document.querySelector('#jfRegIntegrationsBox .jf-instruction-btn')?.click()");
    await waitForRenderer(win,"document.querySelector('#jfHelpModal.open')&&getComputedStyle(document.querySelector('#jfHelpModal')).display!=='none'");
    result.screens.push(await captureVisualQa(win,output,'05-instruction-modal'));
    result.contracts.push({screen:'instruction-modal',...(await collectVisualContract(win,['#jfHelpModal h2','#jfHelpModal p','#jfHelpModal li']))});
    await win.webContents.executeJavaScript("document.querySelector('#jfHelpClose')?.click()");
    const visualQaMainWindow=mainWindow;
    mainWindow=null;
    let wizardPromise=null,wizard=null;
    try{
      wizardPromise=openTelegramSetupWizard(false);
      wizard=telegramSetupWindow;
      if(!wizard||wizard.isDestroyed())throw new Error('Telegram setup wizard was not created');
      await waitForRenderer(wizard,"document.readyState==='complete'&&document.querySelector('#cloudflareToken')&&document.querySelector('#botToken')&&document.querySelector('.logo img')?.complete&&document.querySelector('.logo img')?.naturalWidth>=128");
      const wizardLogo=await wizard.webContents.executeJavaScript(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({name:'telegram-wizard-logo',ok:image.naturalWidth>=128&&image.naturalHeight>=128,width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({name:'telegram-wizard-logo',ok:false,width:0,height:0});image.src=new URL('assets/JustFun-official-transparent.png',document.baseURI).href})`);
      result.assetChecks.push(wizardLogo);
      if(!wizardLogo.ok)result.errors.push('telegram-setup-wizard: JustFun logo asset is missing or incomplete');
      const visibleStarted=Date.now();
      while(!wizard.isVisible()&&Date.now()-visibleStarted<5000)await new Promise(resolve=>setTimeout(resolve,100));
      if(!wizard.isVisible())throw new Error('Telegram setup wizard did not become visible');
      await new Promise(resolve=>setTimeout(resolve,500));
      result.screens.push(await captureNativeVisualQaWindow(wizard,output,'09-telegram-setup-wizard'));
      result.contracts.push({screen:'telegram-setup-wizard',...(await collectVisualContract(wizard,['#title','.notice','.step b','label[for="cloudflareToken"]','label[for="botToken"]','#cancel','#submit']))});
    }finally{
      if(wizard&&!wizard.isDestroyed())wizard.close();
      if(wizardPromise)await wizardPromise.catch(()=>null);
      mainWindow=visualQaMainWindow;
    }

    await win.webContents.executeJavaScript("showView('trips');const card=document.querySelector('#tripsView .route-card[id^=\"routeCard-\"]');const routeId=card?.id?.replace(/^routeCard-/,'');if(routeId)window.showRouteOnMap?.(routeId,false);document.querySelector('#tripsView .route-map-wrap')?.scrollIntoView({block:'center'});");
    await waitForRenderer(win,"document.querySelector('#routesMap')?.getBoundingClientRect().height>200");
    await new Promise(resolve=>setTimeout(resolve,2500));
    result.screens.push(await captureVisualQa(win,output,'06-route-map'));
    result.contracts.push({screen:'route-map',...(await collectVisualContract(win,['.route-map-heading span','#routeMapTitle','#routeMapMeta','.jf-map-credit']))});

    await win.webContents.executeJavaScript("document.querySelector('#tripsArea .jf-route-telegram-actions')?.scrollIntoView({block:'center'});");
    await waitForRenderer(win,"document.querySelector('#tripsArea .jf-route-telegram-actions')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'07-route-telegram-actions'));
    result.contracts.push({screen:'route-telegram-actions',...(await collectVisualContract(win,['.jf-route-telegram-head b','[data-route-tg=\"driver\"]','[data-route-tg=\"warehouse\"]','.jf-route-telegram-target .jf-telegram-state']))});

    await win.webContents.executeJavaScript("showView('drivers');const driver=(typeof drivers!=='undefined'?drivers:[]).find(item=>!(typeof driverIsAggregator==='function'&&driverIsAggregator(item)));if(driver)openDriverDetails(driver.id);");
    await waitForRenderer(win,"document.querySelector('.jf-telegram-driver')?.getBoundingClientRect().height>0");
    await win.webContents.executeJavaScript("document.querySelector('.jf-telegram-driver')?.scrollIntoView({block:'center'});");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'08-driver-telegram'));
    result.contracts.push({screen:'driver-telegram',...(await collectVisualContract(win,['.jf-telegram-driver h2','[data-driver-link]','[data-driver-test]','.jf-telegram-driver .jf-telegram-state']))});

    await win.webContents.executeJavaScript("(()=>{window.closeDriverDetailModal?.();showView('settings');const panel=document.querySelector('.delivery-pricing-settings-box');const toggle=panel?.querySelector(':scope > .settings-accordion-toggle-v610');if(panel&&!panel.classList.contains('open'))toggle?.click();panel?.scrollIntoView({block:'start'});})()");
    await waitForRenderer(win,"document.querySelector('.delivery-pricing-settings-box.open #deliveryPricingPreview')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'15-delivery-pricing-clear'));
    result.contracts.push({screen:'delivery-pricing-clear',...(await collectVisualContract(win,['.delivery-pricing-settings-box > .settings-accordion-toggle-v610 b','.delivery-pricing-steps','.delivery-pricing-group header','#deliveryPricingPreview']))});

    await win.webContents.executeJavaScript("(()=>{const panel=document.querySelector('#smartRouteSettings');const toggle=panel?.querySelector(':scope > .settings-accordion-toggle-v610');if(panel&&!panel.classList.contains('open'))toggle?.click();panel?.scrollIntoView({block:'start'});})()");
    await waitForRenderer(win,"document.querySelector('#smartRouteSettings.open .clarity-presets')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'16-smart-route-clear'));
    result.contracts.push({screen:'smart-route-clear',...(await collectVisualContract(win,['#smartRouteSettings > .settings-accordion-toggle-v610 b','#smartRouteSettings .clarity-presets','#smartRouteSettings .clarity-switches','#smartRoutePreview']))});

    await win.webContents.executeJavaScript("(()=>{showView('programSettings');const panel=document.querySelector('#smartProgramSettings');const toggle=panel?.querySelector(':scope > .settings-accordion-toggle-v610');if(panel&&!panel.classList.contains('open'))toggle?.click();panel?.scrollIntoView({block:'start'});})()");
    await waitForRenderer(win,"document.querySelector('#smartProgramSettings.open .clarity-settings-columns')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'17-program-behavior-clear'));
    result.contracts.push({screen:'program-behavior-clear',...(await collectVisualContract(win,['#smartProgramSettings > .settings-accordion-toggle-v610 b','#smartProgramSettings .clarity-section header','#smartProgramSettings .clarity-check','#smartProgramHealth']))});

    await win.webContents.executeJavaScript("showView('reports');window.scrollTo(0,0)");
    await waitForRenderer(win,"document.querySelector('#clarityReportGuide')?.getBoundingClientRect().height>0&&document.querySelector('#directorSummary')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'18-report-clear'));
    result.contracts.push({screen:'report-clear',...(await collectVisualContract(win,['#reportsView .director-hero h2','#clarityReportGuide','#directorSummary','#directorActions']))});

    await win.webContents.executeJavaScript("(()=>{showView('trips');const routeId='demo-route-ready';if(routePlans?.[routeId]){delete routeDriverAssignments[routeId];renderTripsPreview();window.__jfVisualQaDecisionRouteId=routeId;window.openRouteDecisionCenterV783?.(routeId)}})()");
    await waitForRenderer(win,"document.querySelector('#routeDecisionModalV783.open .clarity-decision-list')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'19-route-decisions-clear'));
    result.contracts.push({screen:'route-decisions-clear',...(await collectVisualContract(win,['#routeDecisionModalV783.open [data-decision-title]','#routeDecisionModalV783.open .clarity-decision-summary','#routeDecisionModalV783.open .clarity-decision-list article','#routeDecisionModalV783.open .clarity-decision-item-action']))});

    await win.webContents.executeJavaScript("(()=>{window.closeRouteDecisionCenterV783?.();showView('orders');window.openOrderModal?.();window.openOrderProductDrawerV783?.(false);})()");
    await waitForRenderer(win,"document.querySelector('[data-testid=\"order-product-drawer\"].open [data-testid=\"product-drawer-results\"]')?.getBoundingClientRect().height>100");
    await new Promise(resolve=>setTimeout(resolve,500));
    result.screens.push(await captureVisualQa(win,output,'20-product-picker-clear'));
    result.contracts.push({screen:'product-picker-clear',...(await collectVisualContract(win,['[data-testid="order-product-drawer"] aside','[data-testid="product-drawer-categories"]','[data-testid="product-drawer-search"]','[data-testid="product-drawer-results"]','[data-testid="product-drawer-basket"]','[data-testid="product-drawer-submit"]']))});
    await win.webContents.executeJavaScript("window.closeOrderProductDrawerV783?.();window.closeOrderModal?.();showView('programSettings');window.openWarehouseEditorV600?.('');");
    await waitForRenderer(win,"document.querySelector('#warehouseEditorModalV600.open #warehouseLocationMapV600')?.getBoundingClientRect().height>200");
    await new Promise(resolve=>setTimeout(resolve,700));
    result.screens.push(await captureVisualQa(win,output,'21-warehouse-map-create'));
    result.contracts.push({screen:'warehouse-map-create',...(await collectVisualContract(win,['.warehouse-location-picker label','.warehouse-location-search','#warehouseLocationStatusV600','#warehouseLocationMapV600','.warehouse-telegram-next']))});
    await win.webContents.executeJavaScript("window.closeWarehouseEditorV600?.();window.JustFunAccessV760?.openUserCreator?.();");
    await waitForRenderer(win,"document.querySelector('#jfUserCreator.open #jfUserRole')?.getBoundingClientRect().height>0");
    await new Promise(resolve=>setTimeout(resolve,350));
    result.screens.push(await captureVisualQa(win,output,'22-custom-role-permissions'));
    result.contracts.push({screen:'custom-role-permissions',...(await collectVisualContract(win,['#jfUserCreator h2','#jfUserRole','#jfUserCreator .jf-permission-group','#jfUserCreator .jf-warehouse-checks']))});

    win.destroy();win=null;
    const responsiveCases=[
      {name:'10-minimum-1120x720',width:1120,height:720,zoom:1,modal:true},
      {name:'11-common-1366x768',width:1366,height:768,zoom:1,modal:false},
      {name:'12-scale-125',width:1600,height:1000,zoom:1.25,modal:false},
      {name:'13-scale-150',width:1600,height:1000,zoom:1.5,modal:true},
      {name:'14-scale-200',width:1600,height:1000,zoom:2,modal:true}
    ];
    for(const testCase of responsiveCases){
      currentSession={edition:'demo',authorized:true,machineCode:'VISUAL-QA',cloudAuth:null,recovery:false,demoState:makeDemoState()};
      win=await openVisualQaWindow('demo',`visual-responsive-${testCase.name}-${crypto.randomBytes(6).toString('hex')}`,{width:testCase.width,height:testCase.height});
      await waitForRenderer(win,"document.documentElement.classList.contains('jf-authenticated')",45000);
      win.webContents.setZoomFactor(testCase.zoom);
      await new Promise(resolve=>setTimeout(resolve,1400));
      await win.webContents.executeJavaScript("showView('orders');window.scrollTo(0,0)");
      await new Promise(resolve=>setTimeout(resolve,350));
      const mainContract=await collectResponsiveContract(win,testCase.name,testCase.zoom);result.responsiveChecks.push(mainContract);
      const scaledViewport={
        width:testCase.width,
        height:testCase.height,
        viewportWidth:Math.round(testCase.width/testCase.zoom),
        viewportHeight:Math.round(testCase.height/testCase.zoom)
      };
      result.screens.push(await captureVisualQa(win,output,testCase.name,scaledViewport));
      if(mainContract.horizontalOverflow>1)result.errors.push(`${testCase.name}: horizontal overflow ${mainContract.horizontalOverflow}px`);
      for(const item of mainContract.items.filter(item=>['#jfDesktopStrip','.topbar','.tabs-shell-v595','#ordersView .orders-view-copy'].includes(item.selector))){if(item.missing||!item.visible||item.clippedLeft||item.clippedRight)result.errors.push(`${testCase.name}: critical layout ${item.selector} is missing, hidden or clipped`)}
      if(testCase.modal){
        await win.webContents.executeJavaScript("openOrderModal();document.querySelector('#orderModal .modal-box')?.scrollTo(0,0)");
        await waitForRenderer(win,"document.querySelector('#orderModal.open .modal-box')?.getBoundingClientRect().height>200");
        await new Promise(resolve=>setTimeout(resolve,250));
        const modalContract=await collectResponsiveContract(win,`${testCase.name}-order-modal`,testCase.zoom);result.responsiveChecks.push(modalContract);
        result.screens.push(await captureVisualQa(win,output,`${testCase.name}-order-modal`,scaledViewport));
        const modalItem=modalContract.items.find(item=>item.selector==='#orderModal.open .modal-box');if(!modalItem||!modalItem.visible||modalItem.clippedLeft||modalItem.clippedRight)result.errors.push(`${testCase.name}: order modal is missing, hidden or horizontally clipped`);
      }
      win.destroy();win=null;
    }
  }catch(error){
    result.errors.push(safeError(error));
  }finally{
    if(win&&!win.isDestroyed())win.destroy();
    mainWindow=null;
  }
  for(const contract of result.contracts){
    if(contract.overflow>0)result.errors.push(`${contract.screen}: horizontal overflow ${contract.overflow}px`);
    for(const item of contract.items||[]){
      if(item.missing||!item.visible){result.errors.push(`${contract.screen}: missing or hidden ${item.selector}`);continue}
      item.contrast=Number(contrastRatio(item.color,item.background).toFixed(2));
      const fontSize=Number.parseFloat(item.fontSize)||0,minimum=fontSize>=18?3:4.5;
      if(item.contrast<minimum)result.errors.push(`${contract.screen}: contrast ${item.selector} ${item.contrast}:1`);
    }
  }
  writeJsonAtomic(path.join(output,'VISUAL-QA.json'),result);
  appendLog('visual QA complete',{screens:result.screens.length,errors:result.errors});
  app.exit(result.errors.length?7:0);
}

function printQaOutputDirectory() {
  const prefix='--print-qa-output=';
  const arg=process.argv.find(value=>String(value).startsWith(prefix));
  return arg?path.resolve(String(arg).slice(prefix.length)):'';
}
async function runPrintQa() {
  const output=printQaOutputDirectory();
  if(!output)throw new Error('Не указана папка проверки печатных документов.');
  ensureDir(output);
  const config=readInstallConfig();
  localRootOverride=path.join(output,'isolated-local');
  ensureDir(localRootOverride);
  config.data_dir=path.join(output,'isolated-data');
  ensureDir(config.data_dir);
  setSecureSessionDefaults(config);
  await app.whenReady();
  app.setAppUserModelId('JustFun.OrdersLogistics.PrintQA');
  configureElectronSession(config);
  currentSession={edition:'demo',authorized:true,machineCode:'PRINT-QA',cloudAuth:null,recovery:false,demoState:makeDemoState()};
  registerIPC(config);
  const result={version:VERSION,createdAt:new Date().toISOString(),documents:[],errors:[]};
  let win=null;
  try{
    win=await openVisualQaWindow('demo',`print-qa-${crypto.randomBytes(8).toString('hex')}`);
    await waitForRenderer(win,"document.documentElement.classList.contains('jf-authenticated')",45000);
    await new Promise(resolve=>setTimeout(resolve,1800));
    const documents=[
      {
        name:'01-order-delivery',
        script:`(() => {const order=orders.find(item=>item.orderType!=='pickup');if(!order)throw new Error('Нет заказа с доставкой');currentDetailId=order.id;printCurrentOrder();return{number:order.number,type:'delivery'}})()`,
      },
      {
        name:'02-order-pickup',
        script:`(() => {const order=orders.find(item=>item.orderType==='pickup');if(!order)throw new Error('Нет заказа самовывоза');currentDetailId=order.id;printCurrentOrder();return{number:order.number,type:'pickup'}})()`,
      },
      {
        name:'03-route-sheet',
        script:`(() => {const routeId=Object.keys(routePlans).sort((left,right)=>asArray(routePlans[right]?.orderedIds).length-asArray(routePlans[left]?.orderedIds).length).find(id=>asArray(routePlans[id]?.orderedIds).length);if(!routeId)throw new Error('Нет рассчитанного маршрута');printRoute(routeId);return{routeId,stops:asArray(routePlans[routeId].orderedIds).length,type:'route'}})()`,
      },
      {
        name:'04-director-report',
        script:`(() => {printReport();return{type:'report'}})()`,
      },
      {
        name:'05-order-long-content',
        script:`(() => {const order=orders.find(item=>item.orderType!=='pickup');if(!order)throw new Error('Нет заказа для проверки длинного документа');const backup=JSON.parse(JSON.stringify(order));order.contactName='Очень длинное наименование контактного лица для проверки переноса строк в печатном документе';order.contactMethod='+7 999 123-45-67, дополнительный канал связи через мессенджер';order.deliveryAddress='Ленинградская область, населённый пункт с очень длинным названием, промышленная территория, участок 128, строение 17, складской корпус с отдельным въездом';order.driverNote='Позвонить минимум за один час до прибытия. Проезд только через грузовые ворота. Получить подпись ответственного лица и проверить количество каждой позиции.';order.items=Array.from({length:36},(_,index)=>({...backup.items[index%backup.items.length],name:'Проверочная длинная товарная позиция '+String(index+1).padStart(2,'0')+' — комплект материалов и дополнительных элементов',article:'QA-LONG-'+String(index+1).padStart(3,'0'),qty:index+1,price:1234.56+index,total:(index+1)*(1234.56+index)}));order.goodsTotal=order.items.reduce((sum,item)=>sum+Number(item.total||0),0);order.total=order.goodsTotal;order.grandTotal=order.goodsTotal+Number(order.deliveryCost||0);currentDetailId=order.id;try{printCurrentOrder();return{number:order.number,type:'delivery-long',lines:order.items.length}}finally{Object.keys(order).forEach(key=>delete order[key]);Object.assign(order,backup)}})()`,
      },
    ];
    for(const document of documents){
      const context=await win.webContents.executeJavaScript(`(() => {window.print=()=>{};doPrint=()=>{const area=document.getElementById('printArea');area.style.display='block'};return ${document.script}})()`);
      const contract=await win.webContents.executeJavaScript(`(() => {const area=document.getElementById('printArea'),sheet=area?.querySelector('.print-sheet');if(!sheet)return{ok:false,reason:'print sheet missing'};const text=String(sheet.innerText||'').trim();return{ok:text.length>100,htmlLength:area.innerHTML.length,textLength:text.length,nodes:sheet.querySelectorAll('*').length,images:[...sheet.querySelectorAll('img')].map(image=>({src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth,height:image.naturalHeight})),tables:[...sheet.querySelectorAll('table')].map(table=>({rows:table.rows.length,columns:table.rows[0]?.cells.length||0}))}})()`);
      if(!contract.ok)throw new Error(`${document.name}: печатная область не сформирована`);
      await new Promise(resolve=>setTimeout(resolve,120));
      const pdf=await win.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true,margins:{top:0.25,bottom:0.25,left:0.25,right:0.25},displayHeaderFooter:false});
      const target=path.join(output,`${document.name}.pdf`);
      fs.writeFileSync(target,pdf);
      const bytes=fs.statSync(target).size;
      if(bytes<10000||pdf.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error(`${document.name}: PDF пуст или повреждён (${bytes} байт)`);
      result.documents.push({name:document.name,file:path.basename(target),bytes,context,contract});
      await win.webContents.executeJavaScript(`(() => {const area=document.getElementById('printArea');area.style.display='none';area.innerHTML=''})()`);
    }
  }catch(error){
    result.errors.push(safeError(error));
  }finally{
    if(win&&!win.isDestroyed())win.destroy();
    mainWindow=null;
  }
  writeJsonAtomic(path.join(output,'PRINT-QA.json'),result);
  appendLog('print QA complete',{documents:result.documents.length,errors:result.errors});
  app.exit(result.errors.length?8:0);
}

function installerSmokeOutputPath() {
  const prefix = '--installer-smoke-output=';
  const arg = process.argv.find(value => String(value).startsWith(prefix));
  return arg ? String(arg).slice(prefix.length) : path.join(os.tmpdir(), `JustFun-OrdersLogistics-installer-smoke-${VERSION}.json`);
}
function setInstallerSmokeSessionDefaults(outputPath) {
  const profile = `${path.resolve(outputPath)}.profile`;
  ensureDir(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'session'));
  app.setPath('logs', logDir());
  return profile;
}
async function runInstallerSmokeTest() {
  const outputPath = installerSmokeOutputPath();
  const result = {version:VERSION, ok:false, timestamp:new Date().toISOString(), checks:{}, errors:[]};
  try {
    const config = readInstallConfig();
    setInstallerSmokeSessionDefaults(outputPath);
    await app.whenReady();
    result.checks.electronReady = true;
    result.checks.mode = config.mode;
    result.checks.dataDirectoryConfigured = Boolean(String(config.data_dir || '').trim());
    const required = [
      'main.js','preload.js','security-manifest.cjs',
      'splash.html','splash-preload.js','splash-renderer.js',
      'reg-vps-setup-renderer.js','web/index.html','web/assets/js/01-action-dispatch-v783.js','assets/JustFun.ico'
    ];
    result.checks.requiredFiles = Object.fromEntries(required.map(name => [name, fs.existsSync(path.join(__dirname, ...name.split('/')))]));
    result.checks.allRequiredFiles = Object.values(result.checks.requiredFiles).every(Boolean);
    const integrity = verifyPackagedApplicationIntegrity({applicationDirectory:__dirname, requirePackaged:true});
    result.checks.protectedAsar = integrity.packaged;
    result.checks.noLooseApplicationDirectory = integrity.packaged;
    result.checks.securityManifestPresent = integrity.schema === 3;
    result.checks.embeddedAsarIntegrity = integrity.integrityModel === 'electron-asar-header-sha256';
    result.checks.fullArchiveHashVerified = integrity.archiveHashVerified;
    const sourceProtection = readJson(path.join(__dirname, 'source-protection.json'), null);
    result.checks.sourceProtectionApplied = sourceProtection?.protection === 'terser-minification-and-local-identifier-mangling'
      && Number(sourceProtection?.files) >= 20
      && Number(sourceProtection?.protected_bytes) < Number(sourceProtection?.original_bytes);
    const origin = new URL(LICENSE_API_ORIGIN);
    result.checks.licenseApiHttps = origin.protocol === 'https:' && origin.hostname === LICENSE_API_HOST;
    result.checks.safeStorageAvailable = typeof safeStorage?.isEncryptionAvailable === 'function';
    result.ok = Boolean(
      result.checks.electronReady
      && result.checks.dataDirectoryConfigured
      && result.checks.allRequiredFiles
      && result.checks.protectedAsar
      && result.checks.noLooseApplicationDirectory
      && result.checks.securityManifestPresent
      && result.checks.embeddedAsarIntegrity
      && result.checks.fullArchiveHashVerified
      && result.checks.sourceProtectionApplied
      && result.checks.licenseApiHttps
    );
    if (!result.ok) result.errors.push('Одна или несколько обязательных проверок настольного ядра не пройдены.');
  } catch (error) {
    result.errors.push(safeError(error));
  }
  try { writeJsonAtomic(outputPath, result); } catch (error) { process.stderr.write(safeError(error) + '\n'); }
  appendLog('installer smoke test complete', result);
  app.exit(result.ok ? 0 : 5);
}

function runRunningInstanceProbe(outputPath = '') {
  const acquired = app.requestSingleInstanceLock({ mode: 'running-instance-probe' });
  if (acquired) app.releaseSingleInstanceLock();
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), acquired ? 'NOT_RUNNING' : 'RUNNING', 'ascii');
  const exitCode = acquired ? 0 : 30;
  app.exit(exitCode);
  return exitCode;
}

if (DESKTOP_UNIT_TEST_MODE) {
  module.exports = {
    VERSION, DEMO_DURATION_MS, DEMO_SCHEMA, DEMO_STATE_NAME, RENDERER_READY_TIMEOUT_MS,
    readInstallConfig, persistInstallConfig, buildSession,
    getMachineCode, normalizeDemoState, normalizeDemoStateWithCloud, reconcileDemoStateWithCloud, remainingDemoMs, makeDemoState,
    signObject, validSignedObject, demoLocations, persistDemoState,
    appendLog, logCandidates, logFile, localRoot, readJson,
    validateWarehouseId, validateEnvironment, validateWarehouseSnapshot, validateSnapshotEntityIdentifiers, telegramWarehouseScope,
    telegramScopeParts, telegramScopeRoot, validateDeliveredTelegramNotification,
    normalizeFingerprint, pinnedHttpsAgent, validateWorkerState, loadWorkerState,
    cloudFriendlyError, friendlyCloudNetworkError, isRetryableCloudNetworkError, isTemporaryCompanyServiceError, telegramCompanyPublishRetryDelay, telegramCompanyPublishPendingMessage, withCloudNetworkRetry, decodeJwtPayload, tokenExpiresAt, justFunTokenClaims, combinedCloudClaims, normalizeCloudUser, normalizeCloudCompany, normalizeCloudAuthState, publicCloudAuth,
    readCloudAuthState, writeCloudAuthState, clearCloudAuthState, saveCloudSession, cloudSessionComplete,
    companyWorkspaceId, cloudRegState, selectRegState, canConfigureCompanyServer, canManageCompanyWarehouses, canCreateCompanyWarehouses, canDeleteCompanyWarehouses, validateWarehouseCode, validateWarehouseDeleteLease, validateTelegramDeprovisionResult, normalizeWarehouseDeleteBatch, warehouseDeleteLeaseSecretName, warehouseDeletePrepareFailureAction, withWarehouseDeleteOperationLock, regWarehouseDeletePreparePath,
    regStatePath, regApiSecretName, regVpsAttestationSecretName, readLocalRegState, regDiagnosticStage,
    installerSmokeOutputPath, setInstallerSmokeSessionDefaults, runInstallerSmokeTest, runRunningInstanceProbe, parseCssColor, contrastRatio,
    appRendererUrl, resolveAppRendererPath, isTrustedAppUrl, verifyPackagedApplicationIntegrity,
    directOpenStreetMapGeocode, resolveDesktopMapGeocode,
    validateDesktopAddressSearchPayload, canonicalAddressToNominatim, validateAddressSearchResponse, resolveDesktopAddressSearch, regAddressSearchPath
  };
} else {
  const runningInstanceProbeArgument = process.argv.find(value=>String(value).startsWith('--running-instance-probe-output='));
  const runningInstanceProbeMode = process.argv.includes('--running-instance-probe') || Boolean(runningInstanceProbeArgument);
  if (runningInstanceProbeMode) {
    runRunningInstanceProbe(runningInstanceProbeArgument ? String(runningInstanceProbeArgument).slice('--running-instance-probe-output='.length) : '');
  }
  const installerSmokeMode = process.argv.includes('--installer-smoke-test');
  const selfTestMode = process.argv.includes('--self-test');
  const visualQaMode = process.argv.some(value=>String(value).startsWith('--visual-qa-output='));
  const printQaMode = process.argv.some(value=>String(value).startsWith('--print-qa-output='));
  singleInstanceLock = runningInstanceProbeMode || selfTestMode || installerSmokeMode || visualQaMode || printQaMode
    ? true
    : app.requestSingleInstanceLock();
  if (!runningInstanceProbeMode && !singleInstanceLock) app.quit();
  else if (!runningInstanceProbeMode) {
    app.on('second-instance', () => { if (mainWindow&&!mainWindow.isDestroyed()&&!mainWindow.webContents?.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
    app.on('window-all-closed', () => { if (!visualQaMode && !printQaMode && process.platform !== 'darwin') app.quit(); });
    app.on('before-quit', event => {
      if (!updateCloseApplyStarted) {
        try {
          const controller=getUpdateController();
          if (controller.shouldApplyOnClose()) {
            event.preventDefault();
            updateCloseApplyStarted=true;
            controller.apply().then(result=>{
              if(!result?.ok)appendLog('deferred update apply failed',{code:String(result?.code||'UPDATE_APPLY_FAILED'),error:String(result?.message||'')});
              const timer=setTimeout(()=>app.quit(),500);timer.unref?.();
            }).catch(error=>{
              appendLog('deferred update apply failed',{code:String(error?.code||'UPDATE_APPLY_FAILED'),error:safeError(error)});
              const timer=setTimeout(()=>app.quit(),0);timer.unref?.();
            });
            return;
          }
        } catch(error) { appendLog('deferred update decision failed',{code:String(error?.code||'UPDATE_DEFER_FAILED'),error:safeError(error)}); }
      }
      clearInterval(demoTimer); stopTelegramCompanyPublishRetry(); stopWarehouseDeleteResume(); stopUpdateSchedule(); flushRecurringLogs(); appendLog('application exiting');
    });
    process.on('uncaughtException', error => { appendLog('uncaughtException', diagnosticError(error)); showRecoveryError('Не удалось продолжить запуск программы.', safeError(error)); });
    process.on('unhandledRejection', error => appendLog('unhandledRejection', diagnosticError(error)));
    const entry = installerSmokeMode ? runInstallerSmokeTest : (selfTestMode ? runSelfTest : (visualQaMode ? runVisualQa : (printQaMode ? runPrintQa : boot)));
    entry().catch(error => {
      appendLog(
        installerSmokeMode
          ? 'installer smoke failed'
          : (selfTestMode
            ? 'self-test failed'
            : (visualQaMode ? 'visual QA failed' : (printQaMode ? 'print QA failed' : 'boot failed'))),
        safeError(error),
      );
      if (installerSmokeMode) {
        writeFailureArtifact(installerSmokeOutputPath(), {version:VERSION, ok:false, errors:[safeError(error)]}, 'installer-smoke');
        app.exit(5);
        return;
      }
      if (selfTestMode) {
        writeFailureArtifact(selfTestOutputPath(), {version:VERSION, authorized:false, errors:[safeError(error)]}, 'self-test');
        app.exit(4);
        return;
      }
      if (visualQaMode) {
        writeFailureArtifact(path.join(visualQaOutputDirectory(),'VISUAL-QA.json'), {version:VERSION, errors:[safeError(error)]}, 'visual-qa');
        app.exit(7);
        return;
      }
      if (printQaMode) {
        writeFailureArtifact(path.join(printQaOutputDirectory(),'PRINT-QA.json'), {version:VERSION, errors:[safeError(error)]}, 'print-qa');
        app.exit(8);
        return;
      }
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      showRecoveryError('Программа не смогла завершить безопасный запуск.', safeError(error));
    });
  }
}
