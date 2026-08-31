import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const release=JSON.parse(read('source/application/release.json'));
const index=read('source/application/web/index.html');
const designTokens=read('source/application/web/assets/css/01-design-tokens-v783.css');
const premiumCss=read('source/application/web/assets/css/120-premium-release-v783.css');
const experienceCss=read('source/application/web/assets/css/130-experience-refresh-v783.css');
const desktop=read('source/application/web/assets/js/110-desktop-platform-v750.js');
const mapCore=read('source/application/web/assets/js/105-map-reliability-v772.js');
const mapRoute=read('source/application/web/assets/js/95-route-map-loading.js');
const main=read('source/application/main.js');
const preload=read('source/application/preload.js');
const worker=read('source/application/integrations/telegram-cloudflare-native/worker/index.js');
const telegramStatuses=read('source/application/integrations/telegram-cloudflare-native/worker/status.js');
const provisioner=read('source/application/integrations/telegram-cloudflare-native/provisioner.cjs');
const setup=read('source/installer/Setup.nsi');
const recovery=read('source/installer/Recovery.nsi');
const installerBuilder=read('source/installer/build_windows.py');
const releaseBuilder=read('tools/build-audited-rc.ps1');
const ownerPackager=read('tools/package-owner-rc.ps1');
const windowsWorkflowContract=read('tests/fixtures/windows-native-783.yml');
const windowsWorkflowPath=path.join(root,'.github/workflows/windows-native-783.yml');
const windowsWorkflow=fs.existsSync(windowsWorkflowPath)?fs.readFileSync(windowsWorkflowPath,'utf8'):windowsWorkflowContract;
if(fs.existsSync(windowsWorkflowPath))assert.equal(windowsWorkflow,windowsWorkflowContract,'Windows workflow and source-only test contract differ');
const payloadBuilder=read('source/desktop-runtime/build_payload.py');
const payloadHardener=read('source/desktop-runtime/harden_payload.mjs');
const stageProtector=read('source/desktop-runtime/protect_stage.mjs');
const runtimePackage=JSON.parse(read('source/desktop-runtime/package.json'));

const rgb=hex=>hex.match(/[a-f0-9]{2}/gi).map(value=>Number.parseInt(value,16));
const luminance=hex=>rgb(hex).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+.05)/(values[1]+.05)};

assert(contrast('10241d','ffffff')>=7,'primary text contrast');
assert(contrast('5c7067','ffffff')>=4.5,'muted text contrast');
assert(contrast('ffffff','085b43')>=7,'primary button contrast');
assert(contrast('0d684d','f5f9f7')>=4.5,'update ready badge contrast');
assert(contrast('a65c00','f5f9f7')>=4.5,'update busy badge contrast');
assert(designTokens.includes('--jf-color-warning:#a65c00;'));
assert(experienceCss.includes('.jf-update-badge.ready{background:var(--jf-color-surface-soft);color:var(--jf-color-brand-700)}'));
assert(experienceCss.includes('.jf-update-badge.busy{background:var(--jf-color-surface-soft);color:var(--jf-color-warning)}'));
assert(designTokens.includes('color-scheme:light'));
assert(index.includes('assets/css/01-design-tokens-v783.css'));
assert(premiumCss.includes('.jf-auth-main{background:var(--jf-color-surface)!important;color:var(--jf-ink)!important}'));
assert(premiumCss.includes('.brand-title{color:var(--jf-color-surface)!important'));
assert(index.includes(`<title>${release.product_name} · ${release.version}</title>`));
assert(index.includes('assets/justfun-official-transparent.png'));
assert(fs.existsSync(path.join(root,'source/application/web/assets/justfun-official-transparent.png')));
for(const relative of [
  'source/application/splash.html',
  'source/application/telegram-setup.html',
  'source/application/reg-vps-setup.html',
  'source/application/web/index.html',
  'source/application/web/assets/css/110-desktop-platform-v750.css',
  'source/application/web/assets/css/120-premium-release-v783.css',
  'source/application/web/assets/css/130-experience-refresh-v783.css'
]){
  const file=path.join(root,relative),text=fs.readFileSync(file,'utf8');
  const references=[
    ...[...text.matchAll(/\b(?:src|href)=["']([^"'#]+)["']/gi)].map(match=>match[1]),
    ...[...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(match=>match[1])
  ].filter(value=>!value.match(/^(?:https?:|mailto:|data:|#)/i)&&!value.includes('${'));
  for(const reference of references){
    const clean=reference.split(/[?#]/,1)[0];
    assert(fs.existsSync(path.resolve(path.dirname(file),clean)),`missing local visual asset ${relative} -> ${reference}`);
  }
}
assert(!read('source/application/splash.html').includes('JustFun-mark.png'));
assert(!read('source/application/telegram-setup.html').includes('JustFun-mark.png'));
assert(read('source/application/telegram-setup.html').includes("assets/JustFun-official-transparent.png"));
assert(!read('source/application/reg-vps-setup.html').includes('JustFun-mark.png'));
assert(!desktop.includes('JustFun-mark.png'));
assert(!premiumCss.includes('JustFun-mark.png'));
assert(desktop.includes('Вход в JustFun'));
assert(desktop.includes('Вход в компанию'));
assert(desktop.includes('placeholder="Например, JFXXXXXX"'));

assert(!mapCore.includes('MutationObserver'));
assert(!mapRoute.includes('MutationObserver'));
assert(!mapCore.includes('pan:true'));
assert(mapCore.includes('pan:false'));
assert(mapRoute.includes('fadeAnimation:false'));
assert(index.includes('Картографические данные:'));
assert(index.includes('© OpenStreetMap'));
assert(premiumCss.includes('.leaflet-control-attribution{display:none!important}'));

assert(desktop.includes('jf-instruction-tools'));
assert(desktop.includes("btn.textContent='Подробная инструкция'"));
assert(desktop.includes("#settingsView .settings-box, #programSettingsView .settings-box"));
assert(desktop.includes("helpList('Как настроить'"));
assert(desktop.includes("helpList('Важно и безопасно'"));
assert(desktop.includes('new MutationObserver(()=>queueMicrotask(installHelp))'));
assert(desktop.includes("if(event.key==='Escape'"));
assert(!premiumCss.includes('.jf-instruction-btn:hover{display:none'));
assert(!desktop.includes("list.some(x=>x.startsWith(domain+'.'))"));
assert(desktop.includes("resolvedFunctionPermission(name,fallback,args=[])"));
assert(desktop.includes("formPermission(event.target)"));
assert(desktop.includes("FUNCTION_PERMISSIONS"));

assert(desktop.includes('>Отправить водителю</button>'));
assert(desktop.includes('>Отправить на склад</button>'));
assert(desktop.includes('statusButtons:true'));
assert(desktop.includes('Подключить водителя'));
assert(!desktop.includes('Статусы возвращаются в JustFun автоматически'));
assert(desktop.includes("sent:'Доставлено в Telegram'"));
assert(preload.includes("ipcRenderer.invoke('desktop:telegram-bindings'"));
assert(main.includes("handleMainIPC('desktop:telegram-bindings'"));
assert(main.includes('trustedMainIPCHandler(channel, listener)'));
assert(main.includes("decodeURIComponent(parsed.pathname)==='/web/index.html'"));
assert(main.includes("'remote-debugging-port'"));
assert(main.includes('app.enableSandbox?.()'));
assert(main.includes("verifyPackagedApplicationIntegrity({applicationDirectory:__dirname, requirePackaged:true})"));
assert(main.includes('result.checks.embeddedAsarIntegrity'));
assert(main.includes('result.checks.fullArchiveHashVerified'));
assert(main.includes("result.checks.sourceProtectionApplied"));
assert(main.includes("session.fromPartition(`self-test-${isolatedId}`)"));
assert.equal((main.match(/registerAppProtocol\(wizardSession\)/g)||[]).length,2);
assert(main.includes("registerSchemesAsPrivileged"));
assert(main.includes("targetSession.protocol.handle(APP_RENDERER_SCHEME"));
assert(main.includes("loadURL(appRendererUrl('web/index.html'))"));
assert(!main.includes('.loadFile('));
assert(main.includes("relative.startsWith('..') || path.isAbsolute(relative)"));
assert(main.includes('status_buttons:payload?.statusButtons!==false'));
assert(worker.includes("parts[1] === 'bindings'"));
assert(telegramStatuses.includes("accepted"));
assert(telegramStatuses.includes("warehouse"));
assert(telegramStatuses.includes("ready"));
assert(!worker.match(/bindings:\s*bindings\.map[\s\S]{0,500}chat_id/));
assert(provisioner.includes('waitForAuthorizedWorker'));

assert(payloadBuilder.includes('protect_stage.mjs'));
assert(payloadBuilder.includes('harden_payload.mjs'));
assert(payloadBuilder.includes('resources / "app.asar"'));
assert(payloadHardener.includes("type: 'INTEGRITY'"));
assert(payloadHardener.includes("id: 'ELECTRONASAR'"));
assert(payloadHardener.includes('brandWindowsExecutable'));
assert(payloadHardener.includes("ProductName: 'JustFun Логистика'"));
assert(payloadHardener.includes('EnableEmbeddedAsarIntegrityValidation'));
assert(payloadHardener.includes('OnlyLoadAppFromAsar'));
assert(payloadHardener.includes('[FuseV1Options.RunAsNode]: false'));
assert(payloadHardener.includes('[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false'));
assert(payloadHardener.includes('[FuseV1Options.EnableNodeCliInspectArguments]: false'));
assert(payloadHardener.includes('[FuseV1Options.GrantFileProtocolExtraPrivileges]: false'));
assert(stageProtector.includes('terser-minification-and-local-identifier-mangling'));
assert(stageProtector.includes('comments: false'));
assert(stageProtector.includes('sourceMap: false'));
assert.equal(runtimePackage.devDependencies['@electron/asar'],'4.2.1');
assert.equal(runtimePackage.devDependencies['@electron/fuses'],'2.1.2');
assert.equal(runtimePackage.devDependencies.resedit,'2.0.3');
assert.equal(runtimePackage.devDependencies.terser,'5.49.0');

assert(setup.includes('CreateShortcut "$DESKTOP\\JustFun Логистика.lnk"'));
assert(!setup.includes('CreateShortcut "$DESKTOP\\JustFun — Заказы и логистика.lnk"'));
assert(setup.includes('"DisplayName" "JustFun Логистика"'));
assert(setup.includes('$StageDir\\resources\\app.asar'));
assert(setup.includes('$StageDir\\resources\\justfun-security.json'));
assert(!setup.includes('$StageDir\\resources\\app\\main.js'));
assert(recovery.includes('$ProgramDir\\resources\\app.asar'));
assert(recovery.includes('$ProgramDir\\resources\\justfun-security.json'));
assert(!recovery.includes('$ProgramDir\\resources\\app\\main.js'));
assert(installerBuilder.includes('payload / "resources" / "app.asar"'));
assert(installerBuilder.includes('payload / "resources" / "justfun-security.json"'));
assert(!installerBuilder.includes('brand_executable.cjs'));
assert(releaseBuilder.includes('[switch]$AllowBlockedOwnerRc'));
assert(releaseBuilder.includes('release_eligible = $false'));
assert(releaseBuilder.includes("source_archive = '02-ИСХОДНЫЙ-КОД'"));
assert(!releaseBuilder.includes('source_root = $repo'));
assert(ownerPackager.includes('[switch]$AllowBlockedOwnerRc'));
assert(windowsWorkflow.includes('node tests/security-audit.mjs source tools .github'));

const forbiddenExtensions=['.ps1','.cmd','.bat'];
for(const extension of forbiddenExtensions){
  const found=[];
  const visit=directory=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const full=path.join(directory,entry.name);
      if(entry.isDirectory())visit(full);
      else if(entry.name.toLowerCase().endsWith(extension))found.push(path.relative(root,full));
    }
  };
  visit(path.join(root,'source','application'));
  assert.deepEqual(found,[],`forbidden runtime files ${extension}`);
}

console.log(JSON.stringify({
  ok:true,
  product:'JustFun Логистика',
  contrast:true,
  stableMap:true,
  persistentInstructions:true,
  telegramRouteActions:true,
  driverBinding:true,
  nativeRuntimeOnly:true,
  protectedPackaging:true
}));
